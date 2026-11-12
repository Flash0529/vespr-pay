import { fileStore } from '../app/file-store.js'
// VESPR realtime server: one Yjs document per workspace ("room").
//   Y.Map "files"  path -> Y.Text   (every shared source file)
//   Y.Array "chat" shared, attributed chat log (people and agents)
// People and agents connect over WebSocket as ordinary Yjs peers; presence (cursor, selection, who) rides
// on Yjs awareness. Canonical files are exported to <data>/<room>/tree/ so git and agents can read them.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { WebSocketServer } from 'ws'
import { createSocketRegistry } from './sockets.js'
import { createRequire } from 'node:module'
import utils from 'y-websocket/bin/utils'
import { createRunnerHub } from './runners.js'
import { createGit } from './git.js'
import { createUploads } from './uploads.js'
import { createLedger } from './usage-ledger.js'
import { createBilling } from './billing.js'
import { createCostSharing } from './cost-sharing.js'
import { createPrefs } from './prefs.js'
import { createAccess } from './access.js'
import { createSnapshot } from './snapshot.js'
import { createNas } from './nas.js'
import { createShare } from './share.js'
import { createPersonalChat } from './personal-chat.js'
import { createFriends, defaultHandleOf } from './friends.js'
import { createDm, reservedRoom } from './dm.js'
import { createVaultKeyStore } from './vault.js'
import { createDataPipeline } from './data-pipeline.js'
import { createGuard } from './guard.js'
import { createPay, parseOperatorRoles, operatorRecord } from './pay.js'
import { createPayPal, parseAmount } from './paypal.js'
// Use the same (CommonJS) copy of Yjs that y-websocket's utils use, otherwise Yjs warns and type checks fail.
const Y = createRequire(import.meta.url)('yjs')
const { setupWSConnection, setPersistence } = utils

const HOST = process.env.MURMIO_HOST || '127.0.0.1'
const PORT = Number(process.env.MURMIO_PORT || 8241)
const DATA = process.env.MURMIO_DATA || path.join(process.env.HOME || '.', 'murmio-data')
const TOKENS_FILE = process.env.MURMIO_TOKENS_FILE || path.join(process.env.HOME || '.', '.secrets', 'murmio-tokens')

// tokens file: one "name:token" per line. Never logged.
let tokensCache = { key: '', map: new Map() }
function loadTokens () {
  let key = ''; try { const st = fs.statSync(TOKENS_FILE); key = st.mtimeMs + ':' + st.size } catch {}
  if (key && key === tokensCache.key) return tokensCache.map
  const m = new Map()
  tokensCache = { key, map: m }
  try {
    for (const line of fs.readFileSync(TOKENS_FILE, 'utf8').split('\n')) {
      const i = line.indexOf(':')
      if (i > 0) m.set(line.slice(i + 1).trim(), line.slice(0, i).trim())
    }
  } catch { /* no file: nobody can connect */ }
  return m
}
const roomOk = r => /^[a-z0-9][a-z0-9-]{0,39}$/.test(r)
const safeRel = p => {
  const n = path.posix.normalize('/' + p).slice(1)
  return n && !n.startsWith('..') && !n.includes('\0') ? n : null
}

