// The message box helpers (composer.js): big pastes become files, Ctrl+Enter carries lists on, and the live activity strip.
import assert from 'node:assert'
import { isBigPaste, pasteMeta, continueList, activityView, clock, BIG_PASTE } from '../composer.js'

// big pastes
assert.strictEqual(isBigPaste('a short question'), false)
assert.strictEqual(isBigPaste('x'.repeat(BIG_PASTE.chars)), true, 'long text')
assert.strictEqual(isBigPaste('a\n'.repeat(BIG_PASTE.lines)), true, 'many lines')
assert.strictEqual(isBigPaste(' \n'.repeat(5000)), false, 'only whitespace is never a file')
assert.deepStrictEqual(pasteMeta('# Launch plan\n\nWe ship on Friday.\n- one\n- two'), { name: 'Launch plan.md', lines: 5, chars: 45, kind: 'markdown' })
assert.strictEqual(pasteMeta('plain words\nmore words').name, 'Pasted text.txt')
assert.strictEqual(pasteMeta('plain', 3).name, 'Pasted text 3.txt', 'a second paste gets its own name')
assert.strictEqual(pasteMeta('# a/b:c*?\nx').name, 'abc.md', 'no path characters in the name')
assert.strictEqual(pasteMeta('function a () {\n  return 1;\n}\nconst b = 2;').kind, 'code')

// lists
const go = (v, at) => continueList(v, at)
assert.deepStrictEqual(go('Steps:\n1. buy milk'), { value: 'Steps:\n1. buy milk\n2. ', caret: 22, ended: false })
assert.strictEqual(go('9) nine').value, '9) nine\n10) ', 'numbers count on, keeping the ) style')
assert.strictEqual(go('  - nested').value, '  - nested\n  - ', 'indent and bullet kept')
assert.strictEqual(go('• dot').value, '• dot\n• ')
assert.strictEqual(go('a) first').value, 'a) first\nb) ')
assert.deepStrictEqual(go('1. a\n2. '), { value: '1. a\n', caret: 5, ended: true }, 'an empty item ends the list')
assert.strictEqual(go('just text'), null, 'not a list: the caller does the usual thing')
assert.strictEqual(go('2026. was a year'), null, 'a year is not a list'); assert.strictEqual(go('1.5 litres'), null)
assert.strictEqual(go('1. one\n2. two', 6).value, '1. one\n2. \n2. two', 'works mid-text at the caret')

// the activity strip
const now = 1_000_000
assert.strictEqual(activityView([]), null)
assert.strictEqual(activityView([{ r: 'me' }, { r: 'work', text: '$ npm test', status: 'done', ok: true, started: 1 }], { now }), null, 'nothing running')
const v = activityView([
  { r: 'work', text: 'Reading old.py', status: 'done', started: 1 }, // before the latest message: not this turn
  { r: 'me', t: 'fix it' },
  { r: 'work', who: 'coder', text: 'Reading cart.py', status: 'done', ok: true, started: now - 75_000 },
  { r: 'work', who: 'coder', text: '$ pytest -q\n3 passed', status: 'failed', ok: false, started: now - 60_000 },
  { r: 'work', who: 'coder', text: '$ npm run build', status: 'running', started: now - 5_000 }
], { now })
assert.strictEqual(v.title, 'Running npm run build'); assert.strictEqual(v.who, 'coder'); assert.strictEqual(v.elapsed, 75_000)
assert.deepStrictEqual(v.steps.map(s => s.state), ['done', 'failed', 'running'])
assert.strictEqual(v.steps[1].text, '$ pytest -q', 'one line per step')
assert.strictEqual(activityView([{ r: 'me' }, { r: 'thinking', who: 'planner', ts: now - 3000 }], { now }).title, 'planner is thinking')
const many = activityView([{ r: 'me' }, ...Array.from({ length: 9 }, (_, i) => ({ r: 'work', text: 'step ' + i, status: i === 8 ? 'running' : 'done', started: now - 1000 }))], { now })
assert.deepStrictEqual([many.steps.length, many.more], [6, 3])
assert.strictEqual(activityView(null), null); assert.strictEqual(activityView([null, 3, 'x']), null)
assert.strictEqual(clock(876_000), '14m 36s'); assert.strictEqual(clock(52_400), '52s'); assert.strictEqual(clock(3_725_000), '1h 2m'); assert.strictEqual(clock(-5), '0s')

console.log('composer tests passed: big paste detection and names, list carry-on and ending, activity strip (this turn only, running step, clock, cap)')
