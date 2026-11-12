// Account names are unique (auth.js nameTaken / freeName): access control, chat names and workspace ownership go by name, so a second
// account must never get someone else's name, an agent's name, a service token's name or "*".
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import { createAuth } from '../auth.js'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-names-'))
const auth = createAuth({ DATA, identifyToken: () => null, reservedNames: () => ['coder', 'ci-bot'], config: { NODE_ENV: 'test', VESPR_AUTH_SKIP_VERIFY: '1' } })
const srv = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
await new Promise(r => srv.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${srv.address().port}`
let ip = 0
const reg = async (email, name) => {
  const r = await fetch(base + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.' + (++ip) }, body: JSON.stringify({ email, password: 'a-long-password-1', name }) })
  return { s: r.status, j: await r.json().catch(() => ({})) }
}
let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }

await t('a name belongs to one account; agents, service tokens and "*" are never anyone’s', async () => {
  assert.ok([200, 201].includes((await reg('tester@example.test', 'tester')).s), 'the first tester')
  for (const [email, name, why] of [['x1@example.test', 'tester', 'same name'], ['x2@example.test', ' TESTER ', 'case and spaces ignored'], ['x3@example.test', 'Coder', 'an agent'], ['x4@example.test', 'ci-bot', 'a service token'], ['x5@example.test', '*', 'everyone']]) {
    const r = await reg(email, name)
    assert.strictEqual(r.s, 409, why); assert.match(r.j.error || '', /name is taken/, why)
  }
  const r = await reg('coder@example.test', ''); assert.strictEqual(r.s, 409, 'the name from the email (coder) is reserved too')
  assert.ok([200, 201].includes((await reg('sam@example.test', 'Sam Lee')).s))
})

srv.close(); fs.rmSync(DATA, { recursive: true, force: true })
console.log(`auth name tests passed (${n})`)