// ── persistence: snapshot + exported file tree ──────────────────────────────
const timers = new Map()
function exportTree (room, doc) {
  const root = path.join(DATA, room, 'tree')
  for (const [rel, text] of fileStore(doc)) {
    const safe = safeRel(rel)
    if (!safe) continue
    const dest = path.join(root, safe)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const body = text.toString()
    try { if (fs.readFileSync(dest, 'utf8') === body) continue } catch {}
    fs.writeFileSync(dest, body)
  }
}
function save (room, doc) {
  const dir = path.join(DATA, room)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'doc.ydoc.tmp'), Y.encodeStateAsUpdate(doc))
  fs.renameSync(path.join(dir, 'doc.ydoc.tmp'), path.join(dir, 'doc.ydoc'))
  exportTree(room, doc)
}
setPersistence({
  provider: null,
  bindState: async (room, doc) => {
    doc.getMap("settings").set("fileStoreVersion", 1)
    try { Y.applyUpdate(doc, fs.readFileSync(path.join(DATA, room, 'doc.ydoc'))) } catch {}
    try {
      // keep the session log bounded: past 40 MB the old log is set aside and a fresh one starts from the current state
      if (fs.existsSync(logPath(room)) && fs.statSync(logPath(room)).size > 40 * 1024 * 1024) fs.renameSync(logPath(room), logPath(room) + '.old')
      if (!fs.existsSync(logPath(room))) appendLog(room, 0, Y.encodeStateAsUpdate(doc))
    } catch (e) { console.error('log failed:', e.code || e.message) }
    doc.on('update', u => { try { appendLog(room, 1, u) } catch (e) { console.error('log failed:', e.code || e.message) } })
    const lastSeen = new Map() // throttle presence records to about 7 per second per client
    doc.awareness.on('update', ({ added, updated, removed }) => {
      const now = Date.now(); const rec = []
      for (const id of [...added, ...updated]) { if (now - (lastSeen.get(id) || 0) < 150) continue; lastSeen.set(id, now); rec.push({ id, state: doc.awareness.getStates().get(id) || null }) }
      for (const id of removed) rec.push({ id, state: null })
      if (rec.length) try { appendLog(room, 2, Buffer.from(JSON.stringify(rec))) } catch (e) { console.error('log failed:', e.code || e.message) }
    })
    doc.on('update', () => {
      clearTimeout(timers.get(room))
      timers.set(room, setTimeout(() => { try { save(room, doc) } catch (e) { console.error('save failed:', e.code || e.message) } }, 400))
    })
  },
  writeState: async (room, doc) => { try { save(room, doc) } catch (e) { console.error('save failed:', e.code || e.message) } }
})

// ── session log: every change to the shared document and every presence change, with a timestamp (for replay and the catch-up digest)
// Record: kind (1 byte: 0 base state, 1 document update, 2 presence) | time in ms (8 bytes) | length (4 bytes) | payload.
const logPath = room => path.join(DATA, room, 'log.bin')
function appendLog (room, kind, payload) {
  const head = Buffer.alloc(13); head.writeUInt8(kind, 0); head.writeDoubleBE(Date.now(), 1); head.writeUInt32BE(payload.length, 9)
  fs.mkdirSync(path.join(DATA, room), { recursive: true })
  fs.appendFileSync(logPath(room), Buffer.concat([head, Buffer.from(payload)]))
}

