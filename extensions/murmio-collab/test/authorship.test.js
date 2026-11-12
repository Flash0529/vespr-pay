const assert = require('node:assert')
const Y = require('yjs')
const { applyChangesToYText, spansOf, spanAt } = require('../lib/binding')

const d = new Y.Doc(); const t = d.getText('t')
t.insert(0, 'def f():\n    pass\n', { by: 'import' })
// shamit types in the middle; an agent inserts a docstring; text stays correct and attribution is per span
applyChangesToYText(t, [{ rangeOffset: 12, rangeLength: 0, text: 'X' }], 'local', { by: 'shamit', t: 100 })
t.insert(9, '    """doc"""\n', { by: 'coder', ai: true, model: 'nemotron', msg: 'm1', t: 105 })
assert.strictEqual(t.toString(), 'def f():\n    """doc"""\n   X pass\n')
const spans = spansOf(t)
const who = off => (spanAt(spans, off) || { attrs: {} }).attrs.by
assert.strictEqual(who(0), 'import')
assert.strictEqual(who(12), 'coder'); assert.strictEqual(spanAt(spans, 12).attrs.msg, 'm1'); assert.strictEqual(spanAt(spans, 12).attrs.ai, true)
assert.strictEqual(who(t.toString().indexOf('X')), 'shamit')
assert.strictEqual(who(t.toString().indexOf('pass')), 'import', 'text after an insert keeps its original author')
// concurrent edits from two replicas keep each author's span after a merge
const a = new Y.Doc(); const b = new Y.Doc(); const ta = a.getText('t'); const tb = b.getText('t')
ta.insert(0, 'hello', { by: 'import' }); Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
ta.insert(0, 'A-', { by: 'alice' }); tb.insert(5, '-B', { by: 'bob' })
Y.applyUpdate(b, Y.encodeStateAsUpdate(a)); Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
assert.strictEqual(ta.toString(), tb.toString())
const m = spansOf(ta); const byAt = o => spanAt(m, o).attrs.by
assert.strictEqual(byAt(0), 'alice'); assert.strictEqual(byAt(ta.toString().indexOf('-B')), 'bob'); assert.strictEqual(byAt(ta.toString().indexOf('hello')), 'import')
// plain insert without attributes still works (backwards compatible)
const c = new Y.Doc().getText('t'); applyChangesToYText(c, [{ rangeOffset: 0, rangeLength: 0, text: 'x' }], 'local'); assert.strictEqual(c.toString(), 'x')
console.log('authorship tests passed')
