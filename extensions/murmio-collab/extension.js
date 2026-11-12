// VESPR collaboration extension for VS Code: shared editing + live presence with people and agents.
const { fileStore } = require('./lib/file-store.cjs')
const vscode = require('vscode')
const path = require('node:path')
const WebSocket = require('ws')
const Y = require('yjs')
const { WebsocketProvider } = require('y-websocket')
const { applyChangesToYText, colorFor, spansOf, spanAt, safeColor, diffEdit } = require('./lib/binding')
const { ChatView } = require('./lib/chatView')
const { openReplay } = require('./lib/replayView')
const { openCodeMap } = require('./lib/codemapView')
const suggestions = require('./lib/suggest')

const LOCAL = 'murmio-local' // origin of changes that came from this VS Code window
let ydoc, provider, files, awareness, status, chat, chatView
const bound = new Map() // uri string -> { ytext, observer }
const applying = new Map() // uri string -> how many of our own edits are being applied right now (those change events are not the user's typing)
const decorations = new Map() // clientId -> TextEditorDecorationType
let followId = null
let uiStop = null // stops watching the UI command bus of the previous connection
let lensOn = false
let runners = [] // machines connected to the server that can run commands
let prevSeen = 0 // when this person was last here, before this connection
let heartbeat = null
let claimStatus
const lastClaim = new Map() // file -> ms of our last claim write (throttle)
const lensTypes = new Map() // author -> decoration type
const minute = () => Math.floor(Date.now() / 60000)

const cfg = () => vscode.workspace.getConfiguration('murmio')
const me = () => {
  const name = cfg().get('userName') || process.env.USER || 'guest'
  return { name, color: colorFor(name, false), isAgent: false }
}
const relPath = doc => {
  const f = vscode.workspace.getWorkspaceFolder(doc.uri)
  return f && doc.uri.scheme === 'file' ? path.posix.join(...path.relative(f.uri.fsPath, doc.uri.fsPath).split(path.sep)) : null
}

function connect (context) {
  if (provider) { provider.destroy(); ydoc.destroy(); clearInterval(heartbeat); heartbeat = null }
  ydoc = new Y.Doc()
  files = fileStore(ydoc)
  // the app shell (a web page) can ask this SDE to open a file or follow an agent: it writes a small command into the shared document (lib/uibus.js decides what is allowed)
  if (uiStop) uiStop()
  uiStop = require('./lib/uibus').attach(ydoc, {
    get me () { return me().name }, filesHas: p => files.has(p), agents: () => [...awareness.getStates().values()].filter(s => s.user && s.user.isAgent).map(s => s.user.name)
  }, p => {
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]
    if (p.kind === 'open' && folder) {
      materialize([p.file]).then(() => vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, ...p.file.split('/')))).then(doc => vscode.window.showTextDocument(doc, { preview: false, selection: new vscode.Range(p.line - 1, 0, p.line - 1, 0) })).then(undefined, () => {})
    } else if (p.kind === 'follow') { const e = [...awareness.getStates()].find(([, st]) => st.user && st.user.isAgent && st.user.name === p.agent); if (e) { followId = e[0]; followTick() } } else if (p.kind === 'unfollow') followId = null
  })
  chat = ydoc.getArray('chat')
  ydoc.getMap('claims').observe(() => { updateClaimStatus(); chatView && chatView.push() })
  ydoc.getMap('usage').observe(() => chatView && chatView.push())
  chat.observeDeep(() => chatView && chatView.push())
  files.observe(ev => {
    const keptOpen = new Set()
    for (const r of ev.renamed) for (const b of bound.values()) if (b.ytext === r.text) {
      b.rel = r.to; keptOpen.add(r.from)
      vscode.window.showInformationMessage(`VESPR: ${r.from} is now ${r.to}. This open buffer stays connected; open the new path when ready.`)
    }
    materialize([...ev.keysChanged].filter(p => !keptOpen.has(p)))
  })
  const token = cfg().get('token')
  if (!token) { setStatus('$(circle-slash) VESPR: set murmio.token'); return }
  provider = new WebsocketProvider(cfg().get('server').replace(/\/$/, '') + '/ws', cfg().get('room'), ydoc, { WebSocketPolyfill: WebSocket, params: { token } })
  awareness = provider.awareness
  awareness.setLocalStateField('user', me())
  provider.on('status', e => setStatus(e.status === 'connected' ? null : `$(sync~spin) VESPR: ${e.status}`))
  provider.on('sync', async () => {
    startPresenceClock(context); await seedWorkspace(); await materialize(files.keys()); for (const ed of vscode.window.visibleTextEditors) bindDocument(ed.document); render(); chatView && chatView.push() })
  awareness.on('change', () => { render(); updateStatus(); followTick(); chatView && chatView.push() })
  updateStatus()
}

