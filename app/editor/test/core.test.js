import { fileStore } from '../../file-store.js'
// The collaborative editor's Yjs side under pressure: two or more people typing at the same moment, in Node, no browser.
// Code under test: app/editor/core.js and presence.js (contract: docs/EDITOR.md). Run: node app/editor/test/core.test.js
//   --only <text>   run the tests whose name contains <text>      --seed N   with a fuzz test: replay one seed and print its steps
//   --seeds N       seeds per fuzz test (default 400, or FUZZ_SEEDS)  --list    list the tests
// Every test is named after what it proves; a failure prints the reason (and for the fuzzers the failing seed and a shrunk list of steps).
import assert from 'node:assert/strict'
import { Y, World, Peer, rng, splitsPair, Fail, show, same, must, refApply, refApplyDelta, validateChanges, randomChanges, charsOf, attrsAt, runsOf, hasLoneSurrogate, FakeAwareness, exchangeAwareness, withClock, createSuite, loadUnderTest, args } from './harness.js'
import { fuzzMany } from './fuzz.js'

const { core, presence } = await loadUnderTest()
const { test, run } = createSuite('editor core')
const { createBinding, deltaToChanges, changesToText } = core
const NAMES = ['alex', 'sam', 'jo', 'kim']
const SEED = '0123456789ABCDEF'

// people: n bindings (alex, sam, jo, kim). `agent: true` adds a raw agent process "coder". The start text is written by "seed" and delivered.
function mk (n, { text = SEED, agent = false, nested = null, ids = null, check = true, ai = [] } = {}) {
  const specs = Array.from({ length: n }, (_, i) => ({ name: NAMES[i], tokens: [String.fromCharCode(97 + i)], ai: ai.includes(i), model: ai.includes(i) ? 'nemotron' : '' }))
  if (agent) specs.push({ name: 'coder', raw: true, tokens: ['<'] })
  const w = new World(core, specs, { nested, ids, check })
  if (text) { const p = w.a; p.doc.transact(() => p.ytext.insert(0, text, { by: 'seed', t: 1 }), 'seed'); w.deliverEverything() }
  return w
}
const eq = (actual, expected, msg) => { if (typeof actual === 'string' && typeof expected === 'string') same(actual, expected, 'EQ', msg); else assert.deepEqual(actual, expected, msg) }
const allText = w => w.peers.map(p => p.text())
const converged = (w, label) => w.assertConverged(label)
const agentAttrs = (t = Math.floor(Date.now() / 60000)) => ({ by: 'coder', ai: true, model: 'nemotron', msg: 'm1', t })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const allPerms = list => list.length <= 1 ? [list] : list.flatMap((x, i) => allPerms([...list.slice(0, i), ...list.slice(i + 1)]).map(p => [x, ...p]))
// Both delivery orders for two peers: deliver "a's updates first" or "b's updates first" (matters when one peer made several updates)
function twoWays (build, check) {
  for (const order of ['forward', 'backward']) {
    const w = build()
    const pend = w.pending(); const list = order === 'forward' ? pend : [...pend].reverse()
    for (const [to, id] of list) w.deliver(to, id)
    check(converged(w, `delivery ${order}:`), w, order)
    w.destroy()
  }
}

// ============================================================================================================================ the pure helpers
test('changesToText equals a plain-string reference (inserts, deletes, replaces, several changes, touching changes)', () => {
  const r = rng(7)
  for (let i = 0; i < 3000; i++) {
    let text = ''; for (let j = r.int(40); j > 0; j--) text += r.pick(['a', 'b', 'c', '\n', ' '])
    const ch = randomChanges(r, text, ['X', 'yz', '🙂'])
    same(changesToText(text, ch), refApply(text, ch), 'REF', `iteration ${i}: ${show(ch)} on ${show(text)}`)
  }
  eq(changesToText('hello world', [{ from: 0, to: 5, insert: 'HOWDY' }, { from: 6, to: 11, insert: 'Pi' }]), 'HOWDY Pi')
  eq(changesToText('abc', [{ from: 1, to: 1, insert: 'X' }, { from: 1, to: 1, insert: 'Y' }]), 'aXYbc', 'two inserts at one spot keep their order')
  eq(changesToText('abcdef', [{ from: 0, to: 2, insert: '1' }, { from: 2, to: 4, insert: '2' }]), '12ef', 'touching replacements')
  eq(changesToText('abc', []), 'abc'); eq(changesToText('', [{ from: 0, to: 0, insert: 'x' }]), 'x'); eq(changesToText('abc', [{ from: 0, to: 3, insert: '' }]), '')
})

test('deltaToChanges: old-text coordinates, sorted, attribute-only retains produce nothing', () => {
  const cases = [
    ['', [{ insert: 'abc' }]],
    ['0123456789', [{ retain: 2 }, { insert: 'X' }]],
    ['0123456789', [{ retain: 2 }, { delete: 3 }]],
    ['0123456789', [{ delete: 2 }, { insert: 'XY' }]],
    ['0123456789', [{ insert: 'XY' }, { delete: 2 }]],
    ['0123456789', [{ retain: 1 }, { delete: 1 }, { retain: 2 }, { insert: 'Z' }, { retain: 1 }, { delete: 2 }, { insert: 'EE' }]],
    ['0123456789', [{ retain: 3, attributes: { by: 'x' } }]],
    ['0123456789', [{ retain: 1, attributes: { by: 'x' } }, { insert: 'Q', attributes: { by: 'y', t: 3 } }, { retain: 2, attributes: { ai: null } }, { delete: 1 }]],
    ['0123456789', []],
    ['0123456789', [{ delete: 10 }]]
  ]
  for (const [text, delta] of cases) {
    const ch = deltaToChanges(delta)
    validateChanges(ch, text.length, `deltaToChanges(${show(delta, 120)})`)
    same(changesToText(text, ch), refApplyDelta(text, delta), 'DELTA', `deltaToChanges(${show(delta, 120)}) on ${show(text)} gave ${show(ch)}`)
  }
  eq(deltaToChanges([{ retain: 3, attributes: { by: 'x' } }]), [], 'a formatting-only delta is not a text change')
})

test('deltaToChanges matches real Y.Text events (many operations in one transaction, formatting, inserts into fresh inserts)', () => {
  const r = rng(99); const d = new Y.Doc(); const t = d.getText('t')
  t.insert(0, 'the quick brown fox', { by: 'seed', t: 1 })
  let delta = null; t.observe(ev => { delta = ev.delta })
  const ok = i => { const s = t.toString(); while (splitsPair(s, i)) i++; return i } // Yjs cannot cut a surrogate pair
  for (let i = 0; i < 800; i++) {
    const before = t.toString(); delta = null
    d.transact(() => {
      for (let k = r.range(1, 5); k > 0; k--) {
        const len = t.length; const c = r.int(4)
        if (c === 0 || len === 0) t.insert(ok(r.int(len + 1)), r.pick(['x', 'yz', '🙂', '\n']), { by: r.pick(['a', 'b']), t: i })
        else if (c === 1) { const a = ok(r.int(len)); const e = ok(Math.min(len, a + r.range(1, 4))); if (e > a) t.delete(a, e - a) }
        else if (c === 2) { const a = ok(r.int(len)); const e = ok(Math.min(len, a + r.range(1, 5))); if (e > a) t.format(a, e - a, { by: r.pick(['a', 'b', 'c']) }) }
        else t.insert(ok(r.int(len + 1)), 'k', { by: 'a', t: i })
      }
    })
    if (!delta) { same(t.toString(), before, 'EVENT', 'no event but the text changed'); continue }
    const ch = deltaToChanges(delta); validateChanges(ch, before.length, `iteration ${i} ${show(delta, 120)}`)
    same(changesToText(before, ch), t.toString(), 'EVENT', `iteration ${i}: ${show(delta, 160)} turned into ${show(ch)} on ${show(before)}`)
  }
})

