const { fileStore } = require('../lib/file-store.cjs')
// Starts the VESPR server on a spare port with a temp token file and checks two clients converge,
// that awareness (cursors/presence) crosses between them, and that bad tokens are refused.
const { spawn } = require('node:child_process')
const net = require('node:net')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const assert = require('node:assert'); const WebSocket = require('ws'); const Y = require('yjs')
const { WebsocketProvider } = require('y-websocket')
const { applyChangesToYText } = require('../lib/binding')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murmio-test-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\nbob:tok-b\n')
const wait = ms => new Promise(r => setTimeout(r, ms))
const getFreePort = async () => {
  for (let p = 9450 + Math.floor(Math.random() * 50), i = 0; i < 50; i++, p = 9450 + ((p - 9450 + 1) % 50)) {
    const available = await new Promise(resolve => {
      const probe = net.createServer().once('error', () => resolve(false))
      probe.listen(p, '127.0.0.1', () => probe.close(() => resolve(true)))
    })
    if (available) return p
  }
  throw new Error('no free test port in 9450-9499')
}
;(async () => {
  const PORT = await getFreePort()
  const srv = spawn('node', [path.join(__dirname, '../../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' })
  const client = (token) => { const d = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, 'testroom', d, { WebSocketPolyfill: WebSocket, params: { token }, disableBc: true }); return { d, p } }
  try {
    await wait(800)
    const a = client('tok-a'); const b = client('tok-b'); const bad = client('nope')
    for (let i = 0; i < 40; i++) {
      if (a.p.synced && b.p.synced) break
      await wait(100)
    }
    assert(a.p.synced && b.p.synced, 'clients should sync')
    assert(!bad.p.synced, 'bad token must not sync')
    a.p.awareness.setLocalStateField('user', { name: 'alice', isAgent: false })
    b.p.awareness.setLocalStateField('user', { name: 'agent-1', isAgent: true })
    const t = new Y.Text(); t.insert(0, 'print("hi")\n'); fileStore(a.d).set('src/main.py', t)
    for (let i = 0; i < 40; i++) {
      if (fileStore(b.d).get('src/main.py')) break
      await wait(100)
    }
    const tb = fileStore(b.d).get('src/main.py')
    assert.strictEqual(tb.toString(), 'print("hi")\n')
    applyChangesToYText(tb, [{ rangeOffset: 12, rangeLength: 0, text: '# agent was here\n' }], 'local') // bob/agent edits
    applyChangesToYText(t, [{ rangeOffset: 0, rangeLength: 0, text: '# alice\n' }], 'local')             // alice edits at the same time
    await wait(500)
    assert.strictEqual(t.toString(), tb.toString(), 'text converged')
    const names = [...a.p.awareness.getStates().values()].map(s => s.user && s.user.name).sort()
    assert.deepStrictEqual(names, ['agent-1', 'alice'])
    await wait(800)
    const exported = fs.readFileSync(path.join(dir, 'testroom', 'tree', 'src', 'main.py'), 'utf8')
    assert.strictEqual(exported, t.toString(), 'server exported the file to disk')
    // persistence: restart the server on the same data dir; a fresh client must still see the file
    a.p.destroy(); b.p.destroy(); bad.p.destroy(); srv.kill(); await wait(500)
    const srv2 = spawn('node', [path.join(__dirname, '../../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' })
    await wait(800)
    const c = client('tok-a')
    for (let i = 0; i < 40; i++) {
      if (c.p.synced && fileStore(c.d).get('src/main.py')) break
      await wait(100)
    }
    const tc = fileStore(c.d).get('src/main.py')
    assert(tc, 'synced file present after restart')
    assert.strictEqual(tc.toString(), t.toString(), 'document survived a server restart')
    c.p.destroy(); srv2.kill()
    console.log('integration tests passed:', JSON.stringify(exported))
  } catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); setTimeout(() => process.exit(process.exitCode || 0), 200) }
})()
