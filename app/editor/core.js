// The Yjs side of the SDE's own editor: no DOM and no CodeMirror in here, so Node tests can drive it with a fake editor.
// Contract: docs/EDITOR.md. The caller injects the Yjs namespace as `Y` (the app's import map name `yjs`), so two copies never exist.
//
// Positions are UTF-16 code units everywhere: that is what Y.Text counts and what CodeMirror counts, so a change can cross
// between the two without conversion. (A change must not split a surrogate pair, for example half an emoji: Yjs cannot split
// one and turns both halves into U+FFFD. CodeMirror never splits one when editing by character.)

const minute = () => Math.floor(Date.now() / 60000)

// Authorship rides on every insert as Yjs formatting attributes, exactly as the VS Code extension and the agents write it
// (extensions/murmio-collab, agents/src/room.js). A FRESH object each time: Y.Text.insert writes into the attributes it is given.
// Passing attributes explicitly also matters: without them an insert inherits the formatting around it, so a person typing next
// to an agent's text would be recorded as the agent. With them Yjs negates every attribute that is not listed.
function authorship (user) {
  const attrs = { by: user.name, t: minute() }
  if (user.ai) { attrs.ai = true; attrs.model = user.model || '' }
  return attrs
}

// Yjs writes strings as UTF-8, so a LONE surrogate (half an emoji with no partner) cannot cross the network: the sender would keep it
// and every other peer would read U+FFFD. Typing and pasting never produce one, but a broken clipboard can. This is the one place
// that decides what such text becomes, and the adapter applies it to the editor too, so editor and shared text always agree.
const LONE = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g
export function sanitizeInsert (text) {
  return /[\uD800-\uDFFF]/.test(text) ? text.replace(LONE, m => (m.length === 2 ? m : '\uFFFD')) : text
}

// A Y.Text delta ([{ retain }, { insert }, { delete }], relative to the text BEFORE the transaction) -> [{ from, to, insert }]
// in the coordinates of that old text: sorted, non-overlapping, and a delete next to an insert becomes one replacement.
// Attribute-only retains (somebody's formatting changed, the text did not) move the cursor along and produce nothing.
// Embeds and nested types are not text; plain text files never contain them, so they are skipped.
export function deltaToChanges (delta) {
  const changes = []
  let pos = 0 // position in the OLD text
  let last = null // the change that ends exactly at `pos`, if any, so that an insert and a delete at one spot merge
  for (const op of delta || []) {
    if (op.retain != null) {
      if (op.retain > 0) { pos += op.retain; last = null }
    } else if (typeof op.insert === 'string') {
      if (!op.insert) continue
      if (last && last.to === pos) last.insert += op.insert
      else changes.push(last = { from: pos, to: pos, insert: op.insert })
    } else if (op.delete != null && op.delete > 0) {
      if (last && last.to === pos) last.to += op.delete
      else changes.push(last = { from: pos, to: pos + op.delete, insert: '' })
      pos += op.delete
    }
  }
  return changes
}

// Sorted copy, empty changes dropped, and a RangeError for anything that cannot be a valid set of changes against `length`.
// Failing loudly beats half-applying: a silently clamped change would leave the editor and the shared text different.
function checkChanges (changes, length) {
  const list = []
  for (const c of changes || []) {
    const from = c.from; const to = c.to == null ? c.from : c.to; const insert = c.insert == null ? '' : String(c.insert)
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > length) throw new RangeError(`change ${from}..${to} is outside the text (length ${length})`)
    if (to > from || insert) list.push({ from, to, insert })
  }
  list.sort((a, b) => a.from - b.from || a.to - b.to) // stable: two inserts at one spot keep their order
  for (let i = 1; i < list.length; i++) if (list[i].from < list[i - 1].to) throw new RangeError(`changes overlap at ${list[i].from}`)
  const out = [] // changes that touch (one ends where the next begins) are one replacement: same text, fewer operations
  for (const c of list) { const last = out[out.length - 1]; if (last && last.to === c.from) { last.to = c.to; last.insert += c.insert } else out.push(c) }
  return out
}

// Apply [{ from, to, insert }] (coordinates of `text`, as CodeMirror's ChangeSet gives them) to a plain string.
export function changesToText (text, changes) {
  let out = ''; let at = 0
  for (const c of checkChanges(changes, text.length)) { out += text.slice(at, c.from) + c.insert; at = c.to }
  return out + text.slice(at)
}

