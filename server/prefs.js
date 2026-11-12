// The account's own app choices, kept on the server so they follow the person to every device and session instead of living in
// one browser: today the answer to "What will you build here?", so it is asked once per account, never again.
// Bearer token only (no cookies, so no cross-site request can change them); each person reads and writes only their own.
//   GET  /api/me/prefs                                -> { prefs }
//   POST /api/me/prefs { focus?, other?, setupDone? } -> { prefs }   merged; anything else is refused
// Storage: <data>/prefs/<sha256 of the person>.json, mode 0600.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export function cleanPrefs (b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null
  const out = {}
  for (const k of Object.keys(b)) if (!['focus', 'other', 'setupDone'].includes(k)) return null
  if ('focus' in b) {
    if (!Array.isArray(b.focus) || b.focus.length > 20 || !b.focus.every(x => typeof x === 'string' && /^[\w-]{1,40}$/.test(x))) return null
    out.focus = [...new Set(b.focus)]
  }
  if ('other' in b) { if (typeof b.other !== 'string' || b.other.length > 200) return null; out.other = b.other.replace(/\s+/g, ' ').trim() }
  if ('setupDone' in b) { if (typeof b.setupDone !== 'boolean') return null; out.setupDone = b.setupDone }
  return Object.keys(out).length ? out : null
}

export function createPrefs ({ DATA, identify, now = () => Date.now() }) {
  const dir = path.join(DATA, 'prefs'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = who => path.join(dir, crypto.createHash('sha256').update(String(who)).digest('hex').slice(0, 32) + '.json')
  const read = who => { try { return JSON.parse(fs.readFileSync(file(who), 'utf8')) } catch { return {} } }
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
  const bearer = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  function save (who, next) {
    const prefs = { ...read(who), ...next, updated: now() }
    const f = file(who); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(prefs), { mode: 0o600 }); fs.renameSync(tmp, f)
    return prefs
  }
  return {
    get: read, save,
    http (req, res) {
      const u = new URL(req.url, 'http://x'); if (u.pathname !== '/api/me/prefs') return false
      const who = identify(bearer(req)); if (!who) { json(res, 401, { error: 'sign in' }); return true }
      if (req.method === 'GET') { json(res, 200, { prefs: read(who) }); return true }
      if (req.method !== 'POST') { json(res, 405, { error: 'GET or POST' }); return true }
      let raw = ''; req.on('data', c => { raw += c; if (raw.length > 4096) req.destroy() })
      req.on('end', () => {
        let b = null; try { b = JSON.parse(raw || 'null') } catch {}
        const next = cleanPrefs(b)
        if (!next) return json(res, 400, { error: 'prefs are focus (up to 20 short names), other (up to 200 characters) and setupDone (true or false)' })
        json(res, 200, { prefs: save(who, next) })
      })
      return true
    }
  }
}
