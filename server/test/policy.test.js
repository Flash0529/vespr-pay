// Tests for server/policy.js: deny by default, role matrix, minors, cross-org isolation, links leaving the org, budget caps.
import assert from 'node:assert'
import { can, effectiveLimits, normalizePolicy, validUser, ROLES, MODES as OUR_MODES, ACTIONS, STUDENT_MODES, TIER_GOVERNANCE, getTierGovernance } from '../policy.js'
import { MODES as AGENT_MODES } from '../../agents/src/policy.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const A = (r, why) => assert.strictEqual(r.allow, true, why + ' -> ' + JSON.stringify(r))
const D = (r, why, code) => { assert.strictEqual(r.allow, false, why + ' -> ' + JSON.stringify(r)); if (code) assert.strictEqual(r.code, code, why + ' -> ' + JSON.stringify(r)) }

const ORG = { id: 'org1', policy: { models: ['nemotron-super', 'nemotron-nano'], classes: { c1: { models: ['nemotron-nano'], netMax: 'allowlist', allowRun: true, allowShare: false, tokenDaily: 5000 } } } }
const OTHER = { id: 'org2', policy: {} }
const user = (roles, extra = {}) => ({ id: roles[0] + '1', orgId: 'org1', roles, ageBand: 'adult', classIds: [], ...extra })
const student = (extra = {}) => user(['student'], { id: 'stu1', ageBand: '13-17', classIds: ['c1'], ...extra })
const ctx = (extra = {}) => ({ org: ORG, ...extra })

t('agents and policy use the same mode names', () => assert.deepStrictEqual([...OUR_MODES], [...AGENT_MODES]))

// ---- deny by default ----
t('unknown action denied', () => D(can(user(['owner']), 'nope', ctx()), 'unknown', 'unknown_action'))
t('prototype names denied', () => { for (const a of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) D(can(user(['owner']), a, ctx()), a, 'unknown_action') })
t('non-string action denied', () => { for (const a of [undefined, null, 5, {}, []]) D(can(user(['owner']), a, ctx()), String(a), 'unknown_action') })
t('malformed users denied', () => {
  for (const u of [null, undefined, {}, 'x', { id: 'a' }, { ...user(['owner']), roles: [] }, { ...user(['owner']), roles: ['root'] }, { ...user(['owner']), ageBand: 'child' }, { ...user(['owner']), classIds: 'c1' }, { ...user(['owner']), id: '' }]) {
    D(can(u, 'history.view', ctx()), JSON.stringify(u), 'bad_user')
  }
})
t('a student cannot also hold staff roles', () => { for (const r of ['owner', 'admin', 'manager', 'teacher', 'member']) assert.strictEqual(validUser(user(['student', r], { classIds: ['c1'] })), false) })
t('a guardian cannot be a student or a minor', () => { assert.strictEqual(validUser(user(['guardian', 'admin'])), false); assert.strictEqual(validUser(user(['guardian'], { ageBand: '13-17' })), false) })
t('missing org context denies instead of guessing', () => { D(can(user(['owner']), 'audit.export', {}), 'no ctx', 'no_org_context'); D(can(user(['owner']), 'audit.export', { org: {} }), 'bad ctx', 'no_org_context') })
t('a throwing context is a no', () => { const bad = { get org () { throw new Error('boom') } }; assert.strictEqual(can(user(['owner']), 'audit.export', bad).allow, false) })
t('every action refuses an empty-role-set stranger', () => { for (const a of ACTIONS) assert.strictEqual(can({ id: 'x', orgId: 'org1', roles: [], ageBand: 'adult', classIds: [] }, a, ctx()).allow, false) })
t('guest can do nothing in the table', () => {
  const g = user(['guest'])
  for (const a of ACTIONS) { if (a === 'share.join') continue; if (a === 'data.delete.request') continue; D(can(g, a, ctx({ mode: 'manual', model: 'nemotron-nano', tokens: 1, used: 0, level: 'off', runner: 'sandbox', role: 'view', leavesOrg: false, target: { id: 'x', orgId: 'org1', ageBand: 'adult', roles: ['member'], classIds: [] }, newRole: 'member', scope: 'class' })), 'guest ' + a) }
})

