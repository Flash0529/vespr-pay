// Organization and school policy for VESPR: one pure function, can(user, action, context), deny by default.
// No I/O, no clock, no network: the caller passes the user, the action name and the facts. See docs/ORGS-SCHOOLS.md.
//
//   user     { id, orgId|null, roles: [...], ageBand, classIds: [...], guardianOf?: [studentId] }   (what auth puts on the session)
//   context  { org: { id, policy }, classId?, target?, ... } depending on the action (the doc lists them)
//   returns  { allow: boolean, code: string, reason: string, obligations?: [string] }
//
// Order of checks: (1) the user record must be well formed, (2) the action must be known, (3) the user's organization must be
// the organization that owns the thing, (4) the role table, (5) the action's own rules (age band, class, org policy).
// Org policy can only narrow what the floors below allow; no setting can widen a floor.

export const ROLES = ['owner', 'admin', 'manager', 'teacher', 'student', 'guardian', 'member', 'guest']
export const AGE_BANDS = ['under13', '13-17', 'adult']
export const MODES = ['manual', 'acceptEdits', 'auto', 'plan', 'bypass'] // same list as agents/src/policy.js (a test checks they match)
export const NET_LEVELS = ['off', 'allowlist', 'full'] // UI-SPEC R34
export const STUDENT_MODES = ['manual', 'plan'] // floor: students never get anything else
export const DEFAULT_STUDENT_DAILY_TOKENS = 20000
export const DEFAULT_ALLOWLIST = ['github.com', 'githubusercontent.com', 'npmjs.org', 'pypi.org', 'python.org', 'nodejs.org', 'mozilla.org', 'nebius.com']

const AGENT_USERS = ['owner', 'admin', 'teacher', 'student', 'member'] // people who may start or steer an agent
const STAFF = ['owner', 'admin']

export const DEFAULT_POLICY = Object.freeze({
  modes: ['manual', 'acceptEdits', 'auto', 'plan'], // Bypass is off until an org turns it on, and is never on for minors or students
  models: null, // null = any model (never for students)
  tokenBudgets: { userDaily: null, perUser: {} },
  net: { max: 'allowlist', allowlist: DEFAULT_ALLOWLIST },
  ssh: false,
  run: true,
  sharing: { who: 'members', allowExternal: false, externalMaxRole: 'view' }, // who: 'nobody' | 'staff' | 'members'
  friends: false,
  guardianAccess: false,
  adminsSeeStudentChats: true,
  retention: { auditDays: 365, workDays: null },
  classes: {} // classId -> { modes, models, netMax, allowRun, allowShare, tokenDaily }
})

const isObj = v => v && typeof v === 'object' && !Array.isArray(v)
const pickList = (v, allowed, fallback) => (Array.isArray(v) ? v.filter(x => allowed.includes(x)) : fallback)
const posInt = v => (Number.isInteger(v) && v >= 0 ? v : null)
const domainOk = d => typeof d === 'string' && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)

