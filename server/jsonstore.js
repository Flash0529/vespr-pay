// A tiny JSON file store for the sharing modules: whole file in memory, atomic write (temp file + rename), mode 0600 in a 0700 folder.
// Sharing data (link hashes, friends) lives in the server's data dir, never in the repo.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export function openStore (file, fallback) {
  let data
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { data = fallback() }
  return {
    data,
    save () {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
      const tmp = `${file}.tmp.${crypto.randomBytes(4).toString('hex')}`
      fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 })
      fs.renameSync(tmp, file)
    }
  }
}

// Read a small JSON request body (no streaming): resolves {} on an empty body, rejects with a code on bad JSON or too large.
export function readJson (req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []; let done = false
    const end = (fn, v) => { if (done) return; done = true; fn(v) }
    req.on('data', c => { size += c.length; if (size > limit) { end(reject, 'too_large'); req.resume() } else chunks.push(c) })
    req.on('end', () => {
      if (!chunks.length) return end(resolve, {})
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); end(v && typeof v === 'object' && !Array.isArray(v) ? resolve : reject, v && typeof v === 'object' && !Array.isArray(v) ? v : 'bad_json') } catch { end(reject, 'bad_json') }
    })
    req.on('error', () => end(reject, 'bad_json'))
  })
}

export function sendJson (res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(body))
}

export const bearer = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
export const isAgentName = n => /^agent/i.test(String(n || ''))
