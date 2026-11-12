// LTI 1.3: a teacher adds VESPR to a Canvas or D2L Brightspace course; a student clicks it and lands in VESPR signed in. VESPR is the tool
// (the school's LMS stays the place people log in); this is how school apps sign students in from an LMS, rather than VESPR being a login
// server for the school. the team, 2026-11-06: "then also do microsoft, clever, canvas, classlink" (school single sign-on).
//
//   GET|POST /auth/lti/login     the LMS starts here (OIDC third-party login: iss, login_hint, target_link_uri, lti_message_hint, client_id)
//                                -> the LMS's authorize URL (response_type=id_token, response_mode=form_post, prompt=none, state, nonce)
//   POST     /auth/lti/launch    the LMS posts the signed id_token here: signature (the LMS's published keys), issuer, audience, expiry,
//                                nonce, LTI version, message type and deployment are checked; then the student is signed in
//   GET      /auth/lti/jwks      VESPR's own public key (the LMS asks for it when the tool is registered)
//   GET      /auth/lti/canvas.json  paste-ready Canvas developer key configuration ("Enter URL")
//
// Kids first (COPPA): the student is known by the LMS's opaque id (sub); a name and email are used only if the school chose to share them.
// No email is needed. An email that already belongs to a VESPR account is never used to sign into that account (an LMS admin can type any
// email); the student gets their own school account instead.
// Schools ("platforms") are registered by the operator: <data>/auth/lti-platforms.json and/or VESPR_LTI_PLATFORMS (JSON), e.g.
//   [{ "kind": "canvas", "clientId": "10000000000123" }, { "kind": "d2l", "host": "school.brightspace.com", "clientId": "abc" }]
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const STATE_TTL_MS = 10 * 60 * 1000
const b64u = b => Buffer.from(b).toString('base64url')
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const LTI = 'https://purl.imsglobal.org/spec/lti/claim/'

// Instructure's cloud Canvas (all *.instructure.com schools share these); a self-hosted Canvas gives its own as "issuer"/"host".
const PRESETS = {
  canvas: p => ({ issuer: p.issuer || 'https://canvas.instructure.com', authUrl: p.authUrl || (p.host ? `https://${p.host}/api/lti/authorize_redirect` : 'https://sso.canvaslms.com/api/lti/authorize_redirect'), jwksUrl: p.jwksUrl || (p.host ? `https://${p.host}/api/lti/security/jwks` : 'https://sso.canvaslms.com/api/lti/security/jwks') }),
  d2l: p => ({ issuer: p.issuer || `https://${p.host}`, authUrl: p.authUrl || `https://${p.host}/d2l/lti/authenticate`, jwksUrl: p.jwksUrl || `https://${p.host}/d2l/.well-known/jwks` })
}
const NAMES = { canvas: 'Canvas', d2l: 'D2L Brightspace' }

export function readPlatforms ({ DATA, config }) {
  let list = []
  try { list = list.concat(JSON.parse(fs.readFileSync(path.join(DATA, 'auth', 'lti-platforms.json'), 'utf8'))) } catch {}
  try { if (config.VESPR_LTI_PLATFORMS) list = list.concat(JSON.parse(config.VESPR_LTI_PLATFORMS)) } catch {}
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object' || !raw.clientId) continue
    if (raw.host && !/^[a-z0-9.-]+(:\d+)?$/i.test(raw.host)) continue
    const p = { name: raw.name || NAMES[raw.kind] || 'School LMS', kind: raw.kind || 'other', clientId: String(raw.clientId), deploymentIds: Array.isArray(raw.deploymentIds) ? raw.deploymentIds.map(String) : [], ...(PRESETS[raw.kind] ? PRESETS[raw.kind](raw) : { issuer: raw.issuer, authUrl: raw.authUrl, jwksUrl: raw.jwksUrl }) }
    if (![p.issuer, p.authUrl, p.jwksUrl].every(x => /^https:\/\/[^\s]+$/.test(String(x || '')))) continue
    p.id = raw.id || crypto.createHash('sha256').update(p.issuer + '|' + p.clientId).digest('hex').slice(0, 12)
    out.push(p)
  }
  return out
}

async function defaultRequest ({ url }) {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) })
  return { status: r.status, text: await r.text() }
}

