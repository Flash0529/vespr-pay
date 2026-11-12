// The search palette's ranking and scope (Search or jump to, Cmd+K). Pure functions, no DOM.
// Why it exists: the old ranker accepted any "letters in order, anywhere" match, so typing "new" listed "Developer Settings: Compute Workers" (n, e, w scattered) and
// buried the chat actually called "New chat"; Chat mode also searched code files, SSH, Cloudflare and Stripe. the team, 2026-11-10: "search bar works".
// Rules: a result must be a real match (starts with it, a word starts with it, it appears inside, every word of the query matches, or the query is the initials of the words).
// Scattered letters only count for file paths (typing "cpy" for cart.py is how people open files). Titles beat subtitles. Chat mode searches chats, agents and messages only.

export const CHAT_ACTIONS = Object.freeze(['Start a new chat', 'Toggle light / dark', 'Open Skills', 'Open Connectors', 'Open Plugins', 'Switch Account / Role', 'Replay Walkthrough Tour'])
export const CHAT_KINDS = Object.freeze(['Conversation', 'Agent', 'Message', 'Action'])

const norm = s => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim()
const words = t => { const out = []; const re = /[a-z0-9]+/g; let m; while ((m = re.exec(t))) out.push({ w: m[0], at: m.index }); return out }

// how well `q` matches `text`: { tier, ranges } (lower tier = better) or null. Ranges are [start, end) pairs in the original text, for highlighting.
export function matchText (query, text, { scattered = false } = {}) {
  const q = norm(query); const t = norm(text)
  if (!q || !t) return null
  if (t.startsWith(q)) return { tier: 1, ranges: [[0, q.length]] }
  const ws = words(t)
  const wp = ws.find(x => x.w.startsWith(q.split(' ')[0]) && t.slice(x.at).startsWith(q))
  if (wp) return { tier: 2, ranges: [[wp.at, wp.at + q.length]] }
  const i = t.indexOf(q)
  if (i >= 0) return { tier: 3, ranges: [[i, i + q.length]] }
  const parts = q.split(' ').filter(Boolean)
  if (parts.length > 1) { // every word of the query appears, in any order
    const ranges = []
    for (const p of parts) { const w = ws.find(x => x.w.startsWith(p)); const j = w ? w.at : t.indexOf(p); if (j < 0) { ranges.length = 0; break } ranges.push([j, j + p.length]) }
    if (ranges.length === parts.length) return { tier: 4, ranges: ranges.sort((a, b) => a[0] - b[0]) }
  }
  const flat = q.replace(/ /g, '')
  if (flat.length >= 2 && flat.length <= ws.length) { // initials: "dsw" for "Developer Settings: Compute Workers" needs consecutive words in order
    for (let s = 0; s + flat.length <= ws.length; s++) if (flat.split('').every((c, k) => ws[s + k].w[0] === c)) return { tier: 5, ranges: flat.split('').map((_, k) => [ws[s + k].at, ws[s + k].at + 1]) }
  }
  if (scattered && flat.length >= 2) { // file paths only: letters in order
    const idx = []; let from = 0
    for (const c of flat) { const p = t.indexOf(c, from); if (p < 0) return null; idx.push(p); from = p + 1 }
    return { tier: 6, ranges: idx.map(p => [p, p + 1]) }
  }
  return null
}

const KIND_ORDER = { Agent: 0, Conversation: 1, Action: 2, Message: 3, File: 4, Memory: 5 }
// items: [{k, t, sub, ...}]; returns the best `limit` with `.hl` (title highlight ranges) and `.tier`. No query: the first `limit` items as given.
export function search (query, items, limit = 12) {
  const q = norm(query)
  if (!q) return items.slice(0, limit)
  const hits = []
  items.forEach((it, n) => {
    const a = matchText(q, it.t, { scattered: it.k === 'File' })
    const b = a ? null : matchText(q, it.sub || '')
    const m = a || (b && { tier: b.tier + 10, ranges: [] })
    if (m) hits.push({ it, tier: m.tier, hl: a ? m.ranges : [], n })
  })
  hits.sort((x, y) => x.tier - y.tier || String(x.it.t).length - String(y.it.t).length || (KIND_ORDER[x.it.k] ?? 9) - (KIND_ORDER[y.it.k] ?? 9) || x.n - y.n)
  return hits.slice(0, limit).map(h => ({ ...h.it, hl: h.hl, tier: h.tier }))
}

// scope: in Chat mode nothing about code, files, hosting or developer tools is searchable
export function inScope (item, mode) {
  if (mode !== 'chat') return true
  if (!CHAT_KINDS.includes(item.k)) return false
  if (item.k === 'Action') return CHAT_ACTIONS.includes(item.t)
  return true
}

const plain = html => String(html == null ? '' : html).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
// message text from chats: [{conv:{id,t}, text(html or plain)}] -> items {k:'Message', t:snippet, sub:'in <chat>', convId}; only messages that contain the query, newest first as given
export function messageItems (query, chats, { max = 6, width = 70 } = {}) {
  const q = norm(query); if (q.length < 3) return []
  const out = []
  for (const c of chats) for (const m of c.messages || []) {
    const text = plain(m); const i = text.toLowerCase().indexOf(q)
    if (i < 0) continue
    const s = Math.max(0, i - Math.floor((width - q.length) / 2)); const e = Math.min(text.length, s + width)
    out.push({ k: 'Message', t: (s > 0 ? '…' : '') + text.slice(s, e) + (e < text.length ? '…' : ''), sub: 'in ' + c.title, convId: c.id })
    if (out.length >= max) return out
  }
  return out
}