// Cleans whatever was stored: unknown keys dropped, bad values replaced by the conservative default.
export function normalizePolicy (raw) {
  const r = isObj(raw) ? raw : {}
  const D = DEFAULT_POLICY
  const budgets = isObj(r.tokenBudgets) ? r.tokenBudgets : {}
  const perUser = {}
  if (isObj(budgets.perUser)) for (const [k, v] of Object.entries(budgets.perUser)) if (posInt(v) !== null) perUser[k] = v
  const net = isObj(r.net) ? r.net : {}
  const sharing = isObj(r.sharing) ? r.sharing : {}
  const retention = isObj(r.retention) ? r.retention : {}
  const classes = {}
  if (isObj(r.classes)) {
    for (const [id, c] of Object.entries(r.classes)) {
      if (!isObj(c)) continue
      classes[id] = {
        modes: Array.isArray(c.modes) ? pickList(c.modes, MODES, []) : null,
        models: Array.isArray(c.models) ? c.models.filter(m => typeof m === 'string' && m) : null,
        netMax: NET_LEVELS.includes(c.netMax) ? c.netMax : null,
        allowRun: c.allowRun === true,
        allowShare: c.allowShare === true,
        tokenDaily: posInt(c.tokenDaily)
      }
    }
  }
  return {
    modes: pickList(r.modes, MODES, [...D.modes]),
    models: Array.isArray(r.models) ? r.models.filter(m => typeof m === 'string' && m) : null,
    tokenBudgets: { userDaily: posInt(budgets.userDaily), perUser },
    net: {
      max: NET_LEVELS.includes(net.max) ? net.max : D.net.max,
      allowlist: Array.isArray(net.allowlist) ? net.allowlist.filter(domainOk) : [...D.net.allowlist]
    },
    ssh: r.ssh === true,
    run: r.run !== false,
    sharing: {
      who: ['nobody', 'staff', 'members'].includes(sharing.who) ? sharing.who : D.sharing.who,
      allowExternal: sharing.allowExternal === true,
      externalMaxRole: sharing.externalMaxRole === 'edit' ? 'edit' : 'view'
    },
    friends: r.friends === true,
    guardianAccess: r.guardianAccess === true,
    adminsSeeStudentChats: r.adminsSeeStudentChats !== false,
    retention: { auditDays: posInt(retention.auditDays) ?? D.retention.auditDays, workDays: posInt(retention.workDays) },
    classes
  }
}

const allow = (code = 'ok', reason = 'allowed', obligations) => (obligations ? { allow: true, code, reason, obligations } : { allow: true, code, reason })
const deny = (code, reason) => ({ allow: false, code, reason })

const rank = l => NET_LEVELS.indexOf(l)
const hasRole = (u, list) => u.roles.some(r => list.includes(r))
const isMinor = u => u.ageBand !== 'adult'
const isStudent = u => u.roles.includes('student')
const intersect = (a, b) => (a === null ? b : b === null ? a : a.filter(x => b.includes(x)))
const onList = (domain, list) => typeof domain === 'string' && list.some(d => domain === d || domain.endsWith('.' + d))

export function validUser (u) {
  if (!isObj(u) || typeof u.id !== 'string' || !u.id) return false
  if (u.orgId !== null && (typeof u.orgId !== 'string' || !u.orgId)) return false
  if (!Array.isArray(u.roles) || !u.roles.length || !u.roles.every(r => ROLES.includes(r))) return false
  if (!AGE_BANDS.includes(u.ageBand)) return false
  if (!Array.isArray(u.classIds) || !u.classIds.every(c => typeof c === 'string')) return false
  if (u.roles.includes('student') && u.roles.length > 1) return false // a student is only a student: no mixed powers
  if (u.roles.includes('guardian') && u.roles.some(r => !['guardian', 'teacher', 'member'].includes(r))) return false
  if (u.orgId === null && (u.roles.length !== 1 || u.roles[0] !== 'member')) return false // an individual account has no org roles
  if (u.roles.includes('guardian') && u.ageBand !== 'adult') return false
  return true
}

