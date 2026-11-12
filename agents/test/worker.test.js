// The worker side: a worker takes only its own assigned task, keeps it alive while working, hands it in with evidence, and the
// manager reviews it on its next tick. A task taken away mid-work is not overwritten; a worker that keeps failing review gets blocked.
import assert from 'node:assert'
import { createWorker, evidenceFrom } from '../src/worker.js'
import { createManager } from '../src/manager.js'
import { buildTree } from '../src/hierarchy.js'

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const flush = () => new Promise(r => setTimeout(r, 0))
const { tree } = buildTree([{ name: 'lead', maker: 'Maya' }, { name: 'fe', parent: 'lead', maker: 'Maya' }, { name: 'be', parent: 'lead', maker: 'Maya' }])

function team ({ runFe, runBe } = {}) {
  let clock = 1_000_000; const said = []; const tasks = new Map()
  const aw = [{ name: 'fe', isAgent: true, beat: clock }, { name: 'be', isAgent: true, beat: clock }]
  const room = { doc: { getMap: () => tasks }, getAwarenessStates: () => aw, say: s => { said.push(s); return {} }, requestApproval: c => { said.push('APPROVAL ' + c.summary); return Promise.resolve({ approved: false }) } }
  const mgr = createManager({ name: 'lead', pair: 'lead', tickSec: 15, stallSec: 45, now: () => clock, tree, room })
  const mk = (name, run) => createWorker({ name, pair: 'lead', tasks, run, now: () => clock, say: s => said.push(`${name}: ${s}`) })
  return { tasks, said, mgr, aw, fe: mk('fe', runFe), be: mk('be', runBe), adv: ms => { clock += ms; for (const a of aw) a.beat = clock }, now: () => clock }
}
const put = (tasks, id, title, extra = {}) => tasks.set(id, { id, pair: 'lead', title, priority: 1, owner: null, status: 'todo', createdBy: 'Maya', lastBeat: 0, attempts: 0, ...extra })

await t('a worker takes only its own task, marks it doing, and beats it while working', async () => {
  let release; const gate = new Promise(r => { release = r })
  const x = team({ runFe: () => gate.then(() => ({ evidence: 'Fixed cart.py; python3 -m unittest: OK', passed: true, tests: { failed: 0 } })) })
  put(x.tasks, 't1', 'Fix the discount'); x.mgr.tick()
  const owner = x.tasks.get('t1').owner; assert.ok(owner === 'fe' || owner === 'be')
  if (owner === 'be') x.tasks.set('t1', { ...x.tasks.get('t1'), owner: 'fe' }) // keep the test deterministic: fe owns it
  assert.deepStrictEqual(x.be.tick(), { idle: true }, "be does not touch fe's task")
  assert.deepStrictEqual(x.fe.tick(), { started: 't1' })
  assert.strictEqual(x.tasks.get('t1').status, 'doing')
  x.adv(30_000); assert.deepStrictEqual(x.fe.tick(), { beat: 't1' })
  x.adv(30_000); x.fe.tick()
  x.mgr.tick() // 60 s in, but the task beat 0 s ago: not stalled
  assert.strictEqual(x.tasks.get('t1').owner, 'fe', 'a working task is not taken away by the 45 s stall rule')
  assert.ok(x.said.some(s => /^fe: Working on task t1 \(Fix the discount\) for Maya\./.test(s)))
  release(); await flush(); await flush()
  assert.strictEqual(x.tasks.get('t1').status, 'review')
  assert.match(x.tasks.get('t1').result.evidence, /unittest: OK/)
})

await t('the manager reviews a handed-in task on its next tick', async () => {
  const x = team({ runFe: async () => ({ evidence: 'did it, tests pass', passed: true, tests: { failed: 0 } }) })
  put(x.tasks, 't2', 'Write the docs', { owner: 'fe', status: 'assigned', attempts: 1, lastBeat: x.now() })
  x.fe.tick(); await flush(); await flush()
  assert.strictEqual(x.tasks.get('t2').status, 'review')
  x.mgr.tick()
  assert.strictEqual(x.tasks.get('t2').status, 'done')
  assert.ok(x.said.some(s => /Task t2 review approved/.test(s)))
})

await t('a result with no evidence goes back, and after repeated failures the task is blocked and the room is asked', async () => {
  const x = team({ runFe: async () => ({ evidence: '', passed: false }) })
  put(x.tasks, 't3', 'Flaky job', { owner: 'fe', status: 'assigned', attempts: 1, lastBeat: x.now() })
  for (let i = 0; i < 4 && x.tasks.get('t3').status !== 'blocked'; i++) { x.fe.tick(); await flush(); await flush(); x.mgr.tick() }
  assert.strictEqual(x.tasks.get('t3').status, 'blocked')
  assert.ok(x.said.some(s => /^APPROVAL Task t3/.test(s)), 'the people in the room are asked')
})

