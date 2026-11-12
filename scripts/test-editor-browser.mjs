#!/usr/bin/env node
// Two real browser pages type into the SDE's own editor at the same moment, against a real local collab server.
//   node scripts/test-editor-browser.mjs [--only <text>] [--burst <seconds>] [--shots <dir>] [--port <n>] [--list]
//
// What it starts (all on 127.0.0.1, torn down at the end, nothing public):
//   - the collab server (server/index.js) in a private temp folder with made-up random tokens for alex, sam, jo and a checker
//   - a tiny static file server for app/
//   - headless Chromium with ONE browser process and two windows (1100x700, no GPU, no WebGL): Alex and Sam on app/editor-demo.html in live mode
// What it does: each scenario seeds a fresh file, then drives both pages with real key events over the DevTools protocol
// (Input.dispatchKeyEvent for keys and shortcuts, Input.insertText for emoji and CJK), started at the same tick behind a barrier.
// The skew between the first input event on the two pages is measured in the pages themselves and reported.
// After every scenario the text of both pages (window.__demo) is compared with a FRESH third client reading the room
// through app/vespr-client.js, and any difference fails the scenario with the first differing index.
// Your tokens never appear in any output: pages get them in the URL fragment only, and nothing here prints a URL.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createClient } from '../app/vespr-client.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const req = createRequire(path.join(ROOT, 'agents/package.json')) // the same ws / yjs / y-websocket the server and the agents use
const WebSocket = req('ws'); const Y = req('yjs'); const { WebsocketProvider } = req('y-websocket')
const deps = { Y, WebsocketProvider, WebSocketPolyfill: WebSocket }

// ----------------------------------------------------------------------------------------------------------------------- options
const argv = process.argv.slice(2)
const opt = (name, dflt = null) => { const i = argv.indexOf('--' + name); if (i < 0) return dflt; const v = argv[i + 1]; return v && !v.startsWith('--') ? v : true }
if (opt('help')) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0) }
const ONLY = opt('only'); const BURST_S = Number(opt('burst', 3)); const SHOTS = opt('shots') && opt('shots') !== true ? path.resolve(opt('shots')) : null
let PORT = Number(opt('port', 0)); let WEB_PORT = 0 // without --port the first free pair from 9671 up is used (other stacks on this machine own 9611-9650, 9401-9422)
const W = 1100; const H = 700
const sleep = ms => new Promise(r => setTimeout(r, ms))
const rngOf = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const show = (s, max = 90) => { const j = String(JSON.stringify(s)); return j.length > max ? j.slice(0, max - 12) + '…(' + j.length + ' chars)' : j }
function firstDiff (a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; const c = s => JSON.stringify(s.slice(Math.max(0, i - 15), i + 25)); return `lengths ${a.length} vs ${b.length}, first difference at index ${i}: ${c(a)} vs ${c(b)}` }
class Check extends Error {}
const must = (cond, msg) => { if (!cond) throw new Check(msg) }
const same = (a, b, msg) => { if (a !== b) throw new Check(`${msg}: ${typeof a === 'string' && typeof b === 'string' ? firstDiff(a, b) : show(a) + ' vs ' + show(b)}`) }
async function waitFor (fn, ms, what, every = 60) { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { try { last = await fn(); if (last) return last } catch (e) { last = e } await sleep(every) } throw new Check(`timed out after ${ms} ms waiting for ${what}${last instanceof Error ? ': ' + last.message : ''}`) }

// ----------------------------------------------------------------------------------------------------------------------- the stack
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-editor-browser-')); fs.chmodSync(tmp, 0o700)
const DATA = path.join(tmp, 'data'); fs.mkdirSync(DATA)
const TOKENS = Object.fromEntries(['alex', 'sam', 'jo', 'checker', 'seeder'].map(n => [n, crypto.randomBytes(12).toString('hex')]))
fs.writeFileSync(path.join(tmp, 'tokens'), Object.entries(TOKENS).map(([n, t]) => `${n}:${t}`).join('\n') + '\n', { mode: 0o600 })
const ROOM = 'editor-test'; let WS_URL = ''
const procs = []; let server = null; let webServer = null; let chromium = null; let cdpPort = 0

const portFree = p => new Promise(r => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(p, '127.0.0.1', () => s.close(() => r(true))) })
function startServer () {
  const log = fs.openSync(path.join(tmp, 'server.log'), 'a')
  const env = { PATH: process.env.PATH, HOME: tmp, MURMIO_HOST: '127.0.0.1', MURMIO_PORT: String(PORT), MURMIO_DATA: DATA, MURMIO_TOKENS_FILE: path.join(tmp, 'tokens') }
  server = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], { env, stdio: ['ignore', log, log], cwd: ROOT })
  procs.push(server); return waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok, 15000, 'the collab server to answer /healthz', 150)
}
function killServer () { const s = server; const done = new Promise(r => s.once('exit', r)); process.kill(s.pid, 'SIGKILL'); return done } // by PID, never by name
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
function startWeb () {
  const appDir = path.join(ROOT, 'app')
  webServer = http.createServer((rq, rs) => {
    const u = new URL(rq.url, 'http://x'); const f = path.normalize(path.join(appDir, decodeURIComponent(u.pathname)))
    if (!f.startsWith(appDir + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { rs.writeHead(404); return rs.end('not found') }
    rs.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(rs)
  })
  return new Promise(r => webServer.listen(WEB_PORT, '127.0.0.1', r))
}

// ----------------------------------------------------------------------------------------------------------------------- DevTools protocol
class CDP {
  constructor (url) { this.id = 0; this.pending = new Map(); this.handlers = new Set(); this.ws = new WebSocket(url, { perMessageDeflate: false }) }
  open () { return new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); this.ws.on('message', m => { const d = JSON.parse(m); if (d.id && this.pending.has(d.id)) { const p = this.pending.get(d.id); this.pending.delete(d.id); d.error ? p.rej(new Error(`${p.method}: ${d.error.message}`)) : p.res(d.result) } else if (d.method) for (const h of this.handlers) h(d) }) }) }
  send (method, params = {}, sessionId) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { res, rej, method }); this.ws.send(JSON.stringify({ id, method, params, sessionId })) }) }
  close () { try { this.ws.close() } catch {} }
}
const KEYS = { Enter: [13, 'Enter', '\r'], Backspace: [8, 'Backspace'], Delete: [46, 'Delete'], Home: [36, 'Home'], End: [35, 'End'], ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'], ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'], Tab: [9, 'Tab'], Shift: [16, 'ShiftLeft'] }

