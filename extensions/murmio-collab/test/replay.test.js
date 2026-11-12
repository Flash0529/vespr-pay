// Replay against a real server: make edits, chat and cursor moves, fetch the log over HTTP, and rebuild the past.
const { spawn } = require('node:child_process')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const assert = require('node:assert'); const net = require('node:net'); const WebSocket = require('ws'); const Y = require('yjs')
const { WebsocketProvider } = require('y-websocket')
const { applyChangesToYText } = require('../lib/binding')
const { parseLog, Replay } = require('../lib/replay')
const { fileStore } = require('../lib/file-store.cjs')

async function getFreePort () {
  for (let p = 9450 + Math.floor(Math.random() * 50), i = 0; i < 50; i++, p = 9450 + ((p - 9450 + 1) % 50)) {
    const available = await new Promise(resolve => {
      const probe = net.createServer().once('error', () => resolve(false))
      probe.listen(p, '127.0.0.1', () => probe.close(() => resolve(true)))
    })
    if (available) return p
  }
  throw new Error('no free test port in 9450-9499')
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-replay-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\n')
let PORT
let srv
const wait = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  try {
    PORT = await getFreePort()
    srv = spawn('node', [path.join(__dirname, '../../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' })
    await wait(800)
    const d = new Y.Doc()
    const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'r1', d, { WebSocketPolyfill: WebSocket, params: { token: 'tok-a' }, disableBc: true })
    await new Promise(r => p.once('sync', r))
    p.awareness.setLocalStateField('user', { name: 'alice', color: 'red', isAgent: false })
    const t = new Y.Text(); t.insert(0, 'one\n', { by: 'import' }); fileStore(d).set('a.txt', t)
    await wait(300)
    p.awareness.setLocalStateField('cursor', { file: 'a.txt', anchor: Y.createRelativePositionFromTypeIndex(t, 2), head: Y.createRelativePositionFromTypeIndex(t, 2) })
    await wait(300)
    applyChangesToYText(t, [{ rangeOffset: 4, rangeLength: 0, text: 'two\n' }], 'local', { by: 'alice', t: 1 })
    const m = new Y.Map(); const tx = new Y.Text()
    d.transact(() => { m.set('id', 'c1'); m.set('ts', Date.now()); m.set('author', 'alice'); m.set('role', 'user'); m.set('text', tx); d.getArray('chat').push([m]); tx.insert(0, 'hello team') })
    await wait(300)
    applyChangesToYText(t, [{ rangeOffset: 8, rangeLength: 0, text: 'three\n' }], 'local', { by: 'alice', t: 1 })
    await wait(900) // let the server flush
    const bad = await fetch(`http://127.0.0.1:${PORT}/api/log/r1`); assert.strictEqual(bad.status, 401, 'log needs a token')
    const res = await fetch(`http://127.0.0.1:${PORT}/api/log/r1`, { headers: { Authorization: 'Bearer tok-a' } }); assert.strictEqual(res.status, 200)
    const records = parseLog(Buffer.from(await res.arrayBuffer()))
    assert(records.length >= 5, 'log has records: ' + records.length)
    assert.strictEqual(records[0].kind, 0, 'starts with the base state')
    const rp = new Replay(records)
    const last = rp.frame(records.length - 1, 'a.txt')
    assert.strictEqual(last.text, 'one\ntwo\nthree\n'); assert.strictEqual(last.chat.length, 1); assert.strictEqual(last.chat[0].text, 'hello team')
    assert.deepStrictEqual(last.spans.map(s => s.attrs.by), ['import', 'alice'], 'authorship survives replay (consecutive alice edits merge)')
    assert.strictEqual(last.cursors.length, 1); assert.strictEqual(last.cursors[0].name, 'alice'); assert.strictEqual(last.cursors[0].index, 2)
    // go back in time: before alice typed anything
    const early = rp.frame(records.findIndex(r => r.kind === 1), 'a.txt') // first document update after the base
    assert.ok(early.text.length < last.text.length, 'earlier frame has less text')
    const mid = rp.frame(records.length - 1, 'a.txt'); assert.strictEqual(mid.text, last.text, 'seeking forward again works')
    assert.strictEqual(new Replay(records).frame(0, 'a.txt').files.length, 0, 'the very first frame is the empty base')
    fileStore(d).rename([['a.txt', 'renamed.txt']]); t.insert(t.length, 'after rename\n', { by: 'alice' })
    await wait(600)
    const updated = await fetch(`http://127.0.0.1:${PORT}/api/log/r1`, { headers: { Authorization: 'Bearer tok-a' } })
    const afterRecords = parseLog(Buffer.from(await updated.arrayBuffer()))
    const after = new Replay(afterRecords).frame(afterRecords.length - 1, 'renamed.txt')
    assert.deepStrictEqual(after.files, ['renamed.txt']); assert.strictEqual(after.text, 'one\ntwo\nthree\nafter rename\n')
    assert.strictEqual(after.cursors.length, 1, 'relative cursor survives a renamed file even with its old presence label')
    console.log(`replay tests passed (${afterRecords.length} records)`)
    p.destroy()
  } catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); setTimeout(() => process.exit(), 200) }
})()
