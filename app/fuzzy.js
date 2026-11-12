// Search-as-you-type fuzzy matcher for command palette and file navigation. Pure ES module.
export const MAX_TEXT = 300
export const MAX_RESULTS = 50

const WORD_DELIMS = new Set(['/', '_', '-', '.', ' '])

export function score (query, text) {
  if (typeof query !== 'string' || typeof text !== 'string') return null
  const qOrig = query.replace(/\s+/g, '')
  const q = qOrig.toLowerCase()
  if (!q) return 0

  const origText = text.slice(0, MAX_TEXT)
  const t = origText.toLowerCase()

  const indices = []
  let tIdx = 0
  for (let k = 0; k < q.length; k++) {
    const pos = t.indexOf(q[k], tIdx)
    if (pos === -1) return null
    indices.push(pos)
    tIdx = pos + 1
  }

  let total = 100 * q.length
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k]
    if (i === 0) total += 30
    if (i === 0 || WORD_DELIMS.has(t[i - 1])) total += 25
    if (k > 0 && i === indices[k - 1] + 1) total += 20
    if (origText[i] === qOrig[k]) total += 5
  }

  const penalty = Math.max(0, origText.length - q.length)
  return Math.max(1, total - penalty)
}

export function rank (query, items, getText = x => x, limit = MAX_RESULTS) {
  if (!Array.isArray(items)) return []
  const max = Math.max(1, Math.min(MAX_RESULTS, typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : MAX_RESULTS))
  const qRaw = typeof query === 'string' ? query.replace(/\s+/g, '') : ''
  if (!qRaw) return items.slice(0, max)

  const scored = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const txt = String(getText ? getText(item) : item)
    const s = score(query, txt)
    if (s !== null) {
      scored.push({ item, score: s, len: txt.length, index: i })
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.len !== b.len) return a.len - b.len
    return a.index - b.index
  })

  return scored.slice(0, max).map(x => x.item)
}

export function highlight (query, text) {
  if (typeof query !== 'string' || typeof text !== 'string') return []
  const q = query.replace(/\s+/g, '').toLowerCase()
  if (!q) return []

  const origText = text.slice(0, MAX_TEXT)
  const t = origText.toLowerCase()

  const indices = []
  let tIdx = 0
  for (let k = 0; k < q.length; k++) {
    const pos = t.indexOf(q[k], tIdx)
    if (pos === -1) return []
    indices.push(pos)
    tIdx = pos + 1
  }

  const ranges = []
  let start = indices[0]
  let prev = indices[0]
  for (let k = 1; k < indices.length; k++) {
    const cur = indices[k]
    if (cur === prev + 1) {
      prev = cur
    } else {
      ranges.push([start, prev + 1])
      start = cur
      prev = cur
    }
  }
  ranges.push([start, prev + 1])
  return ranges
}
