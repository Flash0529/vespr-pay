// Tests for server/orgs.js: age bands, minimal records, sign-in domain checks, domain proof, roster mapping, narrowing, audit chain, deletion plan.
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  ageBandFromBirthYear, ageBandFromGrade, stricterBand, minimalMember, sessionFields, claimableDomain, verificationRecord, confirmDomain, newVerificationToken,
  checkSignIn, inviteByDomain, mapRoster, narrowClassPolicy, createAuditLog, verifyChain, exportCsv, fileSink, readEntries, retentionCut, deletionPlan, AUDIT_KINDS
} from '../orgs.js'
import { can, effectiveLimits } from '../policy.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }

t('birth year bands round toward the stricter side', () => {
  assert.strictEqual(ageBandFromBirthYear(2020, 2026), 'under13'); assert.strictEqual(ageBandFromBirthYear(2013, 2026), 'under13'); assert.strictEqual(ageBandFromBirthYear(2012, 2026), '13-17')
  assert.strictEqual(ageBandFromBirthYear(2008, 2026), '13-17'); assert.strictEqual(ageBandFromBirthYear(2007, 2026), 'adult'); assert.strictEqual(ageBandFromBirthYear(1990, 2026), 'adult')
  for (const bad of [undefined, null, 'x', 2.5, 3000, 1800]) assert.strictEqual(ageBandFromBirthYear(bad, 2026), 'under13', String(bad))
})
t('grades map to the stricter band', () => {
  for (const g of ['K', 'k', 'pk', 1, '5', 8, '8']) assert.strictEqual(ageBandFromGrade(g), 'under13', String(g))
  for (const g of [9, '12']) assert.strictEqual(ageBandFromGrade(g), '13-17'); assert.strictEqual(ageBandFromGrade('college'), 'adult'); assert.strictEqual(ageBandFromGrade(13), 'adult')
  for (const g of [undefined, '', 'banana', 3.5]) assert.strictEqual(ageBandFromGrade(g), 'under13', String(g))
  assert.strictEqual(stricterBand('adult', 'under13'), 'under13'); assert.strictEqual(stricterBand('13-17', 'adult'), '13-17')
})
t('minimal record: under 13 keeps no email, phone or birth date, and a short name', () => {
  const m = minimalMember({ id: 'u1', roles: ['student', 'wizard'], ageBand: 'under13', classIds: ['c1', 5], displayName: 'Maria Isabel Lopez', email: 'kid@x.org', phone: '555', birthDate: '2015-01-01', guardianOf: undefined })
  assert.deepStrictEqual(Object.keys(m).sort(), ['ageBand', 'classIds', 'displayName', 'id', 'roles']); assert.strictEqual(m.displayName, 'Maria L.'); assert.deepStrictEqual(m.roles, ['student']); assert.deepStrictEqual(m.classIds, ['c1'])
})
t('minimal record: 13-17 keep a school email; adults keep email; unknown band is treated as under 13', () => {
  assert.strictEqual(minimalMember({ id: 'a', roles: ['student'], ageBand: '13-17', email: ' Teen@School.ORG ', phone: '1' }).email, 'teen@school.org'); assert.strictEqual(minimalMember({ id: 'a', roles: ['student'], ageBand: '13-17', phone: '1' }).phone, undefined)
  assert.strictEqual(minimalMember({ id: 'b', roles: ['member'], ageBand: 'adult', email: 'a@b.com' }).email, 'a@b.com'); const x = minimalMember({ id: 'c', roles: ['student'], ageBand: 'baby', email: 'a@b.com' })
  assert.strictEqual(x.ageBand, 'under13'); assert.strictEqual(x.email, undefined)
})
t('session fields: what auth must carry; no org means an individual', () => {
  assert.deepStrictEqual(sessionFields({ id: 'u', roles: ['teacher'], ageBand: 'adult', classIds: ['c1'] }, 'org1'), { orgId: 'org1', roles: ['teacher'], ageBand: 'adult', classIds: ['c1'] })
  assert.deepStrictEqual(sessionFields(null, 'org1'), { orgId: null, roles: ['member'], ageBand: 'adult', classIds: [] }); assert.strictEqual(sessionFields({ id: 'u', roles: ['member'], ageBand: 'adult' }, null).orgId, null)
  assert.deepStrictEqual(sessionFields({ id: 'g', roles: ['guardian'], ageBand: 'adult', guardianOf: ['s1'] }, 'org1').guardianOf, ['s1']); assert.strictEqual(sessionFields({ id: 'u', roles: ['wizard'], ageBand: 'adult' }, 'org1').orgId, null)
  const f = sessionFields({ id: 'u', roles: ['student'], ageBand: '13-17', classIds: ['c1'] }, 'org1'); assert.strictEqual(can({ id: 'u', ...f }, 'agent.mode.use', { org: { id: 'org1', policy: {} }, mode: 'manual' }).allow, true)
})

