// An account's life after sign-in. the team, 2026-11-06:
//   "auto update that person's auth daily to 1st make sure they are the correct person 2nd update their creds ... if the company sets it up so
//    certain access levels in their sys automatic get certain branch authorizations ... admin in companies also should be able to make it so
//    that people who dont require the app cannot use their domain and that goes for school and any other corp/ uni / school account"
//   "the user version of the app stays logged in until a security change then you have to relogin ... make sure that account deletion and
//    termination also disable access at this level"
//
// - Security change: every signed-in device of the person is signed out (the current one kept where the person made the change), so the
//   next use asks them to sign in again. Sessions otherwise renew themselves while used (auth.js), so the app stays signed in.
// - The daily check: every company login a person signed in with is asked again with the lasting access kept at sign-in (work.js recheck).
//   Same person and still active: name, email (only on the company's own domains), groups and role are updated, and the company's rules
//   turn groups into rights (work.js applyRules -> access.js grants tagged with the company). Removed, disabled or left: the company's
//   access ends (its grants go, devices are signed out; an account that only ever existed through that company is suspended).
//   Losing the admin role counts as a security change; changed rights apply at once without signing out (the server checks every edit).
// - Domain lock: a company or school that sets enforce: true owns its domains on VESPR: every account with such an email signs in only
//   through that organization's login (company login, or the school's provider); anything else is refused, and accounts already signed
//   in another way stop at "org_login_required" until they use it. People the organization did not give VESPR to cannot get through its
//   login, so they cannot use VESPR with that email at all.
// - Termination (operator, or a company ending a company-only account) and deletion (the person): access ends everywhere at once:
//   devices signed out, the computer bindings released, connectors disconnected and revoked at the providers, the lasting company access
//   dropped, company grants removed. Deletion also takes the account off its sign-in methods and frees its email; kids it sponsored go back
//   to waiting for a grown-up.
import fs from 'node:fs'
import path from 'node:path'
import { applyRules } from './work.js'

export const DAY_MS = 24 * 60 * 60 * 1000

