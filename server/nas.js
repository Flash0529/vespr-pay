// NAS (Network Attached Storage) service for VESPR workspaces.
// Keeps large binary assets, model weights, datasets, video and audio streams out of the active Yjs CRDT memory document.
//
// Endpoints:
//   GET    /api/nas/<room>                       -> [{ id, name, size, clearance, type, sha256, by, ts }]
//   POST   /api/nas/<room>?name=<n>&clearance=<c> -> 201 { id, name, size, clearance, type, sha256, by, ts }
//   GET    /api/nas/<room>/<id>                  -> 200 or 206 Partial Content (supports HTTP Range requests for streaming)
//   DELETE /api/nas/<room>/<id>                  -> 200 { ok: true, id }
//   POST   /api/nas/<room>/<id>/verify           -> 200 { id, verified: true, sha256, bytes }
//
// Stored in <DATA>/<room>/nas/<id> with metadata in <id>.json. Zero external runtime dependencies.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ID = /^[0-9a-f]{16}$/
const CLEARANCES = ['L0', 'L1', 'L2', 'L3', 'L4']

export const cleanName = n => {
  const base = String(n || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\.+/, '').trim().slice(0, 120)
  return base || 'asset'
}

export const cleanClearance = c => {
  const val = String(c || '').trim().toUpperCase()
  return CLEARANCES.includes(val) ? val : 'L1'
}

