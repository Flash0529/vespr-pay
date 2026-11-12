// net-world: does a VESPR room work for two people on very different networks? Joins, chat both ways, concurrent edits to one file,
// a stretch offline, and (if agents are in the room) one request to the team and its report, all timed, with an observer on the
// server's own network as the reference copy. Each person can sit behind a netsim profile (scripts/netsim.mjs) or a real network.
//   node agents/tools/net-world.mjs --server ws://HOST:PORT --room R --tokens FILE --maya PROFILE|real --dev PROFILE|real [--observer-server ws://...] [--agents] [--out FILE]
// Tokens FILE: lines "name:token" (throwaway test tokens). Exit code 0 only when every check passes.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'
import { fileStore } from '../../app/file-store.js'
const here = path.dirname(fileURLToPath(import.meta.url))
const { startNetsim, PROFILES } = await import(pathToFileURL(path.join(here, '../../scripts/netsim.mjs')).href) // a file:// URL, so it also loads on Windows

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const server = arg('server'); const room = arg('room', 'net-' + Date.now().toString(36)); const out = arg('out', '')
const tokens = Object.fromEntries(fs.readFileSync(arg('tokens'), 'utf8').split('\n').filter(Boolean).map(l => l.split(':').map(s => s.trim())))
const profiles = { maya: arg('maya', 'lan'), dev: arg('dev', 'lan') }
const A = arg('a-name', 'maya'); const B = arg('b-name', 'dev') // the two people of this duo (a second duo can share the room)
const wantAgents = process.argv.includes('--agents')
const wait = ms => new Promise(r => setTimeout(r, ms))
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) }
const until = async (fn, ms, step = 50) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return Date.now() - t; await wait(step) } return null }
const result = { duo: `${A}+${B}`, room, server: server.replace(/\/\/[^@]*@/, '//'), profiles: {}, checks: {}, at: new Date().toISOString() }
const sims = []

async function join (name, profile) {
  let url = server
  if (profile !== 'real') {
    const [host, port] = server.replace(/^wss?:\/\//, '').split(':')
    const sim = await startNetsim({ listen: 0, target: `${host}:${port}`, profile, onDrop: () => { result.checks[`${name}_drops`] = (result.checks[`${name}_drops`] || 0) + 1 } })
    sims.push(sim); url = `ws://127.0.0.1:${sim.port}`
    result.profiles[name] = `${profile}: ${PROFILES[profile].label}`
  } else result.profiles[name] = 'real network (no simulation)'
  const doc = new Y.Doc(); const t0 = Date.now()
  const provider = new WebsocketProvider(url + '/ws', room, doc, { WebSocketPolyfill: WebSocket, params: { token: tokens[name] }, disableBc: true })
  provider.awareness.setLocalStateField('user', { name, color: '#888', isAgent: false })
  await new Promise((resolve, reject) => { const to = setTimeout(() => reject(new Error(`${name} could not join in 30 s`)), 30000); provider.once('sync', () => { clearTimeout(to); resolve() }) })
  return { name, doc, provider, files: fileStore(doc), chat: doc.getArray('chat'), joinMs: Date.now() - t0 }
}
const say = (p, text, extra = {}) => { const m = new Y.Map(); const tx = new Y.Text(); tx.insert(0, text); p.doc.transact(() => { m.set('id', `${p.name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`); m.set('ts', Date.now()); m.set('author', p.name); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); for (const [k, v] of Object.entries(extra)) m.set(k, v); p.chat.push([m]) }) }

