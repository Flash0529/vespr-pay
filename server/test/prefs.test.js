// Account prefs (prefs.js): the setup answer is kept per account on the server, asked once; only known keys; your own only.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import { createPrefs, cleanPrefs } from '../prefs.js'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-'))
const tokens = new Map([['tok-a', 'ana'], ['tok-b', 'bo']])
let p = createPrefs({ DATA, identify: t => tokens.get(t), now: () => 42 })
const app = http.createServer((req, res) => { if (!p.http(req, res)) { res.writeHead(404); res.end() } })
await new Promise(r => app.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${app.address().port}`
const call = async (method, token, body) => { const r = await fetch(base + '/api/me/prefs', { method, headers: token ? { Authorization: 'Bearer ' + token } : {}, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, j: await r.json() } }

assert.strictEqual((await call('GET')).status, 401, 'signed in only')
assert.deepStrictEqual((await call('GET', 'tok-a')).j.prefs, {}, 'nothing yet: the question is asked')
assert.deepStrictEqual((await call('POST', 'tok-a', { focus: ['web', 'web', 'data'], other: '  robots   and cad ', setupDone: true })).j.prefs, { focus: ['web', 'data'], other: 'robots and cad', setupDone: true, updated: 42 })
assert.strictEqual((await call('GET', 'tok-a')).j.prefs.setupDone, true, 'answered: never asked again')
assert.deepStrictEqual((await call('GET', 'tok-b')).j.prefs, {}, 'another person sees only their own')
for (const bad of [null, [], { admin: true }, { focus: 'web' }, { focus: ['<b>'] }, { focus: Array(21).fill('a') }, { other: 'x'.repeat(201) }, { setupDone: 'yes' }, {}]) {
  assert.strictEqual(cleanPrefs(bad), null, JSON.stringify(bad))
}
assert.strictEqual((await call('POST', 'tok-a', { setupDone: 'yes' })).status, 400)
assert.strictEqual((await call('PUT', 'tok-a', {})).status, 405)
p = createPrefs({ DATA, identify: t => tokens.get(t) }) // a restart keeps it
assert.strictEqual(p.get('ana').setupDone, true)
const f = fs.readdirSync(path.join(DATA, 'prefs'))[0]
assert.ok(!f.includes('ana'), 'file names do not show who'); assert.strictEqual(fs.statSync(path.join(DATA, 'prefs', f)).mode & 0o077, 0, 'private file')
app.close(); fs.rmSync(DATA, { recursive: true, force: true })
console.log('prefs tests passed: signed in only, asked once per account, own prefs only, known keys only, survives restart, private files')
