// The SDE's own code editor: a CodeMirror 6 adapter over the Yjs binding (core.js) and the shared awareness (presence.js).
// Contract: docs/EDITOR.md. Bundled by scripts/build-editor.sh into app/vendor/editor.js (Yjs is NOT bundled: the caller injects `Y`).
//
// Sync model: the editor document is a mirror of the Y.Text. A local transaction is written to the Y.Text in the same update
// (authorship attributes on every insert, see core.js); a change that comes from anyone else is dispatched into the view with the
// `remote` annotation, which keeps it from being written back. CodeMirror's own history is NOT installed: undo and redo go through
// the binding, so they only ever touch your own changes.
import { EditorState, EditorSelection, ChangeSet, Compartment, StateEffect, StateField, Annotation, RangeSet } from '@codemirror/state'
import {
  EditorView, ViewPlugin, Decoration, WidgetType, GutterMarker, keymap, lineNumbers, gutter, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, highlightSpecialChars, hoverTooltip, hasHoverTooltips, closeHoverTooltips
} from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { StreamLanguage, LanguageSupport, LanguageDescription, indentUnit, indentOnInput, bracketMatching } from '@codemirror/language'
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { yaml } from '@codemirror/lang-yaml'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { createBinding, sanitizeInsert, spanAt, describeSpan } from './core.js'
import { setLocalSelection, remoteSelections } from './presence.js'
import { editorTheme, highlighting } from './theme.js'

const remote = Annotation.define() // set on every change that came from the shared text (or from a resync): never written back

// A lone surrogate (half an emoji) cannot cross the network: Yjs would keep it for the sender and show U+FFFD to everyone else. So it
// becomes U+FFFD in the editor too, before anything is written (same length, so the selection and every position stay valid).
const cleanInserts = EditorState.transactionFilter.of(tr => {
  if (!tr.docChanged || tr.annotation(remote)) return tr
  const specs = []; let dirty = false
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => { const t = inserted.toString(); const c = sanitizeInsert(t); if (c !== t) dirty = true; specs.push({ from: fromA, to: toA, insert: c }) })
  return dirty ? { changes: specs, selection: tr.newSelection, effects: tr.effects, annotations: tr.annotations, scrollIntoView: tr.scrollIntoView } : tr
})

// ── languages, chosen by file extension ───────────────────────────────────────────────────────────────────────────────────────
const fences = () => [ // code blocks inside Markdown
  LanguageDescription.of({ name: 'python', alias: ['py'], support: python() }),
  LanguageDescription.of({ name: 'javascript', alias: ['js', 'jsx', 'node'], support: javascript({ jsx: true }) }),
  LanguageDescription.of({ name: 'typescript', alias: ['ts', 'tsx'], support: javascript({ typescript: true, jsx: true }) }),
  LanguageDescription.of({ name: 'json', alias: ['jsonc'], support: json() }),
  LanguageDescription.of({ name: 'html', alias: ['htm'], support: html() }),
  LanguageDescription.of({ name: 'css', support: css() }),
  LanguageDescription.of({ name: 'yaml', alias: ['yml'], support: yaml() }),
  LanguageDescription.of({ name: 'shell', alias: ['sh', 'bash', 'zsh', 'console'], support: new LanguageSupport(StreamLanguage.define(shell)) })
]
const LANGS = {
  py: ['Python', 4, () => python()], pyw: ['Python', 4, () => python()],
  js: ['JavaScript', 2, () => javascript({ jsx: true })], mjs: ['JavaScript', 2, () => javascript({ jsx: true })], cjs: ['JavaScript', 2, () => javascript({ jsx: true })], jsx: ['JavaScript', 2, () => javascript({ jsx: true })],
  ts: ['TypeScript', 2, () => javascript({ typescript: true, jsx: true })], mts: ['TypeScript', 2, () => javascript({ typescript: true })], cts: ['TypeScript', 2, () => javascript({ typescript: true })], tsx: ['TypeScript', 2, () => javascript({ typescript: true, jsx: true })],
  html: ['HTML', 2, () => html()], htm: ['HTML', 2, () => html()],
  css: ['CSS', 2, () => css()],
  json: ['JSON', 2, () => json()], jsonc: ['JSON', 2, () => json()], webmanifest: ['JSON', 2, () => json()],
  md: ['Markdown', 2, () => markdown({ codeLanguages: fences() })], markdown: ['Markdown', 2, () => markdown({ codeLanguages: fences() })],
  yml: ['YAML', 2, () => yaml()], yaml: ['YAML', 2, () => yaml()],
  sh: ['Shell', 2, () => StreamLanguage.define(shell)], bash: ['Shell', 2, () => StreamLanguage.define(shell)], zsh: ['Shell', 2, () => StreamLanguage.define(shell)]
}
const langOf = file => LANGS[((/\.([^./]+)$/.exec(String(file || '')) || [])[1] || '').toLowerCase()]
export const languageName = file => (langOf(file) || ['Plain text'])[0] // for the shell's status line
export const languageFor = file => { const l = langOf(file); return l ? [l[2](), indentUnit.of(' '.repeat(l[1]))] : [] }

