// ai-latency: how long people wait for the built-in AI, measured the way the app asks for it, optionally through a netsim profile.
//   inline suggestions (autofill): POST /api/suggest on the realtime server, fresh cursor contexts (cache misses) and one repeat (cache hit)
//   agent replies: an @mention in chat, timed to the first streamed words and to the finished answer
//   node agents/tools/ai-latency.mjs --server http://HOST:PORT --room R --tokens FILE [--profiles lan,continent,far,mobile] [--suggestions 6] [--replies 2] [--out FILE]
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import { fileURLToPath, pathToFileURL } from 'node:url'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'
const here = path.dirname(fileURLToPath(import.meta.url))
const { startNetsim, PROFILES } = await import(pathToFileURL(path.join(here, '../../scripts/netsim.mjs')).href) // a file:// URL, so it also loads on Windows
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d }
const base = arg('server'); const room = arg('room', 'ai-' + Date.now().toString(36)); const out = arg('out', '')
const tokens = Object.fromEntries(fs.readFileSync(arg('tokens'), 'utf8').split('\n').filter(Boolean).map(l => l.split(':').map(s => s.trim())))
const profiles = arg('profiles', 'lan,continent,far,mobile').split(','); const nSug = Number(arg('suggestions', 6)); const nRep = Number(arg('replies', 2))
const agent = arg('agent', 'coder'); const wait = ms => new Promise(r => setTimeout(r, ms))
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]) }
const stats = xs => ({ n: xs.length, p50_ms: pct(xs, 0.5), p95_ms: pct(xs, 0.95), max_ms: pct(xs, 1) })
const [host, port] = base.replace(/^https?:\/\//, '').split(':')
const result = { room, at: new Date().toISOString(), suggestions: {}, replies: {} }

function post (p, body) { // keep-alive off: every request pays its own connection, like a fresh keystroke pause would
  return new Promise((resolve, reject) => {
    const t = Date.now(); const data = JSON.stringify(body)
    const req = http.request({ host: '127.0.0.1', port: p, path: '/api/suggest', method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: 'Bearer ' + tokens.maya } }, res => {
      let s = ''; res.on('data', c => { s += c }); res.on('end', () => resolve({ ms: Date.now() - t, status: res.statusCode, text: s }))
    })
    req.on('error', reject); req.setTimeout(30000, () => req.destroy(new Error('timeout'))); req.end(data)
  })
}
const contexts = i => ({ file: `shop${i}.py`, language: 'python', prefix: `def total_with_tax_${i}(items, rate):\n    """Sum of price * qty plus ${i}% handling, then tax at rate."""\n    subtotal = `, suffix: '\n    return subtotal\n' })

for (const profile of profiles) {
  const sim = await startNetsim({ listen: 0, target: `${host}:${port}`, profile })
  const times = []; let empty = 0; let errors = 0
  for (let i = 0; i < nSug; i++) {
    try { const r = await post(sim.port, contexts(`${profile}${i}${Date.now() % 1000}`)); if (r.status !== 200) errors++; else { times.push(r.ms); if (!JSON.parse(r.text).text) empty++ } } catch { errors++ }
    await wait(300)
  }
  let hit = null; try { const c = contexts(`${profile}-repeat`); await post(sim.port, c); hit = (await post(sim.port, c)).ms } catch {}
  result.suggestions[profile] = { network: PROFILES[profile].label, fresh: stats(times), empty_suggestions: empty, errors, repeat_cache_hit_ms: hit }
  console.log(`suggestions over ${profile}:`, JSON.stringify(result.suggestions[profile]))
  sim.close()
}

// agent replies: first streamed words and the finished answer, seen over the server's own network
const doc = new Y.Doc(); const provider = new WebsocketProvider(`ws://${host}:${port}/ws`, room, doc, { WebSocketPolyfill: WebSocket, params: { token: tokens.maya }, disableBc: true })
await new Promise(r => provider.once('sync', r)); const chat = doc.getArray('chat')
const asks = ['@' + agent + ' In one sentence: what does a shopping cart total function usually need to handle?', '@' + agent + ' Give me a one-line Python expression for the price after a percent discount.', '@' + agent + ' Name two edge cases for a discount function, briefly.']
const first = []; const full = []
for (let i = 0; i < Math.min(nRep, asks.length); i++) {
  const m = new Y.Map(); const tx = new Y.Text(); tx.insert(0, asks[i]); const t0 = Date.now(); const id = `maya-lat-${i}-${t0}`
  doc.transact(() => { m.set('id', id); m.set('ts', t0); m.set('author', 'maya'); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); chat.push([m]) })
  let firstAt = 0; let doneAt = 0; let lastLen = -1; let stableSince = 0
  for (let k = 0; k < 600 && !doneAt; k++) {
    await wait(100)
    const reply = chat.toArray().find(x => x.get('isAgent') && x.get('role') === 'agent' && x.get('ts') >= t0)
    const len = reply ? String(reply.get('text') || '').length : 0
    if (len && !firstAt) firstAt = Date.now()
    if (len && len === lastLen) { if (!stableSince) stableSince = Date.now(); else if (Date.now() - stableSince > 1500) doneAt = stableSince } else stableSince = 0
    lastLen = len
  }
  if (firstAt) first.push(firstAt - t0); if (doneAt) full.push(doneAt - t0)
  await wait(1500)
}
result.replies = { first_words: stats(first), finished_answer: stats(full) }
console.log('agent replies:', JSON.stringify(result.replies))
provider.destroy()
if (out) fs.appendFileSync(out, JSON.stringify(result) + '\n')
setTimeout(() => process.exit(0), 300)
