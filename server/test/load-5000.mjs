// Load test for the 0-5,000 constraint. Runs against a THROWAWAY server with its own data folder (never staging or vespr.online data).
//   node test/load-5000.mjs seed <dataDir> [accounts=5000]          writes fake accounts and one session each (tokens stay in <dataDir>)
//   node test/load-5000.mjs run  <baseUrl> <dataDir> <serverPid> [seconds=30] [concurrency=300] [perSecond]   perSecond paces the sessions; without it they go flat out
//   node test/load-5000.mjs limits <baseUrl> <dataDir>              with limits on: a flood from one address is refused, one account's sockets are capped
// Output is one JSON line per phase. The fake accounts use example.test addresses and are deleted with the data folder.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { WebSocket } from 'ws'

const [mode, a1, a2, a3, a4, a5, a6] = process.argv.slice(2)
const sha = s => crypto.createHash('sha256').update(s).digest('hex')
const rss = pid => { try { return Math.round(Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) / 1024) } catch { return null } }
const pct = (xs, p) => xs.length ? xs[Math.min(xs.length - 1, Math.floor(xs.length * p))] : null

if (mode === 'seed') {
  const dir = a1; const n = Number(a2 || 5000); const t = Date.now()
  fs.mkdirSync(path.join(dir, 'auth'), { recursive: true })
  const users = {}; const sessions = {}; const tokens = []
  for (let i = 0; i < n; i++) {
    const id = 'u' + crypto.randomBytes(8).toString('hex'); const name = 'load' + i; const email = `load${i}@example.test`
    users[id] = { id, name, email, emailVerified: true, activation: 'active', createdAt: t, updatedAt: t, providers: {} }
    const tok = crypto.randomBytes(32).toString('hex'); tokens.push(tok)
    sessions[sha(tok)] = { userId: id, email, name, createdAt: t, expiresAt: t + 30 * 86400000, deviceId: crypto.randomBytes(8).toString('hex'), label: 'load', kind: 'browser', installId: null }
  }
  // the shapes and sizes real data would have: pretty-printed, as the old code wrote them
  fs.writeFileSync(path.join(dir, 'auth', 'users.json'), JSON.stringify(users, null, 2), { mode: 0o600 })
  fs.writeFileSync(path.join(dir, 'auth', 'sessions.json'), JSON.stringify(sessions, null, 2), { mode: 0o600 })
  fs.writeFileSync(path.join(dir, 'load-tokens'), tokens.join('\n'), { mode: 0o600 })
  fs.writeFileSync(path.join(dir, 'tokens'), '', { mode: 0o600 })
  const kb = f => Math.round(fs.statSync(path.join(dir, 'auth', f)).size / 1024)
  console.log(JSON.stringify({ phase: 'seed', accounts: n, usersKB: kb('users.json'), sessionsKB: kb('sessions.json') }))
} else if (mode === 'run') {
  const base = a1; const tokens = fs.readFileSync(path.join(a2, 'load-tokens'), 'utf8').split('\n'); const pid = Number(a3)
  const seconds = Number(a4 || 30); const conc = Number(a5 || 300)
  const agent = new http.Agent({ keepAlive: true, maxSockets: conc })
  const lat = []; const codes = {}; let done = 0
  const one = (p, tok) => new Promise(resolve => {
    const t0 = process.hrtime.bigint()
    const r = http.get(base + p, { agent, headers: { Authorization: 'Bearer ' + tok } }, res => {
      res.resume(); res.on('end', () => { lat.push(Number(process.hrtime.bigint() - t0) / 1e6); codes[res.statusCode] = (codes[res.statusCode] || 0) + 1; done++; resolve() })
    })
    r.on('error', e => { codes[e.code || 'error'] = (codes[e.code || 'error'] || 0) + 1; resolve() })
    r.setTimeout(10000, () => r.destroy(new Error('timeout')))
  })
  const rss0 = rss(pid)
  // 300 sockets on 30 workspaces, held open through the HTTP phase (people with the app open)
  const wss = []; let opened = 0
  for (let i = 0; i < Math.min(conc, 300); i++) {
    const ws = new WebSocket(base.replace('http', 'ws') + `/ws/load-${i % 30}?token=` + tokens[i]); ws.on('open', () => opened++); ws.on('error', () => {}); wss.push(ws)
  }
  await new Promise(r => setTimeout(r, 3000))
  const end = Date.now() + seconds * 1000
  const paths = ['/auth/session', '/auth/session', '/auth/me', '/api/me/prefs']
  await Promise.all(Array.from({ length: conc }, async (_, w) => {
    const gap = a6 ? conc / Number(a6) * 1000 : 0
    if (gap) await new Promise(r => setTimeout(r, Math.random() * gap))
    while (Date.now() < end) { const t0 = Date.now(); await one(paths[(done + w) % paths.length], tokens[Math.floor(Math.random() * tokens.length)]); if (gap) await new Promise(r => setTimeout(r, Math.max(0, gap - (Date.now() - t0)))) }
  }))
  lat.sort((x, y) => x - y)
  const r = v => v == null ? null : Math.round(v * 10) / 10
  console.log(JSON.stringify({ phase: 'run', paced: a6 ? Number(a6) + '/s' : 'flat out', seconds, concurrency: conc, requests: lat.length, perSecond: Math.round(lat.length / seconds), p50ms: r(pct(lat, 0.5)), p95ms: r(pct(lat, 0.95)), p99ms: r(pct(lat, 0.99)), maxms: r(lat[lat.length - 1]), codes, socketsOpen: opened, serverMB: { before: rss0, after: rss(pid) } }))
  for (const ws of wss) ws.terminate()
  agent.destroy()
} else if (mode === 'limits') {
  const base = a1; const tokens = fs.readFileSync(path.join(a2, 'load-tokens'), 'utf8').split('\n')
  const agent = new http.Agent({ keepAlive: true, maxSockets: 50 })
  const codes = {}
  await Promise.all(Array.from({ length: 1200 }, (_, i) => new Promise(resolve => {
    http.get(base + '/auth/session', { agent, headers: { Authorization: 'Bearer ' + tokens[i % 100] } }, res => { res.resume(); codes[res.statusCode] = (codes[res.statusCode] || 0) + 1; res.on('end', resolve) }).on('error', () => resolve())
  })))
  // one account opening 50 sockets: 40 are allowed (the per-address new-socket cap is 120 a minute)
  let open = 0; let refused = 0
  await Promise.all(Array.from({ length: 50 }, () => new Promise(resolve => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws/load-cap?token=' + tokens[4999])
    ws.on('open', () => { open++; resolve() }); ws.on('unexpected-response', () => { refused++; resolve() }); ws.on('error', () => resolve())
  })))
  console.log(JSON.stringify({ phase: 'limits', flood1200: codes, oneAccount50Sockets: { open, refused } }))
  agent.destroy(); process.exit(0)
}
