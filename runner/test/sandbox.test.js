import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateJob, prepareJob, collectChanges, LIMITS } from '../job.js'
import { launchSpec, runNative } from '../sandbox.js'

const job = (files = {}) => ({ id: '../../outside', room: '../room', command: 'echo hello', files })
test('reject unsafe paths and oversized or malformed job input before writing', () => {
  for (const name of ['../escape', '/absolute', 'a/../b', 'C:/drive', 'a\\b', 'a//b', 'a/./b', 'bad\0name']) {
    assert.throws(() => validateJob(job({ [name]: 'x' })), /path/)
  }
  for (const files of [[], null, { a: 42 }, { a: 'x'.repeat(LIMITS.inputBytes + 1) }]) {
    assert.throws(() => validateJob(job(files)))
  }
  for (const timeoutMs of [0, -1, NaN, Infinity, '1000']) assert.throws(() => validateJob({ ...job(), timeoutMs }))
  assert.throws(() => validateJob({ ...job(), command: '' }))
  assert.throws(() => validateJob(job({ a: '', 'a/b': '' })), /conflict/)
})
test('room and job IDs never determine disk paths; cleanup removes only random private directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-input-test-'))
  const prepared = prepareJob(root, validateJob(job({ 'src/a.py': 'print(1)' })))
  try {
    assert.equal(path.dirname(prepared.dir), root)
    assert.equal(fs.readFileSync(path.join(prepared.files, 'src/a.py'), 'utf8'), 'print(1)')
    assert.equal(fs.statSync(prepared.dir).mode & 0o077, 0)
  } finally { prepared.cleanup(); fs.rmSync(root, { recursive: true, force: true }) }
})
test('artifact collector does not follow symlinks, special files, or unbounded trees', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-artifact-test-'))
  try {
    fs.writeFileSync(path.join(root, 'ok.txt'), 'hello')
    fs.writeFileSync(path.join(root, 'large'), Buffer.alloc(LIMITS.fileBytes + 1, 65))
    fs.symlinkSync('/etc/passwd', path.join(root, 'secret'))
    fs.symlinkSync(root, path.join(root, 'cycle'))
    fs.mkdirSync(path.join(root, '.git')); fs.writeFileSync(path.join(root, '.git', 'secret'), 'hidden')
    assert.deepEqual({ ...collectChanges(root, {}) }, { 'ok.txt': 'hello' })
    assert.deepEqual({ ...collectChanges(root, { 'ok.txt': 'hello' }) }, {})
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
test('reject shared-writable roots and symlink roots before staging input', { skip: process.platform === 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-root-test-'))
  const link = root + '-link'
  try {
    fs.chmodSync(root, 0o777)
    assert.throws(() => prepareJob(root, validateJob(job())), /owned directory/)
    fs.chmodSync(root, 0o700); fs.symlinkSync(root, link)
    assert.throws(() => prepareJob(link, validateJob(job())), /owned directory/)
  } finally { fs.rmSync(link, { force: true }); fs.rmSync(root, { recursive: true, force: true }) }
})
test('native launch has private namespaces, capped tmpfs, cgroup limits and no writable host bind', () => {
  const spec = launchSpec('/tmp/private-input', { timeoutMs: 1000 }, { unit: 'vespr-job-test.service' })
  assert.equal(spec.file, '/usr/bin/systemd-run')
  for (const flag of ['--user', '--wait', '--pipe', '--collect', '--expand-environment=no', '--unshare-user', '--unshare-net', '--unshare-pid', '--disable-userns', '--clearenv', '--as-pid-1']) assert.ok(spec.args.includes(flag), flag)
  assert.ok(spec.args.includes('MemoryMax=268435456'))
  assert.ok(spec.args.includes('MemorySwapMax=0'))
  assert.ok(spec.args.includes('CPUQuota=50%'))
  assert.ok(spec.args.includes('TasksMax=64'))
  assert.ok(spec.args.includes('KillMode=control-group'))
  assert.ok(spec.args.includes('KeyringMode=private'))
  assert.ok(spec.args.includes('SystemCallFilter=~@keyring'))
  assert.ok(!spec.args.includes('--bind'))
  const i = spec.args.indexOf('--size')
  assert.deepEqual(spec.args.slice(i, i + 4), ['--size', '67108864', '--tmpfs', '/workspace'])
  assert.ok(!spec.args.includes('echo hello'))
})
test('missing native prerequisites fail closed without running a host command', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-refuse-test-'))
  const marker = path.join(root, 'escaped')
  const prepared = prepareJob(root, validateJob({ ...job(), command: `touch ${marker}` }))
  try {
    await assert.rejects(runNative(prepared, { ...job(), timeoutMs: 1000 }, { bwrap: '/missing/vespr-bwrap' }), /isolation|Linux|bubblewrap/)
    assert.equal(fs.existsSync(marker), false)
  } finally { prepared.cleanup(); fs.rmSync(root, { recursive: true, force: true }) }
})
