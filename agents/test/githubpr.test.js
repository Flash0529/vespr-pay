// GitHub step two: pull requests. A FAKE GitHub API (a model of git objects, refs and pull requests behind a fake fetch, so the real githubApi() code and its token handling run), no network.
// Covers: call order and payloads, deletions, file modes, the snapshot that is sent, a stale base, a taken branch name, a denied card (no call at all), no token, nothing to send, files that collide,
// a folder import, failures at every step, the token never appearing anywhere, and the protocol between the app's client and the agent over a real server.
import assert from 'node:assert'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { joinRoom } from '../src/room.js'
import { blobSha } from '../src/github.js'
import { planPr, draftPr, openPr, githubApi, startGithubPr, describePr, branchName, redact, LIMITS } from '../src/githubpr.js'
import { createClient } from '../../app/vespr-client.js'

const NOW = Date.parse('2026-10-29T10:00:00Z'); const T0 = Date.parse('2026-10-29T08:00:00Z')
const PIN = 'a'.repeat(40); const TIP = 'c'.repeat(40); const TREE0 = 'b'.repeat(40); const TOKEN = 'ghp_SENTINEL' + 'x'.repeat(30)
const CHAT_SECRET = 'ghp_CHATSECRET' + 'z'.repeat(30)
const sha1 = x => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex')
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(30) } throw new Error('timed out waiting for: ' + what) }

// ---- a model of GitHub: the repository at the pinned commit, plus what gets created ----
function makeGithub ({ owner = 'acme', repo = 'shop', ref = 'main', files, moved = false, upstream = [], truncated = false, taken = [], fail = {}, corruptBlob = false } = {}) {
  const calls = []; const blobs = new Map(); const trees = new Map(); const commits = new Map(); const prs = []
  const refs = new Map([['refs/heads/' + ref, moved ? TIP : PIN], ...taken.map(t => ['refs/heads/' + t, PIN])])
  const at = new Map(Object.entries(files).map(([p, f]) => [p, { mode: f.mode || '100644', sha: blobSha(f.text) }]))
  const R = `/repos/${owner}/${repo}`
  const gh = { calls, refs, prs, trees, commits, blobs, touchedBase: false }
  const reply = (status, data) => ({ ok: status < 400, status, json: async () => data })
  gh.fetch = async (url, opts = {}) => {
    const u = new URL(url); const method = opts.method || 'GET'; const body = opts.body ? JSON.parse(opts.body) : undefined
    calls.push({ method, host: u.hostname, path: u.pathname + u.search, body, auth: opts.headers && opts.headers.Authorization, redirect: opts.redirect })
    if (u.hostname !== 'api.github.com') return reply(404, { message: 'wrong host' })
    const p = u.pathname; let m
    if (fail[method + ' ' + p.replace(R, '').replace(/[0-9a-f]{40}/g, '<sha>')]) return reply(...fail[method + ' ' + p.replace(R, '').replace(/[0-9a-f]{40}/g, '<sha>')])
    if (method === 'GET' && (m = new RegExp('^' + R + '/git/ref/(.+)$').exec(p))) { const r = refs.get('refs/' + m[1]); return r ? reply(200, { ref: 'refs/' + m[1], object: { sha: r, type: 'commit' } }) : reply(404, { message: 'Not Found' }) }
    if (method === 'GET' && (m = new RegExp('^' + R + '/compare/([0-9a-f]{40})\\.\\.\\.([0-9a-f]{40})$').exec(p))) return reply(200, { ahead_by: 2, files: upstream.map(filename => ({ filename })) })
    if (method === 'GET' && p === R + '/git/commits/' + PIN) return reply(200, { sha: PIN, tree: { sha: TREE0 } })
    if (method === 'GET' && p === R + '/git/trees/' + TREE0) return reply(200, { sha: TREE0, truncated, tree: [...at].map(([path, e]) => ({ path, mode: e.mode, type: e.mode === '160000' ? 'commit' : 'blob', sha: e.sha })) })
    if (method === 'POST' && p === R + '/git/blobs') { assert.strictEqual(body.encoding, 'utf-8'); const s = blobSha(body.content); blobs.set(s, body.content); return reply(201, { sha: corruptBlob ? 'f'.repeat(40) : s }) }
    if (method === 'POST' && p === R + '/git/trees') {
      if (body.base_tree !== TREE0) return reply(422, { message: 'bad base_tree' })
      const t = new Map(at)
      for (const e of body.tree) { if (e.sha === null) { if (!t.has(e.path)) return reply(422, { message: 'nothing to delete: ' + e.path }); t.delete(e.path) } else { if (!blobs.has(e.sha)) return reply(422, { message: 'unknown blob' }); t.set(e.path, { mode: e.mode, sha: e.sha }) } }
      const s = sha1([...t].sort()); trees.set(s, t); return reply(201, { sha: s })
    }
    if (method === 'POST' && p === R + '/git/commits') { if (!trees.has(body.tree)) return reply(422, { message: 'unknown tree' }); const s = sha1(body); commits.set(s, body); return reply(201, { sha: s }) }
    if (method === 'POST' && p === R + '/git/refs') {
      if (body.ref === 'refs/heads/' + ref) gh.touchedBase = true
      if (refs.has(body.ref)) return reply(422, { message: 'Reference already exists' })
      if (!commits.has(body.sha)) return reply(422, { message: 'Object does not exist' })
      refs.set(body.ref, body.sha); return reply(201, { ref: body.ref, object: { sha: body.sha } })
    }
    if (method === 'POST' && p === R + '/pulls') {
      if (!refs.has('refs/heads/' + body.head) || !refs.has('refs/heads/' + body.base)) return reply(422, { message: 'head or base missing' })
      prs.push(body); return reply(201, { number: 7, html_url: `https://github.com/${owner}/${repo}/pull/7` })
    }
    gh.touchedBase = gh.touchedBase || method !== 'GET' && method !== 'POST'
    return reply(404, { message: 'no such endpoint ' + method + ' ' + p })
  }
  return gh
}