// What this person may do right now under the org's policy, for the UI and for the checks below. Strictest class wins.
export function effectiveLimits (user, org, classId) {
  const P = normalizePolicy(org?.policy)
  const student = isStudent(user)
  const minor = isMinor(user)
  const classIds = classId ? [classId] : user.classIds
  const cls = classIds.map(id => P.classes[id]).filter(Boolean)
  const classOk = classIds.length > 0 && cls.length === classIds.length // a student in a class with no settings gets no class opt-ins
  let modes = [...P.modes]
  for (const c of cls) if (c.modes) modes = modes.filter(m => c.modes.includes(m))
  if (student) modes = modes.filter(m => STUDENT_MODES.includes(m))
  if (minor) modes = modes.filter(m => m !== 'bypass')
  let models = P.models
  for (const c of cls) if (c.models) models = intersect(models, c.models)
  if (student && models === null) models = [] // a student has no models until the org or the class names some
  let netMax = P.net.max
  if (student) { // a teacher may raise a class from Off to Allowlist but never above the org's own limit
    const wanted = cls.length && cls.every(c => c.netMax) ? cls.map(c => c.netMax).reduce((a, b) => (rank(a) <= rank(b) ? a : b)) : 'off'
    netMax = rank(wanted) <= rank(P.net.max) ? wanted : P.net.max
  } else for (const c of cls) if (c.netMax && rank(c.netMax) < rank(netMax)) netMax = c.netMax
  if (minor && netMax === 'full') netMax = 'allowlist'
  const caps = []
  if (P.tokenBudgets.userDaily !== null) caps.push(P.tokenBudgets.userDaily)
  if (P.tokenBudgets.perUser[user.id] !== undefined) caps.push(P.tokenBudgets.perUser[user.id])
  for (const c of cls) if (c.tokenDaily !== null) caps.push(c.tokenDaily)
  if (student && !caps.length) caps.push(DEFAULT_STUDENT_DAILY_TOKENS)
  const tokenCap = caps.length ? Math.min(...caps) : null
  const run = student ? classOk && cls.every(c => c.allowRun) && P.run : P.run
  const ssh = !student && !minor && P.ssh
  return { modes, models, netMax, allowlist: P.net.allowlist, tokenCap, run, ssh, policy: P }
}

const sameClass = (user, target) => (target?.classIds || []).some(c => user.classIds.includes(c))
const inOwnClass = (user, classId) => typeof classId === 'string' && user.classIds.includes(classId)

