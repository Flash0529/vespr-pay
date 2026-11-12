import { fileStore } from '../app/file-store.js'
// Snapshot links: a read-only COPY of one file, or of the whole project's text files, at a long random address that can be revoked.
//   POST   /api/snapshot/<room>     { file?, title?, days? }  -> 201 { id, kind, title, path: '/s/<token>', expires }   (the token is shown once; a person's token is needed)
//   GET    /api/snapshot/<room>     -> [{ id, kind, file, title, by, ts, expires, views, files }]                       (never the token)
//   DELETE /api/snapshot/<room>/<id> -> 204                                                                              (the link stops working at once and the copy is deleted)
//   GET    /snap/<token>            -> a read-only page, no script: the file, or the project's files
//   GET    /snap/<token>/raw        -> the file as plain text (file links only)
// A link is a copy made at share time, not a live view: it can never show a file that was not chosen, and nothing in it changes afterwards. The address holds 128 random bits; only a hash of them is stored.
// Dotfiles, dot-folders and files whose names look like secrets are never copied (a single file with such a name is refused). Off unless the operator sets VESPR_SNAPSHOT=1. (Live share links with view or edit rights, friends and project shares are server/share.js and server/friends.js.)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const SECRETISH = /(^|\/)(\.[^/]*|[^/]*\.(pem|key|p12|pfx|keystore)|id_(rsa|dsa|ecdsa|ed25519)[^/]*|[^/]*(secret|token|password|passwd|credential|apikey|api_key)[^/]*|\.?env(\.[^/]*)?)$/i
export const looksSecret = p => SECRETISH.test(String(p)) || /(^|\/)\.[^/]+\//.test(String(p))
const ID = /^[0-9a-f]{16}$/
const LIMITS = { fileBytes: 200 * 1024, projectBytes: 2 * 1024 * 1024, projectFiles: 300, perRoom: 100, defaultDays: 14, maxDays: 90 }
const sha = s => crypto.createHash('sha256').update(s).digest('hex')

