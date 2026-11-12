// The copy-and-paste memory, the lines around a selection, and the labels on context boxes.
import assert from 'node:assert'
import { normalize, createProvenance, lineContext, buildContext, label, isCodeLike, checkPasteSafety } from '../context-capture.js'

assert.strictEqual(normalize('  a  b\n\n\tc '), 'a b c')
const p = createProvenance(3)
assert.strictEqual(p.remember('x', { a: 1 }), false, 'too short to track')
assert.ok(p.remember('return amount * percent / 100', { file: 'cart.py', lines: [8, 8] }))
assert.deepStrictEqual(p.find('return   amount *\n percent / 100'), { file: 'cart.py', lines: [8, 8] }, 'whitespace changes do not break the match')
assert.strictEqual(p.find('something else entirely'), null)
for (const t of ['aaaa', 'bbbb', 'cccc', 'dddd']) p.remember(t, { t })
assert.strictEqual(p.size(), 3); assert.strictEqual(p.find('return amount * percent / 100'), null, 'the oldest copy drops first')
p.remember('bbbb', { t: 'again' }); assert.strictEqual(p.size(), 3); assert.deepStrictEqual(p.find('bbbb'), { t: 'again' }, 'copying again replaces and refreshes')

const src = ['import x', '', 'def total(items):', '    return 1', '', 'def apply(amount, percent):', '    return amount * percent / 100', '']
const lc = lineContext(src.join('\n'), 7, 7, 2)
assert.deepStrictEqual([lc.lo, lc.hi, lc.total], [7, 7, 8]); assert.strictEqual(lc.before, '5: \n6: def apply(amount, percent):'); assert.strictEqual(lc.after, '8: ')
assert.strictEqual(lineContext('a\nb', 1, 1, 3).before, ''); assert.strictEqual(lineContext('a\nb', 2, 2, 3).after, '')
const clamp = lineContext('a\nb\nc', 0, 99, 1); assert.deepStrictEqual([clamp.lo, clamp.hi], [1, 3])

const c = buildContext({ kind: 'code', src: 'cart.py · line 7', file: 'cart.py', lines: [7], by: 'coder', text: ' return 1 ', before: 'x', zzz: 'dropped' })
assert.deepStrictEqual(c, { kind: 'code', src: 'cart.py · line 7', text: 'return 1', file: 'cart.py', lines: [7, 7], by: 'coder', before: 'x' })
assert.strictEqual(buildContext({ text: '  ' }), null); assert.strictEqual(buildContext({ kind: 'bogus', text: 'a' }).kind, 'text')
assert.strictEqual(buildContext({ text: 'q'.repeat(3000) }).text.length, 2000)
assert.strictEqual(label({ file: 'cart.py', lines: [4, 9] }), 'cart.py · lines 4–9'); assert.strictEqual(label({ file: 'cart.py', lines: [4, 4] }), 'cart.py · line 4')
assert.strictEqual(label({ kind: 'chat', author: 'sam', thread: 'Fix the discount bug' }), 'sam in Fix the discount bug'); assert.strictEqual(label({ kind: 'terminal' }), 'terminal'); assert.strictEqual(label(null), '')

// Ask #301: Uncontextualized paste safety checks
assert.strictEqual(isCodeLike('hello world this is plain chat text'), false)
assert.strictEqual(isCodeLike('def calculate_tax(amount):\n    return amount * 0.08'), true)
assert.strictEqual(isCodeLike('const x = 10;\nfunction foo() { return x; }'), true)

const prov = createProvenance(5)
prov.remember('def calculate_tax(amount):\n    return amount * 0.08', { file: 'tax.py', lines: [1, 2] })

// Internal paste from app provenance -> safe, no warning
const safeCheck = checkPasteSafety('def calculate_tax(amount):\n    return amount * 0.08', { provenance: prov })
assert.strictEqual(safeCheck.warn, false)
assert.strictEqual(safeCheck.internal, true)

// External paste not in provenance -> warns and default action is cancel
const warnCheck = checkPasteSafety('def external_code():\n    import os\n    return os.getenv("API_KEY")', { provenance: prov })
assert.strictEqual(warnCheck.warn, true)
assert.strictEqual(warnCheck.defaultAction, 'cancel')
assert.strictEqual(warnCheck.canAttachContext, true)

console.log('context-capture tests passed')
