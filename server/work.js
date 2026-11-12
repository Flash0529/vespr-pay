// Work sign-in: a company signs its people in with its own login (Okta, Microsoft Entra, Google Workspace, OneLogin, JumpCloud, Ping,
// Auth0 or any OpenID Connect provider, or GitHub organization membership). The work version of school sign-in. the team, 2026-11-06:
// "make sure we can also support work equivalents then github and microsoft". The rules for which sign-ins belong to a company are
// server/orgs.js checkSignIn (docs/ORGS-SCHOOLS.md section 2: this is the "per-org flow" that was PLANNED there).
//
//   GET /auth/start/work/<company>?next=&login_hint=   -> the company's login (state cookie, PKCE, nonce)
//   GET /auth/callback/work                            <- back from it; auth.js makes or finds the account and signs in
//
// Companies: <data>/auth/companies.json and/or VESPR_COMPANIES (JSON). Secrets are never in that list: "secretEnv" names the variable
// that holds the client secret (secret drop box -> /home/user/.secrets/vespr-auth.env).
//   { id, name, domains: [verified work domains], login: 'okta'|'onelogin'|'jumpcloud'|'ping'|'auth0'|'oidc', issuer, clientId, secretEnv }
//   { id, name, domains, login: 'entra', tenantId }            VESPR's Microsoft app (VESPR_AUTH_MICROSOFT_*), only this tenant
//   { id, name, domains, login: 'google-workspace' }            VESPR's Google app (VESPR_AUTH_GOOGLE_*), only these domains (hd claim)
//   { id, name, domains, login: 'github', githubOrg }           VESPR's GitHub app (VESPR_AUTH_GITHUB_*), active members of that org
// "domains" must be domains the company proved it owns (orgs.js verificationRecord: a DNS TXT record); free-mail domains are refused.
// Optional, any login type:
//   enforce: true       domain lock: every account with these domains must sign in through this login (server/lifecycle.js)
//   rules: [{ when: { group } | { role: 'admin' } | { everyone: true }, give: { role: 'admin' } | { room, path, rights } }]
//                       the company's groups (OIDC "groups" claim, GitHub teams) and roles become VESPR rights, checked again every day
//   scopes: ['groups']  extra scopes the company's login needs to send groups (Okta: a "groups" scope and claim set up there)
// Every sign-in also asks for lasting access (refresh token; GitHub's token), so VESPR can check the person again every day: still there,
// still the same person, still in the same groups (server/lifecycle.js recheck).
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { checkSignIn, claimableDomain, normalizeDomain, emailDomain } from './orgs.js'

export const STATE_TTL_MS = 10 * 60 * 1000
const b64u = b => Buffer.from(b).toString('base64url')
const OIDC_KINDS = ['okta', 'onelogin', 'jumpcloud', 'ping', 'auth0', 'oidc']
export const LOGIN_NAMES = { okta: 'Okta', onelogin: 'OneLogin', jumpcloud: 'JumpCloud', ping: 'Ping Identity', auth0: 'Auth0', oidc: 'company login', entra: 'Microsoft', 'google-workspace': 'Google Workspace', github: 'GitHub' }

