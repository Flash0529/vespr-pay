// Runner registry: machines that dial out to the server and run commands for a workspace.
//   WebSocket /runner?token=&label=&os=&arch=   the runner connects here
//   GET  /api/runners                           who is connected (Bearer token)
//   POST /api/run { runner, room, files, command, timeoutMs }   run a job, streamed back as lines of JSON (Bearer token)
import { WebSocketServer } from 'ws'
import crypto from 'node:crypto'

const MAX_FILES_BYTES = 4 * 1024 * 1024

export function createRunnerHub ({ identify, mayRun = () => true, mayRunIn = null, track = () => false }) {
  const runners = new Map() // id -> { id, label, os, arch, user, ws, jobs: Map }
  const wss = new WebSocketServer({ noServer: true })

  wss.on('connection', (ws, req) => {
    ws.on('error', () => {}) // see server/index.js: a bad frame closes this one runner link, never the server
    const u = new URL(req.url, 'http://x')
    const user = req.murmioUser
    const id = 'rn-' + crypto.createHash('sha1').update(`${user}|${u.searchParams.get('label') || ''}`).digest('hex').slice(0, 8) // stable per person + label
    const old = runners.get(id); if (old) try { old.ws.terminate() } catch {}
    const r = { id, label: (u.searchParams.get('label') || id).slice(0, 60), os: u.searchParams.get('os') || '?', arch: u.searchParams.get('arch') || '?', user, ws, jobs: new Map() }
    runners.set(id, r)
    track(ws, req.murmioToken) // a session-backed runner link is closed when that session is signed out
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw) } catch { return }
      const job = r.jobs.get(m.id); if (job) job(m)
    })
    ws.on('close', () => { if (runners.get(id) === r) runners.delete(id); for (const j of r.jobs.values()) j({ type: 'result', code: -1, error: 'runner disconnected' }) })
  })

  const bearer = req => identify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }

  return {
    // called from the server's 'upgrade' handler; returns true if it took the connection
    upgrade (req, socket, head) {
      const u = new URL(req.url, 'http://x')
      if (u.pathname !== '/runner') return false
      const who = identify(u.searchParams.get('token') || '')
      if (!who) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return true }
      req.murmioUser = who
      req.murmioToken = u.searchParams.get('token') || ''
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
      return true
    },
    // called from the HTTP handler; returns true if it handled the request
    http (req, res) {
      const u = new URL(req.url, 'http://x')
      if (u.pathname === '/api/runners' && req.method === 'GET') {
        if (!bearer(req)) { res.writeHead(401); res.end(); return true }
        json(res, 200, [...runners.values()].map(r => ({ id: r.id, label: r.label, os: r.os, arch: r.arch, user: r.user, busy: r.jobs.size > 0 })))
        return true
      }
      if (u.pathname === '/api/run' && req.method === 'POST') {
        const caller = bearer(req)
        if (!caller) { res.writeHead(401); res.end(); return true }
        if (!mayRun(caller)) { res.writeHead(403); res.end(); return true }
        let body = ''; let size = 0
        req.on('data', c => { size += c.length; if (size > MAX_FILES_BYTES + 100000) req.destroy(); else body += c })
        req.on('end', () => {
          let a; try { a = JSON.parse(body) } catch { return json(res, 400, { error: 'bad json' }) }
          if (mayRunIn && !mayRunIn(caller, String(a.room || ''))) return json(res, 403, { error: 'running commands here needs edit on this workspace' }) // results come back into the files (server/access.js)
          const r = runners.get(a.runner)
          if (!r) return json(res, 404, { error: 'that runner is not connected' })
          const jobId = crypto.randomBytes(6).toString('hex')
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' })
          const timer = setTimeout(() => { r.jobs.delete(jobId); res.end(JSON.stringify({ type: 'result', code: -1, error: 'timed out waiting for the runner' }) + '\n') }, Math.min((a.timeoutMs || 60000) + 15000, 11 * 60000))
          r.jobs.set(jobId, m => {
            res.write(JSON.stringify(m) + '\n')
            if (m.type === 'result') { clearTimeout(timer); r.jobs.delete(jobId); res.end() }
          })
          r.ws.send(JSON.stringify({ type: 'job', id: jobId, room: String(a.room || ''), files: a.files || {}, command: String(a.command || ''), timeoutMs: a.timeoutMs }))
          res.on('close', () => { clearTimeout(timer); r.jobs.delete(jobId) })
        })
        return true
      }
      return false
    }
  }
}
