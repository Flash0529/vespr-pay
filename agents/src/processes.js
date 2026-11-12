// Long-running processes the agent starts for a workspace ("Run it"): dev servers, watchers, anything that does not exit.
// Each one gets its own copy of the workspace files, a free port, a scrubbed environment, a log tail and a time limit.
// The preview proxy (preview.js) serves them to a browser by an unguessable token.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'

const LOG_LINES = 300

const tryConnect = (host, port) => new Promise(resolve => {
  const s = net.connect({ host, port, timeout: 600 }, () => { s.destroy(); resolve(true) })
  s.on('error', () => resolve(false)); s.on('timeout', () => { s.destroy(); resolve(false) })
})

export class ProcessManager {
  constructor ({ root = process.env.VESPR_PROCESS_ROOT || path.join(os.tmpdir(), 'vespr-procs-' + process.pid), maxPerRoom = 3, ttlMs = 30 * 60 * 1000, portBase = Number(process.env.VESPR_PROCESS_PORT_BASE || 4100), portCount = Number(process.env.VESPR_PROCESS_PORT_COUNT || 100) } = {}) {
    Object.assign(this, { root, maxPerRoom, ttlMs, portBase, portCount })
    this.procs = new Map() // token -> record
  }

  list (roomName) { return [...this.procs.values()].filter(p => p.room === roomName).map(p => this.view(p)) }
  view (p) { return { name: p.name, status: p.status, port: p.port, command: p.command, exitCode: p.exitCode, previewPath: `/preview/${p.token}/`, since: p.since } }
  byToken (token) { return this.procs.get(token) || null }
  byName (roomName, name) { return [...this.procs.values()].find(p => p.room === roomName && p.name === name) || null }

  async freePort () {
    const used = new Set([...this.procs.values()].filter(p => p.status !== 'exited').map(p => p.port))
    for (let i = 0; i < this.portCount; i++) {
      const port = this.portBase + ((Math.floor(Math.random() * this.portCount) + i) % this.portCount)
      if (!used.has(port) && !(await tryConnect('127.0.0.1', port)) && !(await tryConnect('::1', port))) return port
    }
    throw new Error('no free port for a preview')
  }

  // files: the room's [path, text] pairs. keepPrefix: the app serves itself under /preview/<token>/ (e.g. Vite --base).
  async start ({ room, name, command, keepPrefix = false }) {
    const roomName = room.roomName || 'room'
    const running = [...this.procs.values()].filter(p => p.room === roomName && p.status !== 'exited')
    if (this.byName(roomName, name) && this.byName(roomName, name).status !== 'exited') await this.stop(roomName, name)
    else if (running.length >= this.maxPerRoom) throw new Error(`already running ${running.length} processes in this workspace (limit ${this.maxPerRoom}); stop one first`)
    const dir = path.join(this.root, roomName, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
    for (const rel of room.list()) { const dest = path.join(dir, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, room.read(rel)) }
    const port = await this.freePort(); const token = randomBytes(12).toString('hex')
    const basePath = `/preview/${token}/`
    const child = spawn('bash', ['-c', command], {
      cwd: dir, detached: true,
      env: { PATH: process.env.PATH, HOME: dir, LANG: 'C.UTF-8', PORT: String(port), HOST: '0.0.0.0', BASE_PATH: basePath, BROWSER: 'none', CI: '', NODE_ENV: 'development', PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1', npm_config_cache: path.join(dir, '.npm-cache') }
    })
    const rec = { room: roomName, name, token, port, command, keepPrefix, status: 'starting', exitCode: null, child, log: [], since: Date.now(), host: '127.0.0.1', timer: null }
    const push = b => { for (const line of b.toString().split('\n')) if (line.trim()) { rec.log.push(line.slice(0, 400)); if (rec.log.length > LOG_LINES) rec.log.shift() } }
    child.stdout.on('data', push); child.stderr.on('data', push)
    child.on('close', code => { rec.status = 'exited'; rec.exitCode = code; clearTimeout(rec.timer) })
    child.on('error', e => { rec.status = 'exited'; rec.exitCode = -1; push(`could not start: ${e.message}`) })
    rec.timer = setTimeout(() => this.kill(rec), this.ttlMs)
    this.procs.set(token, rec)
    return this.view(rec)
  }

  // Wait until the port answers, the process exits, or the time is up.
  async waitReady (roomName, name, ms = 90_000) {
    const rec = this.byName(roomName, name); if (!rec) return null
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (rec.status === 'exited') break
      for (const host of ['127.0.0.1', '::1']) if (await tryConnect(host, rec.port)) { rec.host = host; rec.status = 'running'; return this.view(rec) }
      await new Promise(r => setTimeout(r, 400))
    }
    return this.view(rec)
  }

  logs (roomName, name, lines = 40) { const rec = this.byName(roomName, name); return rec ? rec.log.slice(-Math.max(1, Math.min(lines, LOG_LINES))).join('\n') : null }

  kill (rec) { try { process.kill(-rec.child.pid, 'SIGKILL') } catch {} ; rec.status = 'exited'; clearTimeout(rec.timer) }
  async stop (roomName, name) { const rec = this.byName(roomName, name); if (!rec) return false; this.kill(rec); this.procs.delete(rec.token); return true }
  stopAll () { for (const rec of this.procs.values()) this.kill(rec); this.procs.clear() }
}
