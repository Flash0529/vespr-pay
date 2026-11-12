// Smoke test for a deployed VESPR (staging or production), no secrets printed.
//   node scripts/smoke-app.mjs <baseUrl> [--app <appUrl>] [--token-env VAR]
// <baseUrl> is the collab/API server (https://collab.example.com); --app is where prototype.html is served (default: same origin).
// The bearer token is read from the environment variable named by --token-env (default VESPR_SMOKE_TOKEN) and never printed or put in a URL.
// What it checks: server health, the app page and its scripts load, CORS lets the app call the API, the chat endpoint refuses signed-out callers and answers (or says it has no model)
// for a signed-in one, share endpoints answer (or are off), and a WebSocket opens to a room. Exit code is the number of failures.
import { createRequire } from 'node:module'
const args = process.argv.slice(2)
const base = (args.find(a => /^https?:/.test(a)) || '').replace(/\/$/, '')
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const appUrl = (opt('--app') || base).replace(/\/$/, ''); const tokVar = opt('--token-env') || 'VESPR_SMOKE_TOKEN'; const token = process.env[tokVar] || ''
if (!base) { console.log('usage: node scripts/smoke-app.mjs <baseUrl> [--app <appUrl>] [--token-env VAR]'); process.exit(2) }
let fails = 0; const results = []
const check = async (name, fn) => { try { const r = await fn(); const ok = r === true || (r && r.ok); results.push({ name, ok: !!ok, note: r && r.note || '' }); if (!ok) fails++ } catch (e) { results.push({ name, ok: false, note: String(e.message || e).slice(0, 120) }); fails++ } }
const get = (u, init) => fetch(u, { signal: AbortSignal.timeout(15000), ...init })
await check('server health', async () => (await get(base + '/healthz')).ok)
await check('app page loads', async () => { const r = await get(appUrl + '/prototype.html'); const t = await r.text(); return { ok: r.ok && /<title>VESPR/.test(t), note: 'status ' + r.status } })
for (const f of ['frost.css', 'palette-search.js', 'personal-chats.js', 'vespr-client.js']) await check('app file ' + f, async () => { const r = await get(appUrl + '/' + f); return { ok: r.ok, note: 'status ' + r.status } })
await check('CORS preflight allows the app to call the API', async () => { const r = await get(base + '/api/personal/chat', { method: 'OPTIONS', headers: { Origin: appUrl, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } }); const allow = r.headers.get('access-control-allow-headers') || ''; return { ok: r.status < 300 && /authorization/i.test(allow), note: 'status ' + r.status } })
await check('chat endpoint refuses signed-out callers', async () => { const r = await get(base + '/api/personal/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) }); return { ok: r.status === 401, note: 'status ' + r.status } })
if (token) {
  await check('chat endpoint answers or says it has no model', async () => { const r = await get(base + '/api/personal/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Reply with the single word: ok' }] }) }); const j = await r.json().catch(() => ({})); return { ok: r.status === 200 ? typeof j.reply === 'string' && j.reply.length > 0 : r.status === 503 && j.error === 'no_model', note: r.status === 200 ? 'a model answered' : r.status === 503 ? 'no model configured (chat will say so)' : 'status ' + r.status } })
  await check('share endpoints answer (200) or are switched off (404)', async () => { const r = await get(base + '/api/share/list?room=smoke', { headers: { Authorization: 'Bearer ' + token } }); return { ok: r.status === 200 || r.status === 404, note: r.status === 404 ? 'sharing is off on this server' : 'status ' + r.status } })
  await check('a signed-in WebSocket opens a room', async () => { const req = createRequire(import.meta.url); let WS; try { WS = req('ws') } catch { WS = globalThis.WebSocket } return await new Promise(res => { const u = base.replace(/^http/, 'ws') + '/ws/smoke-' + Date.now().toString(36) + '?token=' + encodeURIComponent(token); const w = new WS(u); const t = setTimeout(() => { try { w.close() } catch {} res({ ok: false, note: 'timeout' }) }, 10000); w.onopen = () => { clearTimeout(t); try { w.close() } catch {} res({ ok: true }) }; w.onerror = () => { clearTimeout(t); res({ ok: false, note: 'connection refused' }) } }) })
} else results.push({ name: 'signed-in checks', ok: true, note: 'skipped: set ' + tokVar + ' to run them' })
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.note ? ' (' + r.note + ')' : ''))
console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed')
process.exit(fails)