// ---- role matrix (action, then which roles may, in an ordinary adult org) ----
const MATRIX = [
  ['audit.export', {}, ['owner', 'admin', 'manager']],
  ['audit.verify', {}, ['owner', 'admin', 'manager']],
  ['retention.set', {}, ['owner', 'admin']],
  ['policy.set', { scope: 'org' }, ['owner', 'admin']],
  ['agent.mode.use', { mode: 'manual' }, ['owner', 'admin', 'teacher', 'member']],
  ['model.use', { model: 'nemotron-super' }, ['owner', 'admin', 'teacher', 'member']],
  ['run.command', { runner: 'sandbox' }, ['owner', 'admin', 'teacher', 'member']],
  ['org.member.list', {}, ['owner', 'admin', 'manager']],
  ['member.invite', { role: 'member' }, ['owner', 'admin']],
  ['template.assign', {}, ['owner', 'admin']],
  ['history.view', {}, ['owner', 'admin', 'manager']]
]
for (const [action, extra, yes] of MATRIX) {
  t('matrix ' + action, () => {
    for (const r of ROLES) {
      if (r === 'student' && ['agent.mode.use', 'model.use', 'run.command'].includes(action)) continue // students use these under class rules: tested below
      if (r === 'student' || r === 'guardian') { // different age or exclusivity rules: covered below
        D(can(user([r], r === 'student' ? { classIds: ['c1'] } : {}), action, ctx(extra)), r + ' ' + action)
        continue
      }
      const res = can(user([r]), action, ctx(extra))
      assert.strictEqual(res.allow, yes.includes(r), r + ' ' + action + ' ' + JSON.stringify(res))
    }
  })
}
t('manager is read-only: sees History and the roster, changes nothing', () => {
  const m = user(['manager'])
  A(can(m, 'history.view', ctx()), 'history'); A(can(m, 'org.member.list', ctx()), 'roster'); A(can(m, 'audit.export', ctx()), 'export')
  for (const a of ['policy.set', 'member.role.set', 'member.invite', 'retention.set', 'agent.mode.set', 'run.command', 'share.create']) D(can(m, a, ctx({ scope: 'org', role: 'member', newRole: 'admin', target: { id: 'q', orgId: 'org1', roles: ['member'] }, mode: 'manual', runner: 'sandbox', leavesOrg: false })), 'manager ' + a)
})
t('manager never sees private chats or consensus check-ins (R24)', () => { for (const k of ['private_chat', 'consensus_private']) for (const r of ROLES) D(can(user([r], r === 'student' ? { classIds: ['c1'] } : {}), 'history.view', ctx({ kind: k, classId: 'c1' })), r + ' ' + k, r === 'guest' || r === 'guardian' ? undefined : 'private') })
t('history for teachers is limited to their own classes', () => {
  const tch = user(['teacher'], { classIds: ['c1'] })
  A(can(tch, 'history.view', ctx({ classId: 'c1' })), 'own'); D(can(tch, 'history.view', ctx({ classId: 'c9' })), 'other', 'not_your_class'); D(can(tch, 'history.view', ctx()), 'no class', 'not_your_class')
})
t('members and students see only their own history', () => {
  const m = user(['member']); A(can(m, 'history.view', ctx({ target: { id: m.id } })), 'self'); D(can(m, 'history.view', ctx({ target: { id: 'someone' } })), 'other', 'own_only')
  const s = student(); A(can(s, 'history.view', ctx({ target: { id: s.id } })), 'self'); D(can(s, 'history.view', ctx({ target: { id: 'x' } })), 'other', 'own_only')
})
t('role changes: owner yes, admin limited, never yourself', () => {
  const tgt = { id: 'p', orgId: 'org1', roles: ['member'] }; const owner = user(['owner']); const admin = user(['admin'])
  A(can(owner, 'member.role.set', ctx({ target: tgt, newRole: 'admin' })), 'owner makes admin')
  A(can(admin, 'member.role.set', ctx({ target: tgt, newRole: 'teacher' })), 'admin makes teacher')
  D(can(admin, 'member.role.set', ctx({ target: tgt, newRole: 'owner' })), 'admin makes owner', 'owner_only')
  D(can(admin, 'member.role.set', ctx({ target: tgt, newRole: 'admin' })), 'admin makes admin', 'owner_only')
  D(can(admin, 'member.role.set', ctx({ target: { ...tgt, roles: ['owner'] }, newRole: 'member' })), 'admin demotes owner', 'owner_only')
  D(can(owner, 'member.role.set', ctx({ target: { ...tgt, id: owner.id }, newRole: 'member' })), 'self', 'self_role_change')
  D(can(owner, 'member.role.set', ctx({ target: tgt, newRole: 'root' })), 'bad role', 'bad_target')
})
t('invites: teacher invites students to own class only, never by domain or as staff', () => {
  const tch = user(['teacher'], { classIds: ['c1'] })
  A(can(tch, 'member.invite', ctx({ role: 'student', classId: 'c1' })), 'own class'); D(can(tch, 'member.invite', ctx({ role: 'student', classId: 'c2' })), 'other class')
  D(can(tch, 'member.invite', ctx({ role: 'teacher', classId: 'c1' })), 'teacher role'); D(can(tch, 'member.invite', ctx({ role: 'student', classId: 'c1', viaDomain: true })), 'domain')
  D(can(user(['admin']), 'member.invite', ctx({ role: 'owner' })), 'admin adds owner', 'owner_only'); A(can(user(['owner']), 'member.invite', ctx({ role: 'owner' })), 'owner adds owner')
})
t('templates: a teacher assigns in own class only', () => {
  const tch = user(['teacher'], { classIds: ['c1'] })
  A(can(tch, 'template.assign', ctx({ classId: 'c1' })), 'own'); D(can(tch, 'template.assign', ctx({ classId: 'c2' })), 'other'); D(can(student(), 'template.assign', ctx({ classId: 'c1' })), 'student')
})
t('teacher may edit policy only for the own class', () => {
  const tch = user(['teacher'], { classIds: ['c1'] })
  A(can(tch, 'policy.set', ctx({ scope: 'class', classId: 'c1' })), 'own'); D(can(tch, 'policy.set', ctx({ scope: 'class', classId: 'c2' })), 'other'); D(can(tch, 'policy.set', ctx({ scope: 'org' })), 'org')
})

