// GitHub, step one: open a repository in the workspace. A tiny GitHub (a fake API and a real tar.gz) against a real collab server and a real agent room.
import { spawn, execFileSync } from 'node:child_process'
import net from 'node:net'
import zlib from 'node:zlib'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { joinRoom } from '../src/room.js'
import { parseRepo, untar, blobSha, importRepo, describe, startGithub, githubFetchers, LIMITS } from '../src/github.js'
import { createClient } from '../../app/vespr-client.js'

// a minimal tar writer (ustar, plus a pax record when a name is longer than 100 bytes), like what GitHub sends
function tarOf (entries) {
  const blocks = []
  const header = (name, size, type) => { const h = Buffer.alloc(512); h.write(name.slice(0, 100), 0); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116); h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('        ', 148); h.write(type, 156); h.write('ustar\0', 257); return h }
  const add = (name, data, type = '0') => { blocks.push(header(name, data.length, type), data, Buffer.alloc((512 - (data.length % 512)) % 512)) }
  for (const [name, data] of entries) {
    const b = Buffer.isBuffer(data) ? data : Buffer.from(data)
    if (name.length > 100) { const rec = ' path=' + name + '\n'; let len = rec.length + 1; len = (rec.length + String(len).length) ; const full = `${len} path=${name}\n`; const fixed = `${Buffer.byteLength(full) + (String(Buffer.byteLength(full)).length > String(len).length ? 1 : 0)} path=${name}\n`; add('pax', Buffer.from(fixed), 'x') }
    add(name, b, name.endsWith('/') ? '5' : '0')
  }
  blocks.push(Buffer.alloc(1024)); return zlib.gzipSync(Buffer.concat(blocks))
}

// parsing the ways to name a repository
assert.deepStrictEqual(parseRepo('acme/tool'), { owner: 'acme', repo: 'tool', ref: '', path: '' })
assert.deepStrictEqual(parseRepo('https://github.com/acme/tool/tree/dev/src/lib'), { owner: 'acme', repo: 'tool', ref: 'dev', path: 'src/lib' })
for (const bad of ['', 'http://github.com/a/b', 'https://evil.example/a/b', 'not a repo', 'a/b/c']) assert.throws(() => parseRepo(bad), undefined, bad)

// the tar reader: long names (pax), folders, the top folder
const long = 'o-r-abc1234/' + 'deep/'.repeat(30) + 'file.txt'
const files = untar(zlib.gunzipSync(tarOf([['o-r-abc1234/', ''], ['o-r-abc1234/a.txt', 'hello\n'], [long, 'long one\n']])))
assert.deepStrictEqual(files.map(f => f.path), ['o-r-abc1234/a.txt', long]); assert.strictEqual(files[1].data.toString(), 'long one\n')
assert.throws(() => untar(Buffer.concat([Buffer.alloc(100, 97), Buffer.alloc(24), Buffer.from('77777777777\0'), Buffer.alloc(376)])), /damaged/)
// git's own name for a file
const sample = 'héllo\nworld\n'; assert.strictEqual(blobSha(sample), execFileSync('git', ['hash-object', '--stdin'], { input: sample }).toString().trim())

// importing with a fake GitHub
const SHA = 'c'.repeat(40)
const repoFiles = [['o-r-ccccccc/', ''], ['o-r-ccccccc/README.md', '# New readme\n'], ['o-r-ccccccc/LICENSE', 'MIT License\n'], ['o-r-ccccccc/src/app.py', 'print("app")\n'], ['o-r-ccccccc/src/util.py', 'def u():\n    return 1\n'],
  ['o-r-ccccccc/big.txt', 'x'.repeat(LIMITS.perFile + 1)], ['o-r-ccccccc/logo.png', Buffer.from([137, 80, 78, 71, 0, 1, 2, 3])], ['o-r-ccccccc/node_modules/dep/index.js', 'x'], ['o-r-ccccccc/.git/config', 'x'],
  ['o-r-ccccccc/weird name.txt', 'x'], ['o-r-ccccccc/../evil.txt', 'x']]
