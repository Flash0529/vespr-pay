// server/guard.js: the abuse limits hold, forget idle counts, and never refuse inside a limit.   node test/guard.test.js
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createGuard, limitsFrom } from '../guard.js'

let t = 1_000_000
const logs = []
const limits = { ...limitsFrom({}), ipPerMin: 5, upgradesPerMin: 3, socketsPerUser: 2, socketsPerIp: 3, bytesPerMin: 100, roomsPerDay: 2 }
let free = 10 * 1024 ** 3
const g = createGuard({ trustProxy: true, limits, now: () => t, statfs: () => ({ bavail: free / 4096, bsize: 4096 }), log: m => logs.push(m) })
const req = (url, ip = '1.1.1.1') => ({ url, headers: { 'x-forwarded-for': 'spoofed, ' + ip }, socket: { remoteAddress: '10.0.0.2' } })
const res = () => ({ code: 0, headers: {}, writeHead (c, h) { this.code = c; this.headers = h || {} }, end () {} })
const sock = () => ({ out: '', dead: false, write (s) { this.out += s }, destroy () { this.dead = true } })

// HTTP: the last X-Forwarded-For entry is the address (the proxy wrote it); five a minute pass, the sixth is refused
assert.equal(g.clientIp(req('/api/x')), '1.1.1.1')
for (let i = 0; i < 5; i++) assert.equal(g.http(req('/api/me'), res()), false)
const r6 = res(); assert.equal(g.http(req('/auth/session'), r6), true); assert.equal(r6.code, 429); assert.equal(r6.headers['Retry-After'], '60')
assert.equal(g.http(req('/api/me', '2.2.2.2'), res()), false, 'another address has its own count')
assert.equal(g.http(req('/index.html'), res()), false, 'static pages are not counted here')
t += 60_000; assert.equal(g.http(req('/api/me'), res()), false, 'a new minute starts fresh')
assert.equal(createGuard({ trustProxy: false, limits }).clientIp(req('/')), '10.0.0.2', 'without a trusted proxy the header is ignored')

// sockets: new ones a minute per address
const s1 = sock(); for (let i = 0; i < 3; i++) assert.equal(g.upgrade(req('/ws/a', '3.3.3.3'), sock()), false)
assert.equal(g.upgrade(req('/ws/a', '3.3.3.3'), s1), true); assert.ok(s1.out.startsWith('HTTP/1.1 429') && s1.dead)

// open sockets per account and per address, released on close
const ws = () => { const e = new EventEmitter(); e.closed = null; e.close = (c) => { e.closed = c; e.emit('close') }; return e }
const a = ws(); const b = ws(); g.attach(a, 'ana', '4.4.4.4'); g.attach(b, 'ana', '4.4.4.4')
assert.equal(g.account('ana', sock()), true, 'a third socket for ana is refused')
assert.equal(g.account('bo', sock()), false)
const c = ws(); g.attach(c, 'bo', '4.4.4.4')
t += 60_000; assert.equal(g.upgrade(req('/ws/a', '4.4.4.4'), sock()), true, 'three open from one address is the cap')
a.close(1000); assert.equal(g.account('ana', sock()), false, 'closing frees a place')
t += 60_000; assert.equal(g.upgrade(req('/ws/a', '4.4.4.4'), sock()), false)

// bytes a minute per account: over budget the socket is closed with 1008
b.emit('message', Buffer.alloc(60)); assert.equal(b.closed, null)
b.emit('message', Buffer.alloc(60)); assert.equal(b.closed, 1008)
const d = ws(); g.attach(d, 'cy', '5.5.5.5'); d.emit('message', Buffer.alloc(90)); t += 60_000; d.emit('message', Buffer.alloc(90)); assert.equal(d.closed, null, 'the budget renews each minute')

// new workspaces a day, and none when the disk is nearly full
assert.equal(g.newRoom('dee'), true); assert.equal(g.newRoom('dee'), true); assert.equal(g.newRoom('dee'), false)
t += 86_400_000; assert.equal(g.newRoom('dee'), true, 'a new day')
free = 1024 ** 3; t += 31_000; assert.equal(g.diskOk(), false); assert.equal(g.newRoom('eve'), false, 'disk floor')
assert.ok(logs.some(l => /nearly full/.test(l)))
free = 10 * 1024 ** 3; t += 31_000; assert.equal(g.diskOk(), true)

// named counters (suggestions, vault saves)
for (let i = 0; i < 4; i++) assert.equal(g.take('suggest:ana', 4), true)
assert.equal(g.take('suggest:ana', 4), false)

// logs never carry a token or an address
assert.ok(logs.every(l => !/\d+\.\d+\.\d+\.\d+/.test(l)), 'no addresses in the log')
// environment overrides, with bad values ignored
const L = limitsFrom({ VESPR_LIMIT_IP_PER_MIN: '50', VESPR_LIMIT_SOCKETS_PER_USER: 'lots' })
assert.equal(L.ipPerMin, 50); assert.equal(L.socketsPerUser, 40)
g.stop()
console.log('guard: all checks passed')
