import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import { startRunner } from '../lib.js'

async function harness (options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-wire-'))
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await once(server, 'listening')
  const connected = once(server, 'connection')
  const runner = startRunner({ server: `ws://127.0.0.1:${server.address().port}`, token: 'test-only', root, isolation: 'trusted-local', canRun: async () => true, log: () => {}, ...options })
  const [socket] = await connected
  const messages = []; const watchers = new Set()
  socket.on('message', raw => { const value = JSON.parse(raw); messages.push(value); for (const f of watchers) f(value) })
  const result = id => new Promise((resolve, reject) => {
    const done = value => { if (value.id === id && value.type === 'result') { clearTimeout(timer); watchers.delete(done); resolve(value) } }
    const timer = setTimeout(() => { watchers.delete(done); reject(new Error('result timeout: ' + id)) }, 5000)
    watchers.add(done)
    for (const value of messages) done(value)
  })
  return {
    root, messages, runner, result,
    send: job => socket.send(JSON.stringify({ type: 'job', room: 'room', files: {}, timeoutMs: 1000, ...job })),
    close: async () => { runner.stop(); for (const client of server.clients) client.terminate(); await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }) }
  }
}
test('wire: consent and command/file results remain compatible, and private directories are cleaned', async () => {
  let prompts = 0
  const h = await harness({ canRun: async () => { prompts++; return true } })
  try {
    h.send({ id: '../../unsafe-id', room: '../unsafe-room', command: 'echo done > made.txt' })
    const result = await h.result('../../unsafe-id')
    assert.equal(result.code, 0); assert.match(result.changed['made.txt'], /done/)
    assert.deepEqual(fs.readdirSync(h.root), [])
    h.send({ id: 'again', room: '../unsafe-room', command: 'echo hello' })
    assert.equal((await h.result('again')).code, 0); assert.equal(prompts, 1)
  } finally { await h.close() }
})
test('wire: concurrent jobs cannot race consent or create unbounded job folders', async () => {
  let allow; let prompts = 0
  const h = await harness({ canRun: () => { prompts++; return new Promise(r => { allow = r }) } })
  try {
    h.send({ id: 'first', command: 'echo first' })
    h.send({ id: 'second', command: 'echo second' })
    assert.match((await h.result('second')).error, /busy/)
    assert.equal(prompts, 1); assert.deepEqual(fs.readdirSync(h.root), [])
    allow(true); assert.equal((await h.result('first')).code, 0)
  } finally { await h.close() }
})
test('wire: refusal and malformed inputs return terminal results without executing', async () => {
  const h = await harness({ canRun: async () => false })
  try {
    h.send({ id: 'denied', command: 'echo denied' }); assert.match((await h.result('denied')).error, /does not allow/)
    h.send({ id: 'path', command: 'echo bad', files: { '../escape': 'bad' } }); assert.match((await h.result('path')).error, /path/)
    assert.deepEqual(fs.readdirSync(h.root), [])
  } finally { await h.close() }
})
test('wire: native failure cannot be downgraded by job-controlled isolation options', async () => {
  const h = await harness({ isolation: 'native', nativeOptions: { bwrap: '/missing/bwrap' } })
  try {
    h.send({ id: 'refuse', command: 'echo unsafe > marker', isolation: 'trusted-local' })
    const result = await h.result('refuse')
    assert.equal(result.code, -1); assert.match(result.error, /isolation|Linux/)
    assert.equal(result.changed, undefined); assert.deepEqual(fs.readdirSync(h.root), [])
  } finally { await h.close() }
})
test('wire: stopping the runner cancels its active host process and removes temporary input', async () => {
  const h = await harness()
  try {
    h.send({ id: 'stop', command: 'node wait.js', files: { 'wait.js': 'console.log("READY"); setTimeout(() => {}, 30000)' }, timeoutMs: 10000 })
    const started = Date.now()
    while (!h.messages.some(m => m.type === 'chunk' && /READY/.test(m.data))) {
      if (Date.now() - started > 6000) throw new Error('command not ready')
      await new Promise(r => setTimeout(r, 20))
    }
    h.runner.stop()
    while (fs.readdirSync(h.root).length) {
      if (Date.now() - started > 8000) throw new Error('stopped job not cleaned')
      await new Promise(r => setTimeout(r, 20))
    }
  } finally { await h.close() }
})
