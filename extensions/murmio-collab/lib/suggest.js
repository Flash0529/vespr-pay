// Inline suggestions: ghost text you accept with Tab. The request goes to the VESPR server, which asks the agent worker's
// model; the worker adds what teammates and agents just did, so suggestions fit the live session.
const vscode = require('vscode')

const sleep = ms => new Promise(r => setTimeout(r, ms))

function register (context, cfg) {
  const provider = {
    async provideInlineCompletionItems (doc, position, ctx, token) {
      const c = cfg()
      if (!c.get('suggestions') || !c.get('token') || doc.uri.scheme !== 'file' || doc.getText().length > 200000) return
      await sleep(250) // wait for a pause in typing; VS Code cancels this call if you keep typing
      if (token.isCancellationRequested) return
      const offset = doc.offsetAt(position); const full = doc.getText()
      const ac = new AbortController(); token.onCancellationRequested(() => ac.abort())
      try {
        const res = await fetch(c.get('server').replace(/^ws/, 'http').replace(/\/$/, '') + '/api/suggest', {
          method: 'POST', signal: ac.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.get('token')}` },
          body: JSON.stringify({ file: vscode.workspace.asRelativePath(doc.uri), language: doc.languageId, prefix: full.slice(Math.max(0, offset - 3000), offset), suffix: full.slice(offset, offset + 800) })
        })
        if (!res.ok) return
        const j = await res.json()
        if (!j.text || token.isCancellationRequested) return
        vscode.window.setStatusBarMessage(`$(sparkle) VESPR suggestion · ${j.model}${j.used && j.used.length ? ' · used ' + j.used.join(', ') : ''}`, 4000)
        return [new vscode.InlineCompletionItem(j.text, new vscode.Range(position, position))]
      } catch { /* cancelled or offline: no suggestion */ }
    }
  }
  context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider))
}

module.exports = { register }