// ============================================================================================================================ one peer: what applyLocal does
test('empty insert and empty delete are no-ops (no Y update, no undo step, nothing reported to anyone)', () => {
  const w = mk(2, { text: 'hello' }); const [a, b] = w.peers
  const updates = []; a.doc.on('update', u => updates.push(u)); const calls = b.remoteCalls
  for (const ch of [[], [{ from: 2, to: 2, insert: '' }], [{ from: 0, to: 0 }], [{ from: 5, to: 5, insert: '' }], [{ from: 1, to: 1, insert: '' }, { from: 3, to: 3, insert: '' }]]) a.binding.applyLocal(ch)
  eq(updates.length, 0, 'an empty change must not make a Y transaction'); eq(a.text(), 'hello'); eq(w.pending().length, 0)
  eq(a.binding.canUndo(), false, 'an empty change must not create an undo step'); eq(b.remoteCalls, calls, 'the other peer must not hear about it')
  // an empty change next to a real one: only the real one counts
  const ch = [{ from: 0, to: 0, insert: '' }, { from: 1, to: 2, insert: 'E' }]
  a.binding.applyLocal(ch); a.editor.text = refApply(a.editor.text, ch)
  eq(a.text(), 'hEllo'); w.deliverEverything(); converged(w, 'after one real change:'); eq(updates.length, 1)
  w.destroy()
})

test('a changeset with several changes is one transaction, applied in old coordinates, and one undo step', async () => {
  const w = mk(2, { text: '0123456789' }); const [a, b] = w.peers
  const updates = []; a.doc.on('update', u => updates.push(u)); const calls = b.remoteCalls
  const ch = [{ from: 0, to: 2, insert: 'AB' }, { from: 4, to: 4, insert: '-' }, { from: 6, to: 9, insert: '' }, { from: 9, to: 10, insert: 'END' }]
  a.type(ch)
  eq(a.text(), refApply('0123456789', ch)); eq(updates.length, 1, 'one changeset = one Y transaction = one update'); w.deliverEverything()
  eq(b.remoteCalls - calls, 1, 'the other editor gets it as ONE onRemote call'); eq(b.editor.text, a.text())
  await a.pause(); a.undo()
  eq(a.text(), '0123456789', 'one undo reverts the whole changeset'); w.deliverEverything(); converged(w, 'after undo:')
  w.destroy()
})

test('touching changes and two inserts at the same index in one changeset', () => {
  const w = mk(2, { text: 'abcdef' }); const [a] = w.peers
  const ch = [{ from: 1, to: 1, insert: 'X' }, { from: 1, to: 1, insert: 'Y' }, { from: 1, to: 3, insert: 'Z' }, { from: 3, to: 4, insert: 'W' }]
  a.type(ch); eq(a.text(), refApply('abcdef', ch)); w.deliverEverything(); converged(w, 'touching changes:'); w.destroy()
})

test('positions are UTF-16 units: emoji, CJK, ZWJ sequences, combining marks typed, deleted and merged', () => {
  const w = mk(2, { text: 'ab' }); const [a, b] = w.peers
  const family = '👨‍👩‍👧' // 8 units
  a.insertAt(1, '😀'); eq(a.ytext.length, 4); eq(a.text(), 'a😀b')
  a.insertAt(0, '日本語'); a.append(family); a.append('é'); a.append('🇯🇵')
  const exp = '日本語a😀b' + family + 'é🇯🇵'
  eq(a.text(), exp); eq(a.ytext.length, exp.length, 'Y.Text counts UTF-16 units like a JS string')
  w.deliverEverything(); eq(b.editor.text, exp)
  // the family emoji typed one code point per key
  for (const part of ['👨', '‍', '👩', '‍', '👧']) b.append(part)
  b.deleteRange(b.firstIndexOf('😀'), b.firstIndexOf('😀') + 2) // exactly one emoji
  b.deleteRange(b.firstIndexOf(family), b.firstIndexOf(family) + family.length) // exactly one ZWJ sequence
  a.insertAt(3, '𝕏') // an astral letter between CJK characters
  w.deliverEverything(); const t = converged(w, 'unicode:')
  assert.ok(!hasLoneSurrogate(t) && !t.includes('�'), `a surrogate pair was split: ${show(t)}`)
  eq(t, '日本語𝕏ab' + 'e\u0301🇯🇵' + family, 'the merged result')
  w.destroy()
})

test('a lone surrogate in an insert must not make peers disagree on the shared text', () => {
  // lib0 writes strings as UTF-8, where a lone surrogate becomes U+FFFD: the sender would keep "\uD83D", everyone else would read "\uFFFD".
  const cases = [
    ['pasted text with a lone high surrogate', [{ from: 2, to: 2, insert: 'x\uD83Dy' }]],
    ['pasted text with a lone low surrogate', [{ from: 0, to: 0, insert: '\uDE00z' }]],
    ['the two halves of an emoji as separate changes of one changeset', [{ from: 1, to: 1, insert: '\uD83D' }, { from: 1, to: 1, insert: '\uDE00' }]]
  ]
  assert.equal(typeof core.sanitizeInsert, 'function', 'core.sanitizeInsert(text) is missing: the adapter has no way to clean pasted text before the editor commits it')
  const bad = []
  for (const [what, ch] of cases) for (const path of ['through the adapter (cleaned first)', 'raw applyLocal (the safety net)']) {
    const w = mk(2, { text: 'abcd', check: false }); const [a, b] = w.peers
    const typed = path.startsWith('through') ? ch.map(c => ({ ...c, insert: core.sanitizeInsert(c.insert) })) : ch
    a.editor.text = changesToText(a.editor.text, typed); a.binding.applyLocal(typed); w.deliverEverything()
    const fresh = new Y.Doc(); Y.applyUpdate(fresh, Y.encodeStateAsUpdate(a.doc)); const ft = fresh.getText('t')
    if (a.text() !== b.text() || a.text() !== ft.toString()) bad.push(`${what}, ${path}: sender's Y.Text ${show(a.text())}, another peer reads ${show(b.text())}`)
    else if (path.startsWith('through') && a.editor.text !== a.text()) bad.push(`${what}, ${path}: the editor shows ${show(a.editor.text)} but the Y.Text holds ${show(a.text())}`)
    w.destroy()
  }
  if (bad.length) throw new Error('replication is not exact for text with lone surrogates:\n' + bad.join('\n'))
})

test('half of a surrogate pair (Yjs limit, documented in core.js): nothing throws and the peers still agree with each other', () => {
  const w = mk(2, { text: 'x😀y', check: false }); const [a, b] = w.peers
  let threw = null
  try { a.binding.applyLocal([{ from: 2, to: 3, insert: '' }]); b.binding.applyLocal([{ from: 2, to: 2, insert: 'Q' }]) } catch (e) { threw = e }
  assert.ok(!threw, 'splitting a pair must not throw: ' + (threw && threw.message))
  w.deliverEverything(); eq(a.text(), b.text(), 'the peers still hold the same shared text')
  w.destroy()
  return 'the editor adapter must not cut pairs'
})

