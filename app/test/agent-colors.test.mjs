// Agent colour rules (app/agent-colors.js): hex input is strict, drawn colours stay legible, the picker maths round-trips, stored choices are validated.
import assert from 'node:assert'
import { DEFAULT_AGENT, PRESETS, normalizeHex, contrast, onDark, onLight, SURFACES, readableOn, hexToHsv, hsvToHex, cleanName, createAgentStyles, NAME_MAX } from '../agent-colors.js'

// ---- the default agent and the brand blue
assert.strictEqual(DEFAULT_AGENT.name, 'VESPR Manager'); assert.strictEqual(DEFAULT_AGENT.color, '#1F3A93')
assert.ok(Object.isFrozen(DEFAULT_AGENT) && Object.isFrozen(PRESETS), 'defaults cannot be edited in place')
assert.deepStrictEqual(PRESETS.slice(0, 5).map(p => p.color), ['#1F3A93', '#2F55C7', '#4169E1', '#7F9CFF', '#C9D6FF'], "the team's five blues come first")

// ---- hex input: what the box accepts, and that bad input is refused rather than guessed
for (const [input, want] of [['#1f3a93', '#1F3A93'], ['1F3A93', '#1F3A93'], [' #abc ', '#AABBCC'], ['fff', '#FFFFFF'], ['#0002ed', '#0002ED']]) assert.strictEqual(normalizeHex(input), want, input)
for (const bad of ['', '#12', '#12345', '#1234567', 'blue', '#gggggg', null, undefined, 5, {}, ['#fff'], '#fff; background:red', 'javascript:1']) assert.strictEqual(normalizeHex(bad), null, String(bad))

// ---- legibility: the new brand blue is invisible as a small mark on dark surfaces unless it is derived; light mode needs no change
const worstOn = (hex, mode) => Math.min(...SURFACES[mode].map(s => contrast(hex, s)))
assert.ok(worstOn('#1F3A93', 'dark') < 2.1, 'the raw brand blue fails 3:1 on dark (this is why onDark exists)')
for (const p of PRESETS) {
  assert.ok(worstOn(onDark(p.color), 'dark') >= 3, `${p.name} stays at least 3:1 on dark surfaces once derived`)
  assert.ok(worstOn(onLight(p.color), 'light') >= 3, `${p.name} stays at least 3:1 on light surfaces once derived`)
}
assert.strictEqual(onDark('#C9D6FF'), '#C9D6FF', 'a colour that already reads well is not touched')
assert.strictEqual(onLight('#1F3A93'), '#1F3A93', 'the brand blue is fine as it is on light surfaces')
assert.strictEqual(onDark('nope'), null)
const lifted = onDark('#1F3A93'); const [r0, g0, b0] = [0x1F, 0x3A, 0x93]; const [r1, g1, b1] = [1, 3, 5].map(i => parseInt(lifted.slice(i, i + 2), 16))
assert.ok(r1 >= r0 && g1 >= g0 && b1 >= b0 && b1 > r1 && b1 > g1, 'lightening keeps it blue')
assert.strictEqual(readableOn('#1F3A93'), '#FFFFFF'); assert.strictEqual(readableOn('#C9D6FF'), '#000000')

// ---- the picker: typing a hex and pressing Enter must put the wheel/square on the same colour, and dragging it must give the same hex back
for (const hex of ['#1F3A93', '#7212FD', '#ED0000', '#34D3A4', '#FFFFFF', '#000000', '#808080']) {
  const { h, s, v } = hexToHsv(hex); const back = hsvToHex(h, s, v)
  const d = [1, 3, 5].map(i => Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(back.slice(i, i + 2), 16)))
  assert.ok(Math.max(...d) <= 2, `${hex} -> hsv -> ${back} (hue is whole degrees, so up to 2 off per channel)`)
}
assert.deepStrictEqual(hexToHsv('#FF0000'), { h: 0, s: 1, v: 1 }); assert.strictEqual(hsvToHex(240, 1, 1), '#0000FF'); assert.strictEqual(hsvToHex(-120, 1, 1), '#0000FF', 'negative hue wraps')

// ---- names: no control characters, no markup brackets, bounded, never empty
assert.strictEqual(cleanName('  Review   bot  '), 'Review bot'); assert.strictEqual(cleanName('<img src=x onerror=1>'), 'img src=x onerror=1')
assert.strictEqual(cleanName('a'.repeat(100)).length, NAME_MAX); assert.strictEqual(cleanName('   '), null); assert.strictEqual(cleanName(5), null); assert.strictEqual(cleanName('\u0000\u0007'), null)

// ---- the store: per agent, validated on the way in and on the way out, survives damage, keeps the person's choice
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v), raw: m } }
{
  const st = mem(); const a = createAgentStyles(st)
  assert.deepStrictEqual(a.get('manager'), { name: 'VESPR Manager', color: '#1F3A93' }, 'nothing stored: the default agent')
  assert.deepStrictEqual(a.get('coder', { name: 'coder', color: '#5b8cff' }), { name: 'coder', color: '#5B8CFF' }, "a built-in agent keeps its own hue until the person changes it")
  assert.deepStrictEqual(a.set('coder', { color: '#7212fd' }), { name: 'VESPR Manager', color: '#7212FD' }, 'with no name stored and no fallback given, the default name shows (the UI always passes the real name as the fallback)')
  a.set('coder', { name: 'Builder' }); assert.deepStrictEqual(a.get('coder'), { name: 'Builder', color: '#7212FD' }, 'a later patch keeps earlier fields')
  a.set('coder', { color: 'not a colour', name: '<<>>' }); assert.deepStrictEqual(a.get('coder'), { name: 'Builder', color: '#7212FD' }, 'junk in a patch changes nothing')
  const b = createAgentStyles(st); assert.deepStrictEqual(b.get('coder'), { name: 'Builder', color: '#7212FD' }, 'a new page load sees the saved choice')
  b.reset('coder'); assert.strictEqual(createAgentStyles(st).get('coder', { name: 'coder', color: '#5B8CFF' }).color, '#5B8CFF', 'reset puts the original back')
}
{
  const st = mem(); st.setItem('vespr.agent-styles.v1', '{not json'); assert.deepStrictEqual(createAgentStyles(st).get('x'), { name: 'VESPR Manager', color: '#1F3A93' }, 'damaged storage is ignored')
  st.setItem('vespr.agent-styles.v1', JSON.stringify({ a: { color: 'red', name: 5 }, b: { color: '#abcdef', name: 'ok' }, c: 'x', d: null })); const s = createAgentStyles(st)
  assert.deepStrictEqual(Object.keys(s.all()), ['b'], 'only valid records survive'); assert.strictEqual(s.get('b').color, '#ABCDEF')
  const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  const t = createAgentStyles(blocked); assert.strictEqual(t.set('z', { color: '#123456' }).color, '#123456', 'blocked storage: the choice still applies until reload')
}
console.log('agent colour tests passed')