// ---- agent modes ----
t('student modes: manual and plan only, never bypass', () => {
  const s = student(); const lim = effectiveLimits(s, ORG)
  assert.deepStrictEqual([...lim.modes].sort(), ['manual', 'plan'])
  for (const m of OUR_MODES) assert.strictEqual(can(s, 'agent.mode.use', ctx({ mode: m, classId: 'c1' })).allow, ['manual', 'plan'].includes(m), m)
})
t('an org that lists bypass still cannot give it to students or minors', () => {
  const org = { id: 'org1', policy: { modes: OUR_MODES } }
  D(can(student(), 'agent.mode.set', { org, mode: 'bypass' }), 'student'); D(can(user(['member'], { ageBand: '13-17' }), 'agent.mode.use', { org, mode: 'bypass' }), '13-17 member'); D(can(user(['member'], { ageBand: 'under13' }), 'agent.mode.use', { org, mode: 'bypass' }), 'under 13 member')
  A(can(user(['member']), 'agent.mode.use', { org, mode: 'bypass' }), 'adult member when the org opted in')
})
t('bypass is off by default for adults in an org', () => D(can(user(['member']), 'agent.mode.use', ctx({ mode: 'bypass' })), 'default', 'mode_not_allowed'))
t('a class can narrow modes but not widen them', () => {
  const org = { id: 'org1', policy: { modes: ['manual', 'plan', 'auto'], classes: { c1: { modes: ['plan'] } } } }
  const tch = user(['teacher'], { classIds: ['c1'] })
  A(can(tch, 'agent.mode.use', { org, mode: 'plan', classId: 'c1' }), 'plan'); D(can(tch, 'agent.mode.use', { org, mode: 'auto', classId: 'c1' }), 'auto')
  const wide = { id: 'org1', policy: { modes: ['manual'], classes: { c1: { modes: ['manual', 'bypass', 'auto'] } } } }
  D(can(tch, 'agent.mode.use', { org: wide, mode: 'bypass', classId: 'c1' }), 'widen'); D(can(tch, 'agent.mode.use', { org: wide, mode: 'auto', classId: 'c1' }), 'widen2')
})
t('unknown mode denied', () => D(can(user(['owner']), 'agent.mode.use', ctx({ mode: 'yolo' })), 'yolo', 'bad_mode'))
t('a student with several classes gets the strictest', () => {
  const org = { id: 'org1', policy: { classes: { c1: { models: ['a', 'b'], allowRun: true }, c2: { models: ['b'], allowRun: false } } } }
  const s = student({ classIds: ['c1', 'c2'] }); const lim = effectiveLimits(s, org)
  assert.deepStrictEqual(lim.models, ['b']); assert.strictEqual(lim.run, false)
})
t('a student cannot name a class they are not in', () => D(can(student(), 'agent.mode.use', ctx({ mode: 'manual', classId: 'c2' })), 'other class', 'not_in_class'))