// ---- a room: real Y.Doc for settings, chat and provenance; files in a Map ----
function fakeRoom ({ name = 'demo', files = {}, github, base, answer = true } = {}) {
  const doc = new Y.Doc(); const settings = doc.getMap('settings'); const chat = doc.getArray('chat'); const provenance = doc.getArray('provenance')
  const fsm = new Map(Object.entries(files)); const said = []; const cards = []
  if (github) settings.set('github', github); if (base) settings.set('githubBase', base)
  const room = { roomName: name, settings, chat, provenance, doc, said, cards, files: fsm, list: () => [...fsm.keys()].sort(), read: p => (fsm.has(p) ? fsm.get(p) : null), say: t => { said.push(t) },
    requestApproval: async c => { cards.push(c); return { approved: typeof answer === 'function' ? answer(c, room) : answer, by: 'alice' } } }
  return room
}
const say = (room, author, text, ts = T0 + 60000) => { const m = new Y.Map(); const tx = new Y.Text(); room.doc.transact(() => { m.set('id', author + ts + Math.random()); m.set('ts', ts); m.set('author', author); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); room.chat.push([m]); tx.insert(0, text) }) }
const prov = (room, file, by, model, ts = T0 + 120000) => { const m = new Y.Map(); room.doc.transact(() => { m.set('ts', ts); m.set('file', file); m.set('by', by); m.set('model', model); room.provenance.push([m]) }) }

const REPO_FILES = { 'app.py': { text: 'print("v1")\n' }, 'bin/run.sh': { text: '#!/bin/sh\necho hi\n', mode: '100755' }, 'README.md': { text: '# shop\n' }, 'lib/util.py': { text: 'X = 1\n' }, 'old.txt': { text: 'old\n' }, LICENSE: { text: 'MIT\n' }, link: { text: 'app.py', mode: '120000' } }
const imported = Object.fromEntries(Object.entries(REPO_FILES).filter(([p]) => p !== 'link' && p !== 'LICENSE')) // what the import wrote (it skips links and left a pre-existing LICENSE alone)
const baseOf = files => Object.fromEntries(Object.entries(files).map(([p, f]) => [p, blobSha(f.text)]))
const GITHUB = { owner: 'acme', repo: 'shop', ref: 'main', sha: PIN, license: 'MIT', private: false, folder: '', files: 5, importedAt: T0, by: 'alice' }
const workspace = (over = {}) => ({ ...Object.fromEntries(Object.entries(imported).map(([p, f]) => [p, f.text])), ...over })
const mkRoom = (over = {}, opts = {}) => { const room = fakeRoom({ files: workspace(over), github: GITHUB, base: baseOf(imported), ...opts }); return room }
const keys = gh => gh.calls.map(c => c.method + ' ' + c.path.replace(/[0-9a-f]{40}/g, '<sha>').replace('/repos/acme/shop', ''))
const everything = (room, gh) => JSON.stringify({ said: room.said, cards: room.cards, settings: room.settings.toJSON(), bodies: gh.calls.map(c => [c.path, c.body]) })