class Page {
  constructor (cdp, sessionId, name) { this.cdp = cdp; this.s = sessionId; this.name = name; this.errors = []; this.typed = 0 }
  send (m, p) { return this.cdp.send(m, p, this.s) }
  async eval (expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Check(`${this.name}: page script failed: ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).split('\n')[0]}`)
    return r.result.value
  }
  // ---- real input
  key (key, { ctrl = false, shift = false, alt = false } = {}) {
    if (shift && /^[a-z]$/.test(key)) key = key.toUpperCase() // a real keyboard reports Shift+z as 'Z'
    const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0)
    let ev
    if (KEYS[key]) { const [vk, code, text] = KEYS[key]; ev = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, ...(text && !ctrl ? { text } : {}) } } else {
      const up = key.toUpperCase(); const letter = /^[a-z]$/i.test(key); const digit = /^[0-9]$/.test(key)
      ev = { key, code: letter ? 'Key' + up : digit ? 'Digit' + key : '', windowsVirtualKeyCode: letter || digit ? up.charCodeAt(0) : key.charCodeAt(0), nativeVirtualKeyCode: up.charCodeAt(0), modifiers, ...(ctrl ? {} : { text: key, unmodifiedText: key }) }
    }
    this.typed++
    return Promise.all([this.send('Input.dispatchKeyEvent', { type: 'keyDown', ...ev }), this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...ev, text: undefined, unmodifiedText: undefined })])
  }
  // text typed key by key (ASCII) or committed with insertText (anything else); gap = ms between keys, or a function
  async type (text, gap = 0) {
    for (const ch of [...text]) {
      if (ch.length === 1 && ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 127) await this.key(ch); else if (ch === '\n') await this.key('Enter'); else await this.send('Input.insertText', { text: ch })
      const g = typeof gap === 'function' ? gap() : gap; if (g > 0) await sleep(g)
    }
  }
  insertText (text) { return this.send('Input.insertText', { text }) }
  // ---- the editor behind window.__demo
  handle (js) { return this.eval(`(() => { const h = window.__demo.handle; return ${js} })()`) }
  text () { return this.handle('h.getText()') }
  focus () { return this.handle('(h.focus(), true)') }
  select (anchor, head = anchor) { return this.handle(`(h.setSelection(${anchor}, ${head}), true)`) }
  snapshot () { return this.eval(`(() => { const d = window.__demo; const h = d.handle; return { text: h.getText(), y: d.ytext.toString(), inSync: h.isInSync(), ws: !!d.provider.wsconnected, file: d.file } })()`) }
  labels () { return this.eval(`Array.from(document.querySelectorAll('.cm-rc-label')).map(e => e.textContent)`) }
  async shot (file) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return fs.statSync(file).size }
  async hoverAt (index) { const c = await this.handle(`(() => { const r = h.view.coordsAtPos(${index}); return r ? { x: r.left + 3, y: (r.top + r.bottom) / 2 } : null })()`); must(c, `no screen position for index ${index}`); for (const dx of [-30, -10, 0, 1]) await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x + dx, y: c.y }); return c }
  arm () { return this.eval('(window.__first = null, window.__last = null, true)') }
  span () { return this.eval('[window.__first, window.__last]') }
}

async function launchBrowser () {
  cdpPort = 9700 + Math.floor(Math.random() * 200)
  const args = ['--headless=new', `--remote-debugging-port=${cdpPort}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-3d-apis', '--disable-extensions', '--disable-background-networking',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--hide-scrollbars', `--window-size=${W},${H}`, `--user-data-dir=${path.join(tmp, 'chromium')}`, 'about:blank']
  chromium = spawn('chromium', args, { stdio: 'ignore', env: { ...process.env, TMPDIR: tmp } }); procs.push(chromium) // its own scratch folders (org.chromium.*) go into our temp folder too, so nothing is left in /tmp
  const info = await waitFor(async () => (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json(), 20000, 'Chromium to start', 200)
  const cdp = new CDP(info.webSocketDebuggerUrl); await cdp.open()
  cdp.handlers.add(d => {
    if (d.method === 'Runtime.exceptionThrown') { const p = pages.find(x => x.s === d.sessionId); if (p) p.errors.push((d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description || d.params.exceptionDetails.text).split('\n')[0]) }
  })
  mainCdp = cdp; return cdp
}
let mainCdp = null
const pages = []
async function openPage (cdp, name, user, file = null) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true, width: W, height: H })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const p = new Page(cdp, sessionId, name); p.targetId = targetId; pages.push(p)
  await p.send('Runtime.enable'); await p.send('Page.enable')
  await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
  await p.send('Emulation.setFocusEmulationEnabled', { enabled: true }) // both windows think they have the focus, whatever the window manager says
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__first = null; window.__last = null; const mark = () => { const t = performance.timeOrigin + performance.now(); if (window.__first === null) window.__first = t; window.__last = t }; addEventListener('keydown', mark, true); addEventListener('beforeinput', mark, true)` })
  const color = encodeURIComponent(user === 'alex' ? '#a5b4fc' : user === 'sam' ? '#fbbf77' : '#86efac')
  await p.send('Page.navigate', { url: `http://127.0.0.1:${WEB_PORT}/editor-demo.html?live=1&server=${encodeURIComponent(WS_URL)}&room=${ROOM}&name=${user}&color=${color}${file ? '&file=' + encodeURIComponent(file) : ''}#token=${TOKENS[user]}` })
  await waitFor(() => p.eval('!!(window.__demo && window.__demo.mode === "live" && window.__demo.provider && window.__demo.provider.synced)'), 25000, `${name}'s page to load and sync`)
  return p
}