export function createLifecycle ({
  DATA, now = Date.now, vault, getUsers, saveUsers, getSessions, saveSessions, announceRevoked,
  work, schools = () => [], releaseDevices = () => {}, forgetConnectors = async () => {}, log = m => console.error(m)
}) {
  const dir = path.join(DATA, 'auth'); try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  const tokensFile = path.join(dir, 'work-tokens.json'); const auditFile = path.join(dir, 'security.log.jsonl')
  const readTokens = () => { try { return JSON.parse(fs.readFileSync(tokensFile, 'utf8')) } catch { return {} } }
  const writeTokens = t => { const tmp = tokensFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(t, null, 1), { mode: 0o600 }); fs.renameSync(tmp, tokensFile) }
  const audit = e => { try { fs.appendFileSync(auditFile, JSON.stringify({ at: new Date(now()).toISOString(), ...e }) + '\n', { mode: 0o600 }) } catch {} }
  const grantListeners = new Set()
  const onGrants = fn => { grantListeners.add(fn); return () => grantListeners.delete(fn) }
  // who: the name rights are given to in workspaces; previousWho: the name the previous grants were given to (a name the daily check changed)
  const emitGrants = (user, companyId, grants, previous, previousWho = null) => { for (const fn of grantListeners) { try { fn({ user, who: user.name, companyId, grants, previous, previousWho: previousWho || user.name }) } catch (e) { log('grants listener failed: ' + e.message) } } }

  // ── security changes ───────────────────────────────────────────────────
  function securityChange (userId, why, { keep = null } = {}) {
    const sessions = getSessions()
    const keys = Object.entries(sessions).filter(([h, s]) => s.userId === userId && h !== keep).map(([h]) => h)
    for (const k of keys) delete sessions[k]
    if (keys.length) { saveSessions(sessions); announceRevoked(userId, keys) }
    audit({ user: userId, event: 'security_change', why, signedOut: keys.length })
    return keys.length
  }

  // ── company access ─────────────────────────────────────────────────────
  // after a company sign-in or a daily check: role, groups and the rights the company's rules give. -> { roleDown }
  function applyWork (user, company, profile, { only = false } = {}) {
    const before = user.work && user.work.company === company.id ? user.work : null
    const { role, grants } = applyRules(company, { groups: profile.groups || [], role: profile.role })
    user.work = { company: company.id, name: company.name, via: company.login, role, groups: (profile.groups || []).slice(0, 200), grants, grantsWho: user.name, checkedAt: now(), state: 'active', only: before ? Boolean(before.only) : only }
    emitGrants(user, company.id, grants, before ? before.grants || [] : [], before ? before.grantsWho : null)
    return { roleDown: Boolean(before && before.role === 'admin' && role !== 'admin') }
  }
  function keepLasting (userId, companyId, lasting) {
    if (!lasting || !lasting.token) return
    const t = readTokens(); t[userId] = t[userId] || {}
    t[userId][companyId] = { box: vault.seal(lasting), lastOk: now(), lastTry: now(), fails: 0 }; writeTokens(t)
  }
  function dropLasting (userId, companyId = null) {
    const t = readTokens(); if (!t[userId]) return
    if (companyId) delete t[userId][companyId]; else delete t[userId]
    if (t[userId] && !Object.keys(t[userId]).length) delete t[userId]
    writeTokens(t)
  }
  // the company no longer vouches for this person
  async function endWork (userId, companyId, why) {
    const users = getUsers(); const u = users[userId]; if (!u) return
    dropLasting(userId, companyId)
    const w = u.work && u.work.company === companyId ? u.work : null
    if (w) emitGrants(u, companyId, [], w.grants || [], w.grantsWho)
    if (u.providers) delete u.providers['work:' + companyId]
    audit({ user: userId, event: 'company_access_ended', company: companyId, why })
    if (w && w.only) { saveUsers(users); return await terminate(userId, `${w.name} ended this account's access (${why})`) }
    delete u.work; u.updatedAt = now(); saveUsers(users)
    securityChange(userId, 'company access ended: ' + why)
  }

  // the daily check, for everyone whose last check is a day old (or all, with force). -> a summary
  let running = false
  async function recheckAll ({ force = false } = {}) {
    if (running) return { skipped: true }
    running = true; const summary = { checked: 0, ok: 0, ended: 0, errors: 0 }
    try {
      const t = readTokens()
      for (const [userId, byCompany] of Object.entries(t)) {
        for (const [companyId, rec] of Object.entries(byCompany)) {
          if (!force && now() - (rec.lastTry || 0) < DAY_MS) continue
          const users = getUsers(); const u = users[userId]
          const knownId = u && u.providers && u.providers['work:' + companyId] && u.providers['work:' + companyId].id
          if (!u || !knownId) { dropLasting(userId, companyId); continue }
          summary.checked++
          let lasting; try { lasting = vault.open(rec.box) } catch { dropLasting(userId, companyId); continue }
          const r = await work.recheck(companyId, lasting, knownId)
          if (r.gone) { summary.ended++; await endWork(userId, companyId, r.gone); continue }
          const tt = readTokens(); const cur = tt[userId] && tt[userId][companyId]; if (!cur) continue
          if (!r.ok) { summary.errors++; cur.lastTry = now(); cur.fails = (cur.fails || 0) + 1; writeTokens(tt); audit({ user: userId, event: 'recheck_failed', company: companyId, why: r.error, fails: cur.fails }); continue }
          summary.ok++
          const company = work.companies().find(c => c.id === companyId)
          const users2 = getUsers(); const me = users2[userId]
          // the company's copy of who they are: name, and email only on the company's own domains and not someone else's
          if (r.profile.name && r.profile.name !== me.name && !Object.values(users2).some(o => o.id !== me.id && String(o.name || '').toLowerCase() === r.profile.name.toLowerCase())) me.name = r.profile.name
          if (r.profile.email && r.profile.emailOwned && r.profile.email !== me.email && !Object.values(users2).some(o => o.id !== me.id && String(o.email || '').toLowerCase() === r.profile.email)) { me.email = r.profile.email; me.emailVerified = true }
          if (me.providers && me.providers['work:' + companyId]) me.providers['work:' + companyId].email = r.profile.email || null
          const { roleDown } = applyWork(me, company, r.profile); me.updatedAt = now(); saveUsers(users2)
          if (r.lasting) cur.box = vault.seal(r.lasting)
          cur.lastTry = now(); cur.lastOk = now(); cur.fails = 0; writeTokens(tt)
          audit({ user: userId, event: 'recheck_ok', company: companyId, role: me.work.role, groups: me.work.groups.length })
          if (roleDown) securityChange(userId, `no longer an admin at ${company.name}`)
        }
      }
    } finally { running = false }
    return summary
  }
  let timer = null
  function start () { if (timer) return; const tick = () => recheckAll().catch(e => log('daily check failed: ' + e.message)); timer = setInterval(tick, 60 * 60 * 1000); timer.unref?.(); setTimeout(tick, 60 * 1000).unref?.() }
  function stop () { if (timer) clearInterval(timer); timer = null }

  // ── termination and deletion ───────────────────────────────────────────
  async function cutOff (userId, why) {
    const users = getUsers(); const u = users[userId]
    const t = readTokens(); for (const cid of Object.keys(t[userId] || {})) emitGrants(u || { id: userId }, cid, [], (u && u.work && u.work.company === cid && u.work.grants) || [], u && u.work && u.work.grantsWho)
    dropLasting(userId)
    securityChange(userId, why)
    try { releaseDevices(userId) } catch (e) { log('releasing devices failed: ' + e.message) }
    try { await forgetConnectors(userId) } catch (e) { log('forgetting connectors failed: ' + e.message) }
  }
  async function terminate (userId, why) {
    const users = getUsers(); const u = users[userId]; if (!u) return false
    u.activation = 'suspended'; u.suspended = { at: now(), why: String(why).slice(0, 200) }; u.updatedAt = now(); saveUsers(users)
    audit({ user: userId, event: 'terminated', why })
    await cutOff(userId, 'terminated: ' + why)
    return true
  }
  async function deleteAccount (userId) {
    const users = getUsers(); const u = users[userId]; if (!u) return false
    u.activation = 'deletion_requested'; u.deletion = { at: now(), email: u.email ? 'removed' : null }
    u.email = null; u.emailVerified = false; u.providers = {}; u.passwordHash = null; u.salt = null; delete u.work; delete u.sponsorCode
    // kids this person approved go back to waiting for a grown-up; this person leaves the sponsors list of anyone who approved them
    const kids = []
    for (const k of Object.values(users)) {
      if (k.sponsor && k.sponsor.by && k.sponsor.by.id === userId) { k.sponsor = { required: Boolean(k.sponsor.required), state: 'pending' }; if (k.guardian && k.guardian.by === userId) k.guardian = { state: 'required_pending' }; kids.push(k.id) }
      if (Array.isArray(k.sponsoring)) k.sponsoring = k.sponsoring.filter(x => x !== userId)
    }
    u.sponsoring = []; u.updatedAt = now(); saveUsers(users)
    audit({ user: userId, event: 'deleted', kidsBackToWaiting: kids.length })
    await cutOff(userId, 'account deleted')
    for (const k of kids) securityChange(k, 'their grown-up deleted their account')
    return true
  }

  // ── domain lock ────────────────────────────────────────────────────────
  // -> { org, via: [allowed sign-in kinds] } or null. via kinds: 'work:<id>', a school's provider ('clever', 'google'...), 'lti' (any LMS)
  function lockFor (email) {
    const d = (/^[^\s@]+@([^\s@]+)$/.exec(String(email || '').trim().toLowerCase()) || [])[1]; if (!d) return null
    const co = work.companies().find(c => c.enforce && c.domains.includes(d)); if (co) return { org: co.name, via: ['work:' + co.id], how: co.name + '’s login (' + co.loginName + ')' }
    const s = schools().find(x => x.enforce && x.domains.includes(d)); if (s) return { org: s.name, via: [s.provider], how: s.name + '’s school sign-in' }
    return null
  }
  const lockAllows = (lock, via) => !lock || lock.via.some(v => v === via || (v === 'lti' && String(via).startsWith('lti:')))
  // an account already signed in some other way: allowed only once it is linked to the organization's login
  function lockState (user) {
    const lock = lockFor(user && user.email); if (!lock) return null
    const linked = Object.keys((user && user.providers) || {}).some(k => lockAllows(lock, k))
    return linked ? null : lock
  }
  const lockRefusal = lock => `${lock.org} asks everyone with its email to sign in through ${lock.how}. Use that instead.`

  return { securityChange, applyWork, keepLasting, dropLasting, endWork, recheckAll, start, stop, terminate, deleteAccount, lockFor, lockAllows, lockState, lockRefusal, onGrants }
}
