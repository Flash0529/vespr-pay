// "Run" from the app: a person presses Run (a file, or the tests) and the output shows up for everyone in the workspace.
// The request is a small entry in the shared document (`runs`); the lead agent in the room runs it on the workspace's runner and writes the output back as it arrives.
// Only two things can be asked for: `python3 <a .py file in this workspace>` and the unit tests. The request carries a kind and a file name, never a command line.
// It is off unless the operator turns it on (MURMIO_HUMAN_RUNS=1): a run executes the workspace's code inside the agent's own container.
import { classifyCommand } from './policy.js'

const PY_FILE = /^[\w][\w.\-/]*\.py$/
const MAX_RUNS = 30

export function buildCommand (kind, file, list) {
  if (kind === 'tests') return { cmd: 'python3 -m unittest discover -v' }
  if (kind === 'file') {
    if (!PY_FILE.test(file) || file.includes('..')) return { error: 'That is not a Python file in this workspace.' }
    if (!list.includes(file)) return { error: `${file} is not in this workspace.` }
    return { cmd: `python3 ${file}` }
  }
  return { error: 'Unknown kind of run.' }
}

export function startRuns ({ room, getRunner, enabled = false }) {
  const runs = room.doc.getArray('runs')
  room.settings.set('runs', enabled ? 'on' : 'off') // the app shows or hides its Run buttons from this
  const seen = new Set(); let busy = Promise.resolve()
  // with several agents in a room only one runs things: the first by name
  const lead = () => { const names = [...room.provider.awareness.getStates().values()].filter(s => s.user && s.user.isAgent).map(s => s.user.name).sort(); return !names.length || names[0] === room.name }
  const set = (m, o) => room.doc.transact(() => { for (const [k, v] of Object.entries(o)) m.set(k, v) })

  async function handle (m) {
    const id = m.get('id'); const deny = out => set(m, { status: 'denied', ended: Date.now(), out, code: null })
    if (!enabled) return deny('Running code from the app is switched off in this workspace. Ask @coder to run it: the room approves each run.')
    const built = buildCommand(m.get('kind'), String(m.get('file') || ''), room.list())
    if (built.error) return deny(built.error)
    if (classifyCommand(built.cmd) !== 'safe') return deny('That command is not allowed.')
    const runner = await getRunner()
    if (runner.remote) return deny(`Commands in this workspace run on ${runner.label}. Running a file there needs an approval: ask @coder to run it.`)
    set(m, { status: 'running', started: Date.now(), cmd: built.cmd, runner: runner.label, cwd: runner.dirFor ? runner.dirFor(room) : '' })
    let last = 0
    const r = await runner.exec(room, built.cmd, 'run-' + id, out => { const now = Date.now(); if (now - last >= 250) { last = now; set(m, { out }) } })
    set(m, { status: 'done', ended: Date.now(), code: r.code, out: r.output, changed: r.changed || [] })
  }

  const check = () => {
    if (!lead()) return
    for (const m of runs.toArray()) {
      const id = m.get('id'); if (m.get('status') !== 'requested' || seen.has(id)) continue
      seen.add(id); busy = busy.then(() => handle(m)).catch(e => { console.error('run failed:', e.message); try { set(m, { status: 'done', ended: Date.now(), code: -1, out: 'The run could not be completed.' }) } catch {} })
    }
    if (runs.length > MAX_RUNS) room.doc.transact(() => runs.delete(0, runs.length - MAX_RUNS))
  }
  runs.observeDeep(check); check()
  return { stop: () => runs.unobserveDeep(check) }
}
