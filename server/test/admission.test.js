// Admission state machine (server/admission.js). Pure function, so this runs on fixtures with no server and no network.
import assert from 'node:assert'
import { admit, may, resolveAge, bandFromDob, MINOR_MODES, NEVER_A_GUARDIAN_METHOD } from '../admission.js'

const T = { sha256: 'aaa', status: 'published' }
const opts = { terms: T, production: true, guardianMethods: ['card_check'] }
const base = () => ({
  identity: { authenticated: true, emailVerified: true },
  activation: 'active',
  age: { claims: [{ band: 'adult', source: 'self_declared' }] },
  terms: { acceptedSha256: 'aaa' },
  guardian: { state: 'not_required' }
})
const make = patch => ({ ...base(), ...patch })
const state = (facts, o = opts) => admit(facts, o).state

// --- the happy paths
assert.strictEqual(state(base()), 'active')
assert.ok(may(admit(base(), opts), 'lease.start'), 'an adult may start a cloud environment')
const minorOk = admit(make({ age: { claims: [{ band: '13-17', source: 'self_declared' }] }, guardian: { state: 'verified', method: 'card_check' } }), opts)
assert.strictEqual(minorOk.state, 'active_restricted')
assert.deepStrictEqual(minorOk.restrictions.modes, MINOR_MODES)
assert.strictEqual(minorOk.restrictions.bypass, false)
for (const cap of ['lease.start', 'runner.use', 'share', 'upload', 'memory.write']) assert.ok(!may(minorOk, cap), 'a minor never gets ' + cap)

// --- order of the checks
assert.strictEqual(state(make({ identity: { authenticated: false } })), 'anonymous')
assert.strictEqual(state(make({ identity: { authenticated: true, emailVerified: false } })), 'identified')
assert.strictEqual(state(make({ age: { claims: [] } })), 'needs_age')
assert.strictEqual(state(make({ terms: { acceptedSha256: null } })), 'needs_terms')
assert.strictEqual(state(make({ terms: { acceptedSha256: 'old-version' } })), 'needs_terms', 'a new Terms version asks again')
// age is settled BEFORE terms: an account with no age and no terms is asked for age first, so nothing identifiable about a possible minor is stored
assert.strictEqual(admit(make({ age: { claims: [] }, terms: { acceptedSha256: null } }), opts).next, 'age')
assert.strictEqual(state(make({ activation: 'suspended' })), 'suspended')
assert.strictEqual(state(make({ activation: 'deletion_requested' })), 'deletion_requested')
// suspended wins over everything else, even a perfect account
assert.deepStrictEqual(admit(make({ activation: 'suspended' }), opts).capabilities, ['account.logout', 'account.delete'])

// --- age: unknown is never adult, provider claims only tighten
assert.strictEqual(resolveAge([]).band, 'unknown')
assert.strictEqual(resolveAge([{ band: 'adult', source: 'provider_claim' }]).band, 'unknown', 'a provider alone never makes someone an adult')
assert.strictEqual(resolveAge([{ band: 'adult', source: 'self_declared' }, { band: 'adult', source: 'provider_claim' }]).band, 'adult')
const conflict = resolveAge([{ band: 'adult', source: 'self_declared' }, { band: '13-17', source: 'provider_claim' }])
assert.deepStrictEqual(conflict, { band: '13-17', conflict: true }, 'declared adult, provider says 15: the stricter band wins and the conflict is flagged')
assert.strictEqual(resolveAge([{ band: 'under13', source: 'self_declared' }, { band: 'adult', source: 'school_roster' }]).band, 'under13')
assert.strictEqual(resolveAge([{ band: 'banana', source: 'self_declared' }, null]).band, 'unknown', 'junk claims are ignored')
assert.strictEqual(state(make({ age: { claims: [{ band: 'adult', source: 'provider_claim' }] } })), 'needs_age')