// ── HTTP + WebSocket ────────────────────────────────────────────────────────
// Only agent identities may start jobs on runners: a person's token must not be able to skip the room's approval flow.
const RUN_USERS = (process.env.MURMIO_RUN_USERS || '').split(',').map(s => s.trim()).filter(Boolean)
const mayRun = name => RUN_USERS.length ? RUN_USERS.includes(name) : /^agent/.test(name)
// the agents' names (access control knows them: agents never own, manage or answer requests); nobody may sign up with one
const AGENT_NAMES = String(process.env.VESPR_AGENT_NAMES || 'coder,reviewer,tutor,planner').split(',').map(s => s.trim()).filter(Boolean)
const isAgentName = who => AGENT_NAMES.some(a => a.toLowerCase() === String(who ?? '').trim().toLowerCase())
const auth = process.env.MURMIO_AUTH === '1' ? (await import('./auth.js')).createAuth({ DATA, identifyToken: token => loadTokens().get(token), reservedNames: () => [...AGENT_NAMES, ...loadTokens().values()], mailer: (await import('./mail.js')).mailerFromEnv() }) : null
const identify = token => (auth ? auth.identify(token) : null) || loadTokens().get(token)
// Open sockets belong to the session that opened them: signing a device out (or logging out) closes them, and a sweep closes the ones whose session expired.
const sockets = auth ? createSocketRegistry({ sessionKey: auth.sessionKey, sessionLive: auth.sessionLive }) : null
const hub = createRunnerHub({ identify, mayRun, mayRunIn: (who, room) => !access || access.allows(room, who, 'edit', ''), track: (ws, token) => sockets?.attach(ws, token) })
if (auth && sockets) { auth.onRevoke(({ keys }) => sockets.closeSessions(keys)); sockets.start() }
const git = createGit({ DATA, getYDoc: room => utils.getYDoc(room), identify })
const uploads = createUploads({ DATA, identify, roomOk })
// usage ledger (server/usage-ledger.js): off unless VESPR_LEDGER=1. Only a STATIC agent token whose name is in VESPR_LEDGER_WRITERS
// may record (an account can call itself anything); people read only their own usage.
const ledgerWriters = new Set(String(process.env.VESPR_LEDGER_WRITERS || '').split(',').map(s => s.trim()).filter(Boolean))
const ledger = process.env.VESPR_LEDGER === '1' ? createLedger({ DATA, identify, isWriter: token => { const n = loadTokens().get(token); return !!n && ledgerWriters.has(n) } }) : null
// billing (server/billing.js): Stripe test mode, off unless VESPR_BILLING=1; needs the ledger (spend), STRIPE_SECRET_KEY,
// STRIPE_WEBHOOK_SECRET and VESPR_AUTH_BASE_URL in the environment (from a dropbox box, never pasted)
// the account's own app choices (server/prefs.js): the setup answer, asked once per account
const prefs = createPrefs({ DATA, identify })
// who may do what in a workspace (server/access.js): make / view / edit / delete per person and path, and server-checked names; off unless VESPR_ACCESS=1
const access = process.env.VESPR_ACCESS === '1' ? createAccess({ DATA, identify, Y, getDoc: room => utils.getYDoc(room), isAgent: isAgentName }) : null
// agents ask before they spend (server/pay.js, docs/PAYPAL.md): PayPal SANDBOX only. Always mounted; it says "not set up" until PAYPAL_CLIENT_ID and
// PAYPAL_CLIENT_SECRET are in the environment (from a dropbox box, never pasted). An endpoint other than the sandbox is refused (server/paypal.js).
// Limits default to USD 50 a request and USD 100 a room a day; VESPR_PAY_REQUEST_MAX and VESPR_PAY_ROOM_DAY_MAX (dollars) change them. VESPR_PAY_BUYER_MINUTES (1 to 180, default 30) is how long an approved order waits for the buyer.
let paypal = null
// VESPR_PAYPAL_DRIVER=sdk uses PayPal's own server SDK (server/paypal-sdk.js, generated by APIMATIC, MIT) behind the same interface; the default is the hand-written fetch client
try { paypal = process.env.VESPR_PAYPAL_DRIVER === 'sdk' ? (await import('./paypal-sdk.js')).createSdkPayPal() : createPayPal({ allowLoopback: process.env.VESPR_PAYPAL_TEST_LOOPBACK === '1' }) } catch (e) { console.error('PayPal is off: ' + e.message) }
const payRoles = parseOperatorRoles(process.env.VESPR_PAY_ROLES)
const payLimit = (name, fallback) => { const a = parseAmount(process.env[name] || ''); return a.ok ? a.cents : fallback }
const pay = createPay({ DATA, identify, isAgent: isAgentName, roomOk, Y, getDoc: room => utils.getYDoc(room), paypal,
  may: (who, room, right) => !access || access.allows(room, who, right, ''),
  userOf: token => { const rec = auth && auth.getSessionUser ? auth.getSessionUser(token) : null; if (rec) return rec; const name = loadTokens().get(token); const role = name && payRoles.get(String(name).toLowerCase()); return role ? operatorRecord(name, role) : null }, // VESPR_PAY_ROLES: roles for token logins (server/pay.js)
  trustProxy: process.env.VESPR_AUTH_TRUST_PROXY === '1', limits: { perRequestCents: payLimit('VESPR_PAY_REQUEST_MAX', 5000), perRoomDayCents: payLimit('VESPR_PAY_ROOM_DAY_MAX', 10000), buyerTtlMs: Math.min(180, Math.max(1, Number(process.env.VESPR_PAY_BUYER_MINUTES) || 30)) * 60_000 } })