const H = {
  'agent.mode.use' (u, c, L) {
    if (!hasRole(u, AGENT_USERS)) return deny('role', 'This role cannot use an agent.')
    if (!MODES.includes(c.mode)) return deny('bad_mode', 'Unknown agent mode.')
    return L.modes.includes(c.mode) ? allow() : deny('mode_not_allowed', 'This mode is not allowed here.')
  },
  'agent.mode.set' (u, c, L) {
    if (!hasRole(u, AGENT_USERS)) return deny('role', 'This role cannot change the agent mode.')
    return H['agent.mode.use'](u, c, L)
  },
  'model.use' (u, c, L) {
    if (!hasRole(u, AGENT_USERS)) return deny('role', 'This role cannot use a model.')
    if (typeof c.model !== 'string' || !c.model) return deny('bad_model', 'No model named.')
    if (L.models === null || L.models.includes(c.model)) return allow()
    return deny('model_not_allowed', 'This model is not allowed here.')
  },
  'tokens.spend' (u, c, L) {
    if (!hasRole(u, AGENT_USERS)) return deny('role', 'This role cannot spend tokens.')
    if (posInt(c.tokens) === null || posInt(c.used) === null) return deny('bad_amount', 'Token amounts must be whole numbers.')
    if (L.tokenCap === null || c.used + c.tokens <= L.tokenCap) return allow()
    return deny('budget', 'The token budget for today is used up.')
  },
  'net.access' (u, c, L) {
    if (!hasRole(u, AGENT_USERS)) return deny('role', 'This role cannot use the network.')
    if (!NET_LEVELS.includes(c.level)) return deny('bad_level', 'Unknown internet level.')
    if (rank(c.level) > rank(L.netMax)) return deny('net_level', 'Internet access is limited to ' + L.netMax + ' here.')
    if (c.domain === undefined) return allow()
    if (L.netMax === 'off' || c.level === 'off') return deny('net_off', 'Internet access is off.')
    if (c.level === 'full' && L.netMax === 'full') return allow()
    return onList(String(c.domain).toLowerCase(), L.allowlist) ? allow() : deny('domain_not_allowed', 'That site is not on the allowlist.')
  },
  'ssh.use' (u, c, L) {
    if (!hasRole(u, ['owner', 'admin', 'teacher', 'member'])) return deny('role', 'This role cannot use SSH.')
    return L.ssh ? allow() : deny('ssh_off', 'SSH is off for this organization.')
  },
  'run.command' (u, c, L) {
    if (!hasRole(u, AGENT_USERS)) return deny('role', 'This role cannot run commands.')
    if (!['sandbox', 'remote', 'ssh'].includes(c.runner)) return deny('bad_runner', 'Unknown place to run.')
    if (isStudent(u) && c.runner !== 'sandbox') return deny('runner_student', 'Students run only in the sandbox.')
    if (c.runner === 'ssh' && !L.ssh) return deny('ssh_off', 'SSH is off for this organization.')
    return L.run ? allow() : deny('run_off', 'Running commands is off here.')
  },
  'share.create' (u, c, L) {
    const S = L.policy.sharing
    if (!hasRole(u, ['owner', 'admin', 'teacher', 'member', 'student'])) return deny('role', 'This role cannot create share links.')
    if (!['view', 'edit'].includes(c.role)) return deny('bad_role', 'A link is view or edit.')
    if (c.leavesOrg !== true && c.leavesOrg !== false) return deny('bad_context', 'Say whether the link leaves the organization.')
    if (isStudent(u)) {
      const cls = (c.classId ? [c.classId] : u.classIds).map(id => L.policy.classes[id])
      if (!cls.length || !cls.every(x => x && x.allowShare)) return deny('student_share', 'The teacher has not turned sharing on.')
      if (c.leavesOrg) return deny('student_external', 'Students cannot share outside the school.')
      return allow()
    }
    if (S.who === 'nobody') return deny('share_off', 'Sharing is off for this organization.')
    if (S.who === 'staff' && !hasRole(u, STAFF)) return deny('share_staff', 'Only owners and admins may create links.')
    if (c.leavesOrg) {
      if (isMinor(u)) return deny('minor_external', 'Minors cannot share outside the organization.')
      if (!S.allowExternal) return deny('external_off', 'Links may not leave this organization.')
      if (c.role === 'edit' && S.externalMaxRole !== 'edit') return deny('external_view_only', 'Outside links are view-only here.')
    }
    return allow()
  },
  'share.join' (u, c, L) { // a signed-in person opens a share link; ctx.linkOrgId is the org that owns the link
    if (hasRole(u, ['guardian', 'manager'])) return deny('role', 'This role cannot join workspaces by link.')
    if (isMinor(u) && c.linkOrgId !== u.orgId) return deny('minor_external', 'Minors cannot join outside links.')
    return allow()
  },
  'friends.request' (u, c, L) {
    if (isMinor(u) || isStudent(u)) return deny('minor_social', 'Friends are off for minors and students.')
    if (hasRole(u, ['guardian', 'manager', 'guest'])) return deny('role', 'This role cannot make friends.')
    if (isMinor(c.target || { ageBand: 'under13' })) return deny('minor_social', 'Friends are off for minors.')
    if (!isObj(c.target) || c.target.orgId !== u.orgId) return deny('cross_org', 'The person belongs to a different organization.') // a target with no org is refused, not assumed to be ours
    return L.policy.friends ? allow() : deny('friends_off', 'Friends are off for this organization.')
  },
  'dm.send' (u, c, L) {
    if (isMinor(u) || isStudent(u)) return deny('minor_social', 'Direct messages are off for minors and students.')
    if (!isObj(c.target) || !AGE_BANDS.includes(c.target.ageBand)) return deny('bad_target', 'Unknown recipient.')
    if (isMinor(c.target)) return deny('minor_social', 'Adults cannot send direct messages to minors.')
    if (c.target.orgId !== u.orgId) return deny('cross_org', 'The person belongs to a different organization.') // a recipient with no org is refused, not assumed to be ours
    if (hasRole(u, ['guardian', 'guest'])) return deny('role', 'This role cannot send direct messages.')
    return L.policy.friends ? allow() : deny('friends_off', 'Direct messages are off for this organization.')
  },
  'chat.view_agent' (u, c, L) { // a student's conversations with the agent
    const t = c.target
    if (!isObj(t) || typeof t.id !== 'string') return deny('bad_target', 'Name the student.')
    if (t.id === u.id) return allow('self', 'Your own conversations.')
    if (t.orgId !== u.orgId) return deny('cross_org', 'Different organization.')
    const seen = ['show_notice_to_student', 'record_in_audit']
    if (hasRole(u, ['teacher']) && sameClass(u, t)) return allow('teacher', 'Teacher of this student.', seen)
    if (hasRole(u, STAFF) && L.policy.adminsSeeStudentChats) return allow('staff', 'Owner or admin.', seen)
    if (hasRole(u, ['guardian']) && L.policy.guardianAccess && (u.guardianOf || []).includes(t.id)) return allow('guardian', 'Guardian of this student.', seen)
    return deny('not_your_student', 'You cannot see this student\'s conversations.')
  },
  'student.progress.view' (u, c, L) {
    const t = c.target
    if (!isObj(t) || typeof t.id !== 'string') return deny('bad_target', 'Name the student.')
    if (t.id === u.id) return allow('self')
    if (t.orgId !== u.orgId) return deny('cross_org', 'Different organization.')
    if (hasRole(u, ['teacher']) && sameClass(u, t)) return allow('teacher')
    if (hasRole(u, STAFF)) return allow('staff')
    if (hasRole(u, ['guardian']) && L.policy.guardianAccess && (u.guardianOf || []).includes(t.id)) return allow('guardian')
    return deny('not_your_student', 'You cannot see this student.')
  },
  'history.view' (u, c) {
    if (['private_chat', 'consensus_private'].includes(c.kind)) return deny('private', 'Private conversations are never in the log (R24).')
    if (hasRole(u, ['owner', 'admin', 'manager'])) return allow()
    if (hasRole(u, ['teacher'])) return inOwnClass(u, c.classId) ? allow() : deny('not_your_class', 'Only your own classes.')
    if (isStudent(u) || hasRole(u, ['member'])) return c.target?.id === u.id ? allow('self') : deny('own_only', 'You see your own activity only.')
    return deny('role', 'This role cannot open History.')
  },
  'audit.export' (u) { return hasRole(u, ['owner', 'admin', 'manager']) ? allow('ok', 'allowed', ['record_in_audit']) : deny('role', 'Only owners, admins and managers export the log.') },
  'audit.verify' (u) { return hasRole(u, ['owner', 'admin', 'manager']) ? allow() : deny('role', 'Only owners, admins and managers verify the log.') },
  'org.member.list' (u, c) {
    if (hasRole(u, ['owner', 'admin', 'manager'])) return allow()
    return hasRole(u, ['teacher']) && inOwnClass(u, c.classId) ? allow() : deny('role', 'You cannot list these people.')
  },
  'member.invite' (u, c) {
    if (c.role === 'owner' && !hasRole(u, ['owner'])) return deny('owner_only', 'Only an owner adds an owner.')
    if (c.role === 'admin' && !hasRole(u, ['owner'])) return deny('owner_only', 'Only an owner adds an admin.') // same rule as member.role.set; admins do not manage admins
    if (hasRole(u, STAFF)) return ROLES.includes(c.role) ? allow() : deny('bad_role', 'Unknown role.')
    if (hasRole(u, ['teacher']) && c.role === 'student' && !c.viaDomain && inOwnClass(u, c.classId)) return allow()
    return deny('role', 'You cannot invite people.')
  },
  'member.role.set' (u, c) {
    const t = c.target
    if (!hasRole(u, STAFF)) return deny('role', 'Only owners and admins change roles.')
    if (!isObj(t) || !Array.isArray(t.roles) || !ROLES.includes(c.newRole)) return deny('bad_target', 'Name the person and the new role.')
    if (t.id === u.id) return deny('self_role_change', 'You cannot change your own role.')
    if (!hasRole(u, ['owner']) && (t.roles.includes('owner') || c.newRole === 'owner' || c.newRole === 'admin' || t.roles.includes('admin'))) return deny('owner_only', 'Only an owner changes owners and admins.')
    return allow('ok', 'allowed', ['record_in_audit'])
  },
  'policy.set' (u, c) {
    if (hasRole(u, STAFF)) return allow('ok', 'allowed', ['record_in_audit'])
    if (hasRole(u, ['teacher']) && c.scope === 'class' && inOwnClass(u, c.classId)) return allow('class_only', 'A teacher sets only their own class (narrowing only).', ['record_in_audit'])
    return deny('role', 'You cannot change policy.')
  },
  'retention.set' (u) { return hasRole(u, STAFF) ? allow('ok', 'allowed', ['record_in_audit']) : deny('role', 'Only owners and admins set retention.') },
  'data.delete.request' (u, c) {
    const t = c.target
    if (!isObj(t) || typeof t.id !== 'string') return deny('bad_target', 'Name the person.')
    if (t.id === u.id) return allow('self', 'Your own data.', ['record_in_audit'])
    if (t.orgId !== u.orgId) return deny('cross_org', 'Different organization.')
    if (hasRole(u, STAFF)) return allow('staff', 'Owner or admin.', ['record_in_audit'])
    if (hasRole(u, ['guardian']) && (u.guardianOf || []).includes(t.id)) return allow('guardian', 'Guardian of this student.', ['record_in_audit'])
    return deny('role', 'You cannot ask for this deletion.')
  },
  'template.assign' (u, c) {
    if (hasRole(u, STAFF)) return allow()
    return hasRole(u, ['teacher']) && inOwnClass(u, c.classId) ? allow() : deny('role', 'Only a teacher of the class assigns templates.')
  },
  'template.manage' (u, c) { return H['template.assign'](u, c) },
  // The explorer (create, rename, delete a file or folder). Guests and the read-only roles (manager, guardian) never change files.
  // Students may add and rename their own work but not delete: deleting is a choice for the teacher or the person's own account (decision open for the team).
  'file.create' (u) { return hasRole(u, AGENT_USERS) ? allow() : deny('role', 'This role cannot add files.') },
  'file.rename' (u) { return hasRole(u, AGENT_USERS) ? allow() : deny('role', 'This role cannot rename files.') },
  'file.delete' (u) {
    if (isStudent(u)) return deny('student_delete', 'Students cannot delete files.')
    return hasRole(u, ['owner', 'admin', 'teacher', 'member']) ? allow() : deny('role', 'This role cannot delete files.')
  },
  // The first answer to an approval card decides it (any writer can answer today). Only staff, teachers and adults decide; a student never does.
  'approval.decide' (u) {
    if (isStudent(u)) return deny('student_approval', 'Students do not decide approvals.')
    return hasRole(u, ['owner', 'admin', 'teacher', 'member']) ? allow() : deny('role', 'This role cannot decide approvals.')
  },
  // A GitHub skill (a pinned repository's instructions) comes into the workspace only with a yes from an adult who may decide. Minors and students never install one.
  'skill.github.install' (u) {
    if (isMinor(u) || isStudent(u)) return deny('minor_skill', 'Minors and students cannot install skills from GitHub.')
    return hasRole(u, ['owner', 'admin', 'teacher', 'member']) ? allow() : deny('role', 'This role cannot install skills.')
  }
}
export const ACTIONS = Object.freeze(Object.keys(H))