// --- every minor waits for a guardian; no method configured means nobody is ever verified
for (const band of ['under13', '13-17']) {
  const minor = guardian => make({ age: { claims: [{ band, source: 'self_declared' }] }, guardian })
  assert.strictEqual(state(minor({ state: 'not_required' })), 'guardian_pending', band + ': not_required is not enough for a minor')
  assert.strictEqual(state(minor({ state: 'required_pending' })), 'guardian_pending')
  assert.strictEqual(state(minor({ state: 'revoked' })), 'guardian_pending', 'a revoked guardian puts the minor back on hold')
  assert.strictEqual(state(minor({ state: 'verified', method: 'card_check' })), 'active_restricted')
  assert.strictEqual(state(minor({ state: 'verified', method: 'card_check' }), { ...opts, guardianMethods: [] }), 'guardian_pending', 'no configured method: nobody is verified')
  assert.strictEqual(state(minor({ state: 'verified', method: 'other_method' })), 'guardian_pending', 'a method the operator did not configure does not count')
  for (const bad of NEVER_A_GUARDIAN_METHOD) {
    assert.strictEqual(state(minor({ state: 'verified', method: bad }), { ...opts, guardianMethods: [bad, 'card_check'] }), 'guardian_pending', bad + ' can never verify a guardian even if configured')
  }
}

// --- Terms: draft text is refused in production, accepted in a dev server
const draft = { sha256: 'aaa', status: 'draft' }
assert.strictEqual(state(base(), { ...opts, terms: draft }), 'terms_unavailable')
assert.strictEqual(state(base(), { ...opts, terms: draft, production: false }), 'active')
assert.strictEqual(state(base(), { ...opts, terms: {} }), 'terms_unavailable', 'no Terms at all blocks sign-up rather than skipping it')

// --- blocked states reach only the pages that finish sign-up, log out and delete
for (const f of [make({ age: { claims: [] } }), make({ terms: { acceptedSha256: null } }), make({ age: { claims: [{ band: '13-17', source: 'self_declared' }] } })]) {
  const a = admit(f, opts)
  assert.deepStrictEqual(a.capabilities, ['account.complete', 'account.logout', 'account.delete'])
  for (const cap of ['chat', 'agent.start', 'room.join', 'share', 'upload', 'runner.use', 'lease.start']) assert.ok(!may(a, cap), a.state + ' must not allow ' + cap)
}
assert.ok(!may(null, 'chat') && !may({}, 'chat'), 'a missing admission allows nothing')

// --- property check: no combination of facts ever lets an unknown-age or unverified-minor account use the product
const bands = ['under13', '13-17', 'adult']; const sources = ['self_declared', 'provider_claim', 'school_roster', 'guardian_attested']
const guardians = [{ state: 'not_required' }, { state: 'required_pending' }, { state: 'revoked' }, { state: 'verified', method: 'typed_name' }, { state: 'verified', method: 'ip' }, { state: 'verified', method: 'sso' }, { state: 'verified' }]
let checked = 0
for (const b of bands) for (const s of sources) for (const g of guardians) for (const acc of ['aaa', null]) for (const methods of [[], ['typed_name', 'ip', 'sso']]) {
  const a = admit(make({ age: { claims: [{ band: b, source: s }] }, guardian: g, terms: { acceptedSha256: acc } }), { ...opts, guardianMethods: methods })
  checked++
  if (b !== 'adult') assert.ok(!['active', 'active_restricted'].includes(a.state), `minor admitted without a real guardian method: ${b} ${s} ${JSON.stringify(g)} ${JSON.stringify(methods)}`)
  if (acc === null) assert.ok(!['active', 'active_restricted'].includes(a.state), 'admitted without accepting the Terms')
  if (b === 'adult' && s === 'provider_claim') assert.notStrictEqual(a.state, 'active', 'provider-only adult admitted')
}

