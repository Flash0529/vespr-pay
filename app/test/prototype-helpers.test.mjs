// The app's address helpers in prototype.html exist as their own declarations and convert both ways (a comment once swallowed wsOf,
// which broke joining by share link). Reads the page source; no browser.
import assert from 'node:assert'
import fs from 'node:fs'
const lines = fs.readFileSync(new URL('../prototype.html', import.meta.url), 'utf8').split('\n')
const fn = name => { const l = lines.find(x => x.startsWith(`const ${name}=`)); assert.ok(l, `${name} is declared on its own line`); return l.replace(`const ${name}=`, '').split(' // ')[0] }
globalThis.window = {}; globalThis.location = { origin: 'vespr-app://vespr' }
const httpOf = eval(fn('httpOf')); const wsOf = eval(fn('wsOf'))
assert.strictEqual(httpOf('wss://collab.example.com/'), 'https://collab.example.com')
assert.strictEqual(wsOf('https://collab.example.com/'), 'wss://collab.example.com')
window.VESPR_DESKTOP = { ws: 'ws://x' }; assert.strictEqual(httpOf('wss://collab.example.com'), 'vespr-app://vespr', 'the desktop app sends /api through itself')
console.log('prototype helper tests passed (5)')