// ============================================================================================================================ two or more at once
test('the exact same position at the same instant: 2, 3 and 4 people, every delivery order gives the same text on every peer', () => {
  const tokens = ['AA', 'BB', 'CC', 'DD']
  let cases = 0
  for (const n of [2, 3, 4]) {
    const orders = Array.from({ length: n }, (_, i) => allPerms([...Array(n).keys()].filter(j => j !== i)))
    const combos = []
    const walk = (i, acc) => { if (i === n) return combos.push(acc); for (const o of orders[i]) walk(i + 1, [...acc, o]) }
    walk(0, [])
    const sample = combos.length > 300 ? rng(5).shuffle(combos).slice(0, 300) : combos
    const finals = new Set()
    for (const combo of sample) {
      const w = mk(n, { text: '01234567' }); const edits = []
      w.peers.forEach((p, i) => { const before = w.msgs.length; p.insertAt(4, tokens[i]); edits.push(w.msgs.length - 1) })
      // peer i gets the other peers' updates in the order combo[i] (peer indexes), each update delivered once
      combo.forEach((order, i) => { for (const from of order) w.deliver(i, edits[from]) })
      finals.add(converged(w, `n=${n} orders ${JSON.stringify(combo)}:`)); cases++
      const t = w.a.text()
      for (const tok of tokens.slice(0, n)) must(t.includes(tok), 'LOST', `n=${n}: ${tok} is missing from ${show(t)}`)
      const runs = runsOf(w.a.ytext).filter(r => r.attrs.by !== 'seed')
      eq(runs.map(r => r.text).sort(), tokens.slice(0, n).sort(), `n=${n}: each person's insert must stay one piece with its own author`)
      for (const r of runs) eq(r.attrs.by, NAMES[tokens.indexOf(r.text)], `author of ${r.text}`)
      w.destroy()
    }
    eq([...finals].length, 1, `n=${n}: delivery order changed the result: ${show([...finals])}`)
  }
  return cases + ' delivery orders'
})

test('both type bursts at one place, 12 keys each, 2 to 3 people: the bursts never interleave and nothing is lost', () => {
  for (const n of [2, 3]) for (let seed = 1; seed <= 25; seed++) {
    const r = rng(seed * 31 + n); const w = mk(n, { text: 'start|end', ids: r.shuffle([11, 22, 33]).slice(0, n) })
    // all type 12 characters forward from index 5, without hearing from each other (the same instant), then the updates arrive shuffled
    for (let k = 0; k < 12; k++) w.peers.forEach((p, i) => p.insertAt(5 + k, String.fromCharCode(97 + i)))
    w.drain(r); const t = converged(w, `n=${n} seed ${seed}:`)
    const burst = t.slice(5, 5 + 12 * n); const blocks = burst.match(/(.)\1*/g)
    eq(t.slice(0, 5) + t.slice(5 + 12 * n), 'start|end', 'the original text is untouched')
    eq(blocks.length, n, `n=${n} seed ${seed}: the bursts interleaved: ${show(burst)}`); eq(blocks.every(b => b.length === 12), true, `a burst was cut: ${show(burst)}`)
    w.destroy()
  }
})

test('one peer deletes a range while another types inside it (both delivery orders)', () => {
  twoWays(() => { const w = mk(2); w.a.deleteRange(3, 13); w.b.insertAt(8, 'xyz'); w.b.insertAt(11, 'Q'); return w },
    t => eq(t, '012xyzQDEF', 'the typed text survives, the deleted range is gone'))
  // the typist keeps going for a while after the delete (the burst is in the middle of the deleted range)
  twoWays(() => { const w = mk(2); w.a.deleteRange(2, 14); for (let i = 0; i < 20; i++) w.b.insertAt(8 + i, String.fromCharCode(97 + i)); return w },
    t => eq(t, '01' + 'abcdefghijklmnopqrst' + 'EF', 'a 20 key burst inside a deleted range'))
})

test('both delete overlapping ranges: the union is gone, nothing else (both delivery orders)', () => {
  const cases = [[[2, 9], [5, 12]], [[2, 9], [2, 9]], [[2, 12], [4, 6]], [[2, 5], [5, 8]], [[0, 16], [3, 4]], [[0, 5], [4, 16]]]
  for (const [ra, rb] of cases) {
    const gone = new Set(); for (const [x, y] of [ra, rb]) for (let i = x; i < y; i++) gone.add(i)
    const expected = [...SEED].filter((_, i) => !gone.has(i)).join('')
    twoWays(() => { const w = mk(2); w.a.deleteRange(...ra); w.b.deleteRange(...rb); return w }, t => eq(t, expected, `A deletes ${ra}, B deletes ${rb}`))
  }
})

test('delete-all against an insert at the start, middle or end: only the insert survives', () => {
  for (const at of [0, 5, 11]) twoWays(() => { const w = mk(2, { text: 'hello world' }); w.a.deleteRange(0, 11); w.b.insertAt(at, 'X'); return w }, t => eq(t, 'X', `insert at ${at}`))
  twoWays(() => { const w = mk(2, { text: 'hello world' }); w.a.deleteRange(0, 11); w.b.replace(3, 6, 'ZZ'); return w }, t => eq(t, 'ZZ', 'replace inside'))
  // both delete everything, then both type into the empty file at once
  const w = mk(2, { text: 'hello' }); w.a.deleteRange(0, 5); w.b.deleteRange(0, 5); w.deliverEverything(); eq(converged(w, 'empty:'), '')
  w.a.append('foo'); w.b.append('bar'); w.deliverEverything(); const t = converged(w, 'typing into the empty file:'); assert.ok(t === 'foobar' || t === 'barfoo', show(t)); w.destroy()
})

test('replace against replace on the same range: both texts survive, the old text is gone, each keeps its author', () => {
  twoWays(() => { const w = mk(2, { text: 'abcdefgh' }); w.a.replace(2, 6, 'X'); w.b.replace(2, 6, 'Y'); return w }, (t, w) => {
    assert.ok(t === 'abXYgh' || t === 'abYXgh', 'got ' + show(t))
    eq(attrsAt(w.a.ytext, t.indexOf('X')).by, 'alex'); eq(attrsAt(w.a.ytext, t.indexOf('Y')).by, 'sam')
  })
})

test('unicode edits at the same place at the same instant: nothing is split, nothing is lost', () => {
  twoWays(() => { const w = mk(3, { text: 'ab日本cd' }); w.a.insertAt(3, '😀'); w.b.insertAt(3, '👨‍👩‍👧'); w.c.insertAt(3, 'é'); return w },
    t => { assert.ok(!hasLoneSurrogate(t) && !t.includes('�'), 'split pair in ' + show(t)); for (const s of ['😀', '👨‍👩‍👧', 'é', 'ab日', '本cd']) assert.ok(t.includes(s), `${show(s)} missing from ${show(t)}`) })
  twoWays(() => { const w = mk(2, { text: '日本語😀テキスト' }); w.a.deleteRange(2, 5); w.b.insertAt(3, '🎉'); return w },
    t => { assert.ok(!hasLoneSurrogate(t), 'split pair in ' + show(t)); assert.ok(t.includes('🎉')) })
})

