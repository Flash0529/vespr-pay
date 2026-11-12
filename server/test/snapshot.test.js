// Snapshot links: a copy at share time, a long address, revocable, no secrets, no script on the page. Run: node server/test/snapshot.test.js
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'
import net from 'node:net'

const usedTestPorts = new Set()
function freePort () {
  return new Promise((resolve, reject) => {
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
}

import * as Y from 'yjs'
import { fileStore } from '../../app/file-store.js'
import { createSnapshot, looksSecret, esc } from '../snapshot.js'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-test-'))
const doc = new Y.Doc(); const files = fileStore(doc)
const put = (p, t) => { const x = new Y.Text(); files.set(p, x); x.insert(0, t) }
put('cart.py', 'def total(items):\n    return sum(i for i in items)  # <b>bold</b> & "q"\n'); put('docs/notes.md', '# notes\n'); put('.env', 'KEY=abc'); put('config/secrets.json', '{}'); put('.vespr/skills/x.md', 'x'); put('big.txt', 'x'.repeat(300 * 1024)); put('src/app.js', 'console.log(1)\n')
const TOK = { 'good-token': 'alex' }
const share = createSnapshot({ DATA, identify: t => TOK[t], roomOk: r => /^[a-z0-9-]{1,40}$/.test(r), getYDoc: r => r === 'demo' ? doc : null })
const srv = http.createServer((req, res) => { if (!share.http(req, res)) { res.writeHead(404); res.end('x') } }); const port = await freePort(); await new Promise(r => srv.listen(port, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + srv.address().port
const call = (m, p, body, tok = 'good-token') => fetch(base + p, { method: m, headers: { ...(tok ? { Authorization: 'Bearer ' + tok } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })

// a name that looks like a secret, and what is escaped
for (const p of ['.env', '.env.local', 'config/secrets.json', 'id_rsa', 'a/b/server.pem', 'api_key.txt', 'my-token.txt', '.vespr/skills/x.md', 'credentials.json']) assert.ok(looksSecret(p), p)
for (const p of ['cart.py', 'docs/notes.md', 'src/app.js', 'README.md', 'tokenizer.py'.replace('tokenizer', 'parse')]) assert.ok(!looksSecret(p), p)
assert.strictEqual(esc('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;')

// needs a person's token, a real room
assert.strictEqual((await call('POST', '/api/snapshot/demo', { file: 'cart.py' }, null)).status, 401)
assert.strictEqual((await call('POST', '/api/snapshot/demo', { file: 'cart.py' }, 'nope')).status, 401)
assert.strictEqual((await call('POST', '/api/snapshot/Bad_Room', { file: 'cart.py' })).status, 404)

// a file link
let r = await call('POST', '/api/snapshot/demo', { file: 'cart.py', days: 3 }); assert.strictEqual(r.status, 201)
const made = await r.json(); assert.match(made.path, /^\/snap\/[0-9a-f]{48}$/); assert.strictEqual(made.kind, 'file'); assert.ok(made.expires > Date.now() + 2 * 86400000 && made.expires < Date.now() + 4 * 86400000)
const token = made.path.slice(6)
const stored = fs.readdirSync(path.join(DATA, '_snapshots')).map(f => fs.readFileSync(path.join(DATA, '_snapshots', f), 'utf8')).join('')
assert.ok(!stored.includes(token.slice(16)), 'the secret half of the address is never stored'); assert.ok(stored.includes('"hash"'))
r = await fetch(base + made.path); assert.strictEqual(r.status, 200)
const html = await r.text(); assert.ok(html.includes('cart.py')); assert.ok(html.includes('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;q&quot;')); assert.ok(!html.includes('<b>bold</b>')); assert.ok(!/<script/i.test(html))
assert.match(r.headers.get('content-security-policy'), /default-src 'none'/); assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff'); assert.match(r.headers.get('x-robots-tag'), /noindex/); assert.strictEqual(r.headers.get('referrer-policy'), 'no-referrer')
assert.ok(!html.includes('.env') && !html.includes('KEY=abc'), 'other files do not appear in a file link')
r = await fetch(base + made.path + '/raw'); assert.strictEqual(r.status, 200); assert.match(r.headers.get('content-type'), /text\/plain/); assert.match(r.headers.get('content-disposition'), /attachment; filename="cart.py"/); assert.ok((await r.text()).startsWith('def total'))

// the copy does not change afterwards
files.get('cart.py').delete(0, 4); files.get('cart.py').insert(0, 'XXXX')
assert.ok((await (await fetch(base + made.path + '/raw')).text()).startsWith('def total'), 'a link is a copy made at share time')

// wrong or malformed addresses
assert.strictEqual((await fetch(base + '/snap/' + token.slice(0, 16) + '0'.repeat(32))).status, 404)
assert.strictEqual((await fetch(base + '/snap/' + token.slice(0, 40))).status, 404); assert.strictEqual((await fetch(base + '/s/../../etc/passwd')).status, 404)
assert.strictEqual((await fetch(base + made.path, { method: 'POST' })).status, 405)

// refusals
assert.strictEqual((await call('POST', '/api/snapshot/demo', { file: '.env' })).status, 400)
assert.strictEqual((await call('POST', '/api/snapshot/demo', { file: 'config/secrets.json' })).status, 400)
assert.strictEqual((await call('POST', '/api/snapshot/demo', { file: 'big.txt' })).status, 413)
assert.strictEqual((await call('POST', '/api/snapshot/demo', { file: 'nope.py' })).status, 404)

// a project link: secrets, dotfiles and dot-folders are left out; the page lists the files
r = await call('POST', '/api/snapshot/demo', { title: 'Demo project' }); assert.strictEqual(r.status, 201); const proj = await r.json()
assert.strictEqual(proj.kind, 'project'); assert.ok(proj.skipped >= 3, 'skipped: ' + proj.skipped)
const ph = await (await fetch(base + proj.path)).text(); assert.ok(ph.includes('Demo project') && ph.includes('docs/notes.md') && ph.includes('src/app.js') && ph.includes('big.txt'))
assert.ok(!ph.includes('KEY=abc') && !ph.includes('secrets.json') && !ph.includes('.vespr'), 'no secrets or dot-folders in a project link')
assert.strictEqual((await fetch(base + proj.path + '/raw')).status, 404, 'raw is for file links')

// listing never shows a token; revoking ends the link at once
r = await call('GET', '/api/snapshot/demo'); const list = await r.json(); assert.strictEqual(list.length, 2); assert.ok(!JSON.stringify(list).includes(token.slice(16))); assert.ok(list.every(s => s.by === 'alex' && s.id))
assert.strictEqual((await call('GET', '/api/snapshot/other')).status, 200); assert.deepStrictEqual(await (await call('GET', '/api/snapshot/other')).json(), [])
assert.strictEqual((await call('DELETE', '/api/snapshot/other/' + made.id)).status, 404, 'a link of another room cannot be removed from here')
assert.strictEqual((await call('DELETE', '/api/snapshot/demo/' + made.id, null, null)).status, 401)
assert.strictEqual((await call('DELETE', '/api/snapshot/demo/' + made.id)).status, 204)
assert.strictEqual((await fetch(base + made.path)).status, 404); assert.ok(!fs.existsSync(path.join(DATA, '_snapshots', made.id + '.json')), 'the copy is deleted')

// expiry
const p2 = await (await call('POST', '/api/snapshot/demo', { file: 'docs/notes.md' })).json(); const f2 = path.join(DATA, '_snapshots', p2.path.slice(6, 22) + '.json')
const s2 = JSON.parse(fs.readFileSync(f2, 'utf8')); s2.expires = Date.now() - 1000; fs.writeFileSync(f2, JSON.stringify(s2))
assert.strictEqual((await fetch(base + p2.path)).status, 410); assert.ok(!fs.existsSync(f2), 'an ended link is removed')
assert.ok(!(await (await call('GET', '/api/snapshot/demo')).json()).some(s => s.id === p2.id))
// days are clamped; a limit per workspace
const long = await (await call('POST', '/api/snapshot/demo', { file: 'docs/notes.md', days: 9999 })).json(); assert.ok(long.expires <= Date.now() + 90 * 86400000 + 5000)
const tight = createSnapshot({ DATA, identify: t => TOK[t], roomOk: () => true, getYDoc: () => doc, limits: { perRoom: 2 } }); const s3 = http.createServer((q, w) => { if (!tight.http(q, w)) { w.writeHead(404); w.end() } }); const port3 = await freePort(); await new Promise(r => s3.listen(port3, '127.0.0.1', r))
const b3 = 'http://127.0.0.1:' + s3.address().port; const c3 = body => fetch(b3 + '/api/snapshot/demo', { method: 'POST', headers: { Authorization: 'Bearer good-token' }, body: JSON.stringify(body) })
assert.strictEqual((await c3({ file: 'src/app.js' })).status, 507, 'the room already has its two active links'); s3.close()
// oversize bodies and junk
assert.strictEqual((await fetch(base + '/api/snapshot/demo', { method: 'POST', headers: { Authorization: 'Bearer good-token' }, body: '{' })).status, 400)
doc.getMap('settings').set('fileStoreVersion', 1)
fileStore(doc).rename([['docs/notes.md', 'guides/notes.md']])
assert.strictEqual((await call('POST', '/api/snapshot/demo', { file: 'docs/notes.md' })).status, 404)
const renamedSnapshot = await (await call('POST', '/api/snapshot/demo', { file: 'guides/notes.md' })).json()
assert.strictEqual(await (await fetch(base + renamedSnapshot.path + '/raw')).text(), '# notes\n')
srv.close(); fs.rmSync(DATA, { recursive: true, force: true })
console.log('snapshot tests passed')