// ---- planning ----
{
  const room = mkRoom({ 'app.py': 'print("v2")\n', 'bin/run.sh': '#!/bin/sh\necho changed\n', 'notes.md': 'new\n', 'my file.txt': 'x', '.vespr/skills/a/SKILL.md': 's', 'node_modules/x/i.js': 'y', 'huge.txt': 'z'.repeat(LIMITS.perFile + 1) })
  room.files.delete('lib/util.py')
  const plan = planPr({ room, github: GITHUB, base: baseOf(imported) })
  assert.deepStrictEqual(plan.changed.map(f => f.path), ['app.py', 'bin/run.sh']); assert.deepStrictEqual(plan.added.map(f => f.path), ['notes.md']); assert.deepStrictEqual(plan.deleted.map(f => f.path), ['lib/util.py'])
  assert.deepStrictEqual(plan.skipped, { internal: 1, ignored: 1, name: 1, big: 1, limit: 0 }, 'workspace files, dependency folders, odd names and big files are counted and never sent')
  assert.ok(plan.changed.every(f => f.sha === blobSha(f.text)), 'the plan carries the text and its git hash')
  // a folder import: repository paths carry the folder
  const sub = planPr({ room, github: { ...GITHUB, folder: 'packages/web/' }, base: baseOf(imported) }); assert.deepStrictEqual(sub.changed.map(f => f.repoPath), ['packages/web/app.py', 'packages/web/bin/run.sh'])
  // the file-count limit
  const many = fakeRoom({ files: Object.fromEntries(Array.from({ length: LIMITS.files + 5 }, (_, i) => ['f' + String(i).padStart(3, '0') + '.txt', 'n' + i])), github: GITHUB, base: {} })
  const mp = planPr({ room: many, github: GITHUB, base: {} }); assert.strictEqual(mp.added.length, LIMITS.files); assert.strictEqual(mp.skipped.limit, 5)
  // nothing differs: an unchanged workspace plans nothing
  const same = planPr({ room: mkRoom(), github: GITHUB, base: baseOf(imported) }); assert.deepStrictEqual([same.changed, same.added, same.deleted], [[], [], []])
}

