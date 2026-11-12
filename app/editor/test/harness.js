import { fileStore } from '../../file-store.js'
// Shared harness for the editor tests (Node, no browser): a seeded PRNG, a tiny test runner, a plain-string reference model, peers
// wired through a fake network that can delay, reorder and duplicate updates, and a fake awareness.
// The code under test is app/editor/core.js and presence.js (EDITOR_DIR=/other/folder tests another copy, which is how the
// mutation self-check works). Yjs is the app's own bundle: app/vendor/yjs.js.
import * as Y from '../../vendor/yjs.js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export { Y }
const here = dirname(fileURLToPath(import.meta.url))

export async function loadUnderTest () {
  const dir = process.env.EDITOR_DIR ? resolve(process.env.EDITOR_DIR) : resolve(here, '..')
  const core = await import(pathToFileURL(resolve(dir, 'core.js')).href)
  const presence = await import(pathToFileURL(resolve(dir, 'presence.js')).href)
  return { core, presence, dir }
}

// ---------------------------------------------------------------------------------------------------------------- arguments
const argv = process.argv.slice(2)
const opt = name => { const i = argv.indexOf('--' + name); return i < 0 ? null : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) }
export const args = {
  only: opt('only'), seed: opt('seed') == null ? null : Number(opt('seed')), seeds: Number(opt('seeds') || process.env.FUZZ_SEEDS || 400),
  verbose: !!opt('verbose'), list: !!opt('list')
}

// ---------------------------------------------------------------------------------------------------------------- randomness
export function rng (seed) {
  let a = seed >>> 0
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  next.int = n => Math.floor(next() * n)
  next.range = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1))
  next.pick = list => list[Math.floor(next() * list.length)]
  next.chance = p => next() < p
  next.shuffle = list => { const l = [...list]; for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [l[i], l[j]] = [l[j], l[i]] } return l }
  return next
}

// ---------------------------------------------------------------------------------------------------------------- failures
export class Fail extends Error { constructor (kind, message) { super(message); this.kind = kind } }
export const show = (s, max = 80) => { const j = String(JSON.stringify(s)); return j.length > max ? j.slice(0, max - 12) + '…(' + j.length + ' chars)' : j }
export function firstDiff (a, b) {
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++
  const ctx = s => JSON.stringify(s.slice(Math.max(0, i - 12), i + 20))
  return `lengths ${a.length} vs ${b.length}, first difference at index ${i}: ${ctx(a)} vs ${ctx(b)}`
}
export function same (a, b, kind, what) { if (a !== b) throw new Fail(kind, `${what}: ${firstDiff(a, b)}`) }
export function must (cond, kind, what) { if (!cond) throw new Fail(kind, what) }

// ---------------------------------------------------------------------------------------------------------------- reference model
// Independent of the code under test: apply [{ from, to, insert }] (all in the coordinates of `text`) from the END, by splicing.
export function refApply (text, changes) {
  let out = text
  for (let i = changes.length - 1; i >= 0; i--) { const c = changes[i]; out = out.slice(0, c.from) + (c.insert || '') + out.slice(c.to == null ? c.from : c.to) }
  return out
}
// Apply a Y.Text delta to a plain string.
export function refApplyDelta (text, delta) {
  let out = ''; let i = 0
  for (const op of delta) { if (op.retain != null) { out += text.slice(i, i + op.retain); i += op.retain } else if (typeof op.insert === 'string') out += op.insert; else if (op.delete != null) i += op.delete }
  return out + text.slice(i)
}
// A set of changes is valid for onRemote and applyLocal when it is sorted, non-overlapping, in range and made of integers and strings.
export function validateChanges (changes, length, who = 'changes') {
  must(Array.isArray(changes), 'SHAPE', `${who} is not an array: ${show(changes)}`)
  let prev = 0
  changes.forEach((c, i) => {
    const d = `${who}[${i}] = ${show(c)} against a text of length ${length}`
    must(c && Number.isInteger(c.from) && Number.isInteger(c.to) && typeof c.insert === 'string', 'SHAPE', `${d}: needs integer from/to and a string insert`)
    must(c.from >= prev, 'SHAPE', `${d}: not sorted/non-overlapping (previous change ended at ${prev})`)
    must(c.to >= c.from && c.to <= length, 'SHAPE', `${d}: out of range`)
    must(c.to > c.from || c.insert.length > 0, 'SHAPE', `${d}: an empty change (nothing deleted, nothing inserted) must not be reported`)
    prev = c.to
  })
}
export const isHigh = u => u >= 0xD800 && u <= 0xDBFF
export const isLow = u => u >= 0xDC00 && u <= 0xDFFF
export const splitsPair = (text, i) => i > 0 && i < text.length && isHigh(text.charCodeAt(i - 1)) && isLow(text.charCodeAt(i))
export const hasLoneSurrogate = s => { for (let i = 0; i < s.length; i++) { const u = s.charCodeAt(i); if (isHigh(u) && isLow(s.charCodeAt(i + 1))) i++; else if (isHigh(u) || isLow(u)) return true } return false }