// a rule, or null when it is not one VESPR understands (never "manage": access managers are named by people, not by a company's groups)
const RULE_RIGHTS = ['make', 'view', 'edit', 'delete']
export function cleanRule (r) {
  if (!r || typeof r !== 'object' || !r.when || !r.give) return null
  const w = r.when; const when = w.everyone === true ? { everyone: true } : typeof w.group === 'string' && w.group.length <= 200 ? { group: w.group } : w.role === 'admin' ? { role: 'admin' } : null
  if (!when) return null
  const g = r.give
  if (g.role === 'admin') return { when, give: { role: 'admin' } }
  const p = String(g.path ?? '').replace(/^\/+/, '')
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(g.room || '')) || p.split('/').includes('..') || p.length > 300) return null
  const rights = (Array.isArray(g.rights) ? g.rights : []).filter(x => RULE_RIGHTS.includes(x))
  return rights.length ? { when, give: { room: g.room, path: p, rights: RULE_RIGHTS.filter(x => rights.includes(x)) } } : null
}
// what the rules give someone: { role, grants: [{ room, path, rights }] }
export function applyRules (company, { groups = [], role = 'member' }) {
  let outRole = role === 'admin' ? 'admin' : 'member'; const grants = new Map()
  for (const r of company.rules || []) {
    const hit = r.when.everyone || (r.when.group && groups.includes(r.when.group)) || (r.when.role === 'admin' && role === 'admin')
    if (!hit) continue
    if (r.give.role === 'admin') { outRole = 'admin'; continue }
    const k = r.give.room + '\u0000' + r.give.path; const prev = grants.get(k)
    grants.set(k, { room: r.give.room, path: r.give.path, rights: RULE_RIGHTS.filter(x => r.give.rights.includes(x) || (prev && prev.rights.includes(x))) })
  }
  return { role: outRole, grants: [...grants.values()] }
}

export function readCompanies ({ DATA, config }) {
  let list = []
  try { list = list.concat(JSON.parse(fs.readFileSync(path.join(DATA, 'auth', 'companies.json'), 'utf8'))) } catch {}
  try { if (config.VESPR_COMPANIES) list = list.concat(JSON.parse(config.VESPR_COMPANIES)) } catch {}
  const out = []
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || !/^[a-z0-9-]{1,40}$/.test(String(c.id || '')) || !c.name || !LOGIN_NAMES[c.login]) continue
    const domains = (c.domains || []).map(normalizeDomain).filter(claimableDomain)
    if (!domains.length && c.login !== 'github') continue
    const rules = (Array.isArray(c.rules) ? c.rules : []).map(cleanRule).filter(Boolean)
    const scopes = (Array.isArray(c.scopes) ? c.scopes : []).map(String).filter(x => /^[a-z0-9:._-]{1,40}$/i.test(x)).slice(0, 5)
    const base = { id: c.id, name: String(c.name).slice(0, 80), login: c.login, loginName: LOGIN_NAMES[c.login], domains, enforce: c.enforce === true, rules, scopes }
    if (OIDC_KINDS.includes(c.login)) {
      if (!/^https:\/\/[^\s]+$/.test(String(c.issuer || '')) || !c.clientId) continue
      out.push({ ...base, issuer: String(c.issuer).replace(/\/+$/, ''), clientId: String(c.clientId), secretEnv: /^VESPR_[A-Z0-9_]+$/.test(c.secretEnv || '') ? c.secretEnv : null })
    } else if (c.login === 'entra') {
      if (!/^[0-9a-f-]{36}$/i.test(String(c.tenantId || ''))) continue
      out.push({ ...base, tenantId: String(c.tenantId).toLowerCase(), issuer: `https://login.microsoftonline.com/${String(c.tenantId).toLowerCase()}/v2.0` })
    } else if (c.login === 'google-workspace') {
      out.push({ ...base, issuer: 'https://accounts.google.com' })
    } else if (c.login === 'github') {
      if (!/^[A-Za-z0-9-]{1,39}$/.test(String(c.githubOrg || ''))) continue
      out.push({ ...base, githubOrg: String(c.githubOrg) })
    }
  }
  return out
}

async function defaultRequest ({ url, method = 'GET', headers = {}, body }) {
  const r = await fetch(url, { method, headers: { Accept: 'application/json', 'User-Agent': 'VESPR', ...headers }, body, signal: AbortSignal.timeout(10000) })
  return { status: r.status, text: await r.text() }
}

