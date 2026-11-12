import { fileStore } from '../app/file-store.js'
// Git hosting for a workspace: the shared files can be committed, cloned, fetched and pushed with ordinary git.
//   POST /api/git/<room>/commit  { message? }    snapshot the workspace into git (message defaults to an intent log)
//   GET  /api/git/<room>/log                     recent commits
//   GET  /api/git/<room>/blame?file=             who wrote each line (from the authorship attributes, not from git)
//   /git/<room>[.git]/...                        git smart HTTP (clone, fetch, push); log in with any user name and your token as the password
// A push is imported back into the live workspace as edits by the pusher. A clone or fetch first snapshots the live state.
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const Y = require('yjs')

const run = (args, opts = {}) => new Promise((resolve, reject) => execFile('git', args, { maxBuffer: 20 * 1024 * 1024, ...opts }, (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr })) : resolve(stdout)))
const minute = () => Math.floor(Date.now() / 60000)
const isBinary = buf => buf.includes(0)
const MAX_FILE = 200 * 1024
const MAX_FILES = 2000
const MAX_PUSH_BYTES = 50 * 1024 * 1024
// a path that is safe to bring into the workspace: relative, no '..', no .git / .vscode folders (those can run code in other people's editors)
const safePath = n => n && !n.startsWith('/') && !n.includes('\\') && !n.includes('\0') && !n.split('/').some(seg => seg === '..' || seg === '.git' || seg === '.vscode' || seg === '')

