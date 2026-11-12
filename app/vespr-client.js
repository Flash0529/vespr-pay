// VESPR client: the bridge between the app shell and the collab server.
// It joins a room as an ordinary Yjs peer (the same shared document the SDE extension and the agents use) and turns it into
// the plain objects the shell draws: people and agents, conversations, approvals, live edits with who made them, a History log, settings and usage.
// No framework, no build step. Yjs and y-websocket are passed in (deps) so the same file runs in the browser (an import map or a bundle) and in Node tests.
//
//   const c = createClient({ server: 'wss://host', room: 'demo', token, name: 'shamit', deps: { Y, WebsocketProvider, WebSocketPolyfill } })
//   await c.ready;  c.get()                      // snapshot: status, me, people, agents, messages, threads, approvals, files, mode, usage, plans
//   c.on('change', what => redraw())             // what: 'chat' | 'files' | 'presence' | 'settings' | 'usage' | 'status'
//   c.on('edit', e => ...)                       // { file, at, removed, added, by, ai, model, ts }: drives the red/green diff while an agent types
//   c.send(text, { thread, quote, attachments, contexts }) // a person's message; quote = { src, text, by } from "select text and ask"
//   c.decide(id, true)                           // the first answer to an approval card decides; everyone sees who
//   c.history()                                  // every action as one list (edits, runs, approvals, settings), same shape as the prototype's History
//
// Chat messages are Y.Maps: { id, ts, author, isAgent, role, model, text: Y.Text, thread?, quote?, contexts?, attachments? } plus, for role 'approval',
// { kind, detail, status, decidedBy }. `thread` and `quote` are the two fields added for conversations and select-to-ask.

import { fileStore } from './file-store.js'
import { paymentHistory } from './pay-card.js'

const THREAD_DEFAULT = 'main'
const MODES = ['manual', 'acceptEdits', 'auto', 'plan', 'bypass']