t('free mail and junk domains cannot be claimed', () => { for (const d of ['gmail.com', 'Outlook.com', 'localhost', 'a b.com', '', null, 'x']) assert.strictEqual(claimableDomain(d), false, String(d)); assert.strictEqual(claimableDomain('Acme.com'), true) })
t('domain proof: exact TXT value only', () => {
  const tok = newVerificationToken(); const rec = verificationRecord('Acme.com.', tok); assert.strictEqual(rec.name, '_vespr-verify.acme.com.'.replace(/\.$/, '')); assert.strictEqual(rec.type, 'TXT')
  assert.strictEqual(confirmDomain('acme.com', tok, [[rec.value]]), true); assert.strictEqual(confirmDomain('acme.com', tok, [[rec.value.slice(0, -1)]]), false); assert.strictEqual(confirmDomain('acme.com', tok, []), false)
  assert.strictEqual(confirmDomain('acme.com', 'short', [['vespr-verify=short']]), false); assert.strictEqual(confirmDomain('gmail.com', tok, [[rec.value]]), false); assert.strictEqual(confirmDomain('acme.com', tok, null), false)
  assert.notStrictEqual(newVerificationToken(), newVerificationToken())
})

const ORG = { id: 'org1', domains: ['school.org'], idp: { microsoft: { tid: 'tenant-1' }, oidc: { issuer: 'https://idp.school.org', audience: 'vespr' } }, inviteByDomain: true }
t('Google: needs the hosted-domain claim, not just an email suffix', () => {
  const ok = { email: 'a@school.org', email_verified: true, hd: 'school.org' }
  assert.strictEqual(checkSignIn(ORG, { provider: 'google', claims: ok }).ok, true)
  assert.strictEqual(checkSignIn(ORG, { provider: 'google', claims: { ...ok, hd: undefined } }).code, 'google_hd_mismatch'); assert.strictEqual(checkSignIn(ORG, { provider: 'google', claims: { ...ok, hd: 'other.org' } }).code, 'google_hd_mismatch')
  assert.strictEqual(checkSignIn(ORG, { provider: 'google', claims: { ...ok, email_verified: false } }).code, 'email_unverified'); assert.strictEqual(checkSignIn(ORG, { provider: 'google', claims: { ...ok, email: 'a@personal.example' } }).code, 'domain_not_allowed')
  assert.strictEqual(checkSignIn(ORG, { provider: 'google', claims: { ...ok, email: 'a@evil-school.org', hd: 'evil-school.org' } }).ok, false); assert.strictEqual(checkSignIn(ORG, { provider: 'google', claims: { ...ok, email: 'a@sub.school.org' } }).ok, false)
})
t('Google: the hosted domain must be the email domain even when the org has several', () => {
  const two = { ...ORG, domains: ['school.org', 'other.school.org'] }; assert.strictEqual(checkSignIn(two, { provider: 'google', claims: { email: 'a@school.org', email_verified: true, hd: 'other.school.org' } }).ok, false)
})
t('Microsoft: needs the tenant id', () => {
  const ok = { email: 'a@school.org', email_verified: true, tid: 'tenant-1' }
  assert.strictEqual(checkSignIn(ORG, { provider: 'microsoft', claims: ok }).ok, true); assert.strictEqual(checkSignIn(ORG, { provider: 'microsoft', claims: { ...ok, tid: 'tenant-2' } }).code, 'tenant_mismatch'); assert.strictEqual(checkSignIn({ ...ORG, idp: {} }, { provider: 'microsoft', claims: ok }).ok, false)
})
t('generic OIDC: issuer and audience must match; unknown providers and unverified orgs fail closed', () => {
  const ok = { email: 'a@school.org', email_verified: true, iss: 'https://idp.school.org', aud: ['x', 'vespr'] }
  assert.strictEqual(checkSignIn(ORG, { provider: 'oidc', claims: ok }).ok, true); assert.strictEqual(checkSignIn(ORG, { provider: 'oidc', claims: { ...ok, iss: 'https://evil' } }).ok, false); assert.strictEqual(checkSignIn(ORG, { provider: 'oidc', claims: { ...ok, aud: 'other' } }).ok, false)
  assert.strictEqual(checkSignIn(ORG, { provider: 'saml', claims: ok }).code, 'provider_not_supported'); assert.strictEqual(checkSignIn({ ...ORG, domains: [] }, { provider: 'google', claims: { ...ok, hd: 'school.org' } }).code, 'org_has_no_verified_domain')
  assert.strictEqual(checkSignIn(null, { provider: 'google', claims: ok }).ok, false); assert.strictEqual(checkSignIn(ORG, { provider: 'google' }).ok, false)
})
t('invite by domain: member only, only when switched on', () => {
  assert.deepStrictEqual(inviteByDomain(ORG, 'x@school.org'), { ok: true, roles: ['member'] }); assert.strictEqual(inviteByDomain({ ...ORG, inviteByDomain: false }, 'x@school.org').ok, false); assert.strictEqual(inviteByDomain(ORG, 'x@other.org').ok, false); assert.strictEqual(inviteByDomain(ORG, 'nonsense').ok, false)
})

