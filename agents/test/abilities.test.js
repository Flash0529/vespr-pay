// What an agent can reach and do, checked end to end: (1) every bundled skill can be found and loaded with find_skill (also the ones no field pack copies in) while the prompt index stays short,
// the skills say honestly what the sandbox may lack, and the run_command tool says what is not shared back; (2) delete_file on a real room: a file, a folder, edge cases, and a card in every mode that needs one.
// Real collab server and a real agent room (the same code the agent process uses); the model is a script, so no key and no network.
import { spawn } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import net from 'node:net'
import { joinRoom } from '../src/room.js'
import { respond, asOpenAITools } from '../src/agent.js'
import { buildLibrary, resolveSkill, skillsFromFiles, SKILL_RULES, skillFile } from '../src/skills.js'
import { bundledSkills } from '../src/packs.js'
const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })

const here = path.dirname(new URL(import.meta.url).pathname)
const AGENTS = path.join(here, '..')
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(60) } throw new Error('timed out waiting for: ' + what) }

// ---------- 1. skills: reachable, honest, and cheap in the prompt ----------
const { lib, errors } = buildLibrary({ bundledDir: path.join(AGENTS, 'src/pack-skills'), starterDir: path.join(AGENTS, 'src/starter-skills') })
assert.deepStrictEqual(errors, [], 'every shipped skill parses')
const bundled = bundledSkills()
for (const name of bundled.keys()) assert.ok(lib.get(name), 'a room agent can find the bundled skill ' + name)
const noWorkspace = skillsFromFiles([]).lib
const ASKS = { // what people ask for, in the words a person would use -> the skill that has to come up
  'run a headless chromium check and take a screenshot': 'headless-chromium-checks',
  'check this page in a browser': 'headless-chromium-checks',
  'extract frames from a video with ffmpeg': 'multimedia-processing',
  'analyze an audio file': 'multimedia-processing',
  'build a vite react typescript app with supabase': 'fullstack-vite-supabase',
  'draw a diagram with boxes and a status table': 'stylistic-presentation',
  'make a small chart': 'stylistic-presentation',
  'design the architecture of a service': 'system-design',
  'production is down': 'incident-response'
}
for (const [ask, want] of Object.entries(ASKS)) {
  const r = await resolveSkill(ask, { installed: noWorkspace, library: lib })
  assert.ok(r.found && r.where === 'library' && !r.needsApproval, `"${ask}" finds a skill without asking anyone`)
  assert.ok(r.candidates.map(c => c.name).includes(want), `"${ask}" finds ${want}: got ${r.candidates.map(c => c.name)}`)
}
// the prompt index lists only the starter skills: bundled ones cost no tokens on every call
const starterNames = fs.readdirSync(path.join(AGENTS, 'src/starter-skills')).map(f => f.replace(/\.md$/, '')).sort()
const listed = lib.index().split('\n').map(l => /^- ([a-z0-9-]+):/.exec(l)[1]).sort()
assert.deepStrictEqual(listed, starterNames, 'the prompt index lists the starter skills only')
assert.ok(lib.list().length >= starterNames.length + bundled.size, 'but the library holds them all')
// a skill with the same name in the workspace, or in the starter folder, wins over the bundled one
const dirs = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-abil-'))
const mk = (d, name, body) => { fs.mkdirSync(path.join(dirs, d, name), { recursive: true }); fs.writeFileSync(path.join(dirs, d, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${body} (used to check which copy wins)\n---\n${body}\n`) }
mk('bundled', 'watch', 'bundled copy'); mk('bundled', 'only-bundled', 'only here'); mk('starter', 'watch', 'starter copy')
fs.mkdirSync(path.join(dirs, 'bundled', 'broken')); fs.writeFileSync(path.join(dirs, 'bundled', 'broken', 'SKILL.md'), '---\nname: broken\n---\nno description')
const two = buildLibrary({ bundledDir: path.join(dirs, 'bundled'), starterDir: path.join(dirs, 'starter') })
assert.strictEqual(two.lib.get('watch').body, 'starter copy', 'a later folder replaces a skill with the same name')
assert.ok(two.lib.get('only-bundled') && two.lib.get('only-bundled').unlisted && !two.lib.index().includes('only-bundled'))
assert.ok(two.lib.get('watch') && !two.lib.get('watch').unlisted, 'a replaced skill is listed again')
assert.strictEqual(two.errors.length, 1, 'one bad file is reported and skipped, not fatal'); assert.match(two.errors[0], /broken/)
const wsf = skillFile({ name: 'watch', description: 'workspace copy of watch', body: 'ws', source: 'x', sha256: 'a'.repeat(64) })
const wsCopy = skillsFromFiles([{ path: wsf.path, text: wsf.content }]).lib
assert.strictEqual((await resolveSkill('watch a video', { installed: wsCopy, library: lib })).where, 'installed', 'the workspace is asked first')
fs.rmSync(dirs, { recursive: true, force: true })
// the rules tell the model the unlisted skills exist and that their tools may be missing
assert.match(SKILL_RULES, /not listed below/); assert.match(SKILL_RULES, /find_skill/); assert.match(SKILL_RULES, /may not be installed in this sandbox/)
// the real agent process builds its library through buildLibrary with the bundled folder
assert.match(fs.readFileSync(path.join(AGENTS, 'index.js'), 'utf8'), /buildLibrary\(\{ bundledDir: path\.join\(here, 'src\/pack-skills'\)/, 'index.js gives the agent the bundled skills')
// the four skills that need tools the standard sandbox lacks say so, and how to behave when the tool is missing
const body = n => bundled.get(n).body
assert.match(body('headless-chromium-checks'), /which chromium/); assert.match(body('headless-chromium-checks'), /Do not report a page as checked when it was not/); assert.match(body('headless-chromium-checks'), /not shared back/)
assert.match(body('multimedia-processing'), /which ffmpeg ffprobe/); assert.match(body('multimedia-processing'), /Never claim to have watched, heard or converted/); assert.match(body('multimedia-processing'), /not shared back/)
assert.match(body('watch'), /which ffmpeg ffprobe yt-dlp/); assert.match(body('watch'), /Do not describe a video you did not watch/); assert.match(body('watch'), /needs an approval/)
assert.match(body('fullstack-vite-supabase'), /no Supabase CLI and no Supabase credentials/); assert.match(body('fullstack-vite-supabase'), /start_project/); assert.match(body('fullstack-vite-supabase'), /Node 20/)
assert.match(body('stylistic-presentation'), /\{\{image:chart\.svg\|big\}\}/); assert.match(body('stylistic-presentation'), /PNG a command makes is not shared back/)
// the run_command tool says what a command's changes do not do
const runDesc = asOpenAITools(false, false).find(t => t.function.name === 'run_command').function.description
assert.match(runDesc, /use delete_file/); assert.match(runDesc, /binary files/); assert.match(runDesc, /over 200 KB/)

// ---------- 2. delete_file on a real room ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-abil-srv-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort()
const srv = spawn('node', [path.join(AGENTS, '../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' })
const peers = []
let n = 0
try {
  await wait(800)
  const join = (name, token) => { const r = joinRoom({ server: `ws://127.0.0.1:${PORT}`, room: 'abil', token, name, color: '#0aa', model: 'scripted' }); peers.push(r); return r }
  const agent = join('coder', 'tok-c'); const alice = join('alice', 'tok-a')
  await Promise.race([Promise.all([agent.ready, alice.ready]), wait(20000).then(() => { throw new Error('could not join the room on the test server') })])
  const has = p => agent.files.has(p)
  const seed = (...paths) => paths.forEach(p => agent.write(p, `content of ${p}\n`))
  const scripted = steps => { const seen = []; let i = 0; return { seen, lastUsage: null, modelFor: () => 'scripted', async * complete ({ messages }) { seen.push(messages); const s = steps[i++] || { text: 'done' }; if (s.text) yield { text: s.text }; yield { done: true, toolCalls: (s.calls || []).map((c, k) => ({ id: `c${i}${k}`, name: c[0], args: c[1] })) } } } }
  // run one scripted turn; a person (alice) answers every approval card from `decisions` in order; returns the cards that were shown, the tool notes and the tool's JSON result
  async function act (calls, { mode = 'manual', remote = false, decisions = [] } = {}) {
    agent.settings.set('agentMode', mode)
    const from = agent.chat.length; const llm = scripted([{ calls }, { text: 'ok' }]); const cards = []; let over = false
    const watcher = (async () => {
      while (!over) {
        for (const m of alice.chat.toArray()) {
          if (m.get('role') !== 'approval' || m.get('status') !== 'pending' || cards.some(c => c.id === m.get('id'))) continue
          const verdict = decisions.shift() || 'none'
          cards.push({ id: m.get('id'), kind: m.get('kind'), summary: m.get('text').toString(), detail: m.get('detail'), verdict })
          alice.doc.transact(() => { m.set('status', verdict === 'approve' ? 'approved' : 'denied'); m.set('decidedBy', 'alice') })
        }
        await wait(40)
      }
    })()
    await respond({ room: agent, llm, trigger: 't' + (++n), runner: { remote, label: remote ? 'a remote machine' : 'sandbox' } })
    over = true; await watcher
    const notes = agent.chat.toArray().slice(from).filter(m => m.get('role') === 'tool').map(m => m.get('text').toString())
    const last = llm.seen[1] ? llm.seen[1].filter(m => m.role === 'tool').pop() : null
    return { cards, notes, result: last ? JSON.parse(last.content) : null }
  }
  const del = (p, recursive) => [['delete_file', recursive === undefined ? { path: p } : { path: p, recursive }]]
  const provenance = () => agent.provenance.toArray().map(m => `${m.get('by')}: ${m.get('summary')}`)

  // manual: a card first; denied leaves the file, approved deletes it, and the change is on the record
  seed('a.txt')
  let r = await act(del('a.txt'), { mode: 'manual', decisions: ['deny'] })
  assert.strictEqual(r.cards.length, 1); assert.strictEqual(r.cards[0].kind, 'delete'); assert.strictEqual(r.cards[0].summary, 'Delete a.txt')
  assert.ok(has('a.txt'), 'denied: the file is still there'); assert.match(r.notes.join('\n'), /delete of a\.txt not applied: denied by alice/)
  assert.ok(!provenance().includes('coder: deleted a.txt'))
  r = await act(del('a.txt'), { mode: 'manual', decisions: ['approve'] })
  assert.strictEqual(r.cards.length, 1); assert.ok(!has('a.txt'), 'approved: the file is gone'); assert.strictEqual(r.result.ok, true)
  assert.ok(provenance().includes('coder: deleted a.txt'), 'who deleted what is recorded')

  // a folder: without recursive nothing is removed (and the card does not say "and contents"); with it, only that folder goes, not look-alike names
  seed('src/a.js', 'src/b.js', 'src2/c.js', 'srcx.js')
  r = await act(del('src'), { mode: 'manual', decisions: ['approve'] })
  assert.strictEqual(r.cards[0].summary, 'Delete src'); assert.match(r.result.error, /no such file or directory/)
  assert.ok(['src/a.js', 'src/b.js', 'src2/c.js', 'srcx.js'].every(has), 'a folder is not deleted without recursive')
  r = await act(del('src', true), { mode: 'manual', decisions: ['approve'] })
  assert.match(r.cards[0].summary, /^Delete src \(and contents\)$/); assert.match(r.notes.join('\n'), /deleted src \(2 files\)/)
  assert.ok(!has('src/a.js') && !has('src/b.js'), 'the folder is gone')
  assert.ok(has('src2/c.js') && has('srcx.js'), 'a folder with a similar name is not touched')
  r = await act(del('src2/', true), { mode: 'manual', decisions: ['approve'] })
  assert.ok(!has('src2/c.js') && has('srcx.js'), 'a trailing slash works')
  assert.ok(provenance().includes('coder: deleted src/ (2 files)'))

  // paths that leave the workspace or are not plain names are refused after the card (no card at all in bypass), and nothing else changes
  for (const bad of ['../outside.txt', 'a b.txt', '..', '']) {
    r = await act(del(bad, true), { mode: 'bypass' })
    assert.strictEqual(r.cards.length, 0); assert.strictEqual(r.result.error, 'bad path', 'refused: ' + JSON.stringify(bad)); assert.deepStrictEqual(agent.list(), ['srcx.js'])
  }

  // plan mode: nothing may change and nobody is asked
  r = await act(del('srcx.js'), { mode: 'plan' })
  assert.strictEqual(r.cards.length, 0); assert.ok(has('srcx.js')); assert.match(r.notes.join('\n'), /plan mode/)
  // bypass on the sandbox: no card; the file goes
  r = await act(del('srcx.js'), { mode: 'bypass' })
  assert.strictEqual(r.cards.length, 0); assert.ok(!has('srcx.js'))
  // bypass never applies on someone else's machine: it asks again
  seed('far.txt')
  r = await act(del('far.txt'), { mode: 'bypass', remote: true, decisions: ['deny'] })
  assert.strictEqual(r.cards.length, 1, 'bypass on a remote machine still asks'); assert.ok(has('far.txt'))
  // somebody is working in the file: the card says so, in every mode including bypass
  alice.claims.set('far.txt', { by: 'alice', ai: false, since: Date.now() })
  await until(() => agent.claimedByOther('far.txt'), 'alice\'s claim reaches the agent')
  r = await act(del('far.txt'), { mode: 'bypass', decisions: ['deny'] })
  assert.strictEqual(r.cards.length, 1); assert.match(r.cards[0].summary, /^alice is working on far\.txt right now\. Delete anyway\? Delete far\.txt$/); assert.ok(has('far.txt'))
  r = await act(del('far.txt'), { mode: 'bypass', decisions: ['approve'] })
  assert.strictEqual(r.cards.length, 1); assert.ok(!has('far.txt'), 'approved even though alice had it')
  console.log('abilities tests passed: bundled skills reachable and cheap, honest skill notes, run_command wording, delete_file (file, folder, similar names, bad paths, plan, bypass, remote, claims)')
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally {
  for (const p of peers) { try { p.destroy() } catch {} }
  srv.kill(); setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(process.exitCode || 0) }, 300)
}