// a company's rules become workspace rights, tagged with the company, replaced by every daily check (server/lifecycle.js, access.js setManaged)
if (auth && access) auth.lifecycle.onGrants(({ who, previousWho, companyId, grants, previous }) => {
  const source = 'company:' + companyId; const rooms = new Set([...(previous || []), ...(grants || [])].map(g => g.room))
  for (const room of rooms) { if (previousWho && previousWho !== who) access.setManaged(room, source, previousWho, []); access.setManaged(room, source, who, grants.filter(g => g.room === room)) }
})
// the daily check of company logins (hourly over whoever is due); VESPR_RECHECK=0 turns it off
if (auth && process.env.VESPR_RECHECK !== '0') auth.lifecycle.start()
// who pays in a shared chat (server/cost-sharing.js): each their own, an even split, or one person; part of billing
const sharing = process.env.VESPR_BILLING === '1' && ledger ? createCostSharing({ DATA, identify, roomOk, may: (who, room, right) => !access || access.allows(room, who, right, ''), entries: ledger.all, markup: ledger.markup }) : null
const billing = process.env.VESPR_BILLING === '1' ? createBilling({ DATA, identify, isAgent: token => { const n = loadTokens().get(token); return !!n && ledgerWriters.has(n) }, spentMicros: p => (sharing ? sharing.spentMicros(p) : ledger ? ledger.spentMicros(p) : 0), payersFor: sharing ? sharing.payersFor : undefined }) : null
// read-only snapshot links (a copy of one file or of the project at a long random address): off unless the operator sets VESPR_SNAPSHOT=1; see snapshot.js
const snapshot = process.env.VESPR_SNAPSHOT === '1' ? createSnapshot({ DATA, identify, roomOk, getYDoc: room => utils.getYDoc(room) }) : null
// storage (NAS) endpoints are off unless the operator turns them on (VESPR_NAS=1): they accept large files and the 'clearance' label is not enforced yet (any room member may read or delete an asset)
const nas = process.env.VESPR_NAS === '1' ? createNas({ DATA, identify, roomOk }) : null
// CORS for the token-protected HTTP API (/api/*), so the app shell can call it from another origin (a static dev server, file://, Electron). Auth is a Bearer token in a header, never a cookie,
// so a page on another origin cannot act for a person without that token. MURMIO_CORS_ORIGIN: '*' (default), one origin, or '' to switch it off. WebSockets are not affected by CORS.
// live share links (view or edit guests), friends and project shares (docs/SHARING.md): off unless the operator sets VESPR_SHARE=1 (a link that lets a stranger into a room is the operator's call); data lives in <data>/share and <data>/friends
const personalChat = createPersonalChat({ identify })
const share = process.env.VESPR_SHARE === '1' ? createShare({ DATA, identify, roomOk, mayShare: (who, room, file) => !reservedRoom(room) && (!access || access.allows(room, who, 'manage', file)) }) : null
const handleOf = ident => (auth && auth.handles ? auth.handles.handleOfIdentity(ident) : defaultHandleOf(ident)) // accounts get a handle automatically (server/handles.js)
const friends = process.env.VESPR_SHARE === '1' || process.env.VESPR_DM === '1' ? createFriends({ DATA, identify, roomOk, handleOf, mayShare: (who, room) => !reservedRoom(room) && (!access || access.allows(room, who, 'manage', '')) }) : null
// direct and group messages: one private room per conversation, only for friends; off unless VESPR_DM=1 (server/dm.js)
const dm = process.env.VESPR_DM === '1' && friends ? createDm({ DATA, identify, handleOf, identityOf: h => (auth && auth.handles ? auth.handles.identityOfHandle(h) : h), areFriends: (a, b) => friends.areFriends(a, b) }) : null
const vaultStore = createVaultKeyStore({ DATA })
// abuse limits for the public VM (server/guard.js): requests a minute per address, sockets per account and address, bytes a minute,
// new workspaces a day, and a disk floor. Operator service tokens (the agents) are not limited. VESPR_LIMITS=0 turns it off.
const guard = createGuard({ trustProxy: process.env.VESPR_AUTH_TRUST_PROXY === '1', dataDir: DATA })
const guardOn = process.env.VESPR_LIMITS !== '0'
const isService = token => Boolean(token) && loadTokens().has(token)
const dataPipeline = createDataPipeline({ DATA })
function vaultHttp (req, res) {
  const u = new URL(req.url, 'http://x')
  if (!u.pathname.startsWith('/api/vault/keys')) return false
  const who = identify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
  if (!who) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'unauthorized' })); return true }
  if (req.method === 'GET' && u.pathname === '/api/vault/keys') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ keys: vaultStore.listKeys(who) }))
    return true
  }
  if (req.method === 'POST' && u.pathname === '/api/vault/keys') {
    if (guardOn && (!guard.take('vault:' + who, 30) || vaultStore.listKeys(who).length >= 50)) { res.writeHead(429, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'too many keys or saves; at most 50 keys' })); return true }
    let raw = ''; let size = 0
    req.on('data', c => { size += c.length; if (size > 16384) { req.destroy() } else raw += c })
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}')
        const saved = vaultStore.saveKey(who, body)
        res.writeHead(201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, key: saved }))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return true
  }
  const delMatch = u.pathname.match(/^\/api\/vault\/keys\/([a-zA-Z0-9_\-]+)$/)
  if (req.method === 'DELETE' && delMatch) {
    const id = delMatch[1]
    const deleted = vaultStore.deleteKey(who, id)
    res.writeHead(deleted ? 200 : 404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: deleted }))
    return true
  }
  return false
}
const CORS_ORIGIN = process.env.MURMIO_CORS_ORIGIN ?? '*'
const server = http.createServer((req, res) => {
  // Differentiate Desktop SDE traffic from vespr.online web traffic
  const clientHdr = (req.headers && req.headers['x-vespr-client']) ? String(req.headers['x-vespr-client']).toLowerCase() : '';
  const uaHdr = (req.headers && req.headers['user-agent']) ? String(req.headers['user-agent']).toLowerCase() : '';
  const isDesktop = clientHdr.includes('desktop') || uaHdr.includes('vespr-desktop') || Boolean(req.headers && req.headers['x-vespr-platform']);
  const trafficSource = isDesktop ? 'desktop-sde' : 'vespr-online-web';
  req.trafficSource = trafficSource;
  res.setHeader('X-Vespr-Traffic-Source', trafficSource);
  const u0 = new URL(req.url, 'http://x');
  if (u0.pathname === '/api/traffic-source') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ trafficSource, client: clientHdr || 'web', isDesktop }));
  }
  const u = new URL(req.url, 'http://x')
  if (guardOn && !isService((req.headers.authorization || '').replace(/^Bearer\s+/i, '')) && guard.http(req, res)) return
  // nothing new is stored once the data disk is nearly full (uploads, big files, git pushes)
  if (guardOn && req.method === 'POST' && /^\/(api\/upload|api\/nas|git)\//.test(u.pathname) && !guard.diskOk()) { res.writeHead(507, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'The server is out of space for new files right now.' })) }
  if (CORS_ORIGIN && u.pathname.startsWith('/api/') && req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN); res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition'); if (CORS_ORIGIN !== '*') res.setHeader('Vary', 'Origin')
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' }); return res.end() }
  }
  if (auth && u.pathname.startsWith('/auth/')) { auth.http(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end() } }).catch(err => { console.error('Auth request failed:', err.message); if (!res.headersSent) res.writeHead(500); res.end() }); return }
  if (access && access.gate(req, res)) return // uploads, snapshots and git follow the workspace's access list, not just sign-in
  if (hub.http(req, res)) return
  if (git.http(req, res)) return
  if (uploads.http(req, res)) return
  if (prefs.http(req, res)) return
  if (access && access.http(req, res)) return
  if (pay.http(req, res)) return // agents ask before they spend: PayPal sandbox payment requests (server/pay.js)
  if (ledger && ledger.http(req, res)) return
  if (sharing && sharing.http(req, res)) return
  if (billing && billing.http(req, res)) return
  if (snapshot && snapshot.http(req, res)) return
  if (nas && nas.http(req, res)) return
  if (auth && auth.orgPolicy && auth.orgPolicy.http(req, res)) return // account kind + the organization's file/folder rules (server/orgpolicy.js)
  if (dm && dm.http(req, res)) return
  if (personalChat.http(req, res)) return // personal Chat model call (server/personal-chat.js; 503 until the operator configures a model)
  if (share && share.http(req, res)) return
  if (friends && friends.http(req, res)) return
  if (vaultHttp(req, res)) return
  // training-data admin views (server/data-pipeline.js): off unless the operator sets VESPR_TRAINING=1, and then only for operator service
  // tokens (the tokens file), never for an account: they would hand everyone's prompts to anyone signed in. Collecting people's work for
  // training is the team's legal decision and nothing calls recordTrainingSample today.
  if (process.env.VESPR_TRAINING === '1' && dataPipeline.http(req, res, { identify: t => loadTokens().get(t) || null })) return
  if (u.pathname === '/healthz') { res.writeHead(200); return res.end('ok') }
  if (u.pathname === '/api/suggest' && req.method === 'POST') { // inline suggestions: authenticate, then forward to the agent worker
    const authHdr = req.headers.authorization || ''
    const suggester = identify(authHdr.replace(/^Bearer\s+/i, ''))
    if (!suggester) { res.writeHead(401); return res.end() }
    if (guardOn && !guard.take('suggest:' + suggester, 120)) { res.writeHead(429, { 'Retry-After': '60' }); return res.end() } // the model is shared: two suggestions a second per person at most
    const upstream = process.env.MURMIO_SUGGEST_UPSTREAM
    if (!upstream) { res.writeHead(503); return res.end() }
    const up = http.request(upstream, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authHdr }, timeout: 15000 }, r => { res.writeHead(r.statusCode || 502, { 'Content-Type': 'application/json' }); r.pipe(res) })
    up.on('error', () => { res.writeHead(502); res.end() }); up.on('timeout', () => up.destroy())
    let sent = 0; req.on('data', c => { sent += c.length; if (sent > 30000) { req.destroy(); up.destroy() } })
    return req.pipe(up)
  }
  if (/^\/preview\/[0-9a-f]{24}(\/|$)/.test(u.pathname)) { // a page served by an app the agent started ("Run it"): the 24-hex token in the path is the credential
    const upstream = process.env.MURMIO_SUGGEST_UPSTREAM
    if (!upstream) { res.writeHead(404); return res.end() }
    const t = new URL(upstream)
    const fwd = http.request({ host: t.hostname, port: t.port, method: req.method, path: req.url, headers: { ...req.headers, host: t.host }, timeout: 60000 }, r => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res) })
    fwd.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('The preview is not available right now.') }); fwd.on('timeout', () => fwd.destroy())
    return req.pipe(fwd)
  }
  const lg = /^\/api\/log\/([^/]+)$/.exec(u.pathname)
  if (lg) { // the session log, for replay: needs a valid token in the Authorization header
    const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!roomOk(lg[1]) || !identify(tok)) { res.writeHead(401); return res.end() }
    try { const buf = fs.readFileSync(logPath(lg[1])); res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' }); return res.end(buf) } catch { res.writeHead(404); return res.end() }
  }
  res.writeHead(404); res.end('not found')
})
const wss = new WebSocketServer({ noServer: true, maxPayload: guard.limits.maxMessage }) // the ws default is 100 MB a message
wss.on('connection', (ws, req) => {
  ws.on('error', () => {}) // a frame over the limit, an unmasked frame or other bad bytes: `ws` emits 'error' on THIS socket, and with no listener Node ends the whole server. The socket closes by itself (e.g. 1009); nobody else is affected
  if (guardOn && !req.murmioService) guard.attach(ws, req.murmioGuest ? null : req.murmioUser, guard.clientIp(req)) // counted and metered
  if (!req.murmioGuest) sockets?.attach(ws, req.murmioToken) // a person's own session; share-link guests have their own revoke below
  if (req.murmioGuest) { share.restrict(ws, req.murmioGuest.role); share.attach(ws, req.murmioGuest) } // a share-link guest: view drops edits, revoke or expiry closes the socket
  if (access) access.guard(ws, req) // every edit is checked against the sender's rights and name before it reaches the room
  setupWSConnection(ws, req, { docName: req.murmioRoom })
})
server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url, 'http://x')
  const tok = u.searchParams.get('token') || ''
  const service = isService(tok) || isService((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
  if (guardOn && !service && guard.upgrade(req, socket)) return
  if (hub.upgrade(req, socket, head)) return
  const m = /^\/ws\/([^/]+)$/.exec(u.pathname)
  let who = identify(tok)
  const guest = !who && share && m && roomOk(m[1]) ? share.guest(tok, m[1], share.clientIp(req)) : null // a whole-workspace share link opens this one room only
  if (guest) who = guest.who
  if (!m || !roomOk(m[1]) || !who) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy() }
  if (reservedRoom(m[1]) && (guest || !dm || !dm.allows(m[1], who))) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy() } // a direct-message room opens only for its members (never by a share link, never when messaging is off)
  if (access && !guest && !access.mayJoin(m[1], who)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy() } // a locked workspace: members only
  if (guardOn && !service && !guest) {
    if (guard.account(who, socket)) return
    const fresh = !utils.docs.has(m[1]) && !fs.existsSync(path.join(DATA, m[1]))
    if (fresh && !guard.newRoom(who)) { socket.write('HTTP/1.1 429 Too Many Requests\r\nRetry-After: 3600\r\n\r\n'); return socket.destroy() } // new workspaces a day, or the disk is nearly full
  }
  req.murmioService = service
  req.murmioRoom = m[1]
  req.murmioToken = tok
  req.murmioUser = who
  req.murmioGuest = guest
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req))
})
server.listen(PORT, HOST, () => console.log(`murmio-server on ${HOST}:${PORT}, data in ${DATA}`))