// ----------------------------------------------------------------------------------------------------------------------- the room: seeding and the fresh third client
let seeder = null; let fileNo = 0
async function seedFile (text, slug) {
  const file = `t${String(++fileNo).padStart(2, '0')}-${slug}.py`
  const files = seeder.files; const t = new Y.Text()
  seeder.doc.transact(() => { files.set(file, t); t.insert(0, text, { by: 'import', t: Math.floor(Date.now() / 60000) }) })
  await waitFor(() => Promise.all(pages.slice(0, 2).map(p => p.eval(`window.__demo.client.files.has(${JSON.stringify(file)}) && window.__demo.client.files.get(${JSON.stringify(file)}).toString().length === ${text.length}`))).then(r => r.every(Boolean)), 15000, `both pages to receive ${file}`)
  return file
}
async function openOn (file) { for (const p of pages.slice(0, 2)) { await p.eval(`window.__demo.open(${JSON.stringify(file)})`); await p.focus() } }
async function freshRead (file) {
  const c = createClient({ server: WS_URL, room: ROOM, token: TOKENS.checker, name: 'checker', deps })
  try { await Promise.race([c.ready, sleep(12000).then(() => { throw new Check('the fresh client could not sync with the server') })]); const t = c.read(file); must(t !== null, `the fresh client does not see ${file}`); return t } finally { c.destroy() }
}
// Everyone identical: both pages' editors and Y.Texts, and a fresh client reading the room. Waits for the network, then fails loudly.
async function converge (label, file, { timeout = 25000 } = {}) {
  const [A, B] = pages; const t0 = Date.now(); let last = {}
  while (Date.now() - t0 < timeout) {
    const [a, b] = await Promise.all([A.snapshot(), B.snapshot()]); last = { a, b }
    if (a.text === b.text && a.text === a.y && b.text === b.y && a.inSync && b.inSync) { const fresh = await freshRead(file); last.fresh = fresh; if (fresh === a.text) return { text: a.text, ms: Date.now() - t0 } }
    await sleep(100)
  }
  const { a, b, fresh } = last
  const lines = [`${label}: no agreement after ${timeout} ms`]
  if (a && b) { lines.push(`  alex's editor vs sam's editor: ${a.text === b.text ? 'same' : firstDiff(a.text, b.text)}`, `  alex editor vs alex Y.Text: ${a.text === a.y ? 'same' : firstDiff(a.text, a.y)}`, `  sam editor vs sam Y.Text: ${b.text === b.y ? 'same' : firstDiff(b.text, b.y)}`, `  connected: alex ${a.ws}, sam ${b.ws}`) }
  if (fresh != null && a) lines.push(`  fresh third client vs alex's editor: ${fresh === a.text ? 'same' : firstDiff(fresh, a.text)}`)
  throw new Check(lines.join('\n'))
}
// Run two coroutines that start at the same tick, then report how far apart the pages saw their first input (both read the same clock)
async function together (fnA, fnB) {
  const [A, B] = pages
  for (let i = 0; i < 3; i++) await Promise.all([A.key('Shift'), B.key('Shift')]) // warm up both input paths: the first event after an idle moment is the slow one
  await sleep(50); await Promise.all([A.arm(), B.arm()])
  let n = 0; let release; const gate = new Promise(r => { release = r }); const hit = () => { if (++n === 2) release(); return gate }
  const results = await Promise.all([(async () => { await hit(); return fnA(A) })(), (async () => { await hit(); return fnB(B) })()])
  const [[fa, la], [fb, lb]] = await Promise.all([A.span(), B.span()]); const skew = fa != null && fb != null ? Math.abs(fa - fb) : null
  const overlap = fa != null && fb != null ? Math.max(0, Math.min(la, lb) - Math.max(fa, fb)) : 0 // ms during which both pages were receiving keys
  must(skew == null || skew < 200, `the two pages started ${Math.round(skew)} ms apart: the harness is not simultaneous enough to mean anything`)
  stats.skews.push(skew); stats.overlaps.push(overlap); return { results, skew, overlap }
}
const stats = { skews: [], overlaps: [] }
const authors = async (page) => page.eval(`JSON.stringify(window.__demo.ytext.toDelta().map(o => [o.insert, (o.attributes && o.attributes.by) || null]))`).then(JSON.parse)
const authorOf = (runs, text) => { let i = 0; const m = new Map(); for (const [s, by] of runs) { for (let k = 0; k < s.length; k++) m.set(i + k, by); i += s.length } return idx => m.get(idx) }
const noBrokenText = t => { for (let i = 0; i < t.length; i++) { const u = t.charCodeAt(i); if (u >= 0xD800 && u <= 0xDBFF && t.charCodeAt(i + 1) >= 0xDC00 && t.charCodeAt(i + 1) <= 0xDFFF) i++; else if (u >= 0xD800 && u <= 0xDFFF) return false } return !t.includes('�') }

