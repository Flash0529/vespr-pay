// UI command bus: the app shell tells the SDE what to show, through the shared document (the only channel both already have, so it works across origins).
// A command is a small entry in the Y.Array "ui": { id, ts, by, type: 'open' | 'follow' | 'unfollow', file?, line?, agent? }.
// Only commands written by the SAME person as this SDE are carried out (your shell drives your SDE, nobody else's), only for files that exist in the room, never for
// editor-config or git paths, and only for agents that are really in the room. A command can open a file or follow an agent; it can never run anything.
const MAX_AGE_MS = 15_000

const safeRel = rel => typeof rel === 'string' && rel.length > 0 && rel.length <= 300 && !rel.includes('..') && !rel.startsWith('/') && !rel.includes('\0') && !rel.includes('\\') &&
  !rel.split('/').some(s => s === '' || s === '.git' || s === '.vscode')

// What to do for one entry, or null. ctx: { me, filesHas(path), agents() -> names }
function plan (e, ctx) {
  if (!e || typeof e !== 'object' || e.by !== ctx.me) return null
  if (e.type === 'open') {
    if (!safeRel(e.file) || !ctx.filesHas(e.file)) return null
    const line = Number.isInteger(e.line) ? Math.min(1_000_000, Math.max(1, e.line)) : 1
    return { kind: 'open', file: e.file, line }
  }
  if (e.type === 'follow') return typeof e.agent === 'string' && ctx.agents().includes(e.agent) ? { kind: 'follow', agent: e.agent } : null
  if (e.type === 'unfollow') return { kind: 'unfollow' }
  return null
}

// Watch the array; carry out entries that appear after this call (and are not stale), once each. Returns a function that stops watching.
function attach (ydoc, ctx, run, now = Date.now) {
  const arr = ydoc.getArray('ui'); const handled = new Set(); const t0 = now()
  const h = () => {
    for (const m of arr.toArray()) {
      if (!m || typeof m.id !== 'string' || handled.has(m.id)) continue
      handled.add(m.id)
      if (typeof m.ts !== 'number' || m.ts < t0 - MAX_AGE_MS || m.ts > now() + MAX_AGE_MS) continue // old history and clock nonsense are ignored
      const p = plan(m, ctx); if (p) { try { run(p) } catch { /* a failed command must not break the editor */ } }
    }
  }
  for (const m of arr.toArray()) if (m && typeof m.id === 'string') handled.add(m.id) // what is already there is history, not a request
  arr.observe(h)
  return () => arr.unobserve(h)
}
module.exports = { plan, attach, safeRel, MAX_AGE_MS }