const ROSTER = {
  provider: 'clever', districtId: 'd1', schools: [{ id: 's1', name: 'Lincoln Middle' }],
  users: [
    { id: 't1', type: 'teacher', name: 'Ms Ng', email: 'ng@school.org', schoolId: 's1' },
    { id: 'k1', type: 'student', name: 'Maria Isabel Lopez', email: 'k1@school.org', grade: '6', schoolId: 's1' },
    { id: 'k2', type: 'student', name: 'Sam Ortiz', email: 'k2@school.org', grade: '11', schoolId: 's1' },
    { id: 'p1', type: 'contact', name: 'Parent One', email: 'p@home.com', guardianOf: ['k1'] },
    { id: 'z1', type: 'alien', name: 'X' }, { name: 'no id', type: 'student' }
  ],
  sections: [{ id: 'sec1', name: 'Intro to Python', schoolId: 's1', teacherIds: ['t1'], studentIds: ['k1', 'k2'] }]
}
t('roster mapping: units, roles, classes, stricter bands, minimal data', () => {
  const r = mapRoster(ROSTER, { orgId: 'org1' }); assert.deepStrictEqual(r.units.map(u => u.id), ['district:d1', 'school:s1', 'class:sec1']); assert.strictEqual(r.units[2].parent, 'school:s1')
  const by = id => r.members.find(m => m.id === 'clever:' + id)
  assert.deepStrictEqual(by('t1').roles, ['teacher']); assert.deepStrictEqual(by('t1').classIds, ['class:sec1']); assert.strictEqual(by('k1').ageBand, 'under13'); assert.strictEqual(by('k1').email, undefined); assert.strictEqual(by('k1').displayName, 'Maria L.')
  assert.strictEqual(by('k2').ageBand, '13-17'); assert.strictEqual(by('k2').email, 'k2@school.org'); assert.deepStrictEqual(by('p1').roles, ['guardian']); assert.deepStrictEqual(by('p1').guardianOf, ['clever:k1'])
  assert.strictEqual(r.skipped.length, 2); assert.ok(by('k1').externalIdHash && by('k1').externalIdHash.length === 64); assert.strictEqual(by('k1').provisionedBy, 'roster')
  assert.notStrictEqual(mapRoster(ROSTER, { orgId: 'org2' }).members[1].externalIdHash, by('k1').externalIdHash)
  assert.deepStrictEqual(mapRoster(null).members, [])
})
t('a mapped student really is limited by the policy engine', () => {
  const m = mapRoster(ROSTER, { orgId: 'org1' }).members.find(x => x.id === 'clever:k1'); const u = { id: m.id, ...sessionFields(m, 'org1') }
  const org = { id: 'org1', policy: { modes: ['manual', 'plan', 'bypass'], net: { max: 'full' } } }
  assert.strictEqual(can(u, 'agent.mode.use', { org, mode: 'bypass' }).allow, false); assert.strictEqual(can(u, 'friends.request', { org, target: { ageBand: 'adult' } }).allow, false); assert.deepStrictEqual(effectiveLimits(u, org).modes, ['manual', 'plan'])
})