// Remember when each person was last here (a heartbeat in the shared document), so a returning person can be caught up.
async function refreshRunners () {
  const token = cfg().get('token'); if (!token) return
  try {
    const res = await fetch(cfg().get('server').replace(/^ws/, 'http').replace(/\/$/, '') + '/api/runners', { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) { runners = await res.json(); chatView && chatView.push() }
  } catch { /* server unreachable: keep the last list */ }
}

function startPresenceClock (context) {
  const seen = ydoc.getMap('seen'); const name = me().name
  if (heartbeat) return
  refreshRunners(); const rt = setInterval(refreshRunners, 10000); context.subscriptions.push({ dispose: () => clearInterval(rt) })
  prevSeen = seen.get(name) || 0
  const gap = Date.now() - prevSeen
  seen.set(name, Date.now())
  heartbeat = setInterval(() => { try { seen.set(name, Date.now()) } catch {} }, 20000)
  context.subscriptions.push({ dispose: () => clearInterval(heartbeat) })
  if (prevSeen && gap > 3 * 60000) vscode.window.showInformationMessage(`Welcome back. You were away ${Math.round(gap / 60000)} min. Want the agent to catch you up?`, 'Catch me up').then(c => { if (c) chatView.catchUp(prevSeen) })
}

// Soft locks: show when someone else is working on the file you are looking at; claim a file while you type in it.
function freshClaims () { const out = []; if (!ydoc) return out; for (const [file, c] of ydoc.getMap('claims')) if (Date.now() - c.since < (c.ai ? 5 * 60000 : 60000)) out.push({ file, by: c.by, ai: !!c.ai }); return out }
function updateClaimStatus () {
  const ed = vscode.window.activeTextEditor; const b = ed && bound.get(ed.document.uri.toString())
  const c = b && freshClaims().find(x => x.file === b.rel && x.by !== me().name)
  if (c) { claimStatus.text = `$(lock) ${c.ai ? '🤖 ' : ''}${c.by} is editing ${c.file}`; claimStatus.show() } else claimStatus.hide()
}
function claimMine (rel) {
  const now = Date.now(); if (now - (lastClaim.get(rel) || 0) < 5000) return
  lastClaim.set(rel, now); ydoc.getMap('claims').set(rel, { by: me().name, ai: false, since: now })
}

function setStatus (text) { if (text) { status.text = text; status.show() } else updateStatus() }
function updateStatus () {
  if (!awareness) return
  const names = [...new Set([...awareness.getStates().values()].map(s => (s.user && s.user.name) || '?'))]
  status.text = `$(organization) VESPR: ${names.length} here`
  status.tooltip = names.join(', ')
  status.show()
}


// First person into an empty room shares the workspace's text files, so agents and teammates can see the project.
const SKIP = '**/{node_modules,.git,.vscode,__pycache__,dist,build,.next}/**'
async function seedWorkspace () {
  if (files.size > 0) return
  const found = await vscode.workspace.findFiles('**/*', SKIP, 300)
  const entries = []
  for (const uri of found) {
    const st = await vscode.workspace.fs.stat(uri)
    if (st.size > 200 * 1024) continue
    const bytes = await vscode.workspace.fs.readFile(uri)
    if (bytes.includes(0)) continue // binary
    const f = vscode.workspace.getWorkspaceFolder(uri)
    entries.push([path.posix.join(...path.relative(f.uri.fsPath, uri.fsPath).split(path.sep)), Buffer.from(bytes).toString('utf8')])
  }
  if (files.size > 0) return // someone else seeded while we were reading
  ydoc.transact(() => { for (const [rel, text] of entries) { const t = new Y.Text(); t.insert(0, text, { by: 'import', t: minute() }); files.set(rel, t) } })
}

// Files that exist in the shared room but not on this machine (for example ones an agent created) are written locally.
async function materialize (keys) {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]
  if (!folder) return
  for (const rel of keys) {
    const t = files.get(rel)
    if (rel.includes('..') || rel.startsWith('/') || rel.split('/').some(s => s === '.vscode' || s === '.git')) continue // never write editor config or git internals that a peer sent
    if (!t) { // deleted in the shared workspace (for example by a git push): remove it here too, unless it is open with unsaved changes
      const gone = vscode.Uri.joinPath(folder.uri, ...rel.split('/'))
      const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === gone.toString())
      if (!open || !open.isDirty) { try { await vscode.workspace.fs.delete(gone) } catch { /* already gone */ } }
      bound.delete(gone.toString())
      continue
    }
    const uri = vscode.Uri.joinPath(folder.uri, ...rel.split('/'))
    try { await vscode.workspace.fs.stat(uri); continue } catch { /* missing: create it */ }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(t.toString(), 'utf8'))
  }
}