// signIn({ platform, sub, email, name, roles, context }) -> { token } | { status, error }: the account rules live in auth.js
export function createLti ({ DATA, config = process.env, now = Date.now, random = n => crypto.randomBytes(n), request = defaultRequest, signIn }) {
  const dir = path.join(DATA, 'auth'); try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  const states = new Map() // state -> { pid, nonce, expiresAt }
  const jwksCache = new Map() // url -> { keys, at }
  const auditFile = path.join(dir, 'lti.log.jsonl')
  const audit = e => { try { fs.appendFileSync(auditFile, JSON.stringify({ at: new Date(now()).toISOString(), ...e }) + '\n', { mode: 0o600 }) } catch {} }
  const platforms = () => readPlatforms({ DATA, config })

  // VESPR's own key pair (the LMS fetches the public half from /auth/lti/jwks); made once, kept beside the data, mode 600
  let toolKey = null
  function key () {
    if (toolKey) return toolKey
    const f = path.join(dir, 'lti-tool-key.pem'); let pem
    try { pem = fs.readFileSync(f, 'utf8') } catch {}
    if (!pem) { pem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }); fs.writeFileSync(f, pem, { mode: 0o600 }) }
    const pub = crypto.createPublicKey(pem).export({ format: 'jwk' })
    toolKey = { pem, jwk: { kty: pub.kty, n: pub.n, e: pub.e, alg: 'RS256', use: 'sig', kid: crypto.createHash('sha256').update(pub.n).digest('base64url').slice(0, 16) } }
    return toolKey
  }

  function page (title, text, status = 400) {
    return { status, html: `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=referrer content=no-referrer><title>VESPR</title>
<body style="margin:0;font:16px/1.5 system-ui,sans-serif;background:#0b0b0d;color:#eee;display:grid;place-items:center;min-height:100vh"><main style="max-width:520px;padding:24px;text-align:center">
<h1 style="font-size:22px;margin:0 0 10px">${esc(title)}</h1><p>${esc(text)}</p></main>` }
  }

  // step 1: the LMS says "this person wants to open VESPR"; send them back to the LMS to get a signed statement of who they are
  function login (params, base) {
    for (const [s, v] of states) if (v.expiresAt <= now()) states.delete(s)
    const iss = String(params.iss || ''); const cid = params.client_id ? String(params.client_id) : null
    const match = platforms().filter(p => p.issuer === iss && (!cid || p.clientId === cid))
    if (match.length !== 1) { audit({ event: 'login_unknown', iss, clientId: cid }); return page('This school is not set up yet', match.length ? 'More than one VESPR registration matches this school; the LMS must send its client id.' : 'VESPR does not know this school\'s LMS yet. Ask your school to contact VESPR to finish adding it.') }
    if (!params.login_hint) return page('Could not start', 'The LMS did not say who is signing in (login_hint). Try the VESPR link again.')
    const p = match[0]; const state = b64u(random(24)); const nonce = b64u(random(24))
    states.set(state, { pid: p.id, nonce, expiresAt: now() + STATE_TTL_MS })
    const q = new URLSearchParams({ scope: 'openid', response_type: 'id_token', response_mode: 'form_post', prompt: 'none', client_id: p.clientId, redirect_uri: base + '/auth/lti/launch', login_hint: String(params.login_hint), state, nonce })
    if (params.lti_message_hint) q.set('lti_message_hint', String(params.lti_message_hint))
    return { redirect: p.authUrl + '?' + q.toString() }
  }

  async function jwks (url, kid, retry = true) {
    let c = jwksCache.get(url)
    if (!c || now() - c.at > 60 * 60 * 1000 || (retry && !c.keys.some(k => k.kid === kid))) {
      const r = await request({ url }); if (r.status !== 200) throw new Error('the school\'s keys could not be read (' + r.status + ')')
      const j = JSON.parse(r.text); c = { keys: j.keys || [], at: now() }; jwksCache.set(url, c)
    }
    const k = c.keys.find(x => x.kid === kid); if (!k) throw new Error('the school signed with a key it does not publish')
    return k
  }
  async function verify (idToken, p) {
    const parts = String(idToken || '').split('.'); if (parts.length !== 3) throw new Error('no signed statement')
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (header.alg !== 'RS256') throw new Error('unsupported signature ' + header.alg)
    const k = await jwks(p.jwksUrl, header.kid)
    const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: k, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))
    if (!ok) throw new Error('the signature does not match')
    const t = Math.floor(now() / 1000)
    if (claims.iss !== p.issuer) throw new Error('wrong issuer')
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!aud.includes(p.clientId) || (aud.length > 1 && claims.azp !== p.clientId)) throw new Error('not addressed to VESPR')
    if (!claims.exp || claims.exp < t - 60) throw new Error('expired')
    if (claims.iat && claims.iat > t + 60) throw new Error('issued in the future (check the clock)')
    return claims
  }

  // step 2: the LMS posts who it is; check everything, then sign the student in
  async function launch (form) {
    const rec = states.get(String(form.state || '')); states.delete(String(form.state || ''))
    if (!rec || rec.expiresAt <= now()) return page('This link has expired', 'Open VESPR again from your course.')
    if (form.error) return page('Your school did not sign you in', String(form.error_description || form.error).slice(0, 200))
    const p = platforms().find(x => x.id === rec.pid); if (!p) return page('This school is not set up any more', 'Ask your school to contact VESPR.')
    let c
    try { c = await verify(form.id_token, p) } catch (e) { audit({ event: 'launch_refused', platform: p.id, why: e.message }); return page('VESPR could not check this sign-in', 'It was refused: ' + e.message + '.') }
    const why = c.nonce !== rec.nonce ? 'wrong nonce'
      : c[LTI + 'version'] !== '1.3.0' ? 'not LTI 1.3'
        : c[LTI + 'message_type'] !== 'LtiResourceLinkRequest' ? 'VESPR only opens from a course link for now (' + String(c[LTI + 'message_type']).slice(0, 40) + ')'
          : p.deploymentIds.length && !p.deploymentIds.includes(String(c[LTI + 'deployment_id'])) ? 'this course\'s installation is not on VESPR\'s list'
            : !c.sub ? 'no student id' : null
    if (why) { audit({ event: 'launch_refused', platform: p.id, why }); return page('VESPR could not check this sign-in', 'It was refused: ' + why + '.') }
    const roles = (Array.isArray(c[LTI + 'roles']) ? c[LTI + 'roles'] : []).map(r => String(r).split('#').pop()).slice(0, 10)
    const name = c.name || [c.given_name, c.family_name].filter(Boolean).join(' ') || null
    const ctx = c[LTI + 'context'] || {}
    const r = await signIn({ platform: p, sub: String(c.sub), email: c.email ? String(c.email).toLowerCase() : null, name, roles, context: { id: ctx.id || null, title: ctx.title || null } })
    if (!r.token) { audit({ event: 'signin_refused', platform: p.id, why: r.error }); return page('VESPR could not sign you in', r.error || 'Try again.') }
    audit({ event: 'launch', platform: p.id, roles, course: ctx.id || null })
    // the token goes to the app in the #fragment (never to a server). Inside an LMS frame, open a new tab instead (school browsers block
    // sign-in cookies in frames); Canvas is told to open VESPR in a new tab anyway (canvas.json windowTarget).
    const to = '/app/#token=' + encodeURIComponent(r.token)
    return { status: 200, html: `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><meta name=referrer content=no-referrer><title>VESPR</title>
<body style="margin:0;font:16px/1.5 system-ui,sans-serif;background:#0b0b0d;color:#eee;display:grid;place-items:center;min-height:100vh"><main style="max-width:520px;padding:24px;text-align:center">
<h1 style="font-size:22px;margin:0 0 10px">Signed in from ${esc(p.name)}</h1><p><a id=go style="display:inline-block;background:#1e40af;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none" href="${esc(to)}" target="_blank" rel="noopener">Open VESPR</a></p></main>
<script>try{if(window.top===window.self)location.replace(${JSON.stringify(to)})}catch(e){}</script>` }
  }

  function canvasConfig (base) {
    const host = new URL(base).host
    const placement = where => ({ placement: where, message_type: 'LtiResourceLinkRequest', target_link_uri: base + '/auth/lti/launch', text: 'VESPR', windowTarget: '_blank' })
    return {
      title: 'VESPR', description: 'People and AI agents in the same files: a shared coding workspace for classes.',
      oidc_initiation_url: base + '/auth/lti/login', target_link_uri: base + '/auth/lti/launch', public_jwk_url: base + '/auth/lti/jwks',
      scopes: [],
      extensions: [{ domain: host, tool_id: 'vespr', platform: 'canvas.instructure.com', privacy_level: 'name_only', settings: { text: 'VESPR', placements: [placement('course_navigation'), placement('link_selection')] } }]
    }
  }

  // form bodies (the LMS posts application/x-www-form-urlencoded), at most 64 KB
  const readForm = req => new Promise((resolve, reject) => {
    let s = ''; req.on('data', d => { s += d; if (s.length > 65536) { reject(new Error('too large')); req.destroy() } })
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(s)))); req.on('error', reject)
  })

  async function http (req, res, u, { baseUrl, jsonResponse }) {
    const send = r => {
      if (r.redirect) { res.writeHead(302, { Location: r.redirect, 'Cache-Control': 'no-store' }); res.end(); return true }
      res.writeHead(r.status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(r.html); return true
    }
    if (u.pathname === '/auth/lti/jwks' && req.method === 'GET') return jsonResponse(res, 200, { keys: [key().jwk] }), true
    if (u.pathname === '/auth/lti/canvas.json' && req.method === 'GET') return jsonResponse(res, 200, canvasConfig(baseUrl)), true
    if (u.pathname === '/auth/lti/login' && (req.method === 'GET' || req.method === 'POST')) {
      let params = Object.fromEntries(u.searchParams); if (req.method === 'POST') { try { params = { ...params, ...(await readForm(req)) } } catch { return send(page('Could not start', 'The request was not understood.')) } }
      return send(login(params, baseUrl))
    }
    if (u.pathname === '/auth/lti/launch' && req.method === 'POST') { let f; try { f = await readForm(req) } catch { return send(page('Could not sign in', 'The request was not understood.')) } return send(await launch(f)) }
    return false
  }

  return { http, login, launch, platforms, jwk: () => key().jwk, canvasConfig }
}