// Python errors in a run's output -> problems the shell can mark in the editor: { file, line, message }.
// A traceback (or a syntax error, which has the same "File ..., line N" shape) ends at its first unindented line, the error itself. The last frame in a file of this workspace is where it is shown.
export function parsePyProblems (out, inRoom = () => true, cwd = '') {
  const L = String(out || '').split('\n'); const found = []; const frame = /^\s*File "([^"]+)", line (\d+)/
  const norm = f => (cwd && f.startsWith(cwd + '/') ? f.slice(cwd.length + 1) : f.replace(/^.*\/murmio-sandbox\/[^/]+\//, '')).replace(/^\.\//, '')
  for (let i = 0; i < L.length; i++) {
    if (!/^Traceback \(most recent call last\):/.test(L[i]) && !frame.test(L[i])) continue
    const frames = []; let j = /^Traceback/.test(L[i]) ? i + 1 : i
    for (; j < L.length; j++) { const m = frame.exec(L[j]); if (m) { frames.push([norm(m[1]), +m[2]]); continue } if (/^\s/.test(L[j]) || L[j] === '') continue; break }
    const message = (L[j] || '').trim(); i = Math.max(i, j - 1)
    const mine = frames.filter(f => inRoom(f[0])); if (!message || !mine.length) continue
    const [file, line] = mine[mine.length - 1]; found.push({ file, line, message: message.slice(0, 300) })
  }
  return found
}

export async function loadDeps () { // browser/Node with an import map or node_modules: pass deps yourself when neither exists
  const Y = await import('yjs'); const { WebsocketProvider } = await import('y-websocket')
  return { Y, WebsocketProvider, WebSocketPolyfill: globalThis.WebSocket }
}

export function createClient ({ server, room, token, name, color = '#a5b4fc', deps, fetchImpl, onError = () => {}, httpBase: httpOverride }) {
  if (!server || !room || !token || !name) throw new Error('createClient needs server, room, token and name')
  const listeners = { change: new Set(), edit: new Set(), rename: new Set() }
  const emitNow = (type, arg) => { for (const f of listeners[type]) { try { f(arg) } catch (e) { onError(e) } } }
  let pending = new Set(); let scheduled = false
  const changed = what => { pending.add(what); if (scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; const all = [...pending]; pending = new Set(); for (const w of all) emitNow('change', w) }) }

  let Y, doc, provider, files, chat, provenance, settings, usage, claims, runs, plans
  let status = 'connecting'; let destroyed = false; let synced = false; let refused = ''; let endedWhy = ''
  const lastText = new Map() // path -> text before the latest change (a Y.Text delta has no deleted text, and the red line needs it)
  const httpBase = httpOverride ? String(httpOverride).replace(/\/$/, '') : server.replace(/^ws/, 'http').replace(/\/$/, '') // the desktop app passes its own origin

  const ready = (async () => {
    deps = deps || await loadDeps(); Y = deps.Y
    doc = new Y.Doc()
    provider = new deps.WebsocketProvider(server.replace(/\/$/, '') + '/ws', room, doc, { WebSocketPolyfill: deps.WebSocketPolyfill, params: { token }, disableBc: true })
    files = fileStore(doc); chat = doc.getArray('chat'); provenance = doc.getArray('provenance'); settings = doc.getMap('settings'); usage = doc.getMap('usage'); claims = doc.getMap('claims'); runs = doc.getArray('runs')
    plans = doc.getMap('plans') // agent -> { items: [{ text, status }], updated }: each agent's checklist (update_plan)
    provider.awareness.setLocalStateField('user', { name, color, isAgent: false })
    provider.on('status', e => { if (status !== 'refused' && status !== 'ended') { status = e.status; changed('status') } })
    // the server refused one of this peer's changes (no right to it, or not in its own name) and closed with 4409: stop reconnecting,
    // since resending would be refused again; the app reloads the workspace fresh (get().status === 'refused', get().refused says why)
    // a share link was turned off (4403) or ran out (4401), or the person was signed out (4401): reconnecting would only be refused again, so stop and say why (get().status === 'ended', get().endedWhy)
    provider.on('connection-close', ev => { if (ev && (ev.code === 4403 || ev.code === 4401)) { provider.shouldConnect = false; endedWhy = ev.code === 4403 ? 'revoked' : String(ev.reason || 'expired') === 'expired' ? 'expired' : 'signed-out'; status = 'ended'; changed('status') } })
    provider.on('connection-close', ev => { if (ev && ev.code === 4409) { provider.shouldConnect = false; refused = String(ev.reason || 'a change was not allowed'); status = 'refused'; changed('status') } })
    provider.awareness.on('change', () => changed('presence'))
    chat.observeDeep(() => changed('chat')); runs.observeDeep(() => changed('runs'))
    settings.observe(() => changed('settings')); usage.observe(() => changed('usage')); claims.observe(() => changed('files'))
    plans.observe(() => changed('chat')) // a checklist is drawn with the chat, so a plan change redraws it
    files.observe((ev, transaction) => { for (const [p, a] of ev.keys) if (a.action !== 'delete') watchFile(p, synced); else lastText.delete(p); if (ev.renamed.length) emitNow('rename', { moves: ev.renamed.map(r => [r.from, r.to]), local: !!transaction?.local }); changed('files') })
    for (const p of files.keys()) watchFile(p)
    await new Promise(resolve => provider.once('sync', resolve))
    synced = true; status = 'connected'; changed('status')
  })()

  // Every file is watched for changes so the shell can show them as they happen: what was removed, what was added, and who did it.
  const watched = new WeakSet()
  function watchFile (p, isNew = false) {
    const t = files.get(p); if (!t) return
    if (watched.has(t)) { lastText.set(p, t.toString()); return }
    watched.add(t); lastText.set(p, isNew ? '' : t.toString())
    if (isNew && t.length) { // a file that appears after we synced (an agent created it): everything in it is "added"
      const first = t.toDelta().find(op => op.attributes && op.attributes.by); const at = first ? first.attributes : null
      lastText.set(p, t.toString())
      emitNow('edit', { file: p, at: 0, removed: '', added: t.toString(), created: true, line: 1, by: at ? at.by : 'someone', ai: at ? !!at.ai : false, model: at ? at.model || '' : '', msg: at ? at.msg || '' : '', ts: Date.now() })
    }
    t.observe(ev => {
      p = files.pathFor(t); if (!p) return
      const before = lastText.get(p) ?? ''; const after = t.toString(); lastText.set(p, after)
      if (before === after) return
      let a = 0; while (a < before.length && a < after.length && before[a] === after[a]) a++
      let b = 0; while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++
      let attrs = null // who wrote the inserted part: the authorship attributes ride on every insert
      for (const op of ev.delta) if (op.insert !== undefined && op.attributes && op.attributes.by) { attrs = op.attributes; break }
      emitNow('edit', {
        file: p, at: a, removed: before.slice(a, before.length - b), added: after.slice(a, after.length - b),
        line: after.slice(0, a).split('\n').length,
        by: attrs ? attrs.by : (ev.transaction.local ? name : 'someone'), ai: attrs ? !!attrs.ai : false, model: attrs ? attrs.model || '' : '', msg: attrs ? attrs.msg || '' : '', ts: Date.now()
      })
      changed('files')
    })
  }

  const text = m => (m.get('text') ? m.get('text').toString() : '')
  const ms = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  // A tool step from a live agent also carries tool, status (running|done|failed), started and ended (ms); older entries get '' / null.
  const msgOf = m => ({
    id: m.get('id'), ts: m.get('ts'), author: m.get('author'), isAgent: !!m.get('isAgent'), role: m.get('role') || 'user', model: m.get('model') || '', text: text(m),
    thread: m.get('thread') || THREAD_DEFAULT, quote: m.get('quote') || null, attachments: m.get('attachments') || [],
    kind: m.get('kind') || '', detail: m.get('detail') || '', status: m.get('status') || '', decidedBy: m.get('decidedBy') || '',
    request: ['access', 'payment'].includes(m.get('role')) ? (m.get('request') || null) : null, until: Number(m.get('until')) || 0, granted: Array.isArray(m.get('granted')) ? m.get('granted') : [], // access request cards (server/access.js)
    tool: typeof m.get('tool') === 'string' ? m.get('tool') : '', started: ms(m.get('started')), ended: ms(m.get('ended')),
    pay: m.get('role') === 'payment' ? { orderId: m.get('orderId') || '', captureId: m.get('captureId') || '', refundId: m.get('refundId') || '', refundedBy: m.get('refundedBy') || '', error: m.get('error') || '', trail: Array.isArray(m.get('trail')) ? m.get('trail') : [], buyerDeadline: Number(m.get('buyerDeadline')) || 0 } : null // payment request cards (server/pay.js)
  })

  // Runs people asked for with Run (a file or the tests): the lead agent runs them and writes the output back into the entry.
  const runOf = m => ({ id: m.get('id'), ts: m.get('ts'), by: m.get('by'), kind: m.get('kind'), file: m.get('file') || '', cmd: m.get('cmd') || '', status: m.get('status'), out: m.get('out') || '', code: m.get('code') ?? null, started: m.get('started') || 0, ended: m.get('ended') || 0, runner: m.get('runner') || '', changed: m.get('changed') || [], cwd: m.get('cwd') || '' })
  const runList = () => (runs ? runs.toArray().map(runOf) : [])
  // what is wrong now: the problems in the newest finished run (a run that passed clears them)
  const problemsOf = list => { const done = list.filter(r => r.status === 'done'); const r = done[done.length - 1]; if (!r || r.code === 0) return []; return parsePyProblems(r.out, f => files.has(f), r.cwd).map(p => ({ ...p, run: r.id })) }

  // file operations for people (see createFile and friends in the api)
  const PATH_RE = /^[A-Za-z0-9._-]{1,120}(\/[A-Za-z0-9._-]{1,120}){0,11}$/
  const okPath = p => typeof p === 'string' && p.length <= 300 && PATH_RE.test(p) && !p.split('/').some(x => /^\.+$/.test(x) || x.endsWith('.')) && p.split('/')[0].toLowerCase() !== '.git'
  // Check the complete proposed tree before mutating anything. A path cannot be both a file and a folder.
  const checkTree = paths => {
    const names = new Set()
    for (const p of paths) { const key = p.toLowerCase(); if (names.has(key)) throw new Error('that name is taken: ' + p); names.add(key) }
    for (const p of paths) {
      const parts = p.toLowerCase().split('/')
      for (let i = 1; i < parts.length; i++) if (names.has(parts.slice(0, i).join('/'))) throw new Error('a file cannot hold another file: ' + p)
    }
  }
  const heldByOther = p => { const c = claims.get(p); return c && c.by && c.by !== name && !(c.since && Date.now() - c.since > 120000) ? c.by : '' } // a lock older than two minutes is stale
  const logFile = (p, summary) => { const m = new Y.Map(); m.set('ts', Date.now()); m.set('file', p); m.set('by', name); m.set('model', ''); m.set('msgId', ''); m.set('summary', summary); provenance.push([m]) }
  const fileOps = {
    create (p, marker) {
      if (!okPath(p)) throw new Error('that is not a usable file name')
      if (!marker && p.split('/').pop().toLowerCase() === '.keep') throw new Error('.keep is reserved for empty folders')
      checkTree([...files.keys(), p])
      doc.transact(() => { files.set(p, new Y.Text()); if (!marker) logFile(p, `created ${p}`); else logFile(p.replace(/\/\.keep$/, ''), `created folder ${p.replace(/\/\.keep$/, '')}/`) })
      return p
    },
    rename (moves) {
      if (!Array.isArray(moves) || !moves.length || moves.length > 500) throw new Error('nothing to rename, or too many files at once')
      const sources = new Set()
      for (const move of moves) {
        if (!Array.isArray(move) || move.length !== 2) throw new Error('each rename needs a source and destination')
        const [from, to] = move
        if (!okPath(to) || typeof from !== 'string' || !files.has(from)) throw new Error('cannot rename ' + String(from).slice(0, 60))
        if (sources.has(from)) throw new Error('cannot rename one file twice: ' + from)
        sources.add(from)
        const h = heldByOther(from); if (h) throw new Error(`${h} is editing ${from}`)
      }
      checkTree([...files.keys()].filter(p => !sources.has(p)).concat(moves.map(m => m[1])))
      doc.transact(() => {
        files.rename(moves) // Only filenames change; shared text identity and offline edits survive.
        const first = moves[0]; logFile(first[1], moves.length === 1 ? `renamed ${first[0]} to ${first[1]}` : `renamed ${moves.length} files (${first[0].split('/')[0]}/ and below)`)
      })
      return moves.length
    },
    remove (paths) {
      if (!Array.isArray(paths) || !paths.length || paths.length > 500) throw new Error('nothing to delete, or too many files at once')
      for (const p of paths) { if (typeof p !== 'string' || !files.has(p)) throw new Error('no such file: ' + String(p).slice(0, 60)); const h = heldByOther(p); if (h) throw new Error(`${h} is editing ${p}`) }
      doc.transact(() => { for (const p of paths) { files.delete(p); if (claims.has(p)) claims.delete(p) } logFile(paths[0], paths.length === 1 ? `deleted ${paths[0]}` : `deleted ${paths.length} files (${paths[0].split('/')[0]}/ and below)`) })
      return paths.length
    }
  }

  const cursorFile = cursor => {
    if (!cursor) return ''
    if (cursor.head) try {
      const pos = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(cursor.head), doc)
      const path = pos && files.pathFor(pos.type); if (path) return path
    } catch {}
    return files.has(cursor.file) ? cursor.file : ''
  }
  const api = {
    ready, name, on (type, fn) { listeners[type].add(fn); return () => listeners[type].delete(fn) },
    get doc () { return doc }, get provider () { return provider }, get files () { return files },
    fileText (path) { return files.get(path) },

    // One plain snapshot for the shell to draw. Cheap enough to call on every 'change'.
    get () {
      if (!doc) return { status, me: { name, color }, people: [], agents: [], messages: [], threads: [], approvals: { pending: [], all: [] }, files: [], fileConflicts: [], mode: 'manual', runner: '', usage: {}, plans: {}, runs: [], runsEnabled: false, problems: [] }
      const states = [...provider.awareness.getStates()].filter(([id, s]) => s.user)
      const people = states.map(([id, s]) => ({ id, name: s.user.name, color: s.user.color, isAgent: !!s.user.isAgent, model: s.user.model || '', file: cursorFile(s.cursor), me: id === doc.clientID }))
      const messages = chat.toArray().map(msgOf)
      const byThread = new Map()
      for (const m of messages) { if (m.role === 'tool' && !m.text) continue; const t = byThread.get(m.thread) || { id: m.thread, last: 0, count: 0, agents: new Set(), people: new Set(), pending: 0 }; t.last = m.ts; t.count++; (m.isAgent ? t.agents : t.people).add(m.author); if (m.role === 'approval' && m.status === 'pending') t.pending++; byThread.set(m.thread, t) }
      const approvals = messages.filter(m => m.role === 'approval')
      return {
        status, refused, endedWhy, me: { name, color }, people, agents: people.filter(p => p.isAgent), messages,
        threads: [...byThread.values()].map(t => ({ ...t, agents: [...t.agents], people: [...t.people] })).sort((a, b) => b.last - a.last),
        approvals: { pending: approvals.filter(m => m.status === 'pending'), all: approvals },
        files: [...files.keys()].sort(), fileConflicts: files.conflicts(), claims: Object.fromEntries(claims.entries()),
        mode: settings.get('agentMode') || 'manual', runner: settings.get('runner') || '', usage: Object.fromEntries(usage.entries()), plans: Object.fromEntries(plans.entries()),
        runs: runList(), runsEnabled: settings.get('runs') === 'on', problems: problemsOf(runList()),
        github: settings.get('github') || null, githubImport: settings.get('githubImport') === 'on', pr: settings.get('pr') || null, prEnabled: settings.get('githubPr') === 'on',
        focus: settings.get('focus') ?? null, packs: settings.get('packsApplied') || null, packsCatalog: settings.get('packsCatalog') || []
      }
    },
    read: p => (files.get(p) ? files.get(p).toString() : null),

    // Run a Python file ('file') or the unit tests ('tests') in the workspace's runner. Everyone sees the output. Returns the run's id.
    run (kind, file = '') {
      if (kind !== 'file' && kind !== 'tests') throw new Error('kind must be file or tests')
      const m = new Y.Map(); const id = `run-${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      doc.transact(() => { m.set('id', id); m.set('ts', Date.now()); m.set('by', name); m.set('kind', kind); m.set('file', String(file || '').slice(0, 160)); m.set('status', 'requested'); m.set('out', ''); runs.push([m]) })
      return id
    },

    // A person's message. `quote` is what they selected ({ src, text, by }); the agent reads it with the file, the lines and who changed them.
    send (body, { thread = THREAD_DEFAULT, quote, attachments, contexts, model, sandboxSafe, workspace, room } = {}) {
      body = String(body || '').trim(); if (!body) return null
      const m = new Y.Map(); const tx = new Y.Text(); const id = `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      doc.transact(() => {
        m.set('id', id); m.set('ts', Date.now()); m.set('author', name); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx)
        if (thread !== THREAD_DEFAULT) m.set('thread', String(thread).slice(0, 64))
        if (model) m.set('model', String(model).slice(0, 64))
        if (typeof sandboxSafe === 'boolean') m.set('sandboxSafe', sandboxSafe)
        if (workspace) m.set('workspace', String(workspace).slice(0, 80))
        if (room) m.set('room', String(room).slice(0, 80))
        if (quote) m.set('quote', { src: String(quote.src || '').slice(0, 120), text: String(quote.text || '').slice(0, 2000), by: String(quote.by || '').slice(0, 60) })
        if (contexts && contexts.length) { // what they highlighted or pasted from inside the app, with where it came from (the agent reads these as data)
          const cl = x => String(x == null ? '' : x)
          const list = contexts.slice(0, 5).map(c => c && c.text && String(c.text).trim() ? { kind: ['code', 'chat', 'terminal', 'history', 'text'].includes(c.kind) ? c.kind : 'text', src: cl(c.src).slice(0, 120), file: cl(c.file).slice(0, 200), lines: Array.isArray(c.lines) && +c.lines[0] > 0 ? [Math.floor(+c.lines[0]), Math.max(Math.floor(+c.lines[0]), Math.floor(+c.lines[1] || +c.lines[0]))] : null, by: cl(c.by).slice(0, 60), author: cl(c.author).slice(0, 60), thread: cl(c.thread).slice(0, 64), ts: Math.floor(+c.ts) > 0 ? Math.floor(+c.ts) : 0, text: cl(c.text).slice(0, 2000), before: cl(c.before).slice(0, 600), after: cl(c.after).slice(0, 600) } : null).filter(Boolean)
          if (list.length) m.set('contexts', list)
        }
        if (attachments && attachments.length) m.set('attachments', attachments.slice(0, 20).map(a => ({ name: String(a.name).slice(0, 120), size: Number(a.size) || 0, type: String(a.type || '').slice(0, 80), id: /^[0-9a-f]{16}$/.test(a.id || '') ? a.id : '', sha256: /^[0-9a-f]{64}$/.test(a.sha256 || '') ? a.sha256 : '' })))
        chat.push([m]); tx.insert(0, body)
      })
      return id
    },
    // The first person to answer decides; a later click does nothing.
    decide (id, ok) {
      const m = chat.toArray().find(x => x.get('id') === id)
      if (!m || m.get('role') !== 'approval' || m.get('status') !== 'pending') return false
      doc.transact(() => { m.set('status', ok ? 'approved' : 'denied'); m.set('decidedBy', name) })
      return true
    },
    setMode (mode) {
      if (!MODES.includes(mode)) throw new Error('unknown mode ' + mode)
      doc.transact(() => { settings.set('agentMode', mode); note(`set the agent mode to ${mode}`) })
    },
    // Open a GitHub repository in the workspace: `input` is owner/repo or a link (a branch or folder link works). The agent pins it to a commit and adds the files; it answers in chat.
    importRepo (input) {
      input = String(input || '').trim().slice(0, 300); if (!input) throw new Error('give a repository: owner/repo or a link')
      const id = `i-${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      doc.transact(() => settings.set('importRequest', { id, url: input, by: name, ts: Date.now() }))
      return id
    },
    // Send the workspace's changes back to the repository it was opened from as a pull request (needs get().github and get().prEnabled). Optional `title` and `body` replace the drafted ones.
    // The agent drafts the rest from the chat and the History, asks the room with ONE approval card (files, new branch, title, description) and sends nothing before it is approved; progress is get().pr.
    openPullRequest ({ title = '', body = '' } = {}) {
      const id = `p-${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 120); const b = String(body || '').trim().slice(0, 4000)
      doc.transact(() => settings.set('prRequest', { id, by: name, ts: Date.now(), ...(t ? { title: t } : {}), ...(b ? { body: b } : {}) }))
      return id
    },
    // The first-run question: what is this workspace for? ids come from get().packsCatalog (vibe, web, design, backend, data, docs; [] = nothing). The agent adds the matching skills.
    // `other` is "something else" in the person's own words (one line, 200 characters at most): the agent searches GitHub for skills that fit it and asks the room before it installs any.
    setFocus (ids, opts) {
      ids = [...new Set((Array.isArray(ids) ? ids : []).map(x => String(x).slice(0, 24)))].slice(0, 12)
      const other = String((opts && opts.other) == null ? '' : opts.other).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200).trim()
      const id = `f-${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      doc.transact(() => { settings.set('focus', ids); if (ids.length || other) settings.set('packsRequest', { id, focus: ids, ...(other ? { other } : {}), by: name, ts: Date.now() }) }) // [] with no text only records the answer: nothing to install
      return id
    },
    // Files, by a person (the explorer). app/pathops.js decides what is allowed; these apply it, and check the names again so a bad path never reaches the shared document.
    // Each change is one transaction and one line in History ("created", "renamed", "deleted"). A file an agent holds (a soft lock) is not moved or deleted from under it.
    createFile (path) { return fileOps.create(path, false) },
    createFolder (path) { return fileOps.create(path.replace(/\/+$/, '') + '/.keep', true) },
    renamePaths (moves) { return fileOps.rename(moves) },
    deletePaths (paths) { return fileOps.remove(paths) },
    setRunner (id, label = '') { doc.transact(() => { settings.set('runner', id || ''); note(`set commands to run on ${label || id || 'the sandbox'}`) }) },
    // Where the person is looking (so others see their cursor file); the editor itself is the SDE's job.
    setPresence (fields) { provider.awareness.setLocalStateField('cursor', fields && fields.file ? { file: fields.file } : null) },

    // Files too big or too binary for the shared text document (decks, sheets, PDFs, pictures, audio, video, 3D): uploaded over HTTP with the same token.
    // `file` is a browser File/Blob, or { name, type, bytes } with a Uint8Array/Buffer. Returns { id, name, size, type, sha256 } to put in send(..., { attachments: [meta] }).
    async upload (file) {
      const f = fetchImpl || globalThis.fetch; const body = file.arrayBuffer ? await file.arrayBuffer() : file.bytes
      if (!body || !body.byteLength) throw new Error('that file is empty')
      const res = await f(`${httpBase}/api/upload/${encodeURIComponent(room)}?name=${encodeURIComponent(file.name || 'file')}`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': file.type || 'application/octet-stream' }, body })
      if (res.status === 413) throw new Error('That file is larger than the upload limit.')
      if (res.status === 507) throw new Error('This workspace has reached its upload limit.')
      if (!res.ok) throw new Error('upload failed: HTTP ' + res.status)
      const m = await res.json(); return { id: m.id, name: m.name, size: m.size, type: m.type, sha256: m.sha256 }
    },
    async uploads () { const f = fetchImpl || globalThis.fetch; const res = await f(`${httpBase}/api/upload/${encodeURIComponent(room)}`, { headers: { Authorization: 'Bearer ' + token } }); if (!res.ok) throw new Error('uploads: HTTP ' + res.status); return res.json() },
    // The bytes of an uploaded file (for the 3D viewer, a preview, a download button).
    async download (id) { const f = fetchImpl || globalThis.fetch; const res = await f(`${httpBase}/api/upload/${encodeURIComponent(room)}/${encodeURIComponent(id)}`, { headers: { Authorization: 'Bearer ' + token } }); if (!res.ok) throw new Error('download: HTTP ' + res.status); return res.arrayBuffer() },

    // Snapshot links (the server must have VESPR_SNAPSHOT=1; otherwise every call fails with status 404): a read-only COPY of one file or of the project at a long random address.
    //   snapshot.create({ file?, title?, days? }) -> { id, kind, title, url, expires, files, skipped }   (the url is shown once: only a hash is kept)   snapshot.list() -> [{ id, kind, file, title, by, ts, expires, views, files }]   snapshot.revoke(id)
    snapshot: {
      async create ({ file, title, days } = {}) {
        const f = fetchImpl || globalThis.fetch; const res = await f(`${httpBase}/api/snapshot/${encodeURIComponent(room)}`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ file, title, days }) })
        const j = await res.json().catch(() => ({})); if (!res.ok) { const e = new Error(j.error || 'snapshot: HTTP ' + res.status); e.status = res.status; throw e }
        return { ...j, url: httpBase + j.path }
      },
      async list () { const f = fetchImpl || globalThis.fetch; const res = await f(`${httpBase}/api/snapshot/${encodeURIComponent(room)}`, { headers: { Authorization: 'Bearer ' + token } }); if (!res.ok) { const e = new Error('snapshot: HTTP ' + res.status); e.status = res.status; throw e } return res.json() },
      async revoke (id) { const f = fetchImpl || globalThis.fetch; const res = await f(`${httpBase}/api/snapshot/${encodeURIComponent(room)}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }); if (!res.ok) { const e = new Error('snapshot: HTTP ' + res.status); e.status = res.status; throw e } return true }
    },

    // Tell YOUR SDE (the one signed in as the same person) what to show: { type: 'open', file, line? } or { type: 'follow', agent } or { type: 'unfollow' }.
    // It goes through the shared document; the SDE extension checks it (own commands only, real files, agents that are here) and can only open or follow, never run anything.
    command (cmd) {
      if (!cmd || !['open', 'follow', 'unfollow'].includes(cmd.type)) throw new Error('unknown command type')
      if (cmd.type === 'open' && (typeof cmd.file !== 'string' || !cmd.file)) throw new Error('open needs a file')
      if (cmd.type === 'follow' && (typeof cmd.agent !== 'string' || !cmd.agent)) throw new Error('follow needs an agent')
      const ui = doc.getArray('ui'); const id = `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const e = { id, ts: Date.now(), by: name, type: cmd.type }
      if (cmd.type === 'open') { e.file = cmd.file.slice(0, 300); if (Number.isInteger(cmd.line)) e.line = cmd.line }
      if (cmd.type === 'follow') e.agent = cmd.agent.slice(0, 60)
      doc.transact(() => { ui.push([e]); if (ui.length > 50) ui.delete(0, ui.length - 50) }) // a short log: old commands are history
      return id
    },

    // Machines connected to run commands (HTTP, same token).
    async runners () {
      const f = fetchImpl || globalThis.fetch; const res = await f(httpBase + '/api/runners', { headers: { Authorization: 'Bearer ' + token } })
      if (!res.ok) throw new Error('runners: HTTP ' + res.status)
      return res.json()
    },

    // Everything that was done, newest first, in one shape: { id, ts, who, kind: person|agent|system, model, type: edit|run|approval|access, verb, target, detail, file, plus, minus, extra }.
    // Built from the shared document, so it needs no extra storage; a manager view adds retention and role checks on the server (not here).
    history () {
      const out = []
      for (const p of provenance.toArray()) {
        const summary = p.get('summary') || ''; const file = p.get('file') || ''
        out.push({ id: 'p-' + p.get('ts') + '-' + file, ts: p.get('ts'), who: p.get('by'), kind: p.get('model') ? 'agent' : 'person', model: p.get('model') || '', type: 'edit', verb: summary.split(' ')[0] || 'edited', target: file, detail: summary, file, plus: 0, minus: 0, extra: { why: p.get('msgId') ? 'In reply to chat message ' + p.get('msgId') : '' } })
      }
      for (const m of chat.toArray().map(msgOf)) {
        if (m.role === 'payment' && m.request) { for (const row of paymentHistory(m)) out.push(row); continue } // one row per state change: who asked, who approved, what PayPal did (server/pay.js)
        if (m.role === 'approval' && m.status && m.status !== 'pending') out.push({ id: 'a-' + m.id, ts: m.ts, who: m.decidedBy || 'timeout', kind: m.decidedBy && m.decidedBy !== 'timeout' ? 'person' : 'system', model: '', type: m.kind === 'skill' ? 'access' : 'approval', verb: m.status === 'approved' ? 'approved' : m.status === 'denied' ? 'denied' : 'let expire', target: `${m.author}: ${m.text}`.slice(0, 160), detail: m.kind === 'command' ? 'Command' : m.kind === 'skill' ? 'Skill install' : 'Edit', file: '', plus: 0, minus: 0, extra: { why: m.detail.slice(0, 600) } })
        else if (m.role === 'tool' && /^\$ /.test(m.text)) {
          const took = m.started != null && m.ended != null ? ` · ${Math.max(0, Math.round((m.ended - m.started) / 100) / 10)}s` : '' // live agent steps carry their times
          out.push({ id: 'r-' + m.id, ts: m.ts, who: m.author, kind: m.isAgent ? 'agent' : 'person', model: m.model, type: 'run', verb: 'ran', target: m.text.split('\n')[0].slice(2), detail: ((/\[exit (\d+)\]/.exec(m.text) || [])[0] || '') + took, file: '', plus: 0, minus: 0, extra: { out: m.text } })
        }
        else if (m.role === 'tool' && /^set (the agent mode|commands to run)/.test(m.text)) out.push({ id: 's-' + m.id, ts: m.ts, who: m.author, kind: 'person', model: '', type: 'access', verb: 'changed', target: m.text, detail: 'Workspace setting', file: '', plus: 0, minus: 0, extra: {} })
      }
      for (const r of runList()) if (r.status === 'done' || r.status === 'denied') out.push({ id: 'u-' + r.id, ts: r.ended || r.ts, who: r.by, kind: 'person', model: '', type: 'run', verb: 'ran', target: r.cmd || (r.kind === 'tests' ? 'the tests' : r.file), detail: r.status === 'denied' ? 'not run' : `exit ${r.code} · ${Math.max(0, Math.round(((r.ended || 0) - (r.started || 0)) / 100) / 10)}s · ${r.runner || 'sandbox'}`, file: '', plus: 0, minus: 0, extra: { out: r.out } })
      return out.sort((a, b) => b.ts - a.ts)
    },
    destroy () { if (destroyed) return; destroyed = true; try { provider.destroy() } catch {} try { doc.destroy() } catch {} listeners.change.clear(); listeners.edit.clear(); listeners.rename.clear() }
  }
  // a line in the chat for a setting change, so the room (and History) see who changed it
  function note (txt) {
    const m = new Y.Map(); const tx = new Y.Text()
    m.set('id', `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`); m.set('ts', Date.now()); m.set('author', name); m.set('isAgent', false); m.set('role', 'tool'); m.set('text', tx)
    chat.push([m]); tx.insert(0, txt)
  }
  return api
}
