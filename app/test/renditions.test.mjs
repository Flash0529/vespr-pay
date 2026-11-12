import assert from 'node:assert'
import fs from 'node:fs'
import { AXES, RENDITIONS, LOOK_IDS, attrsFor, lookName, isLook } from '../renditions.js'
assert.strictEqual(RENDITIONS.length, 30, 'thirty renditions')
assert.strictEqual(new Set(RENDITIONS.map(r => r.id)).size, 30); assert.strictEqual(new Set(RENDITIONS.map(r => r.name)).size, 30, 'distinct names')
const sig = r => Object.keys(AXES).map(k => r.axes[k]).join('/'); assert.strictEqual(new Set(RENDITIONS.map(sig)).size, 30, 'no two renditions are the same setup')
for (const r of RENDITIONS) { assert.deepStrictEqual(Object.keys(r.axes).sort(), Object.keys(AXES).sort(), r.id); for (const [k, v] of Object.entries(r.axes)) assert.ok(AXES[k].includes(v), r.id + ' ' + k + '=' + v) }
// the axes are all used, so the thirty differ in every dimension
for (const [k, vals] of Object.entries(AXES)) for (const v of vals) assert.ok(RENDITIONS.some(r => r.axes[k] === v), 'axis value never shown: ' + k + '=' + v)
assert.deepStrictEqual(LOOK_IDS.slice(0, 3), ['default', 'r01', 'r02']); assert.strictEqual(LOOK_IDS.length, 31)
assert.deepStrictEqual(attrsFor('nope'), {}); assert.deepStrictEqual(attrsFor('default'), {}); assert.strictEqual(attrsFor('r02')['data-v-btn'], 'pill'); assert.strictEqual(Object.keys(attrsFor('r01')).length, Object.keys(AXES).length)
assert.strictEqual(lookName('r08'), 'Floating bar'); assert.strictEqual(lookName('x'), 'Default'); assert.ok(isLook('r30') && isLook('default') && !isLook('r31') && !isLook(5) && !isLook(null) && !isLook('__proto__'))
// every axis value has CSS (variants.css), so a rendition cannot silently do nothing
const css = fs.readFileSync(new URL('../variants.css', import.meta.url), 'utf8')
for (const [k, vals] of Object.entries(AXES)) for (const v of vals) if (v !== 'soft' && v !== 'wallpaper' && v !== 'full' && v !== 'gray' && v !== 'float' && v !== 'comfy' && v !== 'agent') assert.ok(css.includes(`[data-v-${k}=${v}]`), `variants.css styles data-v-${k}=${v}`)
console.log('renditions tests passed')
