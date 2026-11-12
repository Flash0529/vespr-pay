import assert from 'node:assert/strict'
import * as Y from 'yjs'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileStore } from '../../app/file-store.js'
import { createClient } from '../../app/vespr-client.js'

let count = 0
const t = async (name, fn) => { try { await fn(); count++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const docs = []
function doc () { const d = new Y.Doc(); d.getMap('settings').set('fileStoreVersion', 1); docs.push(d); return d }
function seed (d, path = 'a.py', body = 'base') { const text = new Y.Text(); d.getMap('files').set(path, text); text.insert(0, body, { by: 'original' }); return text }
function sync (a, b) { Y.applyUpdate(a, Y.encodeStateAsUpdate(b)); Y.applyUpdate(b, Y.encodeStateAsUpdate(a)) }
const dump = d => [...fileStore(d)].map(([p, text]) => [p, text.toString()]).sort((a, b) => a[0].localeCompare(b[0]))

await t('legacy files need no destructive migration; rename preserves exact text identity', () => {
  const a = doc(); const text = seed(a); const files = fileStore(a)
  files.rename([['a.py', 'new.py']]); assert.equal(files.get('new.py'), text); assert.equal(files.has('a.py'), false)
  assert.equal(a.getMap('files').get('a.py'), text); assert.equal(text.toDelta()[0].attributes.by, 'original')
})
for (const order of ['rename-first', 'edit-first']) await t('disconnected edit survives rename: ' + order, () => {
  const a = doc(); seed(a); const b = doc(); sync(a, b)
  const before = fileStore(a).get('a.py'); const peer = fileStore(b).get('a.py')
  const caret = Y.createRelativePositionFromTypeIndex(peer, 2)
  if (order === 'rename-first') { fileStore(a).rename([['a.py', 'new.py']]); peer.insert(4, '-peer', { by: 'peer' }) }
  else { peer.insert(4, '-peer', { by: 'peer' }); fileStore(a).rename([['a.py', 'new.py']]) }
  sync(a, b)
  assert.deepEqual(dump(a), [['new.py', 'base-peer']]); assert.deepEqual(dump(a), dump(b))
  assert.equal(fileStore(a).get('new.py'), before)
  assert.equal(Y.createAbsolutePositionFromRelativePosition(caret, b).type, fileStore(b).get('new.py'))
  assert.equal(fileStore(a).get('new.py').toDelta().at(-1).attributes.by, 'peer')
})
await t('simultaneous renames of one file converge without duplicated or detached text', () => {
  const a = doc(); seed(a); const b = doc(); sync(a, b)
  fileStore(a).rename([['a.py', 'b.py']]); fileStore(b).rename([['a.py', 'c.py']])
  fileStore(a).get('b.py').insert(4, '-A'); fileStore(b).get('c.py').insert(0, 'B-')
  sync(a, b); assert.deepEqual(dump(a), dump(b)); assert.equal(fileStore(a).size, 1)
  assert.equal([...fileStore(a).values()][0].toString(), 'B-base-A')
})
await t('concurrent creates at one name retain both texts with an explicit conflict file', () => {
  const a = doc(); const b = doc(); const x = new Y.Text(); const y = new Y.Text()
  fileStore(a).set('new.py', x); x.insert(0, 'A'); fileStore(b).set('new.py', y); y.insert(0, 'B')
  sync(a, b); assert.deepEqual(dump(a), dump(b)); assert.equal(fileStore(a).size, 2)
  assert.deepEqual([...fileStore(a).values()].map(t => t.toString()).sort(), ['A', 'B'])
  assert.equal(fileStore(a).conflicts().length, 1); assert.match(fileStore(a).conflicts()[0].path, /^\.vespr-conflicts\/1\.txt$/)
})
await t('different files concurrently renamed to one path keep both contents', () => {
  const a = doc(); seed(a, 'a.py', 'A'); seed(a, 'b.py', 'B'); const b = doc(); sync(a, b)
  fileStore(a).rename([['a.py', 'dest.py']]); fileStore(b).rename([['b.py', 'dest.py']]); sync(a, b)
  assert.deepEqual(dump(a), dump(b)); assert.deepEqual([...fileStore(a).values()].map(t => t.toString()).sort(), ['A', 'B'])
})
await t('concurrent file versus folder conflict preserves both files without an impossible tree', () => {
  const a = doc(); seed(a, 'a.py', 'A'); seed(a, 'b.py', 'B'); const b = doc(); sync(a, b)
  fileStore(a).rename([['a.py', 'dest']]); fileStore(b).rename([['b.py', 'dest/child.py']]); sync(a, b)
  assert.deepEqual(dump(a), dump(b)); assert.equal(fileStore(a).size, 2); assert.equal(fileStore(a).conflicts().length, 1)
})
await t('a released filename can be reused without stealing the renamed text identity', () => {
  const a = doc(); const old = seed(a); const b = doc(); sync(a, b)
  fileStore(a).rename([['a.py', 'b.py']]); const fresh = new Y.Text(); fileStore(a).set('a.py', fresh); fresh.insert(0, 'new')
  fileStore(b).get('a.py').insert(4, '-old-peer'); sync(a, b)
  assert.equal(fileStore(a).get('b.py'), old); assert.deepEqual(dump(a), [['a.py', 'new'], ['b.py', 'base-old-peer']])
})
await t('folder moves and swaps retain every original object', () => {
  const a = doc(); const x = seed(a, 'src/a.py', 'A'); const y = seed(a, 'src/b.py', 'B'); const s = fileStore(a)
  s.rename([['src/a.py', 'lib/a.py'], ['src/b.py', 'lib/b.py']]); assert.equal(s.get('lib/a.py'), x); assert.equal(s.get('lib/b.py'), y)
  s.rename([['lib/a.py', 'lib/b.py'], ['lib/b.py', 'lib/a.py']]); assert.equal(s.get('lib/b.py'), x); assert.equal(s.get('lib/a.py'), y)
})
await t('delete remains explicit deletion; recreating the path makes a separate file', () => {
  const a = doc(); const old = seed(a); const s = fileStore(a); s.delete('a.py')
  assert.equal(s.size, 0); assert.equal(a.getMap('files').size, 0)
  const fresh = new Y.Text(); s.set('a.py', fresh); assert.notEqual(s.get('a.py'), old)
})
await t('snapshot serialization preserves logical names and shared content', () => {
  const a = doc(); seed(a); fileStore(a).rename([['a.py', 'new.py']]); const b = doc(); Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  assert.deepEqual(dump(b), [['new.py', 'base']]); fileStore(b).get('new.py').insert(4, '-restored'); sync(a, b)
  assert.deepEqual(dump(a), [['new.py', 'base-restored']])
})
await t('metadata observers report old and new logical keys once, never the storage id', () => {
  const a = doc(); seed(a); const s = fileStore(a); const events = []; s.observe(e => events.push([...e.keys]))
  s.rename([['a.py', 'new.py']]); assert.equal(events.length, 1); assert.deepEqual(events[0].map(([p]) => p).sort(), ['a.py', 'new.py'])
})
await t('an occupied conflict folder is never overwritten', () => {
  const a = doc(); seed(a, '.vespr-conflicts/1.txt', 'person'); seed(a, 'a.py', 'A'); seed(a, 'b.py', 'B')
  a.getMap('filePaths').set('a.py', 'same.py'); a.getMap('filePaths').set('b.py', 'same.py')
  assert.equal(fileStore(a).get('.vespr-conflicts/1.txt').toString(), 'person'); assert.equal(fileStore(a).conflicts()[0].path, '.vespr-conflicts-1/1.txt')
})
await t('hostile metadata cannot expose a path outside the workspace', () => {
  const a = doc(); seed(a); a.getMap('filePaths').set('a.py', '../../outside'); const s = fileStore(a)
  assert.deepEqual(dump(a), [['.vespr-conflicts/1.txt', 'base']]); assert.equal(s.conflicts()[0].requested, '../../outside')
})
await t('existing imported spaces and Unicode names stay intact', () => {
  const a = doc(); seed(a, 'docs/design notes.md', 'notes'); seed(a, 'src/café.py', 'code')
  assert.deepEqual(dump(a), [['docs/design notes.md', 'notes'], ['src/café.py', 'code']])
})
await t('malformed null metadata recovers content rather than hiding it', () => {
  const a = doc(); seed(a); a.getMap('filePaths').set('a.py', null)
  assert.deepEqual(dump(a), [['.vespr-conflicts/1.txt', 'base']])
})
await t('an older server keeps legacy creation and refuses unsafe rename', () => {
  const a = doc(); a.getMap('settings').delete('fileStoreVersion'); const s = fileStore(a); const text = new Y.Text()
  s.set('legacy.py', text); text.insert(0, 'legacy'); assert.equal(a.getMap('files').get('legacy.py'), text)
  assert.throws(() => s.rename([['legacy.py', 'renamed.py']]), /updated server/); assert.deepEqual(dump(a), [['legacy.py', 'legacy']])
})
class OfflineProvider {
  constructor (server, room, doc) { doc.getMap('settings').set('fileStoreVersion', 1); this.awareness = { setLocalStateField () {}, on () {}, getStates: () => new Map() } }
  on () {}
  once (event, fn) { if (event === 'sync') queueMicrotask(fn) }
  destroy () {}
}
await t('actual client reports the renamed path when a formerly disconnected edit arrives', async () => {
  const a = createClient({ server: 'ws://offline.invalid', room: 'synthetic', token: 'synthetic', name: 'A', deps: { Y, WebsocketProvider: OfflineProvider } })
  const b = createClient({ server: 'ws://offline.invalid', room: 'synthetic', token: 'synthetic', name: 'B', deps: { Y, WebsocketProvider: OfflineProvider } })
  await Promise.all([a.ready, b.ready]); seed(a.doc); sync(a.doc, b.doc)
  const events = []; a.on('edit', e => events.push(e)); const original = a.fileText('a.py')
  const renames = []; b.on('rename', e => renames.push(e))
  a.provider.awareness.getStates = () => new Map([[99, { user: { name: 'peer', isAgent: true }, cursor: { file: 'a.py', head: Y.createRelativePositionFromTypeIndex(original, 2) } }]])
  a.renamePaths([['a.py', 'new.py']]); b.fileText('a.py').insert(4, '-peer', { by: 'B' }); sync(a.doc, b.doc)
  assert.equal(a.read('new.py'), 'base-peer'); assert.equal(a.fileText('new.py'), original)
  assert.ok(events.some(e => e.file === 'new.py' && e.added === '-peer')); assert.ok(events.every(e => e.file !== 'a.py'))
  assert.deepEqual(renames, [{ moves: [['a.py', 'new.py']], local: false }]); assert.equal(a.get().agents[0].file, 'new.py')
  a.destroy(); b.destroy()
})
await t('CJS extension copy matches the browser source mechanically and behaves identically', () => {
  const esm = fs.readFileSync(new URL('../../app/file-store.js', import.meta.url), 'utf8')
  const cjsURL = new URL('../../extensions/murmio-collab/lib/file-store.cjs', import.meta.url)
  assert.equal(fs.readFileSync(cjsURL, 'utf8'), esm.replace('export function fileStore', 'function fileStore') + '\nmodule.exports = { fileStore }\n')
  const cjs = createRequire(import.meta.url)(cjsURL.pathname); const a = doc(); const text = seed(a)
  cjs.fileStore(a).rename([['a.py', 'cjs.py']]); assert.equal(cjs.fileStore(a).get('cjs.py'), text)
})
await t('many reordered update deliveries preserve text and converge', () => {
  for (let n = 0; n < 30; n++) {
    const a = doc(); seed(a); const b = doc(); sync(a, b)
    const updatesA = []; const updatesB = []; a.on('update', u => updatesA.push(u)); b.on('update', u => updatesB.push(u))
    fileStore(a).rename([['a.py', 'new.py']]); fileStore(a).get('new.py').insert(0, 'A-')
    fileStore(b).get('a.py').insert(4, '-B')
    const ua = [...updatesA]; const ub = [...updatesB]
    for (const u of n % 2 ? ua.reverse() : ua) Y.applyUpdate(b, u)
    for (const u of n % 3 ? ub.reverse() : ub) Y.applyUpdate(a, u)
    sync(a, b); assert.deepEqual(dump(a), [['new.py', 'A-base-B']]); assert.deepEqual(dump(a), dump(b))
  }
})
for (const d of docs) d.destroy()
console.log(`file identity tests passed (${count})`)
