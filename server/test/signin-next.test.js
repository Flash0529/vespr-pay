// Where a Google / Microsoft / GitHub sign-in may come back to (auth.js isAllowedNext). The site's own pages that start a sign-in must be on
// the default list, or the provider buttons fail before the provider is even asked: account.html (website) and desktop-signin.html (the
// desktop app's browser step). Anything else, and anything off-site, stays refused.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import { createAuth } from '../auth.js'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'signin-next-'))
const google = { authorizeUrl: ({ state }) => 'https://accounts.example/auth?state=' + state, exchange: async () => ({ id: 'g1', email: 'x@example.test', emailVerified: true, name: 'X' }) }
const auth = createAuth({ DATA, identifyToken: () => null, oauthProviders: { google }, config: { NODE_ENV: 'test' } })
const srv = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`
const start = async next => (await fetch(base + '/auth/start/google?next=' + encodeURIComponent(next), { redirect: 'manual' })).status
let n = 0
for (const ok of ['/account.html', '/desktop-signin.html', '/app/', '/prototype.html', '/']) { assert.strictEqual(await start(ok), 302, ok); n++ }
for (const bad of ['//evil.example/x', 'https://evil.example/', '/\\evil.example', '/other.html', '/account.html.evil']) { assert.strictEqual(await start(bad), 400, bad); n++ }
// the whole trip from the desktop app's browser step: our page -> Google -> our callback -> back to that page, signed in
const s = await fetch(base + '/auth/start/google?next=' + encodeURIComponent('/desktop-signin.html'), { redirect: 'manual' })
const state = new URL(s.headers.get('location')).searchParams.get('state'); const cookie = (s.headers.get('set-cookie') || '').split(';')[0]
assert.ok(state && cookie.startsWith('vespr_oauth_state=')); n++
const cb = await fetch(base + '/auth/callback/google?' + new URLSearchParams({ state, code: 'C' }), { redirect: 'manual', headers: { cookie } })
assert.strictEqual(cb.status, 302); assert.match(cb.headers.get('location'), /^\/desktop-signin\.html#token=[0-9a-f]{64}$/, 'back to the desktop step, token only in the fragment'); n++
srv.close(); fs.rmSync(DATA, { recursive: true, force: true })
console.log(`sign-in return pages tests passed (${n})`)