// ----------------------------------------------------------------------------------------------------------------------- scenarios
const scenarios = []
const scenario = (name, fn) => scenarios.push({ name, fn })
const BASE = 'line one\nline two\nline three\nline four\n'

scenario('the exact same position at the same instant (real keys): 12 characters each, one whole burst after the other, same order on both pages, in rounds until the typing really overlapped 3 times', async () => {
  const [A, B] = pages; const orders = []; const skews = []; let overlapped = 0; let round = 0
  while (overlapped < 3 && round < 10) {
    const file = await seedFile(BASE, 'same-spot-' + round); await openOn(file)
    const at = BASE.indexOf('line two') + 8; await A.select(at); await B.select(at)
    const { skew, overlap } = await together(p => p.type('A'.repeat(12), 1), p => p.type('B'.repeat(12), 1)); skews.push(skew); if (overlap > 15) overlapped++
    const { text } = await converge(`same spot, round ${round}`, file)
    const ab = text === BASE.slice(0, at) + 'A'.repeat(12) + 'B'.repeat(12) + BASE.slice(at); const ba = text === BASE.slice(0, at) + 'B'.repeat(12) + 'A'.repeat(12) + BASE.slice(at)
    must(ab || ba, `round ${round}: the two bursts must stay whole and in one order, got ${show(text.slice(at - 3, at + 28))}`)
    orders.push(ab ? 'AB' : 'BA'); const by = authorOf(await authors(A))
    must([...Array(12).keys()].every(i => by(at + i) === by(at)) && [...Array(12).keys()].every(i => by(at + 12 + i) === by(at + 12)) && [by(at), by(at + 12)].sort().join() === 'alex,sam', `round ${round}: authors of the two bursts: ${by(at)}, ${by(at + 12)}`)
    round++
  }
  must(overlapped >= 2, `only ${overlapped} of ${round} rounds had both pages typing at the same time: the machine is too busy for this test to mean anything`)
  const ok = skews.filter(x => x != null)
  return `${round} rounds, ${overlapped} with overlapping typing, orders ${orders.join(' ')}, skew ${Math.min(...ok).toFixed(1)}-${Math.max(...ok).toFixed(1)} ms`
})

scenario('one deletes a range (select, Delete) while the other types inside it', async () => {
  const text0 = 'AAAA BBBB CCCC DDDD EEEE\n'; const file = await seedFile(text0, 'delete-vs-type'); await openOn(file); const [A, B] = pages
  await A.select(5, 15); await B.select(10)
  const { skew } = await together(p => p.key('Delete'), p => p.type('xyz', 3))
  const { text } = await converge('delete vs type', file)
  same(text, 'AAAA ' + 'xyz' + 'DDDD EEEE\n', 'the deleted range is gone, the text typed inside it survives')
  return `skew ${skew == null ? '?' : skew.toFixed(1)} ms`
})

scenario('both delete overlapping ranges (Backspace and Delete on [4,12) and [8,16))', async () => {
  const text0 = '0123456789ABCDEFGHIJKLMNOP\n'; const file = await seedFile(text0, 'overlap'); await openOn(file); const [A, B] = pages
  await A.select(4, 12); await B.select(8, 16)
  const { skew } = await together(p => p.key('Backspace'), p => p.key('Delete'))
  const { text } = await converge('overlapping deletes', file); same(text, text0.slice(0, 4) + text0.slice(16), 'the union is gone, nothing else')
  return `skew ${skew == null ? '?' : skew.toFixed(1)} ms`
})

scenario('delete-all (Ctrl+A, Delete) against typing in the middle: only the typed text survives', async () => {
  const file = await seedFile(BASE, 'delete-all'); await openOn(file); const [A, B] = pages
  await A.select(0, BASE.length); await B.select(12)
  const { skew } = await together(p => p.key('Delete'), p => p.type('XYZ', 4))
  const { text } = await converge('delete all', file); same(text, 'XYZ', 'only what was typed while everything was being deleted')
  return `skew ${skew == null ? '?' : skew.toFixed(1)} ms`
})

scenario("authorship after a concurrent delete: Sam deletes the start of Alex's run while Alex keeps typing, and Alex's new text gets Alex back as its author", async () => {
  const text0 = 'ghij: \n'; const file = await seedFile(text0, 'author-heal'); await openOn(file); const [A, B] = pages
  await A.select(6); await A.type('hello', 5); await converge('before the delete', file)
  const { skew } = await together(p => p.type(' world', 5), p => p.handle('(h.deleteRange(6, 11), true)')) // absolute range: "hello" as both pages see it
  const { text } = await converge('after the delete', file); same(text, 'ghij:  world\n', "sam's delete took 'hello' and nothing else, alex's typing stayed")
  const at = text.indexOf(' world'); const who = async () => { const by = authorOf(await authors(A)); return Array.from({ length: 6 }, (_, k) => by(at + k)) }
  const t0 = Date.now(); await waitFor(async () => (await who()).every(x => x === 'alex'), 8000, `" world" to be by alex (it is by ${(await who()).join('/')} so far)`, 100)
  await converge('after healing', file); return `skew ${skew == null ? '?' : skew.toFixed(1)} ms, author back after ${Date.now() - t0} ms`
})

