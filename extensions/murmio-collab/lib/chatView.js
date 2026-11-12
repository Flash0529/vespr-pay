// The shared team chat: a webview in the VESPR side bar. Everything in it comes from the shared Yjs document,
// so people and agents see the same messages, live, including answers while they are still being written.
const vscode = require('vscode')
const Y = require('yjs')
const { safeColor } = require('./binding')

function serialize (chat) {
  return chat.toArray().slice(-200).map(m => ({
    id: m.get('id'), ts: m.get('ts'), author: m.get('author'), isAgent: !!m.get('isAgent'),
    role: m.get('role') || 'user', model: m.get('model') || '', text: m.get('text') ? m.get('text').toString() : '',
    kind: m.get('kind') || '', detail: m.get('detail') || '', status: m.get('status') || '', decidedBy: m.get('decidedBy') || ''
  }))
}

class ChatView {
  constructor (getState, extensionUri) { this.getState = getState; this.extensionUri = extensionUri; this.view = null; this.timer = null }

  resolveWebviewView (view) {
    this.view = view
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')] }
    view.webview.html = html(view.webview, this.extensionUri)
    view.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'ready') this.push()
      if (msg.type === 'send' && msg.text && msg.text.trim()) this.send(msg.text.trim())
      if (msg.type === 'mode') this.setMode(msg.mode)
      if (msg.type === 'runner') this.setRunner(msg.id)
      if (msg.type === 'catchup') this.catchUp()
      if (msg.type === 'commit') vscode.commands.executeCommand('murmio.commit')
      if (msg.type === 'replay') vscode.commands.executeCommand('murmio.replay')
      if (msg.type === 'lens') vscode.commands.executeCommand('murmio.lens')
      if (msg.type === 'decide') this.decide(msg.id, !!msg.ok)
      if (msg.type === 'approvePlan') { this.setMode('acceptEdits'); this.send('@all the plan is approved, go ahead and make the changes.') }
    })
    view.onDidDispose(() => { this.view = null })
    this.push()
  }

  send (text, extra = {}) {
    const s = this.getState()
    if (!s.ydoc) return
    const m = new Y.Map(); const tx = new Y.Text()
    s.ydoc.transact(() => {
      m.set('id', `${s.me.name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`)
      m.set('ts', Date.now()); m.set('author', s.me.name); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx)
      for (const [k, v] of Object.entries(extra)) m.set(k, v)
      s.chat.push([m]); tx.insert(0, text)
    })
  }

  // Ask the agent what happened since this person was last here.
  catchUp (since) {
    const s = this.getState()
    this.send('@coder catch me up', { since: since || s.prevSeen || Date.now() - 30 * 60_000 })
  }

  // a one-line, attributed note in the shared chat (not a message to the agent)
  sendTool (text) {
    const s = this.getState(); if (!s.ydoc) return
    const m = new Y.Map(); const tx = new Y.Text()
    s.ydoc.transact(() => { m.set('id', `note-${Date.now().toString(36)}`); m.set('ts', Date.now()); m.set('author', s.me.name); m.set('isAgent', false); m.set('role', 'tool'); m.set('text', tx); s.chat.push([m]); tx.insert(0, text) })
  }

  setRunner (id) {
    const s = this.getState()
    if (!s.ydoc || s.ydoc.getMap('settings').get('runner') === id) return
    const label = id === 'sandbox' ? 'the sandbox' : ((s.runners || []).find(r => r.id === id) || { label: id }).label
    s.ydoc.transact(() => {
      s.ydoc.getMap('settings').set('runner', id)
      const m = new Y.Map(); const tx = new Y.Text()
      m.set('id', `runner-${Date.now().toString(36)}`); m.set('ts', Date.now()); m.set('author', s.me.name); m.set('isAgent', false); m.set('role', 'tool'); m.set('text', tx)
      s.chat.push([m]); tx.insert(0, `set commands to run on ${label}`)
    })
  }

  setMode (mode) {
    const s = this.getState()
    if (!s.ydoc || !['manual', 'acceptEdits', 'auto', 'plan', 'bypass'].includes(mode) || s.ydoc.getMap('settings').get('agentMode') === mode) return
    s.ydoc.transact(() => {
      s.ydoc.getMap('settings').set('agentMode', mode)
      const m = new Y.Map(); const tx = new Y.Text()
      m.set('id', `mode-${Date.now().toString(36)}`); m.set('ts', Date.now()); m.set('author', s.me.name); m.set('isAgent', false); m.set('role', 'tool'); m.set('text', tx)
      s.chat.push([m]); tx.insert(0, `set the agent mode to ${mode}`)
    })
  }

  // The first person to answer an approval card decides; everyone sees who did.
  decide (id, ok) {
    const s = this.getState()
    const m = s.ydoc && s.chat.toArray().find(x => x.get('id') === id)
    if (!m || m.get('status') !== 'pending') return
    s.ydoc.transact(() => { m.set('status', ok ? 'approved' : 'denied'); m.set('decidedBy', s.me.name) })
  }

  // Keyboard path: answer the newest pending approval card (the one on screen), without reaching for the mouse.
  decideLatest (ok) {
    const s = this.getState(); if (!s.ydoc) return false
    const pending = s.chat.toArray().filter(x => x.get('role') === 'approval' && x.get('status') === 'pending')
    if (!pending.length) return false
    this.decide(pending[pending.length - 1].get('id'), ok); return true
  }

  // throttled: streaming answers change many times a second
  push () {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      const s = this.getState()
      if (!this.view || !s.ydoc) return
      // one chip per person or agent, even when they have several windows open
      const seenNames = new Map()
      for (const [id, v] of s.awareness.getStates()) if (v.user && !(seenNames.has(v.user.name) && id !== s.awareness.clientID)) seenNames.set(String(v.user.name).slice(0, 40), { name: String(v.user.name).slice(0, 40), color: safeColor(v.user.color), isAgent: !!v.user.isAgent, model: v.user.model || '', me: id === s.awareness.clientID })
      const people = [...seenNames.values()]
      const claims = []; for (const [file, c] of s.ydoc.getMap('claims')) if (Date.now() - c.since < (c.ai ? 5 * 60000 : 60000)) claims.push({ file, by: c.by, ai: !!c.ai })
      const usage = []; for (const [k, u] of s.ydoc.getMap('usage')) usage.push({ key: k, tokens: u.prompt + u.completion, calls: u.calls })
      this.view.webview.postMessage({ type: 'state', claims, usage, messages: serialize(s.chat), people, me: s.me.name, mode: s.ydoc.getMap('settings').get('agentMode') || 'manual', runner: s.ydoc.getMap('settings').get('runner') || 'sandbox', runners: s.runners || [] })
    }, 60)
  }
}