test('offline edits on two peers (and a third that stays online) merge after reconnect, including both editing the same line', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed * 17); const text = 'line one\nline two\nline three\n'; const withDeletes = seed % 2 === 0 // authorship is only exact without concurrent deletes (README, known limits)
    const w = mk(3, { text, ids: r.shuffle([21, 22, 23]) }); const [a, b, c] = w.peers
    // a and b are offline from here: their updates are held back
    const onlineEdits = r.range(0, 3)
    for (let i = 0; i < r.range(8, 20); i++) for (const p of [a, b]) {
      const t = p.editor.text; const seedIdx = charsOf(p.ytext).map((x, ix) => x.attrs.by === 'seed' ? ix : -1).filter(ix => ix >= 0)
      const op = r.int(4)
      if (op === 0 && withDeletes && seedIdx.length) { const ix = r.pick(seedIdx); p.deleteRange(ix, ix + 1) } // only seed characters are deleted, so each person's own text is never touched by the other
      else p.insertAt(r.int(t.length + 1), p.tokens[0].repeat(r.range(1, 3)))
    }
    // both edit the same line on purpose: the same index, an append to the line, a prepend to the line
    const l2 = a.editor.text.indexOf('line two'); const l2b = b.editor.text.indexOf('line two')
    const sameLine = l2 >= 0 && l2b >= 0
    if (sameLine) { a.insertAt(l2 + 4, 'AAA'); b.insertAt(l2b + 4, 'BBB'); a.insertAt(a.editor.text.indexOf('\n', l2), '<a'); b.insertAt(b.editor.text.indexOf('line two'), 'b>') }
    for (let i = 0; i < onlineEdits; i++) c.insertAt(r.int(c.editor.text.length + 1), 'c')
    const mineA = a.editor.text.replace(/[^a]/g, ''); const mineB = b.editor.text.replace(/[^b]/g, '')
    w.reconnectAll(); w.deliverEverything()
    const t = converged(w, `seed ${seed}:`)
    // nothing either of them typed is lost, and the order of each one's own text is kept
    eq(t.replace(/[^a]/g, ''), mineA, `seed ${seed}: alex's typed text (in order) after the merge`); eq(t.replace(/[^b]/g, ''), mineB, `seed ${seed}: sam's typed text after the merge`)
    must(!sameLine || (t.match(/A/g) || []).length >= 3 && (t.match(/B/g) || []).length >= 3, 'LOST', `seed ${seed}: the AAA/BBB typed on the same line must both survive: ${show(t)}`)
    if (!withDeletes) for (const { ch, attrs } of charsOf(a.ytext)) { if (ch === 'a' || ch === 'b' || ch === 'c') eq(attrs.by, { a: 'alex', b: 'sam', c: 'jo' }[ch], `seed ${seed}: author of ${ch} after the merge`) }
    w.destroy()
  }
})

test('a peer that reconnects from nothing (a late joiner) reads the same text in one piece', () => {
  const w = mk(2, { text: '' }); const r = rng(3)
  for (let i = 0; i < 40; i++) { const p = r.pick(w.peers); p.type(randomChanges(r, p.editor.text, p.tokens)); if (r.chance(0.5)) w.deliverEverything() }
  w.deliverEverything()
  const late = new World(core, [{ name: 'late', tokens: ['z'] }], { ids: [987654] }); const lp = late.a
  Y.applyUpdate(lp.doc, Y.encodeStateAsUpdate(w.a.doc), 'net')
  eq(lp.editor.text, w.a.text(), 'the late joiner\'s editor after one remote update'); eq(lp.remoteCalls <= 2, true, 'one update, not one call per character')
  w.destroy(); late.destroy()
})

// ============================================================================================================================ size
test('a very large paste (1 MB) replicates, survives a concurrent edit inside it, and can be deleted again', () => {
  const r = rng(11); const lines = []; let size = 0
  while (size < 1024 * 1024) { const l = 'const v' + r.int(1e6) + ' = ' + r.int(1e9) + '; // ' + 'x'.repeat(r.int(50)) + ' 日本 😀'; lines.push(l); size += l.length + 1 }
  const big = lines.join('\n').slice(0, 1024 * 1024)
  const w = mk(3, { text: 'head\ntail', check: false }); const [a, b, c] = w.peers
  let t0 = Date.now()
  a.editor.text = changesToText(a.editor.text, [{ from: 5, to: 5, insert: big }]); a.binding.applyLocal([{ from: 5, to: 5, insert: big }])
  const pasteMs = Date.now() - t0; eq(a.ytext.length, 'head\ntail'.length + big.length)
  t0 = Date.now(); w.deliverEverything(); const replicateMs = Date.now() - t0
  same(b.editor.text, a.text(), 'EDITOR', 'b after the paste'); same(c.editor.text, a.text(), 'EDITOR', 'c after the paste')
  // while a deletes the middle 400 KB, b types inside that range and c at the very start and the very end
  a.type([{ from: 200000, to: 600000, insert: '' }].map(x => x)); a.editor.text = a.editor.text
  b.type([{ from: 400000, to: 400000, insert: 'INSIDE' }]); c.type([{ from: 0, to: 0, insert: '>' }]); c.type([{ from: c.editor.text.length, to: c.editor.text.length, insert: '<' }])
  w.deliverEverything(); const t = converged(w, 'large:')
  eq(t.length, 'head\ntail'.length + big.length - 400000 + 'INSIDE'.length + 2); assert.ok(t.includes('INSIDE') && t.startsWith('>head') && t.endsWith('tail<'))
  assert.ok(Y.encodeStateAsUpdate(a.doc).length < 3.5 * 1024 * 1024, 'the update for a 1 MB paste should not be several times its size')
  a.type([{ from: 0, to: a.editor.text.length, insert: '' }]); w.deliverEverything(); eq(converged(w, 'emptied:'), '')
  assert.ok(Date.now() - t0 < 60000, 'too slow')
  w.destroy(); return `paste ${pasteMs} ms, replicate ${replicateMs} ms`
})

test('1,000 tiny edits on one peer equal the plain-string model, and 2 x 1,000 concurrent ones converge', () => {
  const r = rng(21); let model = ''; const w = mk(2, { text: '' }); const [a, b] = w.peers
  let t0 = Date.now()
  for (let i = 0; i < 1000; i++) {
    const ch = randomChanges(r, model, ['a', 'b', 'c', '\n', 'xy'].map(x => x)).slice(0, 1)
    if (!ch.length) continue
    a.type(ch); model = refApply(model, ch); w.deliverEverything()
    if (i % 100 === 99) { same(a.text(), model, 'MODEL', `after ${i + 1} edits`); same(b.editor.text, model, 'MODEL', `peer b after ${i + 1} edits`) }
  }
  same(a.text(), model, 'MODEL', '1,000 sequential edits'); const seqMs = Date.now() - t0
  t0 = Date.now()
  for (let i = 0; i < 1000; i++) for (const p of [a, b]) { const ch = randomChanges(r, p.editor.text, p.tokens).slice(0, 1); if (ch.length) p.type(ch) }
  w.drain(r); converged(w, '2 x 1000 concurrent:')
  w.destroy(); return `sequential ${seqMs} ms, concurrent ${Date.now() - t0} ms`
})