scenario('read-only editor (the phone case): no typing, paste, drop, undo or API edit gets in; remote text, cursors, labels and the authorship hover still work; writable again afterwards', async () => {
  const text0 = 'ghij: \nklm nop\n'; const file = await seedFile(text0, 'readonly'); await openOn(file); const [A, B] = pages
  // Sam's editor is rebuilt with the same createEditor call the shell makes on a phone: readOnly: true
  await B.eval(`(async () => { const d = window.__demo; const { createEditor } = await import('./vendor/editor.js'); d.handle.destroy(); const host = document.querySelector('.host'); host.replaceChildren(); d.handle = d.a = createEditor({ parent: host, Y: d.Y, ytext: d.ytext, awareness: d.awareness, user: { name: 'sam', color: '#fbbf77' }, file: d.file, claims: d.doc.getMap('claims'), readOnly: true }); return true })()`)
  await B.focus(); await B.select(7)
  must(await B.handle('h.view.state.readOnly === true'), 'the editor was built read-only')
  const attrs = await B.eval(`(() => { const c = document.querySelector('.cm-content'); return ['contenteditable', 'aria-readonly', 'inputmode'].map(a => a + '=' + c.getAttribute(a)).join(' ') })()`)
  const synth = (kind) => B.eval(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'SYNTH-${kind}'); const c = document.querySelector('.cm-content'); const r = c.getBoundingClientRect()
    const ev = ${kind === 'paste' ? "new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })" : "new DragEvent('drop', { dataTransfer: dt, clientX: r.left + 40, clientY: r.top + 10, bubbles: true, cancelable: true })"}
    c.dispatchEvent(ev); return ev.defaultPrevented })()`)
  const domText = () => B.eval(`Array.from(document.querySelectorAll('.cm-content .cm-line')).map(l => { const c = l.cloneNode(true); c.querySelectorAll('.cm-rc, .cm-widgetBuffer, .cm-problem-dot, .cm-recent-tick').forEach(e => e.remove()); return c.textContent.replace(/[\\u2060\\u200B]/g, '') }).join('')`) // the text of the lines, without cursor labels and other widgets
  const attempts = async () => {
    await B.type('zzz', 3); await B.key('Enter'); await B.key('Backspace'); await B.key('Delete'); await B.key('Tab'); await B.insertText('QQQ'); await B.insertText('日本 😀')
    await B.key('a', { ctrl: true }); await B.key('Delete'); await B.key('Backspace')
    await B.key('z', { ctrl: true }); await B.key('y', { ctrl: true }); await B.key('z', { ctrl: true, shift: true })
    await synth('paste'); await synth('drop')
  }
  await attempts(); await sleep(500)
  const apiEdits = await B.handle("[h.insertAt(0, 'x'), h.deleteRange(0, 1)]"); must(apiEdits.every(r => r === false), `insertAt/deleteRange must refuse in read-only mode, got ${show(apiEdits)}`)
  let snapB = await B.snapshot(); same(snapB.text, text0, "Sam's read-only editor after every attempt to type, delete, paste, drop and undo"); same(snapB.y, text0, "Sam's Y.Text after the attempts: nothing may reach the shared text")
  same((await domText()).replace(/\n/g, ''), text0.replace(/\n/g, ''), "the DOM Sam sees (the browser may have inserted something the editor then undid)")
  const r1 = await converge('after the attempts', file); same(r1.text, text0, 'the room still holds the original text (fresh client)')
  // what a viewer must still get: other people's text, their cursors and labels, who wrote what
  await A.select(2, 9); await waitFor(async () => (await B.labels()).includes('alex') && (await B.eval(`document.querySelectorAll('.cm-rsel').length > 0`)), 8000, "alex's label and selection in the read-only page")
  await B.select(3, 5); await waitFor(async () => (await A.labels()).includes('sam'), 8000, "the read-only viewer's own cursor label for alex")
  await A.select(14); await A.type('HELLO', 5)
  await waitFor(async () => (await B.text()).includes('HELLO'), 8000, "alex's typing to reach the read-only page"); await converge('after alex typed', file)
  same((await domText()).replace(/\n/g, ''), (await B.text()).replace(/\n/g, ''), 'the read-only DOM follows the remote change')
  const typedAt = (await B.text()).indexOf('HELLO'); const who = () => B.eval(`(document.querySelector('.cm-hover-info .cm-who-name') || {}).textContent || ''`)
  await B.hoverAt(typedAt + 1); await waitFor(async () => (await who()) === 'alex', 6000, `the authorship hover on alex's text (it says ${show(await who())})`)
  await B.hoverAt(1); await waitFor(async () => (await who()) === 'Imported', 6000, 'the authorship hover on the imported text')
  // the control: the same attempts DO work once the editor is writable, so the checks above were not vacuous
  await B.handle('(h.setReadOnly(false), true)'); await B.select(0)
  await B.type('ok', 3); const p = await synth('paste'); const d = await synth('drop')
  await waitFor(async () => { const t = await A.text(); return t.includes('ok') && (t.includes('SYNTH-paste') || !p) && (t.includes('SYNTH-drop') || !d) }, 8000, 'the writable editor to take typing, paste and drop (control)')
  const r2 = await converge('after the control', file)
  return `${attrs}; ${r2.text.length - text0.length - 5} characters typed, pasted and dropped only after setReadOnly(false)`
})

scenario('unicode in the real DOM: emoji, CJK, ZWJ family, combining marks, Backspace over an emoji, both at once', async () => {
  const text0 = 'x\u{1F600}y\n'; const file = await seedFile(text0, 'unicode'); await openOn(file); const [A, B] = pages
  const family = '👨‍👩‍👧'
  await A.select(text0.length); await B.select(3) // after the emoji
  const { skew } = await together(async p => { await p.insertText('日本語 '); await p.insertText(family); await p.insertText('é') }, async p => { await p.key('Backspace'); await p.insertText('🎉') })
  const { text } = await converge('unicode', file)
  must(noBrokenText(text), `a surrogate pair was split or replaced: ${show(text)}`)
  must(!text.includes('\u{1F600}') && text.includes('🎉') && text.includes('日本語') && text.includes(family) && text.includes('é'), `expected the emoji replaced by the party popper and all the rest kept, got ${show(text)}`)
  const { y } = await A.snapshot(); same(y.length, text.length, 'UTF-16 length of the Y.Text')
  return `skew ${skew == null ? '?' : skew.toFixed(1)} ms, ${text.length} UTF-16 units`
})

