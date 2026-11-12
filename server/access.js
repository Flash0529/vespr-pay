// Who may do what in a workspace, checked by the server on every edit (not by the screen). Off unless VESPR_ACCESS=1.
// Rights: make (create files), view (open the workspace), edit (change files), delete (remove files), manage (change who has access
// there: give or take back make/view/edit/delete, only rights you hold yourself; only the owner gives manage). A grant gives some to
// a person ("*" = everyone signed in) on a path: "" is the whole workspace, "src/" a folder, "src/a.py" one file. The owner has all.
// A grant may end ("until", ms): after that it counts for nothing. Agents never manage, own or answer requests.
// Asking: anyone signed in asks for rights on a path with a reason (POST .../request); the server posts the request as a card in the
// workspace chat, and the owner or a manager of that path answers (POST .../answer): allow for an hour, a day or always, or deny.
// A workspace with no access list is open, as before, until someone locks it (POST /api/access/<room>/lock) and becomes its owner.
//
// How edits are checked: each update a connection sends is first applied to a private shadow copy of the room, which shows exactly what
// it would change (files made, edited, renamed, deleted; chat posted or changed; other shared state). Each change is checked against
// the sender's rights; anything not allowed is dropped before it reaches the room or anyone else.
// Names are checked too, locked or not: a chat message must carry its sender's own signed-in name, and nobody can change someone
// else's message, except to answer an agent's approval card in their own name (which needs edit on the workspace when locked).
// Access request cards and payment request cards (server/pay.js) are written only by the server: a connection can neither post nor change one.
// The "ui" list holds each person's own commands for their SDE (open a file, follow an agent): anyone who may join adds them in their
// own name, and may trim the oldest (the client keeps the last 50); anything else there needs edit on the whole workspace.
// Claims ("I am editing this file", path -> { by, ai, since }): in your own name on a file you may edit; you may release your own,
// or any claim on a file you may delete. The provenance log (who changed what, and why) takes new entries in your own name about a
// file you may make, edit or delete; changing or removing entries needs edit on the whole workspace.
// Honest limit: a workspace is one shared document, so "view" works for the whole workspace, not per folder (that needs per-folder documents).
//   GET  /api/access/<room>                          the list (owner, grants) and your own rights; members only
//   POST /api/access/<room>/lock                     an open workspace gets an access list, with you as owner
//   POST /api/access/<room>/grant  { who, path, rights }   owner only; replaces that person's grant on that path
//   POST /api/access/<room>/revoke { who, path }           owner only
//   POST /api/access/<room>/unlock                   owner only: back to open
//   POST /api/access/<room>/request { path, rights, reason }   anyone signed in; at most 3 waiting each, not again soon after a no
//   GET  /api/access/<room>/requests                 waiting requests you may answer, and your own
//   POST /api/access/<room>/answer { id, approve, for: '1h'|'1d'|'always', rights? }   the owner, or a manager of that path
//   GET  /api/access/<room>/history                  the audit log (owner and managers)
import fs from 'node:fs'
import path from 'node:path'
import * as decoding from 'lib0/decoding'

export const RIGHTS = ['make', 'view', 'edit', 'delete', 'manage', 'maker']
export const FILE_RIGHTS = ['make', 'view', 'edit', 'delete']
const ALL = () => new Set(RIGHTS)
const live = (g, t) => !(g && g.until && g.until <= t) // a grant that ended counts for nothing
// what agents write for their own work (their checklist, which message they took, the token meter, delegated tasks): an agent may,
// with view, even where it may not edit the whole workspace
export const AGENT_STATE = new Set(['plans', 'handled', 'usage', 'tasks'])
// settings keys an agent writes about itself (what it can do) and as answers to requests people made; never agentMode or runner
export const AGENT_SETTINGS = new Set(['githubImport', 'githubPr', 'packsCatalog', 'runs', 'github', 'githubBase', 'pr', 'packsApplied'])
const norm = s => String(s ?? '').trim().toLowerCase()
const same = (a, b) => norm(a) !== '' && norm(a) === norm(b)

