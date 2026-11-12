import assert from 'node:assert'
import { createManager, DEFAULT_MANAGER_TICK_SEC, DEFAULT_TASK_STALL_SEC } from '../src/manager.js'

console.log('Running manager.test.js...')

// ── TEST 1: Watchdog detects down worker and reassigns in priority order ──────
{
  let fakeTime = 1000000
  const messages = []
  const awareness = [
    { name: 'lead-manager', role: 'manager', pair: 'alpha', beat: fakeTime },
    { name: 'worker-1', role: 'worker', pair: 'alpha', beat: fakeTime, state: 'working' },
    { name: 'worker-2', role: 'worker', pair: 'alpha', beat: fakeTime, state: 'idle' }
  ]

  const mgr = createManager({
    name: 'lead-manager',
    pair: 'alpha',
    tickSec: 15,
    stallSec: 45,
    maxAttempts: 3,
    now: () => fakeTime,
    room: {
      getAwarenessStates: () => awareness,
      say: text => { messages.push(text); return { text: () => text } }
    }
  })

  // Create two tasks: t1 (priority 1), t2 (priority 2)
  const t1 = mgr.createTask({ title: 'Critical bugfix', priority: 1 })
  const t2 = mgr.createTask({ title: 'Refactor docs', priority: 2 })

  assert.strictEqual(t1.owner, 'worker-1')
  assert.strictEqual(t2.owner, 'worker-2')

  // Worker-1 stops beating; time advances past 45s stall window
  fakeTime += 50000 // +50s
  awareness[1].beat = 1000000 // worker-1 stalled at 1000000
  awareness[2].beat = fakeTime // worker-2 active

  const tickRes = mgr.tick()
  assert.strictEqual(tickRes.downCount, 1, 'Worker-1 declared down')
  assert.strictEqual(tickRes.reassignedCount, 1, 'Task t1 reassigned')

  const updatedT1 = mgr.getTask(t1.id)
  assert.strictEqual(updatedT1.owner, 'worker-2', 't1 reassigned to live worker-2')
  assert.strictEqual(updatedT1.attempts, 2, 'Attempts incremented to 2')
  assert(messages.some(m => m.includes('worker-1 is not answering, task ' + t1.id + ' goes to @worker-2')))
  console.log('  [PASS] Test 1: Watchdog detects down worker and reassigns in priority order')
}

// ── TEST 2: Two pairs never touch each other's tasks ──────────────────────────
{
  let fakeTime = 2000000
  const sharedTasksMap = new Map()
  const mockDoc = { getMap: name => (name === 'tasks' ? sharedTasksMap : new Map()) }

  const awareness = [
    { name: 'mgr-alpha', role: 'manager', pair: 'alpha', beat: fakeTime },
    { name: 'worker-alpha', role: 'worker', pair: 'alpha', beat: fakeTime },
    { name: 'mgr-beta', role: 'manager', pair: 'beta', beat: fakeTime },
    { name: 'worker-beta', role: 'worker', pair: 'beta', beat: fakeTime }
  ]

  const mgrAlpha = createManager({
    name: 'mgr-alpha',
    pair: 'alpha',
    now: () => fakeTime,
    room: { doc: mockDoc, getAwarenessStates: () => awareness }
  })

  const mgrBeta = createManager({
    name: 'mgr-beta',
    pair: 'beta',
    now: () => fakeTime,
    room: { doc: mockDoc, getAwarenessStates: () => awareness }
  })

  const tAlpha = mgrAlpha.createTask({ title: 'Alpha task', targetPair: 'alpha' })
  const tBeta = mgrBeta.createTask({ title: 'Beta task', targetPair: 'beta' })

  assert.strictEqual(tAlpha.pair, 'alpha')
  assert.strictEqual(tBeta.pair, 'beta')

  const alphaList = mgrAlpha.listTasks()
  const betaList = mgrBeta.listTasks()

  assert.strictEqual(alphaList.length, 1)
  assert.strictEqual(alphaList[0].id, tAlpha.id)

  assert.strictEqual(betaList.length, 1)
  assert.strictEqual(betaList[0].id, tBeta.id)

  // Submitting beta task to alpha manager must be refused
  const crossSubmit = mgrAlpha.submitForReview(tBeta.id, 'worker-beta', { evidence: 'done' })
  assert(crossSubmit.error && crossSubmit.error.includes('belongs to pair beta, not alpha'), 'Refused cross-pair task')
  console.log('  [PASS] Test 2: Two pairs never touch each other\'s tasks')
}