scenario(`both type bursts on one line for ${BURST_S} seconds (random 4-20 ms between keys): nothing lost, each one's text in order, authors right`, async () => {
  const text0 = 'ghij: \nklm nop\n'; const file = await seedFile(text0, 'burst'); await openOn(file); const [A, B] = pages // no letters a-f in the start text, so the typed letters can be told apart
  await A.select(6); await B.select(6)
  const rA = rngOf(1); const rB = rngOf(2); const typedA = []; const typedB = []
  const typist = (letters, r, typed) => async p => { const end = Date.now() + BURST_S * 1000; while (Date.now() < end) { const ch = letters[Math.floor(r() * letters.length)]; await p.key(ch); typed.push(ch); await sleep(4 + Math.floor(r() * 17)) } }
  const { skew, overlap } = await together(typist('abcdef', rA, typedA), typist('ABCDEF', rB, typedB))
  must(overlap > BURST_S * 1000 * 0.6, `the two bursts overlapped for only ${Math.round(overlap)} ms of ${BURST_S * 1000}`)
  const { text, ms } = await converge('bursts', file)
  same(text.replace(/[^a-f]/g, ''), typedA.join(''), "alex's keystrokes, in order, in the final text"); same(text.replace(/[^A-F]/g, ''), typedB.join(''), "sam's keystrokes, in order, in the final text")
  same(text.replace(/[a-fA-F]/g, ''), text0, 'the text that was already there'); const by = authorOf(await authors(A))
  for (let i = 0; i < text.length; i++) { const c = text[i]; if (/[a-f]/.test(c)) must(by(i) === 'alex', `${c} at ${i} is by ${by(i)}, not alex`); else if (/[A-F]/.test(c)) must(by(i) === 'sam', `${c} at ${i} is by ${by(i)}, not sam`) }
  return `${typedA.length} + ${typedB.length} keystrokes, both typing for ${Math.round(overlap)} ms at once, skew ${skew == null ? '?' : skew.toFixed(1)} ms, settled in ${ms} ms`
})

scenario('cursor labels: each sees the other\'s name and selection in the DOM, not their own; the label goes when the person leaves the file', async () => {
  const file = await seedFile(BASE + 'x'.repeat(30) + '\n', 'cursors'); await openOn(file); const [A, B] = pages
  const other = await seedFile('other file\n', 'cursors-other')
  await A.select(5, 14); await B.select(20)
  await waitFor(async () => (await B.labels()).includes('alex') && (await A.labels()).includes('sam'), 8000, 'both cursor labels to appear')
  must(!(await A.labels()).includes('alex') && !(await B.labels()).includes('sam'), 'a person must never see their own label')
  await waitFor(() => B.eval(`document.querySelectorAll('.cm-rsel').length > 0`), 5000, "alex's selection highlight in sam's DOM")
  const caretMoved = await (async () => { await A.select(30); await waitFor(() => B.eval(`window.__demo.handle.remoteCursors().some(c => c.name === 'alex' && c.head === 30)`), 5000, "sam's editor to move alex's cursor to 30"); return true })()
  await A.eval(`window.__demo.open(${JSON.stringify(other)})`); await A.select(2)
  await waitFor(async () => !(await B.labels()).includes('alex'), 8000, "alex's label to disappear from sam's page after alex switched files")
  await A.eval(`window.__demo.open(${JSON.stringify(file)})`); await A.select(9)
  await waitFor(async () => (await B.labels()).includes('alex'), 8000, "alex's label to come back")
  return caretMoved ? 'labels, highlight, movement, file switch all seen in the DOM' : ''
})

scenario('undo scope: Ctrl+Z only removes your own typing, many presses never touch the other person; redo restores it', async () => {
  // A burst may be one undo step or a few (the capture window is 500 ms and this machine can stall longer), so every phase presses the key
  // several times: the point is that the other person's text is never touched and that undo + redo gives back exactly what was typed.
  const text0 = 'base\n'; const file = await seedFile(text0, 'undo'); await openOn(file); const [A, B] = pages
  await A.select(text0.length); await A.type('mine', 10); await sleep(700) // a pause ends the undo step
  await B.select(0); await B.type('theirs ', 10); await converge('before undo', file)
  for (let i = 0; i < 8; i++) { await A.key('z', { ctrl: true }); await sleep(40) }
  let r = await converge('after alex undid', file); same(r.text, 'theirs base\n', "alex's Ctrl+Z (8 presses) removed alex's typing and nothing of sam's")
  for (let i = 0; i < 8; i++) { await A.key('z', { shift: true, ctrl: true }); await sleep(40) }
  r = await converge('after redo', file); same(r.text, 'theirs base\nmine', "Ctrl+Shift+Z brings alex's typing back, all of it")
  for (let i = 0; i < 8; i++) { await B.key('z', { ctrl: true }); await sleep(40) }
  r = await converge('after sam undid', file); same(r.text, 'base\nmine', "sam's Ctrl+Z removes only sam's typing")
  await A.key('y', { ctrl: true }); r = await converge('redo with nothing to redo', file); same(r.text, 'base\nmine', 'redo with nothing to redo changes nothing')
  return 'alex and sam each undo only their own'
})