export function createGit ({ DATA, getYDoc, identify }) {
  const dirs = room => { const base = path.join(DATA, room, 'git'); return { base, bare: path.join(base, 'repo.git'), work: path.join(base, 'work') } }

  async function ensure (room) {
    const { base, bare, work } = dirs(room)
    if (!fs.existsSync(bare)) {
      fs.mkdirSync(base, { recursive: true })
      await run(['init', '--bare', '-b', 'main', bare])
      await run(['--git-dir', bare, 'config', 'http.receivepack', 'true'])
      await run(['init', '-b', 'main', work]); await run(['-C', work, 'remote', 'add', 'origin', bare])
    }
    return { bare, work }
  }

  // Describe what changed since the last commit: who touched what, and the request behind it (the "intent log").
  function intentMessage (room, sinceMs) {
    const doc = getYDoc(room); const lines = []; const by = new Map()
    for (const m of doc.getArray('provenance').toArray()) {
      if (m.get('ts') < sinceMs) continue
      const why = m.get('msgId') && doc.getArray('chat').toArray().find(c => c.get('id') === m.get('msgId'))
      const ask = why ? ` (asked by ${why.get('author')}: ${why.get('text').toString().replace(/\s+/g, ' ').slice(0, 80)})` : ''
      lines.push(`- ${m.get('by')}${m.get('model') ? ' [' + m.get('model') + ']' : ''} ${m.get('summary')}${ask}`)
    }
    for (const [file, text] of fileStore(doc)) for (const op of text.toDelta()) {
      const a = op.attributes; if (!a || !a.by || a.by === 'import' || a.ai || (a.t || 0) * 60000 < sinceMs - 60000) continue
      by.set(`${a.by} changed ${file}`, true)
    }
    const people = [...new Set([...by.keys()].map(k => k.split(' ')[0]).concat(lines.map(l => l.slice(2).split(' ')[0])))]
    const head = people.length ? `VESPR snapshot: edits by ${people.join(', ')}` : 'VESPR snapshot'
    return [head, '', ...lines, ...by.keys()].join('\n').trim()
  }

  // one git operation per room at a time (two requests must not fight over the index)
  const locks = new Map()
  const exclusive = (room, fn) => { const next = (locks.get(room) || Promise.resolve()).catch(() => null).then(fn); locks.set(room, next); return next }

  // Snapshot the workspace into git. Returns { sha, message, changed } or { sha, unchanged: true }.
  function commit (room, who, message) { return exclusive(room, () => commitNow(room, who, message)) }
  async function commitNow (room, who, message) {
    const { work } = await ensure(room)
    // start from whatever the hosted repo has now (someone may have pushed since the last snapshot)
    if ((await run(['-C', work, 'ls-remote', '--heads', 'origin', 'main'])).trim()) { await run(['-C', work, 'fetch', '-q', 'origin', 'main']); await run(['-C', work, 'reset', '-q', '--hard', 'origin/main']) }
    const doc = getYDoc(room); const files = fileStore(doc); const want = new Set()
    for (const [rel, text] of files) {
      const dest = path.resolve(work, rel); if (!dest.startsWith(work + path.sep) || rel.split('/').includes('.git')) continue
      want.add(rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, text.toString())
    }
    const walk = (d, rel = '') => { for (const n of fs.readdirSync(d)) { if (n === '.git') continue; const full = path.join(d, n); const r = rel ? `${rel}/${n}` : n; if (fs.statSync(full).isDirectory()) walk(full, r); else if (!want.has(r)) fs.rmSync(full) } }
    walk(work)
    await run(['-C', work, 'add', '-A'])
    const status = (await run(['-C', work, 'status', '--porcelain'])).trim()
    if (!status) return { sha: (await run(['-C', work, 'rev-parse', 'HEAD']).catch(() => '')).trim(), unchanged: true }
    const last = await run(['-C', work, 'log', '-1', '--format=%ct']).then(s => Number(s) * 1000).catch(() => 0)
    const msg = (message || '').trim() || intentMessage(room, last)
    const name = who || 'VESPR'
    await run(['-C', work, '-c', `user.name=${name}`, '-c', `user.email=${name}@murmio.local`, 'commit', '-q', '-m', msg])
    await run(['-C', work, 'push', '-q', 'origin', 'HEAD:main'])
    return { sha: (await run(['-C', work, 'rev-parse', 'HEAD'])).trim(), message: msg, changed: status.split('\n').length }
  }

  // After someone pushes: bring the new tree into the live workspace as edits by the pusher.
  function importPush (room, pusher) { return exclusive(room, () => importNow(room, pusher)) }
  async function importNow (room, pusher) {
    const { bare } = dirs(room)
    const names = (await run(['--git-dir', bare, 'ls-tree', '-r', '--name-only', '-z', 'main'])).split('\0').filter(safePath).slice(0, MAX_FILES)
    const doc = getYDoc(room); const files = fileStore(doc); const attrs = { by: pusher, via: 'git push', t: minute() }
    const blobs = new Map()
    for (const n of names) {
      const buf = await new Promise((res, rej) => execFile('git', ['--git-dir', bare, 'show', `main:${n}`], { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 }, (e, o) => e ? rej(e) : res(o)))
      if (!isBinary(buf) && buf.length <= MAX_FILE) blobs.set(n, buf.toString('utf8'))
    }
    let changed = 0
    doc.transact(() => {
      for (const [n, text] of blobs) {
        const t = files.get(n)
        if (!t) { const nt = new Y.Text(); nt.insert(0, text, attrs); files.set(n, nt); changed++; continue }
        const old = t.toString(); if (old === text) continue
        let a = 0; while (a < old.length && a < text.length && old[a] === text[a]) a++
        let b = 0; while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++
        if (old.length - a - b > 0) t.delete(a, old.length - a - b)
        if (text.length - a - b > 0) t.insert(a, text.slice(a, text.length - b), attrs)
        changed++
      }
      for (const key of [...files.keys()]) if (!names.includes(key) && !blobs.has(key) && safePath(key)) { files.delete(key); changed++ }
      const m = new Y.Map(); const tx = new Y.Text()
      m.set('id', `git-${Date.now().toString(36)}`); m.set('ts', Date.now()); m.set('author', pusher); m.set('isAgent', false); m.set('role', 'tool'); m.set('text', tx)
      doc.getArray('chat').push([m]); tx.insert(0, `pushed to git: ${changed} file${changed === 1 ? '' : 's'} updated in the workspace`)
    }, 'git')
    return changed
  }

  async function log (room) {
    const { bare } = await ensure(room)
    const out = await run(['--git-dir', bare, 'log', '-30', '--format=%H%x1f%an%x1f%ct%x1f%s']).catch(() => '')
    return out.split('\n').filter(Boolean).map(l => { const [sha, author, ts, subject] = l.split('\x1f'); return { sha, author, ts: Number(ts) * 1000, subject } })
  }

  function blame (room, file) {
    const t = fileStore(getYDoc(room)).get(file); if (!t) return null
    const lines = []; let line = 1; let cur = { by: '', ai: false, model: '' }
    const text = t.toString()
    const spans = []; let pos = 0
    for (const op of t.toDelta()) { if (typeof op.insert !== 'string') continue; spans.push({ start: pos, end: pos + op.insert.length, a: op.attributes || {} }); pos += op.insert.length }
    let offset = 0
    for (const l of text.split('\n')) {
      // the author of a line is whoever last changed any part of it (imported text counts only when nobody else touched it)
      const over = spans.filter(sp => sp.start < offset + Math.max(l.length, 1) && sp.end > offset)
      const touched = over.filter(sp => sp.a.by && sp.a.by !== 'import').sort((x, y) => (y.a.t || 0) - (x.a.t || 0))[0]
      const sp = touched || over[0] || spans[spans.length - 1]
      cur = sp ? { by: sp.a.by || '', ai: !!sp.a.ai, model: sp.a.model || '' } : cur
      lines.push({ n: line++, ...cur, text: l }); offset += l.length + 1
    }
    return lines
  }

  const bearerOrBasic = req => {
    const h = req.headers.authorization || ''
    if (/^Bearer /i.test(h)) return identify(h.replace(/^Bearer\s+/i, ''))
    const m = /^Basic\s+(.+)$/i.exec(h); if (!m) return null
    const [, , pass] = /^([^:]*):(.*)$/.exec(Buffer.from(m[1], 'base64').toString()) || []
    return identify(pass || '')
  }
  const roomOk = r => /^[a-z0-9][a-z0-9-]{0,39}$/.test(r)
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }

  return {
    commit, log, blame, importPush,
    // returns true if handled
    http (req, res) {
      const u = new URL(req.url, 'http://x')
      let m = /^\/api\/git\/([^/]+)\/(commit|log|blame)$/.exec(u.pathname)
      if (m) {
        const who = bearerOrBasic(req); if (!who) { res.writeHead(401); res.end(); return true }
        if (!roomOk(m[1])) { json(res, 400, { error: 'bad room' }); return true }
        ;(async () => {
          try {
            if (m[2] === 'log') return json(res, 200, await log(m[1]))
            if (m[2] === 'blame') { const b = blame(m[1], u.searchParams.get('file') || ''); return b ? json(res, 200, b) : json(res, 404, { error: 'no such file' }) }
            let body = ''; for await (const c of req) body += c
            const msg = body ? (JSON.parse(body).message || '') : ''
            json(res, 200, await commit(m[1], who, msg))
          } catch (e) { json(res, 500, { error: String(e.message).slice(0, 200) }) }
        })()
        return true
      }
      m = /^\/git\/([^/]+?)(?:\.git)?(\/.*)$/.exec(u.pathname)
      if (!m) return false
      const room = m[1]; const rest = m[2]
      const who = bearerOrBasic(req)
      if (!who) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="VESPR git: any user name, your token as the password"' }); res.end(); return true }
      if (!roomOk(room)) { res.writeHead(400); res.end(); return true }
      ;(async () => {
        try {
          const { base } = dirs(room); await ensure(room)
          if (rest === '/info/refs' || rest.endsWith('git-upload-pack')) await commit(room, 'VESPR', '').catch(() => null) // a clone or fetch sees the live state
          const isPush = rest.endsWith('git-receive-pack') || u.searchParams.get('service') === 'git-receive-pack'
          const cgi = spawn('git', ['http-backend'], { env: { PATH: process.env.PATH, GIT_PROJECT_ROOT: base, GIT_HTTP_EXPORT_ALL: '1', PATH_INFO: `/repo.git${rest}`, REQUEST_METHOD: req.method, QUERY_STRING: u.search.slice(1), CONTENT_TYPE: req.headers['content-type'] || '', CONTENT_LENGTH: req.headers['content-length'] || '', REMOTE_USER: who, REMOTE_ADDR: '127.0.0.1', HTTP_CONTENT_ENCODING: req.headers['content-encoding'] || '' } })
          let got = 0; req.on('data', c => { got += c.length; if (got > MAX_PUSH_BYTES) { req.destroy(); cgi.kill() } })
          req.pipe(cgi.stdin)
          let head = ''; let headDone = false; let status = 200; const headers = {}
          cgi.stdout.on('data', chunk => {
            if (headDone) return res.write(chunk)
            head += chunk.toString('binary')
            const i = head.indexOf('\r\n\r\n'); if (i < 0) return
            for (const line of head.slice(0, i).split('\r\n')) { const [k, ...v] = line.split(': '); if (k.toLowerCase() === 'status') status = parseInt(v.join(': '), 10) || 200; else headers[k] = v.join(': ') }
            res.writeHead(status, headers); headDone = true
            const rest2 = Buffer.from(head.slice(i + 4), 'binary'); if (rest2.length) res.write(rest2)
          })
          cgi.on('close', async () => { if (!headDone) { res.writeHead(502); } res.end(); if (isPush && req.method === 'POST') await importPush(room, who).catch(e => console.error('git import failed:', e.message)) })
        } catch (e) { if (!res.headersSent) res.writeHead(500); res.end() }
      })()
      return true
    }
  }
}
