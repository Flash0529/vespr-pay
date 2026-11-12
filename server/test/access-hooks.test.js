// The workspace features with the room in the request body follow the access list too (server/access.js hooks in index.js):
// friend-sharing a workspace needs manage, setting who pays needs manage (seeing/accepting a plan needs membership), and a runner
// job needs edit on the workspace. Against the real server with access, sharing and billing on.
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const wait = ms => new Promise(r => setTimeout(r, ms))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'access-hooks-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\nbob:tok-b\nagent1:tok-g\n')
const PORT = await freePort(); const here = path.dirname(new URL(import.meta.url).pathname)
const srv = spawn('node', [path.join(here, '..', 'index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens'), VESPR_ACCESS: '1', VESPR_SHARE: '1', VESPR_BILLING: '1', VESPR_LEDGER: '1', VESPR_AGENT_NAMES: 'agent1', STRIPE_SECRET_KEY: 'sk_test_placeholder-not-a-real-key', STRIPE_WEBHOOK_SECRET: 'whsec_placeholder', VESPR_AUTH_BASE_URL: 'http://127.0.0.1' }, stdio: 'ignore' })
const base = 'http://127.0.0.1:' + PORT
const raw = async (method, p, tok, body) => { const r = await fetch(base + p, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) } }
const call = async (...a) => (await raw(...a)).s
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/access/team', { headers: { Authorization: 'Bearer tok-a' } })).status === 200) break } catch {} await wait(100) }
  assert.strictEqual(await call('POST', '/api/access/team/lock', 'tok-a', {}), 201)
  assert.strictEqual(await call('POST', '/api/access/team/grant', 'tok-a', { who: 'bob', path: '', rights: ['view'] }), 200)
  assert.strictEqual(await call('POST', '/api/access/team/grant', 'tok-a', { who: 'agent1', path: '', rights: ['view'] }), 200)
  // friends: sharing a workspace hands out access
  assert.strictEqual(await call('POST', '/api/friends/share', 'tok-b', { room: 'team', with: 'carol', role: 'view' }), 403, 'a viewer does not share the workspace')
  const own = await raw('POST', '/api/friends/share', 'tok-a', { room: 'team', with: 'carol', role: 'view' })
  assert.notStrictEqual(own.j.error, 'needs_manage', 'the owner passes the access check (what follows is the friends rules: carol is not her friend)')
  assert.strictEqual((await raw('POST', '/api/friends/share', 'tok-b', { room: 'team', with: 'carol', role: 'view' })).j.error, 'needs_manage')
  // billing: who pays is the owner's (or a manager's) call; members see and join the plan
  assert.strictEqual(await call('POST', '/api/billing/plan', 'tok-b', { room: 'team', mode: 'split' }), 403, 'a viewer does not set who pays')
  assert.notStrictEqual(await call('POST', '/api/billing/plan', 'tok-a', { room: 'team', mode: 'split' }), 403)
  assert.strictEqual(await call('GET', '/api/billing/plan?room=team', 'tok-b'), 200, 'a member sees the plan')
  assert.strictEqual(await call('GET', '/api/billing/plan?room=team', 'tok-x'), 401)
  // runner jobs: results come back into the files, so edit
  assert.strictEqual(await call('POST', '/api/run', 'tok-g', { runner: 'none', room: 'team', command: 'ls' }), 403, 'an agent with view only cannot run here')
  assert.strictEqual(await call('POST', '/api/access/team/grant', 'tok-a', { who: 'agent1', path: '', rights: ['view', 'edit'] }), 200)
  assert.strictEqual(await call('POST', '/api/run', 'tok-g', { runner: 'none', room: 'team', command: 'ls' }), 404, 'with edit it gets as far as the runner (none connected)')
  assert.strictEqual(await call('POST', '/api/run', 'tok-g', { runner: 'none', room: 'openroom', command: 'ls' }), 404, 'an open workspace works as before')
  console.log('access hook tests passed: friend-sharing and who pays need manage, a runner job needs edit, open workspaces as before')
} finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }) }
