// Agent hierarchy: who an agent answers to, what it may hand to whom, and who may steer it.
// Pure. The tree comes from an operator/maker file, never from awareness or the shared doc (any peer can write those and claim to be anyone's worker).
// A node: { name, parent, maker, ceiling, scopes, visibility }. maker = the person who created it, or the agent that did (resolved to that agent's person).
//   buildTree(nodes)               -> { tree, problems }: unknown parents become roots, cycles are cut, a child never exceeds its parent's ceiling or scopes
//   chain(tree, name)              -> [name, parent, ..., root]
//   makerOf(tree, name)            -> the person behind an agent (following agent-made agents up to a person)
//   canDelegate(tree, from, to)    -> only to an agent below you (down the tree, never sideways or up)
//   canSteer(tree, person, name)   -> the maker of this agent or of any agent above it (stop, reassign, change its settings)
//   escalation(tree, name)         -> who to ask when stuck: the agents above it, then the person who made the top one
//   readerFor(tree, name, person)  -> what the agent may read while working for that person (labels.js: never above the person, the agent or any agent above it)
import fs from 'node:fs'
import { LEVELS, readerFor as labelReader } from './labels.js'

const rank = l => LEVELS.indexOf(l)
const clean = s => String(s ?? '').trim().slice(0, 60)
const VIS = ['browser', 'windows']

export function buildTree (nodes) {
  const problems = []; const tree = new Map()
  for (const raw of Array.isArray(nodes) ? nodes : []) {
    const name = clean(raw && raw.name)
    if (!name) { problems.push('a node without a name was skipped'); continue }
    if (tree.has(name)) { problems.push(`duplicate agent ${name}: the first one wins`); continue }
    tree.set(name, {
      name, parent: clean(raw.parent), maker: clean(raw.maker),
      ceiling: rank(raw.ceiling) >= 0 ? raw.ceiling : LEVELS[0], // unknown or missing = the lowest level, never the highest
      scopes: Array.isArray(raw.scopes) ? [...new Set(raw.scopes.map(s => String(s).trim().toLowerCase()).filter(Boolean))].sort() : [],
      visibility: VIS.includes(raw.visibility) ? raw.visibility : 'browser'
    })
  }
  for (const n of tree.values()) if (n.parent && !tree.has(n.parent)) { problems.push(`${n.name}: parent ${n.parent} does not exist, so it is a top-level agent`); n.parent = '' }
  for (const n of tree.values()) { // cut cycles: walk up; if we come back to n, n becomes a top-level agent
    const seen = new Set([n.name]); let p = n.parent
    while (p) { if (seen.has(p)) { problems.push(`${n.name}: its chain loops back to itself, so it is a top-level agent`); n.parent = ''; break } seen.add(p); p = tree.get(p).parent }
  }
  const settled = new Set() // clamp top-down: a child never reads above, or outside, its parent
  const settle = n => {
    if (settled.has(n.name)) return
    if (n.parent) {
      const p = tree.get(n.parent); settle(p)
      if (rank(n.ceiling) > rank(p.ceiling)) { problems.push(`${n.name}: ceiling ${n.ceiling} is above its parent's, lowered to ${p.ceiling}`); n.ceiling = p.ceiling }
      const extra = n.scopes.filter(s => !p.scopes.includes(s))
      if (extra.length) { problems.push(`${n.name}: scopes ${extra.join(', ')} are outside its parent's and were dropped`); n.scopes = n.scopes.filter(s => p.scopes.includes(s)) }
      if (p.visibility === 'windows' && n.visibility === 'browser') n.visibility = 'windows' // a Windows-only parent never has a browser-visible child
    }
    settled.add(n.name)
  }
  for (const n of tree.values()) settle(n)
  return { tree, problems }
}

export function chain (tree, name) {
  const out = []; let n = tree.get(name)
  while (n && !out.includes(n.name)) { out.push(n.name); n = n.parent ? tree.get(n.parent) : null }
  return out
}

export function makerOf (tree, name) {
  const seen = new Set(); let n = tree.get(name)
  while (n && !seen.has(n.name)) {
    seen.add(n.name)
    if (n.maker && !tree.has(n.maker)) return n.maker // a person
    n = tree.get(n.maker || n.parent) // made by an agent (or no maker recorded): ask the agent above
  }
  return ''
}

export const canDelegate = (tree, from, to) => from !== to && tree.has(from) && chain(tree, to).slice(1).includes(from)

export function canSteer (tree, person, name) {
  if (!person || !tree.has(name)) return false
  return chain(tree, name).some(a => makerOf(tree, a) === person)
}

export function escalation (tree, name) {
  const up = chain(tree, name)
  if (!up.length) return []
  const top = makerOf(tree, up[up.length - 1])
  return [...up.slice(1), ...(top ? [top] : [])]
}

export function readerFor (tree, name, person) {
  const n = tree.get(name)
  if (!n) return labelReader({}) // an agent that is not in the tree reads only open things
  return labelReader({ level: person.level, ceiling: n.ceiling, scopes: (person.scopes || []).filter(s => n.scopes.includes(String(s).toLowerCase())) })
}

// The tree from a JSON file (an array of nodes), re-read when the file changes. No file, or a file that does not parse,
// is an empty tree: nobody is anyone's worker. Problems (clamped levels, cut loops) are logged, never silently trusted.
export function treeFrom (file) {
  let cache = { mtime: -1, tree: new Map() }
  return () => {
    if (!file) return new Map()
    try {
      const st = fs.statSync(file)
      if (st.mtimeMs !== cache.mtime) {
        const { tree, problems } = buildTree(JSON.parse(fs.readFileSync(file, 'utf8')))
        for (const p of problems) console.error('agent tree:', p)
        cache = { mtime: st.mtimeMs, tree }
      }
    } catch { cache = { mtime: -1, tree: new Map() } }
    return cache.tree
  }
}

// Who answers a chat mention: an agent with a manager above it (a worker) answers only when called by its own name; a generic
// @agent or @all goes to the top agent, which hands work down and reports back. No tree: every agent behaves as before.
export function answersMention ({ text, name, tree }) {
  if (new RegExp(`@${String(name).replace(/[^\w-]/g, '')}\\b`, 'i').test(String(text))) return true
  const n = tree && tree.get(name)
  return !(n && n.parent)
}