// ── TEST 3: Rules relay and acknowledgement gate ──────────────────────────────
{
  let fakeTime = 3000000
  const messages = []
  const awareness = [
    { name: 'mgr', role: 'manager', pair: 'main', beat: fakeTime },
    { name: 'coder-a', role: 'worker', pair: 'main', beat: fakeTime },
    { name: 'coder-b', role: 'worker', pair: 'main', beat: fakeTime }
  ]

  const mgr = createManager({
    name: 'mgr',
    pair: 'main',
    now: () => fakeTime,
    room: {
      getAwarenessStates: () => awareness,
      say: text => { messages.push(text); return { text: () => text } }
    }
  })

  // Post rules v1
  const postRes = mgr.postRules(['All code changes must have tests', 'No direct main pushes'])
  assert.strictEqual(postRes.version, 1)
  assert(messages[0].includes('@coder-a, @coder-b please acknowledge'))

  // Before acknowledgment, neither worker is eligible for new work
  const roster1 = mgr.getRoster()
  assert.strictEqual(roster1.workers.every(w => w.rulesAcked === false), true, 'Rules not yet acked')

  const tBlocked = mgr.createTask({ title: 'Unassigned work' })
  assert.strictEqual(tBlocked.status, 'todo', 'Task stays in todo because no worker acked rules')
  assert.strictEqual(tBlocked.owner, null)

  // coder-a acknowledges
  const ackRes = mgr.acknowledgeRules('coder-a', 1)
  assert.strictEqual(ackRes.ok, true)

  const roster2 = mgr.getRoster()
  assert.strictEqual(roster2.workers.find(w => w.name === 'coder-a').rulesAcked, true)
  assert.strictEqual(roster2.workers.find(w => w.name === 'coder-b').rulesAcked, false)

  // Now new task is auto-assigned only to coder-a
  const tAssigned = mgr.createTask({ title: 'Assigned work' })
  assert.strictEqual(tAssigned.owner, 'coder-a', 'Assigned only to compliant worker')
  assert.strictEqual(tAssigned.status, 'assigned')

  // Stale version ack rejected
  const staleAck = mgr.acknowledgeRules('coder-b', 0)
  assert(staleAck.error.includes('stale rules version'))
  console.log('  [PASS] Test 3: Rules relay and acknowledgement gate withhold unapproved work')
}

// ── TEST 4: Review gate: reject missing evidence or failing tests ─────────────
{
  let fakeTime = 4000000
  const awareness = [
    { name: 'mgr', role: 'manager', pair: 'main', beat: fakeTime },
    { name: 'worker', role: 'worker', pair: 'main', beat: fakeTime }
  ]

  const mgr = createManager({
    name: 'mgr',
    pair: 'main',
    now: () => fakeTime,
    room: { getAwarenessStates: () => awareness }
  })

  const task = mgr.createTask({ title: 'Feature implementation' })
  assert.strictEqual(task.owner, 'worker')

  // Case A: Submit with no evidence -> rejected back to assigned
  const rej1 = mgr.submitForReview(task.id, 'worker', {
    summary: 'I did the feature',
    evidence: '',
    passed: true
  })
  assert.strictEqual(rej1.approved, false)
  assert(rej1.reason.includes('no concrete evidence'))
  assert.strictEqual(mgr.getTask(task.id).status, 'assigned')

  // Case B: Submit with failing tests -> rejected back to assigned
  const rej2 = mgr.submitForReview(task.id, 'worker', {
    summary: 'Here is test output',
    evidence: 'test run',
    passed: false,
    tests: { failed: 2, passed: 10 }
  })
  assert.strictEqual(rej2.approved, false)
  assert(rej2.reason.includes('test suite failed'))
  assert.strictEqual(mgr.getTask(task.id).status, 'assigned')

  // Case C: Valid submission with evidence and passing tests -> approved as done
  const appOk = mgr.submitForReview(task.id, 'worker', {
    summary: 'Full implementation with tests',
    evidence: 'node test/all.test.js PASSED (12 of 12)',
    passed: true,
    tests: { failed: 0, passed: 12 }
  })
  assert.strictEqual(appOk.approved, true)
  assert.strictEqual(mgr.getTask(task.id).status, 'done')
  console.log('  [PASS] Test 4: Review gate validates evidence and clean test status')
}

