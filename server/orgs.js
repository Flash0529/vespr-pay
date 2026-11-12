// Organization data rules for VESPR: pure helpers around server/policy.js. No network, no real identity provider is called.
//   - age bands and the minimal record kept per band
//   - sign-in domain checks (Google Workspace, Microsoft Entra, generic OIDC claims) and domain verification (DNS TXT, resolver injected)
//   - roster mapping (Clever and ClassLink claim shape -> class membership); the real connections are PLANNED
//   - narrowing-only policy edits for teachers
//   - the append-only, hash-chained audit log and its CSV export
//   - the session fields auth must carry, and the deletion plan
// See docs/ORGS-SCHOOLS.md. The library calls here never read or write files except the optional fileSink.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ROLES, AGE_BANDS, MODES, NET_LEVELS, normalizePolicy } from './policy.js'

const isObj = v => v && typeof v === 'object' && !Array.isArray(v)
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex')

// ---- age bands and the minimal record ----

// Only a band is kept, never a birth date. The year is coarse on purpose: a person whose birth year is unknown is treated as under 13.
export function ageBandFromBirthYear (birthYear, nowYear = new Date().getUTCFullYear()) {
  if (!Number.isInteger(birthYear) || birthYear > nowYear || birthYear < nowYear - 120) return 'under13'
  const age = nowYear - birthYear // may be one year too high; we round toward the stricter band below
  if (age <= 13) return 'under13'
  if (age <= 18) return '13-17'
  return 'adult'
}

// Grades map to the stricter band on purpose: an eighth grader can be 12.
export function ageBandFromGrade (grade) {
  const g = String(grade ?? '').trim().toLowerCase()
  if (g === 'k' || g === 'pk' || g === 'prekindergarten' || g === 'kindergarten') return 'under13'
  const n = Number(g)
  if (!Number.isInteger(n)) return /^(college|university|adult|postsecondary)$/.test(g) ? 'adult' : 'under13'
  return n <= 8 ? 'under13' : n <= 12 ? '13-17' : 'adult'
}

export const stricterBand = (a, b) => AGE_BANDS[Math.min(AGE_BANDS.indexOf(a), AGE_BANDS.indexOf(b))]

const FIELDS = { // the only fields kept per band; everything else is dropped by minimalMember
  under13: ['id', 'roles', 'ageBand', 'classIds', 'displayName', 'externalIdHash', 'guardianOf', 'provisionedBy'],
  '13-17': ['id', 'roles', 'ageBand', 'classIds', 'displayName', 'externalIdHash', 'email', 'provisionedBy'],
  adult: ['id', 'roles', 'ageBand', 'classIds', 'displayName', 'externalIdHash', 'email', 'guardianOf', 'provisionedBy']
}
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n)

// Keeps only what the band needs. Under 13: no email, no phone, no birth date, display name cut to a first name and an initial.
export function minimalMember (input) {
  const band = AGE_BANDS.includes(input?.ageBand) ? input.ageBand : 'under13'
  const out = {}
  for (const k of FIELDS[band]) if (input && input[k] !== undefined) out[k] = input[k]
  out.ageBand = band
  out.roles = (Array.isArray(out.roles) ? out.roles : []).filter(r => ROLES.includes(r))
  out.classIds = (Array.isArray(out.classIds) ? out.classIds : []).filter(c => typeof c === 'string')
  if (out.displayName !== undefined) {
    const parts = clean(out.displayName, 80).split(/\s+/).filter(Boolean)
    out.displayName = band === 'under13' && parts.length > 1 ? parts[0] + ' ' + parts[parts.length - 1][0] + '.' : parts.join(' ')
  }
  if (out.email !== undefined) out.email = clean(out.email, 254).toLowerCase()
  return out
}

// What the session must carry (the contract in the doc). Anything not a known role or band is dropped; no orgId means an individual.
export function sessionFields (member, orgId) {
  const m = member ? minimalMember(member) : null
  if (!m || !orgId || !m.roles.length) return { orgId: null, roles: ['member'], ageBand: m ? m.ageBand : 'adult', classIds: [] }
  const f = { orgId, roles: m.roles, ageBand: m.ageBand, classIds: m.classIds }
  if (m.guardianOf?.length) f.guardianOf = m.guardianOf
  return f
}