// ---- models and budgets ----
t('models: org list and class list intersect', () => {
  const s = student(); A(can(s, 'model.use', ctx({ model: 'nemotron-nano', classId: 'c1' })), 'class model')
  D(can(s, 'model.use', ctx({ model: 'nemotron-super', classId: 'c1' })), 'org-only model', 'model_not_allowed'); D(can(s, 'model.use', ctx({ model: 'other', classId: 'c1' })), 'other')
  A(can(user(['member']), 'model.use', ctx({ model: 'nemotron-super' })), 'adult in org list'); D(can(user(['member']), 'model.use', ctx({ model: 'other-x' })), 'not in list')
})
t('a student has no model until one is named', () => { const org = { id: 'org1', policy: {} }; D(can(student(), 'model.use', { org, model: 'anything' }), 'none named', 'model_not_allowed'); A(can(user(['member']), 'model.use', { org, model: 'anything' }), 'adult any') })
t('budget caps: exact edge, over, class cap, per-user, default for students', () => {
  const s = student()
  A(can(s, 'tokens.spend', ctx({ classId: 'c1', used: 4000, tokens: 1000 })), 'exactly the cap'); D(can(s, 'tokens.spend', ctx({ classId: 'c1', used: 4000, tokens: 1001 })), 'one over', 'budget')
  const org = { id: 'org1', policy: { tokenBudgets: { userDaily: 100000, perUser: { stu1: 700 } }, classes: { c1: { tokenDaily: 5000 } } } }
  D(can(s, 'tokens.spend', { org, used: 600, tokens: 101 }), 'per-user cap wins', 'budget'); A(can(s, 'tokens.spend', { org, used: 600, tokens: 100 }), 'per-user edge')
  const bare = { id: 'org1', policy: { classes: { c1: {} } } }
  A(can(s, 'tokens.spend', { org: bare, used: 0, tokens: 20000 }), 'default student cap edge'); D(can(s, 'tokens.spend', { org: bare, used: 0, tokens: 20001 }), 'default student cap over', 'budget')
  A(can(user(['member']), 'tokens.spend', ctx({ used: 1e9, tokens: 1e9 })), 'adults have no cap unless set')
  D(can(user(['member']), 'tokens.spend', { org: { id: 'org1', policy: { tokenBudgets: { userDaily: 10 } } }, used: 5, tokens: 6 }), 'org daily', 'budget')
})
t('budget amounts must be whole non-negative numbers', () => { for (const bad of [-1, 1.5, NaN, '5', null, Infinity]) { D(can(user(['member']), 'tokens.spend', ctx({ used: 0, tokens: bad })), 'tokens ' + bad, 'bad_amount'); D(can(user(['member']), 'tokens.spend', ctx({ used: bad, tokens: 1 })), 'used ' + bad, 'bad_amount') } })

// ---- internet ----
t('internet: students Off unless the class allows Allowlist; never Full', () => {
  const s = student(); const lim = effectiveLimits(s, ORG, 'c1'); assert.strictEqual(lim.netMax, 'allowlist')
  A(can(s, 'net.access', ctx({ classId: 'c1', level: 'allowlist', domain: 'github.com' })), 'allowlisted'); A(can(s, 'net.access', ctx({ classId: 'c1', level: 'allowlist', domain: 'api.github.com' })), 'subdomain')
  D(can(s, 'net.access', ctx({ classId: 'c1', level: 'allowlist', domain: 'evilgithub.com' })), 'suffix trick', 'domain_not_allowed'); D(can(s, 'net.access', ctx({ classId: 'c1', level: 'full' })), 'full', 'net_level')
  const noNet = { id: 'org1', policy: { classes: { c1: {} } } }; D(can(s, 'net.access', { org: noNet, level: 'allowlist' }), 'class never opened net', 'net_level'); A(can(s, 'net.access', { org: noNet, level: 'off' }), 'off is fine')
})
t('a teacher cannot raise a class above the org maximum', () => {
  const org = { id: 'org1', policy: { net: { max: 'off' }, classes: { c1: { netMax: 'full' } } } }; assert.strictEqual(effectiveLimits(student(), org).netMax, 'off')
})
t('minors never get Full even when the org allows it', () => {
  const org = { id: 'org1', policy: { net: { max: 'full' } } }
  D(can(user(['member'], { ageBand: '13-17' }), 'net.access', { org, level: 'full' }), 'minor full', 'net_level'); A(can(user(['member']), 'net.access', { org, level: 'full', domain: 'example.com' }), 'adult full any domain')
  D(can(user(['member']), 'net.access', { org, level: 'allowlist', domain: 'example.com' }), 'adult allowlist off-list', 'domain_not_allowed')
})
t('net off blocks every domain', () => D(can(user(['member']), 'net.access', { org: { id: 'org1', policy: { net: { max: 'off' } } }, level: 'off', domain: 'github.com' }), 'off', 'net_off'))
t('bad internet level', () => D(can(user(['member']), 'net.access', ctx({ level: 'wide' })), 'bad', 'bad_level'))

// ---- ssh and run ----
t('ssh: off by default, never for students or minors even if on', () => {
  D(can(user(['member']), 'ssh.use', ctx()), 'default', 'ssh_off'); const on = { id: 'org1', policy: { ssh: true } }
  A(can(user(['member']), 'ssh.use', { org: on }), 'adult when on'); D(can(student(), 'ssh.use', { org: on }), 'student'); D(can(user(['member'], { ageBand: '13-17' }), 'ssh.use', { org: on }), 'minor member'); D(can(user(['guest']), 'ssh.use', { org: on }), 'guest')
})
t('run: students only in the sandbox and only when the class allows it', () => {
  const s = student()
  A(can(s, 'run.command', ctx({ classId: 'c1', runner: 'sandbox' })), 'class allows'); D(can(s, 'run.command', ctx({ classId: 'c1', runner: 'remote' })), 'remote', 'runner_student')
  D(can(s, 'run.command', { org: { id: 'org1', policy: { classes: { c1: {} } } }, runner: 'sandbox' }), 'class did not allow', 'run_off'); D(can(s, 'run.command', { org: { id: 'org1', policy: { run: false, classes: { c1: { allowRun: true } } } }, runner: 'sandbox' }), 'org run off')
  D(can(student({ classIds: [] }), 'run.command', ctx({ runner: 'sandbox' })), 'no class')
  D(can(user(['member']), 'run.command', ctx({ runner: 'ssh' })), 'ssh off', 'ssh_off'); D(can(user(['member']), 'run.command', ctx({ runner: 'moon' })), 'bad runner', 'bad_runner')
})

