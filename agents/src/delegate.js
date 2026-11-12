// delegate_task: a manager agent hands work to an agent below it in the team tree (hierarchy.js). The task goes on the list of that
// agent's own manager, so the worker loop (worker.js) picks it up and that manager reviews it. Work only goes down, never sideways or up.
// The task carries the access label of what the manager read this turn (labels.js high-water mark), and it is refused when the
// receiving agent may not see that level. Without a name, it goes on the manager's own list and its watchdog picks a fitting worker.
import { canDelegate } from './hierarchy.js'
import { canRead, cleanLabel, readerFor } from './labels.js'

export const DELEGATE_TOOL = {
  name: 'delegate_task',
  description: 'Hand a piece of work to an agent below you in your team (one of your workers, or one of theirs). to: that agent\'s name; leave it out to let your own watchdog pick one of your direct workers. title: the job in one sentence, specific enough to do without asking. detail: anything else they need. Brief them so they need not guess: why (the decisions and limits that matter, which they may not have seen), files (workspace paths to start from), done (how they will know it is finished). The agent does it and hands it in with evidence for review. Work only goes down: you cannot hand work sideways or up.',
  parameters: { type: 'object', properties: { to: { type: 'string' }, title: { type: 'string' }, detail: { type: 'string' }, why: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, done: { type: 'string' }, priority: { type: 'number' } }, required: ['title'] }
}

export const hasReports = (tree, name) => !!tree && [...tree.values()].some(n => n.parent === name)
// may this agent (by its node in the tree) see work at this label?
export const fitsLabel = (tree, agent, label) => { const l = cleanLabel(label); if (!l) return true; const n = tree && tree.get(agent); return !!n && canRead(l, readerFor({ level: n.ceiling, scopes: n.scopes })) }

export function delegateTask ({ tasks, tree, me, requester = '', label = null, args = {}, now = Date.now(), parentTask = '', known = null, ask = null }) {
  const out = (o, note) => ({ text: JSON.stringify(o), note })
  const title = String(args.title || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!title) return out({ error: 'a task needs a title' }, 'delegate: no title given')
  if (!hasReports(tree, me)) return out({ error: 'you have no agents below you in the team tree' }, `delegate refused: ${me} has no team`)
  const to = String(args.to || '').trim().replace(/^@/, '')
  if (to && !canDelegate(tree, me, to)) return out({ error: `${to} is not below you in the team tree (work only goes down)` }, `delegate to ${to} refused: not below ${me}`)
  const l = cleanLabel(label)
  if (to && !fitsLabel(tree, to, l)) return out({ error: `${to} may not see work at this access level` }, `delegate to ${to} refused: access level`)
  if (!to && l && ![...tree.values()].some(n => n.parent === me && fitsLabel(tree, n.name, l))) return out({ error: 'none of your workers may see work at this access level' }, 'delegate refused: access level')
  // the original request only to whoever may read it: the named agent, or (left to the watchdog) every direct worker
  const mayRead = al => to ? fitsLabel(tree, to, al) : [...tree.values()].filter(n => n.parent === me).every(n => fitsLabel(tree, n.name, al))
  const { brief, missing } = makeBrief({ args, known, ask, mayRead })
  const id = 'task-' + now.toString(36) + Math.random().toString(36).slice(2, 6)
  const team = to ? tree.get(to).parent : me
  const task = {
    id, pair: team, title, detail: String(args.detail || '').slice(0, 2000),
    priority: Number(args.priority) > 0 ? Math.min(9, Math.floor(Number(args.priority))) : 2,
    brief, owner: to || null, status: to ? 'assigned' : 'todo', createdBy: String(requester || '').slice(0, 60), delegatedBy: me, label: l,
    parent: parentTask ? String(parentTask) : null, // its result folds into that task's hand-in (worker.js), not reported on its own
    createdAt: now, updatedAt: now, lastBeat: now, attempts: to ? 1 : 0, note: to ? `Delegated by ${me} to ${to}` : `Delegated by ${me}`, result: null
  }
  tasks.set(id, task)
  const briefed = brief.files.length || brief.done ? ` with a brief (${brief.files.length} file${brief.files.length === 1 ? '' : 's'}${brief.done ? ', done when set' : ''})` : ''
  return out({ ok: true, id, to: to || null, team, status: task.status, brief: { files: brief.files, done: !!brief.done, ask: !!brief.ask }, ...(missing.length ? { unknownFiles: missing } : {}), ...(brief.done ? {} : { hint: 'next time add done: how they will know it is finished' }) },
    (to ? `handed task ${id} to @${to}` : `put task ${id} on ${me}'s team list`) + briefed)
}

// The brief that travels with a task: what the manager knows that the worker does not. why (the decisions and limits that matter),
// files (where to start; only paths that exist in the workspace), done (how they will know it is finished), and the person's original
// request, so a worker two levels down still knows what was actually asked. Capped; the original request goes only to agents
// allowed to read it (mayRead), otherwise the brief says it is hidden.
export const BRIEF_CAPS = { why: 800, done: 400, ask: 600, files: 10 }
export function makeBrief ({ args = {}, known = null, ask = null, mayRead = () => true } = {}) {
  const clip = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n)
  const list = Array.isArray(args.files) ? args.files : typeof args.files === 'string' ? args.files.split(/[\s,]+/) : []
  const paths = [...new Set(list.map(p => String(p).trim().replace(/^\.?\//, '')).filter(Boolean))]
  const have = known ? new Set(known) : null
  const brief = { why: clip(args.why, BRIEF_CAPS.why), files: paths.filter(p => !have || have.has(p)).slice(0, BRIEF_CAPS.files), done: clip(args.done, BRIEF_CAPS.done) }
  if (ask && ask.text) { if (mayRead(ask.label || null)) brief.ask = { by: clip(ask.by, 60), text: clip(ask.text, BRIEF_CAPS.ask) }; else brief.askHidden = true }
  return { brief, missing: have ? paths.filter(p => !have.has(p)).slice(0, 10) : [] }
}
// the brief as the worker reads it, under its task (agent.js taskRequest)
export function briefText (b) {
  if (!b || typeof b !== 'object') return ''
  const lines = []
  if (b.why) lines.push(`Why: ${b.why}`)
  if (Array.isArray(b.files) && b.files.length) lines.push(`Start with: ${b.files.join(', ')}`)
  if (b.done) lines.push(`Done when: ${b.done}`)
  if (b.ask && b.ask.text) lines.push(`The original request${b.ask.by ? ` from ${b.ask.by}` : ''}, for context: "${b.ask.text}"`)
  else if (b.askHidden) lines.push('The original request is above your access level; work from this task alone.')
  return lines.length ? '\n' + lines.join('\n') : ''
}
