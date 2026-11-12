// Mutation check for server/policy.js and server/orgs.js: breaks the code on purpose, one change at a time, and requires the tests to fail.
// Run by hand (about a minute on the Pi): node server/test/mutate-orgs.mjs   Prints "N of N mutants killed"; exits 1 if any survives.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
const here = path.dirname(new URL(import.meta.url).pathname)
const MUTANTS = [
  // policy.js
  ['policy.js', "if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(H, action))", "if (typeof action !== 'string' || !(action in H))"],
  ['policy.js', "if (c.org.id !== user.orgId) return deny('cross_org'", "if (false) return deny('cross_org'"],
  ['policy.js', "if (!isObj(c.org) || typeof c.org.id !== 'string') return deny('no_org_context'", "if (false) return deny('no_org_context'"],
  ['policy.js', "if (student) modes = modes.filter(m => STUDENT_MODES.includes(m))", "if (false) modes = modes"],
  ['policy.js', "if (minor) modes = modes.filter(m => m !== 'bypass')", "if (false) modes = modes"],
  ['policy.js', "STUDENT_MODES = ['manual', 'plan']", "STUDENT_MODES = ['manual', 'plan', 'auto']"],
  ['policy.js', "if (student && models === null) models = []", "if (false) models = []"],
  ['policy.js', "if (student && !caps.length) caps.push(DEFAULT_STUDENT_DAILY_TOKENS)", "if (false) caps.push(1)"],
  ['policy.js', "c.used + c.tokens <= L.tokenCap", "c.used + c.tokens < L.tokenCap"],
  ['policy.js', "const tokenCap = caps.length ? Math.min(...caps) : null", "const tokenCap = caps.length ? Math.max(...caps) : null"],
  ['policy.js', "if (minor && netMax === 'full') netMax = 'allowlist'", "if (false) netMax = 'allowlist'"],
  ['policy.js', "return onList(String(c.domain).toLowerCase(), L.allowlist)", "return String(c.domain).toLowerCase().endsWith(L.allowlist[0].slice(-4)) || onList(String(c.domain).toLowerCase(), L.allowlist)"],
  ['policy.js', "domain === d || domain.endsWith('.' + d)", "domain === d || domain.endsWith(d)"],
  ['policy.js', "const ssh = !student && !minor && P.ssh", "const ssh = P.ssh"],
  ['policy.js', "if (isStudent(u) && c.runner !== 'sandbox')", "if (false)"],
  ['policy.js', "if (c.leavesOrg) {\n      if (isMinor(u))", "if (false) {\n      if (isMinor(u))"],
  ['policy.js', "if (!S.allowExternal) return deny('external_off'", "if (false) return deny('external_off'"],
  ['policy.js', "if (c.role === 'edit' && S.externalMaxRole !== 'edit')", "if (false)"],
  ['policy.js', "if (c.leavesOrg) return deny('student_external'", "if (false) return deny('student_external'"],
  ['policy.js', "if (isMinor(u) || isStudent(u)) return deny('minor_social', 'Friends are off", "if (isStudent(u)) return deny('minor_social', 'Friends are off"],
  ['policy.js', "if (isMinor(u) || isStudent(u)) return deny('minor_social', 'Direct messages", "if (false) return deny('minor_social', 'Direct messages"],
  ['policy.js', "if (isMinor(c.target)) return deny('minor_social', 'Adults cannot", "if (false) return deny('minor_social', 'Adults cannot"],
  ['policy.js', "if (hasRole(u, ['teacher']) && sameClass(u, t)) return allow('teacher', 'Teacher of this student.', seen)", "if (hasRole(u, ['teacher'])) return allow('teacher', 'Teacher of this student.', seen)"],
  ['policy.js', "const seen = ['show_notice_to_student', 'record_in_audit']", "const seen = ['record_in_audit']"],
  ['policy.js', "L.policy.adminsSeeStudentChats) return allow('staff'", "true) return allow('staff'"],
  ['policy.js', "L.policy.guardianAccess && (u.guardianOf || []).includes(t.id)) return allow('guardian', 'Guardian of this student.', seen)", "(u.guardianOf || []).includes(t.id)) return allow('guardian', 'Guardian of this student.', seen)"],
  ['policy.js', "if (['private_chat', 'consensus_private'].includes(c.kind))", "if (false)"],
  ['policy.js', "if (hasRole(u, ['owner', 'admin', 'manager'])) return allow()\n    if (hasRole(u, ['teacher'])) return inOwnClass", "if (hasRole(u, ['owner', 'admin', 'manager', 'teacher'])) return allow()\n    if (hasRole(u, ['teacher'])) return inOwnClass"],
  ['policy.js', "'audit.export' (u) { return hasRole(u, ['owner', 'admin', 'manager'])", "'audit.export' (u) { return hasRole(u, ['owner', 'admin', 'manager', 'teacher'])"],
  ['policy.js', "if (t.id === u.id) return deny('self_role_change'", "if (false) return deny('self_role_change'"],
  ['policy.js', "if (!hasRole(u, ['owner']) && (t.roles.includes('owner')", "if (false && (t.roles.includes('owner')"],
  ['policy.js', "if (t.orgId !== u.orgId) return deny('cross_org', 'Different organization.')\n    const seen", "const seen"],
  ['policy.js', "c.target.orgId !== undefined && c.target.orgId !== user.orgId", "false"],
  ['policy.js', "if (c.classId !== undefined && isStudent(user) && !inOwnClass(user, c.classId))", "if (false)"],
  ['policy.js', "if (user.ageBand === 'under13') return deny('minor_needs_school'", "if (false) return deny('minor_needs_school'"],
  ['policy.js', "if (u.roles.includes('student') && u.roles.length > 1) return false", "if (false) return false"],
  ['policy.js', "run: r.run !== false", "run: r.run === true"],
  ['policy.js', "friends: r.friends === true", "friends: r.friends !== false"],
  ['policy.js', "allowExternal: sharing.allowExternal === true", "allowExternal: sharing.allowExternal !== false"],
  ['policy.js', "({ allow: false, code, reason })", "({ allow: true, code, reason })"],
  ['policy.js', "catch { return deny('policy_error', 'The check failed, so the answer is no.') } // never throws", "catch { return allow() } // never throws"],
  ['policy.js', "if (!hasRole(u, AGENT_USERS)) return deny('role', 'This role cannot spend tokens.')", "if (false) return deny('role', 'x')"],
  // orgs.js
  ['orgs.js', "if (age <= 13) return", "if (age <= 14) return"],
  ['orgs.js', "return n <= 8 ? 'under13'", "return n <= 6 ? 'under13'"],
  ['orgs.js', "under13: ['id', 'roles', 'ageBand', 'classIds', 'displayName', 'externalIdHash', 'guardianOf', 'provisionedBy']", "under13: ['id', 'roles', 'ageBand', 'classIds', 'displayName', 'externalIdHash', 'guardianOf', 'provisionedBy', 'email']"],
  ['orgs.js', "band === 'under13' && parts.length > 1 ?", "false ?"],
  ['orgs.js', "if (!d || !domains.includes(d)) return fail('domain_not_allowed')", "if (!d) return fail('domain_not_allowed')"],
  ['orgs.js', "c.hd && normalizeDomain(c.hd) === d &&", "true &&"],
  ['orgs.js', "c.tid === org.idp.microsoft.tid", "true"],
  ['orgs.js', "if (c.email_verified !== true && c.emailVerified !== true)", "if (false)"],
  ['orgs.js', "c.iss === o.issuer &&", "true &&"],
  ['orgs.js', "&& !FREE_MAIL.has(normalizeDomain(d))", ""],
  ['orgs.js', "r => (Array.isArray(r) ? r.join('') : String(r)) === want", "r => String(r).includes(want.slice(0, 20))"],
  ['orgs.js', "org.inviteByDomain === true", "true"],
  ['orgs.js', "if (!change.modes.every(m => P.modes.includes(m))) return", "if (false) return"],
  ['orgs.js', "NET_LEVELS.indexOf(change.netMax) > NET_LEVELS.indexOf(P.net.max)", "false"],
  ['orgs.js', "if (cap !== null && change.tokenDaily > cap)", "if (false)"],
  ['orgs.js', "n <= 8 ? 'under13' : n <= 12", "n <= 8 ? 'under13' : n <= 13"],
  ['orgs.js', "if (!AUDIT_KINDS.includes(kind)) throw", "if (false) throw"],
  ['orgs.js', "e.hash = entryHash(prev, e)", "e.hash = entryHash(GENESIS, e)"],
  ['orgs.js', "Object.freeze(e)", "void e"],
  ['orgs.js', "if (e.seq !== seq + 1 || entryHash(prev, e) !== e.hash)", "if (e.seq !== seq + 1)"],
  ['orgs.js', "entries.filter(e => e.orgId === orgId)", "entries"],
  ['orgs.js', "if (/^[=+\\-@\\t\\r]/.test(s)) s = \"'\" + s", "void s"],
  ['orgs.js', "replace(/\"/g, '\"\"')", "replace(/\"/g, '')"],
  ['orgs.js', "mode: 0o600 }", "mode: 0o644 }"],
  ['orgs.js', "entries[n].at < cutoff", "entries[n].at <= cutoff + 86400000"],
  ['orgs.js', "if (!role || !u.id) {", "if (!u.id) {"],
  ['orgs.js', "const band = role === 'student' ? ageBandFromGrade(u.grade) : 'adult'", "const band = 'adult'"],
  ['orgs.js', "needsGuardianOrSchool: member?.ageBand === 'under13'", "needsGuardianOrSchool: false"]
]
const only = process.argv[2] ? Number(process.argv[2]) : null
const tmpRoot = process.env.TMPDIR || os.tmpdir()
let killed = 0; const survivors = []; let count = 0
for (const [i, [file, from, to]] of MUTANTS.entries()) {
  if (only !== null && i !== only) continue
  count++
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'mut-'))
  try {
    fs.mkdirSync(path.join(dir, 'server/test'), { recursive: true }); fs.mkdirSync(path.join(dir, 'agents/src'), { recursive: true })
    for (const f of ['policy.js', 'orgs.js']) fs.copyFileSync(path.join(here, '..', f), path.join(dir, 'server', f))
    for (const f of ['policy.test.js', 'orgs.test.js']) fs.copyFileSync(path.join(here, f), path.join(dir, 'server/test', f))
    fs.copyFileSync(path.join(here, '../../agents/src/policy.js'), path.join(dir, 'agents/src/policy.js'))
    const target = path.join(dir, 'server', file); const src = fs.readFileSync(target, 'utf8')
    if (src.split(from).length !== 2) { console.log(`#${i} BAD MUTANT (pattern found ${src.split(from).length - 1} times): ${from.slice(0, 60)}`); survivors.push(i); continue }
    fs.writeFileSync(target, src.replace(from, () => to))
    const r1 = spawnSync('node', ['test/policy.test.js'], { cwd: path.join(dir, 'server'), encoding: 'utf8', timeout: 30000, env: { ...process.env, TMPDIR: tmpRoot } })
    const r2 = spawnSync('node', ['test/orgs.test.js'], { cwd: path.join(dir, 'server'), encoding: 'utf8', timeout: 30000, env: { ...process.env, TMPDIR: tmpRoot } })
    if (r1.status !== 0 || r2.status !== 0) killed++
    else { survivors.push(i); console.log(`#${i} SURVIVED: ${file}: ${from.slice(0, 70)}`) }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
console.log(`mutation check: ${killed} of ${count} mutants killed${survivors.length ? '; survivors: ' + survivors.join(', ') : ''}`)
process.exit(survivors.length ? 1 : 0)
