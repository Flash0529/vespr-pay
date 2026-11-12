// Explicit owner-trusted host execution. This mode is NOT an OS sandbox.
import { spawn } from 'node:child_process'
import os from 'node:os'
import { collectChanges, LIMITS } from './job.js'

export async function runLocal (prepared, job, { signal, onChunk } = {}) {
  if (signal?.aborted) throw new Error('job cancelled')
  const env = process.platform === 'win32'
    ? { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir(), TMP: os.tmpdir(), USERPROFILE: prepared.files, COMSPEC: process.env.COMSPEC }
    : { PATH: process.env.PATH, HOME: prepared.files, LANG: 'C.UTF-8', TMPDIR: prepared.dir }
  const code = await new Promise((resolve, reject) => {
    const child = spawn(job.command, { cwd: prepared.files, env, shell: true, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let total = 0; let cancelled = false; let timedOut = false
    const kill = () => {
      try {
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
          killer.on('error', () => {}); killer.unref()
        } else process.kill(-child.pid, 'SIGKILL')
      } catch {}
    }
    const abort = () => { cancelled = true; kill() }
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => { timedOut = true; onChunk?.('\n[timed out]'); kill() }, job.timeoutMs)
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    const emit = buf => {
      const remain = Math.max(0, LIMITS.outputBytes - total)
      if (remain) onChunk?.(buf.subarray(0, remain).toString('utf8'))
      if (total <= LIMITS.outputBytes && total + buf.length > LIMITS.outputBytes) onChunk?.('\n[output truncated]')
      total += buf.length
    }
    child.stdout.on('data', emit); child.stderr.on('data', emit)
    child.on('error', error => { clean(); reject(error) })
    child.on('exit', kill)
    child.on('close', (code, sig) => { clean(); cancelled ? reject(new Error('job cancelled')) : resolve(timedOut ? 124 : (code ?? (sig ? 128 : -1))) })
  })
  return { code, changed: collectChanges(prepared.files, job.files) }
}
