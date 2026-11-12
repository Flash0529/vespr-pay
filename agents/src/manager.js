// Manager and worker agents in VESPR rooms (MANAGER-AGENTS-SPEC.md)
// Roles & pairs, deterministic watchdog, rules relay, review gate, and demo mode.
//
// Role:
//   AGENT_ROLE = 'manager' | 'worker' (default 'worker')
//   AGENT_PAIR = string               (default 'main')
//
// Watchdog (deterministic, zero LLM tokens):
//   - Ticks every MANAGER_TICK_SEC (default 15s)
//   - Worker is alive if beat timestamp <= tick window; down otherwise
//   - Tasks assigned or doing with down owner or beat older than TASK_STALL_SEC (45s)
//     are marked stalled, attempts incremented, and reassigned to next live worker
//     in the same pair (lowest load first, highest priority task first).
//   - After MAX_ATTEMPTS (3), task is blocked and asks the room (approval card).
//
// Rules relay:
//   - When settings.rules change, manager posts to chat, mentions each pair worker.
//   - Worker has ACK_SEC (30s) to acknowledge before being treated as unavailable.
//   - Unacknowledged workers receive no new work.
//
// Review gate:
//   - Workers submit completed tasks with evidence and test output to 'review'.
//   - Manager verifies evidence and test status before marking 'done';
//     otherwise task is sent back to 'assigned' with note.

import { fitsLabel } from './delegate.js'

export const DEFAULT_MANAGER_TICK_SEC = 15
export const DEFAULT_TASK_STALL_SEC = 45
export const DEFAULT_MAX_ATTEMPTS = 3
export const DEFAULT_ACK_SEC = 30
export const DEFAULT_BEAT_INTERVAL_SEC = 5

