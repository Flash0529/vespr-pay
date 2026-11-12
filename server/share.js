// Share links: an unguessable link to one file or a whole workspace ("room"), with a role (view or edit), an optional expiry, and revoke.
//   POST /api/share/create   { room, file?, role: 'view'|'edit', expiresInSec?, label? }  (Bearer)  -> 201 { id, token, room, file, role, expiresAt }   the token is shown ONCE
//   GET  /api/share/list?room=<room>                                                       (Bearer)  -> { links: [...] }   your links, never the token
//   POST /api/share/revoke   { id }                                                        (Bearer, the creator only) -> { ok: true }
//   POST /api/share/resolve  { token }                                                     (no login) -> { room, file, role, expiresAt, by }   or 404 link_invalid
//   POST /api/share/file     { token }                                                     (no login, file links) -> { room, file, text }
// The link holds 256 random bits; the server keeps only the SHA-256 of it, so a copy of the data dir cannot be turned back into links.
// The token goes in a POST body or a WebSocket query, never a path (the client puts it in the URL #fragment, which browsers never send anywhere).
// Unknown, expired and revoked tokens all answer the same 404, so a guess learns nothing. Failed guesses are rate limited per address.
// Whole-workspace links open the realtime connection as a guest (view = every document update from that socket is dropped; edit = a full teammate).
// A single-file link is read-only through /api/share/file: the shared document is one object per workspace, so a socket cannot be limited to one file.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { openStore, readJson, sendJson, bearer, isAgentName } from './jsonstore.js'

export const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex')
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/ // 32 bytes as base64url
const MAX_EXPIRY_SEC = 365 * 24 * 3600
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n)
export const safeRel = p => {
  if (typeof p !== 'string' || p.length > 300 || p.split(/[\\/]/).includes('..')) return null // refuse '..' outright: clamping it would quietly share a different file
  const n = path.posix.normalize('/' + p).slice(1)
  return n && !n.startsWith('..') && !n.includes('\0') ? n : null
}

