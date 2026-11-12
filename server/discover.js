// Auto sign-in ("Sign in with your school"): a kid types a school email or the school's name and VESPR finds the sign-in their school uses,
// so nobody has to know what Clever, ClassLink or "SSO" mean. the team, 2026-11-06: "can we get auto detection so the kids dont need to figure
// out just sso ... auto sign in then it checks what they have then signs them in/ up with that info".
//
//   GET /auth/discover?q=<email or school name>  ->
//     { kind: 'provider', provider, label, hint? }   go straight to that sign-in (hint: the email, for Google and Microsoft)
//     { kind: 'lms', name, label, url? }             the school signs in through its Canvas / D2L course: open VESPR from there
//     { kind: 'choices', schools: [...] }            a name matched several schools
//     { kind: 'not_ready', provider, label }         the school's sign-in is known, but this server has not set it up yet
//     { kind: 'password', email }                    no school sign-in found: an email and password account
//     { kind: 'unknown' }
//
// Order: the school directory (operator: <data>/auth/schools.json or VESPR_SCHOOLS, [{ name, domains: [..], provider, url? }]), then for
// an email: well-known mail domains, Microsoft's public "is this an organization?" lookup, and the domain's mail servers (Google Workspace,
// Microsoft 365). Only the domain leaves VESPR for those lookups (Microsoft sees the address). Results are cached for an hour; 30 a minute
// per address.
import fs from 'node:fs'
import path from 'node:path'
import dnsDefault from 'node:dns/promises'

export const LABELS = { google: 'Google', microsoft: 'Microsoft', clever: 'Clever', classlink: 'ClassLink', github: 'GitHub', lti: 'your class page' }
const GOOGLE_MAIL = ['gmail.com', 'googlemail.com']
const MICROSOFT_MAIL = ['outlook.com', 'hotmail.com', 'live.com', 'msn.com']
const EMAIL = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/

async function realmDefault (email) {
  const r = await fetch('https://login.microsoftonline.com/getuserrealm.srf?json=1&login=' + encodeURIComponent(email), { signal: AbortSignal.timeout(5000) })
  if (r.status !== 200) return null
  return (await r.json()).NameSpaceType || null // 'Managed' | 'Federated' = an organization on Microsoft; 'Unknown' = not
}

// companies: () => [{ id, name, domains, loginName }] and ready(company) from server/work.js: a work email or a company name finds its login
export function createDiscover ({ DATA, config = process.env, now = Date.now, providers = () => ({}), dns = dnsDefault, realm = realmDefault, companies = () => [], ready = () => false }) {
  const cache = new Map(); const hits = new Map()
  function schools () {
    let list = []
    try { list = list.concat(JSON.parse(fs.readFileSync(path.join(DATA, 'auth', 'schools.json'), 'utf8'))) } catch {}
    try { if (config.VESPR_SCHOOLS) list = list.concat(JSON.parse(config.VESPR_SCHOOLS)) } catch {}
    return (Array.isArray(list) ? list : []).filter(s => s && s.name && LABELS[s.provider]).map(s => ({ name: String(s.name), provider: s.provider, domains: (s.domains || []).map(d => String(d).toLowerCase()), url: /^https:\/\//.test(s.url || '') ? s.url : null, enforce: s.enforce === true })) // enforce: domain lock (server/lifecycle.js)
  }
  const as = (provider, extra = {}) => {
    if (provider === 'lti') return { kind: 'lms', label: LABELS.lti, ...extra }
    return providers()[provider] ? { kind: 'provider', provider, label: LABELS[provider], ...extra } : { kind: 'not_ready', provider, label: LABELS[provider] }
  }
  const fromSchool = (s, hint) => as(s.provider, { name: s.name, ...(s.url ? { url: s.url } : {}), ...(hint && ['google', 'microsoft'].includes(s.provider) ? { hint } : {}) })

  const fromCompany = (c, hint) => ready(c) ? { kind: 'provider', provider: 'work', company: c.id, label: c.loginName, name: c.name, ...(hint ? { hint } : {}) } : { kind: 'not_ready', provider: 'work', label: c.name + ' (' + c.loginName + ')' }
  async function byEmail (email) {
    const domain = EMAIL.exec(email)[1].toLowerCase()
    const co = companies().find(c => (c.domains || []).includes(domain)); if (co) return fromCompany(co, email)
    const known = schools().find(s => s.domains.includes(domain)); if (known) return fromSchool(known, email)
    if (GOOGLE_MAIL.includes(domain)) return as('google', { hint: email })
    if (MICROSOFT_MAIL.includes(domain)) return as('microsoft', { hint: email })
    try { const ns = await realm(email); if (ns === 'Managed' || ns === 'Federated') return as('microsoft', { hint: email }) } catch {}
    try {
      const mx = (await dns.resolveMx(domain)).map(m => String(m.exchange).toLowerCase())
      if (mx.some(x => x.endsWith('google.com') || x.endsWith('googlemail.com'))) return as('google', { hint: email })
      if (mx.some(x => x.endsWith('.outlook.com'))) return as('microsoft', { hint: email })
    } catch {}
    return { kind: 'password', email }
  }
  function byName (q) {
    const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 1)
    const found = schools().filter(s => words.every(w => s.name.toLowerCase().includes(w))).map(s => ({ name: s.name, ...fromSchool(s) }))
      .concat(companies().filter(c => words.every(w => c.name.toLowerCase().includes(w))).map(c => ({ name: c.name, ...fromCompany(c) }))).slice(0, 8)
    if (!found.length) return { kind: 'unknown' }
    if (found.length === 1) return found[0]
    return { kind: 'choices', schools: found }
  }

  async function discover (raw, who = 'x') {
    const q = String(raw || '').trim().slice(0, 200); if (q.length < 3) return { status: 400, body: { error: 'Type your school email or your school\'s name' } }
    const h = hits.get(who) || { n: 0, since: now() }; if (now() - h.since > 60000) { h.n = 0; h.since = now() } h.n++; hits.set(who, h)
    if (h.n > 30) return { status: 429, body: { error: 'Too many tries. Wait a minute.' } }
    const key = q.toLowerCase(); const c = cache.get(key); if (c && now() - c.at < 3600000) return { status: 200, body: c.body }
    const body = EMAIL.test(q) ? await byEmail(q.toLowerCase()) : byName(q)
    cache.set(key, { at: now(), body }); return { status: 200, body }
  }

  async function http (req, res, u, { jsonResponse, clientIp }) {
    if (u.pathname !== '/auth/discover' || req.method !== 'GET') return false
    const r = await discover(u.searchParams.get('q'), clientIp); return jsonResponse(res, r.status, r.body), true
  }
  return { http, discover, schools }
}