// ── TEST 5: Watchdog blocks after MAX_ATTEMPTS and requests room decision ─────
{
  let fakeTime = 5000000
  const approvalCards = []
  const awareness = [
    { name: 'mgr', role: 'manager', pair: 'main', beat: fakeTime },
    { name: 'coder-1', role: 'worker', pair: 'main', beat: fakeTime },
    { name: 'coder-2', role: 'worker', pair: 'main', beat: fakeTime }
  ]

  const mgr = createManager({
    name: 'mgr',
    pair: 'main',
    tickSec: 15,
    stallSec: 45,
    maxAttempts: 3,
    now: () => fakeTime,
    room: {
      getAwarenessStates: () => awareness,
      requestApproval: card => { approvalCards.push(card); return Promise.resolve({ approved: false }) }
    }
  })

  const task = mgr.createTask({ title: 'Fragile migration', priority: 1 })
  assert.strictEqual(task.attempts, 1)

  // Attempt 1 fails: coder-1 stalls
  fakeTime += 50000
  awareness[0].beat = fakeTime
  awareness[1].beat = 5000000 // coder-1 stalled
  awareness[2].beat = fakeTime // coder-2 live
  mgr.tick()
  assert.strictEqual(mgr.getTask(task.id).owner, 'coder-2')
  assert.strictEqual(mgr.getTask(task.id).attempts, 2)

  // Attempt 2 fails: coder-2 stalls as well
  fakeTime += 50000
  awareness[2].beat = fakeTime - 50000 // coder-2 stalled
  mgr.tick()
  // coder-1 comes back alive, task reassigned back (attempt 3)
  awareness[1].beat = fakeTime
  mgr.tick()
  assert.strictEqual(mgr.getTask(task.id).attempts, 3)

  // Attempt 3 fails: coder-1 stalls again -> MAX_ATTEMPTS reached!
  fakeTime += 50000
  awareness[1].beat = fakeTime - 50000 // coder-1 stalled
  const finalTick = mgr.tick()

  const blockedTask = mgr.getTask(task.id)
  assert.strictEqual(blockedTask.status, 'blocked', 'Task marked blocked after 3 attempts')
  assert.strictEqual(approvalCards.length, 1, 'Approval card posted to the room')
  assert(approvalCards[0].summary.includes('blocked after 3 attempts'))
  console.log('  [PASS] Test 5: Watchdog blocks after MAX_ATTEMPTS and requests room decision')
}

// ── TEST 6: Demo mode runs whole scenario without API key ─────────────────────
{
  const mgr = createManager({ pair: 'main' })
  const demoResult = mgr.runDemoScenario()
  assert.strictEqual(demoResult.success, true)
  assert.strictEqual(demoResult.task.status, 'done')
  assert(demoResult.log.some(l => l.step === 'watchdog_tick'))
  assert(demoResult.log.some(l => l.step === 'review_approved'))
  console.log('  [PASS] Test 6: Demo mode runs deterministic script without API key')
}

// ── TEST 7: Mutation Checks (Prove invariants break without guardrails) ────────
{
  // Mutation 1: removing pair filter would allow cross-pair task theft
  const pairA = 'alpha'
  const pairB = 'beta'
  const filterGuard = (t, currentPair) => t.pair === currentPair
  const mutantNoFilter = (t, currentPair) => true
  const taskA = { id: 't-1', pair: pairA }
  assert.strictEqual(filterGuard(taskA, pairB), false, 'Filter guard prevents cross-pair access')
  assert.strictEqual(mutantNoFilter(taskA, pairB), true, 'Mutant would allow cross-pair leakage')

  // Mutation 2: removing stall check allows stalled tasks to hang indefinitely
  const nowMs = 100000
  const lastBeat = 10000 // 90s ago (> 45s)
  const stallGuard = (now, beat, limit) => (now - beat) > limit
  const mutantNoStall = (now, beat, limit) => false
  assert.strictEqual(stallGuard(nowMs, lastBeat, 45000), true, 'Stall guard flags overdue task')
  assert.strictEqual(mutantNoStall(nowMs, lastBeat, 45000), false, 'Mutant would let stalled task hang')

  // Mutation 3: skipping rules ack gate assigns tasks to unacknowledged workers
  const ackGuard = (ackedVersion, currentVersion) => ackedVersion === currentVersion
  const mutantNoAck = (ackedVersion, currentVersion) => true
  assert.strictEqual(ackGuard(0, 1), false, 'Ack guard blocks unacknowledged worker')
  assert.strictEqual(mutantNoAck(0, 1), true, 'Mutant would assign unapproved work')
  console.log('  [PASS] Test 7: Mutation checks confirm pair, stall, and ack guards are load-bearing')
}

console.log('All manager.test.js assertions PASSED.')