export function createManager ({
  name = 'manager',
  pair = 'main',
  tickSec = Number(process.env.MANAGER_TICK_SEC) || DEFAULT_MANAGER_TICK_SEC,
  stallSec = Number(process.env.TASK_STALL_SEC) || DEFAULT_TASK_STALL_SEC,
  maxAttempts = Number(process.env.MAX_ATTEMPTS) || DEFAULT_MAX_ATTEMPTS,
  ackSec = Number(process.env.ACK_SEC) || DEFAULT_ACK_SEC,
  now = () => Date.now(),
  room = null,
  tree = null // hierarchy.js tree (a Map, or a function returning one): the manager's direct reports are its workers
} = {}) {
  let currentRulesVersion = 0
  let currentRules = []
  let rulesPostedAt = 0
  const workerAcks = new Map() // workerName -> acknowledgedVersion
  const inMemoryTasks = new Map() // id -> task

  function getTasksMap () {
    if (room && typeof room.doc?.getMap === 'function') {
      return room.doc.getMap('tasks')
    }
    return inMemoryTasks
  }

  function getAwarenessList () {
    if (room && room.provider?.awareness) {
      const states = room.provider.awareness.getStates()
      const list = []
      for (const [clientId, state] of states) {
        if (state && state.user) {
          list.push({ clientId, ...state.user })
        }
      }
      return list
    }
    if (room && typeof room.getAwarenessStates === 'function') {
      return room.getAwarenessStates()
    }
    return []
  }

  // Who works for this manager. With a tree (from an operator/maker file): exactly its direct reports, and awareness only says
  // whether each of those named agents is alive, so a peer cannot join the team by claiming a team or a role about itself.
  // Without a tree: the older rule (any peer that says it is a worker of this pair), kept for the demo and its tests;
  // index.js never starts a manager without a tree.
  const treeNow = () => (typeof tree === 'function' ? tree() : tree)
  function candidates (awareness) {
    const t = typeof tree === 'function' ? tree() : tree
    if (!t) return awareness.filter(u => u.role !== 'manager' && u.pair === pair)
    return [...t.values()].filter(n => n.parent === name).map(n => {
      const live = awareness.filter(u => u.name === n.name && u.isAgent).sort((a, b) => (b.beat || 0) - (a.beat || 0))[0] || {}
      return { name: n.name, pair, role: 'worker', beat: live.beat || 0, state: live.state || 'offline' }
    })
  }

  function say (text) {
    if (room && typeof room.say === 'function') {
      return room.say(text)
    }
    return { id: 'msg-' + Math.random().toString(36).slice(2, 6), text: () => text }
  }

  function requestApproval (card) {
    if (room && typeof room.requestApproval === 'function') {
      return room.requestApproval(card)
    }
    return Promise.resolve({ approved: false, by: 'auto-timeout' })
  }

  // Pure task helpers
  function getTask (id) {
    const map = getTasksMap()
    if (typeof map.get === 'function') return map.get(id) || inMemoryTasks.get(id) || null
    return inMemoryTasks.get(id) || null
  }

  function setTask (id, task) {
    const map = getTasksMap()
    inMemoryTasks.set(id, task)
    if (typeof map.set === 'function') {
      map.set(id, task)
    }
    return task
  }

  function listTasks ({ pairFilter = pair, statusFilter = null } = {}) {
    const map = getTasksMap()
    const all = []
    if (typeof map.values === 'function') {
      for (const t of map.values()) {
        if (t && typeof t === 'object') all.push(t)
      }
    } else {
      for (const t of inMemoryTasks.values()) all.push(t)
    }
    return all.filter(t => {
      if (pairFilter && t.pair !== pairFilter) return false
      if (statusFilter && t.status !== statusFilter) return false
      return true
    }).sort((a, b) => (a.priority || 999) - (b.priority || 999))
  }

  // Roster inspection
  function getRoster () {
    const awareness = getAwarenessList()
    const currentTime = now()
    const workers = candidates(awareness).map(w => {
      // alive = beat within the watchdog window, but never shorter than two heartbeats (a fast watchdog must not call healthy workers dead)
      const isAlive = (currentTime - (w.beat || 0)) <= Math.max(tickSec, 2 * DEFAULT_BEAT_INTERVAL_SEC) * 1000
      const ackedVersion = workerAcks.get(w.name) || 0
      const rulesOk = currentRulesVersion === 0 || ackedVersion === currentRulesVersion
      const activeTasks = listTasks({ pairFilter: pair }).filter(t => t.owner === w.name && (t.status === 'assigned' || t.status === 'doing'))
      return {
        name: w.name,
        pair: w.pair,
        alive: isAlive,
        beat: w.beat || 0,
        state: w.state || 'idle',
        rulesAcked: rulesOk,
        taskCount: activeTasks.length
      }
    })

    return {
      manager: name,
      pair,
      tickSec,
      stallSec,
      maxAttempts,
      ackSec,
      currentRulesVersion,
      rules: [...currentRules],
      workers
    }
  }

  // Rules relay
  function postRules (rulesArray) {
    currentRulesVersion += 1
    currentRules = Array.isArray(rulesArray) ? [...rulesArray] : [String(rulesArray)]
    rulesPostedAt = now()
    workerAcks.clear()

    const awareness = getAwarenessList()
    const pairWorkers = candidates(awareness).map(w => w.name)

    const mentions = pairWorkers.length ? pairWorkers.map(p => `@${p}`).join(', ') : 'workers'
    const msg = `rules changed (v${currentRulesVersion}): ${currentRules.join('; ')}. ${mentions} please acknowledge.`
    say(msg)

    return {
      version: currentRulesVersion,
      rules: currentRules,
      postedAt: rulesPostedAt,
      mentions: pairWorkers
    }
  }

  function acknowledgeRules (workerName, version) {
    if (Number(version) !== currentRulesVersion) {
      return { error: `stale rules version: current is v${currentRulesVersion}, received v${version}` }
    }
    workerAcks.set(workerName, currentRulesVersion)
    say(`@${workerName} acknowledged rules v${currentRulesVersion}.`)
    return { ok: true, worker: workerName, version: currentRulesVersion }
  }

  // Create and assign tasks
  function createTask ({ title, detail = '', priority = 1, targetPair = pair, createdBy = name } = {}) {
    if (!title) return { error: 'Task title is required' }
    const id = 'task-' + Math.random().toString(36).slice(2, 7)
    const task = {
      id,
      pair: targetPair,
      title: String(title).trim(),
      detail: String(detail).trim(),
      priority: Number(priority) || 1,
      owner: null,
      status: 'todo', // todo | assigned | doing | review | done | blocked
      createdBy,
      createdAt: now(),
      updatedAt: now(),
      lastBeat: now(),
      attempts: 0,
      note: '',
      result: null
    }

    // Attempt initial auto-assignment to live, rules-compliant worker in same pair
    if (targetPair === pair) {
      const roster = getRoster()
      const eligible = roster.workers.filter(w => w.alive && w.rulesAcked).sort((a, b) => a.taskCount - b.taskCount)
      if (eligible.length > 0) {
        task.owner = eligible[0].name
        task.status = 'assigned'
        task.attempts = 1
        task.lastBeat = now()
        task.note = `Assigned to ${eligible[0].name}`
        say(`Task ${task.id} (${task.title}, priority ${task.priority}) assigned to @${eligible[0].name}.`)
      }
    }

    setTask(id, task)
    return task
  }

  // Deterministic Watchdog Tick
  function tick () {
    const currentTime = now()
    const roster = getRoster()
    const aliveWorkers = roster.workers.filter(w => w.alive)
    const downWorkers = roster.workers.filter(w => !w.alive)
    const eligibleWorkers = roster.workers.filter(w => w.alive && w.rulesAcked).sort((a, b) => a.taskCount - b.taskCount)

    // open tasks on this team's list (put there by a person, or later by delegation): hand each to the least busy live worker
    for (const task of listTasks({ pairFilter: pair, statusFilter: 'todo' })) {
      if (task.owner) continue
      const w = eligibleWorkers.filter(x => fitsLabel(treeNow(), x.name, task.label)).sort((a, b) => a.taskCount - b.taskCount)[0] // a labeled task only to a worker that may see it
      if (!w) break
      Object.assign(task, { owner: w.name, status: 'assigned', attempts: 1, lastBeat: currentTime, updatedAt: currentTime, note: `Assigned to ${w.name}` })
      setTask(task.id, task); w.taskCount += 1
      say(`Task ${task.id} (${task.title}, priority ${task.priority}) assigned to @${w.name}.`)
    }

    // handed-in work (worker.js moves a task to 'review'): check its evidence and tests now
    for (const task of listTasks({ pairFilter: pair, statusFilter: 'review' })) reviewTask(task.id)

    // results go back up by themselves: a finished task is reported to the person who asked by the agent that delegated it
    // (or by this team's manager when a person put it on the list directly), so people never have to ask the workers
    const everyTask = getTasksMap(); for (const task of (typeof everyTask.values === 'function' ? [...everyTask.values()] : [])) {
      if (!task || task.status !== 'done' || task.reported || task.parent) continue // a subtask comes back inside its parent
      if (!(task.delegatedBy === name || (!task.delegatedBy && task.pair === pair))) continue
      const ev = task.label ? '' : String((task.result && task.result.evidence) || '').replace(/\s+/g, ' ').trim().slice(0, 240)
      setTask(task.id, { ...task, reported: true, updatedAt: currentTime })
      say(`${task.createdBy ? '@' + task.createdBy + ' ' : ''}done: ${task.title} (by ${task.owner}).${task.label ? ' Details are restricted; ask me.' : ev ? ' ' + ev : ''}`)
    }

    const activeTasks = listTasks({ pairFilter: pair })
      .filter(t => t.status === 'assigned' || t.status === 'doing')
      .sort((a, b) => (a.priority || 999) - (b.priority || 999))

    const allTasks = getTasksMap(); const busyOwners = new Set((typeof allTasks.values === 'function' ? [...allTasks.values()] : []).filter(t => t && t.status === 'doing').map(t => t.owner))
    const reassignedTasks = []
    const blockedTasks = []

    for (const task of activeTasks) {
      const ownerRecord = roster.workers.find(w => w.name === task.owner)
      const isOwnerDown = !ownerRecord || !ownerRecord.alive
      // queued: assigned to a live worker that is busy with another task (one at a time): waiting is not stalling
      const isQueued = task.status === 'assigned' && !isOwnerDown && busyOwners.has(task.owner)
      const isStalled = !isQueued && (currentTime - (task.lastBeat || 0)) > (stallSec * 1000)
      const idleSec = Math.round((currentTime - (task.lastBeat || 0)) / 1000) // before the task is touched below

      if (isOwnerDown || isStalled) {
        task.attempts = (task.attempts || 0) + 1
        task.updatedAt = currentTime
        const oldOwner = task.owner || 'unassigned'

        if (task.attempts >= maxAttempts) {
          task.status = 'blocked'
          task.note = `Task failed after ${task.attempts} attempts; worker ${oldOwner} down or stalled.`
          blockedTasks.push(task)
          setTask(task.id, task)
          say(`Task ${task.id} blocked: ${oldOwner} failed to respond after ${task.attempts} attempts. Asking room.`)
          requestApproval({
            kind: 'task_blocked',
            summary: `Task ${task.id} (${task.title}) is blocked after ${task.attempts} attempts.`,
            detail: task.note
          })
        } else {
          // Reassign to next live worker of same pair with lowest load
          const available = eligibleWorkers.filter(w => w.name !== oldOwner && fitsLabel(treeNow(), w.name, task.label))
          if (!available.length && eligibleWorkers.length) {
            // Only oldOwner is live, but stalled -> can't reassign
            task.status = 'blocked'
            task.note = `No alternative live workers in pair ${pair} for reassignment.`
            blockedTasks.push(task)
            setTask(task.id, task)
            say(`Task ${task.id} blocked: no alternate live worker available in pair ${pair}.`)
          } else if (!available.length) {
            task.status = 'blocked'
            task.note = `No live workers available in pair ${pair}.`
            blockedTasks.push(task)
            setTask(task.id, task)
            say(`Task ${task.id} blocked: all workers down in pair ${pair}.`)
          } else {
            const nextWorker = available[0]
            task.owner = nextWorker.name
            task.status = 'assigned'
            task.lastBeat = currentTime
            task.note = `Reassigned from ${oldOwner} to ${nextWorker.name} (attempt ${task.attempts})`
            reassignedTasks.push(task)
            setTask(task.id, task)
            nextWorker.taskCount += 1
            say(isOwnerDown
              ? `${oldOwner} is not answering, task ${task.id} goes to @${nextWorker.name}.`
              : `${oldOwner} has not worked on task ${task.id} for ${idleSec} s; it goes to @${nextWorker.name}.`)
          }
        }
      }
    }

    return {
      time: currentTime,
      pair,
      aliveCount: aliveWorkers.length,
      downCount: downWorkers.length,
      reassignedCount: reassignedTasks.length,
      blockedCount: blockedTasks.length,
      reassignedTasks,
      blockedTasks
    }
  }

  // Review before anything runs
  function submitForReview (taskId, workerName, result = {}) {
    const task = getTask(taskId)
    if (!task) return { error: `Task ${taskId} not found` }
    if (task.pair !== pair) return { error: `Task ${taskId} belongs to pair ${task.pair}, not ${pair}` }
    if (task.owner !== workerName) return { error: `Worker ${workerName} is not the current owner of ${taskId}` }

    task.status = 'review'
    task.result = result
    task.updatedAt = now()
    setTask(taskId, task)
    say(`@${workerName} submitted task ${taskId} for manager review.`)

    return reviewTask(taskId)
  }

  function reviewTask (taskId) {
    const task = getTask(taskId)
    if (!task) return { error: `Task ${taskId} not found` }
    const res = task.result || {}

    // Review criteria: must have concrete evidence and tests passed
    const hasEvidence = Boolean(res.evidence && String(res.evidence).trim().length > 0)
    const passedTests = res.passed !== false && (!res.tests || res.tests.failed === 0)

    if (!hasEvidence || !passedTests) {
      task.reviewFails = (task.reviewFails || 0) + 1
      if (task.reviewFails >= maxAttempts) { // the same work keeps failing review: stop the loop and ask the people
        task.status = 'blocked'; task.note = `Review failed ${task.reviewFails} times; asking the room.`; task.updatedAt = now(); setTask(taskId, task)
        say(`Task ${task.id} blocked: its work failed review ${task.reviewFails} times. Asking room.`)
        requestApproval({ kind: 'task_blocked', summary: `Task ${task.id} (${task.title}) failed review ${task.reviewFails} times.`, detail: String(res.evidence || '').slice(0, 400) })
        return { approved: false, reason: task.note, task }
      }
      task.status = 'assigned'
      task.note = !hasEvidence
        ? 'Review rejected: no concrete evidence provided.'
        : `Review rejected: test suite failed (${res.tests?.failed || 1} failures).`
      task.updatedAt = now()
      setTask(taskId, task)
      say(`Review rejected for task ${task.id}: ${task.note} Back to @${task.owner}.`)
      return { approved: false, reason: task.note, task }
    }

    task.status = 'done'
    task.note = 'Manager review passed: verified evidence and clean tests.'
    task.updatedAt = now()
    setTask(taskId, task)
    say(`Task ${task.id} review approved by manager: verified and marked done.`)
    return { approved: true, task }
  }

  // Demo script scenario (runs without LLM token dependencies)
  function runDemoScenario () {
    const log = []
    const fakeState = {
      currentTime: 1000000,
      awareness: [
        { name: 'manager', role: 'manager', pair: 'main', beat: 1000000 },
        { name: 'coder', role: 'worker', pair: 'main', beat: 1000000, state: 'working' },
        { name: 'coder-2', role: 'worker', pair: 'main', beat: 1000000, state: 'idle' }
      ]
    }

    const demoManager = createManager({
      name: 'manager',
      pair: 'main',
      tickSec: 15,
      stallSec: 45,
      maxAttempts: 3,
      ackSec: 30,
      now: () => fakeState.currentTime,
      room: {
        getAwarenessStates: () => fakeState.awareness,
        say: text => { log.push({ t: fakeState.currentTime, text }); return { id: 'm', text: () => text } },
        requestApproval: card => { log.push({ t: fakeState.currentTime, card }); return Promise.resolve({ approved: true, by: 'shamit' }) }
      }
    })

    // Step 1: Post rules and have workers ack
    demoManager.postRules(['Run tests before submit', 'Never bypass consensus'])
    demoManager.acknowledgeRules('coder', 1)
    demoManager.acknowledgeRules('coder-2', 1)

    // Step 2: Create task assigned to coder
    const t1 = demoManager.createTask({ title: 'Fix auth token replay', priority: 1 })
    log.push({ step: 'created', t1 })

    // Step 3: Simulate coder going down (beat stops)
    fakeState.currentTime += 50000 // +50s (exceeds stallSec 45s)
    fakeState.awareness[1].beat = 1000000 // coder last beat was at 1000000
    fakeState.awareness[2].beat = fakeState.currentTime // coder-2 stays alive

    // Step 4: Watchdog tick triggers reassignment
    const tickResult = demoManager.tick()
    log.push({ step: 'watchdog_tick', tickResult })

    // Step 5: coder-2 finishes and submits review with evidence
    const reviewResult = demoManager.submitForReview(t1.id, 'coder-2', {
      summary: 'Patched replay guard with timing-safe token hash comparison',
      evidence: 'node server/test/auth.test.js output: auth tests passed (0 errors)',
      passed: true,
      tests: { total: 12, passed: 12, failed: 0 }
    })
    log.push({ step: 'review_approved', reviewResult })

    return { success: true, log, task: demoManager.getTask(t1.id) }
  }

  return {
    name,
    pair,
    tickSec,
    stallSec,
    maxAttempts,
    ackSec,
    tick,
    getRoster,
    postRules,
    acknowledgeRules,
    createTask,
    getTask,
    listTasks,
    submitForReview,
    reviewTask,
    runDemoScenario
  }
}
