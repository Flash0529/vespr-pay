// An agent's view of a VESPR room: it joins as an ordinary Yjs peer, so it has a name, a color and a cursor
// like any person, and everything it does goes through the same shared document everyone else edits.
//   files       Y.Map  path -> Y.Text
//   chat        Y.Array of Y.Map { id, ts, author, isAgent, role, model, text: Y.Text }   (shared, attributed, live)
//               a tool step also has { tool, status: running|done|failed, started, ended }      (the live activity log)
//   plans       Y.Map  agent name -> { items: [{ text, status: pending|in_progress|done }], updated }   (the checklist)
//   provenance  Y.Array of Y.Map { ts, file, by, model, msgId, summary }                   (who changed what, and why)
//   settings    Y.Map  agentMode (manual|acceptEdits|auto|plan|bypass), runner (which machine runs commands)
//   handled     Y.Map  chat message id -> agent name that took it ("claims": two agents don't answer the same message)
import { fileStore } from '../../app/file-store.js'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { cleanPlan } from './steps.js'
import fs from 'node:fs'
import { readerFor as makeReader } from './labels.js'
import { canDo } from '../../app/access-panel.js'

// person -> { level, scopes } from an operator-controlled JSON file ({ "Maya": { "level": "manager", "scopes": ["project:atlas"] }, "Dev": "member" }).
// Not the shared Yjs doc: every member can write that. No file = nobody has a level and everything stays open, as today.
export function levelsFrom (file) {
  let cache = { mtime: -1, data: {} }
  return person => {
    if (!file) return { level: null, scopes: [] }
    try { const st = fs.statSync(file); if (st.mtimeMs !== cache.mtime) cache = { mtime: st.mtimeMs, data: JSON.parse(fs.readFileSync(file, 'utf8')) || {} } } catch { cache = { mtime: -1, data: {} } }
    const v = Object.prototype.hasOwnProperty.call(cache.data, person) ? cache.data[person] : null
    const level = makeReader({ level: typeof v === 'string' ? v : v && v.level }).level
    return { level, scopes: v && Array.isArray(v.scopes) ? v.scopes.map(x => String(x).trim().toLowerCase()).filter(Boolean) : [] }
  }
}