// ---- domains and sign-in ----

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com'])
export const normalizeDomain = d => String(d ?? '').trim().toLowerCase().replace(/\.$/, '')
export const emailDomain = e => { const m = /^[^\s@]+@([^\s@]+)$/.exec(String(e ?? '').trim().toLowerCase()); return m ? m[1] : null }
export const claimableDomain = d => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(normalizeDomain(d)) && !FREE_MAIL.has(normalizeDomain(d))

// DNS proof of control. The caller looks up TXT records (a resolver is not called here) and passes them in.
export const verificationRecord = (domain, token) => ({ name: '_vespr-verify.' + normalizeDomain(domain), type: 'TXT', value: 'vespr-verify=' + token })
export const newVerificationToken = (randomBytes = crypto.randomBytes) => randomBytes(18).toString('hex')
export function confirmDomain (domain, token, txtRecords) {
  if (!claimableDomain(domain) || typeof token !== 'string' || token.length < 16) return false
  const want = 'vespr-verify=' + token
  return Array.isArray(txtRecords) && txtRecords.some(r => (Array.isArray(r) ? r.join('') : String(r)) === want)
}

// Does this sign-in belong to the org? org: { domains: [verified domains], idp: { google: {hd}, microsoft: {tid}, oidc: {issuer, audience} } }.
// Never trusts an email suffix alone: Google needs the hosted-domain claim (hd) and a verified email; Entra needs the tenant id (tid).
export function checkSignIn (org, { provider, claims }) {
  const c = isObj(claims) ? claims : {}
  const domains = (org?.domains || []).map(normalizeDomain)
  const d = emailDomain(c.email)
  const fail = code => ({ ok: false, code })
  if (!org || !domains.length) return fail('org_has_no_verified_domain')
  if (c.email_verified !== true && c.emailVerified !== true) return fail('email_unverified')
  if (!d || !domains.includes(d)) return fail('domain_not_allowed')
  if (provider === 'google') return c.hd && normalizeDomain(c.hd) === d && domains.includes(normalizeDomain(c.hd)) ? { ok: true, code: 'ok' } : fail('google_hd_mismatch')
  if (provider === 'microsoft') return org.idp?.microsoft?.tid && c.tid === org.idp.microsoft.tid ? { ok: true, code: 'ok' } : fail('tenant_mismatch')
  if (provider === 'oidc') {
    const o = org.idp?.oidc
    return o && c.iss === o.issuer && (Array.isArray(c.aud) ? c.aud.includes(o.audience) : c.aud === o.audience) ? { ok: true, code: 'ok' } : fail('issuer_mismatch')
  }
  return fail('provider_not_supported')
}

// Invite-by-domain: someone whose verified work address is on a verified domain may join as a member (never higher, never as a student).
export function inviteByDomain (org, email) {
  const d = emailDomain(email)
  const ok = d && (org?.domains || []).map(normalizeDomain).includes(d) && org.inviteByDomain === true
  return ok ? { ok: true, roles: ['member'] } : { ok: false, roles: [] }
}

// ---- rosters (Clever / ClassLink claim shape; PLANNED, no connection is made) ----

