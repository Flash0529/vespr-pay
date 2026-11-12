import { fileStore } from '../../app/file-store.js'
// Real client and Yjs; only the network provider is replaced. No server/browser/filesystem writes by the client.
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { createClient } from '../../app/vespr-client.js'
import { planCreate, planRename } from '../../app/pathops.js'

class OfflineProvider {
  constructor (server, room, doc) {
    doc.getMap("settings").set("fileStoreVersion", 1)
    this.awareness = { setLocalStateField () {}, on () {}, getStates: () => new Map() }
  }
  on () {}
  once (event, fn) { if (event === 'sync') queueMicrotask(fn) }
  destroy () {}
}
const clients = []
async function client (entries = {}) {
  const c = createClient({ server: 'ws://offline.invalid', room: 'synthetic-review', token: 'synthetic-only', name: 'reviewer', deps: { Y, WebsocketProvider: OfflineProvider } })
  clients.push(c); await c.ready
  for (const [p, value] of Object.entries(entries)) {
    const t = new Y.Text(); fileStore(c.doc).set(p, t)
    t.insert(0, value, { by: 'synthetic-author', ai: true, model: 'synthetic' })
  }
  return c
}
const snapshot = c => ({ files: [...fileStore(c.doc)].map(([p, t]) => [p, t.toDelta()]), history: c.history() })
const results = []
async function check (name, fn) {
  try { await fn(); results.push({ name, pass: true }) }
  catch (e) { results.push({ name, pass: false, error: e.message }) }
}

await check('planner rejects folder rename onto an existing file', () => {
  assert.equal(planRename(['src/a.py', 'dest'], 'src', 'dest').ok, false)
})
await check('planner resolves case-insensitive folder source consistently', () => {
  assert.deepEqual(planRename(['src/a.py'], 'SRC', 'renamed').moves, [['src/a.py', 'renamed/a.py']])
})
await check('planner validates the parent path before create', () => {
  assert.equal(planCreate([], '../outside', 'a.py', 'file').ok, false)
})
await check('planner counts the folder marker in depth and path limits', () => {
  assert.equal(planCreate([], '', Array(12).fill('d').join('/'), 'folder').ok, false)
})
await check('planner counts the folder marker in the 300 character limit', () => {
  const name = 'a'.repeat(120) + '/' + 'b'.repeat(120) + '/' + 'c'.repeat(57)
  assert.equal(name.length, 299); assert.equal(planCreate([], '', name, 'folder').ok, false)
})
await check('planner resolves case-insensitive file source to the real key', () => {
  assert.deepEqual(planRename(['a.py'], 'A.PY', 'b.py').moves, [['a.py', 'b.py']])
})
await check('planner rejects a destination subtree blocked by a file', () => {
  assert.equal(planRename(['src/nested/a.py', 'dest/nested'], 'src', 'dest').ok, false)
})
await check('client rejects duplicate rename destinations without mutation', async () => {
  const c = await client({ 'a.py': 'A', 'b.py': 'B' }); const before = snapshot(c)
  assert.throws(() => c.renamePaths([['a.py', 'c.py'], ['b.py', 'c.py']]))
  assert.deepEqual(snapshot(c), before)
})
await check('client rejects duplicate rename sources without mutation', async () => {
  const c = await client({ 'a.py': 'A' }); const before = snapshot(c)
  assert.throws(() => c.renamePaths([['a.py', 'b.py'], ['a.py', 'c.py']]))
  assert.deepEqual(snapshot(c), before)
})
await check('client rejects case-folded duplicate targets without mutation', async () => {
  const c = await client({ 'a.py': 'A', 'b.py': 'B' }); const before = snapshot(c)
  assert.throws(() => c.renamePaths([['a.py', 'c.py'], ['b.py', 'C.PY']]))
  assert.deepEqual(snapshot(c), before)
})
await check('client rejects a batch whose destinations conflict as file and folder', async () => {
  const c = await client({ 'a.py': 'A', 'b.py': 'B' }); const before = snapshot(c)
  assert.throws(() => c.renamePaths([['a.py', 'dest'], ['b.py', 'dest/b.py']]))
  assert.deepEqual(snapshot(c), before)
})
await check('client rejects malformed rename entries before any mutation', async () => {
  const c = await client({ 'a.py': 'A' }); const before = snapshot(c)
  for (const entry of [null, 'ab', ['a.py'], ['a.py', 'b.py', 'extra']]) {
    assert.throws(() => c.renamePaths([entry])); assert.deepEqual(snapshot(c), before)
  }
})
await check('client rejects a file/folder collision from a folder rename', async () => {
  const c = await client({ 'src/a.py': 'A', dest: 'B' }); const before = snapshot(c)
  assert.throws(() => c.renamePaths([['src/a.py', 'dest/a.py']]))
  assert.deepEqual(snapshot(c), before)
})
await check('client rejects a case-insensitive create collision', async () => {
  const c = await client({ 'a.py': 'A' }); const before = snapshot(c)
  assert.throws(() => c.createFile('A.PY')); assert.deepEqual(snapshot(c), before)
})
await check('client rejects create under an existing file', async () => {
  const c = await client({ dest: 'B' }); const before = snapshot(c)
  assert.throws(() => c.createFile('dest/a.py')); assert.deepEqual(snapshot(c), before)
})
await check('client rejects create at an existing folder path', async () => {
  const c = await client({ 'dest/a.py': 'A' }); const before = snapshot(c)
  assert.throws(() => c.createFile('dest')); assert.deepEqual(snapshot(c), before)
})
await check('client rejects trailing dots and reserved user-created marker names', async () => {
  const c = await client(); const before = snapshot(c)
  for (const p of ['ends.', 'dir./a.py', '.keep', 'dir/.KEEP']) assert.throws(() => c.createFile(p))
  assert.deepEqual(snapshot(c), before)
})
await check('client rejects rename case collision without mutation', async () => {
  const c = await client({ 'a.py': 'A', 'b.py': 'B' }); const before = snapshot(c)
  assert.throws(() => c.renamePaths([['a.py', 'B.PY']])); assert.deepEqual(snapshot(c), before)
})
await check('client keeps swaps and authorship intact', async () => {
  const c = await client({ 'a.py': 'A', 'b.py': 'B' })
  assert.equal(c.renamePaths([['a.py', 'b.py'], ['b.py', 'a.py']]), 2)
  assert.equal(c.read('a.py'), 'B'); assert.equal(c.read('b.py'), 'A')
  assert.equal(fileStore(c.doc).get('b.py').toDelta()[0].attributes.by, 'synthetic-author')
})
await check('client still respects another editor claim', async () => {
  const c = await client({ 'a.py': 'A' }); c.doc.getMap('claims').set('a.py', { by: 'other', since: Date.now() })
  const before = snapshot(c); assert.throws(() => c.renamePaths([['a.py', 'b.py']]), /other is editing/)
  assert.deepEqual(snapshot(c), before)
})
await check('client still supports ordinary create/delete and case-only rename', async () => {
  const c = await client(); c.createFolder('assets'); c.createFile('assets/a.py')
  c.renamePaths([['assets/a.py', 'assets/A.py']]); assert.equal(c.read('assets/A.py'), '')
  c.deletePaths(['assets/A.py', 'assets/.keep']); assert.deepEqual(c.get().files, [])
})


for (const c of clients) c.destroy()
assert.equal(results.filter(r => !r.pass).length, 0, JSON.stringify(results.filter(r => !r.pass)))
console.log(`fileops safety tests passed (${results.length})`)
