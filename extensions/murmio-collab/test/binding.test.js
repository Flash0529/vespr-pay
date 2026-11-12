const assert = require('node:assert')
const Y = require('yjs')
const { applyChangesToYText, deltaToEdits } = require('../lib/binding')

// apply VS Code style changes, then replay the Y.Text delta into a plain string and compare
function applyEdits (text, edits) {
  return [...edits].sort((a, b) => b.start - a.start).reduce((t, e) => t.slice(0, e.start) + e.text + t.slice(e.end), text)
}
const a = new Y.Doc(); const b = new Y.Doc()
a.on('update', u => Y.applyUpdate(b, u)); b.on('update', u => Y.applyUpdate(a, u))
const ta = a.getText('t'); const tb = b.getText('t')
ta.insert(0, 'hello world')
let mirror = 'hello world' // what B's VS Code document holds
tb.observe(ev => { mirror = applyEdits(mirror, deltaToEdits(ev.delta)) })
applyChangesToYText(ta, [{ rangeOffset: 0, rangeLength: 5, text: 'HOWDY' }, { rangeOffset: 6, rangeLength: 5, text: 'Pi' }], 'local')
assert.strictEqual(ta.toString(), 'HOWDY Pi')
assert.strictEqual(tb.toString(), 'HOWDY Pi')
assert.strictEqual(mirror, 'HOWDY Pi')
applyChangesToYText(ta, [{ rangeOffset: 5, rangeLength: 0, text: '!!' }], 'local')
assert.strictEqual(mirror, 'HOWDY!! Pi')
// concurrent edits converge
const a2 = new Y.Doc(); const b2 = new Y.Doc()
const x = a2.getText('t'); const y = b2.getText('t')
x.insert(0, 'abc'); Y.applyUpdate(b2, Y.encodeStateAsUpdate(a2))
x.insert(1, 'X'); y.insert(2, 'Y') // offline
Y.applyUpdate(b2, Y.encodeStateAsUpdate(a2)); Y.applyUpdate(a2, Y.encodeStateAsUpdate(b2))
assert.strictEqual(x.toString(), y.toString())
console.log('binding tests passed:', JSON.stringify(x.toString()))

// diffEdit: one minimal edit from what the editor holds to the shared text
const { diffEdit } = require('../lib/binding')
const apply = (have, e) => have.slice(0, e.start) + e.text + have.slice(e.end)
for (const [have, want] of [['hello world', 'hello brave world'], ['abc', ''], ['', 'abc'], ['same', 'same'], ['aXbYc', 'aXbc'], ['line1\nline2\n', 'line1\nNEW\nline2\n'], ['aaa', 'aaaa']]) assert.strictEqual(apply(have, diffEdit(have, want)), want, `${have} -> ${want}`)
assert.deepStrictEqual(diffEdit('hello world', 'hello brave world'), { start: 6, end: 6, text: 'brave ' })
console.log('diffEdit tests passed')
