// The demo-only "no model names" mode: ?hidemodel=1 (the film recorder adds it) leaves model names out of what the app draws, and without it nothing changes.
// The app is one inline script, so this reads the real source: the switch itself is run with a fake address bar, and every place that names a model is checked to be gated by it
// and to keep its normal output when it is off. (A browser scan with and without the flag was also run; docs/PAYPAL.md says how.)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const rd = f => fs.readFileSync(path.join(root, f), 'utf8')
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++ }; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++ }
const html = rd('app/prototype.html')

// the switch: only the exact value 1 turns it on; a broken address bar means off; it marks the page so the stylesheet can act
const decl = /const HIDE_MODEL=\(\(\)=>\{try\{return new URLSearchParams\(location\.search\)\.get\('hidemodel'\)==='1'\}catch\(e\)\{return false\}\}\)\(\);if\(HIDE_MODEL\)document\.documentElement\.setAttribute\('data-hidemodel','1'\)/
ok(decl.test(html), 'the switch is in the app, written once')
const run = search => { const attrs = {}; const ctx = { location: { search }, URLSearchParams, document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v } } } }; vm.createContext(ctx); vm.runInContext(html.match(decl)[0].replace('const HIDE_MODEL', 'var HIDE_MODEL'), ctx); return { on: ctx.HIDE_MODEL, attrs } }
eq(run('?live=1&hidemodel=1&room=x'), { on: true, attrs: { 'data-hidemodel': '1' } }); eq(run('?hidemodel=1'), { on: true, attrs: { 'data-hidemodel': '1' } })
for (const s of ['', '?live=1', '?hidemodel=0', '?hidemodel=', '?hidemodel=true', '?hidemodel=11', '?xhidemodel=1']) eq(run(s), { on: false, attrs: {} }, 'off for ' + JSON.stringify(s))
// it is a const in a classic script: reading it before its line runs throws (a real bug caught once: the connector list ran first and the whole page stopped). So it is the first statement after the two helpers.
const decl0 = html.indexOf('const HIDE_MODEL=')
ok(decl0 > 0 && decl0 - html.indexOf('<script>\nconst $=s=>') < 700, 'declared at the very top of the main script')
const bodyOfScript = html.slice(html.indexOf('<script>\nconst $=s=>'))
const uses = [...bodyOfScript.matchAll(/HIDE_MODEL/g)].map(m => m.index); ok(uses[0] === bodyOfScript.indexOf('const HIDE_MODEL=') + 'const '.length, 'the first mention in the script is its own declaration, so nothing can read it too early')

// every place that draws a model name is gated, and keeps its normal text when the mode is off
const gated = [
  ['chat chip', "${HIDE_MODEL?'':`<span class=\"chip\">${esc(it.model)}</span>`}"],
  ['agent rows', "esc(a.role)+(HIDE_MODEL?'':' · '+esc(a.model))"],
  ['History list', "${e.model&&!HIDE_MODEL?' · '+esc(e.model):''}"],
  ['History CSV', "e.kind,HIDE_MODEL?'':e.model,e.type"],
  ['avatar tooltip', "${HIDE_MODEL?'':' ('+esc(a.model||'agent')+')'}"],
  ['connector blurb', "HIDE_MODEL?'Models for every agent.':'Nemotron models for every agent.'"]
]
for (const [what, src] of gated) ok(html.includes(src), what + ' is gated')
ok(/html\[data-hidemodel\] #modelBtn\{display:none!important\}/.test(html), 'the composer pill is not shown (a rule the page itself cannot lose to a later style)')
// the ungated forms are gone: no place still draws the model unconditionally
ok(!html.includes('<span class="chip">${esc(it.model)}</span></div>'), 'no unconditional chip'); ok(!html.includes("' · '+esc(a.model)}</span>"), 'no unconditional agent-row model'); ok(!html.includes("(${esc(a.model||'agent')})${esc(claimTip)}"), 'no unconditional tooltip model')

// the recorder turns it on by default, VESPR_DEMO_HIDE_MODEL=0 turns it off, and the app address is the only place it goes
if (fs.existsSync(path.join(root, 'video/shell/film.mjs'))) { // the recorder is not part of the published copy (scripts/publish-exclude.txt), so these two checks run only where it exists
  const film = rd('video/shell/film.mjs')
  ok(film.includes("const hideModel = process.env.VESPR_DEMO_HIDE_MODEL !== '0'") && film.includes("${hideModel ? '&hidemodel=1' : ''}#token="), 'recorder: on unless VESPR_DEMO_HIDE_MODEL=0, added before the token fragment')
  ok(/hidemodel/.test(rd('video/shell/README.md')) && /VESPR_DEMO_HIDE_MODEL=0/.test(rd('video/shell/README.md')), 'the recorder README says so')
}
// the normal product: the page does not look at it anywhere else (no storage, no cookie, no server), so it cannot stick
ok(html.split('\n').filter(l => /hidemodel/i.test(l)).length === 3 && !/(localStorage|sessionStorage|cookie)[^;\n]{0,80}hidemodel|hidemodel[^;\n]{0,80}(localStorage|sessionStorage|cookie)/i.test(html), 'only the style rule, the comment and the switch mention it: it is read from the address and never stored')

console.log(`hide-model tests passed (${n}): ?hidemodel=1 switch (exact value only, off for anything else), every model-name site gated and unchanged when off, composer pill hidden by rule, the recorder turns it on and VESPR_DEMO_HIDE_MODEL=0 turns it off, nothing stored`)
