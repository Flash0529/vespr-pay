import { fileStore } from '../../app/file-store.js'
// Measures one end-to-end run of the demo scenario on the real model and prints numbers for the Devpost text.
// It starts its OWN throwaway server and agent (nothing touches the live demo) and uses the key from the env file WITHOUT printing it.
//   node tools/measure-real-model.mjs [path/to/env-file] [--write]     (default: $NEBIUS_ENV_FILE, else ./.env)
// With no key the agent is the scripted demo agent: the script still runs (to prove the plumbing) but labels the result DEMO MODE
// and refuses to --write, so scripted timings can never be mistaken for model numbers.
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const args = process.argv.slice(2)
const write = args.includes('--write')
const envFile = args.find(a => !a.startsWith('--')) || process.env.NEBIUS_ENV_FILE || '.env'
const here = path.dirname(new URL(import.meta.url).pathname)
const sample = path.join(here, '../../sample-project')

const fileEnv = {}
try { for (const l of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(l); if (m) fileEnv[m[1]] = m[2].replace(/^['"]|['"]$/g, '') } } catch {}
const hasKey = !!fileEnv.NEBIUS_API_KEY

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(100) } return null }
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-measure-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n', { mode: 0o600 })
const PORT = await freePort(); const SPORT = await freePort()
const procs = []
const out = { when: new Date().toISOString(), mode: hasKey ? 'REAL MODEL' : 'DEMO MODE (scripted, no model key: these are NOT model numbers)', steps: {}, notes: [] }
try {
  procs.push(spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens'), MURMIO_SUGGEST_UPSTREAM: `http://127.0.0.1:${SPORT}/suggest` }, stdio: 'ignore' }))
  await wait(900)
  const agentEnv = { ...process.env, MURMIO_SERVER: `ws://127.0.0.1:${PORT}`, MURMIO_ROOM: 'measure', MURMIO_TOKEN: 'tok-c', AGENT_NAME: 'coder', SUGGEST_PORT: String(SPORT), MURMIO_TOKENS_FILE: path.join(dir, 'tokens'), NEBIUS_API_KEY: fileEnv.NEBIUS_API_KEY || '' }
  for (const k of ['NEBIUS_BASE_URL', 'NEBIUS_MODEL', 'TAVILY_API_KEY']) if (fileEnv[k]) agentEnv[k] = fileEnv[k]
  procs.push(spawn('node', [path.join(here, '../index.js')], { env: agentEnv, stdio: 'ignore' }))
  await wait(2500)

  const d = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'measure', d, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true })
  await new Promise(r => p.once('sync', r))
  const files = fileStore(d); const chat = d.getArray('chat'); const settings = d.getMap('settings'); const usage = d.getMap('usage')
  for (const f of fs.readdirSync(sample)) { const t = new Y.Text(); t.insert(0, fs.readFileSync(path.join(sample, f), 'utf8'), { by: 'import' }); files.set(f, t) }
  let n = 0
  const say = text => { const m = new Y.Map(); const tx = new Y.Text(); d.transact(() => { m.set('id', 'u' + (++n)); m.set('ts', Date.now()); m.set('author', 'alice'); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); chat.push([m]); tx.insert(0, '@coder ' + text) }) }
  const msgs = () => chat.toArray()
  const find = (role, re, from = 0) => msgs().slice(from).filter(m => m.get('role') === role && re.test(m.get('text').toString()))
  const models = new Set()
  const noteModels = () => { for (const m of msgs()) if (m.get('role') === 'agent' && m.get('model')) models.add(String(m.get('model'))) }
  const LIMIT = hasKey ? 180000 : 30000   // scripted answers take seconds; a real model gets three minutes per step

  // 1. everyday chat on the main model (first-token style latency = time to the agent's first reply)
  settings.set('agentMode', 'auto')
  let from = msgs().length; let t0 = Date.now(); say('run python3 -m unittest -q')
  const red = await until(() => find('tool', /\$ python3 -m unittest -q[\s\S]*\[exit 1\]/, from)[0], LIMIT)
  out.steps.run_failing_tests_ms = red ? Date.now() - t0 : null

  // 2. fix the bug. Milestones are watched together (every 50 ms) so each gets its own true time: first sign of work (a tool step), the edit, green tests, the closing answer
  from = msgs().length; t0 = Date.now(); say('fix the discount bug in cart.py and run the tests again')
  const seen = {}
  const watch = () => {
    const now = Date.now() - t0; const m = msgs().slice(from)
    if (!seen.first_step && m.some(x => x.get('role') === 'tool')) seen.first_step = now
    if (!seen.first_text && m.some(x => x.get('role') === 'agent' && x.get('text').toString().trim())) seen.first_text = now
    if (!seen.edit && /amount \* \(1 - percent \/ 100\)/.test(files.get('cart.py').toString())) seen.edit = now
    if (!seen.green && m.some(x => x.get('role') === 'tool' && /\$ python3 -m unittest -q[\s\S]*\[exit 0\]/.test(x.get('text').toString()))) seen.green = now
    const lastAgent = [...m].reverse().find(x => x.get('role') === 'agent' && x.get('text').toString().trim())
    if (seen.green && lastAgent && !seen.final) seen.final = now
    return seen.edit && seen.green && seen.final
  }
  await until(watch, LIMIT)
  out.steps.first_step_ms = seen.first_step ?? null; out.steps.first_agent_text_ms = seen.first_text ?? null; out.steps.edit_in_shared_file_ms = seen.edit ?? null; out.steps.tests_green_ms = seen.green ?? null; out.steps.final_answer_ms = seen.final ?? null
  out.steps.fix_verified = !!(seen.edit && seen.green)
  out.steps.approvals_needed = msgs().slice(from).filter(m => m.get('role') === 'approval').length
  const agentMsgs = msgs().slice(from).filter(m => m.get('role') === 'agent' && m.get('text').toString().trim()); out.steps.final_text = agentMsgs.length ? agentMsgs[agentMsgs.length - 1].get('text').toString().slice(0, 160) : ''

  // 3. plan mode (should use the planning model)
  settings.set('agentMode', 'plan'); from = msgs().length; t0 = Date.now(); say('plan how to add a percentage cap to the discount function')
  const plan = await until(() => msgs().slice(from).find(m => m.get('role') === 'agent' && m.get('text').toString().trim()), LIMIT)
  out.steps.plan_reply_ms = plan ? Date.now() - t0 : null
  noteModels()

  // 4. inline suggestions (the small model): five requests, report the median
  const lat = []; let sugModel = ''
  for (let i = 0; i < 5; i++) {
    const s = Date.now()
    const r = await fetch(`http://127.0.0.1:${PORT}/api/suggest`, { method: 'POST', headers: { Authorization: 'Bearer tok-a', 'Content-Type': 'application/json' }, body: JSON.stringify({ file: 'cart.py', language: 'python', prefix: `import os\n\ndef parse_args_${i}_${Date.now() % 100000}(x):`, suffix: '' }) }).catch(() => null)
    if (r && r.ok) { const j = await r.json(); sugModel = j.model || sugModel; lat.push(Date.now() - s) }
  }
  out.steps.suggestion_median_ms = median(lat); out.steps.suggestion_samples = lat.length; out.steps.suggestion_model = sugModel

  // 5. tokens the agent used (reported by the provider when it gives usage, otherwise estimated: the entry says which)
  const u = usage.get('coder'); out.steps.tokens = u ? { calls: u.calls, prompt: u.prompt, completion: u.completion, source: (u.est || 0) === 0 ? 'reported by the provider' : (u.est === u.calls ? 'estimated, the provider sent no usage' : `mixed: ${u.est} of ${u.calls} calls estimated`) } : null
  out.models_seen = [...models]
  if (hasKey && /demo/i.test([...models, sugModel].join(' '))) out.notes.push('WARNING: a key was set but a message still says demo-mode: the agent did not pick up the key.')
  p.destroy()
} catch (e) { out.notes.push('script error: ' + e.message); process.exitCode = 1 } finally {
  for (const x of procs) x.kill()
  fs.rmSync(dir, { recursive: true, force: true })
}