// Actions an individual (no organization) may do for themselves; everything else is an organization feature.
const INDIVIDUAL = new Set(['agent.mode.use', 'agent.mode.set', 'model.use', 'tokens.spend', 'net.access', 'ssh.use', 'run.command', 'share.create', 'share.join', 'friends.request', 'dm.send', 'data.delete.request', 'history.view', 'file.create', 'file.rename', 'file.delete', 'approval.decide', 'skill.github.install'])
const INDIVIDUAL_POLICY = Object.freeze({ modes: [...MODES], net: { max: 'full' }, ssh: true, friends: true, sharing: { who: 'members', allowExternal: true, externalMaxRole: 'edit' } })

export function can (user, action, context = {}) {
  try { return decide(user, action, context) } catch { return deny('policy_error', 'The check failed, so the answer is no.') } // never throws: an error is a no
}

function decide (user, action, context) {
  if (!validUser(user)) return deny('bad_user', 'Unknown or inconsistent user record.')
  if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(H, action)) return deny('unknown_action', 'Nothing allows this action.')
  const c = isObj(context) ? context : {}
  let org = null
  if (user.orgId === null) {
    if (c.org) return deny('cross_org', 'An individual account cannot act inside an organization.')
    if (!INDIVIDUAL.has(action)) return deny('needs_org', 'This is an organization feature.')
    if (user.ageBand === 'under13') return deny('minor_needs_school', 'Children under 13 use VESPR only through a school.')
    org = { id: null, policy: INDIVIDUAL_POLICY }
  } else {
    if (!isObj(c.org) || typeof c.org.id !== 'string') return deny('no_org_context', 'The organization policy was not supplied.')
    if (c.org.id !== user.orgId) return deny('cross_org', 'This belongs to a different organization.')
    org = c.org
  }
  if (isObj(c.target) && c.target.orgId !== undefined && c.target.orgId !== user.orgId && !['share.join'].includes(action)) return deny('cross_org', 'The person belongs to a different organization.')
  if (c.classId !== undefined && isStudent(user) && !inOwnClass(user, c.classId)) return deny('not_in_class', 'You are not in that class.')
  let L
  try { L = user.orgId === null ? effectiveIndividual(user) : effectiveLimits(user, org, c.classId) } catch { return deny('policy_error', 'The policy could not be read.') }
  try { return H[action](user, c, L) } catch { return deny('policy_error', 'The check failed, so the answer is no.') }
}