// ── who wrote what: the data behind the hover tooltip (pure, no DOM) ─────────────────────────────────────────────────────────────
const tidy = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const sameAuthor = (a, b) => a.by === b.by && !!a.ai === !!b.ai && a.model === b.model && a.msg === b.msg // the minute may differ

// minutes since the epoch (attrs.t) -> "HH:MM", local time unless utc is true; '' when there is no time
export function formatMinute (t, utc = false) {
  if (!Number.isFinite(t) || t <= 0) return ''
  const d = new Date(t * 60000); const p = n => String(n).padStart(2, '0')
  return utc ? `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : `${p(d.getHours())}:${p(d.getMinutes())}`
}

// The run of text around `index` that one author wrote (same by, ai, model and msg; the minute may differ): { from, to, attrs } where attrs
// are those of the exact character, or null when index is outside the text.
export function spanAt (ytext, index) {
  const runs = []; let pos = 0; let hit = null
  for (const op of ytext.toDelta()) {
    if (typeof op.insert !== 'string') continue
    const attrs = op.attributes || {}; const len = op.insert.length; const last = runs[runs.length - 1]
    if (last && sameAuthor(last.attrs, attrs)) last.to = pos + len; else runs.push({ from: pos, to: pos + len, attrs })
    if (index >= pos && index < pos + len) hit = { run: runs[runs.length - 1], attrs }
    pos += len
  }
  return hit ? { from: hit.run.from, to: hit.run.to, attrs: hit.attrs } : null
}

// attrs -> what the tooltip says, or null when nobody is recorded. resolver(attrs) -> { request?: string } is optional: the shell looks up
// the chat message (attrs.msg) that caused an agent's edit. Without it (or when it finds nothing) the request is just left out.
export function describeSpan (attrs, resolver, opts = {}) {
  if (!attrs || !attrs.by) return null
  if (attrs.by === 'import') return { imported: true, author: 'import', agent: false, model: '', time: '', request: '', text: 'Imported with the project (no author recorded)' }
  const author = tidy(attrs.by, 40) || 'someone'; const agent = !!attrs.ai; const model = tidy(attrs.model, 40); const time = formatMinute(attrs.t, !!opts.utc)
  let request = ''
  if (resolver) { try { const r = resolver(attrs); request = tidy(r && typeof r === 'object' ? r.request : r, 200) } catch { /* the shell could not resolve it: show what we have */ } }
  return { imported: false, author, agent, model, time, request, text: [author + (agent ? ' (agent)' : ''), model, time, request && 'asked: ' + request].filter(Boolean).join(' · ') }
}

// heal: after another peer deletes text, re-apply your authorship to your own characters that lost their markers (see heal() below); false = only when heal() is called.
export function createBinding ({ Y, ytext, user, origin = Symbol('vespr-editor'), heal: autoHeal = true }) {
  if (!Y || !ytext) throw new Error('createBinding needs Y and ytext')
  if (!user || !user.name) throw new Error('createBinding needs user.name')
  const doc = ytext.doc
  if (!doc) throw new Error('ytext must belong to a Y.Doc')

  const listeners = new Set()
  // Typing is never blocked by this: it only reports what other transactions did (remote peers, agents, and our own undo and redo).
  const undoManager = new Y.UndoManager(ytext, { trackedOrigins: new Set([origin]), captureTimeout: 500 })
  const healOrigin = Symbol('vespr-editor-heal')
  let destroyed = false; let healTimer = null
  const observer = (event, transaction) => {
    if (transaction.origin === origin) return // our own typing is already in the editor
    const delta = event.delta
    if (autoHeal && transaction.origin !== healOrigin && transaction.origin !== undoManager && delta.some(op => op.delete != null)) scheduleHeal()
    const changes = deltaToChanges(delta)
    if (!changes.length) return
    const info = { origin: transaction.origin, undo: transaction.origin === undoManager }
    for (const cb of [...listeners]) cb(changes, info)
  }
  ytext.observe(observer)

  // Authorship rides on formatting markers, and Yjs puts no marker before an insert whose attributes equal the ones already active.
  // So when someone else deletes text your run hangs on (their delete takes the shared markers with it), what you typed after it falls
  // back to the neighbours' attributes. We remember which Yjs items applyLocal created (their clock ranges on this client) and, after a
  // remote delete, put { by, t } back on exactly those characters that lost it. Items other writers made through this same Y.Doc
  // (an agent in the same process, say) are never in the ranges, so they are never touched.
  const mine = [] // sorted, disjoint [from, to) clock ranges
  const noteMine = (c0, c1) => { if (c1 <= c0) return; const last = mine[mine.length - 1]; if (last && last[1] === c0) last[1] = c1; else mine.push([c0, c1]) }
  const isMine = (clock, length) => {
    let lo = 0; let hi = mine.length - 1
    while (lo <= hi) { const mid = (lo + hi) >> 1; const r = mine[mid]; if (clock < r[0]) hi = mid - 1; else if (clock >= r[1]) lo = mid + 1; else return clock + length <= r[1] }
    return false
  }
  const rightAuthor = attrs => attrs.by === user.name && !!attrs.ai === !!user.ai && (!user.ai || attrs.model === (user.model || ''))
  function healNow () {
    if (destroyed || !mine.length) return 0
    const runs = []; const attrs = {}; let index = 0
    for (let n = ytext._start; n !== null; n = n.right) {
      if (n.deleted) continue
      const c = n.content
      if (c instanceof Y.ContentFormat) { if (c.value === null || c.value === undefined) delete attrs[c.key]; else attrs[c.key] = c.value; continue }
      if (c instanceof Y.ContentString && n.id.client === doc.clientID && isMine(n.id.clock, n.length) && !rightAuthor(attrs)) {
        const last = runs[runs.length - 1]
        if (last && last.end === index) { last.end += n.length; for (const k of Object.keys(attrs)) last.keys.add(k) } else runs.push({ start: index, end: index + n.length, keys: new Set(Object.keys(attrs)) })
      }
      if (n.countable) index += n.length
    }
    if (!runs.length) return 0
    let fixed = 0
    doc.transact(() => {
      for (let i = runs.length - 1; i >= 0; i--) { // from the end, so earlier indexes stay valid
        const r = runs[i]; const fmt = authorship(user)
        for (const k of r.keys) if (!(k in fmt)) fmt[k] = null // an attribute the neighbours had and we do not: take it off
        ytext.format(r.start, r.end - r.start, fmt); fixed += r.end - r.start
      }
    }, healOrigin) // not our typing origin: the undo stack never sees it, and the editor gets no text change from it
    return fixed
  }
  function scheduleHeal () {
    if (healTimer || destroyed) return
    healTimer = setTimeout(() => { healTimer = null; healNow() }, 150)
    if (healTimer && healTimer.unref) healTimer.unref()
  }

  return {
    origin,
    user,
    // The attributes the next insert will carry (a fresh copy).
    attrs: () => authorship(user),

    // changes: [{ from, to, insert }] in the coordinates of the text before the change. One transaction. Applied from the END of the
    // document backwards so every earlier position is still valid, each as delete [from, to) then insert at from.
    applyLocal (changes) {
      if (destroyed) return
      const list = checkChanges(changes, ytext.length)
      if (!list.length) return
      const c0 = Y.getState(doc.store, doc.clientID)
      doc.transact(() => {
        for (let i = list.length - 1; i >= 0; i--) {
          const c = list[i]
          if (c.to > c.from) ytext.delete(c.from, c.to - c.from)
          if (c.insert) ytext.insert(c.from, sanitizeInsert(c.insert), authorship(user))
        }
      }, origin)
      noteMine(c0, Y.getState(doc.store, doc.clientID))
    },

    // Put your authorship back on your own characters that lost it to someone else's delete. Runs by itself shortly after a remote delete
    // (unless createBinding got heal: false). Returns how many characters it fixed.
    heal: healNow,

    // cb(changes, info) for every transaction on the text that is not ours. `changes` are in the coordinates of the editor text
    // BEFORE that transaction. info = { origin, undo }, undo being true for our own undo and redo (the caret belongs at the change).
    onRemote (cb) { listeners.add(cb); return () => listeners.delete(cb) },

    text: () => ytext.toString(),

    // Only changes made through applyLocal are ever undone; nobody else's. Return whether anything was undone or redone.
    undo: () => !destroyed && !!undoManager.undo(),
    redo: () => !destroyed && !!undoManager.redo(),
    canUndo: () => !destroyed && undoManager.canUndo(),
    canRedo: () => !destroyed && undoManager.canRedo(),
    stopCapturing: () => { if (!destroyed) undoManager.stopCapturing() }, // the next change starts a new undo step (a click or a cursor jump)

    destroy () {
      if (destroyed) return
      destroyed = true
      clearTimeout(healTimer); healTimer = null
      ytext.unobserve(observer); undoManager.destroy(); listeners.clear()
    }
  }
}
