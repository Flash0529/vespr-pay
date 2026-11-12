// Context by highlight and by copy and paste: remember where text was copied from inside the app, so a paste into the message box brings the place with it
// (file, lines, the lines around it; or who wrote the chat message and in which conversation) instead of only the characters.
// Pure functions, no DOM: the shell wires them to the copy and paste events, Node tests run them.

// Copy and paste change spaces, tabs and line ends; match on the words, not the whitespace.
export const normalize = t => String(t == null ? '' : t).replace(/ /g, ' ').replace(/\s+/g, ' ').trim()

// A small memory of recent copies from inside the app: normalized text -> where it came from. Oldest drops first.
export function createProvenance (max = 12) {
  const items = []
  return {
    remember (text, info) {
      const key = normalize(text); if (key.length < 3 || !info) return false
      const i = items.findIndex(x => x.key === key); if (i >= 0) items.splice(i, 1)
      items.push({ key, info, at: Date.now() }); while (items.length > max) items.shift()
      return true
    },
    find (text) { const key = normalize(text); const hit = items.find(x => x.key === key); return hit ? hit.info : null },
    size: () => items.length
  }
}

// The lines around a selection: lo and hi are 1-based and inclusive; n lines before and after. Returns the exact selected lines too.
export function lineContext (fullText, lo, hi, n = 3) {
  const lines = String(fullText == null ? '' : fullText).split('\n')
  lo = Math.max(1, Math.min(lines.length, Math.floor(lo) || 1)); hi = Math.max(lo, Math.min(lines.length, Math.floor(hi) || lo))
  const num = (a, b) => lines.slice(a - 1, b).map((l, i) => `${a + i}: ${l}`).join('\n')
  return { lo, hi, before: lo > 1 ? num(Math.max(1, lo - n), lo - 1) : '', after: hi < lines.length ? num(hi + 1, Math.min(lines.length, hi + n)) : '', total: lines.length }
}

// What to attach to a message, from the facts the shell collected. Only known fields; the client and the agent cap and clean them again.
export function buildContext (f) {
  f = f || {}
  const text = String(f.text || '').trim(); if (!text) return null
  const kind = ['code', 'chat', 'terminal', 'history'].includes(f.kind) ? f.kind : 'text'
  const c = { kind, src: String(f.src || '').slice(0, 120), text: text.length > 2000 ? text.slice(0, 2000) : text }
  if (f.file) c.file = String(f.file).slice(0, 200)
  if (f.lines && f.lines[0]) c.lines = [f.lines[0], f.lines[1] || f.lines[0]]
  for (const k of ['by', 'author', 'thread']) if (f[k]) c[k] = String(f[k]).slice(0, k === 'thread' ? 64 : 60)
  if (f.ts) c.ts = f.ts
  if (f.before) c.before = String(f.before).slice(0, 600)
  if (f.after) c.after = String(f.after).slice(0, 600)
  return c
}

// The short label on a context box: "cart.py · lines 4–9" or "sam in Fix the discount bug".
export function label (c) {
  if (!c) return ''
  if (c.file) return c.file + (c.lines ? (c.lines[0] === c.lines[1] ? ` · line ${c.lines[0]}` : ` · lines ${c.lines[0]}–${c.lines[1]}`) : '')
  if (c.kind === 'chat') return (c.author ? c.author : 'a message') + (c.thread ? ` in ${c.thread}` : '')
  return c.src || c.kind || 'selection'
}


// Check if text looks like source code or script syntax (Ask #301)
export function isCodeLike (text) {
  const s = String(text ?? '').trim()
  if (s.length < 25) return false
  const codePatterns = [
    /\b(def|class|function|import|export|const|let|var|return)\b/,
    /[{};]\s*$/,
    /^\s*(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/i,
    /^\s*curl\s+-[A-Za-z]/i,
    /<\/?(script|div|html|body|component)/i,
    /=>|\(\)\s*=>/
  ]
  const lines = s.split('\n')
  return codePatterns.some(p => p.test(s)) || (lines.length >= 3 && lines.some(l => /^\s{2,}\S/.test(l)))
}

// Ask #301: Uncontextualized external code paste guard
// Warns when external code lacks workspace provenance before sending
export function checkPasteSafety (text, { provenance = null, hasPermToShare = true } = {}) {
  const s = String(text ?? '').trim()
  if (!s || !isCodeLike(s)) return { warn: false, isCode: false }
  if (provenance && typeof provenance.find === 'function' && provenance.find(s)) {
    return { warn: false, isCode: true, internal: true }
  }
  return {
    warn: true,
    isCode: true,
    reason: 'uncontextualized_external_code',
    defaultAction: 'cancel',
    canAttachContext: !!hasPermToShare,
    message: 'External code snippet lacks workspace context. The agent may give incomplete or hallucinated changes without file structure.'
  }
}