export function createNas ({
  DATA,
  identify,
  roomOk,
  maxBytes = Number(process.env.VESPR_NAS_MAX_MB || 2048) * 1024 * 1024, // 2 GB per file default
  maxFiles = 1000,
  maxRoomBytes = Number(process.env.VESPR_NAS_ROOM_GB || 20) * 1024 * 1024 * 1024 // 20 GB per room default
}) {
  const dirOf = room => path.join(DATA, room, 'nas')
  const bearer = req => identify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
  const json = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  const list = room => {
    const d = dirOf(room); let out = []
    try {
      out = fs.readdirSync(d)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try { return JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) } catch { return null }
        })
        .filter(Boolean)
    } catch {}
    return out.sort((a, b) => b.ts - a.ts)
  }

  return {
    list,
    http (req, res) {
      const u = new URL(req.url, 'http://x')
      const m = /^\/api\/nas\/([^/]+)(?:\/([^/]+)(?:\/(verify))?)?$/.exec(u.pathname)
      if (!m) return false

      const [, room, id, action] = m
      const who = bearer(req)
      if (!who) { res.writeHead(401); res.end(); return true }
      if (!roomOk(room)) { res.writeHead(404); res.end(); return true }

      // ── List assets: GET /api/nas/<room> ──────────────────────────────────
      if (req.method === 'GET' && !id) {
        const assets = list(room)
        json(res, 200, assets)
        return true
      }

      // ── Stream Download with Range Support: GET /api/nas/<room>/<id> ─────
      if (req.method === 'GET' && id && !action) {
        if (!ID.test(id)) { res.writeHead(404); res.end(); return true }
        const filePath = path.join(dirOf(room), id)
        const metaPath = path.join(dirOf(room), id + '.json')

        let meta, stat
        try {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
          stat = fs.statSync(filePath)
        } catch {
          res.writeHead(404); res.end(); return true
        }

        const total = stat.size
        const range = req.headers.range
        const safeFilename = cleanName(meta.name).replace(/"/g, '')

        if (range) {
          const parts = range.replace(/bytes=/, '').split('-')
          const start = parseInt(parts[0], 10)
          const end = parts[1] ? parseInt(parts[1], 10) : total - 1

          if (isNaN(start) || start >= total || end >= total || start > end) {
            res.writeHead(416, { 'Content-Range': `bytes */${total}` })
            res.end()
            return true
          }

          const chunksize = (end - start) + 1
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': meta.type || 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${safeFilename}"`,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "sandbox; default-src 'none'",
            'Cache-Control': 'private, no-cache'
          })
          fs.createReadStream(filePath, { start, end }).pipe(res)
          return true
        }

        res.writeHead(200, {
          'Content-Length': total,
          'Accept-Ranges': 'bytes',
          'Content-Type': meta.type || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${safeFilename}"`,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox; default-src 'none'",
          'Cache-Control': 'private, no-cache'
        })
        fs.createReadStream(filePath).pipe(res)
        return true
      }

      // ── Verify Checksum: POST /api/nas/<room>/<id>/verify ────────────────
      if (req.method === 'POST' && id && action === 'verify') {
        if (!ID.test(id)) { res.writeHead(404); res.end(); return true }
        const filePath = path.join(dirOf(room), id)
        const metaPath = path.join(dirOf(room), id + '.json')

        let meta
        try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) } catch { res.writeHead(404); res.end(); return true }

        const hash = crypto.createHash('sha256')
        const stream = fs.createReadStream(filePath)
        let bytes = 0
        stream.on('data', chunk => { bytes += chunk.length; hash.update(chunk) })
        stream.on('end', () => {
          const currentSha = hash.digest('hex')
          const matches = currentSha === meta.sha256
          json(res, 200, {
            id,
            name: meta.name,
            clearance: meta.clearance,
            bytes,
            sha256: currentSha,
            verified: matches,
            verifiedAt: Date.now()
          })
        })
        stream.on('error', () => json(res, 500, { error: 'verification stream error' }))
        return true
      }

      // ── Delete Asset: DELETE /api/nas/<room>/<id> ────────────────────────
      if (req.method === 'DELETE' && id) {
        if (!ID.test(id)) { res.writeHead(404); res.end(); return true }
        const filePath = path.join(dirOf(room), id)
        const metaPath = path.join(dirOf(room), id + '.json')

        try {
          fs.rmSync(filePath, { force: true })
          fs.rmSync(metaPath, { force: true })
          json(res, 200, { ok: true, id })
        } catch (e) {
          json(res, 500, { error: 'delete failed: ' + e.message })
        }
        return true
      }

      // ── Upload Asset: POST /api/nas/<room>?name=<name>&clearance=<L> ─────
      if (req.method === 'POST' && !id) {
        const declared = Number(req.headers['content-length'] || 0)
        if (declared > maxBytes) {
          res.writeHead(413, { Connection: 'close' })
          res.end(JSON.stringify({ error: `asset is larger than limit of ${Math.round(maxBytes / (1024 * 1024))} MB` }))
          req.resume()
          return true
        }

        const existing = list(room)
        if (existing.length >= maxFiles || existing.reduce((a, f) => a + f.size, 0) + declared > maxRoomBytes) {
          json(res, 507, { error: 'workspace has reached its NAS storage quota' })
          req.resume()
          return true
        }

        const newId = crypto.randomBytes(8).toString('hex')
        const dir = dirOf(room)
        fs.mkdirSync(dir, { recursive: true })

        const file = path.join(dir, newId)
        const out = fs.createWriteStream(file, { flags: 'wx', mode: 0o640 })
        const hash = crypto.createHash('sha256')
        let size = 0
        let failed = false

        const fail = (code, msg) => {
          if (failed) return
          failed = true
          out.destroy()
          fs.rmSync(file, { force: true })
          if (!res.headersSent) {
            res.writeHead(code, { 'Content-Type': 'application/json', Connection: 'close' })
            res.end(JSON.stringify({ error: msg }))
          }
          req.destroy()
        }

        req.on('data', chunk => {
          size += chunk.length
          if (size > maxBytes) return fail(413, `asset exceeds max file limit`)
          hash.update(chunk)
          if (!out.write(chunk)) {
            req.pause()
            out.once('drain', () => req.resume())
          }
        })

        req.on('error', () => fail(400, 'upload interrupted'))
        req.on('aborted', () => fail(400, 'upload aborted'))

        req.on('end', () => {
          if (failed) return
          out.end(() => {
            if (!size) {
              fs.rmSync(file, { force: true })
              return json(res, 400, { error: 'empty asset upload' })
            }
            const clearance = cleanClearance(u.searchParams.get('clearance'))
            const rawName = u.searchParams.get('name') || 'asset.bin'
            const meta = {
              id: newId,
              name: cleanName(rawName),
              clearance,
              size,
              type: String(req.headers['content-type'] || 'application/octet-stream').split(';')[0].slice(0, 80),
              sha256: hash.digest('hex'),
              by: who,
              ts: Date.now()
            }
            fs.writeFileSync(path.join(dir, newId + '.json'), JSON.stringify(meta))
            json(res, 201, meta)
          })
        })
        return true
      }

      res.writeHead(405)
      res.end()
      return true
    }
  }
}
