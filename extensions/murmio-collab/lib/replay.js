// Session replay: rebuild the shared workspace as it was at any moment from the server's session log.
// Pure Yjs, no VS Code imports, so it is testable with plain Node.
const { fileStore } = require('./file-store.cjs')
const Y = require('yjs')
const { spansOf } = require('./binding')

// Record: kind (1 byte: 0 base state, 1 document update, 2 presence) | time ms (8 bytes) | length (4 bytes) | payload
function parseLog (buf) {
  const records = []
  let o = 0
  while (o + 13 <= buf.length) {
    const kind = buf.readUInt8(o); const ts = buf.readDoubleBE(o + 1); const len = buf.readUInt32BE(o + 9)
    if (o + 13 + len > buf.length) break // a half-written tail record
    records.push({ kind, ts, payload: buf.subarray(o + 13, o + 13 + len) })
    o += 13 + len
  }
  return records
}

class Replay {
  constructor (records) { this.records = records; this.reset() }
  reset () { this.doc = new Y.Doc(); this.at = -1; this.presence = new Map() }
  get length () { return this.records.length }
  get startTs () { return this.records.length ? this.records[0].ts : 0 }
  get endTs () { return this.records.length ? this.records[this.records.length - 1].ts : 0 }

  // Move to just after record i (forward is incremental; going back rebuilds from the start).
  seek (i) {
    i = Math.max(0, Math.min(this.records.length - 1, i))
    if (i < this.at) this.reset()
    for (let k = this.at + 1; k <= i; k++) {
      const r = this.records[k]
      if (r.kind === 0 || r.kind === 1) Y.applyUpdate(this.doc, r.payload)
      else if (r.kind === 2) for (const { id, state } of JSON.parse(r.payload.toString())) state ? this.presence.set(id, state) : this.presence.delete(id)
    }
    this.at = i
    return this
  }

  // the file with the most text written by people or agents (not imported): the interesting one to show first
  busiestFile (names) {
    let best = names[0]; let score = -1
    for (const n of names) { let s = 0; for (const sp of spansOf(fileStore(this.doc).get(n))) if (sp.attrs.by && sp.attrs.by !== 'import') s += sp.end - sp.start; if (s > score) { score = s; best = n } }
    return best
  }

  // What the workspace looked like: files, chat, mode, who was where.
  frame (i, file) {
    this.seek(i)
    const files = fileStore(this.doc)
    const names = [...files.keys()].sort()
    const pick = file && files.get(file) ? file : this.busiestFile(names)
    const text = pick ? files.get(pick) : null
    const cursors = []
    for (const [id, s] of this.presence) {
      if (!s.user || !s.cursor || !s.cursor.head || !text) continue
      const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(s.cursor.head), this.doc)
      if (abs && abs.type === text) cursors.push({ name: s.user.name, color: s.user.color, isAgent: !!s.user.isAgent, index: abs.index })
    }
    return {
      i: this.at, ts: this.records[this.at].ts, total: this.records.length, startTs: this.startTs, endTs: this.endTs,
      files: names, file: pick || null, text: text ? text.toString() : '', spans: text ? spansOf(text) : [], cursors,
      people: [...this.presence.values()].filter(s => s.user).map(s => ({ name: s.user.name, color: s.user.color, isAgent: !!s.user.isAgent })),
      mode: this.doc.getMap('settings').get('agentMode') || 'manual',
      chat: this.doc.getArray('chat').toArray().map(m => ({
        id: m.get('id'), ts: m.get('ts'), author: m.get('author'), isAgent: !!m.get('isAgent'), role: m.get('role') || 'user', model: m.get('model') || '',
        text: m.get('text') ? m.get('text').toString() : '', kind: m.get('kind') || '', detail: m.get('detail') || '', status: m.get('status') || '', decidedBy: m.get('decidedBy') || ''
      }))
    }
  }
}

module.exports = { parseLog, Replay }
