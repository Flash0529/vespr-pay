// Headless-browser check of the share-link return flow (app/prototype.html bootShare + app/return-target.js), against the demo stack.
// Start the stack first with sharing on:  VESPR_SHARE=1 VESPR_DEMO_DIR=$HOME/.cache/vespr-ctx-demo VESPR_DEMO_PORT=9560 bash scripts/demo-stack.sh start
// Run:  VESPR_DEMO_DIR=$HOME/.cache/vespr-ctx-demo VESPR_DEMO_PORT=9560 node scripts/test-return-browser.mjs
// It creates a view link, opens it, reloads, opens a made-up link, and revokes the first link at the end. It drives tools/cdp-shot.mjs (one headless browser at a time).
// Not covered: the site sign-in and wrong-password retry (the demo stack has no accounts), Safari, phones.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DIR = process.env.VESPR_DEMO_DIR || path.join(os.homedir(), '.cache', 'vespr-ctx-demo')
const PORT = Number(process.env.VESPR_DEMO_PORT || 9560)
const WEB = PORT + 2
const CDP = process.env.CDP_SHOT || '/home/user/tools/cdp-shot.mjs'
const work = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'return-browser-'))

const fail = []
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + detail : ''}`); if (!ok) fail.push(name) }

// 1. a view link made by alex through the demo server (the token is shown once; it is test data)
const alex = fs.readFileSync(path.join(DIR, 'tok-alex'), 'utf8').trim()
const made = await fetch(`http://127.0.0.1:${PORT}/api/share/create`, { method: 'POST', headers: { Authorization: 'Bearer ' + alex, 'Content-Type': 'application/json' }, body: JSON.stringify({ room: 'demo', role: 'view', label: 'return-browser check' }) })
if (!made.ok) { console.log('FAIL could not create a share link (is the stack up with VESPR_SHARE=1?), status ' + made.status); process.exit(1) }
const { id, token } = await made.json()
const server = `http://127.0.0.1:${PORT}`
const shareHash = (t) => `#share=${t}&server=${encodeURIComponent(server)}`
const state = `(function(){var g=document.body&&document.body.dataset.guest||null;return JSON.stringify({hash:location.hash,ss:sessionStorage.getItem('vespr-return')!==null,ls:localStorage.getItem('vespr-return')!==null,guest:g,hasToken:location.href.indexOf(${JSON.stringify(token)})!==-1,text:(function(){var e=document.getElementById('toast');return !!(e&&!e.hidden&&/does not work/.test(e.textContent))})()})})()`

// The page is slow on a loaded Pi, so each step waits for the state it needs (up to about 60 s) instead of a fixed sleep.
const GUEST = "document.body.dataset.guest==='view'"
const TOAST = "(function(){var e=document.getElementById('toast');return !!(e&&!e.hidden)})()"
const plan = {
  w: 1024, h: 700, dsf: 1, mobile: false,
  steps: [
    { go: `http://127.0.0.1:${WEB}/prototype.html${shareHash(token)}`, wait: 3000 },
    { waitFor: GUEST, tries: 120 },
    { eval: state, print: 'open' },
    { eval: 'location.reload(),1', wait: 0 },
    { sleep: 3000 },
    { waitFor: GUEST, tries: 120 },
    { eval: state, print: 'reload' },
    { go: 'about:blank', wait: 500 },
    { go: `http://127.0.0.1:${WEB}/prototype.html${shareHash('b'.repeat(43))}`, wait: 3000 },
    { waitFor: TOAST, tries: 120 },
    { eval: state, print: 'bad-link' },
  ]
}
const planPath = path.join(work, 'plan.json')
fs.writeFileSync(planPath, JSON.stringify(plan))
// the browser profile goes in ~/.cache, not /tmp (a small RAM disk); one retry if Chromium did not come up on its debug port
const runOnce = () => spawnSync('node', ['--experimental-websocket', CDP, planPath], { encoding: 'utf8', timeout: 110000, env: { ...process.env, TMPDIR: work } })
let run = runOnce()
if (run.status !== 0 && /targets/.test((run.stdout || '') + (run.stderr || ''))) run = runOnce()
const out = (run.stdout || '') + (run.stderr || '')
const got = {}
for (const line of out.split('\n')) { const m = /^(open|reload|bad-link) (.*)$/.exec(line); if (m) { const v = JSON.parse(m[2]); got[m[1]] = typeof v === 'string' ? JSON.parse(v) : v } }
const logs = out.slice(out.indexOf('LOGS:'))

const o = got.open, r = got.reload, b = got['bad-link']
check('browser ran', !!(o && r && b), run.status === 0 ? '' : `(cdp-shot exit ${run.status})`)
if (!(o && r && b)) console.log('cdp-shot output (tail):\n' + out.slice(-1500))
if (o) {
  check('open: the address bar is scrubbed of the token', o.hash === '' && !o.hasToken, `hash=${JSON.stringify(o.hash)}`)
  check('open: joined as a view guest', o.guest === 'view', `guest=${o.guest}`)
  check('open: the target is in sessionStorage', o.ss === true)
  check('open: the target is never in localStorage', o.ls === false)
}
if (r) {
  check('reload: the address still has no token', r.hasToken === false && r.hash === '')
  check('reload: the share is restored (joined as a view guest again)', r.guest === 'view', `guest=${r.guest}`)
  check('reload: target still in sessionStorage', r.ss === true)
  check('reload: target never in localStorage', r.ls === false)
}
if (b) {
  check('bad link: refused with the message', b.text === true)
  check('bad link: the stored target is cleared', b.ss === false)
}

// 2. tidy up: revoke the test link
await fetch(`http://127.0.0.1:${PORT}/api/share/revoke`, { method: 'POST', headers: { Authorization: 'Bearer ' + alex, 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {})
fs.rmSync(work, { recursive: true, force: true })
console.log(logs.trim().split('\n').slice(0, 12).join('\n'))
console.log(fail.length ? `FAILED: ${fail.join('; ')}` : 'ALL RETURN-BROWSER CHECKS PASSED')
process.exit(fail.length ? 1 : 0)
