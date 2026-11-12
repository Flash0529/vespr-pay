// Tests for app/follow.js: only agents move the view, moves are throttled, the person's own interaction pauses it. Run: node app/test/follow.test.mjs
import assert from 'node:assert'
import { createFollower, lineAt, LINE_MS, FILE_MS } from '../follow.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const clock = () => { let v = 1000; const f = () => v; f.adv = ms => { v += ms }; return f }
const TEXT = 'a\nb\nc\nd\ne\n'

t('lineAt counts lines and clamps', () => {
  assert.strictEqual(lineAt(TEXT, 0), 1)
  assert.strictEqual(lineAt(TEXT, 2), 2)
  assert.strictEqual(lineAt(TEXT, 6), 4)
  assert.strictEqual(lineAt(TEXT, 9999), 6)
  assert.strictEqual(lineAt(TEXT, -5), 1)
  assert.strictEqual(lineAt(null, 3), 1)
  assert.strictEqual(lineAt(TEXT, 'x'), 1)
})

t('an agent edit moves the view to its file and line; a person edit does not', () => {
  const f = createFollower({ now: clock() })
  assert.deepStrictEqual(f.onEdit({ ai: true, file: 'cart.py', at: 4, by: 'coder' }, TEXT), { file: 'cart.py', line: 3, by: 'coder' })
  const g = createFollower({ now: clock() })
  assert.strictEqual(g.onEdit({ ai: false, file: 'cart.py', at: 4, by: 'sam' }, TEXT), null)
  assert.strictEqual(g.onEdit(null, TEXT), null)
  assert.strictEqual(g.onEdit({ ai: true, at: 1 }, TEXT), null)
})

t('moves are throttled: same file every LINE_MS, another file every FILE_MS', () => {
  const c = clock(); const f = createFollower({ now: c })
  assert.ok(f.onEdit({ ai: true, file: 'a.py', at: 0 }, TEXT))
  c.adv(LINE_MS - 50); assert.strictEqual(f.onEdit({ ai: true, file: 'a.py', at: 4 }, TEXT), null)
  c.adv(100); assert.strictEqual(f.onEdit({ ai: true, file: 'a.py', at: 4 }, TEXT).line, 3)
  c.adv(LINE_MS + 10); assert.strictEqual(f.onEdit({ ai: true, file: 'b.py', at: 0 }, TEXT), null) // a new file waits longer
  c.adv(FILE_MS); assert.strictEqual(f.onEdit({ ai: true, file: 'b.py', at: 0 }, TEXT).file, 'b.py')
})

t('no move when the agent stays on the same line', () => {
  const c = clock(); const f = createFollower({ now: c })
  assert.ok(f.onEdit({ ai: true, file: 'a.py', at: 4 }, TEXT))
  c.adv(LINE_MS + 5); assert.strictEqual(f.onEdit({ ai: true, file: 'a.py', at: 5 }, TEXT), null)
})

t('the person taking the wheel pauses it, resume brings it back', () => {
  const c = clock(); const f = createFollower({ now: c })
  assert.ok(f.onEdit({ ai: true, file: 'a.py', at: 0 }, TEXT))
  assert.strictEqual(f.pause(), true); assert.strictEqual(f.pause(), false) // second pause is a no-op
  c.adv(5000); assert.strictEqual(f.onEdit({ ai: true, file: 'a.py', at: 6 }, TEXT), null)
  assert.strictEqual(f.label(), 'Paused · resume')
  f.resume(); assert.strictEqual(f.onEdit({ ai: true, file: 'a.py', at: 6 }, TEXT).line, 4)
})

t('toggle cycles off -> on -> (paused) resumed -> off, and off never moves', () => {
  const c = clock(); const f = createFollower({ now: c, on: false })
  assert.strictEqual(f.onEdit({ ai: true, file: 'a.py', at: 0 }, TEXT), null)
  assert.strictEqual(f.pause(), false) // pausing while off does nothing
  assert.strictEqual(f.toggle(), 'on')
  f.pause(); assert.strictEqual(f.toggle(), 'resumed'); assert.strictEqual(f.paused, false)
  assert.strictEqual(f.toggle(), 'off'); assert.strictEqual(f.enabled, false)
  assert.strictEqual(f.label(), 'Follow agent')
})

t('the label names who and where', () => {
  const f = createFollower({ now: clock() })
  assert.strictEqual(f.label(), 'Following the agent')
  f.onEdit({ ai: true, file: 'cart.py', at: 4, by: 'coder' }, TEXT)
  assert.strictEqual(f.label(), 'Following coder · cart.py:3')
})

console.log(`follow tests passed (${n})`)