export function joinRoom ({ server, room, token, name, color, model, fetchImpl = globalThis.fetch, onRefused = () => setTimeout(() => process.exit(3), 200) }) {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(server.replace(/\/$/, '') + '/ws', room, doc, { WebSocketPolyfill: WebSocket, params: { token }, disableBc: true })
  const files = fileStore(doc)
  const chat = doc.getArray('chat')
  const provenance = doc.getArray('provenance')
  const handled = doc.getMap('handled')
  const settings = doc.getMap('settings')
  const claims = doc.getMap('claims') // path -> { by, ai, since }: who is working on a file right now (soft locks, they expire)
  const usage = doc.getMap('usage') // who -> { calls, prompt, completion }: token meter per agent and per person
  const seen = doc.getMap('seen') // person -> last time they were connected (ms); lets the agent say what they missed
  const plans = doc.getMap('plans') // agent -> { items: [{ text, status }], updated }: the task list each agent shows as a checklist
  provider.awareness.setLocalStateField('user', { name, color, isAgent: true, model })
  // the server refused one of our changes (server/access.js, code 4409): our copy now holds a change the room never will, and every
  // reconnect would send it again. Stop and start fresh (the container restarts the worker).
  provider.on('connection-close', e => { if (e && e.code === 4409) { console.error(`agent ${name}: the server refused a change in ${room} (${e.reason || 'not allowed'}); restarting fresh`); provider.shouldConnect = false; onRefused() } })
  // what this agent may do here (server/access.js): loaded now, every 15 s and after an answer. null = open workspace or access off
  const httpBase = server.replace(/^ws/, 'http').replace(/\/$/, '')
  let acl = null
  const loadAccess = async () => { try { const r = await fetchImpl(`${httpBase}/api/access/${encodeURIComponent(room)}`, { headers: { Authorization: 'Bearer ' + token } }); acl = r.ok ? await r.json() : (r.status === 404 ? null : acl) } catch {} return acl }
  let accTimer = null
  if (fetchImpl) { accTimer = setInterval(loadAccess, 15_000); if (accTimer.unref) accTimer.unref() }
  const noRight = (right, p) => `You don't have ${right} on ${p || 'this workspace'} here${acl && acl.owner ? ` (${acl.owner} owns it)` : ''}. Call request_access with path, rights and a one-sentence reason; a person who manages that place decides. Meanwhile do what you can without it.`
  const ready = new Promise(resolve => provider.once('sync', resolve))
  // rights load as the room syncs, in parallel (not part of ready: messages present at ready count as history); a model turn takes longer
  const accessReady = fetchImpl ? loadAccess() : Promise.resolve(null)

  const personLevel = levelsFrom(process.env.VESPR_LEVELS_FILE || '')
  const api = {
    doc, provider, files, chat, provenance, handled, settings, seen, claims, usage, plans, ready, name, model, roomName: room,
    mode: () => settings.get('agentMode') || 'manual',
    may: (right, p = '') => canDo(acl, name, right, p),
    access: () => acl, refreshAccess: loadAccess, accessReady,
    whyNot: (right, p = '') => canDo(acl, name, right, p) ? null : noRight(right, p), // null when allowed
    // ask the people here for rights; the server posts the card, a manager answers it. Waits up to waitMs for the answer.
    async requestAccess ({ path: p = '', rights = [], reason = '' } = {}, waitMs = 10 * 60_000) {
      if (!fetchImpl) return { error: 'asking for access is not available here' }
      let r
      try { r = await fetchImpl(`${httpBase}/api/access/${encodeURIComponent(room)}/request`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p, rights, reason }) }) } catch (e) { return { error: 'could not reach the server: ' + e.message } }
      const j = await r.json().catch(() => ({}))
      if (r.status === 404) return { error: 'access control is off here: you may already do everything' }
      if (!r.ok) return { error: j.error || `HTTP ${r.status}` }
      if (j.already) { await loadAccess(); return { granted: true, note: 'you already have that' } }
      const id = 'access-' + j.request.id
      const state = () => { const m = chat.toArray().find(x => x.get('id') === id); return m ? { status: m.get('status'), by: m.get('decidedBy'), until: m.get('until'), granted: m.get('granted') } : null }
      const answer = await new Promise(resolve => {
        const check = () => { const s = state(); if (s && s.status && s.status !== 'pending') { done(s) } }
        const done = s => { clearTimeout(timer); chat.unobserveDeep(check); resolve(s) }
        const timer = setTimeout(() => done(null), waitMs)
        chat.observeDeep(check); check()
      })
      if (!answer) return { pending: true, requestId: j.request.id, hint: 'Nobody has answered yet. Say in chat what you are waiting for and continue with other work; the card stays until a person answers.' }
      if (answer.status !== 'approved') return { granted: false, by: answer.by, hint: answer.status === 'expired' ? 'The request lapsed.' : `${answer.by} said no. Do not ask again for the same thing; tell the person what you could not do and why.` }
      await loadAccess()
      return { granted: true, by: answer.by, rights: answer.granted, until: answer.until ? new Date(answer.until).toISOString() : 'always' }
    },
    // Ask the people here to approve a PayPal SANDBOX payment (server/pay.js). The agent can only ask: the server posts the card, a person answers it, only then does the
    // server make the PayPal order, and it is captured after the buyer pays on PayPal's sandbox page. Waits up to waitMs for the outcome (the request itself lives 15 minutes).
    async requestPayment ({ amount, currency = 'USD', label = '', reason = '' } = {}, waitMs = 10 * 60_000) {
      if (!fetchImpl) return { error: 'asking for a payment is not available here' }
      let r
      try { r = await fetchImpl(`${httpBase}/api/pay/${encodeURIComponent(room)}/request`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, currency, label, reason }) }) } catch (e) { return { error: 'could not reach the server: ' + e.message } }
      const j = await r.json().catch(() => ({}))
      if (r.status === 503) return { error: j.error || 'PayPal sandbox is not set up here', notSetUp: true, hint: 'Tell the person payments are not set up on this server; do not pretend one happened.' }
      if (!r.ok) return { error: j.error || `HTTP ${r.status}`, ...(j.code ? { code: j.code } : {}), hint: /^over_|^bad_|^needs_/.test(j.code || '') ? 'The server refused it. Tell the person why in one sentence; do not split it into smaller requests to get around a limit.' : undefined }
      const q = j.request; const id = 'pay-' + q.id; const money = `${q.currency === 'USD' ? '$' : q.currency + ' '}${q.value}`
      const state = () => { const m = chat.toArray().find(x => x.get('id') === id); return m ? { status: m.get('status'), by: m.get('decidedBy'), orderId: m.get('orderId'), captureId: m.get('captureId'), error: m.get('error') } : null }
      const DONE = ['captured', 'denied', 'expired', 'cancelled', 'failed', 'refused']
      const end = await new Promise(resolve => {
        const check = () => { const s = state(); if (s && DONE.includes(s.status)) done(s) }
        const done = s => { clearTimeout(timer); chat.unobserveDeep(check); resolve(s) }
        const timer = setTimeout(() => done(null), waitMs)
        chat.observeDeep(check); check()
      })
      const base = { requestId: q.id, amount: money, label: q.label }
      if (!end) { const s = state() || {}; return { ...base, pending: true, status: s.status || 'pending', ...(s.by ? { approvedBy: s.by } : {}), hint: s.status === 'awaiting_buyer' ? `${s.by} approved it; PayPal is waiting for the buyer to pay on the sandbox page. It is NOT paid yet: do not say it is.` : 'Nobody has answered yet. Say in chat what you are waiting for; the card stays until a person answers. It is NOT paid.' } }
      if (end.status === 'captured') return { ...base, status: 'captured', approvedBy: end.by, orderId: end.orderId, captureId: end.captureId, note: 'PayPal sandbox: test money, nothing real moved.' }
      if (end.status === 'denied') return { ...base, status: 'denied', by: end.by, hint: `${end.by} said no. Nothing was charged. Do not ask again for the same thing; tell the person what you could not pay for and why.` }
      return { ...base, status: end.status, ok: false, ...(end.by ? { by: end.by } : {}), ...(end.error ? { reason: end.error } : {}), hint: 'It did not go through and nothing was charged. Tell the person plainly; do not say it was paid.' }
    },
    // what this agent may read when it works for `person` (labels.js): never above that person, never above VESPR_AGENT_LEVEL
    readerFor (person) { const p = personLevel(person); return makeReader({ level: p.level, ceiling: process.env.VESPR_AGENT_LEVEL || null, scopes: p.scopes }) },
    outputLabel: null, // set per turn by respond(): stamped on every message and step the agent posts
    list: () => [...files.keys()].sort(),
    read: p => (files.get(p) ? files.get(p).toString() : null),

    // Soft locks so agents and people do not collide. A claim lasts 5 minutes for an agent, 60 s for a person typing.
    claimedByOther (p) { const c = claims.get(p); return c && c.by !== name && Date.now() - c.since < (c.ai ? 5 * 60_000 : 60_000) ? c : null },
    claim (p) { if (canDo(acl, name, 'edit', p)) claims.set(p, { by: name, ai: true, since: Date.now() }) }, // a claim needs edit there (access.js)
    releaseClaims () { for (const [p, c] of claims) if (c.by === name) claims.delete(p) },
    addUsage (key, { prompt = 0, completion = 0, estimated = false } = {}) { const u = usage.get(key) || { calls: 0, prompt: 0, completion: 0, est: 0 }; usage.set(key, { calls: u.calls + 1, prompt: u.prompt + prompt, completion: u.completion + completion, est: (u.est || 0) + (estimated ? 1 : 0) }) },  // est = how many of the calls had no provider-reported usage (counts were estimated)

    // Authorship carried by every insert (Yjs formatting attributes): who, which model, which chat message, when (minute).
    attrs: msgId => ({ by: name, ai: true, model, msg: msgId || '', t: Math.floor(Date.now() / 60000) }),

    // Replace one exact, unique snippet. Only the changed middle is touched, so other people's cursors keep their place.
    replace (p, oldText, newText, msgId) {
      const t = files.get(p)
      if (!t) return { error: `no such file: ${p}` }
      if (!canDo(acl, name, 'edit', p)) return { error: noRight('edit', p) }
      const text = t.toString()
      const i = text.indexOf(oldText)
      if (!oldText || i < 0) return { error: 'old text not found; read the file again and copy it exactly' }
      if (text.indexOf(oldText, i + 1) >= 0) return { error: 'old text appears more than once; include more surrounding lines to make it unique' }
      // touch only what really changes: keep the shared prefix and suffix of old and new text (authorship and other cursors stay put)
      let a = 0; while (a < oldText.length && a < newText.length && oldText[a] === newText[a]) a++
      let b = 0; while (b < oldText.length - a && b < newText.length - a && oldText[oldText.length - 1 - b] === newText[newText.length - 1 - b]) b++
      api._splice(t, p, i + a, oldText.length - a - b, newText.slice(a, newText.length - b), msgId, `edited ${p}`)
      return { ok: true, line: text.slice(0, i + a).split('\n').length }
    },
    // Create a file, or replace a whole file's content (applied as a minimal diff).
    write (p, content, msgId) {
      if (!/^[\w.\-/]+$/.test(p) || p.includes('..') || p.startsWith('/')) return { error: 'bad path' }
      const t = files.get(p)
      if (!canDo(acl, name, t ? 'edit' : 'make', p)) return { error: noRight(t ? 'edit' : 'make', p) }
      if (!t) {
        const nt = new Y.Text(); nt.insert(0, content, api.attrs(msgId)); files.set(p, nt)
        api._log(p, msgId, `created ${p}`); api._cursor(p, nt, 0, content.length)
        return { ok: true, created: true }
      }
      const old = t.toString()
      let a = 0; while (a < old.length && a < content.length && old[a] === content[a]) a++
      let b = 0; while (b < old.length - a && b < content.length - a && old[old.length - 1 - b] === content[content.length - 1 - b]) b++
      api._splice(t, p, a, old.length - a - b, content.slice(a, content.length - b), msgId, `rewrote ${p}`)
      return { ok: true }
    },
    // Delete a file or folder from the workspace.
    delete (p, msgId, recursive = false) {
      if (!/^[\w.\-/]+$/.test(p) || p.includes('..') || p.startsWith('/')) return { error: 'bad path' }
      const clean = p.replace(/^\/+/, '').replace(/\/+$/, '')
      const prefix = clean + '/'
      const matched = [...files.keys()].filter(k => k === clean || (recursive && k.startsWith(prefix)))
      if (!matched.length) return { error: `no such file or directory: ${p}` }
      const blocked = matched.find(f => !canDo(acl, name, 'delete', f)); if (blocked) return { error: noRight('delete', blocked) }
      doc.transact(() => {
        for (const f of matched) {
          files.delete(f)
          if (claims.has(f)) claims.delete(f)
        }
      }, 'agent')
      const cur = provider.awareness.getLocalState()?.cursor
      if (cur && matched.includes(cur.file)) provider.awareness.setLocalStateField('cursor', null)
      const summary = matched.length === 1 ? `deleted ${matched[0]}` : `deleted ${clean}/ (${matched.length} files)`
      api._log(clean, msgId, summary)
      return { ok: true, deleted: matched }
    },
    _splice (t, p, at, del, ins, msgId, summary) {
      doc.transact(() => { if (del) t.delete(at, del); if (ins) t.insert(at, ins, api.attrs(msgId)) }, 'agent')
      api._log(p, msgId, summary); api._cursor(p, t, at, at + ins.length)
    },
    _log (p, msgId, summary) {
      const m = new Y.Map()
      doc.transact(() => { m.set('ts', Date.now()); m.set('file', p); m.set('by', name); m.set('model', model); m.set('msgId', msgId || ''); m.set('summary', summary); provenance.push([m]) })
    },
    _cursor (p, t, from, to) {
      provider.awareness.setLocalStateField('cursor', { file: files.pathFor(t) || p, anchor: Y.createRelativePositionFromTypeIndex(t, from), head: Y.createRelativePositionFromTypeIndex(t, to) })
    },

    // Alive signal for managers (manager.js): this agent's awareness carries the time of its last beat and what it is doing.
    beat (state = 'idle') { const u = (provider.awareness.getLocalState() || {}).user || {}; provider.awareness.setLocalStateField('user', { ...u, beat: Date.now(), state }) },
    // A chat message whose text can be streamed into, so everyone watches the answer being written.
    say (text = '', role = 'agent', modelOverride) {
      const m = new Y.Map(); const tx = new Y.Text()
      doc.transact(() => {
        m.set('id', `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)
        m.set('ts', Date.now()); m.set('author', name); m.set('isAgent', true); m.set('role', role); m.set('model', modelOverride || model); m.set('text', tx); if (api.outputLabel) m.set('label', api.outputLabel)
        chat.push([m]); if (text) tx.insert(0, text)
      })
      return { id: m.get('id'), append: s => tx.insert(tx.length, s), text: () => tx.toString() }
    },
    // The out-of-usage notice. The card is for the person who ran out; it carries no amounts, since the chat is shared.
    limit (person, { title = '', detail = '', resets = 0 } = {}) {
      const m = new Y.Map(); const tx = new Y.Text()
      doc.transact(() => {
        m.set('id', `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)
        m.set('ts', Date.now()); m.set('author', name); m.set('isAgent', true); m.set('role', 'limit'); m.set('for', String(person || ''))
        m.set('title', String(title)); m.set('detail', String(detail)); if (resets) m.set('resets', Number(resets)); m.set('text', tx)
        chat.push([m]); tx.insert(0, `${title} · ${detail}`)
      })
      return m.get('id')
    },
    // One tool call as a live chat line: it appears when the call starts (status running, with the start time) and is finished
    // in place with the tool's note, so everyone sees what the agent is doing right now and how long each step took.
    startStep (tool, summary) {
      const m = new Y.Map(); const tx = new Y.Text(); const started = Date.now()
      doc.transact(() => {
        m.set('id', `${name}-step-${started.toString(36)}-${Math.random().toString(36).slice(2, 6)}`)
        m.set('ts', started); m.set('author', name); m.set('isAgent', true); m.set('role', 'tool'); m.set('model', model); if (api.outputLabel) m.set('label', api.outputLabel)
        m.set('tool', tool); m.set('status', 'running'); m.set('started', started); m.set('text', tx)
        chat.push([m]); tx.insert(0, summary)
      })
      return {
        id: m.get('id'),
        finish (note, ok = true) {
          doc.transact(() => {
            if (note) { tx.delete(0, tx.length); tx.insert(0, note) }
            m.set('status', ok ? 'done' : 'failed'); m.set('ended', Date.now())
          })
        }
      }
    },
    // The agent's task list, shown to everyone as a checklist with its reply (update_plan).
    setPlan (items) { const clean = cleanPlan(items); plans.set(name, { items: clean, updated: Date.now() }); return clean },
    // Ask the people in the room. Shows up in everyone's chat as an Approve / Deny card; the first person to answer decides.
    requestApproval ({ kind, summary, detail = '' }, timeoutMs = 5 * 60_000) {
      const m = new Y.Map(); const tx = new Y.Text()
      doc.transact(() => {
        m.set('id', `${name}-ask-${Date.now().toString(36)}`); m.set('ts', Date.now()); m.set('author', name); m.set('isAgent', true); m.set('role', 'approval')
        m.set('model', model); m.set('kind', kind); m.set('detail', detail); m.set('status', 'pending'); m.set('decidedBy', ''); m.set('text', tx)
        chat.push([m]); tx.insert(0, summary)
      })
      return new Promise(resolve => {
        const done = (approved, by) => { clearTimeout(timer); m.unobserve(onChange); resolve({ approved, by }) }
        const onChange = () => { const st = m.get('status'); if (st !== 'pending') done(st === 'approved', m.get('decidedBy')) }
        const timer = setTimeout(() => { doc.transact(() => { if (m.get('status') === 'pending') { m.set('status', 'expired'); m.set('decidedBy', 'timeout') } }); done(false, 'timeout') }, timeoutMs)
        m.observe(onChange)
      })
    },
    destroy: () => { clearInterval(accTimer); provider.destroy(); doc.destroy() }
  }
  return api
}
