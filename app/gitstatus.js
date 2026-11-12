// Git porcelain status parser and source control helper. Pure ES module.
export const MAX_ENTRIES = 500
export const MAX_PATH = 300
export const MAX_LINE = 1000

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])
const VALID_STAGED = new Set([' ', 'M', 'A', 'D', 'R', 'C', 'U', '?'])
const VALID_UNSTAGED = new Set([' ', 'M', 'D', 'A', 'U', '?'])

function cleanLine (val) {
  if (typeof val !== 'string') return ''
  return val.replace(/\u0000/g, '').replace(/[\r\n]+$/, '')
}

function stripQuotes (str) {
  if (str.startsWith('"') && str.endsWith('"') && str.length >= 2) {
    return str.slice(1, -1)
  }
  return str
}

export function parseStatus (rawOutput) {
  const defaultResult = {
    branch: '',
    upstream: null,
    ahead: 0,
    behind: 0,
    isDetached: false,
    entries: [],
    summary: {
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      conflictCount: 0,
      total: 0,
      isClean: true
    }
  }

  if (typeof rawOutput !== 'string') return defaultResult
  const rawLines = rawOutput.split(/\r?\n/)
  if (rawLines.length === 0) return defaultResult

  let branch = ''
  let upstream = null
  let ahead = 0
  let behind = 0
  let isDetached = false
  const entries = []

  for (const rawLine of rawLines) {
    const line = cleanLine(rawLine).slice(0, MAX_LINE)
    if (!line) continue

    if (line.startsWith('## ')) {
      const rest = line.slice(3).trim()
      if (rest.startsWith('HEAD (no branch)')) {
        branch = 'HEAD'
        isDetached = true
      } else if (rest.startsWith('Initial commit on ') || rest.startsWith('No commits yet on ')) {
        const parts = rest.split(' on ')
        branch = parts[1] ? parts[1].trim() : 'main'
      } else {
        const bracketIdx = rest.indexOf(' [')
        const branchPart = bracketIdx >= 0 ? rest.slice(0, bracketIdx) : rest
        const trackPart = bracketIdx >= 0 ? rest.slice(bracketIdx + 2, -1) : ''

        const dotIdx = branchPart.indexOf('...')
        if (dotIdx >= 0) {
          branch = branchPart.slice(0, dotIdx).trim()
          upstream = branchPart.slice(dotIdx + 3).trim() || null
        } else {
          branch = branchPart.trim()
        }

        if (trackPart) {
          const aheadMatch = trackPart.match(/ahead\s+(\d+)/)
          if (aheadMatch) ahead = parseInt(aheadMatch[1], 10)
          const behindMatch = trackPart.match(/behind\s+(\d+)/)
          if (behindMatch) behind = parseInt(behindMatch[1], 10)
        }
      }
      continue
    }

    if (line.length < 4) continue
    if (entries.length >= MAX_ENTRIES) break

    const staged = line[0]
    const unstaged = line[1]
    const sep = line[2]

    // Validate standard Git porcelain status column formatting
    if (!VALID_STAGED.has(staged) || !VALID_UNSTAGED.has(unstaged) || sep !== ' ') continue

    const pathPart = line.slice(3).trim()
    if (!pathPart) continue

    const code = staged + unstaged
    const isConflicted = CONFLICT_CODES.has(code)
    const isUntracked = code === '??'
    const isStaged = !isUntracked && !isConflicted && staged !== ' '
    const isUnstaged = !isUntracked && !isConflicted && unstaged !== ' '

    let path = ''
    let origPath = null

    const arrowIdx = pathPart.indexOf(' -> ')
    if (arrowIdx >= 0) {
      origPath = stripQuotes(pathPart.slice(0, arrowIdx).trim()).slice(0, MAX_PATH)
      path = stripQuotes(pathPart.slice(arrowIdx + 4).trim()).slice(0, MAX_PATH)
    } else {
      path = stripQuotes(pathPart).slice(0, MAX_PATH)
    }

    entries.push({
      staged,
      unstaged,
      path,
      origPath,
      isStaged,
      isUnstaged,
      isUntracked,
      isConflicted
    })
  }

  let stagedCount = 0
  let unstagedCount = 0
  let untrackedCount = 0
  let conflictCount = 0

  for (const it of entries) {
    if (it.isConflicted) conflictCount++
    else if (it.isUntracked) untrackedCount++
    else {
      if (it.isStaged) stagedCount++
      if (it.isUnstaged) unstagedCount++
    }
  }

  const total = entries.length
  const isClean = total === 0

  return {
    branch,
    upstream,
    ahead,
    behind,
    isDetached,
    entries,
    summary: {
      stagedCount,
      unstagedCount,
      untrackedCount,
      conflictCount,
      total,
      isClean
    }
  }
}

export function formatStatusLine (status) {
  if (!status || typeof status !== 'object') return 'main'
  const branch = (typeof status.branch === 'string' && status.branch.trim()) || 'main'
  const ahead = typeof status.ahead === 'number' && Number.isFinite(status.ahead) ? Math.max(0, status.ahead) : 0
  const behind = typeof status.behind === 'number' && Number.isFinite(status.behind) ? Math.max(0, status.behind) : 0

  if (behind > 0 && ahead > 0) {
    return branch + ' ' + behind + '\u2193 ' + ahead + '\u2191'
  }
  if (behind > 0) {
    return branch + ' ' + behind + '\u2193'
  }
  if (ahead > 0) {
    return branch + ' ' + ahead + '\u2191'
  }
  return branch
}

export function formatFileBadge (entry) {
  if (!entry || typeof entry !== 'object') return 'M'
  if (entry.isConflicted) return '!'
  if (entry.isUntracked) return '?'
  if (entry.isStaged && entry.isUnstaged) return 'M'
  if (entry.isStaged) return entry.staged
  if (entry.isUnstaged) return entry.unstaged
  return 'M'
}

export function groupEntries (entries) {
  const result = {
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: []
  }

  if (!Array.isArray(entries)) return result

  for (const it of entries) {
    if (!it || typeof it !== 'object') continue
    if (it.isConflicted) result.conflicted.push(it)
    else if (it.isUntracked) result.untracked.push(it)
    else {
      if (it.isStaged) result.staged.push(it)
      if (it.isUnstaged) result.unstaged.push(it)
    }
  }

  return result
}