const ROSTER_ROLES = { student: 'student', teacher: 'teacher', school_admin: 'admin', district_admin: 'admin', administrator: 'admin', staff: 'member', guardian: 'guardian', parent: 'guardian', contact: 'guardian' }
// roster: { provider: 'clever'|'classlink', districtId, schools:[{id,name}], users:[{id,type,name,email?,grade?,schoolId,guardianOf?:[id]}], sections:[{id,name,schoolId,teacherIds:[],studentIds:[]}] }
export function mapRoster (roster, { orgId = 'org' } = {}) {
  const r = isObj(roster) ? roster : {}
  const units = []
  if (r.districtId) units.push({ id: 'district:' + r.districtId, kind: 'district', parent: null })
  for (const s of r.schools || []) units.push({ id: 'school:' + s.id, kind: 'school', name: clean(s.name, 120), parent: r.districtId ? 'district:' + r.districtId : null })
  for (const s of r.sections || []) units.push({ id: 'class:' + s.id, kind: 'class', name: clean(s.name, 120), parent: s.schoolId ? 'school:' + s.schoolId : null })
  const classesOf = id => (r.sections || []).filter(s => (s.studentIds || []).includes(id) || (s.teacherIds || []).includes(id)).map(s => 'class:' + s.id)
  const members = []
  const skipped = []
  for (const u of r.users || []) {
    const role = ROSTER_ROLES[String(u.type || '').toLowerCase()]
    if (!role || !u.id) { skipped.push({ id: u.id ?? null, why: 'unknown_type' }); continue }
    const band = role === 'student' ? ageBandFromGrade(u.grade) : 'adult'
    members.push(minimalMember({
      id: r.provider + ':' + u.id,
      roles: [role],
      ageBand: band,
      classIds: classesOf(u.id),
      displayName: u.name,
      email: u.email, // minimalMember drops it for under 13
      externalIdHash: sha256(orgId + ':' + r.provider + ':' + u.id),
      guardianOf: role === 'guardian' ? (u.guardianOf || []).map(x => r.provider + ':' + x) : undefined,
      provisionedBy: 'roster'
    }))
  }
  return { units, members, skipped }
}

// ---- narrowing-only edits for teachers ----

// A teacher's class settings may only remove abilities the org gave. Returns { ok, policy } or { ok:false, code }.
export function narrowClassPolicy (orgPolicy, classId, change) {
  const P = normalizePolicy(orgPolicy)
  const cur = P.classes[classId] || { modes: null, models: null, netMax: null, allowRun: false, allowShare: false, tokenDaily: null }
  const next = { ...cur }
  if (change.modes !== undefined) {
    if (!Array.isArray(change.modes) || !change.modes.every(m => MODES.includes(m))) return { ok: false, code: 'bad_modes' }
    if (!change.modes.every(m => P.modes.includes(m))) return { ok: false, code: 'wider_than_org' }
    next.modes = change.modes
  }
  if (change.models !== undefined) {
    if (!Array.isArray(change.models)) return { ok: false, code: 'bad_models' }
    if (P.models && !change.models.every(m => P.models.includes(m))) return { ok: false, code: 'wider_than_org' }
    next.models = change.models
  }
  if (change.netMax !== undefined) {
    if (!NET_LEVELS.includes(change.netMax)) return { ok: false, code: 'bad_level' }
    if (NET_LEVELS.indexOf(change.netMax) > NET_LEVELS.indexOf(P.net.max)) return { ok: false, code: 'wider_than_org' }
    next.netMax = change.netMax
  }
  if (change.tokenDaily !== undefined) {
    if (!Number.isInteger(change.tokenDaily) || change.tokenDaily < 0) return { ok: false, code: 'bad_amount' }
    const cap = P.tokenBudgets.userDaily
    if (cap !== null && change.tokenDaily > cap) return { ok: false, code: 'wider_than_org' }
    next.tokenDaily = change.tokenDaily
  }
  if (change.allowRun !== undefined) { if (typeof change.allowRun !== 'boolean' || (change.allowRun && !P.run)) return { ok: false, code: 'wider_than_org' }; next.allowRun = change.allowRun }
  if (change.allowShare !== undefined) { if (typeof change.allowShare !== 'boolean' || (change.allowShare && P.sharing.who === 'nobody')) return { ok: false, code: 'wider_than_org' }; next.allowShare = change.allowShare }
  return { ok: true, policy: { ...P, classes: { ...P.classes, [classId]: next } } }
}

// ---- audit log: append-only, hash-chained (R19 to R24) ----

