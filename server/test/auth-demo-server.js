// Local demo of the site's sign-in against FAKES: serves site/ and /auth/* on 127.0.0.1 with a fake SMS transport, a fake mail transport
// and fake Google/GitHub providers (Microsoft left unconfigured on purpose, to show "Not configured yet"). Nothing leaves this machine.
//   node server/test/auth-demo-server.js [port]        (default 9455; keep to 9450-9499)
// Fake-only helpers, never part of the real server: GET /__fake/sms?phone=+1... (last code), GET /__fake/outbox (mail "sent").
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { createAuth } from '../auth.js'
import { createMailer, createFakeTransport } from '../mail.js'
import { fakeSms, fakeProvider } from './auth-fakes.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const siteDir = path.resolve(here, '..', '..', 'site')
const port = Number(process.argv[2] || 9455)
if (!(port >= 9450 && port <= 9499)) throw new Error('use a port in 9450-9499')

// DEMO_DATA=<folder> keeps accounts (for example ones made with tools/seed-users.js); otherwise a throwaway folder
const dir = process.env.DEMO_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-demo-'))
const cleanup = () => { if (!process.env.DEMO_DATA) fs.rmSync(dir, { recursive: true, force: true }) }
const sms = fakeSms()
const transport = createFakeTransport()
const providers = {
  google: fakeProvider('google', { id: 'g-demo', email: 'demo.google@example.com', name: 'Demo Google', emailVerified: true }),
  github: fakeProvider('github', { id: 'gh-demo', email: 'demo.github@example.com', name: 'Demo GitHub', username: 'demo', emailVerified: true })
}
// the fake provider's own page: approves at once and sends the browser back with the code
for (const [name, p] of Object.entries(providers)) {
  const orig = p.authorizeUrl
  p.authorizeUrl = args => `/__fake/idp/${name}?u=${encodeURIComponent(orig(args))}`
}
const auth = createAuth({
  DATA: dir,
  config: { VESPR_AUTH_SKIP_VERIFY: process.env.SKIP_VERIFY ?? '0', VESPR_AUTH_ALLOWED_NEXT: '/,/prototype.html' },
  mailer: createMailer({ transport, from: 'noreply@vespr.test' }),
  smsTransport: sms,
  oauthProviders: providers
})

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.txt': 'text/plain' }
const holders = []
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  const idp = /^\/__fake\/idp\/(google|github)$/.exec(u.pathname)
  if (idp) {
    const { code, state } = providers[idp[1]].approve(u.searchParams.get('u'))
    const cb = new URL(u.searchParams.get('u')).searchParams.get('redirect_uri')
    res.writeHead(302, { Location: `${cb}?code=${code}&state=${state}` }); return res.end()
  }
  if (u.pathname === '/__fake/harness' && process.env.HARNESS) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(process.env.HARNESS)) } // only the sign-in window, for fast browser checks
  if (u.pathname === '/__fake/hold') { holders.push(res); setTimeout(() => { if (!res.writableEnded) res.end() }, 150000); return } // keeps a page's load event open until its self-test reports
  if (u.pathname === '/__fake/report' && req.method === 'POST' && process.env.REPORT) { let b = ''; req.on('data', c => { b += c }); req.on('end', () => { fs.writeFileSync(process.env.REPORT, b); res.writeHead(204); res.end(); if (b.includes('"__done"')) holders.splice(0).forEach(h => { h.writeHead(204); h.end() }) }); return } // a browser self-test posts its results here
  if (u.pathname === '/__fake/sms') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(sms.last(u.searchParams.get('phone') || '') || '') }
  if (u.pathname === '/__fake/outbox') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(transport.sent)) }
  if (u.pathname.startsWith('/auth/')) {
    if (await auth.http(req, res)) return
    res.writeHead(404); return res.end()
  }
  const rel = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)
  const file = path.resolve(siteDir, '.' + rel)
  if (!file.startsWith(siteDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found') }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
server.listen(port, '127.0.0.1', () => console.log(`auth demo (fakes only) on http://127.0.0.1:${port}/`))
process.on('SIGTERM', () => { server.close(); cleanup(); process.exit(0) })
process.on('SIGINT', () => { server.close(); cleanup(); process.exit(0) })
