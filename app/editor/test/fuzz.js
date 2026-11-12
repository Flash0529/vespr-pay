// Random concurrent editing for the editor core: 2 to 4 people (and sometimes an agent process) type at once, updates are exchanged
// late, out of order and twice, and in the end the Y.Text and every fake editor must be identical. Everything is derived from the
// seed, so a failing seed can be replayed; a failure is shrunk to a short list of steps (delta debugging) before it is printed.
import { Y, World, rng, Fail, show, same, must, randomChanges, validateChanges, charsOf, splitsPair } from './harness.js'

const ORDER = process.env.FUZZ_ORDER || 'random' // random | fifo (each sender in order) | causal (everything in the order it was made)
const ASCII = [['a', 'b', 'c', 'd', 'e', 'f'], ['A', 'B', 'C', 'D', 'E', 'F'], ['p', 'q', 'r', 's', 't', 'u'], ['P', 'Q', 'R', 'S', 'T', 'U']]
// Unicode tokens: surrogate pairs, CJK, combining marks, ZWJ sequences. Every code point (except the shared ZWJ) belongs to one author.
const UNI = [['😀', '日', 'é', '🏴'], ['😎', '本', 'ö', '👩‍💻'], ['🎉', '語', 'ñ', '🇯🇵'], ['🚀', '文', 'ü', '🧑‍🚀']]
const SEED_TEXT = '0123456789\n0123456789 0123\n  012\n'
const RAW_TOKENS = ['<', '>', '=', '+', '-', '*']
const ZWJ = '‍'

export function configFor (seed, mode) {
  const r = rng(seed * 2654435761 + 0x1234567)
  const people = r.range(2, 4)
  const aiIndex = mode === 'unicode' ? -1 : (r.chance(0.35) ? r.int(people) : -1)
  const raw = r.chance(0.4)
  const alphabets = mode === 'unicode' ? UNI : ASCII
  const names = ['alex', 'sam', 'jo', 'kim']
  const specs = []
  for (let i = 0; i < people; i++) specs.push({ name: names[i], ai: i === aiIndex, model: i === aiIndex ? 'nemotron' : '', tokens: alphabets[i] })
  if (raw) specs.push({ name: 'coder', raw: true, tokens: RAW_TOKENS })
  const ids = r.shuffle(Array.from({ length: specs.length }, (_, i) => 5000 + i * 13)) // who sorts first at one position varies per seed
  return { specs, ids, nested: r.chance(0.5) ? 'src/main.py' : null, steps: r.range(30, 110), safe: mode === 'unicode', undo: mode === 'undo', insertOnly: mode === 'authors', strict: mode === 'authors' || !!process.env.FUZZ_STRICT, mode, aiIndex }
}

function nextOp (r, w, cfg) {
  const people = w.people; const roll = r()
  const raw = w.peers.find(p => p.raw)
  if (cfg.undo && roll > 0.86) { const p = r.pick(people); return { k: r.pick(['undo', 'undo', 'redo', 'stop', 'stop']), p: p.index } }
  if (raw && roll > 0.8) { const p = r.pick(w.peers.filter(x => x.raw)); const len = p.ytext.length; return r.chance(cfg.insertOnly ? 1 : 0.7) ? { k: 'raw', kind: 'ins', p: p.index, at: r.int(len + 1), text: r.pick(RAW_TOKENS).repeat(r.range(1, 4)) } : { k: 'raw', kind: 'del', p: p.index, at: r.int(len + 1), len: r.range(1, 4) } }
  if (roll > 0.5) {
    const pend = w.pending()
    if (pend.length && r.chance(0.92)) {
      let [to, m] = r.pick(pend)
      if (ORDER === 'causal') m = pend.filter(x => x[0] === to).reduce((lo, x) => Math.min(lo, x[1]), Infinity) // oldest first: the order the updates were made
      else if (ORDER === 'fifo') m = pend.filter(x => x[0] === to && w.msgs[x[1]].from === w.msgs[m].from).reduce((lo, x) => Math.min(lo, x[1]), Infinity) // per sender in order
      return { k: 'deliver', to, m }
    }
    if (w.delivered.size && r.chance(0.5)) { const [to, m] = r.pick([...w.delivered]).split(':').map(Number); return { k: 'deliver', to, m } } // again: a duplicate
  }
  const p = r.pick(people)
  return { k: 'type', p: p.index, changes: randomChanges(r, p.editor.text, p.tokens, cfg.safe, cfg.insertOnly) }
}

const snapForward = (text, i) => { while (splitsPair(text, i)) i++; return i }