export const AUDIT_KINDS = ['edit', 'run', 'approval', 'access', 'decision', 'commit', 'preview', 'policy', 'export', 'deletion', 'login']
const GENESIS = '0'.repeat(64)
const canon = v => JSON.stringify(v, (k, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x))
export const entryHash = (prev, e) => sha256(prev + '\n' + canon({ seq: e.seq, at: e.at, orgId: e.orgId, actor: e.actor, kind: e.kind, target: e.target, detail: e.detail }))

export function createAuditLog ({ now = Date.now, sink = null, entries = [], anchor = null } = {}) {
  const list = entries.slice()
  let prev = list.length ? list[list.length - 1].hash : anchor ? anchor.hash : GENESIS
  let seq = list.length ? list[list.length - 1].seq : anchor ? anchor.seq : 0
  function append ({ orgId, actor, kind, target = null, detail = null }) {
    if (!AUDIT_KINDS.includes(kind)) throw new Error('audit_kind') // private conversations are not a kind: they can never be logged
    if (typeof orgId !== 'string' || !orgId || typeof actor !== 'string' || !actor) throw new Error('audit_fields')
    const e = { seq: seq + 1, at: now(), orgId, actor, kind, target, detail }
    e.hash = entryHash(prev, e)
    Object.freeze(e)
    list.push(e); seq = e.seq; prev = e.hash
    if (sink) sink(e)
    return e
  }
  return { append, entries: () => list.slice(), head: () => ({ seq, hash: prev }), forOrg: orgId => list.filter(e => e.orgId === orgId) }
}

// Recomputes the chain. anchor = { seq, hash } of the last entry removed by retention, if any.
export function verifyChain (entries, anchor = null) {
  let prev = anchor ? anchor.hash : GENESIS
  let seq = anchor ? anchor.seq : 0
  for (const e of entries) {
    if (e.seq !== seq + 1 || entryHash(prev, e) !== e.hash) return { ok: false, brokenAt: e.seq }
    prev = e.hash; seq = e.seq
  }
  return { ok: true, brokenAt: null, head: { seq, hash: prev } }
}

const csvCell = v => {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s // a spreadsheet must not run a cell as a formula
  return '"' + s.replace(/"/g, '""') + '"'
}
export function exportCsv (entries, orgId) {
  const rows = entries.filter(e => e.orgId === orgId) // never another org's rows
  return ['seq,at,actor,kind,target,detail,hash', ...rows.map(e => [e.seq, new Date(e.at).toISOString(), e.actor, e.kind, e.target, e.detail, e.hash].map(csvCell).join(','))].join('\n') + '\n'
}

export function fileSink (file) { // one JSON line per entry, mode 0600; the caller creates the directory
  return e => fs.appendFileSync(path.resolve(file), JSON.stringify(e) + '\n', { mode: 0o600 })
}
export const readEntries = file => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] } }

// ---- retention and deletion ----

// Entries older than the org's audit retention may be dropped from the front; the new anchor keeps the chain checkable.
export function retentionCut (entries, auditDays, now = Date.now()) {
  const cutoff = now - auditDays * 86400000
  let n = 0
  while (n < entries.length && entries[n].at < cutoff) n++
  return { drop: entries.slice(0, n), keep: entries.slice(n), anchor: n ? { seq: entries[n - 1].seq, hash: entries[n - 1].hash } : null }
}

// What a deletion request covers. The audit log is not rewritten (that would break the chain): the person's name in it is replaced
// by a pseudonym at export time, and the entries age out under retention. The doc says this plainly.
export function deletionPlan (member) {
  const id = member?.id
  return {
    userId: id,
    erase: ['profile', 'sessions', 'agent chats owned by the person', 'uploads owned by the person', 'share links created by the person', 'friends and direct messages', 'workspace seats'],
    keep: ['audit entries (actor shown as a pseudonym after deletion, removed when retention ends)', 'text a teammate or a class owns, with the authorship label replaced by "deleted user"'],
    pseudonym: id ? 'deleted-' + sha256('pseudonym:' + id).slice(0, 10) : null,
    needsGuardianOrSchool: member?.ageBand === 'under13'
  }
}