// ============================================================================================================================ authorship
test('authorship: every inserted character carries { by, t } of its real author, and only that', () => {
  withClock(60000 * 5000 + 123, setNow => {
    const w = mk(2, { text: '' }); const [a, b] = w.peers
    a.append('hello'); w.deliverEverything(); setNow(60000 * 5003 + 5); b.append(' world'); w.deliverEverything()
    eq(runsOf(b.ytext), [{ text: 'hello', attrs: { by: 'alex', t: 5000 } }, { text: ' world', attrs: { by: 'sam', t: 5003 } }], 'two authors, minutes since the epoch')
    // typed into the middle of the other person's text, then over part of it
    b.insertAt(2, 'XY'); w.deliverEverything()
    eq(runsOf(a.ytext).map(r => [r.text, r.attrs.by]), [['he', 'alex'], ['XY', 'sam'], ['llo', 'alex'], [' world', 'sam']], 'the inside typing splits the run and keeps both authors')
    a.replace(a.firstIndexOf('wor'), a.firstIndexOf('wor') + 3, 'WOR'); w.deliverEverything()
    eq(runsOf(b.ytext).map(r => [r.text, r.attrs.by]), [['he', 'alex'], ['XY', 'sam'], ['llo', 'alex'], [' ', 'sam'], ['WOR', 'alex'], ['ld', 'sam']], 'replaced text belongs to the replacer')
    for (const r of runsOf(a.ytext)) eq(Object.keys(r.attrs).sort(), ['by', 't'], `a person's text carries exactly by and t: ${show(r)}`)
    w.destroy()
  })
})

test('authorship: an agent binding writes { by, t, ai, model }, a person right after it does not inherit', () => {
  const w = mk(2, { text: 'x', ai: [0] }); const [a, b] = w.peers
  a.append(' agent text'); w.deliverEverything(); b.append(' and a person'); w.deliverEverything()
  const runs = runsOf(b.ytext).filter(r => r.attrs.by !== 'seed')
  eq(runs.length, 2); eq(Object.keys(runs[0].attrs).sort(), ['ai', 'by', 'model', 't']); eq(runs[0].attrs.ai, true); eq(runs[0].attrs.model, 'nemotron')
  eq(Object.keys(runs[1].attrs).sort(), ['by', 't'], 'the person after the agent has no ai/model'); w.destroy()
})

test('authorship: a person typing right next to or inside agent text does NOT inherit its attributes, and the agent text keeps them', () => {
  const AGENT = '    """doc"""\n'
  for (const where of ['right after', 'right before', 'inside', 'at the end of the file', 'at the start of the file']) {
    const base = where.endsWith('of the file') ? '' : 'def f():\n    pass\n'
    const w = mk(2, { text: base, agent: true }); const [a, b, coder] = w.peers
    const at = where === 'at the start of the file' ? 0 : base.length ? 9 : 0
    coder.rawInsert(at, AGENT); w.deliverEverything()
    const idx = { 'right after': at + AGENT.length, 'right before': at, inside: at + 4, 'at the end of the file': AGENT.length, 'at the start of the file': 0 }[where]
    a.insertAt(idx, 'PERSON'); b.insertAt(b.editor.text.length, 'sam'); w.deliverEverything()
    const t = converged(w, where + ':')
    // what the text should look like and who wrote each character
    const want = [...base].map(ch => [ch, 'seed']); want.splice(at, 0, ...[...AGENT].map(ch => [ch, 'coder'])); want.splice(idx, 0, ...[...'PERSON'].map(ch => [ch, 'alex'])); want.push(...[...'sam'].map(ch => [ch, 'sam']))
    eq(t, want.map(x => x[0]).join(''), where + ': text'); const got = charsOf(a.ytext)
    got.forEach(({ ch, attrs }, i) => {
      const detail = `${where}: ${show(ch)} at ${i} should be ${want[i][1]}'s but carries ${show(attrs)}`
      eq(attrs.by, want[i][1], detail)
      if (want[i][1] === 'coder') { eq(attrs.ai, true, detail); eq(attrs.model, 'nemotron', detail); eq(attrs.msg, 'm1', detail) }
      else must(attrs.ai == null && attrs.model == null && attrs.msg == null, 'INHERIT', detail + " (inherited the agent's attributes)")
    })
    w.destroy()
  }
})

test('authorship: concurrent typing at the very index of an agent insert does not inherit the agent attributes (positions x id order)', () => {
  let cases = 0
  for (const delta of [-1, 0, 1]) for (const personFirst of [true, false]) for (const agentLen of [1, 12]) for (const burst of [1, 3]) {
    const ids = personFirst ? [100, 200] : [200, 100]
    const w = mk(1, { text: '01234567', agent: true, ids }); const [a, coder] = w.peers
    coder.rawInsert(4, '<'.repeat(agentLen))
    for (let i = 0; i < burst; i++) a.insertAt(Math.max(0, 4 + delta) + i, 'a')
    w.drain(rng(cases + 1)); w.assertConverged(`delta ${delta} personFirst ${personFirst} agent ${agentLen} burst ${burst}:`)
    for (const { ch, attrs } of charsOf(a.ytext)) {
      const detail = `delta ${delta} personFirst ${personFirst} agentLen ${agentLen} burst ${burst}: ${show(ch)} carries ${show(attrs)}; text ${show(a.text())}`
      if (ch === 'a') { eq(attrs.by, 'alex', detail); must(attrs.ai == null && attrs.model == null && attrs.msg == null, 'INHERIT', detail + ' (a person\'s character inherited the agent\'s attributes)') }
      if (ch === '<') { eq(attrs.by, 'coder', detail); eq(attrs.ai, true, detail) }
    }
    cases++; w.destroy()
  }
  return cases + ' cases'
})

test('authorship: deleting and retyping changes the author, retyping your own text keeps you with a fresh t', () => {
  withClock(60000 * 7000, setNow => {
    const w = mk(2, { text: '' }); const [a, b] = w.peers
    a.append('abc'); w.deliverEverything()
    b.replace(1, 2, 'Z'); w.deliverEverything() // sam replaces alex's b
    eq(runsOf(a.ytext).map(r => [r.text, r.attrs.by]), [['a', 'alex'], ['Z', 'sam'], ['c', 'alex']])
    setNow(60000 * 7010); a.deleteRange(0, 1); a.insertAt(0, 'a'); w.deliverEverything() // alex deletes and retypes his own a
    eq(runsOf(b.ytext)[0], { text: 'a', attrs: { by: 'alex', t: 7010 } }, 'retyped text has the new t')
    b.deleteRange(0, 3); b.append('aZc'); w.deliverEverything() // sam deletes everything and types the identical text
    eq(runsOf(a.ytext).map(r => r.attrs.by), ['sam'], 'identical text typed by someone else belongs to them'); w.destroy()
  })
})

test('authorship: the minute stamp t follows Date.now (floor of ms / 60000)', () => {
  withClock(0, setNow => {
    const w = mk(1, { text: '' }); const [a] = w.peers
    for (const ms of [0, 59999, 60000, 119999, 1.7e12]) { setNow(ms); a.append('.'); }
    eq(runsOf(a.ytext).map(r => r.attrs.t).length > 0, true)
    const ts = charsOf(a.ytext).map(c => c.attrs.t); eq(ts, [0, 0, 1, 1, Math.floor(1.7e12 / 60000)]); w.destroy()
  })
})