scenario('paste of 200 lines (a real paste event) while the other types, then both undo', async () => {
  const file = await seedFile('# top\n# bottom\n', 'paste'); await openOn(file); const [A, B] = pages
  const lines = Array.from({ length: 200 }, (_, i) => `def f${i}(x):\n    return x * ${i} + ${i % 7}  # pasted line ${i}`).join('\n') + '\n'
  await A.select(6); await B.select(14)
  const t0 = Date.now(); let handled = null
  await together(async p => { handled = await p.eval(`(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(lines)}); const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); document.querySelector('.cm-content').dispatchEvent(ev); return ev.defaultPrevented })()`); if (!handled) await p.insertText(lines) }, p => p.type('typed-by-sam', 3))
  const { text, ms } = await converge('paste', file)
  must(text.includes(lines) && text.includes('typed-by-sam'), `both the 200 lines and the typing must be there (${text.length} chars)`)
  must(text.split('\n').length >= 402, 'at least 402 lines')
  await sleep(600); await A.key('z', { ctrl: true }); const r = await converge('after undoing the paste', file); must(!r.text.includes('pasted line') && r.text.includes('typed-by-sam'), "alex's Ctrl+Z removes the whole paste and keeps sam's typing")
  return `${handled ? 'paste event' : 'insertText'}, ${lines.length} chars, reached everyone in ${ms} ms (${Date.now() - t0} ms in all)`
})

scenario('offline edits: both disconnect, both type on the same line (and one deletes), then reconnect: everything typed survives, in order', async () => {
  const text0 = 'ghij: \nklm nop\n'; const file = await seedFile(text0, 'offline'); await openOn(file); const [A, B] = pages
  await A.select(6); await B.select(6)
  for (const p of [A, B]) await p.eval('(window.__demo.provider.disconnect(), true)')
  await waitFor(async () => (await Promise.all([A, B].map(p => p.eval('!window.__demo.provider.wsconnected')))).every(Boolean), 8000, 'both pages to be offline')
  await together(p => p.type('abcabcabcabc', 3), async p => { await p.type('DEFDEFDEFDEF', 3); await p.select(0, 5); await p.key('Delete') }) // sam also deletes "ghij:" on the way
  const [a, b] = await Promise.all([A.snapshot(), B.snapshot()]); must(a.text !== b.text, 'the two pages must have drifted apart while offline')
  for (const p of [A, B]) await p.eval('(window.__demo.provider.connect(), true)')
  const { text, ms } = await converge('after the reconnect', file)
  same(text.replace(/[^a-c]/g, ''), 'abcabcabcabc', "alex's offline typing, in order"); same(text.replace(/[^D-F]/g, ''), 'DEFDEFDEFDEF', "sam's offline typing, in order")
  must(!text.includes('ghij:') && text.includes('klm nop'), `sam's deletion of "ghij:" went through and the rest is intact: ${show(text)}`)
  return `drifted apart offline, identical ${ms} ms after reconnecting`
})

scenario(`the server is killed (SIGKILL, by PID) and restarted while both keep typing: no keystroke lost after the reconnect`, async () => {
  const text0 = 'ghij: \nklm nop\n'; const file = await seedFile(text0, 'restart'); await openOn(file); const [A, B] = pages
  await A.select(6); await B.select(6)
  const typedA = []; const typedB = []; const sawDown = { alex: false, sam: false }; let stop = false
  const typist = (letters, r, typed, name) => async p => { let k = 0; while (!stop) { const ch = letters[k++ % letters.length]; await p.key(ch); typed.push(ch); if (k % 5 === 0 && !sawDown[name]) sawDown[name] = !(await p.eval('!!window.__demo.provider.wsconnected')); await sleep(12 + Math.floor(r() * 12)) } }
  const driver = (async () => { await sleep(1200); await killServer(); await sleep(2200); await startServer(); await sleep(2500); stop = true })()
  await Promise.all([together(typist('abcdef', rngOf(3), typedA, 'alex'), typist('ABCDEF', rngOf(4), typedB, 'sam')), driver])
  must(sawDown.alex && sawDown.sam, `the kill must really cut both connections (alex saw it: ${sawDown.alex}, sam: ${sawDown.sam})`)
  await waitFor(async () => (await Promise.all(pages.slice(0, 2).map(p => p.eval('!!window.__demo.provider.wsconnected')))).every(Boolean), 30000, 'both pages to reconnect after the restart', 200)
  const { text, ms } = await converge('after the restart', file, { timeout: 40000 })
  same(text.replace(/[^a-f]/g, ''), typedA.join(''), "alex's keystrokes, including the ones typed while the server was down"); same(text.replace(/[^A-F]/g, ''), typedB.join(''), "sam's keystrokes, including the ones typed while the server was down")
  return `${typedA.length} + ${typedB.length} keystrokes, reconnected and identical ${ms} ms after the last key`
})

scenario('a late joiner (third window) loads the same text and cursor labels of the two already there', async () => {
  const file = await seedFile('late joiner\n', 'late'); await openOn(file); const [A, B] = pages
  await A.select(4); await B.select(8); await A.type(' one', 5); await B.type(' two', 5); await converge('before the joiner', file)
  const jo = await openPage(pages[0].cdp, 'jo', 'jo', file)
  try {
    const s = await jo.snapshot(); const a = await A.snapshot(); same(s.text, a.text, "jo's editor vs alex's"); must(s.inSync && s.file === file, 'jo is in sync on the right file')
    await waitFor(async () => { const l = await jo.labels(); return l.includes('alex') && l.includes('sam') }, 8000, "jo to see alex's and sam's labels")
    await jo.focus(); await jo.select(1); await jo.type('J'); await waitFor(async () => (await A.text()).includes('J') && (await B.text()).includes('J'), 10000, "jo's typing to reach alex and sam"); await converge('after the joiner typed', file)
  } finally { await pages[0].cdp.send('Target.closeTarget', { targetId: jo.targetId }).catch(() => {}); pages.splice(pages.indexOf(jo), 1) }
})

