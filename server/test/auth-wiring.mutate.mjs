// Mutation check for auth-wiring.test.js: breaks auth.js / mail.js on purpose, one change at a time, in a temporary copy,
// and requires the test to fail each time. Run: node server/test/auth-wiring.mutate.mjs   (prints "mutations caught: N/N")
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const server = path.join(here, '..')
const mutations = [
  ['auth.js', 'state cookie not compared', "if (!stateKey || !safeEqual(stateCookie, stateKey)) {", 'if (false) {'],
  ['auth.js', 'PKCE verifier not sent', 'codeVerifier: stateRecord.codeVerifier, nonce: stateRecord.nonce, redirectUri: callbackUrl })', "codeVerifier: 'x', nonce: stateRecord.nonce, redirectUri: callbackUrl })"],
  ['auth.js', 'state reusable', '        oauthStates.delete(stateKey)\n\n        let profile = null', '        let profile = null'],
  ['auth.js', 'open redirect allowed', '    if (!targetUrl) return false\n', '    return true\n'],
  ['auth.js', 'cookie not HttpOnly', "const attrs = ['HttpOnly', 'SameSite=Lax'", "const attrs = ['SameSite=Lax'"],
  ['auth.js', 'cookie not SameSite', "'HttpOnly', 'SameSite=Lax', 'Path=/'", "'HttpOnly', 'Path=/'"],
  ['auth.js', 'proxy header trusted by default', "const trustProxy = config.VESPR_AUTH_TRUST_PROXY === '1'", 'const trustProxy = true'],
  ['auth.js', 'forwarded address ignored behind proxy', "(trustProxy && fwd.length ? fwd[fwd.length - 1] : req.socket.remoteAddress)", 'req.socket.remoteAddress'],
  ['auth.js', 'Secure never set', 'if (secureRequest(req)) attrs.push', 'if (false) attrs.push'],
  ['auth.js', 'CSRF not checked on writes', 'if (write && viaCookie && !safeEqual', 'if (false && write && viaCookie && !safeEqual'],
  ['auth.js', 'CSRF not checked on logout', "if (viaCookie && !safeEqual(req.headers['x-csrf-token'] || '', csrfFor(token))) {\n          return jsonResponse(res, 403", "if (false) {\n          return jsonResponse(res, 403"],
  ['auth.js', 'Origin not checked', "if (req.method === 'POST' && !originAllowed(req)) {", 'if (false) {'],
  ['auth.js', 'form posts accepted', "!/^application\\/json\\b/i.test(req.headers['content-type'] || '')", 'false'],
  ['auth.js', 'lockout threshold off', 'const RATE_MAX_FAILURES = 5', 'const RATE_MAX_FAILURES = 5000'],
  ['auth.js', 'no Retry-After', "{ 'Retry-After': String(retryAfter) }", '{}'],
  ['auth.js', 'TOTP replay allowed', 'verifiedStep > (user.totp.lastStep || 0)', 'verifiedStep >= 0'],
  ['auth.js', 'recovery code reusable', 'user.recoveryCodes.splice(matchIndex, 1)', 'void matchIndex'],
  ['auth.js', 'SMS not sent at login', 'await sendSms(user.sms.phone)', 'await 0'],
  ['auth.js', 'SMS send failure reported as sent', "return jsonResponse(res, 502, { error: 'Could not send the SMS code.", "smsSent = true; if (false) return jsonResponse(res, 502, { error: 'Could not send the SMS code."],
  ['auth.js', 'SMS verify trusts request phone', "const phone = String(user.sms?.pendingPhone || '')", "const phone = String(body.phone || user.sms?.pendingPhone || '')"],
  ['auth.js', 'SMS wrong-code count missing', 'recordFailure(smsVerifyKey)', 'void smsVerifyKey'],
  ['auth.js', 'NODE_ENV test backdoor', 'async function checkSms (toPhone, code) {', "async function checkSms (toPhone, code) {\n    if (config.NODE_ENV === 'test' && code === '123456') return true"],
  ['auth.js', 'verify token stored in clear', 'emailVerificationTokens.set(sha256Hex(verifyToken), {', 'emailVerificationTokens.set(verifyToken, {'],
  ['auth.js', 'verify link reusable', 'emailVerificationTokens.delete(token)', 'void token'],
  ['auth.js', 'mail failure reported as sent', "return { delivery: 'failed', verifyToken }", "return { delivery: 'sent', verifyToken }"],
  ['auth.js', 'resend reveals accounts', "mailDelivery: target ? mailDelivery : 'none'", "mailDelivery: target ? mailDelivery : 'unknown-account'"],
  ['auth.js', 'base URL ignored', "String(config.VESPR_AUTH_BASE_URL || `http://", "String(`http://"],
  ['auth.js', 'sign-up limit off', 'recordFailure(regKey)', 'void regKey'],
  ['auth.js', 'session token stored in clear', 'sessions[sha256Hex(rawSessionToken)] = {', 'sessions[rawSessionToken] = {'],
  ['tools/seed-users.js', 'seeded account unverified', 'emailVerified: true, createdAt', 'emailVerified: false, createdAt'],
  ['tools/seed-users.js', 'password file world-readable', "fs.chmodSync(outFile, 0o600)", "fs.chmodSync(outFile, 0o644)"],
  ['tools/seed-users.js', 'existing account overwritten', "{ skipped.push(email); continue }", "{ skipped.push(email) }"],
  ['mail.js', 'allow-list off', "if (allow.length && !allow.includes(to.toLowerCase()))", 'if (false)'],
  ['mail.js', 'header injection allowed', "if (!ADDRESS.test(to) || BAD_HEADER.test(to) || BAD_HEADER.test(subject))", 'if (!ADDRESS.test(to))'],
  ['mail.js', 'dot-stuffing off', ".replace(/^\\./gm, '..')", ''],
  ['mail.js', 'plaintext allowed with requireTls', "} else if (!secure && requireTls) {", '} else if (false) {'],
  ['mail.js', 'credentials not sent', 'if (user) await cmd(', 'if (false) await cmd(']
]

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-mutate-'))
fs.mkdirSync(path.join(tmp, 'test'))
for (const f of ['auth.js', 'mail.js']) fs.copyFileSync(path.join(server, f), path.join(tmp, f))
for (const f of ['auth-wiring.test.js', 'auth-fakes.js']) fs.copyFileSync(path.join(here, f), path.join(tmp, 'test', f))
fs.mkdirSync(path.join(tmp, 'tools')); fs.copyFileSync(path.join(server, 'tools', 'seed-users.js'), path.join(tmp, 'tools', 'seed-users.js'))
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')