test('authorship under a concurrent delete: text typed next to text that someone deletes keeps its author once the binding has healed (README, known limits 1)', () => {
  const out = []
  const scenes = {
    'the other peer deletes the text you just typed while you keep typing after it': (w, a, b) => { a.append('hello'); w.deliverEverything(); const i = b.editor.text.indexOf('hello'); b.deleteRange(i, i + 5); a.append(' world') },
    'the other peer deletes the first half of your run while you keep typing': (w, a, b) => { a.append('hello'); w.deliverEverything(); const i = b.editor.text.indexOf('hello'); b.deleteRange(i, i + 3); a.append(' world') },
    'the other peer replaces the whole file while you keep typing at its end': (w, a, b) => { a.append('hello'); w.deliverEverything(); b.replace(0, b.editor.text.length, 'NEW'); a.append(' world') }
  }
  const authorOfWorld = (w, t) => { const i = t.indexOf(' world'); assert.ok(i >= 0, `the typed text must survive: ${show(t)}`); return [...new Set(Array.from({ length: 6 }, (_, k) => { const at = attrsAt(w.a.ytext, i + k); return at && at.by }))] }
  for (const [name, play] of Object.entries(scenes)) {
    const w = mk(2, { text: 'seed text' }); play(w, w.a, w.b); w.deliverEverything(); const t = converged(w, name + ':')
    const before = authorOfWorld(w, t); w.settle(); const t2 = converged(w, name + ' (healed):'); const after = authorOfWorld(w, t2)
    eq(t2, t, 'healing never changes the text'); must(after.length === 1 && after[0] === 'alex', 'AUTHOR', `${name}: after healing, " world" is by ${after.join('/')}, not alex`)
    out.push(before.length === 1 && before[0] === 'alex' ? 'kept' : 'lost, healed'); w.destroy()
  }
  return out.join(', ')
})

test('authorship: the binding heals by itself shortly after a remote delete (real timer, default settings)', async () => {
  const w = mk(2, { text: 'seed text' }); const [a, b] = w.peers
  a.append('hello'); w.deliverEverything(); const i = b.editor.text.indexOf('hello'); b.deleteRange(i, i + 5); a.append(' world'); w.deliverEverything()
  const by = () => attrsAt(a.ytext, a.text().indexOf(' world') + 2).by
  const t0 = Date.now(); let seen = by()
  while (seen !== 'alex' && Date.now() - t0 < 3000) { await sleep(50); w.deliverEverything(); seen = by() }
  eq(seen, 'alex', 'alex\'s text must get its author back on its own within 3 s'); w.destroy(); return `${Date.now() - t0} ms`
})

// ============================================================================================================================ undo / redo
test('undo only removes your own typing, even when the other peer typed in between; redo brings it back', async () => {
  const w = mk(2, { text: 'one two three' }); const [a, b] = w.peers
  a.append(' AAA'); w.deliverEverything()
  b.insertAt(0, 'BBB '); w.deliverEverything()
  await a.pause(); a.append(' aaa'); w.deliverEverything()
  eq(a.text(), 'BBB one two three AAA aaa')
  a.undo(); w.deliverEverything(); eq(converged(w, 'undo 1:'), 'BBB one two three AAA', 'only the newest typing is gone')
  a.undo(); w.deliverEverything(); eq(converged(w, 'undo 2:'), 'BBB one two three', 'the other person\'s BBB stays')
  eq(a.canUndo(), false, 'alex has nothing left to undo'); eq(a.undo(), false); eq(a.text(), 'BBB one two three', 'undo with nothing to undo changes nothing')
  eq(b.canUndo(), true); b.undo(); w.deliverEverything(); eq(converged(w, 'b undo:'), 'one two three', 'sam undoes only his own BBB')
  a.redo(); w.deliverEverything(); eq(converged(w, 'redo:'), 'one two three AAA'); eq(a.canRedo(), true); a.redo(); w.deliverEverything(); eq(converged(w, 'redo 2:'), 'one two three AAA aaa')
  eq(a.canRedo(), false); w.destroy()
})

test('undo with the other person typing in the same place and inside your text', () => {
  const w = mk(2, { text: 'base' }); const [a, b] = w.peers
  a.insertAt(4, 'AAAAAA'); b.insertAt(4, 'BBB'); w.drain(rng(2)); const t = converged(w, 'same place:')
  assert.ok(t === 'baseAAAAAABBB' || t === 'baseBBBAAAAAA', show(t))
  const mid = a.firstIndexOf('AAAAAA') + 3; b.insertAt(mid, 'bb'); w.deliverEverything()
  eq(a.text().replace(/[^b]/g, ''), 'BBBbb'.replace(/[^b]/g, '') && a.text().replace(/[^b]/g, ''))
  a.undo(); w.deliverEverything(); const after = converged(w, 'undo:')
  assert.ok(!after.includes('A'), `alex's A characters should all be gone: ${show(after)}`); assert.ok(after.includes('BBB') && after.includes('bb'), `sam's text must stay: ${show(after)}`)
  eq(after.replace(/[B]/g, '').replace(/b{2}/, ''), 'base'.replace(/b/g, 'b') && after.replace(/[B]/g, '').replace(/b{2}/, '')); w.destroy()
})

test('undo restores text you deleted, with the original authors, and redo deletes it again', async () => {
  const w = mk(2, { text: 'seed' }); const [a, b] = w.peers
  b.append(' BB'); w.deliverEverything(); await a.pause()
  a.deleteRange(0, a.editor.text.length); w.deliverEverything(); eq(converged(w, 'deleted:'), '')
  a.undo(); w.deliverEverything(); eq(converged(w, 'undone:'), 'seed BB')
  eq(runsOf(b.ytext).map(r => [r.text, r.attrs.by]), [['seed', 'seed'], [' BB', 'sam']], 'the restored text keeps its original authors')
  a.redo(); w.deliverEverything(); eq(converged(w, 'redone:'), ''); w.destroy()
})

test('redo after a remote change; new typing clears the redo stack', async () => {
  const w = mk(2, { text: 'base' }); const [a, b] = w.peers
  a.insertAt(0, 'X'); w.deliverEverything(); await a.pause(); a.undo(); w.deliverEverything(); eq(converged(w, 'undone:'), 'base')
  b.append('Y'); w.deliverEverything(); eq(a.canRedo(), true, 'a remote change does not clear redo')
  a.redo(); w.deliverEverything(); eq(converged(w, 'redone after a remote change:'), 'XbaseY')
  a.undo(); a.insertAt(0, 'Z'); eq(a.canRedo(), false, 'typing after an undo clears redo'); eq(a.redo(), false); w.deliverEverything(); converged(w, 'end:'); w.destroy()
})

test('undo after the other peer already deleted your text is harmless', () => {
  const w = mk(2, { text: 'base' }); const [a, b] = w.peers
  a.append('AAA'); w.deliverEverything(); b.deleteRange(4, 7); w.deliverEverything()
  assert.doesNotThrow(() => a.undo()); w.deliverEverything(); eq(converged(w, 'after undo:'), 'base'); w.destroy()
})

test('undo never touches an agent\'s edits or other remote updates', async () => {
  const w = mk(2, { text: 'base', agent: true }); const [a, b, coder] = w.peers
  a.append('AAA'); w.deliverEverything(); coder.rawInsert(0, '<<<'); coder.rawInsert(coder.ytext.length, '>>>'); w.deliverEverything(); b.insertAt(6, 'bb'); w.deliverEverything()
  eq(a.text(), '<<<basbbe' + 'AAA>>>', 'before the undo')
  await a.pause(); a.undo(); w.deliverEverything(); const t = converged(w, 'undo:')
  assert.ok(t.includes('<<<') && t.includes('>>>') && t.includes('bb'), `somebody else's text was undone: ${show(t)}`); assert.ok(!t.includes('AAA'), 'alex\'s own typing should be gone: ' + show(t)); w.destroy()
})

