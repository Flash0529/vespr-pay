// Pure helpers that translate between VS Code text changes and Yjs Y.Text operations.
// No VS Code imports, so they can be tested with plain Node.

// VS Code reports every change in one event relative to the document BEFORE the event.
// Apply them from the end of the document to the start so earlier offsets stay valid.
function applyChangesToYText (ytext, changes, origin, attrs) {
  const ordered = [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset)
  ytext.doc.transact(() => {
    for (const c of ordered) {
      if (c.rangeLength > 0) ytext.delete(c.rangeOffset, c.rangeLength)
      if (c.text) attrs ? ytext.insert(c.rangeOffset, c.text, attrs) : ytext.insert(c.rangeOffset, c.text)
    }
  }, origin)
}

// A Y.Text event delta is [{retain},{insert},{delete}] relative to the text BEFORE the event.
// Returns [{ start, end, text }] in offsets of that old text; all non-overlapping, so a single
// WorkspaceEdit (which also uses old coordinates) applies them atomically.
function deltaToEdits (delta) {
  const edits = []
  let pos = 0
  for (const op of delta) {
    if (op.retain != null) pos += op.retain
    else if (typeof op.insert === 'string') edits.push({ start: pos, end: pos, text: op.insert })
    else if (op.delete != null) { edits.push({ start: pos, end: pos + op.delete, text: '' }); pos += op.delete }
  }
  // merge a delete directly followed/preceded by an insert at the same spot into one replacement
  const merged = []
  for (const e of edits) {
    const last = merged[merged.length - 1]
    if (last && last.end === e.start && (last.text === '' || e.start === e.end)) {
      last.end = Math.max(last.end, e.end); last.text += e.text
    } else merged.push({ ...e })
  }
  return merged
}

// Who wrote what: every insert carries { by, t } (and for agents { ai, model, msg }) as Yjs formatting attributes,
// so authorship lives in the document itself and survives merges, concurrent edits and replay.
// Returns [{ start, end, attrs }] covering the whole text in offset order.
function spansOf (ytext) {
  const out = []; let pos = 0
  for (const op of ytext.toDelta()) {
    if (typeof op.insert !== 'string') continue
    out.push({ start: pos, end: pos + op.insert.length, attrs: op.attributes || {} })
    pos += op.insert.length
  }
  return out
}
const spanAt = (spans, offset) => spans.find(s => offset >= s.start && offset < s.end) || spans.find(s => offset === s.end) || null

// The smallest single edit that turns text `have` into text `want`: replace have[start, end) with `text`.
// Used to bring a VS Code document in line with the shared text in one step, however many remote edits arrived meanwhile.
function diffEdit (have, want) {
  let a = 0
  while (a < have.length && a < want.length && have[a] === want[a]) a++
  let z = 0
  while (z < have.length - a && z < want.length - a && have[have.length - 1 - z] === want[want.length - 1 - z]) z++
  return { start: a, end: have.length - z, text: want.slice(a, want.length - z) }
}

// Stable color per name (agents get a distinct hue family).
function colorFor (name, isAgent) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return isAgent ? `hsl(${150 + (h % 60)}, 70%, 55%)` : `hsl(${(h % 12) * 30}, 75%, 58%)`
}

// Colors come from other people's clients: only accept plain hsl()/hex values before putting them in HTML or styles.
const safeColor = c => (/^(hsla?\([\d.,% ]+\)|#[0-9a-fA-F]{3,8})$/.test(c || '') ? c : '#888888')

module.exports = { applyChangesToYText, deltaToEdits, colorFor, spansOf, spanAt, safeColor, diffEdit }