// ---- sharing and links leaving the org ----
t('share: members yes, links stay inside by default', () => {
  const m = user(['member']); A(can(m, 'share.create', ctx({ role: 'view', leavesOrg: false })), 'inside')
  D(can(m, 'share.create', ctx({ role: 'view', leavesOrg: true })), 'leaves', 'external_off'); D(can(m, 'share.create', ctx({ role: 'view' })), 'unsaid', 'bad_context')
})
t('share: external only when allowed, view-only unless the org says edit', () => {
  const m = user(['member']); const ext = { id: 'org1', policy: { sharing: { allowExternal: true } } }; const extEdit = { id: 'org1', policy: { sharing: { allowExternal: true, externalMaxRole: 'edit' } } }
  A(can(m, 'share.create', { org: ext, role: 'view', leavesOrg: true }), 'view out'); D(can(m, 'share.create', { org: ext, role: 'edit', leavesOrg: true }), 'edit out', 'external_view_only'); A(can(m, 'share.create', { org: extEdit, role: 'edit', leavesOrg: true }), 'edit out allowed')
})
t('share: who may create', () => {
  const nobody = { id: 'org1', policy: { sharing: { who: 'nobody' } } }; const staff = { id: 'org1', policy: { sharing: { who: 'staff' } } }
  D(can(user(['owner']), 'share.create', { org: nobody, role: 'view', leavesOrg: false }), 'nobody', 'share_off'); D(can(user(['member']), 'share.create', { org: staff, role: 'view', leavesOrg: false }), 'staff only', 'share_staff'); A(can(user(['admin']), 'share.create', { org: staff, role: 'view', leavesOrg: false }), 'admin')
  for (const r of ['manager', 'guardian', 'guest']) D(can(user([r]), 'share.create', ctx({ role: 'view', leavesOrg: false })), r)
})
t('share: minors and students never leave the org; students need the teacher', () => {
  const ext = { id: 'org1', policy: { sharing: { allowExternal: true }, classes: { c1: { allowShare: true } } } }
  D(can(user(['member'], { ageBand: '13-17' }), 'share.create', { org: ext, role: 'view', leavesOrg: true }), 'minor out', 'minor_external')
  D(can(student(), 'share.create', { org: ext, role: 'view', leavesOrg: true }), 'student out', 'student_external'); A(can(student(), 'share.create', { org: ext, role: 'view', leavesOrg: false }), 'student in, teacher allowed')
  D(can(student(), 'share.create', ctx({ role: 'view', leavesOrg: false })), 'teacher did not allow', 'student_share')
})
t('joining a link: minors only inside their own org', () => {
  A(can(user(['member']), 'share.join', ctx({ linkOrgId: 'org9' })), 'adult joins out'); D(can(student(), 'share.join', ctx({ linkOrgId: 'org9' })), 'minor joins out', 'minor_external'); A(can(student(), 'share.join', ctx({ linkOrgId: 'org1' })), 'minor joins in')
})

// ---- friends and DMs ----
t('friends and DMs are never available to minors or students', () => {
  const on = { id: 'org1', policy: { friends: true } }
  for (const u of [student(), user(['member'], { ageBand: '13-17' }), user(['member'], { ageBand: 'under13' })]) { D(can(u, 'friends.request', { org: on, target: { ageBand: 'adult' } }), 'friends'); D(can(u, 'dm.send', { org: on, target: { ageBand: 'adult' } }), 'dm') }
})
t('adults cannot DM or befriend minors; org switch applies', () => {
  const on = { id: 'org1', policy: { friends: true } }; const adult = user(['member'])
  D(can(adult, 'dm.send', { org: on, target: { ageBand: '13-17' } }), 'dm minor', 'minor_social'); D(can(adult, 'friends.request', { org: on, target: { ageBand: 'under13' } }), 'friend minor', 'minor_social'); D(can(adult, 'friends.request', { org: on }), 'unknown target')
  A(can(adult, 'dm.send', { org: on, target: { orgId: 'org1', ageBand: 'adult' } }), 'adult to adult'); D(can(adult, 'dm.send', ctx({ target: { orgId: 'org1', ageBand: 'adult' } })), 'org default off', 'friends_off')
})
t('friends and DMs stay inside the organization: a recipient with another or no org is refused', () => {
  const on = { id: 'org1', policy: { friends: true } }; const adult = user(['member'])
  D(can(adult, 'dm.send', { org: on, target: { orgId: 'org2', ageBand: 'adult' } }), 'dm other org', 'cross_org'); D(can(adult, 'dm.send', { org: on, target: { ageBand: 'adult' } }), 'dm no org', 'cross_org')
  D(can(adult, 'friends.request', { org: on, target: { orgId: 'org2', ageBand: 'adult' } }), 'friend other org', 'cross_org'); D(can(adult, 'friends.request', { org: on, target: { ageBand: 'adult' } }), 'friend no org', 'cross_org')
  D(can(adult, 'friends.request', { org: on, target: { orgId: 'org1' } }), 'friend no band', 'minor_social')
})
t('an individual adult has friends; an individual 13-17 does not', () => {
  const i = { id: 'i1', orgId: null, roles: ['member'], ageBand: 'adult', classIds: [] }
  A(can(i, 'friends.request', { target: { orgId: null, ageBand: 'adult' } }), 'adult'); D(can({ ...i, ageBand: '13-17' }, 'friends.request', { target: { orgId: null, ageBand: 'adult' } }), 'teen')
})

