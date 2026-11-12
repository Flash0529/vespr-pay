// File uploads for a workspace: the shared files are text-only (Y.Text), so decks, sheets, PDFs, pictures, audio, video and 3D models live here instead.
//   POST /api/upload/<room>?name=<file name>   body = the raw bytes          -> 201 { id, name, size, type, sha256, by, ts }
//   GET  /api/upload/<room>                                                  -> [{ id, name, size, type, sha256, by, ts }]  (newest first)
//   GET  /api/upload/<room>/<id>                                             -> the bytes, always as a download (never rendered by a browser)
// Every call needs a valid token (Authorization: Bearer). Files are stored under <data>/<room>/uploads/<id> (a random id: the name never touches the disk path)
// with a small .json beside each. Nothing is executed or unpacked here; reading is the agent's job (agents/src/readers.js).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ID = /^[0-9a-f]{16}$/
export const cleanName = n => {
  const base = String(n || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\.+/, '').trim().slice(0, 120)
  return base || 'file'
}

export function createUploads ({ DATA, identify, roomOk, maxBytes = Number(process.env.MURMIO_UPLOAD_MAX_MB || 25) * 1024 * 1024, maxFiles = 200, maxRoomBytes = Number(process.env.MURMIO_UPLOAD_ROOM_MB || 500) * 1024 * 1024 }) {
  const dirOf = room => path.join(DATA, room, 'uploads')
  const bearer = req => identify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
  const list = room => {
    const d = dirOf(room); let out = []
    try { out = fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => { try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) } catch { return null } }).filter(Boolean) } catch {}
    return out.sort((a, b) => b.ts - a.ts)
  }

  return {
    list,
    http (req, res) {
      const u = new URL(req.url, 'http://x'); const m = /^\/api\/upload\/([^/]+)(?:\/([^/]+))?$/.exec(u.pathname); if (!m) return false
      const [, room, id] = m
      const who = bearer(req); if (!who) { res.writeHead(401); res.end(); return true }
      if (!roomOk(room)) { res.writeHead(404); res.end(); return true }

      if (req.method === 'GET' && !id) { json(res, 200, list(room)); return true }
      if (req.method === 'GET') {
        if (!ID.test(id)) { res.writeHead(404); res.end(); return true }
        let meta, size
        try { meta = JSON.parse(fs.readFileSync(path.join(dirOf(room), id + '.json'), 'utf8')); size = fs.statSync(path.join(dirOf(room), id)).size } catch { res.writeHead(404); res.end(); return true }
        // always a download with a neutral type: an uploaded .html or .svg must never run as a page on our origin
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': size, 'Content-Disposition': 'attachment; filename="' + cleanName(meta.name).replace(/"/g, '') + '"', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Cache-Control': 'private, no-store' })
        fs.createReadStream(path.join(dirOf(room), id)).pipe(res); return true
      }
      if (req.method === 'POST' && !id) {
        const declared = Number(req.headers['content-length'] || 0)
        if (declared > maxBytes) {
          json(res, 413, { error: 'file is larger than the limit of ' + Math.round(maxBytes / 1048576) + ' MB' })
          req.on('data', () => {})
          return true
        }
        const existing = list(room)
        if (existing.length >= maxFiles || existing.reduce((a, f) => a + f.size, 0) + declared > maxRoomBytes) { json(res, 507, { error: 'this workspace has reached its upload limit' }); req.resume(); return true }
        const newId = crypto.randomBytes(8).toString('hex'); const dir = dirOf(room); fs.mkdirSync(dir, { recursive: true })
        const file = path.join(dir, newId); const out = fs.createWriteStream(file, { flags: 'wx', mode: 0o640 }); const hash = crypto.createHash('sha256'); let size = 0; let failed = false
        const fail = (code, msg) => { if (failed) return; failed = true; out.destroy(); fs.rmSync(file, { force: true }); if (!res.headersSent) { res.writeHead(code, { 'Content-Type': 'application/json', Connection: 'close' }); res.end(JSON.stringify({ error: msg })) } req.destroy() }
        req.on('data', c => { size += c.length; if (size > maxBytes) return fail(413, 'file is larger than the limit of ' + Math.round(maxBytes / 1048576) + ' MB'); hash.update(c); if (!out.write(c)) { req.pause(); out.once('drain', () => req.resume()) } })
        req.on('error', () => fail(400, 'upload interrupted'))
        req.on('aborted', () => fail(400, 'upload interrupted'))
        req.on('end', () => {
          if (failed) return
          out.end(() => {
            if (!size) { fs.rmSync(file, { force: true }); return json(res, 400, { error: 'empty upload' }) }
            const meta = { id: newId, name: cleanName(u.searchParams.get('name')), size, type: String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].slice(0, 80), sha256: hash.digest('hex'), by: who, ts: Date.now() }
            fs.writeFileSync(path.join(dir, newId + '.json'), JSON.stringify(meta)); json(res, 201, meta)
          })
        })
        return true
      }
      res.writeHead(405); res.end(); return true
    }
  }
}