// a path inside the workspace ('' = all of it); null when it tries to leave it
export function cleanPath (p) {
  const s = String(p ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (s.length > 300 || /[\u0000-\u001f]/.test(s) || s.split('/').some(x => x === '..' || x === '.')) return null
  return s
}
const covers = (g, p) => g === '' || p === g || p.startsWith(g.endsWith('/') ? g : g + '/')

export function rightsFor (acl, who, p = '', t = Date.now()) {
  if (!acl) return ALL()
  if (same(acl.owner, who)) return ALL()
  const out = new Set()
  for (const g of acl.grants || []) if (live(g, t) && (g.who === '*' || same(g.who, who)) && covers(g.path, String(p ?? ''))) for (const r of g.rights) out.add(r)
  return out
}
export const may = (acl, who, right, p) => rightsFor(acl, who, p).has(right)
// joining needs view somewhere: a person who sees one folder sees the whole document today (see the honest limit above)
export const mayJoin = (acl, who, t = Date.now()) => !acl || same(acl.owner, who) || (acl.grants || []).some(g => live(g, t) && (g.who === '*' || same(g.who, who)) && g.rights.includes('view'))

// the first change this person may not make, or null when all of them are allowed
export function decide (acl, who, effects, { isAgent = () => false } = {}) {
  for (const e of effects) {
    if (e.kind === 'make' || e.kind === 'edit' || e.kind === 'delete') { if (!may(acl, who, e.kind, e.path)) return `${e.kind} ${e.path}` }
    else if (e.kind === 'chat') { if (e.role === 'access' || e.role === 'payment') return `post a ${e.role} card (only the server does)`; if (!same(e.author, who)) return `post as ${e.author || 'nobody'}`; if (!mayJoin(acl, who)) return 'post' }
    else if (e.kind === 'chat-edit') {
      if (e.access) return 'change a request card, an access or a payment request (answer it with the buttons)'
      if (same(e.author, who)) continue
      if (e.approval && same(e.decidedBy, who) && (!acl || may(acl, who, 'edit', ''))) continue
      return `change ${e.author || 'someone'}'s message`
    } else if (e.kind === 'chat-delete') { if (!acl || !same(acl.owner, who)) return 'delete chat messages' }
    else if (e.kind === 'ui') { if (!same(e.by, who)) return `send commands as ${e.by || 'nobody'}`; if (!mayJoin(acl, who)) return 'send commands' }
    else if (e.kind === 'ui-trim') { if (acl && !may(acl, who, 'edit', '') && !(e.front && e.left >= 50)) return 'remove commands' }
    else if (e.kind === 'claim') { if (!same(e.by, who)) return `claim ${e.path} as ${e.by || 'nobody'}`; if (!may(acl, who, 'edit', e.path)) return `claim ${e.path}` }
    else if (e.kind === 'claim-drop') { if (!same(e.by, who) && !may(acl, who, 'delete', e.path)) return `release ${e.path}` }
    else if (e.kind === 'log') { if (!same(e.by, who)) return `log changes as ${e.by || 'nobody'}`; if (!['make', 'edit', 'delete'].some(r => may(acl, who, r, e.file))) return `log changes to ${e.file}` }
    else if (e.kind === 'setting') { if (acl && !may(acl, who, 'edit', '') && !(AGENT_SETTINGS.has(e.key) && isAgent(who) && mayJoin(acl, who))) return 'change settings' }
    else if (e.kind === 'state') { if (acl && !may(acl, who, 'edit', '') && !(AGENT_STATE.has(e.name) && isAgent(who) && mayJoin(acl, who))) return `change ${e.name}` }
    else if (e.kind === 'agent-control') { if (acl && !may(acl, who, 'maker', 'agent:' + e.agent) && !may(acl, who, 'manage', '')) return `control agent ${e.agent}` }
    else if (e.kind === 'agent-visibility') { if (acl && !may(acl, who, 'maker', 'agent:' + e.agent) && !may(acl, who, 'manage', '')) return `set visibility for agent ${e.agent}` }
  }
  return null
}

// Which right an HTTP feature needs in a workspace, or null when the route is not one of them (server/index.js gates these before the
// module runs, so a locked workspace's list applies to them too, not just sign-in):
//   uploads: add = make (in uploads/), list or download = view; snapshots (a published copy): make or delete = manage, list = view;
//   git: commit and push = edit on the whole workspace, log, blame, clone and fetch = view; the change log = view; NAS files: add = make,
//   delete = delete, list/download/verify = view. Share links are checked in share.js (manage).
export function routeNeed (method, pathname, search = '') {
  const m = String(method || 'GET').toUpperCase(); const p = String(pathname || '')
  let r
  if ((r = /^\/api\/upload\/([^/]+)(?:\/[^/]+)?$/.exec(p))) return { room: r[1], right: m === 'POST' ? 'make' : 'view', path: m === 'POST' ? 'uploads/' : '' }
  if ((r = /^\/api\/snapshot\/([^/]+)(?:\/[^/]+)?$/.exec(p))) return { room: r[1], right: m === 'GET' ? 'view' : 'manage', path: '' }
  if ((r = /^\/api\/log\/([^/]+)$/.exec(p))) return { room: r[1], right: 'view', path: '' } // the workspace's change log
  if ((r = /^\/api\/nas\/([^/]+)(?:\/[^/]+(\/verify)?)?$/.exec(p))) return { room: r[1], right: m === 'POST' && !r[2] ? 'make' : m === 'DELETE' ? 'delete' : 'view', path: m === 'GET' || r[2] ? '' : 'nas/' } // big files on the NAS
  if ((r = /^\/api\/git\/([^/]+)\/(commit|log|blame)$/.exec(p))) return { room: r[1], right: r[2] === 'commit' ? 'edit' : 'view', path: '' }
  if ((r = /^\/git\/([^/]+?)(?:\.git)?(?:\/.*)?$/.exec(p))) return { room: r[1], right: /git-receive-pack/.test(p + '?' + search) ? 'edit' : 'view', path: '' }
  return null
}

// What an update would change, found by applying it to a shadow copy of the room (kept in step with the real one).
export function createInspector ({ Y, getDoc }) {
  const rooms = new Map()
  const SPECIAL = new Set(['files', 'filePaths', 'chat', 'ui', 'claims', 'provenance', 'settings'])
  function shadowFor (room) {
    const live = getDoc(room)
    let r = rooms.get(room)
    if (r && r.live === live) return r
    if (r) drop(room)
    const s = new Y.Doc()
    Y.applyUpdate(s, Y.encodeStateAsUpdate(live))
    r = { live, s, sink: null, before: new Map() }
    r.onLive = u => { try { Y.applyUpdate(s, u) } catch {} } // everything the room accepts reaches the shadow too (applying twice is harmless)
    live.on('update', r.onLive)
    const files = s.getMap('files'); const names = s.getMap('filePaths'); const chat = s.getArray('chat'); const ui = s.getArray('ui'); const claims = s.getMap('claims'); const prov = s.getArray('provenance'); const settings = s.getMap('settings')
    const pathOf = key => names.get(key) ?? r.before.get(key) ?? key
    files.observeDeep(events => {
      if (!r.sink) return
      for (const ev of events) {
        if (ev.target === files) for (const [key, ch] of ev.changes.keys) r.sink.push({ kind: ch.action === 'add' ? 'make' : ch.action === 'delete' ? 'delete' : 'edit', path: pathOf(key) })
        else r.sink.push({ kind: 'edit', path: pathOf(ev.path[0]) })
      }
    })
    names.observe(ev => {
      if (!r.sink) return
      for (const [key, ch] of ev.changes.keys) {
        if (ch.action === 'add') r.sink.push({ kind: 'make', path: names.get(key) })
        else if (ch.action === 'update') r.sink.push({ kind: 'make', path: names.get(key) }, { kind: 'delete', path: ch.oldValue })
        else r.sink.push({ kind: 'delete', path: ch.oldValue })
      }
    })
    chat.observeDeep(events => {
      if (!r.sink) return
      for (const ev of events) {
        if (ev.target === chat) {
          for (const item of ev.changes.added) for (const m of item.content.getContent()) r.sink.push({ kind: 'chat', author: m instanceof Y.Map ? m.get('author') : null, role: m instanceof Y.Map ? m.get('role') : null })
          if (ev.changes.deleted.size) r.sink.push({ kind: 'chat-delete' })
        } else {
          const msg = chat.get(ev.path[0])
          const keys = msg && ev.target === msg ? [...ev.changes.keys.keys()] : ['text']
          r.sink.push({ kind: 'chat-edit', access: msg instanceof Y.Map && ['access', 'payment'].includes(msg.get('role')), author: msg instanceof Y.Map ? msg.get('author') : null, approval: msg instanceof Y.Map && msg.get('role') === 'approval' && keys.every(k => k === 'status' || k === 'decidedBy'), decidedBy: msg instanceof Y.Map ? msg.get('decidedBy') : null })
        }
      }
    })
    ui.observeDeep(events => {
      if (!r.sink) return
      for (const ev of events) {
        if (ev.target !== ui || ev.changes.keys.size) { r.sink.push({ kind: 'state', name: 'ui' }); continue } // not a plain list of commands
        for (const item of ev.changes.added) for (const c of item.content.getContent()) r.sink.push({ kind: 'ui', by: c && typeof c === 'object' && !(c instanceof Y.AbstractType) ? c.by : null })
        if (ev.changes.deleted.size) { const d = ev.changes.delta; r.sink.push({ kind: 'ui-trim', front: d.filter(x => x.delete).length === 1 && d[0].delete > 0, left: ui.length }) }
      }
    })
    const byOf = v => v && typeof v === 'object' && !(v instanceof Y.AbstractType) ? v.by : null
    claims.observeDeep(events => {
      if (!r.sink) return
      for (const ev of events) {
        if (ev.target !== claims) { r.sink.push({ kind: 'state', name: 'claims' }); continue } // not a plain claim
        for (const [key, ch] of ev.changes.keys) {
          if (ch.action !== 'add') r.sink.push({ kind: 'claim-drop', path: key, by: byOf(ch.oldValue) })
          if (ch.action !== 'delete') r.sink.push({ kind: 'claim', path: key, by: byOf(claims.get(key)) })
        }
      }
    })
    settings.observeDeep(events => {
      if (!r.sink) return
      for (const ev of events) {
        if (ev.target === settings) for (const key of ev.changes.keys.keys()) r.sink.push({ kind: 'setting', key })
        else r.sink.push({ kind: 'setting', key: String(ev.path[0] ?? '') }) // inside a nested value: checked by its top-level key
      }
    })
    prov.observeDeep(events => {
      if (!r.sink) return
      for (const ev of events) {
        if (ev.target !== prov || ev.changes.keys.size || ev.changes.deleted.size) { r.sink.push({ kind: 'state', name: 'provenance' }); continue } // only new entries pass on their own
        for (const item of ev.changes.added) for (const m of item.content.getContent()) r.sink.push(m instanceof Y.Map ? { kind: 'log', by: m.get('by'), file: String(m.get('file') ?? '') } : { kind: 'state', name: 'provenance' })
      }
    })
    s.on('afterTransaction', tr => {
      if (!r.sink) return
      for (const [name, type] of s.share) if (!SPECIAL.has(name) && (tr.changed.has(type) || tr.changedParentTypes.has(type))) r.sink.push({ kind: 'state', name })
    })
    rooms.set(room, r)
    return r
  }
  function drop (room) { const r = rooms.get(room); if (r) { r.live.off('update', r.onLive); r.s.destroy(); rooms.delete(room) } }
  // { effects } for an update, or { error } when it cannot be read. The caller decides; a refused update must be followed by refused(room).
  function effectsOf (room, update) {
    const r = shadowFor(room)
    r.before = new Map(r.s.getMap('filePaths').entries()); r.sink = []
    try { Y.applyUpdate(r.s, update, 'access-check') } catch (e) { r.sink = null; drop(room); return { error: String(e && e.message) } }
    const effects = r.sink; r.sink = null
    return { effects }
  }
  return { effectsOf, refused: drop, rooms }
}

export function createAccess ({ DATA, identify, Y, getDoc, roomOk = r => /^[a-z0-9][a-z0-9-]{0,39}$/.test(r), log = m => console.error(m), now = () => Date.now(), isAgent = () => false }) {
  const dir = path.join(DATA, 'access'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = room => path.join(dir, room + '.json')
  const lists = new Map()
  const aclOf = room => {
    if (!lists.has(room)) { let a = null; try { a = JSON.parse(fs.readFileSync(file(room), 'utf8')) } catch {} lists.set(room, a) }
    return lists.get(room)
  }
  const save = (room, a) => {
    if (a) { const tmp = file(room) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(a, null, 1), { mode: 0o600 }); fs.renameSync(tmp, file(room)) } else fs.rmSync(file(room), { force: true })
    lists.set(room, a)
  }
  const inspector = createInspector({ Y, getDoc })
  const refusals = []

  // a connection's messages: sync updates are checked, everything else (state requests, presence) passes
  const allow = (room, who, data, extra = null) => refusal(room, who, data, extra) === null
  // why a message is refused, or null. Yjs cannot take half an update, and the sender's later changes build on the refused one, so the
  // guard closes that connection (4409) and the app reloads the workspace from the server instead of drifting out of step.
  function refusal (room, who, data, extra = null) {
    let buf
    try { buf = data instanceof Uint8Array ? data : new Uint8Array(data) } catch { return 'an unreadable message' }
    try {
      const d = decoding.createDecoder(buf)
      if (decoding.readVarUint(d) !== 0) return null // awareness (presence), auth, query: not document changes
      const step = decoding.readVarUint(d)
      if (step === 0) return null // sync step 1: "what do you have?", no changes
      const update = decoding.readVarUint8Array(d)
      const out = inspector.effectsOf(room, update)
      const a = aclOf(room)
      const why = out.error ? 'an update the server cannot read' : decide(a && extra ? { ...a, grants: [...a.grants, extra] } : a, who, out.effects, { isAgent })
      if (why) {
        if (!out.error) inspector.refused(room) // the shadow took a change the room will not: start it again from the room
        refusals.push({ ts: now(), room, who, why }); if (refusals.length > 200) refusals.shift()
        log(`access: refused ${who} in ${room}: ${why}`)
        return why
      }
      return null
    } catch { return 'an unreadable message' }
  }
  function guard (ws, req) {
    const room = req.murmioRoom; const who = req.murmioUser
    // a share-link guest keeps what the link says (view: sees; edit: a full teammate), on top of the list; names are still checked
    const role = req.murmioGuest && req.murmioGuest.role
    const extra = role ? { who, path: '', rights: role === 'edit' ? [...FILE_RIGHTS] : ['view'] } : null // a link never manages
    const on = ws.on.bind(ws)
    ws.on = (ev, fn) => ev === 'message' ? on(ev, (data, ...rest) => {
      const why = refusal(room, who, data, extra)
      if (why === null) return fn(data, ...rest)
      try { ws.close(4409, ('not allowed: ' + why).slice(0, 120)) } catch {}
    }) : on(ev, fn)
  }

  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
  const bearer = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const readBody = req => new Promise(resolve => { let s = ''; req.on('data', c => { s += c; if (s.length > 4096) req.destroy() }); req.on('end', () => resolve(s)); req.on('error', () => resolve('')) })
  const t0 = () => now()
  const managesSomething = (a, who) => !!a && (same(a.owner, who) || a.grants.some(g => live(g, t0()) && (g.who === '*' || same(g.who, who)) && g.rights.includes('manage')))
  const mayAnswer = (a, who, r) => !!a && !isAgent(who) && !same(r.who, who) && (same(a.owner, who) || rightsFor(a, who, r.path, t0()).has('manage'))
  const view = (room, who) => {
    const a = aclOf(room); const t = t0()
    const out = { room, locked: !!a, owner: a ? a.owner : null, grants: a ? a.grants.filter(g => live(g, t)) : [], mine: [...rightsFor(a, who, '', t)] }
    if (a) out.waiting = (a.requests || []).filter(r => r.status === 'pending' && mayAnswer(a, who, r)).length
    return out
  }
  // every change to who may do what, one JSON line each, for the owner and managers (GET .../history)
  const audit = (room, e) => { try { fs.appendFileSync(path.join(dir, room + '.log.jsonl'), JSON.stringify({ ts: now(), ...e }) + '\n', { mode: 0o600 }) } catch {} }
  // the request as a card in the workspace chat; only the server writes these (decide refuses them from connections)
  function card (room, r) {
    try {
      const doc = getDoc(room); const chat = doc.getArray('chat'); const id = 'access-' + r.id
      const m = chat.toArray().find(x => x instanceof Y.Map && x.get('id') === id)
      doc.transact(() => {
        if (!m) {
          const n = new Y.Map(); const tx = new Y.Text()
          n.set('id', id); n.set('ts', r.ts); n.set('author', r.who); n.set('isAgent', !!r.agent); n.set('role', 'access')
          n.set('request', { id: r.id, who: r.who, path: r.path, rights: r.rights, reason: r.reason, agent: !!r.agent })
          n.set('status', r.status); n.set('decidedBy', r.by || ''); n.set('until', r.until || 0); n.set('granted', r.granted || []); n.set('text', tx)
          chat.push([n]); tx.insert(0, r.reason || '')
        } else { m.set('status', r.status); m.set('decidedBy', r.by || ''); m.set('until', r.until || 0); m.set('granted', r.granted || []) }
      }, 'access-server')
    } catch (e) { log('access: could not post the request card: ' + (e && e.message)) }
  }
  // waiting requests older than a day lapse
  function lapse (room, a) {
    let changed = false
    for (const r of a.requests || []) if (r.status === 'pending' && now() - r.ts > 24 * 3600_000) { r.status = 'expired'; r.by = ''; changed = true; card(room, r) }
    if (changed) save(room, a)
  }
  const FOR = { '1h': 3600_000, '1d': 24 * 3600_000, always: 0 }

  function http (req, res) {
    const u = new URL(req.url, 'http://x')
    const m = /^\/api\/access\/([^/]+)(?:\/(lock|grant|revoke|unlock|request|requests|answer|history|agents|agent-maker|agent-control))?$/.exec(u.pathname)
    if (!m) return false
    const who = identify(bearer(req)); if (!who) { json(res, 401, { error: 'sign in' }); return true }
    const room = m[1]; if (!roomOk(room)) { json(res, 400, { error: 'bad workspace name' }); return true }
    const a = aclOf(room)
    if (!m[2]) {
      if (req.method !== 'GET') { json(res, 405, { error: 'GET' }); return true }
      if (!mayJoin(a, who)) { json(res, 403, { error: 'not a member of this workspace', canAsk: !!a }); return true }
      json(res, 200, view(room, who)); return true
    }
    if (m[2] === 'requests' || m[2] === 'history' || m[2] === 'agents') {
      if (req.method !== 'GET') { json(res, 405, { error: 'GET' }); return true }
      if (m[2] === 'agents') {
        if (!mayJoin(a, who)) { json(res, 403, { error: 'not a member of this workspace' }); return true }
        json(res, 200, { room, agents: a ? (a.agentMakers || {}) : {} }); return true
      }
      if (!a) { json(res, 200, m[2] === 'requests' ? { requests: [] } : { history: [] }); return true }
      lapse(room, a)
      if (m[2] === 'requests') { json(res, 200, { requests: (a.requests || []).filter(r => same(r.who, who) || (r.status === 'pending' && mayAnswer(a, who, r))).slice(-50) }); return true }
      if (!managesSomething(a, who)) { json(res, 403, { error: 'only the owner and managers see the history' }); return true }
      let lines = []; try { lines = fs.readFileSync(path.join(dir, room + '.log.jsonl'), 'utf8').trim().split('\n').slice(-200).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch {}
      json(res, 200, { history: lines }); return true
    }
    if (req.method !== 'POST') { json(res, 405, { error: 'POST' }); return true }
    readBody(req).then(raw => {
      let b = {}; try { b = JSON.parse(raw || '{}') } catch {}
      if (m[2] === 'lock') {
        if (a) return json(res, 409, { error: `already locked; ${a.owner} owns it` })
        if (isAgent(who)) return json(res, 403, { error: 'agents do not own workspaces' })
        save(room, { owner: String(who).slice(0, 60), grants: [], requests: [], ts: now() }); audit(room, { by: who, action: 'lock' }); return json(res, 201, view(room, who))
      }
      if (!a) return json(res, 409, { error: 'this workspace is open; lock it first' })
      const isOwner = same(a.owner, who)
      if (m[2] === 'request') return ask(room, a, who, b, res)
      if (m[2] === 'answer') return answer(room, a, who, b, res)
      if (m[2] === 'agent-maker') {
        const agent = String(b.agent ?? '').trim()
        const maker = String(b.maker || who).trim().slice(0, 60)
        const vis = ['browser', 'windows-only', 'private'].includes(b.visibility) ? b.visibility : 'browser'
        if (!agent) return json(res, 400, { error: 'needs agent name' })
        const p = 'agent:' + (cleanPath(agent) ?? agent)
        const canManage = isOwner || rightsFor(a, who, '', now()).has('manage') || rightsFor(a, who, p, now()).has('maker')
        if (!canManage) return json(res, 403, { error: 'only owner, managers or current maker can set agent maker' })
        const rec = registerAgentMaker(room, agent, maker, { visibility: vis })
        return json(res, 200, { room, agent, ...rec })
      }
      if (m[2] === 'agent-control') {
        const agent = String(b.agent ?? '').trim()
        const action = String(b.action ?? '').trim().toLowerCase()
        if (!agent || !['pause', 'resume', 'stop', 'reassign'].includes(action)) return json(res, 400, { error: 'needs agent and action (pause, resume, stop, reassign)' })
        const p = 'agent:' + (cleanPath(agent) ?? agent)
        const canControl = isOwner || rightsFor(a, who, '', now()).has('manage') || rightsFor(a, who, p, now()).has('maker')
        if (!canControl) return json(res, 403, { error: 'only the agent maker or workspace manager can control this agent' })
        if (!a.agentMakers) a.agentMakers = {}
        if (!a.agentMakers[agent]) a.agentMakers[agent] = { maker: who, visibility: 'browser', ts: now() }
        const newStatus = action === 'pause' ? 'paused' : action === 'resume' ? 'running' : 'stopped'
        a.agentMakers[agent].status = newStatus
        a.agentMakers[agent].lastAction = action
        a.agentMakers[agent].lastActionBy = who
        a.agentMakers[agent].lastActionAt = now()
        save(room, a)
        audit(room, { by: who, action: 'agent-control', agent, controlAction: action, status: newStatus })
        return json(res, 200, { ok: true, agent, action, status: newStatus })
      }
      if (m[2] === 'unlock') { if (!isOwner) return json(res, 403, { error: 'only the owner can open the workspace again' }); save(room, null); audit(room, { by: who, action: 'unlock' }); return json(res, 200, view(room, who)) }
      const target = String(b.who ?? '').trim().slice(0, 60); const p = cleanPath(b.path)
      if (!target || p === null) return json(res, 400, { error: 'needs who (a name or "*") and a path inside the workspace ("" for all of it)' })
      if (!isOwner && !rightsFor(a, who, p, now()).has('manage')) return json(res, 403, { error: `only the owner${p ? ' or a manager of ' + p : ''} can change who has access ${p ? 'there' : 'to the whole workspace'}` })
      if (same(target, a.owner)) return json(res, 400, { error: 'the owner always has every right' })
      const sameRow = g => (g.who === '*' ? target === '*' : same(g.who, target)) && g.path === p
      if (!isOwner && a.grants.some(g => sameRow(g) && g.rights.includes('manage'))) return json(res, 403, { error: 'only the owner changes a manager\u2019s rights' })
      if (m[2] === 'grant') {
        const rights = Array.isArray(b.rights) ? [...new Set(b.rights)] : []
        if (!rights.length || rights.some(r => !RIGHTS.includes(r))) return json(res, 400, { error: `rights are some of ${RIGHTS.join(', ')}` })
        if (rights.includes('manage') && !isOwner) return json(res, 403, { error: 'only the owner gives manage' })
        if (rights.includes('manage') && (target === '*' || isAgent(target))) return json(res, 400, { error: target === '*' ? 'manage goes to a named person, not everyone' : 'agents do not manage access' })
        if (!isOwner) { const mine = rightsFor(a, who, p, now()); const missing = rights.filter(r => !mine.has(r)); if (missing.length) return json(res, 403, { error: `you can only give rights you have there yourself (not ${missing.join(', ')})` }) }
        const grants = a.grants.filter(g => !sameRow(g))
        grants.push({ who: target, path: p, rights: RIGHTS.filter(r => rights.includes(r)) })
        save(room, { ...a, grants, ts: now() }); audit(room, { by: who, action: 'grant', who: target, path: p, rights: RIGHTS.filter(r => rights.includes(r)) }); return json(res, 200, view(room, who))
      }
      save(room, { ...a, grants: a.grants.filter(g => !sameRow(g)), ts: now() }); audit(room, { by: who, action: 'revoke', who: target, path: p })
      return json(res, 200, view(room, who))
    })
    return true
  }

  // someone asks for rights on a path, with a reason; the card goes to the workspace chat
  function ask (room, a, who, b, res) {
    const p = cleanPath(b.path); const rights = Array.isArray(b.rights) ? RIGHTS.filter(r => b.rights.includes(r)) : []
    if (p === null || !rights.length) return json(res, 400, { error: 'needs a path inside the workspace and some of ' + RIGHTS.join(', ') })
    if (rights.includes('manage') && isAgent(who)) return json(res, 400, { error: 'agents do not manage access' })
    const have = rightsFor(a, who, p, now()); if (rights.every(r => have.has(r))) return json(res, 200, { already: true, view: mayJoin(a, who) ? view(room, who) : null })
    lapse(room, a)
    const reqs = a.requests || (a.requests = [])
    const open = reqs.find(r => r.status === 'pending' && same(r.who, who) && r.path === p)
    if (open) return json(res, 200, { request: open, note: 'you already asked; it is waiting' })
    if (reqs.filter(r => r.status === 'pending' && same(r.who, who)).length >= 3) return json(res, 429, { error: 'you have 3 requests waiting; wait for an answer first' })
    const no = reqs.find(r => r.status === 'denied' && same(r.who, who) && r.path === p && now() - (r.at || 0) < 10 * 60_000)
    if (no) return json(res, 429, { error: `${no.by} said no to this a few minutes ago; ask them in chat first` })
    const reason = String(b.reason ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, 300)
    const r = { id: now().toString(36) + Math.random().toString(36).slice(2, 7), who: String(who).slice(0, 60), agent: !!isAgent(who), path: p, rights: rights.filter(x => !have.has(x)), reason, ts: now(), status: 'pending' }
    reqs.push(r); if (reqs.length > 100) reqs.splice(0, reqs.length - 100)
    save(room, a); audit(room, { by: who, action: 'request', path: p, rights: r.rights, reason, id: r.id }); card(room, r)
    return json(res, 201, { request: r })
  }
  // the owner or a manager of that path answers; never the person who asked, never an agent; only rights the answerer holds there
  function answer (room, a, who, b, res) {
    lapse(room, a)
    const r = (a.requests || []).find(x => x.id === String(b.id ?? ''))
    if (!r) return json(res, 404, { error: 'no such request' })
    if (r.status !== 'pending') return json(res, 409, { error: r.status === 'expired' ? 'this request lapsed (a day without an answer)' : `already answered by ${r.by}` })
    if (isAgent(who)) return json(res, 403, { error: 'agents do not answer access requests; a person does' })
    if (same(r.who, who)) return json(res, 403, { error: 'you cannot answer your own request' })
    const isOwner = same(a.owner, who)
    if (!mayAnswer(a, who, r)) return json(res, 403, { error: `only the owner${r.path ? ' or a manager of ' + r.path : ''} can answer this` })
    if (b.approve === true) {
      const rights = Array.isArray(b.rights) ? r.rights.filter(x => b.rights.includes(x)) : r.rights
      if (!rights.length) return json(res, 400, { error: 'allow at least one of the rights asked for' })
      if (rights.includes('manage') && !isOwner) return json(res, 403, { error: 'only the owner gives manage' })
      if (!isOwner) { const mine = rightsFor(a, who, r.path, now()); const missing = rights.filter(x => !mine.has(x)); if (missing.length) return json(res, 403, { error: `you can only give rights you have there yourself (not ${missing.join(', ')})` }) }
      const span = Object.prototype.hasOwnProperty.call(FOR, b.for) ? FOR[b.for] : FOR['1h']
      const until = span ? now() + span : 0
      if (until) a.grants.push({ who: r.who, path: r.path, rights, until, by: String(who) })
      else { const g = a.grants.find(x => !x.until && same(x.who, r.who) && x.path === r.path); if (g) g.rights = RIGHTS.filter(x => g.rights.includes(x) || rights.includes(x)); else a.grants.push({ who: r.who, path: r.path, rights }) }
      a.grants = a.grants.filter(g => live(g, now())) // tidy: ended grants go
      Object.assign(r, { status: 'approved', by: String(who), at: now(), until, granted: rights })
    } else Object.assign(r, { status: 'denied', by: String(who), at: now() })
    save(room, a); audit(room, { by: who, action: r.status === 'approved' ? 'allow' : 'deny', who: r.who, path: r.path, rights: r.granted || r.rights, until: r.until || 0, id: r.id }); card(room, r)
    return json(res, 200, { request: r, view: view(room, who) })
  }

  // the HTTP features above: true when this answered (403), false to let the feature handle it (no rule, not signed in, open, allowed)
  function gate (req, res) {
    const u = new URL(req.url, 'http://x'); const need = routeNeed(req.method, u.pathname, u.search)
    if (!need) return false
    const h = req.headers.authorization || ''; let token = /^bearer /i.test(h) ? bearer(req) : ''
    if (!token && /^basic /i.test(h)) { try { token = Buffer.from(req.headers.authorization.slice(6), 'base64').toString().split(':').slice(1).join(':') } catch {} }
    const who = token ? identify(token) : null; if (!who) return false // the feature itself answers 401
    const a = aclOf(need.room); if (!a) return false
    if (mayJoin(a, who, now()) && rightsFor(a, who, need.path, now()).has(need.right)) return false
    log(`access: refused ${who} in ${need.room}: ${need.right} over HTTP ${u.pathname}`)
    json(res, 403, { error: `You don't have ${need.right} ${need.path ? 'in ' + need.path : 'on this workspace'}. Ask ${a.owner} or a manager (right-click in Files > Ask for access).` })
    return true
  }
  // may this person do this? For hooks in other modules (share.js: creating a link hands out access, so it needs manage)
  const allows = (room, who, right, p = '') => { const a = aclOf(room); return !a || (mayJoin(a, who, now()) && rightsFor(a, who, p, now()).has(right)) }

  // grants a company's rules give (server/lifecycle.js): tagged with their source, so the daily check replaces exactly those and never a
  // grant a person gave by hand. Only in workspaces that have an access list (an open workspace needs no grant). -> true when changed
  function setManaged (room, source, who, rows) {
    if (!roomOk(room)) return false
    const a = aclOf(room); if (!a) return false
    const keep = (a.grants || []).filter(g => !(g.source === source && same(g.who, who)))
    const add = (rows || []).map(r => ({ who, path: cleanPath(r.path) ?? '', rights: FILE_RIGHTS.filter(x => (r.rights || []).includes(x)), source })).filter(g => g.rights.length)
    const before = JSON.stringify((a.grants || []).filter(g => g.source === source && same(g.who, who)))
    if (before === JSON.stringify(add)) return false
    save(room, { ...a, grants: [...keep, ...add], ts: now() }); audit(room, { by: source, action: 'company-rules', who, rights: add.map(g => g.path + ':' + g.rights.join('+')) })
    return true
  }

  function registerAgentMaker (room, agent, makerWho, { visibility = 'browser' } = {}) {
    if (!roomOk(room)) return false
    let a = aclOf(room)
    if (!a) {
      a = { owner: String(makerWho).slice(0, 60), grants: [], requests: [], agentMakers: {}, ts: now() }
    }
    if (!a.agentMakers) a.agentMakers = {}
    a.agentMakers[agent] = {
      maker: String(makerWho).slice(0, 60),
      visibility: ['browser', 'windows-only', 'private'].includes(visibility) ? visibility : 'browser',
      status: 'running',
      updatedBy: String(makerWho).slice(0, 60),
      ts: now()
    }
    const p = 'agent:' + (cleanPath(agent) ?? agent)
    const hasMakerGrant = (a.grants || []).some(g => same(g.who, makerWho) && g.path === p && g.rights.includes('maker'))
    if (!hasMakerGrant && !same(a.owner, makerWho)) {
      a.grants = a.grants || []
      a.grants.push({ who: String(makerWho).slice(0, 60), path: p, rights: ['maker'] })
    }
    save(room, a)
    audit(room, { by: makerWho, action: 'agent-maker-register', agent, visibility })
    return a.agentMakers[agent]
  }

  return { http, guard, gate, allows, allow, mayJoin: (room, who) => mayJoin(aclOf(room), who), aclOf, refusals, setManaged, registerAgentMaker }
}