// ---- student agent chats: visible to the right adults, with the student told ----
t('teacher sees own-class student chats with the notice obligation', () => {
  const tch = user(['teacher'], { classIds: ['c1'] }); const stu = { id: 'stu1', orgId: 'org1', classIds: ['c1'] }
  const r = can(tch, 'chat.view_agent', ctx({ target: stu })); A(r, 'own'); assert.ok(r.obligations.includes('show_notice_to_student') && r.obligations.includes('record_in_audit'))
  D(can(tch, 'chat.view_agent', ctx({ target: { ...stu, classIds: ['c9'] } })), 'other class', 'not_your_student')
})
t('students see their own chats; peers do not; managers do not', () => {
  const s = student(); A(can(s, 'chat.view_agent', ctx({ target: { id: s.id, orgId: 'org1', classIds: ['c1'] } })), 'self'); D(can(s, 'chat.view_agent', ctx({ target: { id: 'stu2', orgId: 'org1', classIds: ['c1'] } })), 'peer')
  D(can(user(['manager']), 'chat.view_agent', ctx({ target: { id: 'stu1', orgId: 'org1', classIds: ['c1'] } })), 'manager', 'not_your_student')
})
t('admins see student chats only while the org setting is on, with the notice', () => {
  const stu = { id: 'stu1', orgId: 'org1', classIds: ['c1'] }; const r = can(user(['admin']), 'chat.view_agent', ctx({ target: stu })); A(r, 'on'); assert.ok(r.obligations.includes('show_notice_to_student'))
  D(can(user(['admin']), 'chat.view_agent', { org: { id: 'org1', policy: { adminsSeeStudentChats: false } }, target: stu }), 'off')
})
t('guardians: only their child, only when the school turned it on', () => {
  const g = { ...user(['guardian']), guardianOf: ['stu1'] }; const stu = { id: 'stu1', orgId: 'org1', classIds: ['c1'] }; const on = { id: 'org1', policy: { guardianAccess: true } }
  D(can(g, 'student.progress.view', ctx({ target: stu })), 'off by default', 'not_your_student'); A(can(g, 'student.progress.view', { org: on, target: stu }), 'on, own child'); D(can(g, 'student.progress.view', { org: on, target: { ...stu, id: 'stu2' } }), 'other child')
  const r = can(g, 'chat.view_agent', { org: on, target: stu }); A(r, 'chat when on'); assert.ok(r.obligations.includes('show_notice_to_student'))
  D(can(g, 'history.view', { org: on }), 'guardian has no History')
  D(can(g, 'chat.view_agent', ctx({ target: stu })), 'chat when the school has not turned it on', 'not_your_student')
})

// ---- deletion ----
t('deletion: self, guardian of a child, org staff; not teachers or peers', () => {
  const stu = { id: 'stu1', orgId: 'org1' }; const g = { ...user(['guardian']), guardianOf: ['stu1'] }
  A(can(student(), 'data.delete.request', ctx({ target: stu })), 'self'); A(can(g, 'data.delete.request', ctx({ target: stu })), 'guardian'); A(can(user(['admin']), 'data.delete.request', ctx({ target: stu })), 'admin')
  D(can(user(['teacher'], { classIds: ['c1'] }), 'data.delete.request', ctx({ target: stu })), 'teacher'); D(can(user(['member']), 'data.delete.request', ctx({ target: stu })), 'peer'); D(can({ ...g, guardianOf: [] }, 'data.delete.request', ctx({ target: stu })), 'not their child')
})