function bindDocument (doc) {
  const rel = relPath(doc)
  if (!rel || !provider || !provider.synced) return
  const key = doc.uri.toString()
  if (bound.has(key)) return
  let ytext = files.get(rel)
  if (!ytext) { ytext = new Y.Text(); ytext.insert(0, doc.getText(), { by: 'import', t: minute() }); files.set(rel, ytext) }
  // Remote edits arrive as a burst (a teammate types, an agent writes). Instead of replaying each one, bring this document in line
  // with the shared text in ONE minimal edit, shortly after the burst. That keeps order and positions right however fast they come.
  const state = { ytext, rel, timer: null, busy: false }
  const sync = async () => {
    state.timer = null
    if (state.busy) { state.timer = setTimeout(sync, 25); return }
    const want = ytext.toString(); const have = doc.getText()
    if (want === have) return
    state.busy = true
    const d = diffEdit(have, want)
    const edit = new vscode.WorkspaceEdit()
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(d.start), doc.positionAt(d.end)), d.text)
    applying.set(key, (applying.get(key) || 0) + 1)
    try { await vscode.workspace.applyEdit(edit) } finally { applying.set(key, applying.get(key) - 1); if (!applying.get(key)) applying.delete(key); state.busy = false }
    if (ytext.toString() !== doc.getText()) state.timer = state.timer || setTimeout(sync, 25) // more arrived while we were applying
  }
  const observer = ev => { if (ev.transaction.origin === LOCAL) return; if (!state.timer) state.timer = setTimeout(sync, 30) }
  ytext.observe(observer)
  bound.set(key, { ytext, observer, rel, state })
  if (ytext.toString() !== doc.getText()) sync() // join an existing shared file: take the shared content
}

function publishSelection (editor) {
  if (!awareness) return
  const b = bound.get(editor.document.uri.toString())
  if (!b) { awareness.setLocalStateField('cursor', null); return }
  const sel = editor.selection
  const off = p => Y.createRelativePositionFromTypeIndex(b.ytext, editor.document.offsetAt(p))
  awareness.setLocalStateField('cursor', { file: b.rel, anchor: off(sel.anchor), head: off(sel.active) })
}

