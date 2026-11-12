import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { prepareJob, validateJob } from '../job.js'
import { runNative } from '../sandbox.js'

const linux = process.platform === 'linux'
const limits = { memoryBytes: 128 * 1024 * 1024, workspaceBytes: 16 * 1024 * 1024, cpuPercent: 25, pids: 32 }
async function execute (command, files = {}, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-native-test-'))
  const job = validateJob({ id: 'test', room: 'isolation', command, files, timeoutMs: 10000, ...extra.job })
  const prepared = prepareJob(root, job); let output = ''
  try {
    const result = await runNative(prepared, job, { bwrap: process.env.VESPR_TEST_BWRAP, limits, onChunk: s => { output += s }, ...extra.options })
    return { ...result, output }
  } finally { prepared.cleanup(); fs.rmSync(root, { recursive: true, force: true }) }
}
test('real Linux: host secrets, network, mounts, environment and user namespaces are isolated', { skip: !linux }, async () => {
  const host = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-host-secret-'))
  const secret = path.join(host, 'secret'); fs.writeFileSync(secret, 'host-private')
  const server = net.createServer(s => s.destroy()); await new Promise(r => server.listen(0, '127.0.0.1', r))
  process.env.VESPR_TEST_SECRET = 'must-not-leak'
  try {
    const script = `import os, socket, subprocess, json\nassert not os.path.exists(${JSON.stringify(secret)})\nassert 'VESPR_TEST_SECRET' not in os.environ\nassert not os.path.exists('/run/user')\nassert not os.path.exists('/var/run/docker.sock')\nassert os.getppid() == 2 or os.getppid() == 1\ns=socket.socket(); s.settimeout(.2)\nassert s.connect_ex(('127.0.0.1', ${server.address().port})) != 0\ns.close()\nassert subprocess.run(['unshare','-Ur','true'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode != 0\nv=os.statvfs('/workspace'); assert v.f_blocks*v.f_frsize == ${limits.workspaceBytes}\ntry:\n open('/input/files/overwrite','w').write('no')\n raise AssertionError('input writable')\nexcept OSError: pass\nopen('made.txt','w').write('isolated')\nos.symlink(${JSON.stringify(secret)}, 'secret-link')\nprint('ISOLATION_OK')\n`
    const result = await execute('python3 check.py', { 'check.py': script })
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /ISOLATION_OK/)
    assert.deepEqual({ ...result.changed }, { 'made.txt': 'isolated' })
    assert.equal(fs.readFileSync(secret, 'utf8'), 'host-private')
  } finally { delete process.env.VESPR_TEST_SECRET; server.close(); fs.rmSync(host, { recursive: true, force: true }) }
})
test('real Linux: tmpfs writes stop at the disk budget and process creation is capped', { skip: !linux }, async () => {
  const script = `import errno, subprocess\ntry:\n with open('fill','wb') as f:\n  for _ in range(24): f.write(b'x'*1048576)\n raise AssertionError('workspace limit missing')\nexcept OSError as e: assert e.errno == errno.ENOSPC\nchildren=[]\ntry:\n for _ in range(40): children.append(subprocess.Popen(['sleep','5']))\n raise AssertionError('PID limit missing')\nexcept OSError as e: assert e.errno == errno.EAGAIN\nfinally:\n for p in children: p.kill(); p.wait()\nprint('LIMITS_OK')\n`
  const result = await execute('python3 limits.py', { 'limits.py': script })
  assert.equal(result.code, 0, result.output); assert.match(result.output, /LIMITS_OK/)
})
test('real Linux: timeout and cancellation remove the service and all descendants', { skip: !linux }, async () => {
  const unit = `vespr-job-cleanup-${process.pid}.service`
  const result = await execute('setsid sleep 30 & wait', {}, { job: { timeoutMs: 200 }, options: { unit } })
  assert.equal(result.code, 124, result.output)
  assert.throws(() => execFileSync('/usr/bin/systemctl', ['--user', 'is-active', '--quiet', unit]))
  const controller = new AbortController()
  const running = execute('setsid sleep 30 & wait', {}, { options: { unit, signal: controller.signal } })
  setTimeout(() => controller.abort(), 250)
  await assert.rejects(running, /cancelled/)
  assert.throws(() => execFileSync('/usr/bin/systemctl', ['--user', 'is-active', '--quiet', unit]))
})
test('real Linux: immediate cancellation cannot race service registration and execute the guest', { skip: !linux }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-cancel-race-'))
  const marker = path.join(root, 'executed'); const wrapper = path.join(root, 'test-bwrap')
  const bwrap = process.env.VESPR_TEST_BWRAP || '/usr/bin/bwrap'
  const quote = text => "'" + text.replaceAll("'", "'\\''") + "'"
  fs.writeFileSync(wrapper, `#!/bin/sh\nprintf executed > ${quote(marker)}\nexec ${quote(bwrap)} "$@"\n`, { mode: 0o700 })
  try {
    for (let i = 0; i < 3; i++) {
      const controller = new AbortController(); const unit = `vespr-job-race-${process.pid}-${i}.service`
      const running = execute('echo should-not-execute', {}, { options: { unit, bwrap: wrapper, signal: controller.signal } })
      controller.abort()
      await assert.rejects(running, /cancelled/)
      assert.equal(fs.existsSync(marker), false)
      assert.throws(() => execFileSync('/usr/bin/systemctl', ['--user', 'is-active', '--quiet', unit]))
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
test('real Linux: an owner-readable synthetic host key cannot be read by key serial from the guest', { skip: !linux }, async t => {
  const script = `import ctypes, errno, os, sys\nlib=ctypes.CDLL(None,use_errno=True)\nnums={'aarch64':(217,218,219),'x86_64':(248,249,250)}[os.uname().machine]\ndef keyctl(*args): return lib.syscall(ctypes.c_long(nums[2]),*args)\nif sys.argv[1]=='seed':\n ring=keyctl(1,ctypes.c_char_p(('vespr-test-'+str(os.getpid())).encode()))\n value=b'vespr-synthetic-key-only'\n key=lib.syscall(ctypes.c_long(nums[0]),ctypes.c_char_p(b'user'),ctypes.c_char_p(b'vespr-test'),ctypes.c_char_p(value),len(value),ring) if ring>=0 else -1\n if key<0: print('UNAVAILABLE',flush=True); sys.exit(0)\n try:\n  assert keyctl(5,key,0x3f3f0000)==0\n  print(key,flush=True); sys.stdin.readline()\n finally: keyctl(3,key)\nelse:\n buf=ctypes.create_string_buffer(128); ctypes.set_errno(0)\n result=keyctl(11,int(sys.argv[2]),buf,len(buf))\n if sys.argv[1]=='guest':\n  assert result==-1 and ctypes.get_errno()==errno.EPERM\n  print('KEY_BLOCKED')\n else:\n  assert result>0 and buf.value==b'vespr-synthetic-key-only'\n  print('HOST_KEY_READABLE')\n`
  const seed = spawn('/usr/bin/python3', ['-I', '-S', '-u', '-c', script, 'seed'], { stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    const [data] = await once(seed.stdout, 'data')
    const serial = data.toString().trim()
    if (serial === 'UNAVAILABLE') { t.skip('host kernel disallows synthetic key creation; guard still verifies syscall denial'); return }
    assert.match(serial, /^\d+$/)
    assert.match(execFileSync('/usr/bin/python3', ['-I', '-S', '-c', script, 'host', serial], { encoding: 'utf8' }), /HOST_KEY_READABLE/)
    const result = await execute(`python3 key.py guest ${serial}`, { 'key.py': script })
    assert.equal(result.code, 0, result.output); assert.match(result.output, /KEY_BLOCKED/)
  } finally {
    const exited = once(seed, 'exit'); seed.stdin.end('\n')
    const timer = setTimeout(() => seed.kill('SIGKILL'), 2000)
    if (seed.exitCode === null) await exited
    clearTimeout(timer)
  }
})
