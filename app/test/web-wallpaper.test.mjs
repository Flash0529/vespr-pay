import assert from 'node:assert'
import { WALLPAPERS, DEFAULT_ID, resolveWallpaper, cssFor, createWallpaperStore } from '../web-wallpaper.js'
assert.strictEqual(DEFAULT_ID, 'frost'); assert.ok(Object.isFrozen(WALLPAPERS))
for (const [id, w] of Object.entries(WALLPAPERS)) for (const m of ['dark', 'light']) { const c = cssFor(w, m); assert.ok(/gradient/.test(c) && !/url\(|;|javascript/i.test(c), `${id} ${m} is a plain gradient (no download, no injection)`) }
for (const [id, w] of Object.entries(WALLPAPERS)) for (const m of ['dark', 'light']) assert.ok(!/%\s+\d+%\s+at/.test(cssFor(w, m)) && /circle \d+px/.test(cssFor(w, m)), id + ' ' + m + ': circles, so the picture is never stretched')
assert.strictEqual(resolveWallpaper('dusk', false).id, 'frost', 'not entitled: the choice is ignored')
assert.strictEqual(resolveWallpaper('dusk', undefined).id, 'frost', 'unknown entitlement counts as no')
assert.strictEqual(resolveWallpaper('dusk', 'true').id, 'frost', 'only a real true counts')
assert.strictEqual(resolveWallpaper('dusk', true).id, 'dusk', 'entitled: the choice applies')
for (const bad of ['nope', '__proto__', 'constructor', null, 5, {}]) assert.strictEqual(resolveWallpaper(bad, true).id, 'frost', String(bad))
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v) } }
{ const st = mem(); const a = createWallpaperStore(st); assert.strictEqual(a.get(), null); assert.strictEqual(a.set('nope'), false); assert.strictEqual(a.set('graphite'), true); assert.strictEqual(createWallpaperStore(st).get(), 'graphite') }
{ const st = mem(); st.setItem('vespr.web-wallpaper.v1', '{bad'); assert.strictEqual(createWallpaperStore(st).get(), null) }
console.log('web wallpaper tests passed')