// ---- the happy path: order, payloads, deletions, modes, no call before approval, a new branch only ----
{
  const gh = makeGithub({ files: REPO_FILES }); const api = githubApi({ token: TOKEN, fetchImpl: gh.fetch })
  let callsAtCard = -1
  const room = mkRoom({ 'app.py': 'print("v2")\n', 'bin/run.sh': '#!/bin/sh\necho changed\n', 'notes.md': 'new\n', 'my file.txt': 'x', '.vespr/skills/a/SKILL.md': 's', 'node_modules/x/i.js': 'y' }, { answer: () => { callsAtCard = gh.calls.length; return true } })
  room.files.delete('lib/util.py')
  say(room, 'alice', '@coder please add a docstring to app.py'); say(room, 'bob', 'and remove lib/util.py, nothing uses it'); say(room, 'alice', 'my key is ' + CHAT_SECRET)
  prov(room, 'app.py', 'coder', 'nemotron-x'); prov(room, 'notes.md', 'coder', 'nemotron-x'); prov(room, 'unrelated.txt', 'reviewer', 'm2')
  const r = await openPr({ room, api, now: () => NOW })
  assert.strictEqual(callsAtCard, 0, 'NO network call (not even a read) before the card is answered')
  assert.strictEqual(room.cards.length, 1, 'ONE approval card'); const card = room.cards[0]
  assert.strictEqual(card.kind, 'pr'); assert.match(card.summary, /^Open a pull request on acme\/shop\? 2 changed, 1 added, 1 deleted on a new branch, into main$/)
  assert.match(card.detail, /New branch: vespr\/demo-2026-10-29 /); assert.match(card.detail, /pull request into main/); assert.match(card.detail, /opened at commit aaaaaaa/)
  assert.match(card.detail, /Changed \(2\): app\.py, bin\/run\.sh/); assert.match(card.detail, /Added \(1\): notes\.md/); assert.match(card.detail, /Deleted \(1\): lib\/util\.py/)
  assert.match(card.detail, /Not sent: 1 workspace file under \.vespr\/, 1 in dependency or build folders, 1 with names GitHub paths cannot hold/)
  assert.match(card.detail, /Title: please add a docstring to app\.py/); assert.match(card.detail, /Description:\n/); assert.match(card.detail, /never pushes to main, never force-pushes and does not merge/)
  assert.ok(!card.detail.includes('CHATSECRET') && !gh.calls.some(x => JSON.stringify(x.body || '').includes('CHATSECRET')), 'a token-like string from the chat is cut out of the draft, the card and everything sent')
  assert.strictEqual(r.status, 'done'); assert.strictEqual(r.url, 'https://github.com/acme/shop/pull/7'); assert.strictEqual(r.number, 7); assert.deepStrictEqual(r.counts, { changed: 2, added: 1, deleted: 1 })
  assert.deepStrictEqual(keys(gh), [
    'GET /git/ref/heads/main', 'GET /git/commits/<sha>', 'GET /git/trees/<sha>?recursive=1',
    'POST /git/blobs', 'POST /git/blobs', 'POST /git/blobs', 'POST /git/trees', 'POST /git/commits', 'POST /git/refs', 'POST /pulls'
  ], 'the exact call order: read, three blobs, tree, commit, branch, pull request')
  const [, , , b1, b2, b3, t, c, rf, pr] = gh.calls
  assert.deepStrictEqual([b1.body, b2.body, b3.body], [{ content: 'print("v2")\n', encoding: 'utf-8' }, { content: '#!/bin/sh\necho changed\n', encoding: 'utf-8' }, { content: 'new\n', encoding: 'utf-8' }])
  assert.deepStrictEqual(t.body, { base_tree: TREE0, tree: [
    { path: 'app.py', mode: '100644', type: 'blob', sha: blobSha('print("v2")\n') },
    { path: 'bin/run.sh', mode: '100755', type: 'blob', sha: blobSha('#!/bin/sh\necho changed\n') }, // the executable bit survives
    { path: 'notes.md', mode: '100644', type: 'blob', sha: blobSha('new\n') },
    { path: 'lib/util.py', mode: '100644', type: 'blob', sha: null } // a deletion
  ] })
  assert.deepStrictEqual(c.body.parents, [PIN], 'the commit sits on the commit the workspace was opened at'); assert.match(c.body.message, /^please add a docstring to app\.py\n\nFrom the VESPR workspace demo: 2 changed, 1 added, 1 deleted\.$/)
  assert.strictEqual(rf.body.ref, 'refs/heads/vespr/demo-2026-10-29'); assert.strictEqual(rf.body.sha, [...gh.commits.keys()][0])
  assert.strictEqual(pr.body.head, 'vespr/demo-2026-10-29'); assert.strictEqual(pr.body.base, 'main'); assert.strictEqual(pr.body.title, 'please add a docstring to app.py')
  assert.match(pr.body.body, /starting from acme\/shop at main \(aaaaaaa\)/); assert.match(pr.body.body, /2 changed, 1 added, 1 deleted/); assert.match(pr.body.body, /- bob: and remove lib\/util\.py/)
  assert.match(pr.body.body, /- alice \(person\): took part in the chat/); assert.match(pr.body.body, /- coder \(agent, nemotron-x\): edited app\.py, notes\.md/); assert.ok(!/reviewer/.test(pr.body.body), 'an agent that edited only unrelated files is not listed')
  // what git now has: the new branch holds the change, the base branch is untouched
  const newTree = gh.trees.get(gh.commits.get(rf.body.sha).tree); assert.deepStrictEqual([...newTree.keys()].sort(), ['LICENSE', 'README.md', 'app.py', 'bin/run.sh', 'link', 'notes.md', 'old.txt'], 'lib/util.py is gone, notes.md is new, the rest stays')
  assert.strictEqual(newTree.get('bin/run.sh').mode, '100755'); assert.strictEqual(gh.refs.get('refs/heads/main'), PIN, 'main did not move'); assert.strictEqual(gh.touchedBase, false)
  assert.ok(gh.calls.every(x => x.method === 'GET' || x.method === 'POST'), 'only reads and creates: no PATCH, PUT or DELETE, so no force-push and no ref update')
  assert.ok(gh.calls.filter(x => x.path.endsWith('/git/refs')).length === 1 && gh.calls.every(x => !(x.method === 'POST' && /heads\/main/.test(JSON.stringify(x.body)))), 'the only branch written is the new one')
  // the token: one header, one host, never anywhere else
  assert.ok(gh.calls.every(x => x.host === 'api.github.com' && x.auth === 'Bearer ' + TOKEN && x.redirect === 'error'), 'api.github.com only, no redirects')
  assert.ok(!everything(room, gh).includes(TOKEN), 'the token appears in no message, card, setting or request body')
  assert.match(describePr(r), /^Opened pull request #7: https:\/\/github\.com\/acme\/shop\/pull\/7 \(branch vespr\/demo-2026-10-29 into main; 2 changed, 1 added, 1 deleted\)\. Nothing was merged or pushed to main\.$/)
}

// ---- a stale base: reported, the pull request is where the conflicts show; nothing is overwritten ----
{
  const gh = makeGithub({ files: REPO_FILES, moved: true, upstream: ['app.py', 'other.py'] }); const room = mkRoom({ 'app.py': 'print("v2")\n', 'notes.md': 'new\n' })
  const r = await openPr({ room, api: githubApi({ token: TOKEN, fetchImpl: gh.fetch }), now: () => NOW })
  assert.strictEqual(r.status, 'done'); assert.deepStrictEqual(r.stale, { tip: TIP, overlap: ['app.py'], ahead: 2 })
  assert.ok(keys(gh).includes('GET /compare/<sha>...<sha>'), 'it asks what moved'); assert.strictEqual(gh.commits.get([...gh.commits.keys()][0]).parents[0], PIN, 'still on the commit the workspace was opened at; nothing rebased')
  assert.match(gh.prs[0].body, /> Note: main moved after this workspace was opened \(aaaaaaa to ccccccc, 2 commits\)\. Files changed on both sides: app\.py\. GitHub shows any conflicts below\./)
  assert.strictEqual(gh.refs.get('refs/heads/main'), TIP, 'main is exactly where it was'); assert.ok(gh.calls.every(x => x.method !== 'PATCH' && x.method !== 'DELETE'))
  assert.match(describePr(r), /main moved after the workspace was opened; changed on both sides: app\.py\. The pull request shows any conflicts\./)
  assert.match(room.cards[0].detail, /If main has moved since the workspace was opened, a note about it is added to the description/)
}

// ---- the branch name is taken: the next free one, never an overwrite ----
{
  const gh = makeGithub({ files: REPO_FILES, taken: ['vespr/demo-2026-10-29', 'vespr/demo-2026-10-29-2'] }); const room = mkRoom({ 'notes.md': 'new\n' })
  const r = await openPr({ room, api: githubApi({ token: TOKEN, fetchImpl: gh.fetch }), now: () => NOW })
  assert.strictEqual(r.status, 'done'); assert.strictEqual(r.branch, 'vespr/demo-2026-10-29-3'); assert.strictEqual(gh.prs[0].head, 'vespr/demo-2026-10-29-3')
  assert.deepStrictEqual(gh.calls.filter(x => x.path.endsWith('/git/refs')).map(x => x.body.ref), ['refs/heads/vespr/demo-2026-10-29', 'refs/heads/vespr/demo-2026-10-29-2', 'refs/heads/vespr/demo-2026-10-29-3'])
  assert.strictEqual(gh.refs.get('refs/heads/vespr/demo-2026-10-29'), PIN, 'the existing branch was not touched')
}

// ---- only deletions; a file the repository already has but the import did not write; a snapshot; a folder import ----
{
  const gh = makeGithub({ files: REPO_FILES }); const room = mkRoom({ LICENSE: 'my own license text\n', link: 'a file where the repository has a link\n' }); room.files.delete('old.txt')
  const r = await openPr({ room, api: githubApi({ token: TOKEN, fetchImpl: gh.fetch }), now: () => NOW })
  assert.strictEqual(r.status, 'done'); assert.deepStrictEqual(r.counts, { changed: 0, added: 0, deleted: 1 }); assert.strictEqual(gh.calls.filter(x => x.path.endsWith('/git/blobs')).length, 0, 'no blob for a deletion')
  assert.deepStrictEqual(r.left.map(l => l.split(' ')[0]).sort(), ['LICENSE', 'link']); assert.match(describePr(r), /Left out: .*LICENSE \(the repository already has a file there that was not imported\)/)
  assert.deepStrictEqual(gh.calls.find(x => x.path.endsWith('/git/trees') && x.method === 'POST').body.tree, [{ path: 'old.txt', mode: '100644', type: 'blob', sha: null }])
}
{
  const gh = makeGithub({ files: REPO_FILES }); const room = mkRoom({ 'app.py': 'print("v2")\n' }, { answer: (c, rm) => { rm.files.set('app.py', 'print("edited while the card was open")\n'); rm.files.set('late.txt', 'late'); return true } })
  await openPr({ room, api: githubApi({ token: TOKEN, fetchImpl: gh.fetch }), now: () => NOW })
  const sent = gh.calls.filter(x => x.path.endsWith('/git/blobs')).map(x => x.body.content); assert.deepStrictEqual(sent, ['print("v2")\n'], 'exactly what the card listed is sent: the edit made while it was open is not')
}
{
  const gh = makeGithub({ files: Object.fromEntries(Object.entries(REPO_FILES).map(([p, f]) => ['packages/web/' + p, f])) }); const github = { ...GITHUB, folder: 'packages/web' }
  const room = fakeRoom({ files: workspace({ 'app.py': 'print("v2")\n' }), github, base: baseOf(imported) })
  const r = await openPr({ room, api: githubApi({ token: TOKEN, fetchImpl: gh.fetch }), now: () => NOW })
  assert.strictEqual(r.status, 'done'); assert.deepStrictEqual(gh.calls.find(x => x.path.endsWith('/git/trees') && x.method === 'POST').body.tree.map(e => e.path), ['packages/web/app.py']); assert.match(room.cards[0].detail, /Changed \(1\): packages\/web\/app\.py/)
}

// ---- no approval, no token, no repository, nothing to send: no network at all ----
{
  const gh = makeGithub({ files: REPO_FILES }); const api = githubApi({ token: TOKEN, fetchImpl: gh.fetch })
  const denied = mkRoom({ 'notes.md': 'x' }, { answer: false }); const r = await openPr({ room: denied, api, now: () => NOW })
  assert.strictEqual(r.status, 'denied'); assert.strictEqual(gh.calls.length, 0, 'a declined card means not one call'); assert.match(describePr(r), /Nothing was sent to GitHub/)
  const nothing = mkRoom(); const r2 = await openPr({ room: nothing, api, now: () => NOW }); assert.strictEqual(r2.status, 'nothing'); assert.strictEqual(nothing.cards.length, 0); assert.match(describePr(r2), /nothing to send/); assert.strictEqual(gh.calls.length, 0)
  const noTok = mkRoom({ 'notes.md': 'x' }); const r3 = await openPr({ room: noTok, api: null, now: () => NOW }); assert.strictEqual(r3.status, 'no-token'); assert.strictEqual(noTok.cards.length, 0, 'no card when nothing can be sent'); assert.match(describePr(r3), /GITHUB_TOKEN/)
  const noRepo = fakeRoom({ files: { 'a.txt': 'x' } }); const r4 = await openPr({ room: noRepo, api, now: () => NOW }); assert.strictEqual(r4.status, 'no-repo'); assert.match(describePr(r4), /Open a GitHub repository/); assert.strictEqual(gh.calls.length, 0)
  await assert.rejects(githubApi({ token: '' })('GET', '/repos/a/b/x'), /no GitHub token/)
}

// ---- failures: each says what happened and what GitHub now holds ----
{
  const run = async (opts, over = { 'app.py': 'print("v2")\n' }) => { const gh = makeGithub({ files: REPO_FILES, ...opts }); const room = mkRoom(over); const r = await openPr({ room, api: githubApi({ token: TOKEN, fetchImpl: gh.fetch }), now: () => NOW }); return { gh, room, r } }
  let x = await run({ truncated: true })
  assert.strictEqual(x.r.status, 'error'); assert.match(x.r.error, /too large to read in one piece/); assert.strictEqual(x.gh.calls.filter(c => c.method === 'POST').length, 0, 'nothing created'); assert.match(describePr(x.r), /Nothing was changed on GitHub\.$/)
  x = await run({ fail: { 'GET /git/ref/heads/main': [404, { message: 'Not Found' }] } })
  assert.match(x.r.error, /main is not a branch of acme\/shop/); assert.strictEqual(x.gh.calls.length, 1)
  x = await run({ fail: { 'POST /git/refs': [403, { message: 'Resource not accessible by personal access token' }] } })
  assert.strictEqual(x.r.status, 'error'); assert.match(x.r.error, /Contents and Pull requests write access/); assert.ok(!x.gh.calls.some(c => c.path.endsWith('/pulls')), 'no pull request after a failed branch'); assert.strictEqual(x.r.branchCreated, undefined)
  x = await run({ fail: { 'POST /pulls': [422, { message: 'A pull request already exists' }] } })
  assert.strictEqual(x.r.status, 'error'); assert.match(x.r.error, /GitHub refused: A pull request already exists/); assert.strictEqual(x.r.branchCreated, true); assert.match(describePr(x.r), /The branch vespr\/demo-2026-10-29 was created on GitHub; the pull request was not\./)
  assert.ok(x.gh.calls.every(c => c.method === 'GET' || c.method === 'POST'), 'no clean-up that could delete or overwrite anything')
  x = await run({ fail: { 'POST /git/blobs': [401, { message: 'Bad credentials' }] } })
  assert.match(x.r.error, /did not accept the token/); assert.ok(!x.gh.calls.some(c => c.path.endsWith('/git/refs')))
  assert.ok(!JSON.stringify([x.r, x.room.said]).includes(TOKEN))
  x = await run({ corruptBlob: true })
  assert.match(x.r.error, /GitHub stored app\.py differently from what was sent/); assert.ok(!x.gh.calls.some(c => c.path.endsWith('/git/refs') || c.path.endsWith('/pulls')), 'content that does not match is never published')
  x = await run({}, { 'app.py': 'print("v2")\n' }); assert.strictEqual(x.r.status, 'done')
}

// ---- githubApi: host, path, token, errors ----
{
  const seen = []; const fetchImpl = async (url, o) => { seen.push({ url, o }); return { ok: false, status: 422, json: async () => ({ message: 'echo ' + TOKEN + ' back' }) } }
  const api = githubApi({ token: TOKEN, fetchImpl })
  await assert.rejects(api('POST', '/repos/a/b/git/blobs', { content: 'x' }), e => e.status === 422 && !e.message.includes(TOKEN) && /\[token\]/.test(e.message), 'GitHub echoing the token does not put it in an error')
  assert.strictEqual(seen[0].url, 'https://api.github.com/repos/a/b/git/blobs'); assert.strictEqual(seen[0].o.headers.Authorization, 'Bearer ' + TOKEN); assert.strictEqual(seen[0].o.redirect, 'error')
  seen.length = 0; await assert.rejects(api('GET', '/repos/a/b/git/ref/heads/' + 'feature/a+b#1'.split('/').map(encodeURIComponent).join('/')), e => e.status === 422); assert.strictEqual(seen[0].url, 'https://api.github.com/repos/a/b/git/ref/heads/feature/a%2Bb%231', 'a branch name with odd characters is sent percent-encoded'); seen.length = 0
  for (const bad of ['/user', '/repos/a/b/../../../user', '/repos/a/b/%2e%2e/%2e%2e/user'.replace('%2e%2e', '..'), '//evil.example/x', '/repos/a', 'https://evil.example/repos/a/b/x', '/repos/a/b/x y']) await assert.rejects(api('GET', bad), /refused a path/, 'refuses ' + bad)
  assert.strictEqual(seen.length, 0, 'refused paths never reach the network')
  const boom = githubApi({ token: TOKEN, fetchImpl: async () => { throw new Error('connect failed to host with ' + TOKEN) } }); await assert.rejects(boom('GET', '/repos/a/b/x'), e => !e.message.includes(TOKEN) && /could not reach GitHub/.test(e.message))
}

// ---- the draft ----
{
  const room = mkRoom({ 'notes.md': 'x' }); say(room, 'alice', '@coder ' + 'a very long request '.repeat(20)); say(room, 'alice', 'old request before the import', T0 - 5000)
  const plan = planPr({ room, github: GITHUB, base: baseOf(imported) })
  const d = draftPr({ room, github: GITHUB, plan, title: '  My own title  ', body: 'Extra words with sk-' + 'q'.repeat(20) })
  assert.strictEqual(d.title, 'My own title'); assert.ok(!/old request before/.test(d.body)); assert.match(d.body, /Extra words with \[redacted\]/); assert.ok(d.body.length <= LIMITS.body)
  const d2 = draftPr({ room, github: GITHUB, plan }); assert.ok(d2.title.length <= 70 && d2.title.startsWith('a very long request')); assert.ok(!/@coder/.test(d2.title))
  const empty = mkRoom({ 'notes.md': 'x' }); assert.strictEqual(draftPr({ room: empty, github: GITHUB, plan }).title, 'Changes from the VESPR workspace demo')
  assert.strictEqual(redact('see ' + 'k'.repeat(40) + ' ok'), 'see [redacted] ok'); assert.strictEqual(redact('short words stay'), 'short words stay')
  assert.strictEqual(branchName({ roomName: 'My Team!! Room' }, NOW), 'vespr/my-team-room-2026-10-29'); assert.strictEqual(branchName({ roomName: '' }, NOW), 'vespr/workspace-2026-10-29')
}

// ---- the app and the agent over a real server: openPullRequest -> one card -> done; restart; no token ----
const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-pr-')); fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort(); const here = path.dirname(new URL(import.meta.url).pathname)
const srv = spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' })
let alice, agent, h, agent2, h2
try {
  await wait(800)
  const server = 'ws://127.0.0.1:' + PORT; const deps = { Y, WebsocketProvider, WebSocketPolyfill: WebSocket }
  alice = createClient({ server, room: 'shop', token: 'tok-a', name: 'alice', deps }); await alice.ready
  agent = joinRoom({ server, room: 'shop', token: 'tok-c', name: 'coder', color: '#5eead4', model: 'fake-model' }); await agent.ready
  for (const [p, f] of Object.entries(imported)) agent.write(p, f.text, 'seed')
  agent.settings.set('github', GITHUB); agent.settings.set('githubBase', baseOf(imported))
  const gh = makeGithub({ files: REPO_FILES })
  h = startGithubPr({ room: agent, api: githubApi({ token: TOKEN, fetchImpl: gh.fetch }), now: () => NOW })
  await until(() => alice.get().prEnabled, 'the app learns pull requests are on'); assert.strictEqual(alice.get().pr, null)
  agent.write('app.py', 'print("v2")\n', 'edit1'); agent.write('notes.md', 'new\n', 'edit2')
  const id = alice.openPullRequest({ title: '  Docstrings and notes ', body: 'Please review.' })
  const card = await until(() => alice.get().approvals.pending.find(m => m.kind === 'pr'), 'one approval card'); assert.match(card.text, /Open a pull request on acme\/shop\? 1 changed, 1 added/); assert.match(card.detail, /Title: Docstrings and notes/)
  assert.strictEqual((await until(() => alice.get().pr, 'status')).id, id); await until(() => alice.get().pr.status === 'asking', 'asking'); assert.strictEqual(gh.calls.length, 0, 'nothing sent while the card is open')
  assert.strictEqual(alice.decide(card.id, true), true)
  const done = await until(() => alice.get().pr.status === 'done' && alice.get().pr, 'done'); assert.strictEqual(done.url, 'https://github.com/acme/shop/pull/7'); assert.strictEqual(done.branch, 'vespr/shop-2026-10-29'); assert.deepStrictEqual(done.counts, { changed: 1, added: 1, deleted: 0 })
  assert.strictEqual(gh.prs[0].title, 'Docstrings and notes'); assert.match(gh.prs[0].body, /Please review\./)
  await until(() => alice.get().messages.some(m => m.isAgent && /Opened pull request #7/.test(m.text)), 'the agent says it in chat')
  assert.ok(!JSON.stringify([alice.get().messages.map(m => m.text), alice.get().pr]).includes(TOKEN))
  // a restart does not send again
  const before = gh.calls.length; h.stop(); h2 = startGithubPr({ room: agent, api: githubApi({ token: TOKEN, fetchImpl: gh.fetch }), now: () => NOW }); await wait(300); assert.strictEqual(gh.calls.length, before); assert.strictEqual(alice.get().approvals.pending.length, 0)
  // a declined card sends nothing
  const n0 = gh.calls.length; agent.write('more.md', 'more\n', 'edit3'); alice.openPullRequest()
  const card2 = await until(() => alice.get().approvals.pending.find(m => m.kind === 'pr'), 'second card'); alice.decide(card2.id, false)
  await until(() => alice.get().pr.status === 'denied', 'denied'); assert.strictEqual(gh.calls.length, n0, 'declined: no call'); await until(() => alice.get().messages.some(m => /No pull request was opened/.test(m.text)), 'says so')
  h2.stop()
  // an agent without a token: the app is told, and a request is answered without a card or a call
  agent.destroy(); agent2 = joinRoom({ server, room: 'shop', token: 'tok-c', name: 'coder', color: '#5eead4', model: 'fake-model' }); await agent2.ready
  h2 = startGithubPr({ room: agent2, api: null }); await until(() => alice.get().prEnabled === false, 'pull requests are off')
  alice.openPullRequest(); await until(() => alice.get().pr.status === 'no-token', 'no-token'); assert.strictEqual(alice.get().approvals.pending.length, 0); await until(() => alice.get().messages.some(m => /GITHUB_TOKEN/.test(m.text)), 'explains')
  console.log('githubpr tests passed: plan, call order and payloads, deletions, file modes, one card, snapshot sent, stale base, taken branch, denied/no token/nothing, collisions, failures, token never leaked, app protocol')
} finally {
  try { h && h.stop() } catch {}; try { h2 && h2.stop() } catch {}; try { alice && alice.destroy && alice.destroy() } catch {}; try { agent && agent.destroy() } catch {}; try { agent2 && agent2.destroy() } catch {}
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); setTimeout(() => process.exit(0), 200)
}