// ---- cross-org isolation ----
t('a user of org1 gets nothing inside org2, for every action', () => {
  const owner = user(['owner'])
  for (const a of ACTIONS) D(can(owner, a, { org: OTHER, mode: 'manual', model: 'm', tokens: 1, used: 0, level: 'off', runner: 'sandbox', role: 'member', leavesOrg: false, linkOrgId: 'org2', target: { id: 'z', orgId: 'org2', roles: ['member'], ageBand: 'adult', classIds: [] }, newRole: 'member', scope: 'org' }), 'cross ' + a, 'cross_org')
})
t('a target with no org, or in another org, is refused', () => {
  const tch = user(['teacher'], { classIds: ['c1'] }); D(can(tch, 'chat.view_agent', ctx({ target: { id: 'stu1', classIds: ['c1'] } })), 'no orgId on target', 'cross_org')
  D(can(user(['admin']), 'member.role.set', ctx({ target: { id: 'p', orgId: 'org2', roles: ['member'] }, newRole: 'teacher' })), 'role change in another org', 'cross_org')
})
t('a target from another org is refused', () => D(can(user(['teacher'], { classIds: ['c1'] }), 'chat.view_agent', ctx({ target: { id: 'stu1', orgId: 'org2', classIds: ['c1'] } })), 'target other org', 'cross_org'))
t('policy comes from the org given, so org2 settings do not leak into org1', () => {
  const s = { id: 'org2', policy: { sharing: { allowExternal: true } } }; D(can(user(['member']), 'share.create', { org: ORG, role: 'view', leavesOrg: true }), 'org1 default'); D(can({ ...user(['member']), orgId: 'org1' }, 'share.create', { org: s, role: 'view', leavesOrg: true }), 'org2 policy for org1 user', 'cross_org')
})
t('an individual cannot act inside an org and has no org features', () => {
  const i = { id: 'i1', orgId: null, roles: ['member'], ageBand: 'adult', classIds: [] }
  D(can(i, 'run.command', ctx({ runner: 'sandbox' })), 'with org ctx', 'cross_org'); D(can(i, 'audit.export', {}), 'org feature', 'needs_org'); D(can(i, 'policy.set', {}), 'org feature', 'needs_org'); A(can(i, 'run.command', { runner: 'sandbox' }), 'own sandbox')
  A(can(i, 'agent.mode.use', { mode: 'bypass' }), 'own machine, bypass'); D(can({ ...i, ageBand: '13-17' }, 'agent.mode.use', { mode: 'bypass' }), 'teen never bypass')
})
t('children under 13 have no individual account', () => D(can({ id: 'k', orgId: null, roles: ['member'], ageBand: 'under13', classIds: [] }, 'agent.mode.use', { mode: 'manual' }), 'under 13 alone', 'minor_needs_school'))
t('an individual cannot claim org roles', () => assert.strictEqual(validUser({ id: 'x', orgId: null, roles: ['owner'], ageBand: 'adult', classIds: [] }), false))

// ---- policy cleaning ----
t('normalizePolicy replaces junk with safe defaults', () => {
  const p = normalizePolicy({ modes: 'bypass', models: 7, net: { max: 'wide', allowlist: ['ok.com', 'no spaces.com', 5] }, ssh: 'yes', run: 0, sharing: { who: 'everyone', allowExternal: 'true' }, friends: 1, classes: { c1: { allowRun: 'yes', netMax: 'wide', modes: ['bypass', 'zzz'] }, c2: 5 }, tokenBudgets: { userDaily: -5, perUser: { a: 5, b: -1 } } })
  assert.deepStrictEqual(p.modes, ['manual', 'acceptEdits', 'auto', 'plan']); assert.strictEqual(p.models, null); assert.strictEqual(p.net.max, 'allowlist'); assert.deepStrictEqual(p.net.allowlist, ['ok.com'])
  assert.strictEqual(p.ssh, false); assert.strictEqual(p.run, true); assert.strictEqual(p.sharing.who, 'members'); assert.strictEqual(p.sharing.allowExternal, false); assert.strictEqual(p.friends, false)
  assert.strictEqual(p.classes.c1.allowRun, false); assert.strictEqual(p.classes.c1.netMax, null); assert.deepStrictEqual(p.classes.c1.modes, ['bypass']); assert.strictEqual(p.classes.c2, undefined)
  assert.strictEqual(p.tokenBudgets.userDaily, null); assert.deepStrictEqual(p.tokenBudgets.perUser, { a: 5 })
})
t('junk policy never widens what a student gets', () => {
  const lim = effectiveLimits(student(), { id: 'org1', policy: { modes: 'all', net: { max: 'full' }, classes: { c1: { modes: ['bypass'], netMax: 'full' } } } }, 'c1')
  assert.deepStrictEqual(lim.modes, []); assert.strictEqual(lim.netMax, 'allowlist')
})

t('only an owner invites an admin: an admin cannot make another admin, by invite or by role change', () => {
  D(can(user(['admin']), 'member.invite', ctx({ role: 'admin' })), 'admin invites admin', 'owner_only'); A(can(user(['owner']), 'member.invite', ctx({ role: 'admin' })), 'owner invites admin')
  D(can(user(['admin']), 'member.role.set', ctx({ target: { id: 'm2', orgId: 'org1', roles: ['member'] }, newRole: 'admin' })), 'admin promotes', 'owner_only')
  A(can(user(['admin']), 'member.invite', ctx({ role: 'teacher' })), 'admin invites a teacher')
})