t('teacher edits narrow only', () => {
  const org = { modes: ['manual', 'plan'], net: { max: 'allowlist' }, tokenBudgets: { userDaily: 10000 }, sharing: { who: 'members' } }
  const ok = narrowClassPolicy(org, 'c1', { modes: ['plan'], netMax: 'off', tokenDaily: 500, allowRun: true, allowShare: false, models: ['m'] }); assert.strictEqual(ok.ok, true); assert.deepStrictEqual(ok.policy.classes.c1.modes, ['plan']); assert.strictEqual(ok.policy.classes.c1.tokenDaily, 500)
  for (const [c, code] of [[{ modes: ['bypass'] }, 'wider_than_org'], [{ modes: ['zzz'] }, 'bad_modes'], [{ netMax: 'full' }, 'wider_than_org'], [{ netMax: 'wide' }, 'bad_level'], [{ tokenDaily: 20000 }, 'wider_than_org'], [{ tokenDaily: -1 }, 'bad_amount'], [{ models: 'x' }, 'bad_models']]) assert.deepStrictEqual(narrowClassPolicy(org, 'c1', c), { ok: false, code }, JSON.stringify(c))
  assert.strictEqual(narrowClassPolicy({ ...org, run: false }, 'c1', { allowRun: true }).code, 'wider_than_org'); assert.strictEqual(narrowClassPolicy({ ...org, sharing: { who: 'nobody' } }, 'c1', { allowShare: true }).code, 'wider_than_org')
  assert.strictEqual(narrowClassPolicy({ ...org, models: ['a'] }, 'c1', { models: ['b'] }).code, 'wider_than_org')
})

t('audit chain: appends link, tampering is found at the right entry', () => {
  let clock = 1000; const log = createAuditLog({ now: () => clock++ })
  const e1 = log.append({ orgId: 'o', actor: 'ann', kind: 'edit', target: 'a.py', detail: { plus: 3 } }); const e2 = log.append({ orgId: 'o', actor: 'agent-coder', kind: 'run', target: 'pytest' }); const e3 = log.append({ orgId: 'o', actor: 'ann', kind: 'approval' })
  assert.deepStrictEqual([e1.seq, e2.seq, e3.seq], [1, 2, 3]); assert.notStrictEqual(e1.hash, e2.hash); assert.strictEqual(verifyChain(log.entries()).ok, true); assert.deepStrictEqual(log.head(), { seq: 3, hash: e3.hash })
  const copy = () => JSON.parse(JSON.stringify(log.entries()))
  let x = copy(); x[1].actor = 'bob'; assert.deepStrictEqual(verifyChain(x), { ok: false, brokenAt: 2, ...{} }.brokenAt === 2 ? { ok: false, brokenAt: 2 } : null)
  x = copy(); x.splice(1, 1); assert.strictEqual(verifyChain(x).ok, false); x = copy(); x[2].detail = { forged: true }; assert.strictEqual(verifyChain(x).brokenAt, 3); x = copy(); x.reverse(); assert.strictEqual(verifyChain(x).ok, false)
  x = copy(); x.pop(); assert.strictEqual(verifyChain(x).ok, true, 'cutting the tail is only caught by comparing head()')
  assert.throws(() => { log.entries()[0].actor = 'x' }, undefined, 'entries are frozen'); assert.strictEqual(verifyChain(log.entries()).ok, true)
})
t('audit log refuses private conversations and malformed entries', () => {
  const log = createAuditLog(); for (const k of ['private_chat', 'consensus_private', 'chat', undefined]) assert.throws(() => log.append({ orgId: 'o', actor: 'a', kind: k }), /audit_kind/, String(k))
  assert.throws(() => log.append({ orgId: '', actor: 'a', kind: 'edit' }), /audit_fields/); assert.throws(() => log.append({ orgId: 'o', actor: '', kind: 'edit' }), /audit_fields/); assert.ok(!AUDIT_KINDS.some(k => /private/.test(k)))
})
t('audit: the file sink round-trips and a resumed log continues the chain', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'orgs-')); const file = path.join(dir, 'audit.jsonl')
  try {
    const log = createAuditLog({ sink: fileSink(file) }); log.append({ orgId: 'o', actor: 'a', kind: 'edit' }); log.append({ orgId: 'o', actor: 'a', kind: 'run' })
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600); const back = readEntries(file); assert.strictEqual(verifyChain(back).ok, true)
    const more = createAuditLog({ entries: back, sink: fileSink(file) }); const e = more.append({ orgId: 'o', actor: 'a', kind: 'access' }); assert.strictEqual(e.seq, 3); assert.strictEqual(verifyChain(readEntries(file)).ok, true)
    assert.deepStrictEqual(readEntries(path.join(dir, 'missing')), [])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
