// Auto sign-in (server/discover.js): a school email or school name finds the sign-in the school uses. DNS and Microsoft's lookup are faked.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import { createDiscover } from '../discover.js'
import { createAuth } from '../auth.js'

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-'))
const SCHOOLS = JSON.stringify([
  { name: 'Lincoln High School', domains: ['lincolnhs.org'], provider: 'classlink' },
  { name: 'Lincoln Middle School', domains: ['lms.lincoln.k12.us'], provider: 'clever' },
  { name: 'Riverside Academy', domains: ['riverside.edu'], provider: 'lti', url: 'https://riverside.instructure.com' }
])
const mx = { 'gsuite-school.org': ['aspmx.l.google.com'], 'm365-school.org': ['m365-school-org.mail.protection.outlook.com'], 'tiny.org': ['mail.tiny.org'] }
const dns = { resolveMx: async d => { if (!mx[d]) throw new Error('ENOTFOUND'); return mx[d].map(exchange => ({ exchange, priority: 10 })) } }
const realm = async email => (email.endsWith('@entra-district.org') ? 'Federated' : 'Unknown')
const ALL = { google: true, microsoft: true, clever: true, classlink: true }
const make = (providers = ALL) => createDiscover({ DATA, config: { VESPR_SCHOOLS: SCHOOLS }, providers: () => providers, dns, realm })
const look = async (d, q) => (await d.discover(q, 'ip-' + Math.random())).body

await t('school directory first: email domain or school name', async () => {
  const d = make()
  assert.deepStrictEqual(await look(d, 'kid@lincolnhs.org'), { kind: 'provider', provider: 'classlink', label: 'ClassLink', name: 'Lincoln High School' })
  assert.deepStrictEqual(await look(d, 'lincoln high'), { kind: 'provider', provider: 'classlink', label: 'ClassLink', name: 'Lincoln High School' })
  const both = await look(d, 'Lincoln'); assert.strictEqual(both.kind, 'choices'); assert.deepStrictEqual(both.schools.map(s => s.provider), ['classlink', 'clever'])
  assert.deepStrictEqual(await look(d, 'riverside academy'), { kind: 'lms', label: 'your class page', name: 'Riverside Academy', url: 'https://riverside.instructure.com' })
  assert.deepStrictEqual(await look(d, 'nowhere school'), { kind: 'unknown' })
})

await t('no directory entry: Google and Microsoft found from the email, with the email as a hint', async () => {
  const d = make()
  assert.deepStrictEqual(await look(d, 'kid@gmail.com'), { kind: 'provider', provider: 'google', label: 'Google', hint: 'kid@gmail.com' })
  assert.deepStrictEqual(await look(d, 'kid@gsuite-school.org'), { kind: 'provider', provider: 'google', label: 'Google', hint: 'kid@gsuite-school.org' })
  assert.deepStrictEqual(await look(d, 'kid@entra-district.org'), { kind: 'provider', provider: 'microsoft', label: 'Microsoft', hint: 'kid@entra-district.org' })
  assert.deepStrictEqual(await look(d, 'Kid@M365-School.org'), { kind: 'provider', provider: 'microsoft', label: 'Microsoft', hint: 'kid@m365-school.org' })
  assert.deepStrictEqual(await look(d, 'kid@tiny.org'), { kind: 'password', email: 'kid@tiny.org' })
})

await t('a sign-in the server has not set up yet says so instead of failing later', async () => {
  const d = make({ google: true })
  assert.deepStrictEqual(await look(d, 'kid@lincolnhs.org'), { kind: 'not_ready', provider: 'classlink', label: 'ClassLink' })
})

await t('too short, too many', async () => {
  const d = make()
  assert.strictEqual((await d.discover('ab', 'x')).status, 400)
  let last; for (let i = 0; i < 31; i++) last = await d.discover('kid' + i + '@gmail.com', 'same-ip'); assert.strictEqual(last.status, 429)
})

await t('HTTP: /auth/discover, and the email hint reaches Google\'s sign-in page', async () => {
  const auth = createAuth({ DATA, identifyToken: () => null, discoverDeps: { dns, realm }, config: { NODE_ENV: 'test', VESPR_SCHOOLS: SCHOOLS, VESPR_AUTH_GOOGLE_ID: 'g', VESPR_AUTH_GOOGLE_SECRET: 's', VESPR_AUTH_ALLOWED_NEXT: '/account.html' } })
  const srv = http.createServer(async (req, res) => { if (await auth.http(req, res)) return; res.writeHead(404); res.end() })
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`
  const j = await (await fetch(base + '/auth/discover?q=' + encodeURIComponent('kid@gsuite-school.org'))).json()
  assert.deepStrictEqual([j.kind, j.provider], ['provider', 'google'])
  const s = await fetch(base + '/auth/start/google?next=/account.html&login_hint=' + encodeURIComponent(j.hint), { redirect: 'manual' })
  assert.strictEqual(new URL(s.headers.get('location')).searchParams.get('login_hint'), 'kid@gsuite-school.org')
  const bad = await fetch(base + '/auth/start/google?next=/account.html&login_hint=' + encodeURIComponent('not an email'), { redirect: 'manual' })
  assert.ok(!new URL(bad.headers.get('location')).searchParams.has('login_hint'))
  srv.close(); fs.rmSync(DATA, { recursive: true, force: true })
})

console.log(`auto sign-in tests passed (${n})`)
