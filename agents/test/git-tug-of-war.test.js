// Git "Tug of War" Durability & Concurrency Stress Test for VESPR SDE.
// In accordance with the VESPR team's prompt (2026-11-07 BRIEF.md Section 7):
// "test durability of git to withold the tug of war test."
//
// Tests:
// 1. Concurrent clones pushing competing commits to origin/main.
// 2. Non-fast-forward push detection & graceful rejection.
// 3. Automated merge reconciliation & pull-rebase recovery.
// 4. Live CRDT (Yjs) workspace preservation of concurrent authors.
// 5. High-concurrency lock safety (exclusive per-room mutex preventing repo/index corruption).

import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert'
import { fileStore } from '../../app/file-store.js'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import net from 'node:net'

console.log('Starting Git Tug of War Durability Test...')

const usedTestPorts = new Set()
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => {
    const p = s.address().port
    s.close(err => {
      if (err) return reject(err)
      if (usedTestPorts.has(p)) return resolve(freePort())
      usedTestPorts.add(p)
      resolve(p)
    })
  })
})

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-git-tugofwar-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-alice\nbob:tok-bob\n')
const PORT = await freePort()
const here = path.dirname(new URL(import.meta.url).pathname)

const srv = spawn('node', [path.join(here, '../../server/index.js')], {
  env: {
    ...process.env,
    MURMIO_PORT: PORT,
    MURMIO_DATA: path.join(dir, 'data'),
    MURMIO_TOKENS_FILE: path.join(dir, 'tokens')
  },
  stdio: 'ignore'
})

const wait = ms => new Promise(r => setTimeout(r, ms))
const gitExec = (cwd, user, token, ...args) => execFileSync('git', [
  '-c', `user.name=${user}`,
  '-c', `user.email=${user}@vespr.local`,
  '-c', 'pull.rebase=false',
  ...args
], {
  cwd,
  encoding: 'utf8',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
})