// --- date of birth to band: only a complete, real YYYY-MM-DD string counts; everything else is unknown (never adult)
const now = new Date('2026-11-02T12:00:00Z')
const none = { band: null, nextBandChangeOn: null }
// A review probe (2026-11-02): new Date() used to invent a date from each of these and report an adult
for (const bad of [null, undefined, 0, 1, 946684800000, '', ' ', '2000', '2000-02', '2000-2-3', '2000-02-3', ' 2000-02-03', '2000-02-03 ', '2000-02-03T00:00:00Z', '2000/02/03', '03-02-2000', 'abcd-ef-gh',
  '2000-02-30', '2000-13-01', '2000-00-10', '2000-01-00', '2000-04-31', '1999-02-29', '1900-02-29', '0000-01-01', '1899-12-31', '2026-11-03', '2999-01-01', {}, [], ['2000-01-01'], { toString: () => '2000-01-01' }, new String('2000-01-01'), true, new Date('2000-01-01')]) {
  assert.deepStrictEqual(bandFromDob(bad, now), none, 'must be unknown, not a band: ' + JSON.stringify(bad))
}
for (const badNow of [null, 0, '2026-11-02', new Date('nope'), {}]) { // (undefined means "use the real clock")
  assert.deepStrictEqual(bandFromDob('2000-01-01', badNow), none, 'a missing or invalid clock is unknown, not "now = 1970"')
}
assert.strictEqual(bandFromDob('2000-02-29', now).band, 'adult', 'a real leap day is accepted')
assert.strictEqual(bandFromDob('2026-11-02', now).band, 'under13', 'born today is valid')
assert.deepStrictEqual(bandFromDob('2026-11-02', now), { band: 'under13', nextBandChangeOn: '2039-11-02' })
// exact boundaries (UTC day granularity)
assert.deepStrictEqual(bandFromDob('2013-11-03', now), { band: 'under13', nextBandChangeOn: '2026-11-03' }, 'turns 13 tomorrow')
assert.deepStrictEqual(bandFromDob('2013-11-02', now), { band: '13-17', nextBandChangeOn: '2031-11-02' }, 'turns 13 today')
assert.deepStrictEqual(bandFromDob('2008-11-03', now), { band: '13-17', nextBandChangeOn: '2026-11-03' }, 'turns 18 tomorrow')
assert.deepStrictEqual(bandFromDob('2008-11-02', now), { band: 'adult', nextBandChangeOn: null }, 'turns 18 today')
assert.strictEqual(bandFromDob('2008-11-02', new Date('2026-11-01T23:59:59Z')).band, '13-17', 'one second before the 18th birthday')
assert.strictEqual(bandFromDob('2008-11-02', new Date('2026-11-02T00:00:00Z')).band, 'adult', 'at midnight UTC of the birthday')
// leap-day birthdays: in a year with no 29 February the birthday counts on 1 March (the stricter, later day). A target year is never a leap year for 13 or 18.
assert.deepStrictEqual(bandFromDob('2012-02-29', new Date('2025-02-28T00:00:00Z')), { band: 'under13', nextBandChangeOn: '2025-03-01' }, 'leap-day child, 28 Feb of the 13th year')
assert.strictEqual(bandFromDob('2012-02-29', new Date('2025-03-01T00:00:00Z')).band, '13-17', 'and on 1 March')
assert.deepStrictEqual(bandFromDob('2008-02-29', new Date('2026-02-28T00:00:00Z')), { band: '13-17', nextBandChangeOn: '2026-03-01' }, 'leap-day teen, 28 Feb of the 18th year')
assert.strictEqual(bandFromDob('2008-02-29', new Date('2026-03-01T00:00:00Z')).band, 'adult')
// a person's band never moves backwards as time passes
let last = -1; for (let d = new Date('2020-01-01T00:00:00Z'); d < new Date('2040-01-01T00:00:00Z'); d = new Date(d.getTime() + 86400000 * 7)) {
  const rank = ['under13', '13-17', 'adult'].indexOf(bandFromDob('2012-02-29', d).band); if (rank !== -1) { assert.ok(rank >= last, 'band went backwards'); last = rank }
}

console.log(`admission tests passed: matrix + ${checked} property combinations`)