t('file create and rename: members, students, teachers and staff only; guests and read-only roles never', () => {
  for (const r of ['owner', 'admin', 'teacher', 'member', 'student']) { A(can(user([r], r === 'student' ? { ageBand: '13-17', classIds: ['c1'] } : {}), 'file.create', ctx({ classId: r === 'student' ? 'c1' : undefined })), 'create ' + r); A(can(user([r], r === 'student' ? { ageBand: '13-17', classIds: ['c1'] } : {}), 'file.rename', ctx({ classId: r === 'student' ? 'c1' : undefined })), 'rename ' + r) }
  for (const r of ['manager', 'guardian', 'guest']) { D(can(user([r]), 'file.create', ctx()), 'create ' + r, 'role'); D(can(user([r]), 'file.rename', ctx()), 'rename ' + r, 'role') }
})
t('file delete: a student cannot delete; teachers, members and staff can; read-only roles cannot', () => {
  D(can(student(), 'file.delete', ctx({ classId: 'c1' })), 'student delete', 'student_delete')
  for (const r of ['owner', 'admin', 'teacher', 'member']) A(can(user([r]), 'file.delete', ctx()), 'delete ' + r)
  D(can(user(['manager']), 'file.delete', ctx()), 'manager delete', 'role'); D(can(user(['guest']), 'file.delete', ctx()), 'guest delete', 'role')
})
t('approval cards: a student never decides; adults who may decide do; guests never', () => {
  D(can(student(), 'approval.decide', ctx({ classId: 'c1' })), 'student decides', 'student_approval')
  for (const r of ['owner', 'admin', 'teacher', 'member']) A(can(user([r]), 'approval.decide', ctx()), 'decide ' + r)
  D(can(user(['guest']), 'approval.decide', ctx()), 'guest decides', 'role'); D(can(user(['guardian']), 'approval.decide', ctx()), 'guardian decides', 'role')
})
t('GitHub skills: minors and students never install; adults who may decide can', () => {
  D(can(user(['member'], { ageBand: '13-17' }), 'skill.github.install', ctx()), 'teen member', 'minor_skill')
  D(can(student(), 'skill.github.install', ctx({ classId: 'c1' })), 'student', 'minor_skill')
  for (const r of ['owner', 'admin', 'teacher', 'member']) A(can(user([r]), 'skill.github.install', ctx()), 'adult ' + r)
  D(can(user(['guest']), 'skill.github.install', ctx()), 'guest', 'role')
})
t('individual accounts: adults may edit files and install skills; a 13-17 individual may not install; under 13 has no account', () => {
  const i = { id: 'i1', orgId: null, roles: ['member'], ageBand: 'adult', classIds: [] }
  A(can(i, 'file.create', {}), 'individual create'); A(can(i, 'file.delete', {}), 'individual delete'); A(can(i, 'approval.decide', {}), 'individual approve'); A(can(i, 'skill.github.install', {}), 'individual skill')
  D(can({ ...i, ageBand: '13-17' }, 'skill.github.install', {}), 'individual teen skill', 'minor_skill'); D(can({ ...i, ageBand: 'under13' }, 'file.create', {}), 'individual under 13', 'minor_needs_school')
})
t('a setup cannot give a student a mode above manual or plan (acceptEdits is refused for students)', () => {
  D(can(student(), 'agent.mode.use', ctx({ classId: 'c1', mode: 'acceptEdits' })), 'student acceptEdits', 'mode_not_allowed'); A(can(student(), 'agent.mode.use', ctx({ classId: 'c1', mode: 'plan' })), 'student plan')
})

t('tier governance: free tier vs corporate free vs enterprise zero retention and domain isolation', () => {
  const freeGov = getTierGovernance('free')
  assert.strictEqual(freeGov.ads, true)
  assert.strictEqual(freeGov.domainLock, false)
  assert.strictEqual(freeGov.allowExternalViewers, true)
  assert.strictEqual(freeGov.zeroDataRetention, false)
  assert.strictEqual(freeGov.trainingDataRetention, true)

  const corpFreeGov = getTierGovernance('free', { isCorporate: true })
  assert.strictEqual(corpFreeGov.ads, true)
  assert.strictEqual(corpFreeGov.domainLock, false)
  assert.strictEqual(corpFreeGov.allowExternalViewers, true)
  assert.strictEqual(corpFreeGov.zeroDataRetention, false)
  assert.strictEqual(corpFreeGov.trainingDataRetention, true)

  const entGov = getTierGovernance('enterprise', { isCorporate: true })
  assert.strictEqual(entGov.ads, false)
  assert.strictEqual(entGov.domainLock, true)
  assert.strictEqual(entGov.allowExternalViewers, false)
  assert.strictEqual(entGov.zeroDataRetention, true)
  assert.strictEqual(entGov.trainingDataRetention, false)
  assert.strictEqual(entGov.enterpriseSSO, true)
})

console.log(`policy tests passed: ${n} groups (deny by default, role matrix, minors, cross-org, links leaving the org, budget caps)`)
