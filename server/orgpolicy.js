// Account kind and the organization's rules about adding files and folders to a message (the team, 2026-11-10: "set all of that up").
//   accountKindOf(user)  'school' (signed in through a school: Clever, ClassLink, Canvas/D2L), 'company' (signed in through a company login), else 'personal'
//   GET  /api/org/policy              (Bearer) -> { kind, org, policy: { fileContext, folderContext }, canEdit }
//   POST /api/org/policy { fileContext?, folderContext? }   (Bearer, an admin of that organization) -> the same
// FAIL CLOSED: a school or company account gets false/false until an admin of that organization turns each one on. Personal accounts decide for themselves in the app, so they get no policy.
// The app asks /auth/me (which carries accountKind and orgPolicy) and treats anything but a literal `true` as no.
import path from 'node:path'
import { openStore, readJson, sendJson, bearer } from './jsonstore.js'

const ADMIN = /^(admin|owner|school_admin|district_admin|org_admin)$/
export const orgKeyOf = user => {
  if (!user) return null
  if (user.school) return 'school:' + String((user.school && user.school.via) || 'school').toLowerCase().replace(/[^a-z0-9:_.-]/g, '').slice(0, 80)
  const k = Object.keys(user.providers || {}).find(x => x.startsWith('work:')); if (k) return k.slice(0, 90)
  return user.work ? 'work:' + String((user.work && user.work.company) || 'company').toLowerCase().replace(/[^a-z0-9:_.-]/g, '').slice(0, 80) : null
}
export const accountKindOf = user => !user ? 'personal' : user.school ? 'school' : orgKeyOf(user) ? 'company' : 'personal'
export const isOrgAdmin = user => !!user && [].concat(user.roles || [], (user.school && user.school.roles) || []).some(r => ADMIN.test(String(r).toLowerCase()))
const bool = v => v === true

export function createOrgPolicy ({ DATA, getUser = () => null, now = Date.now } = {}) {
  const store = openStore(path.join(DATA, 'orgs', 'policy.json'), () => ({ orgs: {} }))
  const orgs = store.data.orgs // orgKey -> { fileContext, folderContext, by, at }
  const policyFor = user => { const k = orgKeyOf(user); const o = (k && orgs[k]) || {}; return { fileContext: bool(o.fileContext), folderContext: bool(o.folderContext) } }
  const view = user => { const kind = accountKindOf(user); return kind === 'personal' ? { kind, org: null, policy: null, canEdit: false } : { kind, org: orgKeyOf(user), policy: policyFor(user), canEdit: isOrgAdmin(user) } }
  return {
    policyFor, view,
    http (req, res) {
      const url = new URL(req.url, 'http://x'); if (url.pathname !== '/api/org/policy') return false
      if (req.method === 'OPTIONS') return false
      const user = getUser(bearer(req)); if (!user) { sendJson(res, 401, { error: 'sign_in' }); return true }
      if (req.method === 'GET') { sendJson(res, 200, view(user)); return true }
      if (req.method !== 'POST') { sendJson(res, 405, { error: 'method_not_allowed' }); return true }
      ;(async () => {
        const v = view(user)
        if (v.kind === 'personal') return sendJson(res, 400, { error: 'personal_account', message: 'Personal accounts choose for themselves in Settings.' })
        if (!v.canEdit) return sendJson(res, 403, { error: 'not_admin', message: 'Only an administrator of your organization can change this.' })
        const body = await readJson(req, 2048).catch(() => null)
        if (!body) return sendJson(res, 400, { error: 'bad_body' })
        const cur = orgs[v.org] || {}; const next = { fileContext: bool(cur.fileContext), folderContext: bool(cur.folderContext) }
        for (const k of ['fileContext', 'folderContext']) if (k in body) { if (typeof body[k] !== 'boolean') return sendJson(res, 400, { error: 'bad_value', message: k + ' must be true or false' }); next[k] = body[k] }
        orgs[v.org] = { ...next, by: String(user.id || '').slice(0, 64), at: now() }; store.save()
        sendJson(res, 200, view(user))
      })().catch(() => { if (!res.headersSent) sendJson(res, 500, { error: 'failed' }) })
      return true
    }
  }
}