function render () {
  if (!awareness) return
  const live = new Set()
  for (const [id, s] of awareness.getStates()) {
    if (id === awareness.clientID || !s.user || !s.cursor) continue
    live.add(id)
    if (!decorations.has(id)) decorations.set(id, { sel: vscode.window.createTextEditorDecorationType({ borderRadius: '2px' }), tag: vscode.window.createTextEditorDecorationType({}) })
  }
  for (const [id, d] of decorations) if (!live.has(id)) { d.sel.dispose(); d.tag.dispose(); decorations.delete(id) }
  for (const editor of vscode.window.visibleTextEditors) {
    const b = bound.get(editor.document.uri.toString())
    for (const [id, d] of decorations) {
      const s = awareness.getStates().get(id)
      const ranges = []; const tags = []
      if (b && s && s.cursor) {
        const abs = r => Y.createAbsolutePositionFromRelativePosition(r, ydoc)
        const a = abs(s.cursor.anchor); const h = abs(s.cursor.head)
        if (a && h && a.type === b.ytext && h.type === b.ytext) {
          const p = i => editor.document.positionAt(Math.min(i, editor.document.getText().length))
          const color = safeColor(s.user.color)
          d.sel.__c = color
          if (a.index !== h.index) ranges.push({ range: new vscode.Range(p(Math.min(a.index, h.index)), p(Math.max(a.index, h.index))), renderOptions: { backgroundColor: color.replace('hsl(', 'hsla(').replace(')', ', 0.25)') } })
          tags.push({
            range: new vscode.Range(p(h.index), p(h.index)),
            renderOptions: { before: { contentText: '', border: `0 solid ${color}`, borderWidth: '0 0 0 2px', margin: '0 0 0 -1px' }, after: { contentText: ` ${s.user.isAgent ? '🤖 ' : ''}${s.user.name} `, color: '#000', backgroundColor: color, margin: '0 0 0 2px', fontWeight: 'bold', fontStyle: 'normal' } }
          })
        }
      }
      editor.setDecorations(d.sel, ranges); editor.setDecorations(d.tag, tags)
    }
  }
}

function followTick () {
  if (followId == null || !awareness) return
  const s = awareness.getStates().get(followId)
  if (!s || !s.cursor) return
  const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(s.cursor.head), ydoc)
  if (!abs) return
  const key = [...bound.entries()].find(([, v]) => v.ytext === abs.type)
  if (!key) return
  vscode.workspace.openTextDocument(vscode.Uri.parse(key[0])).then(doc => vscode.window.showTextDocument(doc, { preserveFocus: true, preview: false }).then(ed => {
    const pos = doc.positionAt(abs.index); ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport)
  }))
}

