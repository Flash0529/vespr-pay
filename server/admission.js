// Account admission: one pure function that says what a signed-in account may do, decided on the server from facts, never from the screen.
// PROPOSED and NOT WIRED: nothing in auth.js or index.js calls this yet.
//
//   admit(facts, opts) -> { state, next, capabilities, restrictions, reasons }
//
// facts: {
//   identity:   { authenticated: bool, emailVerified: bool },
//   activation: 'active' | 'suspended' | 'deletion_requested',
//   age:        { claims: [{ band: 'under13'|'13-17'|'adult', source: 'self_declared'|'provider_claim'|'school_roster'|'guardian_attested' }] },
//   terms:      { acceptedSha256: string | null },                      // hash of the exact text the account accepted
//   guardian:   { state: 'not_required'|'required_pending'|'verified'|'revoked', method?: string }
//   sponsor:    { required: bool, state: 'pending'|'approved' }    // school student accounts wait for a teacher or parent (server/sponsor.js)
// }
// opts: { terms: { sha256, status: 'draft'|'published' }, production: bool, guardianMethods: string[] }
//
// Rules this enforces (each has a test):
//  - Unknown age is never adult. A provider's age claim can only make the band stricter; adult needs a self-declared or school-roster adult claim and no stricter claim.
//  - Every minor stays guardian-pending until a guardian is verified BY A CONFIGURED METHOD. With no method configured nobody becomes verified, and typed-name / ip are never methods.
//  - Age is settled before the identifiable Terms acceptance is recorded, so nothing about a minor is kept before eligibility is known.
//  - Terms must be the current published version; a draft is refused when production is true.
//  - Blocked states may reach only the pages that finish sign-up, log out, and delete the account.

export const BANDS = ['under13', '13-17', 'adult'] // strictest first
export const NEVER_A_GUARDIAN_METHOD = ['typed_name', 'ip', 'checkbox', 'sso', 'email_click']

const ACCOUNT_PAGES = ['account.complete', 'account.logout', 'account.delete']
const FULL = [...ACCOUNT_PAGES, 'chat', 'agent.start', 'room.join', 'room.create', 'share', 'upload', 'runner.use', 'lease.start', 'memory.write']
const MINOR_ACTIVE = [...ACCOUNT_PAGES, 'chat', 'agent.start', 'room.join'] // no sharing, uploads, runners, cloud leases, memory writes
export const MINOR_MODES = ['manual', 'plan'] // same floor as server/policy.js STUDENT_MODES

const strictness = band => BANDS.indexOf(band)

// Exact band from a date of birth (UTC days), plus the day the band next changes, so a server can keep the band without keeping the birth date.
// Only a COMPLETE, REAL date string "YYYY-MM-DD" counts. Anything else (null, a number, "2000", "2000-02", "2000-02-30", a time stamp, a future date)
// is unknown ({ band: null }), never a guess: `new Date(x)` invents a date from null, 0, "2000" or "2000-02-30", which once made missing data look adult.
// A leap-day (29 Feb) birthday counts on 1 March in a year with no 29 February: the later, stricter day. (13 and 18 years after a leap day are never leap years.)
const NO_BAND = { band: null, nextBandChangeOn: null }
const DOB_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/
const dayNumber = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000 // m is 1-12; Date.UTC rolls 29 Feb into 1 Mar in a common year
const dayString = n => new Date(n * 86400000).toISOString().slice(0, 10)

export function bandFromDob (dob, now = new Date()) {
  if (typeof dob !== 'string' || !(now instanceof Date) || Number.isNaN(now.getTime())) return { ...NO_BAND }
  const m = DOB_FORMAT.exec(dob)
  if (!m) return { ...NO_BAND }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1900) return { ...NO_BAND }
  const born = new Date(Date.UTC(y, mo - 1, d))
  if (born.getUTCFullYear() !== y || born.getUTCMonth() !== mo - 1 || born.getUTCDate() !== d) return { ...NO_BAND } // 30 Feb, 31 Apr, 29 Feb in a common year, month 13...
  const today = dayNumber(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate())
  if (dayNumber(y, mo, d) > today) return { ...NO_BAND } // not born yet
  const on13 = dayNumber(y + 13, mo, d); const on18 = dayNumber(y + 18, mo, d)
  if (today < on13) return { band: 'under13', nextBandChangeOn: dayString(on13) }
  if (today < on18) return { band: '13-17', nextBandChangeOn: dayString(on18) }
  return { band: 'adult', nextBandChangeOn: null }
}