function exec (w, op, cfg) {
  const P = w.peers[op.p ?? op.to]
  switch (op.k) {
    case 'type': {
      if (!P || !P.binding) return
      try { validateChanges(op.changes, P.editor.text.length) } catch { return } // a replayed (shrunk) list may no longer fit
      if (cfg.safe && op.changes.some(c => splitsPair(P.editor.text, c.from) || splitsPair(P.editor.text, c.to))) return
      P.type(op.changes); return
    }
    case 'deliver': w.deliver(op.to, op.m); return
    case 'undo': if (P && P.binding) P.undo(); return
    case 'redo': if (P && P.binding) P.redo(); return
    case 'stop': if (P && P.binding && P.binding.stopCapturing) P.binding.stopCapturing(); return
    case 'raw': {
      if (!P || !P.raw) return
      const t = P.text(); let a = Math.min(op.at, t.length)
      if (cfg.safe) a = snapForward(t, a)
      if (op.kind === 'ins') P.rawInsert(a, op.text)
      else { let b = Math.min(a + op.len, t.length); if (cfg.safe) b = snapForward(t, b); if (b > a) P.rawDelete(a, b) }
    }
  }
}

const describe = (w, op) => {
  const nm = i => (w.peers[i] ? w.peers[i].name : '?')
  switch (op.k) {
    case 'type': return `${nm(op.p)} types ${show(op.changes, 200)}`
    case 'deliver': return `deliver update #${op.m} (from ${nm(w.msgs[op.m] ? w.msgs[op.m].from : -1)}) to ${nm(op.to)}`
    case 'raw': return op.kind === 'ins' ? `${nm(op.p)} (agent process) inserts ${show(op.text)} at ${op.at}` : `${nm(op.p)} (agent process) deletes ${op.len} at ${op.at}`
    default: return `${nm(op.p)} ${op.k}`
  }
}

// Who typed which character (every code point of every alphabet belongs to one author; the shared joiner is skipped).
// strict: any wrong attribute fails. Otherwise (runs that contain deletes) a character that LOST its author to a neighbouring run is
// only counted: Yjs drops the format markers of a run when another peer deletes the text the markers hang on (see README, known limits),
// but the attributes must still be well formed.
function checkAuthors (w, cfg) {
  const owner = new Map()
  for (const s of cfg.specs) for (const tok of s.tokens) for (const ch of tok) owner.set(ch, owner.has(ch) && owner.get(ch) !== s.name ? '*' : s.name)
  for (const ch of SEED_TEXT) owner.set(ch, 'seed')
  const spec = new Map(cfg.specs.map(s => [s.name, s]))
  const known = new Set([...spec.keys(), 'seed'])
  const now = Math.floor(Date.now() / 60000)
  let unit = 0; const lost = { none: 0, other: 0, why: {} }
  for (const { ch, attrs } of charsOf(w.peers[0].ytext)) {
    const who = owner.get(ch); const at = unit; unit += ch.length
    if (who === undefined) throw new Fail('AUTHOR', `unexpected character ${show(ch)} at ${at}`)
    const where = `character ${show(ch)} at index ${at} was typed by ${who} but carries ${show(attrs)}`
    if (cfg.strict) must(typeof attrs.by === 'string' && known.has(attrs.by), 'AUTHOR', `character ${show(ch)} at index ${at} has no valid author: ${show(attrs)}`)
    if (who === '*' || ch === ZWJ) continue
    let problem = null; let why = ''
    if (who === 'seed') { if (attrs.by !== 'seed' || attrs.ai) { problem = where; why = 'the start text now carries someone else\'s attributes' } }
    else {
      const agent = who === 'coder' || spec.get(who).ai
      if (attrs.by !== who) { problem = where + ' (wrong "by")'; why = 'wrong or missing "by"' }
      else if (!(Number.isInteger(attrs.t) && Math.abs(attrs.t - now) <= 1)) { problem = where + ' ("t" must be minutes since the epoch)'; why = '"by" right but "t" stale or missing' }
      else if (agent && !(attrs.ai === true && attrs.model === 'nemotron')) { problem = where + " (an agent's text must carry ai:true and its model)"; why = "agent text without ai/model" }
      else if (!agent && (attrs.ai != null || attrs.model != null || attrs.msg != null)) { problem = where + " (a person's text inherited an agent's attributes)"; why = "a person's text carries an agent's ai/model" }
    }
    if (problem) { if (cfg.strict) throw new Fail('AUTHOR', problem); if (typeof attrs.by === 'string' && known.has(attrs.by)) lost.other++; else lost.none++; lost.why[why] = (lost.why[why] || 0) + 1 }
  }
  return lost
}