export function createSnapshot ({ DATA, identify, roomOk, getYDoc, limits = {} }) {
  const L = { ...LIMITS, ...limits }
  const dir = path.join(DATA, '_snapshots')
  const read = id => { try { return JSON.parse(fs.readFileSync(path.join(dir, id + '.json'), 'utf8')) } catch { return null } }
  const all = () => { try { return fs.readdirSync(dir).filter(f => /^[0-9a-f]{16}\.json$/.test(f)).map(f => read(f.slice(0, 16))).filter(Boolean) } catch { return [] } }
  const write = s => { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); const f = path.join(dir, s.id + '.json'); fs.writeFileSync(f + '.tmp', JSON.stringify(s), { mode: 0o600 }); fs.renameSync(f + '.tmp', f) }
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
  const bearer = req => identify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
  const body = (req, max = 4096) => new Promise((resolve, reject) => { let n = 0; const chunks = []; req.on('data', c => { n += c.length; if (n > max) { reject(new Error('too large')); req.destroy() } else chunks.push(c) }); req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) } catch { reject(new Error('bad json')) } }); req.on('error', reject) })
  const filesOf = room => { const doc = getYDoc(room); const m = doc && fileStore(doc); const out = []; if (m) for (const [p, t] of m) out.push([p, t.toString()]); return out.sort((a, b) => a[0].localeCompare(b[0])) }
  const expired = s => s.expires && Date.now() > s.expires
  const pageHeaders = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" }

  const code = (p, text) => `<section id="${esc(p)}"><h2>${esc(p)}</h2><pre>${esc(text).split('\n').map(l => `<span class="l">${l}</span>`).join('\n')}</pre></section>`
  const page = s => {
    const when = new Date(s.ts).toUTCString().replace(/ GMT$/, ' UTC')
    const nav = s.kind === 'project' ? `<nav>${s.files.map(f => `<a href="#${esc(f.path)}">${esc(f.path)}</a>`).join('')}</nav>` : ''
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(s.title)}</title>
<style>:root{color-scheme:dark}body{margin:0;background:#131314;color:#ececee;font:13px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}header{padding:22px 28px 14px;border-bottom:1px solid rgba(255,255,255,.08)}h1{margin:0 0 4px;font-size:17px;font-weight:650}header p{margin:0;color:#9b9ba3;font-size:12px}.wrap{display:flex;gap:0;align-items:flex-start}nav{flex:none;width:240px;padding:14px 10px;position:sticky;top:0;max-height:100vh;overflow:auto;border-right:1px solid rgba(255,255,255,.08)}nav a{display:block;padding:5px 10px;border-radius:7px;color:#9b9ba3;text-decoration:none;font:12px ui-monospace,Menlo,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}nav a:hover{background:#232326;color:#ececee}main{flex:1;min-width:0;padding:6px 28px 40px}section{margin:18px 0}h2{margin:0 0 8px;font:600 12px ui-monospace,Menlo,Consolas,monospace;color:#9b9ba3}pre{margin:0;padding:12px 0;background:#1c1c1e;border:1px solid rgba(255,255,255,.075);border-radius:10px;overflow:auto;font:12px/1.65 ui-monospace,Menlo,Consolas,monospace;counter-reset:n}.l{display:block;padding:0 14px 0 0;white-space:pre}.l::before{counter-increment:n;content:counter(n);display:inline-block;width:46px;padding-right:14px;text-align:right;color:#80808a;user-select:none}footer{padding:0 28px 28px;color:#80808a;font-size:11.5px}a.raw{color:#6c9dff;text-decoration:none}@media (max-width:720px){.wrap{display:block}nav{width:auto;position:static;max-height:none;border-right:0;border-bottom:1px solid rgba(255,255,255,.08)}main{padding:6px 14px 30px}header{padding:18px 14px 12px}}</style></head>
<body><header><h1>${esc(s.title)}</h1><p>Shared by ${esc(s.by)} · ${esc(when)} · a read-only copy${s.expires ? ' · link ends ' + esc(new Date(s.expires).toUTCString().replace(/ GMT$/, ' UTC')) : ''}</p></header><div class="wrap">${nav}<main>${s.files.map(f => code(f.path, f.text)).join('')}</main></div><footer>${s.kind === 'file' ? '<a class="raw" href="raw">Download as text</a> · ' : ''}Made with VESPR. This page is a copy and does not change.</footer></body></html>`
  }

  return {
    http (req, res) {
      const u = new URL(req.url, 'http://x')
      const pub = /^\/snap\/([0-9a-f]{48})(\/raw)?$/.exec(u.pathname)
      if (pub) { // the public view: the long address is the credential
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return true }
        const token = pub[1]; const s = read(token.slice(0, 16))
        const ok = s && s.hash && crypto.timingSafeEqual(Buffer.from(sha(token.slice(16)), 'hex'), Buffer.from(s.hash, 'hex'))
        if (!ok) { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end('not found'); return true }
        if (expired(s)) { fs.rmSync(path.join(dir, s.id + '.json'), { force: true }); res.writeHead(410, { 'Cache-Control': 'no-store' }); res.end('this link has ended'); return true }
        s.views = (s.views || 0) + 1; try { write(s) } catch {}
        if (pub[2]) {
          if (s.kind !== 'file') { res.writeHead(404); res.end(); return true }
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + path.posix.basename(s.files[0].path).replace(/[^\w.\-]/g, '_') + '"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'X-Robots-Tag': 'noindex' }); res.end(s.files[0].text); return true
        }
        res.writeHead(200, pageHeaders); res.end(page(s)); return true
      }
      const m = /^\/api\/snapshot\/([^/]+)(?:\/([^/]+))?$/.exec(u.pathname); if (!m) return false
      const [, room, id] = m
      const who = bearer(req); if (!who) { res.writeHead(401); res.end(); return true }
      if (!roomOk(room)) { res.writeHead(404); res.end(); return true }
      if (req.method === 'GET' && !id) { json(res, 200, all().filter(s => s.room === room && !expired(s)).sort((a, b) => b.ts - a.ts).map(s => ({ id: s.id, kind: s.kind, file: s.kind === 'file' ? s.files[0].path : '', title: s.title, by: s.by, ts: s.ts, expires: s.expires, views: s.views || 0, files: s.files.length }))); return true }
      if (req.method === 'DELETE' && id) {
        const s = ID.test(id) ? read(id) : null
        if (!s || s.room !== room) { res.writeHead(404); res.end(); return true }
        fs.rmSync(path.join(dir, id + '.json'), { force: true }); res.writeHead(204); res.end(); return true
      }
      if (req.method === 'POST' && !id) {
        body(req).then(b => {
          const active = all().filter(s => s.room === room && !expired(s))
          if (active.length >= L.perRoom) return json(res, 507, { error: 'this workspace has reached its limit of ' + L.perRoom + ' share links: remove one first' })
          const days = Math.min(L.maxDays, Math.max(1, Math.round(Number(b.days) || L.defaultDays)))
          let kind, files
          if (b.file) {
            const f = filesOf(room).find(([p]) => p === b.file)
            if (!f) return json(res, 404, { error: 'that file is not in this workspace' })
            if (looksSecret(f[0])) return json(res, 400, { error: 'that file looks like it holds a secret, so it cannot be shared' })
            if (Buffer.byteLength(f[1]) > L.fileBytes) return json(res, 413, { error: 'that file is larger than ' + Math.round(L.fileBytes / 1024) + ' KB' })
            kind = 'file'; files = [{ path: f[0], text: f[1] }]
          } else {
            kind = 'project'; files = []; let bytes = 0; let skipped = 0
            for (const [p, t] of filesOf(room)) { if (looksSecret(p)) { skipped++; continue } const n = Buffer.byteLength(t); if (files.length >= L.projectFiles || bytes + n > L.projectBytes) { skipped++; continue } files.push({ path: p, text: t }); bytes += n }
            if (!files.length) return json(res, 400, { error: 'there is nothing in this workspace that can be shared' })
            b.skipped = skipped
          }
          const id2 = crypto.randomBytes(8).toString('hex'); const secret = crypto.randomBytes(16).toString('hex')
          const title = String(b.title || (kind === 'file' ? files[0].path : room)).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || room
          const s = { id: id2, room, hash: sha(secret), kind, title, by: who, ts: Date.now(), expires: Date.now() + days * 86400000, views: 0, files }
          write(s)
          json(res, 201, { id: id2, kind, title, path: '/snap/' + id2 + secret, expires: s.expires, files: files.length, skipped: b.skipped || 0 })
        }).catch(e => json(res, 400, { error: e.message }))
        return true
      }
      res.writeHead(405); res.end(); return true
    }
  }
}