// Combine age claims. Returns { band: 'under13'|'13-17'|'adult'|'unknown', conflict: bool }.
export function resolveAge (claims = []) {
  const valid = claims.filter(c => c && BANDS.includes(c.band))
  if (!valid.length) return { band: 'unknown', conflict: false }
  const strictest = valid.reduce((a, c) => (strictness(c.band) < strictness(a) ? c.band : a), 'adult')
  const conflict = valid.some(c => c.band !== strictest)
  if (strictest === 'adult') {
    // adult only on the word of the person or their school; a provider alone never makes someone an adult
    const trusted = valid.some(c => c.band === 'adult' && (c.source === 'self_declared' || c.source === 'school_roster'))
    if (!trusted) return { band: 'unknown', conflict }
  }
  return { band: strictest, conflict }
}

const blocked = (state, next, reasons) => ({ state, next, capabilities: [...ACCOUNT_PAGES], restrictions: {}, reasons })

export function admit (facts = {}, opts = {}) {
  const identity = facts.identity || {}
  const terms = opts.terms || {}
  const methods = (opts.guardianMethods || []).filter(m => !NEVER_A_GUARDIAN_METHOD.includes(m))

  if (facts.activation === 'deletion_requested') return { state: 'deletion_requested', next: null, capabilities: ['account.logout', 'account.delete'], restrictions: {}, reasons: ['deletion requested'] }
  if (facts.activation === 'suspended') return { state: 'suspended', next: null, capabilities: ['account.logout', 'account.delete'], restrictions: {}, reasons: ['account suspended'] }
  if (!identity.authenticated) return { state: 'anonymous', next: 'sign_in', capabilities: [], restrictions: {}, reasons: ['not signed in'] }
  // domain lock (server/lifecycle.js): this email's organization requires its own login, and this account has not used it
  if (facts.org?.loginRequired) return blocked('org_login_required', 'org_login', ['the organization requires its own login'])
  if (!identity.emailVerified) return blocked('identified', 'verify_email', ['e-mail not verified'])

  const age = resolveAge(facts.age?.claims)
  if (age.band === 'unknown') return blocked('needs_age', 'age', [age.conflict ? 'age claims conflict and none is trusted' : 'age not settled'])

  if (!terms.sha256 || (opts.production && terms.status !== 'published')) return blocked('terms_unavailable', null, ['no published Terms to accept'])
  if (facts.terms?.acceptedSha256 !== terms.sha256) return blocked('needs_terms', 'terms', ['current Terms not accepted'])

  // a school student account is used only after a grown-up (teacher or parent) approves it, whatever the age band
  if (facts.sponsor?.required && facts.sponsor.state !== 'approved') return blocked('awaiting_adult', 'adult', ['a teacher or parent has to approve this account'])

  if (age.band !== 'adult') {
    const g = facts.guardian || {}
    const verified = g.state === 'verified' && methods.includes(g.method)
    if (!verified) return blocked('guardian_pending', 'guardian', [g.state === 'verified' ? 'guardian method not accepted' : 'guardian not verified'])
    return { state: 'active_restricted', next: null, capabilities: [...MINOR_ACTIVE], restrictions: { modes: [...MINOR_MODES], bypass: false, remoteExecution: false }, reasons: ['minor with a verified guardian'] }
  }
  return { state: 'active', next: null, capabilities: [...FULL], restrictions: {}, reasons: [] }
}

// The one question every protected route asks.
export const may = (admission, capability) => Array.isArray(admission?.capabilities) && admission.capabilities.includes(capability)
