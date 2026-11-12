// Account kind and the organization's file/folder rules (server/orgpolicy.js): who is school/company/personal, fail-closed defaults, who may change them.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createOrgPolicy, accountKindOf, orgKeyOf, isOrgAdmin } from '../orgpolicy.js'
import { call } from './fakehttp.js'

const users = {
  p: { id: 'p', email: 'a@gmail.com', roles: ['member'], providers: { google: {} } },
  s1: { id: 's1', roles: ['member'], school: { via: 'clever', staff: false, roles: ['student'] }, providers: { clever: {} } },
  s2: { id: 's2', roles: ['member'], school: { via: 'clever', staff: true, roles: ['teacher', 'school_admin'] } },
  s3: { id: 's3', roles: ['member'], school: { via: 'classlink', staff: true } },
  c1: { id: 'c1', roles: ['admin'], providers: { 'work:acme': {} } },
  c2: { id: 'c2', roles: ['member'], providers: { 'work:acme': {} } },
  c3: { id: 'c3', roles: ['owner'], providers: { 'work:globex': {} } }
}
const getUser = t => users[t] || null
const mk = () => createOrgPolicy({ DATA: fs.mkdtempSync(path.join(os.tmpdir(), 'orgpolicy-')), getUser })
const req = (h, method, body, tok) => call(h.http, { method, url: '/api/org/policy', headers: tok ? { authorization: 'Bearer ' + tok } : {}, body })

// kinds
assert.deepStrictEqual(Object.fromEntries(Object.entries(users).map(([k, u]) => [k, accountKindOf(u)])), { p: 'personal', s1: 'school', s2: 'school', s3: 'school', c1: 'company', c2: 'company', c3: 'company' })
assert.strictEqual(accountKindOf(null), 'personal'); assert.strictEqual(accountKindOf({}), 'personal'); assert.strictEqual(orgKeyOf(users.p), null); assert.strictEqual(orgKeyOf(users.c1), 'work:acme'); assert.strictEqual(orgKeyOf(users.s1), 'school:clever')
assert.strictEqual(accountKindOf({ work: { company: 'x' } }), 'company', 'an older work record counts too')
assert.deepStrictEqual([isOrgAdmin(users.s1), isOrgAdmin(users.s2), isOrgAdmin(users.s3), isOrgAdmin(users.c1), isOrgAdmin(users.c2), isOrgAdmin(users.c3), isOrgAdmin(null)], [false, true, false, true, false, true, false])

const h = mk()
// fail closed
assert.deepStrictEqual(h.policyFor(users.c1), { fileContext: false, folderContext: false }); assert.deepStrictEqual(h.policyFor(users.s1), { fileContext: false, folderContext: false }); assert.deepStrictEqual(h.policyFor(users.p), { fileContext: false, folderContext: false })
assert.strictEqual((await req(h, 'GET', undefined, undefined)).status, 401); assert.strictEqual((await req(h, 'GET', undefined, 'nope')).status, 401)
let r = await req(h, 'GET', undefined, 'c2'); assert.deepStrictEqual(r.json, { kind: 'company', org: 'work:acme', policy: { fileContext: false, folderContext: false }, canEdit: false })
r = await req(h, 'GET', undefined, 'p'); assert.deepStrictEqual(r.json, { kind: 'personal', org: null, policy: null, canEdit: false })
// who may change it
assert.strictEqual((await req(h, 'POST', { fileContext: true }, 'c2')).status, 403, 'a member cannot'); assert.strictEqual((await req(h, 'POST', { fileContext: true }, 's1')).status, 403, 'a student cannot'); assert.strictEqual((await req(h, 'POST', { fileContext: true }, 'p')).status, 400, 'personal accounts have no org policy')
assert.strictEqual((await req(h, 'POST', { fileContext: true }, undefined)).status, 401)
r = await req(h, 'POST', { fileContext: true }, 'c1'); assert.strictEqual(r.status, 200); assert.deepStrictEqual(r.json.policy, { fileContext: true, folderContext: false }, 'only what was set changes')
assert.strictEqual(h.policyFor(users.c2).fileContext, true, 'everyone in that company sees it'); assert.strictEqual(h.policyFor(users.c3).fileContext, false, 'another company does not')
r = await req(h, 'POST', { folderContext: true }, 'c1'); assert.deepStrictEqual(r.json.policy, { fileContext: true, folderContext: true }, 'the earlier choice is kept')
r = await req(h, 'POST', { fileContext: false }, 'c1'); assert.deepStrictEqual(r.json.policy, { fileContext: false, folderContext: true })
// bad input never turns anything on
for (const bad of [{ fileContext: 'true' }, { fileContext: 1 }, { folderContext: null }, { fileContext: {} }]) assert.strictEqual((await req(h, 'POST', bad, 'c1')).status, 400, JSON.stringify(bad))
assert.deepStrictEqual(h.policyFor(users.c1), { fileContext: false, folderContext: true }, 'bad requests changed nothing')
assert.strictEqual((await req(h, 'POST', 'not json', 'c1')).status, 400); assert.strictEqual((await req(h, 'DELETE', undefined, 'c1')).status, 405)
// schools: the teacher with an admin role changes it, for that school only
assert.strictEqual((await req(h, 'POST', { fileContext: true, folderContext: true }, 's2')).status, 200); assert.strictEqual(h.policyFor(users.s1).fileContext, true); assert.strictEqual(h.policyFor(users.s3).fileContext, false, 'another school')
// stored, and read again by a new instance on the same data
{ const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orgpolicy2-')); const a = createOrgPolicy({ DATA: dir, getUser }); await call(a.http, { method: 'POST', url: '/api/org/policy', headers: { authorization: 'Bearer c3' }, body: { folderContext: true } }); assert.strictEqual(createOrgPolicy({ DATA: dir, getUser }).policyFor(users.c3).folderContext, true) }
{ const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orgpolicy3-')); fs.mkdirSync(path.join(dir, 'orgs')); fs.writeFileSync(path.join(dir, 'orgs', 'policy.json'), JSON.stringify({ orgs: { 'work:acme': { fileContext: 'yes', folderContext: 1 }, 'school:clever': { fileContext: true } } }))
  const d = createOrgPolicy({ DATA: dir, getUser }); assert.deepStrictEqual(d.policyFor(users.c1), { fileContext: false, folderContext: false }, 'a damaged file never turns anything on'); assert.strictEqual(d.policyFor(users.s1).fileContext, true) }
assert.strictEqual((await call(h.http, { method: 'GET', url: '/api/other' })).notMine, true)
console.log('org policy tests passed')
