// Editor minimap and density map generator for the SDE shell. Pure ES module.
export const MAX_LINES = 10000
export const MAX_LINE_CHARS = 1000
export const DEFAULT_MAX_PERCENT = 100
export const DEFAULT_SCALE = 2.2
export const MAX_BARS = 120

function cleanText (val) {
  if (typeof val !== 'string') return ''
  return val.replace(/\u0000/g, '')
}

function cleanNumber (val, fallback = 0) {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return Math.floor(val)
  }
  return fallback
}

export function lineWidthPercent (line, options = {}) {
  if (typeof line !== 'string') return 0
  const clean = line.replace(/<[^>]+>/g, '').replace(/\t/g, '    ').trimEnd().slice(0, MAX_LINE_CHARS)
  if (!clean.trim()) return 0

  const scale = typeof options.scale === 'number' && Number.isFinite(options.scale)
    ? Math.max(0.1, options.scale)
    : DEFAULT_SCALE

  const maxPercent = typeof options.maxPercent === 'number' && Number.isFinite(options.maxPercent)
    ? Math.max(1, Math.min(100, Math.floor(options.maxPercent)))
    : DEFAULT_MAX_PERCENT

  const raw = clean.length * scale
  return Math.max(4, Math.min(maxPercent, Math.round(raw)))
}

export function computeLines (textOrLines, diffs = [], options = {}) {
  let rawLines = []
  if (Array.isArray(textOrLines)) {
    rawLines = textOrLines
  } else if (typeof textOrLines === 'string') {
    rawLines = cleanText(textOrLines).split('\n')
  }

  if (rawLines.length === 0) return []
  const limit = Math.min(rawLines.length, MAX_LINES)

  // Map line numbers to diff status (chg, del, add)
  const diffMap = new Map()
  if (Array.isArray(diffs)) {
    for (const d of diffs) {
      if (!d || typeof d !== 'object') continue
      const lineNum = typeof d.line === 'number' ? d.line : (typeof d.newLine === 'number' ? d.newLine : d.oldLine)
      const type = typeof d.type === 'string' ? d.type.toLowerCase().trim() : ''
      if (lineNum > 0 && (type === 'add' || type === 'del' || type === 'chg')) {
        diffMap.set(lineNum, type)
      }
    }
  }

  const items = []
  for (let i = 0; i < limit; i++) {
    const lineNum = i + 1
    const lineStr = String(rawLines[i] || '')
    const width = lineWidthPercent(lineStr, options)
    const type = diffMap.get(lineNum) || ''
    items.push({ line: lineNum, width, type })
  }

  return items
}

const TYPE_PRIORITY = { chg: 3, del: 2, add: 1, '': 0 }

export function sampleLines (items, maxBars = MAX_BARS) {
  if (!Array.isArray(items)) return []
  if (items.length <= maxBars) return items.map(it => ({ ...it }))

  const targetBars = Math.max(10, Math.min(MAX_BARS, cleanNumber(maxBars, MAX_BARS)))
  const stride = items.length / targetBars
  const sampled = []

  for (let b = 0; b < targetBars; b++) {
    const start = Math.floor(b * stride)
    const end = Math.min(items.length, Math.floor((b + 1) * stride))

    let maxW = 0
    let highestType = ''

    for (let k = start; k < end; k++) {
      const it = items[k]
      if (it.width > maxW) maxW = it.width
      const curPri = TYPE_PRIORITY[highestType] || 0
      const itPri = TYPE_PRIORITY[it.type] || 0
      if (itPri > curPri) highestType = it.type
    }

    sampled.push({
      line: start + 1,
      width: maxW,
      type: highestType
    })
  }

  return sampled
}

export function renderMinimapHtml (textOrLines, diffs = [], options = {}) {
  let items = computeLines(textOrLines, diffs, options)
  if (items.length === 0) return ''

  if (typeof options.maxBars === 'number' && Number.isFinite(options.maxBars) && items.length > options.maxBars) {
    items = sampleLines(items, options.maxBars)
  }

  let html = ''
  for (const it of items) {
    const cls = it.type ? ' class="' + it.type + '"' : ''
    html += '<i' + cls + ' style="width:' + it.width + '%"></i>'
  }

  return html
}

export function viewportSlider (totalLines, rawTopLine, rawVisibleLines) {
  const total = cleanNumber(totalLines, 0)
  if (total <= 0) return { topPercent: 0, heightPercent: 100 }

  const topLine = Math.max(1, Math.min(total, cleanNumber(rawTopLine, 1)))
  const visible = Math.max(1, cleanNumber(rawVisibleLines, 10))

  const heightPercent = Math.max(5, Math.min(100, Math.round((visible / total) * 100)))
  let topPercent = Math.max(0, Math.min(100, Math.round(((topLine - 1) / total) * 100)))

  if (topPercent + heightPercent > 100) {
    topPercent = Math.max(0, 100 - heightPercent)
  }

  return { topPercent, heightPercent }
}