await t('a task taken away while the worker was busy is not overwritten by the late result', async () => {
  let release; const gate = new Promise(r => { release = r })
  const x = team({ runFe: () => gate.then(() => ({ evidence: 'late', passed: true })) })
  put(x.tasks, 't4', 'Long job', { owner: 'fe', status: 'assigned', attempts: 1, lastBeat: x.now() })
  x.fe.tick()
  x.tasks.set('t4', { ...x.tasks.get('t4'), owner: 'be', status: 'assigned' }) // the manager moved it
  release(); await flush(); await flush()
  assert.strictEqual(x.tasks.get('t4').owner, 'be'); assert.strictEqual(x.tasks.get('t4').status, 'assigned')
  assert.deepStrictEqual(x.fe.tick(), { idle: true })
})

await t('a stalled worker is described as stalled, not as gone', async () => {
  const x = team()
  put(x.tasks, 't5', 'Never started', { owner: 'fe', status: 'assigned', attempts: 1, lastBeat: x.now() })
  x.adv(50_000) // both agents alive, but nobody worked t5 for 50 s
  x.mgr.tick()
  assert.ok(x.said.some(s => /fe has not worked on task t5 for 50 s; it goes to @be/.test(s)), x.said.join(' | '))
  assert.ok(!x.said.some(s => /fe is not answering/.test(s)))
})

await t('a crash inside the work counts as a failed hand-in, not a stuck task', async () => {
  const x = team({ runFe: async () => { throw new Error('model timed out') } })
  put(x.tasks, 't6', 'Crashy', { owner: 'fe', status: 'assigned', attempts: 1, lastBeat: x.now() })
  x.fe.tick(); await flush(); await flush()
  assert.strictEqual(x.tasks.get('t6').status, 'review'); assert.strictEqual(x.tasks.get('t6').result.passed, false)
})

await t('a task waiting for a busy worker is queued, not stalled (real-model run: it was blocked after 45 s)', async () => {
  let release; const gate = new Promise(r => { release = r })
  const x = team({ runFe: () => gate.then(() => ({ evidence: 'first done', passed: true })) })
  x.aw.splice(1, 1) // only fe is on the team's list of live agents: no one else could take the task
  put(x.tasks, 'q1', 'First job', { owner: 'fe', status: 'assigned', attempts: 1, lastBeat: x.now() })
  put(x.tasks, 'q2', 'Second job', { owner: 'fe', status: 'assigned', attempts: 1, lastBeat: x.now(), priority: 5 })
  x.fe.tick() // takes q1 (higher priority); q2 waits in fe's queue
  for (let i = 0; i < 6; i++) { x.adv(20_000); x.fe.tick(); x.mgr.tick() } // two minutes go by while fe works on q1
  assert.strictEqual(x.tasks.get('q2').status, 'assigned'); assert.strictEqual(x.tasks.get('q2').owner, 'fe')
  assert.ok(!x.said.some(s => /q2/.test(s) && /blocked|has not worked/.test(s)), x.said.join(' | '))
  release(); await flush(); await flush()
})

await t('the last command decides the hand-in; a failed first try or a refused tool does not sink correct work', async () => {
  const at = (role, text, status) => ({ author: 'scraper', ts: 2000, id: Math.random().toString(36), role, text, status })
  const real = [ // what the real model did on 2026-11-04
    at('tool', '$ python -m pytest test_cart.py -v\nNo module named pytest\n[exit 1]', 'failed'),
    at('tool', 'write_file not run: coordinators delegate', 'failed'),
    at('tool', '$ python -m unittest test_cart.py\nRan 3 tests ... OK\n[exit 0]', 'done'),
    at('agent', 'Fixed apply_discount; all tests pass.'),
    { author: 'be', ts: 2000, role: 'tool', text: '$ false', status: 'failed' }, // someone else's step
    { author: 'scraper', ts: 10, role: 'tool', text: '$ old', status: 'failed' } // before this task started
  ]
  assert.deepStrictEqual(evidenceFrom(real, { name: 'scraper', since: 1000 }), { evidence: 'Fixed apply_discount; all tests pass.', passed: true, tests: { failed: 0, commands: 2 } })
  const lastFailed = [...real.slice(0, 4), at('tool', '$ python -m unittest\nFAILED (failures=1)\n[exit 1]', 'failed')]
  assert.strictEqual(evidenceFrom(lastFailed, { name: 'scraper', since: 1000 }).passed, false)
  for (const stop of ['The demo\'s AI budget for this period (60,000 tokens) is used up; it refills at 07:26 UTC.', 'I hit an error talking to the model: timeout', 'I stopped after several steps; tell me if you want me to continue.'])
    assert.strictEqual(evidenceFrom([at('agent', stop)], { name: 'scraper' }).passed, false, stop)
  assert.strictEqual(evidenceFrom([at('agent', 'Handed it to @scraper.')], { name: 'be' }).passed, false, 'nothing from be itself')
  assert.strictEqual(evidenceFrom([{ ...at('agent', 'Handed it to @scraper.'), author: 'be' }], { name: 'be' }).passed, true, 'a coordinator with no commands passes on its reply; its subtasks decide the rest')
})

console.log(`worker tests passed (${n}): own task only, doing + task heartbeat, review on the next tick, no-evidence goes back then blocks, late results dropped, stalled wording, crash = failed hand-in, queued is not stalled, last command decides`)
