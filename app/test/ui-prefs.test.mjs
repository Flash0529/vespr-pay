import assert from 'node:assert'
import { DEFAULTS, normalizePrefs, attributesFor, createUiPrefs, SIDEBAR_PX } from '../ui-prefs.js'
assert.deepStrictEqual(normalizePrefs(undefined), DEFAULTS); assert.deepStrictEqual(normalizePrefs(null), DEFAULTS); assert.deepStrictEqual(normalizePrefs('x'), DEFAULTS)
assert.deepStrictEqual(normalizePrefs({ glass: 'off', sidebar: 'wide', chatLight: 'off' }), { glass: 'off', chatLight: 'off', sidebar: 'wide', look: 'default' })
assert.strictEqual(normalizePrefs({ look: 'r07' }).look, 'r07'); assert.strictEqual(normalizePrefs({ look: 'r99' }).look, 'default'); assert.strictEqual(attributesFor({ look: 'r02' }).look['data-v-btn'], 'pill')
assert.deepStrictEqual(normalizePrefs({ glass: 'maybe', sidebar: 'huge', chatLight: 1, extra: 'x' }), DEFAULTS, 'unknown values and keys are dropped')
assert.deepStrictEqual(attributesFor({}), { 'data-glass': 'on', 'data-chat-light': 'on', sidebarPx: null, look: {} }); assert.strictEqual(attributesFor({ sidebar: 'wide' }).sidebarPx, SIDEBAR_PX.wide); assert.strictEqual(attributesFor({ sidebar: 'compact' }).sidebarPx, 248)
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v) } }
const s = mem(); const a = createUiPrefs(s); assert.deepStrictEqual(a.get(), DEFAULTS); a.set({ glass: 'off' }); assert.strictEqual(a.get().glass, 'off'); a.set({ sidebar: 'nope' }); assert.strictEqual(a.get().sidebar, 'standard'); assert.strictEqual(a.get().glass, 'off', 'a later bad patch keeps earlier choices')
assert.strictEqual(createUiPrefs(s).get().glass, 'off', 'saved on this device'); a.reset(); assert.deepStrictEqual(createUiPrefs(s).get(), DEFAULTS)
s.setItem('vespr.ui-prefs.v1', '{bad'); assert.deepStrictEqual(createUiPrefs(s).get(), DEFAULTS)
const blocked = { getItem () { throw new Error('x') }, setItem () { throw new Error('x') } }; const b = createUiPrefs(blocked); assert.strictEqual(b.set({ glass: 'off' }).glass, 'off')
console.log('ui prefs tests passed')