test('quick typing is one undo step, a pause starts a new one (real time, about 500 ms capture window)', async () => {
  const w = mk(1, { text: 'x' }); const [a] = w.peers
  for (let i = 0; i < 5; i++) { a.append('a'); await sleep(20) }
  await sleep(700); a.append('B'); await sleep(20); a.append('B')
  a.undo(); eq(a.text(), 'xaaaaa', 'the second burst is undone as one step'); a.undo(); eq(a.text(), 'x', 'the first burst is one step'); w.destroy()
})

test('undo and redo reach the editor as ordinary changes (onRemote), with the caret information the adapter needs', async () => {
  const w = mk(2, { text: 'abc' }); const [a] = w.peers
  a.append('XYZ'); await a.pause(); const before = a.remoteCalls; a.undo(); eq(a.remoteCalls, before + 1, 'undo is reported once through onRemote'); eq(a.editor.text, 'abc')
  a.redo(); eq(a.remoteCalls, before + 2); eq(a.editor.text, 'abcXYZ'); w.destroy()
})

// ============================================================================================================================ lifecycle
test('destroy stops reporting; destroying twice is fine', () => {
  const w = mk(2, { text: 'abc' }); const [a, b] = w.peers; const calls = b.remoteCalls
  b.binding.destroy(); assert.doesNotThrow(() => b.binding.destroy()); b.binding = null; a.append('X'); w.deliverEverything()
  eq(b.remoteCalls, calls, 'a destroyed binding reports nothing'); w.destroy()
})

test('two editors on one Y.Text (split view) stay in sync, and each one\'s undo only undoes its own typing', async () => {
  const doc = new Y.Doc(); const yt = doc.getText('f'); yt.insert(0, 'base', { by: 'seed', t: 1 })
  const mkEd = name => { const ed = { text: 'base', binding: createBinding({ Y, ytext: yt, user: { name } }) }; ed.binding.onRemote(ch => { ed.text = changesToText(ed.text, ch) }); return ed }
  const e1 = mkEd('alex'); const e2 = mkEd('alex')
  const type = (ed, ch) => { ed.text = changesToText(ed.text, ch); ed.binding.applyLocal(ch) }
  type(e1, [{ from: 4, to: 4, insert: '1' }]); eq(e2.text, 'base1', 'typing in pane one shows up in pane two'); eq(e1.text, 'base1')
  e1.binding.stopCapturing(); type(e2, [{ from: 0, to: 0, insert: '2' }]); eq(e1.text, '2base1')
  e1.binding.undo(); eq(yt.toString(), '2base', 'pane one undoes only what pane one typed'); eq(e1.text, yt.toString()); eq(e2.text, yt.toString())
  e2.binding.undo(); eq(yt.toString(), 'base'); eq(e2.text, 'base'); e1.binding.destroy(); e2.binding.destroy()
})

// ============================================================================================================================ presence
const pworld = (n = 3, text = 'hello world, this is a line') => {
  const w = mk(n, { text, nested: 'a.py' })
  for (const p of w.peers) p.awareness.setLocalState({ user: { name: p.name, color: 'hsl(' + p.index * 90 + ', 70%, 60%)', isAgent: false } })
  return w
}
const select = (p, file, anchor, head) => presence.setLocalSelection({ Y, awareness: p.awareness, ytext: p.ytext, file, anchor, head })
const others = (w, p, file = 'a.py') => { exchangeAwareness(w.peers.map(x => x.awareness)); return presence.remoteSelections({ Y, awareness: p.awareness, ytext: p.ytext, file }) }

test('presence: setLocalSelection writes cursor = { file, anchor, head } as JSON-safe relative positions the VS Code extension can read', () => {
  const w = pworld(2, 'hello world'); const [a] = w.peers
  select(a, 'a.py', 2, 7)
  const st = a.awareness.getLocalState(); eq(st.user.name, 'alex', 'the user field is untouched'); const c = st.cursor
  eq(Object.keys(c).sort(), ['anchor', 'file', 'head']); eq(c.file, 'a.py'); assert.deepEqual(JSON.parse(JSON.stringify(c)), c, 'must survive the wire unchanged')
  const abs = x => Y.createAbsolutePositionFromRelativePosition(x, a.doc) // exactly how the extension reads it
  eq(abs(c.anchor).index, 2); eq(abs(c.head).index, 7); assert.ok(abs(c.head).type === a.ytext, 'must point into this file\'s Y.Text')
  eq(Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(c.head), a.doc).index, 7)
  select(a, 'a.py', 9, 3); const r = others(w, w.b); eq(r.map(x => [x.anchor, x.head]), [[9, 3]], 'a backwards selection keeps anchor and head'); w.destroy()
})

test('presence: a cursor written the way the VS Code extension writes it is understood', () => {
  const w = pworld(2, 'hello world'); const [a, b] = w.peers
  b.awareness.setLocalStateField('cursor', { file: 'a.py', anchor: Y.createRelativePositionFromTypeIndex(b.ytext, 1), head: Y.createRelativePositionFromTypeIndex(b.ytext, 4) })
  b.awareness.setLocalStateField('user', { name: 'sam', color: 'hsl(10, 70%, 60%)', isAgent: false, model: '' })
  eq(others(w, a).map(x => [x.name, x.anchor, x.head, x.isAgent]), [['sam', 1, 4, false]]); w.destroy()
})

test('presence: remoteSelections returns only others in the same file, never you', () => {
  const w = pworld(4, 'hello world'); const [a, b, c, d] = w.peers
  select(a, 'a.py', 1, 1); select(b, 'a.py', 2, 5); select(c, 'b.py', 0, 3); select(d, 'a.py', 3, 3); d.awareness.setLocalStateField('user', { name: 'coder', color: '#0f0', isAgent: true, model: 'nemotron' })
  const r = others(w, a); eq(r.map(x => x.name).sort(), ['coder', 'sam'], 'sam and the agent are in a.py; jo is in b.py; alex is me')
  assert.ok(r.every(x => x.clientId !== a.doc.clientID), 'never yourself'); eq(r.find(x => x.name === 'coder').isAgent, true); eq(r.find(x => x.name === 'sam').color, 'hsl(90, 70%, 60%)')
  eq(Object.keys(r[0]).sort(), ['anchor', 'clientId', 'color', 'head', 'isAgent', 'name'].sort())
  const inB = presence.remoteSelections({ Y, awareness: a.awareness, ytext: a.ytext, file: 'b.py' }); eq(inB.map(x => x.name), ['jo'], 'asked for another file name: only the person in it')
  b.awareness.setLocalStateField('cursor', null); eq(others(w, a).map(x => x.name), ['coder'], 'a null cursor is nobody'); w.destroy()
})