// ── authorship: hover "who and why", and a lens that tints every line by its author ──
const cleanName = s => String(s || '').replace(/[^\w .@-]/g, '').slice(0, 40)
function describe (attrs) {
  const when = attrs.t ? new Date(attrs.t * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
  if (attrs.by === 'import') return new vscode.MarkdownString('**Imported** with the project (no author recorded).')
  if (!attrs.by) return null
  const md = new vscode.MarkdownString()
  if (attrs.ai) {
    md.appendMarkdown(`🤖 **${cleanName(attrs.by)}** (agent${attrs.model ? ', ' + cleanName(attrs.model) : ''}) wrote this${when ? ' at ' + when : ''}.`)
    const why = attrs.msg && chat.toArray().find(m => m.get('id') === attrs.msg)
    if (why) md.appendMarkdown(`\n\n**Because** ${cleanName(why.get('author'))} asked: _${why.get('text').toString().slice(0, 200).replace(/[^\w .,:;!?@#'"()/-]/g, '')}_`)
  } else md.appendMarkdown(`✎ **${cleanName(attrs.by)}** typed this${when ? ' at ' + when : ''}.`)
  return md
}

function renderLens () {
  for (const editor of vscode.window.visibleTextEditors) {
    const b = bound.get(editor.document.uri.toString())
    const byAuthor = new Map()
    if (lensOn && b) for (const sp of spansOf(b.ytext)) {
      const a = sp.attrs.by; if (!a || a === 'import') continue
      if (!byAuthor.has(a)) byAuthor.set(a, { ai: !!sp.attrs.ai, ranges: [] })
      byAuthor.get(a).ranges.push(new vscode.Range(editor.document.positionAt(sp.start), editor.document.positionAt(sp.end)))
    }
    for (const [a, v] of byAuthor) if (!lensTypes.has(a)) lensTypes.set(a, vscode.window.createTextEditorDecorationType({ backgroundColor: colorFor(a, v.ai).replace('hsl(', 'hsla(').replace(')', ', 0.16)'), borderRadius: '2px' }))
    for (const [a, type] of lensTypes) editor.setDecorations(type, byAuthor.has(a) ? byAuthor.get(a).ranges : [])
  }
}

function activate (context) {
  if (vscode.workspace.getConfiguration('murmio').get('cleanseUI', true)) { try { require('./lib/cleanse').apply(vscode) } catch (err) { console.error('VESPR look: ' + err.message) } } // the VESPR look in the browser SDE (palette, no Welcome tabs)
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  claimStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99)
  status.command = 'murmio.people'
  chatView = new ChatView(() => ({ ydoc, chat, awareness, me: me(), prevSeen, runners }), context.extensionUri)
  context.subscriptions.push(status, claimStatus, vscode.window.onDidChangeActiveTextEditor(updateClaimStatus), vscode.window.registerWebviewViewProvider('murmio.chat', chatView, { webviewOptions: { retainContextWhenHidden: true } }))
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      const key = e.document.uri.toString()
      const b = bound.get(key)
      if (!b || applying.get(key) || !e.contentChanges.length) return
      applyChangesToYText(b.ytext, e.contentChanges, LOCAL, { by: me().name, t: minute() })
      claimMine(b.rel)
      if (lensOn) renderLens()
    }),
    vscode.window.onDidChangeVisibleTextEditors(eds => { eds.forEach(ed => bindDocument(ed.document)); render() }),
    vscode.window.onDidChangeTextEditorSelection(e => publishSelection(e.textEditor)),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('murmio')) connect(context) }),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, { provideHover (doc, pos) {
      const b = bound.get(doc.uri.toString()); if (!b) return null
      const sp = spanAt(spansOf(b.ytext), doc.offsetAt(pos)); const md = sp && describe(sp.attrs)
      return md ? new vscode.Hover(md) : null
    } }),
    vscode.commands.registerCommand('murmio.lens', () => { lensOn = !lensOn; renderLens(); vscode.window.setStatusBarMessage(lensOn ? 'VESPR: authorship lens on (hover any line for who and why)' : 'VESPR: authorship lens off', 4000) }),
    vscode.commands.registerCommand('murmio.codemap', () => openCodeMap({ extensionPath: context.extensionPath, getFiles: () => files, onOpen: p => { const f = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0]; if (f) vscode.commands.executeCommand('vscode.open', vscode.Uri.joinPath(f.uri, ...p.split('/'))) } })),
    // Quick actions and macros: every one is a named command, so it can be bound to a key, chained in a keybindings.json entry, or driven by a macro tool.
    vscode.commands.registerCommand('murmio.approve', () => { if (!chatView.decideLatest(true)) vscode.window.setStatusBarMessage('VESPR: nothing waiting for approval', 2500) }),
    vscode.commands.registerCommand('murmio.deny', () => { if (!chatView.decideLatest(false)) vscode.window.setStatusBarMessage('VESPR: nothing waiting for approval', 2500) }),
    vscode.commands.registerCommand('murmio.say', async arg => { const text = typeof arg === 'string' ? arg : arg && arg.text ? String(arg.text) : await vscode.window.showInputBox({ prompt: 'Message to the team chat' }); if (text && text.trim()) chatView.send(text.trim()) }),
    vscode.commands.registerCommand('murmio.askAgent', async arg => { const agent = (arg && arg.agent) || 'coder'; const text = typeof arg === 'string' ? arg : arg && arg.text ? String(arg.text) : await vscode.window.showInputBox({ prompt: `Ask @${agent}`, value: `@${agent} ` }); if (text && text.trim()) chatView.send(text.trim().startsWith('@') ? text.trim() : `@${agent} ${text.trim()}`) }),
    vscode.commands.registerCommand('murmio.runIt', () => chatView.send('@coder start the project and give us the preview link')),
    vscode.commands.registerCommand('murmio.mode', async arg => { const modes = ['manual', 'acceptEdits', 'auto', 'plan', 'bypass']; const pick = typeof arg === 'string' && modes.includes(arg) ? arg : await vscode.window.showQuickPick(modes, { placeHolder: 'Agent mode for the whole workspace' }); if (pick) chatView.setMode(pick) }),
    vscode.commands.registerCommand('murmio.catchUp', () => chatView.catchUp()),
    vscode.commands.registerCommand('murmio.replay', () => openReplay({ server: cfg().get('server'), room: cfg().get('room'), token: cfg().get('token') })),
    vscode.commands.registerCommand('murmio.commit', async () => {
      const base = cfg().get('server').replace(/^ws/, 'http').replace(/\/$/, ''); const room = cfg().get('room')
      const message = await vscode.window.showInputBox({ prompt: 'Commit message (leave empty to write it from who did what and why)', placeHolder: 'VESPR snapshot: ...' })
      if (message === undefined) return
      try {
        const res = await fetch(`${base}/api/git/${encodeURIComponent(room)}/commit`, { method: 'POST', headers: { Authorization: `Bearer ${cfg().get('token')}` }, body: JSON.stringify({ message }) })
        const j = await res.json()
        if (!res.ok) throw new Error(j.error || res.status)
        const text = j.unchanged ? 'nothing new to commit' : `committed ${j.sha.slice(0, 7)}: ${j.message.split('\n')[0]}`
        if (!j.unchanged) chatView.sendTool(text)
        const pick = await vscode.window.showInformationMessage(`VESPR: ${text}`, 'Copy clone command')
        if (pick) { await vscode.env.clipboard.writeText(`git clone http://murmio@${new URL(base).host}/git/${room}   # password: your VESPR token`); vscode.window.setStatusBarMessage('Clone command copied (the password is your VESPR token)', 4000) }
      } catch (e) { vscode.window.showErrorMessage(`VESPR commit failed: ${e.message}`) }
    }),
    vscode.commands.registerCommand('murmio.welcome', () => vscode.commands.executeCommand('workbench.action.openWalkthrough', 'murmio.murmio-collab#murmio.welcome', false)),
    vscode.commands.registerCommand('murmio.reconnect', () => connect(context)),
    vscode.commands.registerCommand('murmio.chat', () => vscode.commands.executeCommand('workbench.view.extension.murmio')),
    vscode.commands.registerCommand('murmio.people', async () => {
      if (!awareness) return
      const items = [...awareness.getStates()].filter(([id, s]) => s.user).map(([id, s]) => ({ label: `${s.user.isAgent ? '$(hubot)' : '$(account)'} ${s.user.name}${id === awareness.clientID ? ' (you)' : ''}`, description: s.cursor ? s.cursor.file : 'no file open', id }))
      const pick = await vscode.window.showQuickPick(items, { title: 'VESPR: who is here' })
      if (pick && pick.id !== awareness.clientID) { followId = pick.id; followTick() }
    }),
    vscode.commands.registerCommand('murmio.follow', async () => { followId = null; vscode.window.showInformationMessage('Stopped following.') })
  )
  suggestions.register(context, cfg)
  connect(context)
}
function deactivate () { if (provider) provider.destroy() }
module.exports = { activate, deactivate }
