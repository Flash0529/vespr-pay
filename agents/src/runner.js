// Where commands run. An agent never runs a command itself: it asks a Runner, so the same agent can work on
//   - the sandbox inside the agent's own container (this file; the default),
//   - a Nebius cloud sandbox, a teammate's computer, or any server (a "murmio-runner" daemon that connects out to
//     the VESPR server; see docs/RUNNERS.md). Those implement the same two members: label/remote and exec().
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'dist', 'build'])
const MAX_FILE = 200 * 1024
const MAX_OUTPUT = 20 * 1024

export class SandboxRunner {
  constructor ({ root = process.env.VESPR_SANDBOX_ROOT || path.join(os.tmpdir(), 'vespr-sandbox-' + process.pid), timeoutMs = 60_000 } = {}) { this.id = 'sandbox'; this.label = 'sandbox (agent container)'; this.remote = false; this.root = root; this.timeoutMs = timeoutMs }

  // Copy the room's files to disk, run the command, then pull files the command created or changed back into the room.
  dirFor (room) { return path.join(this.root, room.roomName || 'room') }

  // A file a command made in the run folder (a chart, a PDF), for attach_file. Only a regular file inside the run folder: absolute paths, `..`, symlinks and anything that resolves
  // outside are refused, so a command cannot point this at a file of the agent's own. The folder is rebuilt at the start of every exec(), so call it right after the command.
  readFile (room, rel, { max = 10 * 1024 * 1024 } = {}) {
    const dir = this.dirFor(room); const clean = path.normalize(String(rel || '').replace(/^\.\//, ''))
    if (!clean || clean === '.' || path.isAbsolute(clean) || clean === '..' || clean.startsWith('..' + path.sep)) throw new Error('that path is not inside the workspace folder')
    const full = path.join(dir, clean); let st
    try { st = fs.lstatSync(full) } catch { throw new Error('there is no such file in the workspace folder; the folder is rebuilt before every command, so attach a file right after the command that made it') }
    if (st.isSymbolicLink() || !st.isFile()) throw new Error('only a regular file can be attached')
    let real, realDir; try { real = fs.realpathSync(full); realDir = fs.realpathSync(dir) } catch { throw new Error('that file cannot be read') }
    if (!real.startsWith(realDir + path.sep)) throw new Error('that path is not inside the workspace folder')
    if (st.size === 0) throw new Error('the file is empty')
    if (st.size > max) throw new Error(`the file is ${(st.size / 1048576).toFixed(1)} MB, more than the ${Math.round(max / 1048576)} MB that can be attached`)
    return { buf: fs.readFileSync(real), name: path.basename(clean) }
  }

  // onData(output so far) is called as output arrives, so a person watching a run sees it live.
  async exec (room, command, msgId, onData) {
    const dir = this.dirFor(room); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
    for (const rel of room.list()) { const dest = path.join(dir, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, room.read(rel)) }
    const result = await new Promise(resolve => {
      // no secrets in the child's environment: it only gets what it needs to run
      const child = spawn('bash', ['-c', command], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, LANG: 'C.UTF-8', PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' }, detached: true })
      let out = ''; let truncated = false
      const take = b => { if (out.length < MAX_OUTPUT) out += b.toString(); else truncated = true; if (onData) { try { onData(out.slice(0, MAX_OUTPUT)) } catch {} } }
      child.stdout.on('data', take); child.stderr.on('data', take)
      const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} ; out += '\n[timed out]' }, this.timeoutMs)
      child.on('close', code => { clearTimeout(timer); resolve({ code, output: out.slice(0, MAX_OUTPUT) + (truncated ? '\n[output truncated]' : '') }) })
      child.on('error', e => { clearTimeout(timer); resolve({ code: -1, output: `could not start: ${e.message}` }) })
    })
    const changed = []
    const walk = (d, rel = '') => {
      for (const name of fs.readdirSync(d)) {
        if (SKIP.has(name)) continue
        const full = path.join(d, name); const r = rel ? `${rel}/${name}` : name
        const st = fs.lstatSync(full)
        if (st.isSymbolicLink()) continue // never follow a link: it could point at a file of the agent's own and copy it into the room
        if (st.isDirectory()) walk(full, r)
        else if (st.size <= MAX_FILE) {
          const buf = fs.readFileSync(full); if (buf.includes(0)) continue
          const text = buf.toString('utf8')
          if (room.read(r) !== text) { room.write(r, text, msgId); changed.push(r) }
        }
      }
    }
    walk(dir)
    return { ...result, changed }
  }
}