const calls = []
const fake = {
  fetchJson: async u => {
    calls.push(u)
    if (/\/commits\//.test(u)) return { sha: SHA }
    if (/\/repos\/o\/missing$/.test(u)) throw new Error('GitHub says that repository, branch or folder does not exist (or it is private)')
    return { default_branch: 'main', license: { spdx_id: 'MIT' }, private: false }
  },
  fetchBuffer: async u => { calls.push(u); assert.match(u, new RegExp('/tarball/' + SHA + '$'), 'the download is pinned to the commit'); return tarOf(repoFiles) }
}
const mem = new Map([['README.md', 'mine\n']]); const room = { list: () => [...mem.keys()], write: (p, t) => { if (!/^[\w.\-/]+$/.test(p)) return { error: 'bad path' }; mem.set(p, t); return { ok: true } } }
const res = await importRepo({ room, input: 'o/r', ...fake })
assert.deepStrictEqual(res.written.sort(), ['LICENSE', 'src/app.py', 'src/util.py'])
assert.deepStrictEqual(res.skipped, { ignored: 2, big: 1, binary: 1, name: 2, limit: 0, exists: 1 })
assert.strictEqual(mem.get('README.md'), 'mine\n', 'an existing file is never overwritten')
assert.strictEqual(res.sha, SHA); assert.strictEqual(res.ref, 'main'); assert.strictEqual(res.license, 'MIT')
assert.strictEqual(res.base['src/app.py'], execFileSync('git', ['hash-object', '--stdin'], { input: 'print("app")\n' }).toString().trim(), 'the stored hash is the git hash')
assert.match(describe(res), /Opened o\/r at main \(ccccccc, MIT\): 3 files added\. Skipped: 1 too big, 1 binary, 2 in dependency or build folders, 2 with names the workspace cannot hold, 1 already in the workspace and left alone\./)
// a folder only
mem.clear(); const sub = await importRepo({ room, input: 'https://github.com/o/r/tree/dev/src', ...fake }); assert.deepStrictEqual(sub.written.sort(), ['app.py', 'util.py']); assert.strictEqual(sub.ref, 'dev'); assert.match(describe(sub), /Opened o\/r\/src at dev/)
// limits
mem.clear(); const many = { ...fake, fetchBuffer: async () => tarOf(Array.from({ length: LIMITS.files + 5 }, (_, i) => [`o-r-ccccccc/f${i}.txt`, 'x'])) }
const lim = await importRepo({ room, input: 'o/r', ...many }); assert.strictEqual(lim.written.length, LIMITS.files); assert.strictEqual(lim.skipped.limit, 5)
// a bad commit answer and a broken download are refused
await assert.rejects(() => importRepo({ room, input: 'o/r', ...fake, fetchJson: async u => /commits/.test(u) ? { sha: 'main' } : { default_branch: 'main' } }), /pin/)
await assert.rejects(() => importRepo({ room, input: 'o/r', ...fake, fetchBuffer: async () => Buffer.from('not a tarball') }), /could not read/)

// the real fetchers: only GitHub hosts, and the token goes to the API host only
const seen = []; const f = githubFetchers({ token: 'test-token-value', fetchImpl: async (u, o) => { seen.push([u, o.headers.Authorization || '']); return { ok: true, status: 200, headers: { get: () => '3' }, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(3) } } })
await assert.rejects(() => f.fetchJson('https://evil.example/x'), /only GitHub hosts/); await assert.rejects(() => f.fetchJson('http://api.github.com/x'), /only GitHub hosts/)
await f.fetchJson('https://api.github.com/repos/o/r'); await f.fetchBuffer('https://codeload.github.com/o/r/tar.gz/x')
assert.strictEqual(seen[0][1], 'Bearer test-token-value'); assert.strictEqual(seen[1][1], '', 'no token to the download host')
for (const [code, re] of [[404, /does not exist/], [403, /rate limit or no access/], [500, /answered 500/]]) await assert.rejects(() => githubFetchers({ fetchImpl: async () => ({ ok: false, status: code }) }).fetchJson('https://api.github.com/x'), re)

// end to end: a person asks from the app, the agent opens it and says so
const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(50) } throw new Error('timed out waiting for: ' + what) }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-gh-')); fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort(); const here = path.dirname(new URL(import.meta.url).pathname)
const srv = spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' })
let alice, agent, handler, off
try {
  await wait(800)
  const server = 'ws://127.0.0.1:' + PORT; const deps = { Y, WebsocketProvider, WebSocketPolyfill: WebSocket }
  alice = createClient({ server, room: 'r1', token: 'tok-a', name: 'alice', deps }); await alice.ready
  agent = joinRoom({ server, room: 'r1', token: 'tok-c', name: 'coder', color: '#5eead4', model: 'fake-model' }); await agent.ready
  handler = startGithub({ room: agent, fetchers: fake })
  await until(() => alice.get().githubImport, 'the app learns that opening repositories works'); assert.strictEqual(alice.get().github, null)
  assert.throws(() => alice.importRepo('  '), /give a repository/)
  alice.importRepo('o/r')
  await until(() => alice.get().github, 'the repository is recorded')
  const g = alice.get().github; assert.strictEqual(g.sha, SHA); assert.strictEqual(g.owner, 'o'); assert.strictEqual(g.files, 4); assert.strictEqual(g.by, 'alice')
  assert.deepStrictEqual(alice.get().files.sort(), ['LICENSE', 'README.md', 'src/app.py', 'src/util.py']); assert.strictEqual(alice.read('src/app.py'), 'print("app")\n')
  assert.strictEqual(agent.settings.get('githubBase')['src/app.py'], blobSha('print("app")\n'), 'the starting point is kept for a later pull request')
  await until(() => alice.get().messages.some(m => m.isAgent && /Opened o\/r at main \(ccccccc, MIT\): 4 files added/.test(m.text)), 'the agent says what it opened')
  // a failure is explained, not hidden
  fake.fetchJson = async () => { throw new Error('GitHub says that repository, branch or folder does not exist (or it is private)') }
  alice.importRepo('o/missing')
  await until(() => alice.get().messages.some(m => m.isAgent && /Could not open that repository: GitHub says that repository/.test(m.text)), 'the failure is reported')
  // not set up: the app is told, and a request gets an honest answer
  off = joinRoom({ server, room: 'r2', token: 'tok-c', name: 'coder', color: '#5eead4', model: 'fake-model' }); await off.ready
  const h2 = startGithub({ room: off, fetchers: null }); const alice2 = createClient({ server, room: 'r2', token: 'tok-a', name: 'alice', deps }); await alice2.ready
  await until(() => alice2.get().status === 'connected' && alice2.get().people.some(p => p.isAgent), 'second room'); assert.strictEqual(alice2.get().githubImport, false)
  alice2.importRepo('o/r'); await until(() => alice2.get().messages.some(m => /not set up on this server/.test(m.text)), 'honest refusal'); h2.stop(); alice2.destroy && alice2.destroy()
  console.log('github import tests passed: names, tar reader, pinned import, skips and limits, git hashes, fetch rules, end to end, failures')
} finally {
  try { handler && handler.stop() } catch {}
  try { alice && alice.destroy && alice.destroy() } catch {}
  try { agent && agent.destroy() } catch {}; try { off && off.destroy() } catch {}
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); setTimeout(() => process.exit(0), 200)
}