// Run one seed. `ops` = a recorded (possibly shrunk) list to replay instead of generating. Returns { ops, error, cfg, trace }.
export function runFuzz ({ core, seed, mode = 'basic', ops = null, trace = false }) {
  const cfg = configFor(seed, mode); const r = rng(seed ^ 0x9e3779b9)
  const w = new World(core, cfg.specs, { nested: cfg.nested, ids: cfg.ids })
  const done = []; const lines = []; let error = null; let lost = { none: 0, other: 0, why: {} }
  try {
    const p0 = w.peers[0]
    p0.doc.transact(() => p0.ytext.insert(0, SEED_TEXT, { by: 'seed', t: 1 }), 'seed'); w.deliverEverything()
    const n = ops ? ops.length : cfg.steps
    for (let i = 0; i < n; i++) {
      const op = ops ? ops[i] : nextOp(r, w, cfg)
      done.push(op); exec(w, op, cfg)
      if (trace) lines.push(`${String(i + 1).padStart(3)}. ${describe(w, op)}` + (op.p != null && w.peers[op.p] && w.peers[op.p].binding ? `   -> ${w.peers[op.p].name} sees ${show(w.peers[op.p].editor.text, 90)}` : ''))
    }
    w.settle(ORDER === 'random' ? rng(seed + 777) : null); w.assertConverged(`seed ${seed}`)
    lost = checkAuthors(w, cfg)
  } catch (e) { error = e }
  try { w.destroy() } catch {}
  return { ops: done, error, cfg, trace: lines, lost }
}
const kindOf = e => (e instanceof Fail ? e.kind : 'THROW ' + String(e && e.message).slice(0, 50))

// delta debugging: drop chunks of steps while the same kind of failure remains
function shrink (core, seed, mode, ops, kind) {
  let cur = ops; let n = 2
  const fails = list => { const r = runFuzz({ core, seed, mode, ops: list }); return r.error && kindOf(r.error) === kind }
  while (cur.length >= 2) {
    const size = Math.ceil(cur.length / n); let reduced = false
    for (let i = 0; i < cur.length; i += size) {
      const cand = cur.slice(0, i).concat(cur.slice(i + size))
      if (cand.length && fails(cand)) { cur = cand; n = Math.max(n - 1, 2); reduced = true; break }
    }
    if (!reduced) { if (size === 1) break; n = Math.min(cur.length, n * 2) }
  }
  return cur
}

export function fuzzMany ({ core, mode, seeds, only = null, testName }) {
  const failing = []; let lostNone = 0; let lostOther = 0; let lostSeeds = 0; const lostWhy = {}
  const list = only != null ? [only] : Array.from({ length: seeds }, (_, i) => i + 1)
  for (const seed of list) { const r = runFuzz({ core, seed, mode }); if (r.error) { failing.push({ seed, r }); if (failing.length >= 5 && only == null) break } else if (r.lost.none + r.lost.other) { lostNone += r.lost.none; lostOther += r.lost.other; lostSeeds++; for (const [k, v] of Object.entries(r.lost.why)) lostWhy[k] = (lostWhy[k] || 0) + v } }
  if (!failing.length) return `${list.length} seeds` + (lostSeeds ? `; AFTER healing ${lostNone + lostOther} characters in ${lostSeeds} seeds still have wrong authorship: ${Object.entries(lostWhy).map(([k, v]) => v + ' x ' + k).join(', ')} (README, known limits 1)` : '')
  const { seed, r } = failing[0]; const kind = kindOf(r.error)
  const small = shrink(core, seed, mode, r.ops, kind)
  const re = runFuzz({ core, seed, mode, ops: small, trace: true })
  const people = r.cfg.specs.map(s => s.name + (s.raw ? ' (agent process, writes the Y.Text directly)' : s.ai ? ' (agent binding)' : '')).join(', ')
  throw new Error([
    `${failing.length}${only == null && failing.length >= 5 ? '+' : ''} of ${list.length} seeds fail (mode ${mode}); failing seeds: ${failing.map(f => f.seed).join(', ')}`,
    `FIRST FAILING SEED ${seed}: ${r.error.message}`,
    `replay it: node app/editor/test/core.test.js --only "${testName}" --seed ${seed}`,
    `shrunk from ${r.ops.length} to ${small.length} steps. Setup: ${people}; text in ${r.cfg.nested ? 'files.get("' + r.cfg.nested + '") (like a room)' : 'a root Y.Text'}; client ids ${r.cfg.ids.join(',')}; start text ${show('0123456789\n0123456789 0123\n  012\n', 40)} by "seed" delivered to all.`,
    `Steps of the minimal reproduction (all other updates arrive at the end, shuffled and duplicated):`,
    ...re.trace.map(l => '  ' + l),
    `  => ${re.error ? re.error.message : '(the shrunk run no longer fails?)'}`
  ].join('\n'))
}
