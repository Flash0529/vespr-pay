// Workspace diff and line-change helper for the SDE shell. Pure ES module.
export const MAX_LINES = 1000
export const MAX_LINE_LEN = 1000
export const MAX_DIFF_BYTES = 500000

function cleanText (val) {
  if (typeof val !== 'string') return ''
  return val.replace(/\u0000/g, '').slice(0, MAX_DIFF_BYTES)
}

export function splitLines (text) {
  const clean = cleanText(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!clean) return []
  const raw = clean.split('\n')
  const clamped = []
  const limit = Math.min(raw.length, MAX_LINES)
  for (let i = 0; i < limit; i++) {
    clamped.push(raw[i].slice(0, MAX_LINE_LEN))
  }
  return clamped
}

export function diffLines (oldStr, newStr) {
  const oldLines = splitLines(oldStr)
  const newLines = splitLines(newStr)

  if (oldLines.length === 0 && newLines.length === 0) return []

  // Trim common prefix
  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++
  }

  // Trim common suffix
  let oldEnd = oldLines.length - 1
  let newEnd = newLines.length - 1
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--
    newEnd--
  }

  const items = []
  let oldLineNum = 1
  let newLineNum = 1

  // Push common prefix
  for (let i = 0; i < start; i++) {
    items.push({
      type: 'eq',
      text: oldLines[i],
      oldLine: oldLineNum++,
      newLine: newLineNum++
    })
  }

  // Compute LCS on middle segment
  const midOld = oldLines.slice(start, oldEnd + 1)
  const midNew = newLines.slice(start, newEnd + 1)

  const n = midOld.length
  const m = midNew.length

  if (n > 0 || m > 0) {
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        if (midOld[i] === midNew[j]) {
          dp[i + 1][j + 1] = dp[i][j] + 1
        } else {
          dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1])
        }
      }
    }

    // Backtrack to find diff operations
    const midOps = []
    let i = n
    let j = m
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && midOld[i - 1] === midNew[j - 1]) {
        midOps.push({ type: 'eq', text: midOld[i - 1] })
        i--
        j--
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        midOps.push({ type: 'add', text: midNew[j - 1] })
        j--
      } else if (i > 0) {
        midOps.push({ type: 'del', text: midOld[i - 1] })
        i--
      }
    }

    midOps.reverse()
    for (const op of midOps) {
      if (op.type === 'eq') {
        items.push({
          type: 'eq',
          text: op.text,
          oldLine: oldLineNum++,
          newLine: newLineNum++
        })
      } else if (op.type === 'del') {
        items.push({
          type: 'del',
          text: op.text,
          oldLine: oldLineNum++
        })
      } else if (op.type === 'add') {
        items.push({
          type: 'add',
          text: op.text,
          newLine: newLineNum++
        })
      }
    }
  }

  // Push common suffix
  for (let k = oldEnd + 1; k < oldLines.length; k++) {
    items.push({
      type: 'eq',
      text: oldLines[k],
      oldLine: oldLineNum++,
      newLine: newLineNum++
    })
  }

  return items
}

export function summary (diffOrItems) {
  let items = []
  if (Array.isArray(diffOrItems)) {
    items = diffOrItems
  } else if (diffOrItems && Array.isArray(diffOrItems.hunks)) {
    for (const h of diffOrItems.hunks) {
      if (Array.isArray(h.lines)) items.push(...h.lines)
    }
  }

  let additions = 0
  let deletions = 0
  let unchanged = 0

  for (const it of items) {
    if (it && it.type === 'add') additions++
    else if (it && it.type === 'del') deletions++
    else if (it && it.type === 'eq') unchanged++
  }

  return {
    additions,
    deletions,
    unchanged,
    total: additions + deletions + unchanged
  }
}

export function formatBadge (input) {
  let add = 0
  let del = 0

  if (Array.isArray(input)) {
    const s = summary(input)
    add = s.additions
    del = s.deletions
  } else if (input && typeof input === 'object') {
    add = typeof input.additions === 'number' ? Math.max(0, input.additions) : 0
    del = typeof input.deletions === 'number' ? Math.max(0, input.deletions) : 0
  }

  if (add === 0 && del === 0) return '0'
  if (add > 0 && del > 0) return '+' + add + ' \u2212' + del
  if (add > 0) return '+' + add
  return '\u2212' + del
}

export function parsePatch (patchStr) {
  const lines = splitLines(patchStr)
  const hunks = []
  let curHunk = null

  let additions = 0
  let deletions = 0

  for (const line of lines) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      continue // Skip file header lines
    }

    if (line.startsWith('@@')) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
      if (match) {
        curHunk = {
          header: line,
          oldStart: parseInt(match[1], 10),
          oldCount: match[2] ? parseInt(match[2], 10) : 1,
          newStart: parseInt(match[3], 10),
          newCount: match[4] ? parseInt(match[4], 10) : 1,
          lines: []
        }
        hunks.push(curHunk)
        continue
      }
    }

    if (line.startsWith('+')) {
      if (!curHunk) {
        curHunk = {
          header: '@@ -1,1 +1,1 @@',
          oldStart: 1,
          oldCount: 0,
          newStart: 1,
          newCount: 0,
          lines: []
        }
        hunks.push(curHunk)
      }
      additions++
      curHunk.lines.push({ type: 'add', text: line.slice(1) })
    } else if (line.startsWith('-')) {
      if (!curHunk) {
        curHunk = {
          header: '@@ -1,1 +1,1 @@',
          oldStart: 1,
          oldCount: 0,
          newStart: 1,
          newCount: 0,
          lines: []
        }
        hunks.push(curHunk)
      }
      deletions++
      curHunk.lines.push({ type: 'del', text: line.slice(1) })
    } else if (line.startsWith(' ') && curHunk) {
      curHunk.lines.push({ type: 'eq', text: line.slice(1) })
    }
  }

  return {
    hunks,
    summary: {
      additions,
      deletions,
      total: additions + deletions
    }
  }
}

export function formatUnified (filename, oldStr, newStr, options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const fname = typeof filename === 'string' && filename ? filename : 'file'

  const items = diffLines(oldStr, newStr)
  if (items.length === 0) return ''

  const s = summary(items)
  if (s.additions === 0 && s.deletions === 0) return ''

  const header = '--- a/' + fname + '\n+++ b/' + fname
  const hunkLines = []
  let oldStart = 1
  let newStart = 1
  let oldCount = 0
  let newCount = 0

  for (const it of items) {
    if (it.type === 'eq') {
      oldCount++
      newCount++
      hunkLines.push(' ' + it.text)
    } else if (it.type === 'del') {
      oldCount++
      hunkLines.push('-' + it.text)
    } else if (it.type === 'add') {
      newCount++
      hunkLines.push('+' + it.text)
    }
  }

  const hunkHeader = '@@ -' + oldStart + ',' + oldCount + ' +' + newStart + ',' + newCount + ' @@'
  return header + '\n' + hunkHeader + '\n' + hunkLines.join('\n')
}