export function createShare ({ DATA, identify, roomOk, mayShare = null, now = Date.now, randomBytes = crypto.randomBytes, readFile, maxLinksPerUser = 100, maxFailures = 30, failWindowMs = 10 * 60 * 1000, trustProxy = process.env.VESPR_TRUST_PROXY === '1' }) {
  const store = openStore(path.join(DATA, 'share', 'links.json'), () => ({ links: {} }))
  const links = store.data.links // id -> { id, hash, room, file, role, by, label, createdAt, expiresAt, revokedAt, lastUsedAt, uses }
  const byHash = new Map(Object.values(links).map(l => [l.hash, l]))
  const sockets = new Map() // link id -> Set of open guest sockets
  const fails = new Map() // address -> { n, first }
  const read = readFile || ((room, rel) => { // default: the exported tree (written about half a second after an edit)
    const root = path.join(DATA, room, 'tree'); const f = path.join(root, rel)
    if (!f.startsWith(root + path.sep)) return null
    try { const st = fs.statSync(f); return st.isFile() && st.size <= 1048576 ? fs.readFileSync(f, 'utf8') : null } catch { return null }
  })

  const clientIp = req => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',').pop().trim()) || req.socket?.remoteAddress || '?'
  const blocked = ip => { const f = fails.get(ip); if (!f) return false; if (now() - f.first > failWindowMs) { fails.delete(ip); return false } return f.n >= maxFailures }
  const fail = ip => {
    if (fails.size > 10000) fails.clear()
    const f = fails.get(ip); if (!f || now() - f.first > failWindowMs) fails.set(ip, { n: 1, first: now() }); else f.n++
  }
  const state = l => (l.revokedAt ? 'revoked' : l.expiresAt && now() >= l.expiresAt ? 'expired' : 'active')
  const lookup = token => { if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null; const l = byHash.get(hashToken(token)); return l && state(l) === 'active' ? l : null }
  const view = l => ({ id: l.id, room: l.room, file: l.file, role: l.role, label: l.label, createdAt: l.createdAt, expiresAt: l.expiresAt, revokedAt: l.revokedAt, lastUsedAt: l.lastUsedAt, uses: l.uses, state: state(l) })
  const touch = l => { l.uses++; l.lastUsedAt = now(); try { store.save() } catch {} }

  function create (who, { room, file, role, expiresInSec, label } = {}) {
    if (isAgentName(who)) return { code: 403, error: 'agents_cannot_share' }
    if (typeof room !== 'string' || !roomOk(room)) return { code: 400, error: 'bad_room' }
    if (mayShare && !mayShare(who, room, file == null ? '' : String(file))) return { code: 403, error: 'needs_manage' } // a link hands out access (server/access.js)
    if (role !== 'view' && role !== 'edit') return { code: 400, error: 'bad_role' }
    let rel = null
    if (file != null) { rel = safeRel(file); if (!rel) return { code: 400, error: 'bad_file' }; if (role === 'edit') return { code: 400, error: 'edit_needs_room' } }
    let expiresAt = null
    if (expiresInSec != null) {
      if (!Number.isInteger(expiresInSec) || expiresInSec < 60 || expiresInSec > MAX_EXPIRY_SEC) return { code: 400, error: 'bad_expiry' }
      expiresAt = now() + expiresInSec * 1000
    }
    if (Object.values(links).filter(l => l.by === who && state(l) === 'active').length >= maxLinksPerUser) return { code: 429, error: 'too_many_links' }
    const token = randomBytes(32).toString('base64url')
    let id; do id = randomBytes(6).toString('hex'); while (links[id])
    const l = { id, hash: hashToken(token), room, file: rel, role, by: who, label: clean(label, 80), createdAt: now(), expiresAt, revokedAt: null, lastUsedAt: null, uses: 0 }
    links[id] = l; byHash.set(l.hash, l); store.save()
    return { code: 201, body: { ...view(l), token } }
  }

  function revoke (who, id) {
    const l = links[id]
    if (!l || l.by !== who) return false // someone else's link looks the same as no link
    if (!l.revokedAt) { l.revokedAt = now(); store.save() }
    for (const ws of sockets.get(id) || []) { try { ws.close(4403, 'revoked') } catch {} }
    return true
  }

  // The realtime door: a valid whole-workspace link for exactly this room. Never used as a general login (git, uploads, runners keep requiring a real token).
  function guest (token, room, ip) {
    if (blocked(ip)) return null
    const l = lookup(token)
    if (!l) { fail(ip); return null }
    if (l.room !== room || l.file) return null
    touch(l)
    return { id: l.id, who: 'guest~' + l.id.slice(0, 6), role: l.role, room: l.room, expiresAt: l.expiresAt }
  }

  function attach (ws, g) { // closes the socket when the link is revoked or runs out
    let set = sockets.get(g.id); if (!set) sockets.set(g.id, set = new Set()); set.add(ws)
    let timer = null
    const arm = () => {
      if (!g.expiresAt) return
      timer = setTimeout(() => { if (now() >= g.expiresAt) { try { ws.close(4401, 'expired') } catch {} } else arm() }, Math.min(Math.max(g.expiresAt - now(), 1), 2 ** 31 - 1))
      timer.unref?.()
    }
    arm()
    ws.on('close', () => { clearTimeout(timer); set.delete(ws); if (!set.size) sockets.delete(g.id) })
  }

  // View role: drop every y-websocket sync message that carries data from the client (step 2 = 1, update = 2). Awareness (cursor, name) still flows.
  const mayForward = (role, data) => {
    if (role === 'edit') return true
    const b = Buffer.isBuffer(data) ? data : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data)
    if (b.length < 1) return false
    if (b[0] === 1 || b[0] === 3) return true // awareness, query awareness
    return b[0] === 0 && b.length > 1 && b[1] === 0 // sync step 1 (state vector request) only
  }
  function restrict (ws, role) {
    if (role === 'edit') return
    const on = ws.on.bind(ws)
    ws.on = (ev, fn) => ev === 'message' ? on(ev, (data, ...rest) => { if (mayForward(role, data)) fn(data, ...rest) }) : on(ev, fn)
  }

  const ROUTE = /^\/api\/share\/(create|list|revoke|resolve|file)$/
  function http (req, res) { // sync answer to "is this mine?" (the server's handler chain needs it), the work itself is async
    if (!ROUTE.test(new URL(req.url, 'http://x').pathname)) return false
    handle(req, res).catch(() => { if (!res.headersSent) sendJson(res, 500, { error: 'server' }); else res.end() })
    return true
  }
  async function handle (req, res) {
    const u = new URL(req.url, 'http://x'); const op = ROUTE.exec(u.pathname)[1]
    const want = op === 'list' ? 'GET' : 'POST'
    if (req.method !== want) return sendJson(res, 405, { error: 'method' })
    const ip = clientIp(req)
    let body = {}
    if (want === 'POST') { try { body = await readJson(req) } catch (c) { return sendJson(res, c === 'too_large' ? 413 : 400, { error: c }) } }
    if (op === 'resolve' || op === 'file') {
      if (blocked(ip)) { res.setHeader?.('Retry-After', String(Math.ceil(failWindowMs / 1000))); return sendJson(res, 429, { error: 'slow_down' }) }
      const l = lookup(body.token)
      if (!l) { fail(ip); return sendJson(res, 404, { error: 'link_invalid' }) }
      if (op === 'resolve') { touch(l); return sendJson(res, 200, { room: l.room, file: l.file, role: l.role, expiresAt: l.expiresAt, by: l.by }) }
      if (!l.file) return sendJson(res, 400, { error: 'not_a_file_link' })
      const text = read(l.room, l.file)
      if (text == null) return sendJson(res, 404, { error: 'file_not_found' })
      touch(l); return sendJson(res, 200, { room: l.room, file: l.file, text })
    }
    const who = identify(bearer(req))
    if (!who || /^guest~/.test(who)) return sendJson(res, 401, { error: 'login_required' })
    if (op === 'create') { const r = create(who, body); return sendJson(res, r.code, r.body || { error: r.error }) }
    if (op === 'revoke') return revoke(who, String(body.id || '')) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'no_such_link' })
    const room = u.searchParams.get('room')
    sendJson(res, 200, { links: Object.values(links).filter(l => l.by === who && (!room || l.room === room)).sort((a, b) => b.createdAt - a.createdAt).map(view) })
  }

  return { http, create, revoke, guest, attach, restrict, mayForward, lookup, clientIp, list: who => Object.values(links).filter(l => l.by === who).map(view) }
}