function runTest () {
  for (let i = 0; i < 12; i++) {
    const r = spawnSync('node', ['test/auth-wiring.test.js'], { cwd: tmp, encoding: 'utf8', timeout: 180000 })
    if (r.stderr != null && !r.error && !/pthread_create|EAGAIN/.test(r.stderr)) return r
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000) // the machine is out of processes or threads: wait and retry
  }
  return { status: 1, stderr: 'machine out of threads' }
}
let base = runTest()
for (let i = 0; i < 2 && base.status !== 0; i++) base = runTest() // a shared, busy machine can drop one run
if (base.status !== 0) { console.log('the unmodified test must pass first:\n' + base.stderr.slice(-400)); process.exit(2) }
let caught = 0
const survived = []
for (const [file, name, from, to] of mutations) {
  if (process.env.ONLY && !process.env.ONLY.split(',').some(o => name.includes(o))) continue
  const orig = fs.readFileSync(path.join(server, file), 'utf8')
  if (orig.split(from).length !== 2) { console.log(`BAD MUTATION (pattern must occur once): ${name}`); survived.push(name); continue }
  fs.writeFileSync(path.join(tmp, file), orig.replace(from, to))
  let r = runTest()
  // only a real assertion failure counts: a crash (out of threads, timeout, dropped socket) proves nothing, so try again
  for (let i = 0; i < 3 && r.status !== 0 && !/AssertionError/.test(r.stderr); i++) r = runTest()
  fs.writeFileSync(path.join(tmp, file), orig)
  if (r.status !== 0 && /AssertionError/.test(r.stderr)) { caught++; console.log(`caught   ${name}`) } else { survived.push(name); console.log(`SURVIVED ${name} (exit ${r.status}) ${String(r.stderr).split('\n').slice(-6).join(' | ').slice(0, 300)}`) }
}
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`mutations caught: ${caught}/${mutations.length}`)
process.exit(survived.length ? 1 : 0)