export function createWork ({ DATA, config = process.env, now = Date.now, random = n => crypto.randomBytes(n), request = defaultRequest }) {
  const states = new Map() // state -> { company, next, verifier, nonce, redirectUri, expiresAt }
  const meta = new Map(); const jwks = new Map() // discovery documents and key sets, one hour
  const companies = () => readCompanies({ DATA, config })
  const getJson = async (url, opts) => { const r = await request({ url, ...opts }); let j = {}; try { j = JSON.parse(r.text) } catch {} return { status: r.status, j } }
  const cached = async (map, url) => { const c = map.get(url); if (c && now() - c.at < 3600000) return c.j; const r = await getJson(url); if (r.status !== 200) throw new Error('the company login did not answer (' + r.status + ')'); map.set(url, { at: now(), j: r.j }); return r.j }

  // which app keys a company's login uses
  function client (co) {
    if (co.login === 'entra') return { id: config.VESPR_AUTH_MICROSOFT_ID, secret: config.VESPR_AUTH_MICROSOFT_SECRET }
    if (co.login === 'google-workspace') return { id: config.VESPR_AUTH_GOOGLE_ID, secret: config.VESPR_AUTH_GOOGLE_SECRET }
    if (co.login === 'github') return { id: config.VESPR_AUTH_GITHUB_ID, secret: config.VESPR_AUTH_GITHUB_SECRET }
    return { id: co.clientId, secret: co.secretEnv ? config[co.secretEnv] : null }
  }
  const ready = co => { const k = client(co); return Boolean(k.id && k.secret) }

  async function start (companyId, { base, next, hint }) {
    const co = companies().find(c => c.id === companyId)
    if (!co) return { status: 404, error: 'This company is not set up on VESPR' }
    if (!ready(co)) return { status: 409, error: `${co.name}'s sign-in is not set up on this server yet` }
    for (const [s, v] of states) if (v.expiresAt <= now()) states.delete(s)
    const k = client(co); const state = b64u(random(24)); const nonce = b64u(random(16)); const verifier = b64u(random(48))
    const redirectUri = base + '/auth/callback/work'
    states.set(state, { company: co.id, next, verifier, nonce, redirectUri, expiresAt: now() + STATE_TTL_MS })
    const q = new URLSearchParams({ client_id: k.id, redirect_uri: redirectUri, state })
    const okHint = /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(String(hint || '')) ? String(hint) : null
    let url
    if (co.login === 'github') {
      q.set('scope', 'read:user user:email read:org'); if (okHint) q.set('login', okHint.split('@')[0]) // GitHub tokens last until revoked
      url = 'https://github.com/login/oauth/authorize?' + q
    } else {
      const m = await cached(meta, co.issuer + '/.well-known/openid-configuration')
      if (!m.authorization_endpoint) return { status: 502, error: 'The company login did not describe itself' }
      // lasting access for the daily check: Google asks with access_type=offline, the others with the offline_access scope
      const scope = ['openid', 'email', 'profile', ...(co.login === 'google-workspace' ? [] : ['offline_access']), ...co.scopes]
      q.set('response_type', 'code'); q.set('scope', scope.join(' ')); q.set('nonce', nonce)
      if (co.login === 'google-workspace') { q.set('access_type', 'offline'); q.set('prompt', 'consent') }
      q.set('code_challenge', b64u(crypto.createHash('sha256').update(verifier).digest())); q.set('code_challenge_method', 'S256')
      if (okHint) q.set('login_hint', okHint)
      if (co.login === 'google-workspace') q.set('hd', co.domains.length === 1 ? co.domains[0] : '*')
      url = m.authorization_endpoint + '?' + q
    }
    return { redirect: url, state }
  }

  async function verifyIdToken (co, idToken, nonce, clientId) {
    const parts = String(idToken || '').split('.'); if (parts.length !== 3) throw new Error('no signed statement')
    const h = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (h.alg !== 'RS256') throw new Error('unsupported signature ' + h.alg)
    const m = await cached(meta, co.issuer + '/.well-known/openid-configuration')
    let ks = await cached(jwks, m.jwks_uri); let key = (ks.keys || []).find(k => k.kid === h.kid)
    if (!key) { jwks.delete(m.jwks_uri); ks = await cached(jwks, m.jwks_uri); key = (ks.keys || []).find(k => k.kid === h.kid) }
    if (!key) throw new Error('signed with a key the company does not publish')
    if (!crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw new Error('the signature does not match')
    const t = Math.floor(now() / 1000)
    if (c.iss !== co.issuer) throw new Error('wrong issuer')
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud]; if (!aud.includes(clientId)) throw new Error('not addressed to VESPR')
    if (!c.exp || c.exp < t - 60) throw new Error('expired')
    if (nonce !== null && c.nonce !== nonce) throw new Error('wrong nonce') // a refresh (the daily check) has no nonce
    return c
  }

  // back from the company: -> { company, id, email, emailOwned, name, next } or { status, error }
  async function finish (q, stateCookie) {
    const state = String(q.get('state') || ''); const rec = states.get(state); states.delete(state)
    if (!rec || rec.expiresAt <= now()) return { status: 400, error: 'This sign-in link has expired. Start again.' }
    if (!stateCookie || stateCookie !== state) return { status: 400, error: 'This sign-in was not started in this browser. Start again.' }
    if (q.get('error')) return { status: 401, error: 'The company login said no: ' + String(q.get('error_description') || q.get('error')).slice(0, 160) }
    const co = companies().find(c => c.id === rec.company); if (!co) return { status: 404, error: 'This company is not set up any more' }
    const k = client(co); const code = String(q.get('code') || ''); if (!code) return { status: 400, error: 'No code came back' }
    try {
      if (co.login === 'github') {
        const tok = await getJson('https://github.com/login/oauth/access_token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: k.id, client_secret: k.secret, code, redirect_uri: rec.redirectUri }).toString() })
        if (!tok.j.access_token) throw new Error('GitHub did not finish the sign-in')
        const auth = { Authorization: 'Bearer ' + tok.j.access_token }
        const me = await getJson('https://api.github.com/user', { headers: auth }); if (!me.j.id) throw new Error('GitHub did not say who this is')
        const mem = await getJson(`https://api.github.com/user/memberships/orgs/${encodeURIComponent(co.githubOrg)}`, { headers: auth })
        if (mem.status !== 200 || mem.j.state !== 'active') return { status: 403, error: `You are not an active member of ${co.name}'s GitHub organization (${co.githubOrg}). Ask its owner to add you, or approve VESPR for the organization in GitHub.` }
        return { ...(await githubProfile(co, auth, me.j, mem.j)), next: rec.next, lasting: { kind: 'github', token: tok.j.access_token } }
      }
      const m = await cached(meta, co.issuer + '/.well-known/openid-configuration')
      const tok = await getJson(m.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: rec.redirectUri, client_id: k.id, client_secret: k.secret, code_verifier: rec.verifier }).toString() })
      if (!tok.j.id_token) throw new Error(String(tok.j.error_description || tok.j.error || 'the company login did not finish'))
      const c = await verifyIdToken(co, tok.j.id_token, rec.nonce, k.id)
      const email = String(c.email || c.preferred_username || '').toLowerCase() || null
      // the company's own login is the authority for its own verified domains; orgs.js checks the rest (hd for Google, tid for Entra, iss/aud)
      const provider = co.login === 'entra' ? 'microsoft' : co.login === 'google-workspace' ? 'google' : 'oidc'
      const org = { domains: co.domains, idp: { microsoft: { tid: co.tenantId }, oidc: { issuer: co.issuer, audience: k.id } } }
      const check = checkSignIn(org, { provider, claims: { ...c, email, email_verified: true } })
      if (!check.ok) return { status: 403, error: { domain_not_allowed: `Use your ${co.name} work email (${co.domains.join(', ')}).`, google_hd_mismatch: `Sign in with your ${co.name} Google Workspace account.`, tenant_mismatch: `Sign in with your ${co.name} Microsoft work account.`, issuer_mismatch: 'This sign-in did not come from your company\'s login.' }[check.code] || 'This sign-in does not belong to ' + co.name }
      return { ...oidcProfile(co, c, email), next: rec.next, lasting: tok.j.refresh_token ? { kind: 'refresh', token: tok.j.refresh_token } : null }
    } catch (e) { return { status: 401, error: 'Signing in with ' + co.loginName + ' did not work: ' + String(e.message).slice(0, 160) } }
  }

  const oidcProfile = (co, c, email) => ({ company: co, id: (co.login === 'entra' ? (c.oid || c.sub) : c.sub), email, emailOwned: true, name: c.name || [c.given_name, c.family_name].filter(Boolean).join(' ') || null, role: 'member', groups: Array.isArray(c.groups) ? c.groups.map(String).slice(0, 200) : [] })
  async function githubProfile (co, auth, me, mem) {
    const emails = await getJson('https://api.github.com/user/emails', { headers: auth })
    const primary = (Array.isArray(emails.j) ? emails.j : []).find(e => e.primary && e.verified)
    const email = primary ? String(primary.email).toLowerCase() : null
    const teams = await getJson('https://api.github.com/user/teams', { headers: auth })
    const groups = (Array.isArray(teams.j) ? teams.j : []).filter(x => x.organization && String(x.organization.login).toLowerCase() === co.githubOrg.toLowerCase()).map(x => String(x.slug))
    return { company: co, id: 'github:' + me.id, email, emailOwned: Boolean(email && co.domains.includes(emailDomain(email))), name: me.name || me.login, role: mem.role === 'admin' ? 'admin' : 'member', groups }
  }

  // The daily check (server/lifecycle.js): ask the company's login again with the lasting access kept at sign-in.
  //   -> { ok: true, profile, lasting? (a new token, when the login rotates it) } | { gone: why } (removed, disabled, left the org) | { error }
  async function recheck (companyId, lasting, knownId) {
    const co = companies().find(c => c.id === companyId); if (!co) return { gone: 'the company is no longer set up on VESPR' }
    if (!ready(co)) return { error: 'the company login is not set up on this server' }
    const k = client(co)
    try {
      if (lasting.kind === 'github') {
        const auth = { Authorization: 'Bearer ' + lasting.token }
        const me = await getJson('https://api.github.com/user', { headers: auth })
        if (me.status === 401) return { gone: 'GitHub access was revoked' }
        if (me.status !== 200 || !me.j.id) return { error: 'GitHub answered ' + me.status }
        if ('github:' + me.j.id !== knownId) return { gone: 'a different GitHub account' }
        const mem = await getJson(`https://api.github.com/user/memberships/orgs/${encodeURIComponent(co.githubOrg)}`, { headers: auth })
        if (mem.status === 404 || (mem.status === 200 && mem.j.state !== 'active')) return { gone: 'no longer an active member of ' + co.githubOrg }
        if (mem.status !== 200) return { error: 'GitHub answered ' + mem.status }
        return { ok: true, profile: await githubProfile(co, auth, me.j, mem.j) }
      }
      const m = await cached(meta, co.issuer + '/.well-known/openid-configuration')
      const tok = await getJson(m.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: lasting.token, client_id: k.id, client_secret: k.secret }).toString() })
      if (tok.status === 400 || tok.status === 401) { const why = String(tok.j.error || ''); if (/invalid_grant|unauthorized_client|interaction_required|access_denied/.test(why)) return { gone: 'the company login no longer accepts this person (' + why + ')' } }
      if (!tok.j.id_token) return { error: 'the company login answered ' + tok.status }
      const c = await verifyIdToken(co, tok.j.id_token, null, k.id)
      const email = String(c.email || c.preferred_username || '').toLowerCase() || null
      const profile = oidcProfile(co, c, email)
      if (profile.id !== knownId) return { gone: 'the company login now says this is someone else' }
      const provider = co.login === 'entra' ? 'microsoft' : co.login === 'google-workspace' ? 'google' : 'oidc'
      const check = checkSignIn({ domains: co.domains, idp: { microsoft: { tid: co.tenantId }, oidc: { issuer: co.issuer, audience: k.id } } }, { provider, claims: { ...c, email, email_verified: true } })
      if (!check.ok) return { gone: 'no longer a ' + co.name + ' account (' + check.code + ')' }
      return { ok: true, profile, ...(tok.j.refresh_token ? { lasting: { kind: 'refresh', token: tok.j.refresh_token } } : {}) }
    } catch (e) { return { error: String(e.message).slice(0, 160) } }
  }

  return { companies, ready, start, finish, recheck }
}