// A random valid changeset for `text`: 1 to 3 changes, sorted, never overlapping (they may touch), inserts/deletes/replaces/empty ones.
// `tokens` is the author's alphabet (each token is typed as one unit); `safe` keeps every boundary off the middle of a surrogate pair.
export function randomChanges (r, text, tokens, safe = false, insertOnly = false) {
  const n = text.length; const out = []; let cursor = 0
  const snap = i => { while (safe && splitsPair(text, i)) i++; return i }
  if (insertOnly) { const m = r.chance(0.6) ? 1 : r.range(2, 3); const at = Array.from({ length: m }, () => snap(r.int(n + 1))).sort((x, y) => x - y); for (const from of at) { let insert = ''; for (let j = r.range(1, 4); j > 0; j--) insert += r.pick(tokens); out.push({ from, to: from, insert }) } return out }
  const m = r.chance(0.6) ? 1 : r.range(2, 3)
  for (let k = 0; k < m && cursor <= n; k++) {
    const from = snap(Math.min(n, cursor + (r.chance(0.3) ? 0 : r.int(Math.min(n - cursor, 12) + 1))))
    let to = from
    if (r.chance(0.5)) to = snap(Math.min(n, from + r.range(1, 5)))
    let insert = ''
    if (r.chance(0.65)) for (let j = r.range(1, 4); j > 0; j--) insert += r.pick(tokens)
    if (to > from || insert) out.push({ from, to, insert })
    cursor = to
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------- fake awareness
// The y-protocols Awareness API that presence.js can rely on. exchangeAwareness copies states through JSON, like the wire does.
export class FakeAwareness {
  constructor (clientID) { this.clientID = clientID; this.states = new Map(); this.meta = new Map() }
  getStates () { return this.states }
  getLocalState () { return this.states.get(this.clientID) ?? null }
  setLocalState (s) { if (s === null) this.states.delete(this.clientID); else this.states.set(this.clientID, s) }
  setLocalStateField (k, v) { const s = this.getLocalState(); if (s === null) return this.setLocalState({ [k]: v }); this.setLocalState({ ...s, [k]: v }) }
  on () {}
  off () {}
}
export function exchangeAwareness (list) {
  for (const a of list) for (const b of list) {
    if (a === b) continue
    const s = a.getLocalState()
    if (s) b.states.set(a.clientID, JSON.parse(JSON.stringify(s))); else b.states.delete(a.clientID)
  }
}

// ---------------------------------------------------------------------------------------------------------------- the world
const NET = Symbol('net') // origin of updates that arrive over the (fake) network

export class Peer {
  constructor (world, index, spec) {
    this.world = world; this.index = index; this.name = spec.name; this.ai = !!spec.ai; this.model = spec.model || ''
    this.tokens = spec.tokens || [String.fromCharCode(97 + index)]; this.raw = !!spec.raw // raw = writes straight to the Y.Text like an agent process, no editor
    this.doc = new Y.Doc(); this.doc.clientID = world.ids ? world.ids[index] : 1000 + index * 7 + 1 // fixed ids: the order of same-position inserts is reproducible
    this.editor = { text: '' }; this.binding = null; this.ytext = null; this.awareness = new FakeAwareness(this.doc.clientID)
    this.remoteCalls = 0; this.remoteInfo = []
    this.doc.on('update', (update, origin) => { if (origin !== NET) world.msgs.push({ id: world.msgs.length, from: index, update }) })
  }

  // Look up (or create) the shared text and bind an editor to it. Called by the world once the structure is in every doc.
  bind (file) {
    const w = this.world
    this.ytext = file ? fileStore(this.doc).get(file) : this.doc.getText('t')
    if (this.raw) return
    this.binding = w.core.createBinding({ Y, ytext: this.ytext, user: { name: this.name, ai: this.ai, model: this.model } })
    this.unsubscribe = this.binding.onRemote((changes, info) => {
      const before = this.editor.text
      try {
        validateChanges(changes, before.length, `onRemote(${this.name})`)
        const viaCore = w.core.changesToText(before, changes)
        same(viaCore, refApply(before, changes), 'CHANGESTOTEXT', `changesToText disagrees with the reference for ${show(changes)} on ${show(before)}`)
        this.editor.text = viaCore; this.remoteCalls++; this.remoteInfo.push(info)
        if (w.check) same(viaCore, this.ytext.toString(), 'COORDS', `${this.name}: replaying onRemote's ${show(changes)} on the editor text ${show(before)} must give the Y.Text (changes must be in the coordinates BEFORE the change)`)
      } catch (e) { w.firstError ??= e; throw e }
    })
  }

  text () { return this.ytext.toString() }
  // Invariant checked after every step: what the (fake) editor shows is what the Y.Text holds.
  check () { if (this.binding && this.world.check) same(this.editor.text, this.ytext.toString(), 'DESYNC', `${this.name}: editor text and Y.Text differ`) }

  // Type: update the fake editor through changesToText, then hand the same changes to the binding, as the CodeMirror adapter does.
  type (changes) {
    validateChanges(changes, this.editor.text.length, `${this.name}.type`)
    this.editor.text = this.world.core.changesToText(this.editor.text, changes)
    this.binding.applyLocal(changes)
    this.check()
  }
  insertAt (i, s) { this.type([{ from: i, to: i, insert: s }]) }
  deleteRange (a, b) { this.type([{ from: a, to: b, insert: '' }]) }
  replace (a, b, s) { this.type([{ from: a, to: b, insert: s }]) }
  append (s) { this.insertAt(this.editor.text.length, s) }
  firstIndexOf (s) { const i = this.editor.text.indexOf(s); if (i < 0) throw new Fail('TEST', `${this.name}: ${show(s)} not in ${show(this.editor.text)}`); return i }
  canUndo () { return this.binding.canUndo() }
  canRedo () { return this.binding.canRedo() }
  undo () { const r = this.binding.undo(); this.check(); return r }
  redo () { const r = this.binding.redo(); this.check(); return r }
  async pause () { if (this.binding.stopCapturing) this.binding.stopCapturing(); else await new Promise(r => setTimeout(r, 700)) }
  // what an agent process does: write to the Y.Text directly, authorship attributes included
  rawInsert (i, s, attrs) { this.doc.transact(() => this.ytext.insert(i, s, attrs ?? { by: this.name, ai: true, model: 'nemotron', msg: 'm1', t: Math.floor(Date.now() / 60000) }), 'raw') }
  rawDelete (a, b) { this.doc.transact(() => this.ytext.delete(a, b - a), 'raw') }
}

export class World {
  // specs: [{ name, ai, model, tokens, raw }]. `nested` = a file name: the text lives at files.get(name) like in a room (relative positions then
  // point at a type id, not a root name). `check` = verify the editor against the Y.Text after every step (off for the 1 MB tests).
  constructor (core, specs, { nested = null, check = true, ids = null } = {}) {
    this.core = core; this.check = check; this.ids = ids; this.msgs = []; this.nested = nested; this.firstError = null
    this.peers = specs.map((s, i) => new Peer(this, i, s))
    if (nested) {
      const p0 = this.peers[0]; p0.doc.transact(() => fileStore(p0.doc).set(nested, new Y.Text()), 'setup')
      this.deliverEverything()
    }
    for (const p of this.peers) p.bind(nested)
  }
  get a () { return this.peers[0] }
  get b () { return this.peers[1] }
  get c () { return this.peers[2] }
  get d () { return this.peers[3] }
  get people () { return this.peers.filter(p => !p.raw) }

  delivered = new Set()
  deliver (to, msgId) {
    const m = this.msgs[msgId]; if (!m || m.from === to) return false
    Y.applyUpdate(this.peers[to].doc, m.update, NET); this.delivered.add(to + ':' + msgId)
    this.peers[to].check(); return true
  }
  isDelivered (to, msgId) { return this.delivered.has(to + ':' + msgId) }
  pending () { const out = []; for (const m of this.msgs) for (const p of this.peers) if (p.index !== m.from && !this.isDelivered(p.index, m.id)) out.push([p.index, m.id]); return out }
  // Delivering an update can make the receiver emit a new one (Yjs cleans up redundant formatting after a remote change, in its own transaction),
  // so both loops run until nothing is pending. Without that the peers would differ in what they deleted, not in their text.
  // in the order the updates were made
  deliverEverything () { for (let guard = 0; guard < 100; guard++) { const list = this.pending(); if (!list.length) return; for (const [to, id] of list) this.deliver(to, id) } throw new Fail('LIVELOCK', 'updates keep producing updates') }
  // a random order, with some duplicates: what an unreliable network does
  drain (r) {
    for (let guard = 0; guard < 100; guard++) {
      const list = r.shuffle(this.pending()); if (!list.length) return
      for (const [to, id] of list) { this.deliver(to, id); if (r.chance(0.2)) this.deliver(to, id) }
    }
    throw new Fail('LIVELOCK', 'updates keep producing updates')
  }
  // Quiet: deliver everything, let every binding re-apply its authorship where another peer's delete took the markers (binding.heal(), which the
  // binding also runs by itself 150 ms after a remote delete), and repeat until nothing changes. Synchronous, so the fuzzers stay fast.
  settle (r = null) {
    for (let guard = 0; guard < 50; guard++) {
      r ? this.drain(r) : this.deliverEverything()
      let healed = 0; for (const p of this.peers) if (p.binding && p.binding.heal) healed += p.binding.heal()
      if (!healed && !this.pending().length) return
    }
    throw new Fail('LIVELOCK', 'healing keeps producing changes')
  }
  // a reconnect: each side sends the other what it is missing (sync step 1 and 2 of the Yjs protocol)
  reconnect (i, j) {
    const A = this.peers[i].doc; const B = this.peers[j].doc
    Y.applyUpdate(B, Y.encodeStateAsUpdate(A, Y.encodeStateVector(B)), NET); this.peers[j].check()
    Y.applyUpdate(A, Y.encodeStateAsUpdate(B, Y.encodeStateVector(A)), NET); this.peers[i].check()
  }
  reconnectAll () { for (let i = 0; i < this.peers.length; i++) for (let j = i + 1; j < this.peers.length; j++) this.reconnect(i, j); for (let i = 0; i < this.peers.length; i++) for (let j = i + 1; j < this.peers.length; j++) this.reconnect(i, j) }

  // Everyone identical: the Y.Text, every editor, no update left pending, equal state vectors. Throws a Fail otherwise.
  assertConverged (label = '') {
    const ref = this.peers[0]; const want = ref.text()
    for (const p of this.peers) {
      must(p.doc.store.pendingStructs === null && p.doc.store.pendingDs === null, 'PENDING', `${label} ${p.name}: updates are stuck waiting for a missing one`)
      same(p.text(), want, 'DIVERGED', `${label} Y.Text of ${p.name} vs ${ref.name}`)
      if (p.binding) same(p.editor.text, want, 'EDITOR', `${label} editor of ${p.name} vs the shared text`)
    }
    const sv = Buffer.from(Y.encodeStateVector(ref.doc)).toString('hex')
    for (const p of this.peers) must(Buffer.from(Y.encodeStateVector(p.doc)).toString('hex') === sv, 'STATEVECTOR', `${label} ${p.name}: state vector differs, some update did not arrive`)
    const deltaKey = JSON.stringify(ref.ytext.toDelta())
    for (const p of this.peers) if (JSON.stringify(p.ytext.toDelta()) !== deltaKey) throw new Fail('ATTRS', `${label} ${p.name} and ${ref.name} hold the same text but different authorship attributes`)
    // a peer that joins from nothing and gets the state in one piece must read the same text
    const fresh = new Y.Doc(); Y.applyUpdate(fresh, Y.encodeStateAsUpdate(ref.doc))
    const ft = this.nested ? fileStore(fresh).get(this.nested) : fresh.getText('t')
    same(ft.toString(), want, 'FRESH', `${label} a new peer reading the full state`)
    return want
  }
  destroy () { for (const p of this.peers) { p.binding && p.binding.destroy(); p.doc.destroy() } }
}

// Per-character view of a Y.Text: [{ ch, attrs }] (attrs = the formatting attributes, without nulls)
export function charsOf (ytext) {
  const out = []
  for (const op of ytext.toDelta()) if (typeof op.insert === 'string') for (const ch of op.insert) out.push({ ch, attrs: op.attributes || {}, unit: ch.length })
  return out
}
// Authorship of the UTF-16 unit at `index`
export function attrsAt (ytext, index) {
  let i = 0
  for (const op of ytext.toDelta()) { if (typeof op.insert !== 'string') continue; if (index < i + op.insert.length) return op.attributes || {}; i += op.insert.length }
  return null
}
// Runs of equal authorship: [{ text, attrs }]
export const runsOf = ytext => ytext.toDelta().filter(op => typeof op.insert === 'string').map(op => ({ text: op.insert, attrs: op.attributes || {} }))

// Pretend it is a given moment for Date.now (the binding stamps `t` from it). Yjs' undo timer keeps the real clock.
export function withClock (ms, fn) {
  const real = Date.now; let now = ms
  Date.now = () => now
  const set = v => { now = v }
  const done = () => { Date.now = real }
  let out
  try { out = fn(set) } catch (e) { done(); throw e }
  if (out && typeof out.then === 'function') return out.finally(done)
  done(); return out
}

// ---------------------------------------------------------------------------------------------------------------- runner
export function createSuite (title) {
  const tests = []
  return {
    test (name, fn, o = {}) { tests.push({ name, fn, ...o }) },
    async run () {
      if (args.list) { for (const t of tests) console.log(t.name); return 0 }
      let pass = 0; const failed = []; const started = Date.now()
      const want = t => !args.only || t.name.toLowerCase().includes(String(args.only).toLowerCase())
      for (const t of tests.filter(want)) {
        const t0 = Date.now()
        try { const note = await t.fn(); pass++; console.log(`  ok    ${t.name}${note ? '  (' + note + ')' : ''}  [${Date.now() - t0} ms]`) } catch (e) {
          failed.push(t.name); console.log(`  FAIL  ${t.name}  [${Date.now() - t0} ms]\n${String(e && e.message || e).split('\n').map(l => '        ' + l).join('\n')}`)
          if (!(e instanceof Fail) && !(e && e.name === 'AssertionError') && e && e.stack) console.log(String(e.stack).split('\n').filter(l => l.trim().startsWith('at ')).slice(0, 4).map(l => '        ' + l.trim()).join('\n'))
        }
      }
      const total = pass + failed.length
      if (failed.length) { console.log(`\n${title}: ${failed.length} of ${total} FAILED: ${failed.join('; ')}`); return 1 }
      console.log(`\n${title}: ${pass} of ${total} tests passed (${((Date.now() - started) / 1000).toFixed(1)} s)`)
      return 0
    }
  }
}
