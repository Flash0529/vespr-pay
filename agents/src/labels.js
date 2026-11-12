// Access labels on context: the level belongs to the information, not to the message it lands in.
// Pure, no Yjs. A label is { level, scopes: [..], owner }. No label means open (what every room is today), so nothing changes until someone labels something.
//   readerFor({ level, ceiling, scopes }) -> the reader an agent acts as: never above its person (min of the person's level and the agent's ceiling)
//   canRead(label, reader)                -> false for anything above the reader's level or outside their scopes; unknown levels fail closed
//   highWater(labels)                     -> the label for anything derived from these inputs (highest level, every scope required)
//   restrictedNote(label)                 -> the line a reader sees instead of restricted text
// The tiers are a list so the owner can change them (question 1 in the draft); the policy choices (block now, share as a brief later) sit on top.

export const LEVELS = ['member', 'lead', 'manager', 'admin'] // lowest first
const TOP = LEVELS[LEVELS.length - 1]
const rank = l => LEVELS.indexOf(l)
const cleanScope = s => String(s).trim().toLowerCase().slice(0, 80)

export function cleanLabel (l) {
  if (!l || typeof l !== 'object') return null
  const level = rank(l.level) >= 0 ? l.level : TOP // a level we don't know is treated as the most restricted
  const scopes = Array.isArray(l.scopes) ? [...new Set(l.scopes.map(cleanScope).filter(Boolean))].sort() : []
  const owner = typeof l.owner === 'string' ? l.owner.slice(0, 60) : ''
  return { level, scopes, owner }
}

export function readerFor ({ level = null, ceiling = null, scopes = [] } = {}) {
  const lv = rank(level) >= 0 ? level : null // a person with no level set reads only open things
  const cap = rank(ceiling) >= 0 ? ceiling : null
  const eff = lv && cap ? LEVELS[Math.min(rank(lv), rank(cap))] : (cap && !lv ? null : lv)
  return { level: eff, scopes: [...new Set((scopes || []).map(cleanScope).filter(Boolean))] }
}

export function canRead (label, reader) {
  const l = cleanLabel(label)
  if (!l) return true
  if (!reader || rank(reader.level) < 0) return false
  if (rank(l.level) > rank(reader.level)) return false
  return l.scopes.every(s => reader.scopes.includes(s))
}

export function highWater (labels) {
  const ls = (labels || []).map(cleanLabel).filter(Boolean)
  if (!ls.length) return null
  const level = ls.reduce((a, l) => rank(l.level) > rank(a) ? l.level : a, LEVELS[0])
  const scopes = [...new Set(ls.flatMap(l => l.scopes))].sort()
  const owners = [...new Set(ls.map(l => l.owner).filter(Boolean))]
  return { level, scopes, owner: owners.length === 1 ? owners[0] : '' }
}

export const restrictedNote = label => {
  const l = cleanLabel(label)
  return `[from a restricted source${l && l.owner ? `; ask ${l.owner} if you need it` : ''}]`
}
