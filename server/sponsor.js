// A grown-up approves a kid's account (the team, 2026-11-06: kids sign in with their school, "but they either have to be accepted by an adult
// (teacher/parent) to use then they control payment and stuff"). The approving adult becomes the account's sponsor; who pays (parent,
// classroom, district) builds on this later.
//
//   POST /auth/sponsor/code                the kid: a short code and link for a grown-up (8 characters, 7 days; asking again replaces it)
//   GET  /auth/sponsor/lookup?code=        the adult: whose account this is (name, school, age band) before approving
//   POST /auth/sponsor/approve {code, as}  the adult (as: 'teacher' | 'parent'): approve; the kid's admission moves on
//
// Who must wait (admission.js "awaiting_adult"): school student accounts (user.sponsor.required), and every minor (the guardian rule:
// approval records guardian { state: verified, method: teacher_approval | parent_approval }, which counts only where the operator lists
// that method in VESPR_GUARDIAN_METHODS, since whether a click from an adult account is enough consent is a legal decision).
// Who may approve: a signed-in adult whose own account is active (age adult, Terms accepted), not a school student, not the kid.
import crypto from 'node:crypto'

export const CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O, 1/I/L: easy to read out loud
const norm = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const sha = s => crypto.createHash('sha256').update(s).digest('hex')
const WAITING = ['awaiting_adult', 'guardian_pending']

export function createSponsor ({ now = Date.now, random = n => crypto.randomBytes(n), getUsers, saveUsers, admissionFor }) {
  const tries = new Map() // adult id -> { n, since }: lookups and approvals, 20 a quarter hour (codes cannot be guessed by trying)
  const limited = id => { const t = tries.get(id); const fresh = !t || now() - t.since > 15 * 60 * 1000; const r = fresh ? { n: 0, since: now() } : t; r.n++; tries.set(id, r); return r.n > 20 }
  const band = u => { const c = ((u.age && u.age.claims) || []).filter(x => x && x.band); return c.length ? c[c.length - 1].band : null }

  function code (kid) {
    const state = admissionFor(kid).state
    if (!WAITING.includes(state)) return { status: 409, body: { error: 'This account does not need a grown-up\'s approval right now', state } }
    const bytes = random(8); let c = ''; for (let i = 0; i < 8; i++) c += ALPHABET[bytes[i] % ALPHABET.length]
    const users = getUsers(); const u = users[kid.id]; u.sponsorCode = { hash: sha(c), expiresAt: now() + CODE_TTL_MS }; saveUsers(users)
    return { status: 200, body: { code: c.slice(0, 4) + '-' + c.slice(4), expiresAt: u.sponsorCode.expiresAt } }
  }

  function find (c) {
    const h = sha(norm(c)); if (norm(c).length !== 8) return null
    return Object.values(getUsers()).find(u => u.sponsorCode && u.sponsorCode.hash === h && u.sponsorCode.expiresAt > now()) || null
  }
  function mayApprove (adult) {
    if (adult.school && adult.sponsor && adult.sponsor.required) return 'A student account cannot approve other accounts'
    const a = admissionFor(adult)
    if (a.state !== 'active') return 'Finish setting up your own account first (your age and the Terms), then approve'
    return null
  }

  function lookup (adult, c) {
    if (limited(adult.id)) return { status: 429, body: { error: 'Too many tries. Wait a few minutes.' } }
    const no = mayApprove(adult); if (no) return { status: 403, body: { error: no } }
    const kid = find(c); if (!kid) return { status: 404, body: { error: 'That code is not valid or has expired. Ask for a new one.' } }
    if (kid.id === adult.id) return { status: 400, body: { error: 'You cannot approve your own account' } }
    return { status: 200, body: { name: kid.name, school: (kid.school && kid.school.via) || null, ageBand: band(kid), state: admissionFor(kid).state } }
  }

  function approve (adult, c, as) {
    if (!['teacher', 'parent'].includes(as)) return { status: 400, body: { error: 'as: teacher or parent' } }
    if (limited(adult.id)) return { status: 429, body: { error: 'Too many tries. Wait a few minutes.' } }
    const no = mayApprove(adult); if (no) return { status: 403, body: { error: no } }
    const found = find(c); if (!found) return { status: 404, body: { error: 'That code is not valid or has expired. Ask for a new one.' } }
    if (found.id === adult.id) return { status: 400, body: { error: 'You cannot approve your own account' } }
    const users = getUsers(); const kid = users[found.id]; const by = { id: adult.id, name: adult.name, role: as, at: now() }
    kid.sponsor = { ...(kid.sponsor || {}), required: Boolean(kid.sponsor && kid.sponsor.required), state: 'approved', by }
    if (band(kid) !== 'adult') kid.guardian = { state: 'verified', method: as + '_approval', by: adult.id, at: now() }
    delete kid.sponsorCode
    const me = users[adult.id]; me.sponsoring = [...new Set([...(me.sponsoring || []), kid.id])]
    saveUsers(users)
    return { status: 200, body: { ok: true, name: kid.name, state: admissionFor(kid).state } }
  }

  async function http (req, res, u, { requireUser, parseBody, jsonResponse }) {
    if (u.pathname === '/auth/sponsor/lookup' && req.method === 'GET') { const a = requireUser(req, res); if (!a) return true; const r = lookup(a, u.searchParams.get('code')); return jsonResponse(res, r.status, r.body), true }
    const m = /^\/auth\/sponsor\/(code|approve)$/.exec(u.pathname)
    if (m && req.method === 'POST') {
      const who = requireUser(req, res, { write: true }); if (!who) return true
      let body = {}; try { body = await parseBody(req) } catch { return jsonResponse(res, 400, { error: 'Invalid request' }), true }
      const r = m[1] === 'code' ? code(who) : approve(who, body.code, body.as)
      return jsonResponse(res, r.status, r.body), true
    }
    return false
  }
  return { http, code, lookup, approve }
}