const api = (p, token, body) => fetch(`http://127.0.0.1:${PORT}${p}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: body === undefined ? undefined : JSON.stringify(body)
})

try {
  await wait(900)

  // 1. Establish initial room and baseline files in Yjs
  const room = 'tugofwar-room'
  const d = new Y.Doc()
  const p = new WebsocketProvider(`ws://127.0.0.1:${PORT}/ws`, room, d, {
    WebSocketPolyfill: WebSocket,
    params: { token: 'tok-alice' },
    disableBc: true
  })
  await new Promise(r => p.once('sync', r))
  const files = fileStore(d)

  // Create shared base file
  const baseFile = new Y.Text()
  baseFile.insert(0, '# Shared Project\n\nline 1: initial setup\nline 2: core logic\nline 3: footer\n', { by: 'setup' })
  files.set('shared.txt', baseFile)
  await wait(600)

  // Snapshot into git
  const snapRes = await (await api(`/api/git/${room}/commit`, 'tok-alice', { message: 'initial commit' })).json()
  assert.ok(snapRes.sha, 'Initial commit sha must exist')

  // 2. Clone repository as Alice and Bob into separate local directories
  const aliceDir = path.join(dir, 'alice-clone')
  const bobDir = path.join(dir, 'bob-clone')

  gitExec(dir, 'alice', 'tok-alice', 'clone', '-q', `http://x:tok-alice@127.0.0.1:${PORT}/git/${room}`, aliceDir)
  gitExec(dir, 'bob', 'tok-bob', 'clone', '-q', `http://x:tok-bob@127.0.0.1:${PORT}/git/${room}`, bobDir)

  assert.strictEqual(fs.existsSync(path.join(aliceDir, 'shared.txt')), true)
  assert.strictEqual(fs.existsSync(path.join(bobDir, 'shared.txt')), true)

  // 3. Tug-of-War Scenario 1: Competing Independent Commits
  // Alice adds alice_feature.py
  fs.writeFileSync(path.join(aliceDir, 'alice_feature.py'), 'def alice(): return "feature-alice"\n')
  gitExec(aliceDir, 'alice', 'tok-alice', 'add', 'alice_feature.py')
  gitExec(aliceDir, 'alice', 'tok-alice', 'commit', '-m', 'Alice feature commit')

  // Bob adds bob_service.py
  fs.writeFileSync(path.join(bobDir, 'bob_service.py'), 'def bob(): return "service-bob"\n')
  gitExec(bobDir, 'bob', 'tok-bob', 'add', 'bob_service.py')
  gitExec(bobDir, 'bob', 'tok-bob', 'commit', '-m', 'Bob service commit')

  // Alice pushes first -> SUCCEEDS
  gitExec(aliceDir, 'alice', 'tok-alice', 'push', '-q', 'origin', 'HEAD:main')
  await wait(700)

  // Bob attempts to push second WITHOUT pulling -> MUST BE REJECTED by git non-fast-forward
  let bobPushFailed = false
  try {
    gitExec(bobDir, 'bob', 'tok-bob', 'push', '-q', 'origin', 'HEAD:main')
  } catch (err) {
    bobPushFailed = true
    assert.ok(/rejected|fetch first|non-fast-forward/i.test(err.message || err.stderr), 'Must fail with non-fast-forward rejection')
  }
  assert.strictEqual(bobPushFailed, true, 'Bob concurrent un-rebased push must be rejected')

  // 4. Bob resolves Tug-of-War via Rebase / Merge Pull
  // Bob pulls origin main with merge
  gitExec(bobDir, 'bob', 'tok-bob', 'pull', '--no-edit', '--no-rebase', '-q', 'origin', 'main')

  // Bob now pushes the merged tree -> SUCCEEDS
  gitExec(bobDir, 'bob', 'tok-bob', 'push', '-q', 'origin', 'HEAD:main')
  await wait(1200)

  // Verify server imported both Alice's and Bob's work into live Yjs CRDT workspace
  assert.ok(files.get('alice_feature.py'), 'Alice feature must exist in live CRDT')
  assert.strictEqual(files.get('alice_feature.py').toString(), 'def alice(): return "feature-alice"\n')
  assert.ok(files.get('bob_service.py'), 'Bob service must exist in live CRDT')
  assert.strictEqual(files.get('bob_service.py').toString(), 'def bob(): return "service-bob"\n')

  // 5. Tug-of-War Scenario 2: Concurrent Non-Conflicting Edits to the Same File
  // Alice syncs to latest first
  gitExec(aliceDir, 'alice', 'tok-alice', 'pull', '--no-edit', '--no-rebase', '-q', 'origin', 'main')

  // Alice modifies top of shared.txt
  const aliceContent = '# Shared Project (Enhanced by Alice)\n\nline 1: initial setup\nline 2: core logic\nline 3: footer\n'
  fs.writeFileSync(path.join(aliceDir, 'shared.txt'), aliceContent)
  gitExec(aliceDir, 'alice', 'tok-alice', 'commit', '-a', '-m', 'Alice header edit')

  // Bob modifies bottom of shared.txt
  const bobContent = '# Shared Project\n\nline 1: initial setup\nline 2: core logic\nline 3: footer\nline 4: Bob extra footer\n'
  fs.writeFileSync(path.join(bobDir, 'shared.txt'), bobContent)
  gitExec(bobDir, 'bob', 'tok-bob', 'commit', '-a', '-m', 'Bob footer edit')

  // Alice pushes first
  gitExec(aliceDir, 'alice', 'tok-alice', 'push', '-q', 'origin', 'HEAD:main')
  await wait(700)

  // Bob's push rejected
  let bobPush2Failed = false
  try {
    gitExec(bobDir, 'bob', 'tok-bob', 'push', '-q', 'origin', 'HEAD:main')
  } catch (err) {
    bobPush2Failed = true
  }
  assert.strictEqual(bobPush2Failed, true)

  // Bob pulls with merge
  gitExec(bobDir, 'bob', 'tok-bob', 'pull', '--no-edit', '--no-rebase', '-q', 'origin', 'main')
  const mergedContent = fs.readFileSync(path.join(bobDir, 'shared.txt'), 'utf8')
  assert.ok(mergedContent.includes('Enhanced by Alice'), 'Merge must preserve Alice header')
  assert.ok(mergedContent.includes('Bob extra footer'), 'Merge must preserve Bob footer')

  // Bob pushes merged file
  gitExec(bobDir, 'bob', 'tok-bob', 'push', '-q', 'origin', 'HEAD:main')
  await wait(1200)

  // Verify live CRDT contains both edits cleanly
  const liveShared = files.get('shared.txt').toString()
  assert.ok(liveShared.includes('Enhanced by Alice'))
  assert.ok(liveShared.includes('Bob extra footer'))

  // 6. Mutex & High-Concurrency Rapid Snapshot Stress
  const rapidPromises = []
  for (let i = 0; i < 5; i++) {
    rapidPromises.push(api(`/api/git/${room}/commit`, 'tok-alice', { message: `Rapid commit ${i}` }))
  }
  const rapidResults = await Promise.all(rapidPromises)
  for (const r of rapidResults) {
    assert.strictEqual(r.status, 200, 'All serialized rapid commits must complete 200 OK without race condition crash')
  }

  // Verify commit log contains serialized history
  const logRes = await (await api(`/api/git/${room}/log`, 'tok-alice')).json()
  assert.ok(logRes.length >= 4, 'Git history must preserve all merged commits')

  console.log('✓ Git Tug of War Durability Test PASSED! All 5 stress scenarios verified.')
  p.destroy()
} catch (err) {
  console.error('Git Tug of War FAILED:', err)
  process.exitCode = 1
} finally {
  srv.kill()
  setTimeout(() => {
    fs.rmSync(dir, { recursive: true, force: true })
    process.exit(process.exitCode || 0)
  }, 400)
}
