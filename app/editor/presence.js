// Cursors and selections through the shared awareness: pure, no DOM. Contract: docs/EDITOR.md.
// The wire format is the one the VS Code extension and the agents already write and the shell reads:
//   awareness field `cursor` = { file: <path>, anchor: <Y.RelativePosition JSON>, head: <Y.RelativePosition JSON> }
//   awareness field `user`   = { name, color, isAgent, model }
// Relative positions (not numbers) so a caret stays with its character while other people type.

// Publish the local selection. anchor/head are indexes into `ytext`; either one null (or no file) clears it.
export function setLocalSelection ({ Y, awareness, ytext, file, anchor, head }) {
  if (!awareness) return
  if (!file || anchor == null || head == null) { awareness.setLocalStateField('cursor', null); return }
  // plain objects (not Yjs ID instances), so the state compares and serializes the same locally and on the wire
  const rel = i => JSON.parse(JSON.stringify(Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, Math.max(0, Math.min(i, ytext.length))))))
  awareness.setLocalStateField('cursor', { file, anchor: rel(anchor), head: rel(head) })
}

// Everyone else who is in `file`, as absolute indexes into `ytext`. Never yourself, never a file other than this one, never
// a selection that does not resolve to this text (stale, malformed or from another document: a peer's data must not throw).
export function remoteSelections ({ Y, awareness, ytext, file }) {
  const out = []
  if (!awareness || !ytext.doc) return out
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID || !state || !state.user || !state.cursor || state.cursor.file !== file) continue
    let a; let h
    try {
      a = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(state.cursor.anchor), ytext.doc)
      h = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(state.cursor.head), ytext.doc)
    } catch { continue }
    if (!a || !h || a.type !== ytext || h.type !== ytext) continue
    const u = state.user
    out.push({ clientId, name: String(u.name || 'someone').slice(0, 64), color: typeof u.color === 'string' ? u.color : '', isAgent: !!u.isAgent, anchor: a.index, head: h.index })
  }
  return out.sort((x, y) => x.clientId - y.clientId)
}
