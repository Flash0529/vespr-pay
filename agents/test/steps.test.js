// The words people read while an agent works: the live line per tool call, success or failure, and the checklist items.
import assert from 'node:assert'
import { stepSummary, stepOk, stepError, cleanPlan, oneLine, MAX_PLAN_ITEMS } from '../src/steps.js'

// one live line per tool, in plain words; a command keeps the "$ " form the chat already shows as a terminal line
assert.strictEqual(stepSummary('read_file', { path: 'cart.py' }), 'Reading cart.py')
assert.strictEqual(stepSummary('replace_in_file', { path: 'cart.py', old: 'a', new: 'b' }), 'Editing cart.py')
assert.strictEqual(stepSummary('write_file', { path: 'new.py' }), 'Writing new.py')
assert.strictEqual(stepSummary('delete_file', { path: 'old.py' }), 'Deleting old.py')
assert.strictEqual(stepSummary('run_command', { command: 'python3 -m unittest -q' }), '$ python3 -m unittest -q')
assert.strictEqual(stepSummary('code_map', {}), 'Asking the code map: overview')
assert.strictEqual(stepSummary('code_map', { query: 'impact:cart.py' }), 'Asking the code map: impact:cart.py')
assert.strictEqual(stepSummary('start_project', {}), 'Starting web')
assert.strictEqual(stepSummary('find_skill', { install: 'pptx' }), 'Installing the skill pptx')
assert.strictEqual(stepSummary('find_skill', { query: 'read a deck' }), 'Looking for a skill: read a deck')
assert.strictEqual(stepSummary('web_search', { query: 'yjs awareness' }), 'Searching the web: yjs awareness')
assert.strictEqual(stepSummary('mystery_tool', {}), 'Using mystery_tool')
// hostile and odd input never throws and stays on one short line
for (const bad of [null, undefined, 42, 'x', [], { ['__proto__']: { path: 'evil' } }, { path: NaN }, { path: 'a\nb\r\nc' }, { command: 'x'.repeat(100000) }]) {
  for (const t of ['read_file', 'run_command', 'find_skill', 'code_map', 'nope']) {
    const s = stepSummary(t, bad)
    assert.ok(typeof s === 'string' && !s.includes('\n') && s.length <= 160, `${t} ${JSON.stringify(bad)?.slice(0, 40)} -> ${s.slice(0, 40)}`)
  }
}
assert.ok(!stepSummary('read_file', JSON.parse('{"__proto__":{"path":"evil"}}')).includes('evil'), 'inherited keys are not read')
assert.strictEqual(stepSummary(null, null), 'Using a tool')

// success: JSON results with error / non-zero exit / ok:false / claimed:false fail; plain text (a file) is fine
assert.strictEqual(stepOk({ text: 'def f():\n  pass' }), true)
assert.strictEqual(stepOk({ text: JSON.stringify({ exit: 0, output: 'OK' }) }), true)
assert.strictEqual(stepOk({ text: JSON.stringify({ exit: 1, output: 'FAILED' }) }), false)
assert.strictEqual(stepOk({ text: JSON.stringify({ error: 'no such file: x' }) }), false)
assert.strictEqual(stepOk({ text: JSON.stringify({ ok: false, error: '' }) }), false)
assert.strictEqual(stepOk({ text: JSON.stringify({ claimed: false }) }), false)
assert.strictEqual(stepOk({ text: '{not json' }), true)
for (const bad of [null, undefined, {}, { text: 5 }, { text: 'null' }]) assert.strictEqual(stepOk(bad), true)
assert.strictEqual(stepError({ text: JSON.stringify({ error: 'no such file: x' }) }), 'no such file: x')
assert.strictEqual(stepError({ text: 'plain' }), '')
assert.strictEqual(stepError(null), '')

// the checklist: clean text, known statuses, bounded size
assert.deepStrictEqual(cleanPlan([{ text: 'Read the code', status: 'done' }, { text: '  Fix\nit ', status: 'in_progress' }, { text: 'Test', status: 'weird' }]),
  [{ text: 'Read the code', status: 'done' }, { text: 'Fix it', status: 'in_progress' }, { text: 'Test', status: 'pending' }])
assert.deepStrictEqual(cleanPlan(['a', '', null, { text: '   ' }, { content: 'b', status: 'done' }]), [{ text: 'a', status: 'pending' }, { text: 'b', status: 'done' }])
assert.strictEqual(cleanPlan(Array.from({ length: 50 }, (_, i) => ({ text: 's' + i, status: 'pending' }))).length, MAX_PLAN_ITEMS)
for (const bad of [null, undefined, 'x', 5, {}, { items: [] }]) assert.deepStrictEqual(cleanPlan(bad), [])
assert.ok(cleanPlan([{ text: 'y'.repeat(5000) }])[0].text.length <= 160)
assert.deepStrictEqual(cleanPlan([JSON.parse('{"__proto__":{"text":"evil"},"text":"ok"}')]), [{ text: 'ok', status: 'pending' }])
assert.strictEqual(oneLine(NaN), 'NaN'); assert.strictEqual(oneLine(null), '')
console.log('steps tests passed')
