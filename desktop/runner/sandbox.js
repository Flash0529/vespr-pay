import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { LIMITS, safePath } from './job.js'

const helper = fileURLToPath(new URL('./sandbox_exec.py', import.meta.url))
const guard = fileURLToPath(new URL('./sandbox_guard.py', import.meta.url))
const DEFAULTS = Object.freeze({ memoryBytes: 256 * 1024 * 1024, workspaceBytes: 64 * 1024 * 1024, cpuPercent: 50, pids: 64 })
function policy (options) {
  const limits = { ...DEFAULTS, ...options.limits }
  for (const [key, min, max] of [['memoryBytes', 64 * 1024 * 1024, 2 * 1024 ** 3], ['workspaceBytes', 4 * 1024 * 1024, 512 * 1024 * 1024], ['cpuPercent', 1, 400], ['pids', 16, 256]]) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < min || limits[key] > max) throw new Error(`invalid local isolation limit: ${key}`)
  }
  return limits
}
export function launchSpec (inputDir, job, options = {}) {
  const limits = policy(options)
  const unit = options.unit || `vespr-job-${randomUUID()}.service`
  if (!/^vespr-job-[a-zA-Z0-9-]+\.service$/.test(unit)) throw new Error('invalid unit')
  const bwrap = options.bwrap || '/usr/bin/bwrap'
  if (!path.isAbsolute(bwrap)) throw new Error('bubblewrap must use an absolute path')
  const args = ['--user', '--wait', '--pipe', '--collect', '--quiet', '--expand-environment=no', `--unit=${unit}`]
  for (const property of ['Type=exec', `MemoryMax=${limits.memoryBytes}`, 'MemorySwapMax=0', `CPUQuota=${limits.cpuPercent}%`, `TasksMax=${limits.pids}`, `RuntimeMaxSec=${Math.ceil(job.timeoutMs / 1000) + 5}s`, 'TimeoutStopSec=1s', 'KillMode=control-group', 'KillSignal=SIGKILL', 'OOMPolicy=kill', 'NoNewPrivileges=yes', 'KeyringMode=private', 'SystemCallFilter=~@keyring', 'SystemCallErrorNumber=EPERM']) args.push('--property', property)
  args.push('--', '/usr/bin/python3', '-I', '-S', guard, JSON.stringify(limits), path.join(inputDir, 'run-permit'), bwrap, '--unshare-all', '--unshare-user', '--unshare-net', '--unshare-pid', '--disable-userns', '--new-session', '--die-with-parent', '--as-pid-1', '--cap-drop', 'ALL', '--clearenv')
  for (const dir of ['/usr', '/bin', '/sbin', '/lib', '/lib64']) {
    if (!fs.existsSync(dir)) continue
    if (fs.lstatSync(dir).isSymbolicLink()) args.push('--symlink', fs.readlinkSync(dir), dir)
    else args.push('--ro-bind', dir, dir)
  }
  if (fs.existsSync('/etc/ld.so.cache')) args.push('--ro-bind', '/etc/ld.so.cache', '/etc/ld.so.cache')
  args.push('--proc', '/proc', '--dev', '/dev', '--ro-bind', inputDir, '/input', '--ro-bind', helper, '/run/vespr-exec.py', '--size', String(limits.workspaceBytes), '--tmpfs', '/workspace', '--symlink', '/workspace/tmp', '/tmp', '--setenv', 'PATH', '/usr/local/bin:/usr/bin:/bin', '--setenv', 'HOME', '/workspace', '--setenv', 'TMPDIR', '/workspace/tmp', '--setenv', 'LANG', 'C.UTF-8', '--chdir', '/workspace', '--', '/usr/bin/python3', '-I', '-S', '/run/vespr-exec.py')
  return { file: '/usr/bin/systemd-run', args, unit }
}
export async function runNative (prepared, job, options = {}) {
  if (process.platform !== 'linux') throw new Error('native isolation requires Linux')
  const spec = launchSpec(prepared.dir, job, options)
  for (const file of [spec.file, options.bwrap || '/usr/bin/bwrap', '/usr/bin/systemctl', '/usr/bin/python3']) {
    try { fs.accessSync(file, fs.constants.X_OK) } catch { throw new Error(`native isolation unavailable: missing ${path.basename(file)}`) }
  }
  if (!fs.existsSync('/sys/fs/cgroup/cgroup.controllers')) throw new Error('native isolation requires cgroups v2')
  if (options.signal?.aborted) throw new Error('job cancelled')
  const permit = path.join(prepared.dir, 'run-permit')
  fs.writeFileSync(permit, 'active', { flag: 'wx', mode: 0o600 })
  return await new Promise((resolve, reject) => {
    const changed = Object.create(null); let result; let pending = ''; let wireBytes = 0; let artifactBytes = 0; let outputBytes = 0; let finished = false; let failure
    const managerEnv = { PATH: '/usr/bin:/bin', XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`, DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=/run/user/${process.getuid()}/bus` }
    const child = spawn(spec.file, spec.args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: managerEnv })
    let stopping
    const stop = reason => {
      failure ||= new Error(reason)
      // Cancellation may precede transient unit registration. The guard refuses
      // a revoked or missing permit even if `systemctl stop` saw no unit yet.
      try { fs.writeFileSync(permit, 'cancelled') } catch {}
      if (stopping) return
      // Kill the service, not just the systemd-run client. The service also has
      // its own RuntimeMaxSec in case this runner process disappears.
      stopping = new Promise(done => {
        const killer = spawn('/usr/bin/systemctl', ['--user', 'stop', spec.unit], { stdio: 'ignore', env: managerEnv, timeout: 3000, killSignal: 'SIGKILL' })
        killer.on('error', done); killer.on('close', done)
      })
    }
    const abort = () => stop('job cancelled')
    options.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => stop('job timed out'), job.timeoutMs + 2000)
    const watchdog = setTimeout(() => { stop('isolation service did not stop'); child.kill('SIGKILL') }, job.timeoutMs + 10000)
    const emit = data => {
      const buf = Buffer.from(data); const remain = Math.max(0, LIMITS.outputBytes - outputBytes)
      if (remain) options.onChunk?.(buf.subarray(0, remain).toString('utf8'))
      outputBytes += buf.length
    }
    child.stderr.on('data', b => emit(b.toString()))
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      if (failure) return
      wireBytes += Buffer.byteLength(chunk); pending += chunk
      if (wireBytes > 32 * 1024 * 1024 || pending.length > 2 * 1024 * 1024) return stop('isolation output limit exceeded')
      let end
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1)
        try {
          const frame = JSON.parse(line)
          if (result) throw new Error('output after result')
          if (frame.type === 'chunk' && typeof frame.data === 'string') emit(frame.data)
          else if (frame.type === 'file' && safePath(frame.path) && typeof frame.text === 'string') {
            const size = Buffer.byteLength(frame.text)
            artifactBytes += size
            if (size > LIMITS.fileBytes || artifactBytes > LIMITS.artifactBytes || Object.keys(changed).length >= LIMITS.artifactFiles || Object.hasOwn(changed, frame.path) || frame.text.includes('\0')) throw new Error('invalid artifact')
            if (!Object.hasOwn(job.files, frame.path) || job.files[frame.path] !== frame.text) changed[frame.path] = frame.text
          } else if (frame.type === 'result' && Number.isInteger(frame.code) && frame.code >= -1 && frame.code <= 255) result = frame
          else throw new Error('invalid frame')
        } catch { stop('invalid isolation result'); break }
      }
    })
    const finish = (error, value) => {
      if (finished) return
      finished = true; clearTimeout(timer); clearTimeout(watchdog); options.signal?.removeEventListener('abort', abort)
      error ? reject(error) : resolve(value)
    }
    child.on('error', e => finish(new Error(`native isolation could not start: ${e.message}`)))
    child.on('close', async code => {
      await stopping
      if (failure) finish(failure)
      else if (code !== 0 || !result || pending.trim()) finish(new Error('native isolation failed; no host execution fallback'))
      else finish(null, { code: result.code, changed })
    })
  })
}
