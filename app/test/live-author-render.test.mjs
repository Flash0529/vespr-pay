// Exercises the actual client observer, edit subscription, and editor renderer with owned fixtures.
// DOM/native-editor/provider boundaries are stubs; no browser, network, or model is used.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(process.argv[2] || fileURLToPath(new URL('../../', import.meta.url)))
const html = fs.readFileSync(path.join(root, 'app/prototype.html'), 'utf8')
const client = fs.readFileSync(path.join(root, 'app/vespr-client.js'), 'utf8')
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a)
  assert.ok(a >= 0 && b > a, 'source fixture boundaries must exist')
  return source.slice(a, b)
}
const escapeSource = html.split('\n').find(line => line.startsWith('const esc='))
assert.ok(escapeSource, 'use the production HTML escaper')
const renderer = between(html, 'function ide(){', '\n/* history:')
const editHandler = between(html, 'function handleWorkspaceEdit(e){', '\nasync function connectLive')
const registration = html.split('\n').find(line=>line.includes("liveClient.on('edit',handleWorkspaceEdit)"))
assert.ok(registration, 'actual workspace observer subscribes the reviewed named edit handler')
const subscription = editHandler + '\n' + registration
const observer = between(client, '  function watchFile (p, isNew = false) {', '\n  const text = m => ')

function renderedAuthor(by, created = false) {
  const file = 'fixture.py'
  let body = created ? 'added' : 'seed'
  let observe, edit
  const nodes = { '#tabs': { innerHTML: '' }, '#view': { innerHTML: '', querySelector: () => null } }
  const text = { toString: () => body, get length() { return body.length }, observe: fn => { observe = fn }, toDelta: () => [{ insert: body, attributes: { by, ai: true } }] }
  const state = { view: 'editor', activeFile: file, _treeFile: file, liveDiffs: {}, edit: { phase: 'idle', typed: 0 }, nativeOff: true, openFiles: [], panelOpen: false, cm: null }
  const context = vm.createContext({
    WX:null, state, watched: new WeakSet(), lastText: new Map(), name: 'fixture-person',
    files: { get: p => p === file ? text : null, pathFor: t => t === text ? file : null },
    emitNow: (kind, event) => { assert.equal(kind, 'edit'); edit(event) }, changed: () => {},
    liveClient: { on: (kind, callback) => { assert.equal(kind, 'edit'); edit = callback }, read: () => body },
    followEdit: () => {}, logEvent: () => {}, touchFile: () => {},
    liveSnap: () => ({ files: [file], problems: [], runsEnabled: false }),
    $: selector => nodes[selector] || null,
    ic: () => '', MARK: () => '', followLabel: () => 'Follow', followPressed: () => false,
    nativeOn: () => false, destroyNative: () => {}, syncTermBtn: () => {},
    liveEditorHtml: () => '<div>fixture source</div>', termHtml: () => '',
    document: { getElementById: () => null }, code: [['seed'], ['end']], OLDLINE: 'seed', NEWLINE: 'added'
  })
  vm.runInContext(escapeSource + '\n' + renderer + '\n' + subscription + '\n' + observer, context, { timeout: 1000 })
  context.watchFile(file, created)
  if (!created) {
    body += 'x'
    observe({ delta: [{ retain: 4 }, { insert: 'x', attributes: { by, ai: true } }], transaction: { local: false } })
  }
  const output = nodes['#view'].innerHTML
  const match = /<div class="keepnote">([\s\S]*?)’s edit stays highlighted until you send your next message<\/div>/.exec(output)
  assert.ok(match, 'actual editor must render the persistent edit attribution note')
  return { name: match[1], output, event: state.liveDiffs[file] }
}

const escaped = value => String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const authors = ['Alex', 'A&B', '<img data-review-marker="owned">', '"><svg onload="0">', '</div><script>0</script>', 'Zoë 🧪', 'already &lt; text']
let passed = 0, failed = 0
for (const created of [false, true]) {
  for (const author of authors) {
    try {
      const result = renderedAuthor(author, created)
      assert.equal(result.event.by, author, 'original author metadata remains unchanged')
      assert.equal(result.name, escaped(author), 'author is rendered as text, not markup')
      passed++
    } catch (error) {
      failed++
      console.error(JSON.stringify({ created, author, error: error.message }))
    }
  }
}
for (const author of ['', null, undefined]) {
  try { assert.equal(renderedAuthor(author).name, 'someone'); passed++ } catch (error) { failed++; console.error(error.message) }
}
console.log(JSON.stringify({ passed, failed, scope: 'actual observer + subscription + renderer; stubbed provider/native editor/DOM; no browser execution' }))
if (failed) process.exitCode = 1
