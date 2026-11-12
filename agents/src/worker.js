// Worker side of the manager pattern (manager.js): take the next task the
// manager assigned to this agent, mark it doing, keep the task's heartbeat fresh while working (so the 45 s stall rule does not fire),
// do it, and hand it in for review with evidence. One task at a time. If the manager takes the task away meanwhile, the late result
// is dropped instead of overwriting the new owner's work.
// A worker that is also a manager may delegate parts of its task (delegate.js records the task as their parent). Its own part done,
// it keeps the task alive until every subtask is done or blocked, then hands in its evidence plus each subtask's result, so results
// travel up the chain instead of skipping it. Subtasks that never finish (maxWaitMs) make the hand-in fail, and review takes over.
//   const w = createWorker({ name, pair, tasks, run, now, say })   tasks: the room's Y.Map 'tasks' (or any Map)
//   w.tick()      -> { started } | { beat } | { waiting, open } | { submitted } | { dropped } | { idle }; call every couple of seconds
//   run(task)     -> Promise<{ evidence, passed, tests: { failed } }>: the actual work (index.js runs the agent on the task)

export const WORKER_TICK_SEC = 2
export const SUBTASK_WAIT_MS = 30 * 60_000

export function createWorker ({ name, pair, tasks, run, now = () => Date.now(), say = () => {}, maxWaitMs = SUBTASK_WAIT_MS }) {
  let current = null; let startedAt = 0; let waiting = null // waiting: { id, res, since }: own part done, subtasks still open
  const write = (t, patch) => { const next = { ...t, ...patch, updatedAt: now() }; tasks.set(t.id, next); return next }
  const mine = () => [...tasks.values()].filter(t => t && t.pair === pair && t.owner === name && t.status === 'assigned')
    .sort((a, b) => (a.priority || 999) - (b.priority || 999))
  const stillMine = t => t && t.owner === name && t.status === 'doing'
  const subtasksOf = id => [...tasks.values()].filter(t => t && t.parent === id && (t.createdAt || 0) >= startedAt) // this attempt's only
  const settled = t => t.status === 'done' || t.status === 'blocked'

  function finish (id, res) {
    if (current === id) { current = null; waiting = null }
    const t = tasks.get(id)
    if (!stillMine(t)) return { dropped: id } // reassigned or cancelled while we worked: do not overwrite
    const result = { evidence: String((res && res.evidence) || '').slice(0, 2000), passed: !!res && res.passed !== false, tests: (res && res.tests) || null }
    write(t, { status: 'review', result, lastBeat: now(), note: `${name} handed it in for review` })
    return { submitted: id }
  }

  function checkWaiting () {
    if (!waiting) return null
    const subs = subtasksOf(waiting.id)
    const timedOut = now() - waiting.since > maxWaitMs
    if (!timedOut && !subs.every(settled)) return { waiting: waiting.id, open: subs.filter(t => !settled(t)).length }
    const { id, res } = waiting
    const lines = subs.map(t => `${t.title} (by ${t.owner || 'nobody'}): ${t.status === 'done' ? String((t.result && t.result.evidence) || 'done').replace(/\s+/g, ' ').slice(0, 400) : t.status === 'blocked' ? 'BLOCKED: ' + (t.note || '') : 'did not finish in time'}`)
    for (const t of subs) if (t.status === 'done' && !t.reported) tasks.set(t.id, { ...t, reported: true, updatedAt: now() }) // folded into this hand-in
    const ok = !timedOut && subs.every(t => t.status === 'done')
    return finish(id, { evidence: [String((res && res.evidence) || '').trim(), lines.length ? 'Subtasks: ' + lines.join(' | ') : ''].filter(Boolean).join(' '), passed: !!res && res.passed !== false && ok, tests: res && res.tests })
  }

  // own part finished: hand in now, or wait for the subtasks it delegated during this attempt
  function complete (id, res) {
    if (current !== id) return { dropped: id }
    if (!subtasksOf(id).length) return finish(id, res)
    waiting = { id, res, since: now() }
    return checkWaiting()
  }

  function tick () {
    if (current) {
      const t = tasks.get(current)
      if (!stillMine(t)) { current = null; waiting = null; return { dropped: true } }
      write(t, { lastBeat: now() })
      return (waiting && checkWaiting()) || { beat: t.id }
    }
    const next = mine()[0]
    if (!next) return { idle: true }
    current = next.id; startedAt = now(); waiting = null
    const t = write(next, { status: 'doing', lastBeat: now(), note: `${name} started it` })
    say(`Working on task ${t.id} (${t.title})${t.createdBy ? ` for ${t.createdBy}` : ''}.`)
    Promise.resolve().then(() => run(t)).then(res => complete(t.id, res), e => finish(t.id, { evidence: '', passed: false, error: String(e && e.message) }))
    return { started: t.id }
  }

  return { tick, finish, get current () { return current }, get waiting () { return waiting && waiting.id } }
}

// What a worker hands in for one task, from its own chat lines since it started (plain objects: author, ts, id, role, status, text).
// The LAST command decides whether the work passed: a real model tries things (pytest missing, exit 1) before the run that counts,
// and a refused tool (a coordinator trying to write) is not a failed test. Running out of budget, a model error or stopping early is
// not finished work. (Real-model run 2026-11-04: correct work was rejected three times by the old any-failed-step rule.)
const NOT_FINISHED = /AI budget for this period .* is used up|I hit an error talking to the model|I stopped after several steps/i
export function evidenceFrom (msgs, { name, since = 0, skipId = '' } = {}) {
  const mine = msgs.filter(m => m && m.author === name && (m.ts || 0) >= since && m.id !== skipId)
  const replies = mine.filter(m => m.role === 'agent').map(m => String(m.text || '').trim()).filter(Boolean)
  const commands = mine.filter(m => m.role === 'tool' && /^\$ /.test(String(m.text || '')))
  const last = commands[commands.length - 1]
  const failed = last && last.status === 'failed' ? 1 : 0
  const unfinished = replies.some(r => NOT_FINISHED.test(r))
  return { evidence: replies.join(' ').slice(0, 2000), passed: replies.length > 0 && !failed && !unfinished, tests: { failed, commands: commands.length } }
}