// The page itself lives in media/chat.css and media/chat.js (loaded as webview resources, so no inline script is needed).
function html (webview, extensionUri) {
  const uri = f => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', f))
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource};">
<link rel="stylesheet" href="${uri('chat.css')}"></head><body>
<div id="people" aria-label="Who is here"></div>
<div id="controls">
  <label for="mode">Agents</label>
  <select id="mode" title="What agents may do on their own. Manual: ask before every change. Accept edits: edits go through, commands ask. Auto: only risky commands ask. Plan: read-only, plan first. Bypass: no prompts (sandbox only)."><option value="manual">Manual</option><option value="acceptEdits">Accept edits</option><option value="auto">Auto</option><option value="plan">Plan</option><option value="bypass">Bypass</option></select>
  <label for="runner">Runs on</label>
  <select id="runner" title="Which machine agents run commands on"><option value="sandbox">Sandbox (agent container)</option></select>
</div>
<div id="tools"><button id="rp" class="sec" title="Rewind the session like a video">⏪ Replay</button><button id="ln" class="sec" title="Tint every line by who wrote it">✎ Authorship</button><button id="cu" class="sec" title="Ask the agent what happened while you were away">↺ Catch up</button><button id="cm" class="sec" title="Commit the workspace to git">⎇ Commit</button></div>
<div id="meta" aria-live="polite"></div>
<div id="planbar">Plan mode: agents are read-only. <button id="plan">Approve plan</button></div>
<div id="log" role="log" aria-live="polite" aria-label="Team chat"></div>
<div id="bar"><textarea id="in" aria-label="Message" placeholder="Message the team. @coder to ask the agent. Enter to send."></textarea><button id="go">Send</button></div>
<script src="${uri('chat.js')}"></script></body></html>`
}

module.exports = { ChatView }
