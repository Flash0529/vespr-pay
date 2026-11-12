// A token budget for a public demo, so judges (or anyone with the link) cannot drain the Token Factory credits.
// cap = 0 means no limit. The window rolls over by itself: when it ends, the budget is full again.
export function createBudget ({ cap = 0, windowMs = 24 * 3600 * 1000, now = () => Date.now() } = {}) {
  let start = now(); let used = 0
  const roll = () => { if (now() - start >= windowMs) { start = now(); used = 0 } }
  return {
    enabled: cap > 0, cap,
    spend (tokens) { roll(); used += Math.max(0, tokens || 0) },
    exhausted () { roll(); return cap > 0 && used >= cap },
    left () { roll(); return cap > 0 ? Math.max(0, cap - used) : Infinity },
    used () { roll(); return used },
    resetsAt () { roll(); return new Date(start + windowMs) }
  }
}
export const budgetMessage = b => `The demo's AI budget for this period (${b.cap.toLocaleString('en-US')} tokens) is used up; it refills at ${b.resetsAt().toUTCString().slice(17, 22)} UTC. Editing, the Code Map, replay and the rest still work, and the team can ask again after the refill.`