t('audit export: one org only, spreadsheet formulas neutralized, quotes escaped', () => {
  const log = createAuditLog({ now: () => 0 }); log.append({ orgId: 'o', actor: '=cmd|calc', kind: 'edit', target: 'say "hi", ok' }); log.append({ orgId: 'other', actor: 'z', kind: 'edit' }); log.append({ orgId: 'o', actor: '@x', kind: 'run', detail: { a: 1 } })
  const csv = exportCsv(log.entries(), 'o'); const lines = csv.trim().split('\n'); assert.strictEqual(lines.length, 3); assert.ok(!csv.includes('"z"')); assert.ok(lines[1].includes('"\'=cmd|calc"')); assert.ok(lines[1].includes('"say ""hi"", ok"')); assert.ok(lines[2].includes('"\'@x"'))
  assert.ok(lines[0].startsWith('seq,at,actor,kind')); assert.strictEqual(exportCsv(log.entries(), 'nobody').trim().split('\n').length, 1)
})
t('retention cut keeps the chain checkable through the anchor', () => {
  let clock = 0; const log = createAuditLog({ now: () => (clock += 86400000) }); for (let i = 0; i < 5; i++) log.append({ orgId: 'o', actor: 'a', kind: 'edit', target: String(i) })
  const cut = retentionCut(log.entries(), 3, 5 * 86400000 + 1); assert.strictEqual(cut.drop.length, 2); assert.strictEqual(cut.keep.length, 3); assert.strictEqual(verifyChain(cut.keep, cut.anchor).ok, true); assert.strictEqual(verifyChain(cut.keep).ok, false)
  const resumed = createAuditLog({ entries: cut.keep, anchor: cut.anchor }); assert.strictEqual(resumed.append({ orgId: 'o', actor: 'a', kind: 'edit' }).seq, 6); assert.strictEqual(retentionCut(log.entries(), 100, 6 * 86400000).anchor, null)
  const empty = createAuditLog({ anchor: cut.anchor }); assert.strictEqual(empty.append({ orgId: 'o', actor: 'a', kind: 'edit' }).seq, 3)
})
t('deletion plan: erases the person, keeps the chain, asks the school for a child', () => {
  const p = deletionPlan({ id: 'u1', ageBand: 'under13' }); assert.ok(p.erase.includes('profile') && p.keep.length === 2); assert.strictEqual(p.needsGuardianOrSchool, true); assert.match(p.pseudonym, /^deleted-[0-9a-f]{10}$/)
  assert.strictEqual(deletionPlan({ id: 'u1', ageBand: 'adult' }).needsGuardianOrSchool, false); assert.strictEqual(deletionPlan({ id: 'u1', ageBand: 'adult' }).pseudonym, p.pseudonym); assert.strictEqual(deletionPlan(null).pseudonym, null)
})

console.log(`orgs tests passed: ${n} groups (bands, minimal records, sign-in domains, domain proof, rosters, narrowing, audit chain, deletion)`)