const s = out.steps
const sec = ms => ms == null ? 'did not finish in time' : (ms / 1000).toFixed(1) + ' s'
const md = [
  `## Measured run (${out.when.slice(0, 16).replace('T', ' ')} UTC): ${out.mode}`,
  '',
  `Scenario: the sample project's failing test, "fix the discount bug and run the tests again", Auto mode, a throwaway server and one agent on the Pi (no GPU involved; the model runs at Nebius).`,
  '',
  '| What | Result |', '|---|---|',
  `| Run the failing tests (agent runs a command) | ${sec(s.run_failing_tests_ms)} |`,
  `| First sign of work after "fix the bug" (the agent's first tool step) | ${sec(s.first_step_ms)} |`,
  `| First text from the agent | ${sec(s.first_agent_text_ms)} |`,
  `| Edit appears in the shared file | ${sec(s.edit_in_shared_file_ms)} |`,
  `| Tests green after the fix | ${sec(s.tests_green_ms)} (fix verified: ${s.fix_verified ? 'yes' : 'NO'}) |`,
  `| Closing answer from the agent | ${sec(s.final_answer_ms)} |`,
  `| Approval cards needed in Auto mode | ${s.approvals_needed ?? 'n/a'} |`,
  `| Plan-mode reply | ${sec(s.plan_reply_ms)} |`,
  `| Inline suggestion, median of ${s.suggestion_samples ?? 0} | ${s.suggestion_median_ms == null ? 'n/a' : s.suggestion_median_ms + ' ms'} (model: ${s.suggestion_model || 'n/a'}) |`,
  `| Tokens used by the agent | ${s.tokens ? `${s.tokens.calls} calls, ${s.tokens.prompt} prompt + ${s.tokens.completion} completion (${s.tokens.source})` : 'n/a'} |`,
  `| Models that wrote agent messages | ${out.models_seen?.join(', ') || 'n/a'} |`,
  ...(out.notes.length ? ['', ...out.notes.map(x => '- ' + x)] : [])
].join('\n')
console.log(md)
if (write) {
  if (!hasKey) console.log('\n--write refused: no key, so these are scripted numbers. Nothing written.')
  else { const f = path.join(here, '../../docs/MEASURED.md'); fs.appendFileSync(f, (fs.existsSync(f) ? '\n\n' : '# Measured numbers (real model runs only)\n\n') + md + '\n'); console.log('\nappended to docs/MEASURED.md') }
}
setTimeout(() => process.exit(), 200)
