// What the desktop window may do, as plain functions (tested in test/security.test.js without Electron).
// The window shows the VESPR app from its own vespr-app:// origin and the local settings page (connect.html). Everything else is a
// stranger: it is never loaded into the window (it would get the preload bridge), and only web and mail links go to the browser.
'use strict'

// Links the person's browser may open. Anything else (file:, ms-*:, search-ms:, smb:, javascript: ...) can start programs on Windows.
const EXTERNAL = new Set(['https:', 'http:', 'mailto:'])
function safeExternal (raw) {
  try { return EXTERNAL.has(new URL(String(raw)).protocol) } catch { return false }
}

// The pages that belong to the app: its own origin, and the one local settings file (not any file: page).
// (compared by scheme and host: a custom scheme's URL.origin is "null" outside Electron)
function isAppPage (raw, appOrigin) {
  try { const u = new URL(String(raw)); const a = new URL(appOrigin); return u.protocol === a.protocol && u.host === a.host && Boolean(u.host) } catch { return false }
}
function isSettingsPage (raw, settingsUrl) {
  try { const u = new URL(String(raw)); const s = new URL(settingsUrl); return u.protocol === 'file:' && u.pathname === s.pathname } catch { return false }
}
const mayNavigate = (raw, { appOrigin, settingsUrl }) => isAppPage(raw, appOrigin) || isSettingsPage(raw, settingsUrl)

// A vespr:// link names a server: only the one this app already uses is followed (a link must not move the app to a stranger's site).
function sameServer (a, b) {
  try { return new URL(String(a)).origin === new URL(String(b)).origin } catch { return false }
}

// Addresses typed into Settings: https, or http only for this computer and the private test network (the tester build).
function cleanAddress (raw, { allowHttp = false } = {}) {
  const v = String(raw || '').trim()
  if (!v) return ''
  let u; try { u = new URL(v) } catch { return null }
  if (u.username || u.password) return null
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  const ok = u.protocol === 'https:' || u.protocol === 'wss:' || ((u.protocol === 'http:' || u.protocol === 'ws:') && (local || allowHttp))
  return ok ? v.replace(/\/+$/, '') : null
}
// What the settings page may change, checked; null when something is not acceptable.
function cleanSettings (next, { allowHttp = false } = {}) {
  if (!next || typeof next !== 'object') return null
  const out = {}
  for (const k of ['ideUrl', 'site', 'server']) {
    if (next[k] === undefined) continue
    const c = cleanAddress(next[k], { allowHttp }); if (c === null) return null; out[k] = c
  }
  if (next.token !== undefined) { const t = String(next.token || '').trim(); if (t.length > 512 || /[\s\u0000-\u001f]/.test(t)) return null; out.token = t }
  if (next.label !== undefined) out.label = String(next.label || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60)
  return out
}

// Browser permissions the app may have. Camera, microphone, location, MIDI, HID, serial, USB and the rest are refused.
const PERMISSIONS = new Set(['clipboard-sanitized-write', 'notifications', 'fullscreen'])
const mayHavePermission = (permission, origin, appOrigin) => PERMISSIONS.has(permission) && isAppPage(origin, appOrigin)

// The runner token at rest: sealed with the operating system's key store (DPAPI on Windows, Keychain on macOS) when it is available.
function sealSecret (value, safeStorage) {
  if (!value) return { token: '' }
  if (safeStorage && safeStorage.isEncryptionAvailable()) return { token: '', tokenSealed: safeStorage.encryptString(value).toString('base64') }
  return { token: value } // no key store (some Linux desktops): the file keeps it, readable only by this account
}
function openSecret (cfg, safeStorage) {
  if (cfg && cfg.tokenSealed && safeStorage && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(cfg.tokenSealed, 'base64')) } catch { return '' }
  }
  return (cfg && cfg.token) || ''
}

// A small policy for HTML the app serves itself: no plugins, no <base> tricks, and nobody may frame it.
const PAGE_CSP = "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"

module.exports = { safeExternal, isAppPage, isSettingsPage, mayNavigate, sameServer, cleanAddress, cleanSettings, mayHavePermission, sealSecret, openSecret, PAGE_CSP }