let failed = false
try {
  const observer = await (async () => { // the reference copy, on the server's own network (no simulation)
    const doc = new Y.Doc(); const provider = new WebsocketProvider((arg('observer-server', server)) + '/ws', room, doc, { WebSocketPolyfill: WebSocket, params: { token: tokens.observer || tokens.maya }, disableBc: true })
    await new Promise(r => provider.once('sync', r)); return { doc, provider, files: fileStore(doc) }
  })()
  if (wantAgents) { // the sample project the demo agents know, seeded from the server's own network
    const sample = path.join(here, '../../sample-project')
    observer.doc.transact(() => { for (const n of fs.readdirSync(sample)) { if (observer.files.get(n)) continue; const x = new Y.Text(); x.insert(0, fs.readFileSync(path.join(sample, n), 'utf8'), { by: 'import' }); observer.files.set(n, x) } })
    observer.doc.getMap('settings').set('agentMode', 'auto')
  }
  const maya = await join(A, profiles.maya); const dev = await join(B, profiles.dev)
  result.checks.join_ms = { maya: maya.joinMs, dev: dev.joinMs }

  // chat both ways: 10 messages each, delivery time measured on one clock (all clients run on this machine)
  const lat = { 'maya->dev': [], 'dev->maya': [] }
  const watch = (who, from, into) => who.chat.observe(ev => { for (const it of ev.changes.added) for (const m of it.content.getContent()) { if (m.get && m.get('netTest') && m.get('author') === from) into.push(Date.now() - m.get('ts')) } }) // only the partner's messages (another duo may share the room)
  watch(dev, A, lat['maya->dev']); watch(maya, B, lat['dev->maya'])
  for (let i = 0; i < 10; i++) { say(maya, `ping ${i} from maya`, { netTest: true }); say(dev, `ping ${i} from dev`, { netTest: true }); await wait(150) }
  await until(() => lat['maya->dev'].length >= 10 && lat['dev->maya'].length >= 10, 30000)
  result.checks.chat = Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, { delivered: `${v.length}/10`, p50_ms: pct(v, 0.5), p95_ms: pct(v, 0.95), max_ms: pct(v, 1) }]))
  if (Object.values(lat).some(v => v.length < 10)) failed = true

  // concurrent edits to one file from both sides, then: do all three copies end up identical, and how fast?
  // unique per run: a reused room must not hand back an old file
  const f = `notes-${room}-${A}-${Date.now().toString(36)}.md`; const t = new Y.Text(); t.insert(0, '# shared notes\n'); observer.files.set(f, t)
  const seenMs = await until(() => maya.files.get(f) && dev.files.get(f), 20000)
  result.checks.new_file_seen = { ms: seenMs, observer: !!observer.files.get(f), [A]: !!maya.files.get(f), [B]: !!dev.files.get(f), [`${B}_connected`]: dev.provider.wsconnected, [`${B}_synced`]: dev.provider.synced }
  if (seenMs === null) throw new Error(`a new file did not reach everyone in 20 s: ${JSON.stringify(result.checks.new_file_seen)}`)
  // insert at a marker boundary (start, end, or right after a ']'), so the check below can find every marker intact
  const spot = s => { const ends = [0, s.length]; for (let i = 0; i < s.length; i++) if (s[i] === ']') ends.push(i + 1); return ends[Math.floor(Math.random() * ends.length)] }
  const typeInto = async (p, n) => { for (let i = 0; i < n; i++) { const x = p.files.get(f); x.insert(spot(x.toString()), `[${p.name}${i}]`, { by: p.name }); await wait(80 + Math.random() * 150) } }
  await Promise.all([typeInto(maya, 30), typeInto(dev, 30)])
  const same = () => { const a = maya.files.get(f).toString(); return a === dev.files.get(f).toString() && a === observer.files.get(f).toString() }
  const convergeMs = await until(same, 30000)
  const text = observer.files.get(f).toString()
  const allThere = [...Array(30).keys()].every(i => text.includes(`[${A}${i}]`) && text.includes(`[${B}${i}]`))
  result.checks.edits = { converged: convergeMs !== null, converge_after_last_edit_ms: convergeMs, all_60_edits_present: allThere }
  if (convergeMs === null || !allThere) failed = true

  // a stretch offline: dev loses the connection for 5 s, keeps typing, comes back
  dev.provider.disconnect()
  for (let i = 0; i < 5; i++) { const x = dev.files.get(f); x.insert(x.length, `[offline${i}]`, { by: 'dev' }); await wait(1000) }
  maya.files.get(f).insert(0, `[${A}-while-${B}-away]`, { by: 'maya' })
  const back = Date.now(); dev.provider.connect()
  const offlineMs = await until(() => same() && observer.files.get(f).toString().includes('[offline4]') && dev.files.get(f).toString().includes(`[${A}-while-${B}-away]`), 30000)
  result.checks.offline = { merged: offlineMs !== null, merge_after_reconnect_ms: offlineMs === null ? null : Date.now() - back }
  if (offlineMs === null) failed = true

  // the team: one request to the top agent, timed until its report reaches maya over her network
  if (wantAgents) {
    const t0 = Date.now(); let report = ''
    say(maya, '@agent delegate to fe: fix the discount bug in cart.py and run the tests')
    const ms = await until(() => { const m = maya.chat.toArray().find(x => x.get('isAgent') && (x.get('ts') || 0) >= t0 && new RegExp(`^@${A} done:`).test(String(x.get('text') || ''))); if (m) report = String(m.get('text')).slice(0, 120); return !!m }, 90000, 200) // only a report sent after this request
    result.checks.agents = { report_reached_maya: ms !== null, ms: ms === null ? null : Date.now() - t0, report }
    if (ms === null) failed = true
  }
  for (const p of [maya, dev, observer]) p.provider.destroy()
} catch (e) { result.error = e.message; result.stack = String(e.stack).split('\n').slice(1, 3).map(s => s.trim()).join(' | '); failed = true }
for (const s of sims) s.close()
result.pass = !failed
console.log(JSON.stringify(result))
if (out) fs.appendFileSync(out, JSON.stringify(result) + '\n')
setTimeout(() => process.exit(failed ? 1 : 0), 300)