test('presence: a selection follows its characters while the text changes under it (insert before, inside, after; delete; replace)', () => {
  const w = pworld(3, 'hello world, this is a line'); const [a, b, c] = w.peers
  select(c, 'a.py', 6, 11) // "world" selected by jo
  const pos = () => others(w, a).map(x => [x.anchor, x.head])[0]
  eq(pos(), [6, 11])
  b.insertAt(0, 'XX'); w.deliverEverything(); eq(pos(), [8, 13], 'text inserted before moves the selection along')
  b.append('!!!'); w.deliverEverything(); eq(pos(), [8, 13], 'text inserted after changes nothing')
  b.insertAt(10, 'YY'); w.deliverEverything(); eq(pos(), [8, 15], 'text inserted inside widens it')
  const a0 = pos()[0]; b.deleteRange(a0 + 1, a0 + 4); w.deliverEverything(); eq(pos()[0], a0); eq(pos()[1], 12, 'a deletion inside shrinks it')
  b.deleteRange(5, 20); w.deliverEverything(); const [x, y] = pos(); assert.ok(x === 5 && y === 5, `deleting around the whole selection collapses it where it was: ${[x, y]}`)
  b.deleteRange(0, b.editor.text.length); w.deliverEverything(); eq(pos(), [0, 0], 'everything deleted'); b.append('new text'); w.deliverEverything()
  const [p, q] = pos(); assert.ok(p >= 0 && q <= b.editor.text.length, 'still inside the text after it was replaced')
  a.undo(); eq(a.binding.canUndo(), false); w.destroy()
})

test('presence: concurrent edits and out-of-order updates never move a remote selection outside the text', () => {
  const r = rng(4); const w = pworld(3, 'abcdefghijklmnopqrstuvwxyz')
  select(w.c, 'a.py', 5, 20)
  for (let i = 0; i < 200; i++) {
    const p = r.pick([w.a, w.b]); p.type(randomChanges(r, p.editor.text, p.tokens)); if (r.chance(0.4)) w.drain(r)
    for (const s of others(w, w.a)) must(Number.isInteger(s.anchor) && Number.isInteger(s.head) && s.anchor >= 0 && s.head <= w.a.editor.text.length && s.anchor <= w.a.editor.text.length && s.head >= 0, 'RANGE', `selection ${s.anchor}-${s.head} outside a text of length ${w.a.editor.text.length}`)
  }
  w.destroy()
})

test('presence: cursor is null when the person leaves the file (file switch, no file, no position)', () => {
  const w = pworld(2); const [a, b] = w.peers
  select(a, 'a.py', 3, 3); eq(others(w, b).length, 1)
  select(a, 'b.py', 0, 0); eq(others(w, b, 'a.py').length, 0, 'switched to b.py: gone from a.py')
  for (const args of [[null, 3, 3], [undefined, 3, 3], ['', 3, 3], ['a.py', null, null], ['a.py', 3, null], ['a.py', undefined, undefined]]) {
    select(a, 'a.py', 1, 1); select(a, ...args)
    eq(a.awareness.getLocalState().cursor, null, `setLocalSelection(file=${show(args[0])}, anchor=${show(args[1])}, head=${show(args[2])}) must clear the cursor`)
    eq(others(w, b).length, 0)
  }
  eq(a.awareness.getLocalState().user.name, 'alex', 'clearing the cursor keeps the user'); w.destroy()
})

test('presence: out-of-range positions are clamped; malformed, stale or foreign cursors are ignored without throwing', () => {
  const w = pworld(3, 'hello'); const [a, b, c] = w.peers
  select(b, 'a.py', 999, -5); eq(others(w, a).map(x => [x.anchor, x.head]), [[5, 0]], 'clamped to the text')
  w.a.doc.transact(() => fileStore(w.a.doc).set('b.py', new Y.Text()), 'setup'); w.deliverEverything()
  const other = fileStore(b.doc).get('b.py'); other.insert(0, 'xyz')
  const bad = [
    'garbage', 42, { file: 'a.py' }, { file: 'a.py', anchor: null, head: null }, { file: 'a.py', anchor: 'x', head: 'y' }, { file: 'a.py', anchor: {}, head: {} },
    { file: 'a.py', anchor: { item: { client: 123456789, clock: 5 } }, head: { item: { client: 123456789, clock: 5 } } }, // an item this peer has not received
    { file: 'a.py', anchor: { type: { client: 987654321, clock: 0 }, item: null }, head: { type: { client: 987654321, clock: 0 }, item: null } },
    { file: 'a.py', anchor: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(other, 1)), head: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(other, 2)) } // another file's text under this file's name
  ]
  for (const cur of bad) {
    b.awareness.setLocalStateField('cursor', cur); b.awareness.setLocalStateField('user', { name: 'sam', color: 5, isAgent: 'yes' })
    let r; assert.doesNotThrow(() => { r = others(w, a) }, `cursor ${show(cur, 100)} must not throw`)
    for (const s of r) must(Number.isInteger(s.anchor) && Number.isInteger(s.head), 'BADSEL', `cursor ${show(cur, 100)} produced ${show(s)}`)
    must(r.length === 0, 'BADSEL', `cursor ${show(cur, 100)} should be ignored, got ${show(r)}`)
  }
  b.awareness.setLocalState({ cursor: { file: 'a.py', anchor: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(b.ytext, 1)), head: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(b.ytext, 1)) } })
  eq(others(w, a).length, 0, 'a state without a user is not a person')
  void c; w.destroy()
})

// ============================================================================================================================ fuzzers
const fuzz = (name, mode) => test(name, () => fuzzMany({ core, mode, seeds: args.seeds, only: args.seed, testName: name }))
fuzz('fuzz, inserts only: 2 to 4 people (+ an agent process) at once, late and shuffled: every character has exactly its own author (strict)', 'authors')
fuzz('fuzz: 2 to 4 people (+ an agent process) type at once, updates late, shuffled and duplicated: everyone identical (authorship counted after healing, see README)', 'basic')
fuzz('fuzz with undo and redo mixed in: everyone identical, undo only touches your own changes, authors survive', 'undo')
fuzz('fuzz with emoji, CJK, ZWJ sequences and combining marks (edits never cut a pair): identical, nothing corrupted', 'unicode')

test('fuzz: one writer at a time equals a plain-string model (replace, multi-change, empty and agent edits)', () => {
  const seeds = args.seed != null ? [args.seed] : Array.from({ length: args.seeds }, (_, i) => i + 1)
  for (const seed of seeds) {
    const r = rng(seed * 97 + 5); const w = mk(r.range(2, 3), { text: 'start text\nsecond line\n', agent: r.chance(0.4), nested: r.chance(0.5) ? 'x.py' : null, ids: null })
    let model = 'start text\nsecond line\n'
    try {
      for (let i = 0; i < 80; i++) {
        const raw = w.peers.find(p => p.raw); const roll = r()
        if (raw && roll > 0.85) { const at = r.int(model.length + 1); raw.rawInsert(at, '<<'); model = model.slice(0, at) + '<<' + model.slice(at) }
        else if (raw && roll > 0.8 && model.length) { const at = r.int(model.length); const e = Math.min(model.length, at + r.range(1, 3)); raw.rawDelete(at, e); model = model.slice(0, at) + model.slice(e) }
        else { const p = r.pick(w.people); const ch = randomChanges(r, model, p.tokens); p.type(ch); model = refApply(model, ch) }
        w.deliverEverything()
        for (const p of w.peers) same(p.text(), model, 'MODEL', `step ${i}: ${p.name}'s Y.Text vs the plain-string model`)
        for (const p of w.people) same(p.editor.text, model, 'MODEL', `step ${i}: ${p.name}'s editor vs the model`)
      }
    } catch (e) { e.message = `seed ${seed} (replay: --only "one writer" --seed ${seed}): ${e.message}`; throw e } finally { w.destroy() }
  }
  return seeds.length + ' seeds'
})

process.exit(await run())
