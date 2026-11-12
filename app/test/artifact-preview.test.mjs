import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext, Script } from 'node:vm'
import { artifactDocument, isHtmlArtifact, MAX_HTML_BYTES, ARTIFACT_SANDBOX } from '../artifact-preview.js'

const source = readFileSync(new URL('../prototype.html', import.meta.url), 'utf8')
const start = source.indexOf('function crClick(e){')
const end = source.indexOf('\n// Buying more usage', start)
assert.ok(start >= 0 && end > start)

test('every inline app script parses before the UI can start', () => {
  const blocks = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/type=["'](?:importmap|application\/json)["']/i.test(match[0].split('>')[0]))
  assert.ok(blocks.length >= 2)
  for (const block of blocks) assert.doesNotThrow(() => new Script(block[1]))
})
test('agent memory helper is globally callable and preserves existing notes', () => {
  const section = source.slice(source.indexOf('function agentPanel(a){'), source.indexOf('state.pins = (() =>'))
  const context = createContext({state:{activeProject:'Fixture'},agentList:()=>[{id:'coder',name:'A & B',role:'Coder'}]})
  runInContext(section, context)
  assert.equal(typeof context.getAgentMemory, 'function')
  const text = context.getAgentMemory('coder')
  assert.match(text, /A & B/)
  assert.match(text, /No task recorded yet/)
  context.state.fsStorage['project:.agents/coder/MEMORY.md'] = 'Existing operator notes'
  assert.equal(context.getAgentMemory('coder'), 'Existing operator notes')
})

function clickFile (where, name, kind = 'code') {
  const calls = []
  const card = { dataset: { ftype: where, fkey: name, fname: name, fkind: kind } }
  const button = { closest: () => card }
  const target = { closest: selector => selector === '[data-fopen]' ? button : null }
  const context = createContext({
    crPreview: ds => calls.push(['preview', ds.fkey]),
    crOpenRoom: name => calls.push(['source', name]),
    crSave: ds => calls.push(['download', ds.fkey]),
    CR: { fileKind: () => kind },
    document: {}, console
  })
  runInContext(source.slice(start, end), context)
  context.crClick({ target })
  return calls
}

test('View on a room HTML artifact opens preview instead of the editor', () => {
  assert.deepEqual(clickFile('room', 'counter.html', 'html'), [['preview', 'counter.html']])
})
test('View on an uploaded HTML file opens preview instead of downloading', () => {
  assert.deepEqual(clickFile('up', 'page.htm'), [['preview', 'page.htm']])
})
test('non-HTML room files preserve the existing source path', () => {
  assert.deepEqual(clickFile('room', 'main.py'), [['source', 'main.py']])
})
test('only HTML files or explicitly typed HTML artifacts select the renderer', () => {
  assert.equal(isHtmlArtifact('PAGE.HTML'), true)
  assert.equal(isHtmlArtifact('widget', 'html'), true)
  assert.equal(isHtmlArtifact('program.js'), false)
  assert.equal(isHtmlArtifact(null), false)
})
test('preview policy precedes content, denies app-origin access and limits external resources', () => {
  const result = artifactDocument('<h1>fixture</h1><script>window.fixture=true</script>')
  assert.ok(result.indexOf('Content-Security-Policy') < result.indexOf('<h1>fixture'))
  assert.match(result, /connect-src 'none'/)
  assert.match(result, /base-uri 'none'/)
  assert.match(result, /form-action 'none'/)
  assert.equal(ARTIFACT_SANDBOX, 'allow-scripts')
  assert.equal(ARTIFACT_SANDBOX.includes('allow-same-origin'), false)
})
test('binary or oversized content is refused before rendering', () => {
  assert.throws(() => artifactDocument('binary\0text'), /not HTML text/)
  assert.throws(() => artifactDocument('x'.repeat(MAX_HTML_BYTES + 1)), /too large/)
})