function effectiveIndividual (user) {
  const minor = isMinor(user)
  return {
    modes: MODES.filter(m => !(minor && m === 'bypass')),
    models: null,
    netMax: minor ? 'allowlist' : 'full',
    allowlist: DEFAULT_ALLOWLIST,
    tokenCap: null,
    run: true,
    ssh: !minor,
    policy: { ...normalizePolicy({}), friends: true, sharing: { who: 'members', allowExternal: !minor, externalMaxRole: 'edit' } }
  }
}


export const TIER_GOVERNANCE = Object.freeze({
  free: {
    tier: 'free',
    ads: true,
    domainLock: false,
    allowExternalViewers: true,
    zeroDataRetention: false,
    trainingDataRetention: true,
    enterpriseSSO: false
  },
  corporate_free: {
    tier: 'corporate_free',
    ads: true,
    domainLock: false,
    allowExternalViewers: true,
    zeroDataRetention: false,
    trainingDataRetention: true,
    enterpriseSSO: false
  },
  pro: {
    tier: 'pro',
    ads: false,
    domainLock: false,
    allowExternalViewers: true,
    zeroDataRetention: true,
    trainingDataRetention: false,
    enterpriseSSO: false
  },
  corporate_paid: {
    tier: 'corporate_paid',
    ads: false,
    domainLock: true,
    allowExternalViewers: false,
    zeroDataRetention: true,
    trainingDataRetention: false,
    enterpriseSSO: true
  },
  enterprise: {
    tier: 'enterprise',
    ads: false,
    domainLock: true,
    allowExternalViewers: false,
    zeroDataRetention: true,
    trainingDataRetention: false,
    enterpriseSSO: true
  }
})

export function getTierGovernance (tierOrPlan = 'free', { isCorporate = false } = {}) {
  const norm = String(tierOrPlan || 'free').trim().toLowerCase()
  if (norm === 'enterprise' || (isCorporate && ['paid', 'pro', 'enterprise', 'teams'].includes(norm))) {
    return TIER_GOVERNANCE.enterprise
  }
  if (norm === 'pro' || norm === 'teams') {
    return isCorporate ? TIER_GOVERNANCE.corporate_paid : TIER_GOVERNANCE.pro
  }
  if (isCorporate || norm === 'corporate_free') {
    return TIER_GOVERNANCE.corporate_free
  }
  return TIER_GOVERNANCE.free
}
