// VESPR "where was I going": remembers a share link, room or file across sign-in, wrong-password retries and reloads, then lands the person there.
// Pure functions plus a storage argument, so Node tests run them with a fake storage. The target lives in per-tab sessionStorage only: never localStorage, never a URL, and never logged.
//
//   saveTarget(sessionStorage, { kind: 'share', token })            // when a share link is opened while signed out
//   loadTarget(sessionStorage)  -> target | null                    // read without removing: a failed sign-in keeps it
//   clearTarget(sessionStorage)                                     // after the person has landed, or was told why not
//   landAfterSignIn({ target, user, context, can })
//        -> { kind: 'home' }                                        // nothing was waiting
//         | { kind: 'land', target }                                // go to the target
//         | { kind: 'blocked', reason }                             // show the reason, not the target
//
// `can` is server/policy.js can(user, action, context), passed in so this module does not depend on the server.

const KEY = 'vespr-return'
export const TARGET_TTL_MS = 30 * 60 * 1000
const TOKEN = /^[A-Za-z0-9_-]{43}$/
const ROOM = /^[A-Za-z0-9_-]{1,64}$/
const FILE = /^[A-Za-z0-9_.\/-]{1,200}$/
// The server address of a share link is not a secret; it is kept so a reload can reconnect. Only http(s) origins with no path, query or credentials.
const SERVER = /^https?:\/\/[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?$/

// Accepts only the shapes above; anything else (extra fields, bad tokens, path tricks) is dropped, so a stored value cannot widen what is opened.
export function cleanTarget (t, now = Date.now()) {
  if (!t || typeof t !== 'object') return null
  const requiresInternal = t.requiresInternal === true
  const savedAt = Number.isFinite(t.savedAt) ? t.savedAt : now
  if (t.kind === 'share') {
    if (!TOKEN.test(t.token || '')) return null
    const server = t.server === undefined ? undefined : (SERVER.test(t.server) ? t.server : null)
    if (server === null) return null
    return { kind: 'share', token: t.token, ...(server ? { server } : {}), requiresInternal, savedAt }
  }
  if (t.kind === 'room') return ROOM.test(t.room || '') ? { kind: 'room', room: t.room, requiresInternal, savedAt } : null
  if (t.kind === 'file') {
    if (!ROOM.test(t.room || '') || !FILE.test(t.file || '') || t.file.split('/').includes('..') || t.file.startsWith('/')) return null
    return { kind: 'file', room: t.room, file: t.file, requiresInternal, savedAt }
  }
  return null
}

// Storage calls can throw (private windows, blocked site data), so every access is wrapped and a failure just means "nothing saved".
export function saveTarget (storage, target, now = Date.now()) {
  const clean = cleanTarget({ ...target, savedAt: now }, now)
  if (!clean) return false
  try { storage.setItem(KEY, JSON.stringify(clean)); return true } catch { return false }
}

export function loadTarget (storage, now = Date.now()) {
  let raw = null
  try { raw = storage.getItem(KEY) } catch { return null }
  if (!raw) return null
  let parsed = null
  try { parsed = JSON.parse(raw) } catch { clearTarget(storage); return null }
  const clean = cleanTarget(parsed, now)
  if (!clean || now - clean.savedAt > TARGET_TTL_MS) { clearTarget(storage); return null }
  return clean
}

export function clearTarget (storage) {
  try { storage.removeItem(KEY) } catch {}
}

// The decision after a successful sign-in. A company rule (policy `can`) or a flag set by the document or pipeline stage (`requiresInternal`) can stop the landing; the reason is shown instead of the target.
export function landAfterSignIn ({ target = null, user = null, context = {}, can = null } = {}) {
  if (!target) return { kind: 'home' }
  if (target.requiresInternal && (!user || user.orgId === null || user.orgId === undefined)) {
    return { kind: 'blocked', reason: 'This is for people inside an organization. Sign in with your organization account to open it.' }
  }
  if (target.kind === 'share' && user && typeof can === 'function') {
    const decision = can(user, 'share.join', context)
    if (!decision || decision.allow !== true) return { kind: 'blocked', reason: (decision && decision.reason) || 'Your account cannot open this link.' }
  }
  return { kind: 'land', target }
}