scenario('screenshots of both pages, dark and light', async () => {
  const dir = SHOTS || path.join(tmp, 'shots'); fs.mkdirSync(dir, { recursive: true }); const [A, B] = pages
  const file = await seedFile('def total(items):\n    t = 0\n    for it in items:\n        t += it["price"] * it["qty"]\n    return t\n', 'shots'); await openOn(file)
  await A.select(30, 52); await B.select(80); await waitFor(async () => (await B.labels()).includes('alex') && (await A.labels()).includes('sam'), 8000, 'labels for the screenshots')
  const sizes = []
  for (const theme of ['dark', 'light']) { for (const p of pages.slice(0, 2)) await p.eval(`window.__demo.theme('${theme}')`); await sleep(400); for (const p of pages.slice(0, 2)) { const f = path.join(dir, `editor-${p.name}-${theme}.png`); const n = await p.shot(f); must(n > 6000, `${f} looks empty (${n} bytes)`); sizes.push(`${path.basename(f)} ${(n / 1024).toFixed(0)} KB`) } }
  return `saved in ${dir}: ${sizes.join(', ')}`
})

// ----------------------------------------------------------------------------------------------------------------------- main
async function cleanup () {
  for (const p of pages) try { await p.send('Page.close').catch(() => {}) } catch {}
  if (mainCdp) { const gone = new Promise(r => chromium.once('exit', r)); await mainCdp.send('Browser.close').catch(() => {}); await Promise.race([gone, sleep(3000)]) } // a clean exit removes Chromium's own temp folders
  if (seeder) try { seeder.destroy() } catch {}
  for (const pr of procs) try { pr.kill('SIGKILL') } catch {}
  try { webServer && webServer.close() } catch {}
  await sleep(300)
  if (!SHOTS) fs.rmSync(tmp, { recursive: true, force: true }); else { fs.rmSync(path.join(tmp, 'tokens'), { force: true }); fs.rmSync(tmp, { recursive: true, force: true }) }
}
process.on('SIGINT', async () => { await cleanup(); process.exit(130) })

if (opt('list')) { for (const s of scenarios) console.log(s.name); process.exit(0) }
let failed = 0; let passed = 0; const started = Date.now()
try {
  if (!PORT) for (let p = 9671; p < 9780; p += 2) if (![9696, 9697].includes(p) && await portFree(p) && await portFree(p + 1)) { PORT = p; break }
  must(PORT && await portFree(PORT) && await portFree(PORT + 1), `no free pair of ports (tried from 9671): pass --port <n>`)
  WEB_PORT = PORT + 1; WS_URL = `ws://127.0.0.1:${PORT}`
  await startServer(); await startWeb()
  seeder = createClient({ server: WS_URL, room: ROOM, token: TOKENS.seeder, name: 'seeder', deps }); await seeder.ready
  const cdp = await launchBrowser()
  await openPage(cdp, 'alex', 'alex'); await openPage(cdp, 'sam', 'sam')
  console.log(`editor browser test: server and 2 windows up (${W}x${H}, headless, no GPU); chromium pid ${chromium.pid}, server pid ${server.pid}`)
  for (const sc of scenarios.filter(s => !ONLY || s.name.toLowerCase().includes(String(ONLY).toLowerCase()))) {
    const t0 = Date.now(); for (const p of pages) p.errors.length = 0
    try {
      const note = await sc.fn()
      const errs = pages.flatMap(p => p.errors.map(e => `${p.name}: ${e}`)); must(errs.length === 0, `uncaught errors in the pages: ${errs.slice(0, 3).join(' | ')}`)
      passed++; console.log(`  ok    ${sc.name}${note ? '  (' + note + ')' : ''}  [${Date.now() - t0} ms]`)
    } catch (e) { failed++; console.log(`  FAIL  ${sc.name}  [${Date.now() - t0} ms]\n${String(e && e.message || e).split('\n').map(l => '        ' + l).join('\n')}`); if (!(e instanceof Check) && e && e.stack) console.log(e.stack.split('\n').slice(1, 4).map(l => '        ' + l.trim()).join('\n')) }
  }
  const ov = stats.overlaps.filter(x => x > 0); if (ov.length) console.log(`  overlap: both pages were receiving keys at once for ${Math.round(Math.min(...ov))} to ${Math.round(Math.max(...ov))} ms in ${ov.length} of ${stats.overlaps.length} simultaneous runs`)
  const sk = stats.skews.filter(x => x != null).sort((a, b) => a - b)
  if (sk.length) console.log(`  barrier: first input reached the two pages ${sk[0].toFixed(1)} to ${sk[sk.length - 1].toFixed(1)} ms apart (median ${sk[Math.floor(sk.length / 2)].toFixed(1)} ms) over ${sk.length} simultaneous starts`)
} catch (e) { failed++; console.log('FAIL  setup: ' + (e && e.message || e)); if (!(e instanceof Check) && e && e.stack) console.log(e.stack.split('\n').slice(0, 5).join('\n')) } finally { await cleanup() }
console.log(failed ? `\neditor browser tests: ${failed} FAILED, ${passed} passed (${((Date.now() - started) / 1000).toFixed(0)} s)` : `\neditor browser tests: ${passed} of ${passed} passed (${((Date.now() - started) / 1000).toFixed(0)} s)`)
process.exit(failed ? 1 : 0)