// ── colours of other people: always rebuilt from numbers, so nothing a peer sends can reach a style sheet ─────────────────────
function parseColor (s) {
  s = String(s || '').trim().toLowerCase()
  let m = /^#([0-9a-f]{3,8})$/.exec(s)
  if (m) {
    let h = m[1]; if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('')
    return h.length === 6 || h.length === 8 ? [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) : null
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s)
  if (m) return [m[1], m[2], m[3]].map(v => Math.max(0, Math.min(255, Math.round(+v))))
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(s)
  if (m) {
    const h = ((+m[1] % 360) + 360) % 360; const sat = Math.min(1, +m[2] / 100); const l = Math.min(1, +m[3] / 100)
    const k = n => (n + h / 30) % 12; const a = sat * Math.min(l, 1 - l)
    return [0, 8, 4].map(n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))))
  }
  return null
}
const luminance = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
function peerColor (p) {
  let rgb = parseColor(p.color)
  if (!rgb) { let h = 0; for (const c of p.name) h = (h * 31 + c.charCodeAt(0)) >>> 0; rgb = parseColor(`hsl(${h % 360}, 65%, 62%)`) }
  return { rgb: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`, ink: luminance(rgb) > 0.4 ? '#0b0b0c' : '#ffffff' }
}

// ── remote carets and selections ──────────────────────────────────────────────────────────────────────────────────────────────
class CaretWidget extends WidgetType {
  constructor (p) { super(); this.p = p }
  eq (o) { return o.p.name === this.p.name && o.p.rgb === this.p.rgb && o.p.isAgent === this.p.isAgent && o.p.stamp === this.p.stamp }
  toDOM () {
    const el = document.createElement('span')
    el.className = 'cm-rc' + (this.p.isAgent ? ' is-agent' : '')
    el.setAttribute('aria-hidden', 'true')
    if (this.p.isAgent) { el.style.setProperty('--c', 'var(--agent, #6c9dff)'); el.style.setProperty('--ink', 'var(--bg, #131314)') } else { el.style.setProperty('--c', this.p.rgb); el.style.setProperty('--ink', this.p.ink) }
    el.textContent = '⁠' // word joiner: gives the caret the height of a line without taking any width
    const label = document.createElement('span'); label.className = 'cm-rc-label'; label.textContent = this.p.name
    el.appendChild(label)
    return el
  }
  ignoreEvent () { return true }
}
const setRemotes = StateEffect.define()
function buildRemotes (list, length) {
  const ranges = []
  const at = i => Math.max(0, Math.min(length, i))
  for (const p of list) {
    const a = at(p.anchor); const h = at(p.head)
    if (a !== h) ranges.push(Decoration.mark({ class: 'cm-rsel', attributes: { style: `--c:${p.isAgent ? 'var(--agent, #6c9dff)' : p.rgb}` } }).range(Math.min(a, h), Math.max(a, h)))
    ranges.push(Decoration.widget({ widget: new CaretWidget(p), side: 1 }).range(h))
  }
  return Decoration.set(ranges, true)
}
const remotesField = StateField.define({
  create: () => Decoration.none,
  update (deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) if (e.is(setRemotes)) deco = buildRemotes(e.value, tr.state.doc.length)
    return deco
  },
  provide: f => EditorView.decorations.from(f)
})

// ── problems: a red line, a dot in the gutter, the message on hover ───────────────────────────────────────────────────────────
class ProblemMarker extends GutterMarker {
  constructor (message) { super(); this.message = message }
  eq (o) { return o.message === this.message }
  toDOM () {
    const d = document.createElement('span'); d.className = 'cm-problem-dot'; d.title = this.message
    d.setAttribute('role', 'img'); d.setAttribute('aria-label', 'Problem: ' + this.message)
    return d
  }
}
const setProblems = StateEffect.define()
function buildProblems (list, doc) {
  const byLine = new Map()
  for (const p of list || []) {
    const n = Math.max(1, Math.min(doc.lines, Math.floor(Number(p.line)) || 1))
    byLine.set(n, (byLine.has(n) ? byLine.get(n) + '\n' : '') + String(p.message == null ? 'Problem' : p.message).slice(0, 400))
  }
  const lines = []; const marks = []
  for (const [n, message] of [...byLine].sort((a, b) => a[0] - b[0])) {
    const from = doc.line(n).from
    lines.push(Decoration.line({ class: 'cm-problem-line', message }).range(from))
    marks.push(new ProblemMarker(message).range(from))
  }
  return { lines: Decoration.set(lines, true), marks: RangeSet.of(marks, true) }
}
const problemsField = StateField.define({
  create: () => ({ lines: Decoration.none, marks: RangeSet.empty }),
  update (v, tr) {
    if (tr.docChanged) v = { lines: v.lines.map(tr.changes), marks: v.marks.map(tr.changes) }
    for (const e of tr.effects) if (e.is(setProblems)) v = buildProblems(e.value, tr.state.doc)
    return v
  },
  provide: f => EditorView.decorations.from(f, v => v.lines)
})
const problemAt = (state, from, to) => { let message = ''; state.field(problemsField).lines.between(from, to, (f, t, d) => { message = d.spec.message }); return message }
const problemGutter = gutter({ class: 'cm-problem-gutter', markers: v => v.state.field(problemsField).marks, initialSpacer: () => new ProblemMarker('') })
// One hover tooltip for everything the pointer can be over: the problem on the line (message), and who wrote the character and why.
function hoverInfo (ytext, describeAuthor) {
  return hoverTooltip((view, pos, side) => {
    const doc = view.state.doc; const line = doc.lineAt(pos)
    const problem = problemAt(view.state, line.from, line.from)
    let who = null; let from = line.from; let to = line.to
    if (doc.length === ytext.length && doc.length) { // the character under the pointer: after pos when the pointer is right of it, else before
      const idx = Math.min(doc.length - 1, side < 0 ? pos - 1 : pos)
      const span = idx >= 0 ? spanAt(ytext, idx) : null
      who = span && describeSpan(span.attrs, describeAuthor)
      if (who) { from = Math.max(line.from, span.from); to = Math.min(line.to, span.to) } // stays open while the pointer stays in this author's run
    }
    if (!problem && !who) return null
    return {
      pos: from, end: Math.max(to, from), above: true,
      create: () => {
        const dom = document.createElement('div'); dom.className = 'cm-hover-info'
        if (problem) { const p = document.createElement('div'); p.className = 'cm-problem-tip'; p.textContent = problem; dom.appendChild(p) }
        if (who) {
          const w = document.createElement('div'); w.className = 'cm-who'
          const head = document.createElement('div'); head.className = 'cm-who-head'
          const name = document.createElement('span'); name.className = 'cm-who-name'; name.textContent = who.imported ? 'Imported' : who.author; head.appendChild(name)
          if (who.agent) { const b = document.createElement('span'); b.className = 'cm-who-badge'; b.textContent = 'agent'; head.appendChild(b) }
          if (who.time) { const t = document.createElement('span'); t.className = 'cm-who-time'; t.textContent = who.time; head.appendChild(t) }
          w.appendChild(head)
          if (who.imported) { const n = document.createElement('div'); n.className = 'cm-who-note'; n.textContent = 'with the project, no author recorded'; w.appendChild(n) }
          if (who.model) { const m = document.createElement('div'); m.className = 'cm-who-model'; m.textContent = who.model; w.appendChild(m) }
          if (who.request) { const r = document.createElement('div'); r.className = 'cm-who-req'; r.textContent = who.request; w.appendChild(r) }
          dom.appendChild(w)
        }
        return { dom }
      }
    }
  }, { hoverTime: 300, hideOnChange: true })
}

// ── what an agent just changed: green (added) and red (removed) ranges, fading or staying until cleared ──────────────────────
class TickWidget extends WidgetType {
  eq () { return true }
  toDOM () { const s = document.createElement('span'); s.className = 'cm-recent-tick'; s.setAttribute('aria-hidden', 'true'); return s }
}
const setRecent = StateEffect.define()
const recentField = StateField.define({
  create: () => Decoration.none,
  update (deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) if (e.is(setRecent)) {
      const { marks, fade } = e.value; const len = tr.state.doc.length; const ranges = []
      for (const m of marks) {
        const from = Math.max(0, Math.min(len, m.from)); const to = Math.max(from, Math.min(len, m.to == null ? m.from : m.to))
        const add = m.kind !== 'del'
        const title = `${m.by ? String(m.by).slice(0, 40) + ' ' : ''}${add ? 'added' : 'removed'} this`
        const attributes = { title }; if (fade) attributes.style = `--ttl:${fade}ms`
        if (to > from) ranges.push(Decoration.mark({ class: `cm-recent cm-recent-${add ? 'add' : 'del'}${fade ? ' cm-recent-fade' : ''}`, attributes }).range(from, to))
        else if (!add) ranges.push(Decoration.widget({ widget: new TickWidget(), side: -1 }).range(from)) // text removed here: a small red tick
      }
      deco = Decoration.set(ranges, true)
    }
    return deco
  },
  provide: f => EditorView.decorations.from(f)
})
const setFlash = StateEffect.define()
const flashField = StateField.define({
  create: () => Decoration.none,
  update (deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) if (e.is(setFlash)) deco = e.value == null ? Decoration.none : Decoration.set([Decoration.line({ class: 'cm-flash-line' }).range(Math.min(e.value, tr.state.doc.length))])
    return deco
  },
  provide: f => EditorView.decorations.from(f)
})

// ── the editor ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// describeAuthor(attrs) -> { request?: string }: lets the shell resolve the chat message behind an agent's edit (attrs.msg) for the hover tooltip.
export function createEditor ({ parent, Y, ytext, awareness, user, file, readOnly = false, claims, describeAuthor }) {
  if (!parent || !Y || !ytext || !user || !user.name) throw new Error('createEditor needs parent, Y, ytext and user.name')
  file = String(file || '')
  const binding = createBinding({ Y, ytext, user })
  const selListeners = new Set(); const changeListeners = new Set()
  const roCompartment = new Compartment()
  let view = null; let destroyed = false; let inUpdate = false
  let lastClaim = 0; let lastPub = 0; let pubTimer = null; let remotesQueued = false; let lastSig = ''; let lastRemotes = []
  let recentTimer = null; let flashTimer = null; let resyncing = false
  const seen = new Map() // clientId -> { key, at }: when each person's selection last moved (a label stays while they are active)

  // Calls from outside (the shell, tests) may arrive while a change is being written to the shared text: never dispatch inside an update.
  const act = fn => { if (destroyed) return; if (inUpdate) queueMicrotask(() => { if (!destroyed) fn() }); else fn() }
  const emit = (set, arg) => { for (const cb of [...set]) { try { cb(arg) } catch (e) { console.error(e) } } }
  const clamp = i => Math.max(0, Math.min(view.state.doc.length, Math.floor(Number(i)) || 0))
  // Yjs cannot split a surrogate pair (half an emoji becomes U+FFFD in the shared text only), and typing never does: keep the test helpers off the middle of one.
  const inPair = n => { if (n <= 0 || n >= view.state.doc.length) return false; const c = view.state.doc.sliceString(n - 1, n + 1); return c.charCodeAt(0) >= 0xD800 && c.charCodeAt(0) <= 0xDBFF && c.charCodeAt(1) >= 0xDC00 && c.charCodeAt(1) <= 0xDFFF }
  const snapDown = i => { const n = clamp(i); return inPair(n) ? n - 1 : n }
  const snapUp = i => { const n = clamp(i); return inPair(n) ? n + 1 : n }

  // If the editor and the shared text ever differ (they must not), bring the editor back in one minimal edit instead of drifting.
  function resync (why) {
    if (destroyed || resyncing) return
    resyncing = true; console.warn('editor: out of step with the shared text, reloading it (' + why + ')')
    queueMicrotask(() => {
      resyncing = false; if (destroyed) return
      const have = view.state.doc.toString(); const want = ytext.toString(); if (have === want) return
      let a = 0; while (a < have.length && a < want.length && have[a] === want[a]) a++
      let z = 0; while (z < have.length - a && z < want.length - a && have[have.length - 1 - z] === want[want.length - 1 - z]) z++
      view.dispatch({ changes: { from: a, to: have.length - z, insert: want.slice(a, want.length - z) }, annotations: remote.of(true) })
    })
  }

  // Soft claim: while a person edits, say so in the room (people's claims expire after 60 s, so refresh well inside that).
  function noteEdit () {
    if (!claims || readOnly) return
    const now = Date.now(); if (now - lastClaim < 10000) return
    lastClaim = now
    try { claims.set(file, { by: user.name, ai: !!user.ai, since: now }) } catch (e) { console.error(e) }
  }

  function publishSelection () {
    if (!awareness || destroyed) return
    const wait = 100 - (Date.now() - lastPub)
    if (wait <= 0) doPublish(); else if (!pubTimer) pubTimer = setTimeout(doPublish, wait)
  }
  function doPublish () {
    pubTimer = null; if (destroyed || view.state.doc.length !== ytext.length) return
    lastPub = Date.now()
    const r = view.state.selection.main
    setLocalSelection({ Y, awareness, ytext, file, anchor: r.anchor, head: r.head })
  }

  function scheduleRemotes () { if (remotesQueued || destroyed || !awareness) return; remotesQueued = true; queueMicrotask(refreshRemotes) }
  function refreshRemotes () {
    remotesQueued = false
    if (destroyed || view.state.doc.length !== ytext.length) return
    const now = Date.now(); const live = new Set()
    const list = remoteSelections({ Y, awareness, ytext, file }).map(p => {
      const key = p.anchor + ':' + p.head; const prev = seen.get(p.clientId); live.add(p.clientId)
      const at = prev && prev.key === key ? prev.at : now; seen.set(p.clientId, { key, at })
      return { ...p, ...peerColor(p), stamp: at }
    })
    for (const id of [...seen.keys()]) if (!live.has(id)) seen.delete(id)
    const sig = JSON.stringify(list.map(p => [p.clientId, p.anchor, p.head, p.name, p.rgb, p.isAgent, p.stamp]))
    lastRemotes = list; if (sig === lastSig) return
    lastSig = sig
    view.dispatch({ effects: setRemotes.of(list) })
  }

  const sync = ViewPlugin.define(() => ({
    update (u) {
      inUpdate = true
      try {
        if (u.docChanged) {
          const batch = []
          for (const tr of u.transactions) {
            if (!tr.docChanged) continue
            const changes = []
            tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => changes.push({ from: fromA, to: toA, insert: inserted.toString() }))
            const fromShared = !!tr.annotation(remote)
            if (!fromShared) { try { binding.applyLocal(changes); noteEdit() } catch (e) { console.error(e); resync('local change refused') } }
            batch.push({ remote: fromShared, changes })
          }
          if (u.state.doc.length !== ytext.length) resync('length differs')
          scheduleRemotes()
          for (const info of batch) emit(changeListeners, info)
        } else if (u.selectionSet) binding.stopCapturing() // a click or an arrow key ends the typing run: the next edit is a new undo step
        if (u.selectionSet || u.docChanged) {
          publishSelection()
          if (selListeners.size) { const r = u.state.selection.main; const l = u.state.doc.lineAt(r.head); emit(selListeners, { anchor: r.anchor, head: r.head, from: r.from, to: r.to, line: l.number, col: r.head - l.from + 1 }) }
        }
      } finally { inUpdate = false }
    }
  }))

  // Undo and redo are the binding's: only your own changes. Always handled, so the browser's own undo never touches the page.
  const undoCmd = v => { if (!v.state.readOnly) binding.undo(); return true }
  const redoCmd = v => { if (!v.state.readOnly) binding.redo(); return true }
  binding.onRemote((changes, info) => {
    if (destroyed) return
    const spec = { changes, annotations: remote.of(true) }
    if (info && info.undo) { // put the caret where the undo happened, the way every editor does
      const last = changes[changes.length - 1]
      spec.selection = EditorSelection.cursor(ChangeSet.of(changes, view.state.doc.length).mapPos(last.to, 1)); spec.scrollIntoView = true
    }
    try { view.dispatch(spec) } catch (e) { console.error(e); resync('remote change refused') }
  })

  const pasteText = (text, state) => state.doc.length && state.sliceDoc(0, 4000).includes('\r') ? text : text.replace(/\r\n?/g, '\n') // keep a CRLF file CRLF, make everything else LF

  view = new EditorView({
    parent,
    state: EditorState.create({
      doc: ytext.toString(),
      extensions: [
        EditorState.lineSeparator.of('\n'), // only \n ends a line, so a \r stays a character and the editor's length is the Y.Text's length
        EditorState.tabSize.of(4),
        cleanInserts,
        EditorView.clipboardInputFilter.of(pasteText),
        EditorView.editorAttributes.of({ class: 'vespr-editor' }),
        EditorView.contentAttributes.of({ 'aria-label': file ? 'Code editor: ' + file : 'Code editor', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
        roCompartment.of(EditorState.readOnly.of(!!readOnly)),
        problemGutter, lineNumbers(), highlightActiveLineGutter(),
        highlightSpecialChars(), drawSelection(), dropCursor(), indentOnInput(), bracketMatching(), highlightActiveLine(), highlightSelectionMatches(),
        search({ top: true }),
        languageFor(file), highlighting, editorTheme,
        remotesField, problemsField, recentField, flashField, hoverInfo(ytext, describeAuthor),
        EditorView.domEventHandlers({
          beforeinput (e, v) { // the browser's own undo (Edit menu, a context menu) must not edit the page behind the binding's back
            if (e.inputType === 'historyUndo') { e.preventDefault(); undoCmd(v); return true }
            if (e.inputType === 'historyRedo') { e.preventDefault(); redoCmd(v); return true }
            return false
          }
        }),
        keymap.of([
          { key: 'Mod-z', run: undoCmd, preventDefault: true },
          { key: 'Mod-y', run: redoCmd, preventDefault: true },
          { key: 'Mod-Shift-z', run: redoCmd, preventDefault: true },
          ...searchKeymap, ...defaultKeymap.filter(b => b.key !== 'Mod-Enter'), indentWithTab // Mod-Enter (a blank line) is left to the shell: it runs the open file. Escape then Tab leaves the editor for keyboard users (built in)
        ]),
        sync
      ]
    })
  })

  const onScroll = () => { if (!destroyed && hasHoverTooltips(view.state)) view.dispatch({ effects: closeHoverTooltips }) } // a tooltip would point at the wrong text once the view moves
  view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
  const onAwareness = () => scheduleRemotes()
  if (awareness) {
    awareness.on('change', onAwareness)
    const me = awareness.getLocalState(); if (!me || !me.user) awareness.setLocalStateField('user', { name: user.name, color: user.color || '#a5b4fc', isAgent: !!user.ai, model: user.model || '' })
    doPublish(); scheduleRemotes()
  }

  const handle = {
    view, binding,
    getText: () => view.state.doc.toString(),
    isInSync: () => view.state.doc.toString() === ytext.toString(),
    focus: () => view.focus(),
    goToLine (n) {
      act(() => {
        const line = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, Math.floor(Number(n)) || 1)))
        view.dispatch({ selection: { anchor: line.from }, effects: [EditorView.scrollIntoView(line.from, { y: 'center' }), setFlash.of(line.from)] })
        clearTimeout(flashTimer); flashTimer = setTimeout(() => act(() => view.dispatch({ effects: setFlash.of(null) })), 1500)
      })
    },
    setProblems: list => act(() => view.dispatch({ effects: setProblems.of(list || []) })),
    // marks: [{ from, to, kind: 'add' | 'del', by }]. They follow the text as it moves. opts.fade (ms): fade out and clear; without it they stay until cleared (markRecent([])).
    markRecent (marks, opts = {}) {
      act(() => {
        const fade = Math.max(0, Math.floor(Number(opts && opts.fade)) || 0); clearTimeout(recentTimer)
        view.dispatch({ effects: setRecent.of({ marks: marks || [], fade }) })
        if (fade && marks && marks.length) recentTimer = setTimeout(() => act(() => view.dispatch({ effects: setRecent.of({ marks: [], fade: 0 }) })), fade + 50)
      })
    },
    setReadOnly (b) { readOnly = !!b; act(() => view.dispatch({ effects: roCompartment.reconfigure(EditorState.readOnly.of(readOnly)) })) },
    // test helpers: act like typing (the same path as a key press: a user transaction that is written to the shared text)
    insertAt (index, text) {
      if (readOnly || destroyed) return false
      const at = snapDown(index); text = String(text)
      view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.type', scrollIntoView: true }); return true
    },
    deleteRange (from, to) {
      if (readOnly || destroyed) return false
      const a = snapDown(Math.min(from, to)); const b = snapUp(Math.max(from, to))
      view.dispatch({ changes: { from: a, to: b }, selection: { anchor: a }, userEvent: 'delete' }); return true
    },
    setSelection (anchor, head = anchor) { if (!destroyed) view.dispatch({ selection: EditorSelection.single(snapDown(anchor), snapDown(head)) }) },
    undo: () => !readOnly && binding.undo(), redo: () => !readOnly && binding.redo(),
    remoteCursors: () => lastRemotes.map(p => ({ clientId: p.clientId, name: p.name, isAgent: p.isAgent, anchor: p.anchor, head: p.head })),
    onSelection (cb) { selListeners.add(cb); return () => selListeners.delete(cb) },
    onChange (cb) { changeListeners.add(cb); return () => changeListeners.delete(cb) },
    destroy () {
      if (destroyed) return
      destroyed = true
      clearTimeout(pubTimer); clearTimeout(recentTimer); clearTimeout(flashTimer)
      if (awareness) {
        awareness.off('change', onAwareness)
        const cur = awareness.getLocalState() && awareness.getLocalState().cursor
        if (cur && cur.file === file) awareness.setLocalStateField('cursor', null) // leaving the file: stop showing a caret in it
      }
      view.scrollDOM.removeEventListener('scroll', onScroll)
      binding.destroy(); selListeners.clear(); changeListeners.clear(); view.destroy()
    }
  }
  return handle
}
