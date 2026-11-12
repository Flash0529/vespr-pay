import assert from 'node:assert'
import fs from 'node:fs'
import { COPY, copyFor, NOT_ACTIVE } from '../settings-copy.js'
const html = fs.readFileSync(new URL('../prototype.html', import.meta.url), 'utf8')
// every static label in the settings window has an action description, so a new setting cannot ship without saying what it does
const labels = [...html.matchAll(/class="cset-label"[^>]*>([^<$]+)</g)].map(m => m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim()).filter(Boolean)
const missing = [...new Set(labels)].filter(l => !copyFor(l))
assert.deepStrictEqual(missing, [], 'settings labels without action copy: ' + missing.join(' | '))
assert.ok(labels.length > 40, 'found the labels (' + labels.length + ')')
for (const [k, v] of Object.entries(COPY)) { assert.ok(typeof v.live === 'boolean' && typeof v.text === 'string' && v.text.length > 12, k); assert.ok(!/^\s*(configure|manage|customize)\b/i.test(v.text), k + ': say what happens, not "configure"'); if (!v.live) assert.match(v.text, /Saved only|Would|Not available|not .*yet|No |yet\./, k + ': a not-active control must say so') }
assert.strictEqual(copyFor('Prompt suggestions Local only').live, false); assert.strictEqual(copyFor('Color theme').live, true); assert.strictEqual(copyFor('nope'), null); assert.strictEqual(copyFor(null), null); assert.strictEqual(NOT_ACTIVE, 'Not active yet')
// the settings that now really change the page are marked live, the stored-only ones are not
for (const k of ['High contrast mode', 'Reduced motion', 'Eye comfort mode', 'Pomodoro & break reminders', 'Persona tone', 'Custom instructions', 'Glass effects', 'Sidebar width']) assert.strictEqual(copyFor(k).live, true, k)
for (const k of ['Font scaling', 'Code syntax theme', 'Audio chimes', 'Branch prefix', 'Web search reach']) assert.strictEqual(copyFor(k).live, false, k)
console.log('settings copy tests passed (' + labels.length + ' labels)')
