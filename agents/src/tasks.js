import { createHash } from 'node:crypto'

const MAX_FILES = 500
const MAX_CHARS = 2 * 1024 * 1024
const MAX_FILE_CHARS = 256 * 1024
const MAX_RESULTS = 100
const SKIP_SEGMENTS = new Set(['.git', '.next', '.nuxt', '.cache', 'node_modules', 'vendor', 'dist', 'build', 'coverage', 'generated', '.turbo', '.venv', 'venv', 'target', 'out', '__pycache__'])
const SKIP_FILES = /(?:\.min\.(?:js|css)$|\.map$|(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|composer\.lock|Cargo\.lock|Gemfile\.lock)$|(?:^|\/)\.env(?:\.|$)|\.(?:png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|woff2?|ttf|otf|mp[34]|sqlite|db|pem|key|p12|pfx))$/i
const COMMENT_START = /(?:^|\s)(?:\/\/|#|--|;|%|\/\*|<!--|\*|REM\s+)/i
const MARKER = /\b(TODO|FIXME)\b\s*:?\s*(.*)/i

function eligible (path) {
  return !path.split('/').some(part => SKIP_SEGMENTS.has(part.toLowerCase())) && !SKIP_FILES.test(path)
}

function scan (room, { path: filter = '', limit = MAX_RESULTS } = {}) {
  const prefix = String(filter).trim().replace(/^\/+/, '')
  const cap = Math.max(1, Math.min(MAX_RESULTS, Number(limit) || MAX_RESULTS))
  const paths = room.list().filter(p => eligible(p) && (!prefix || p === prefix || p.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'))).sort()
  const tasks = [], seen = new Map()
  let scannedFiles = 0, skippedFiles = 0, scannedChars = 0, truncated = false
  for (const file of paths) {
    if (scannedFiles >= MAX_FILES || scannedChars >= MAX_CHARS) { truncated = true; break }
    const source = room.read(file)
    if (typeof source !== 'string' || source.length > MAX_FILE_CHARS || source.includes('\0')) { skippedFiles++; continue }
    if (scannedChars + source.length > MAX_CHARS) { truncated = true; break }
    scannedFiles++; scannedChars += source.length
    const lines = source.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const start = COMMENT_START.exec(lines[i])
      if (!start) continue
      const match = MARKER.exec(lines[i].slice(start.index + start[0].length))
      if (!match) continue
      const marker = match[1].toUpperCase()
      const text = match[2].replace(/(?:\*\/|-->).*$/, '').trim().replace(/\s+/g, ' ')
      const sig = file + '\0' + marker + '\0' + text
      const occurrence = (seen.get(sig) || 0) + 1
      seen.set(sig, occurrence)
      const id = 'task-' + createHash('sha256').update(sig + '\0' + occurrence).digest('hex').slice(0, 16)
      tasks.push({ id, path: file, line: i + 1, marker, text })
      if (tasks.length >= cap) { truncated = true; break }
    }
    if (tasks.length >= cap) break
  }
  return { tasks, scannedFiles, skippedFiles, scannedChars, truncated }
}

export function findTasks (room, options = {}) { return scan(room, options) }

export function claimTask (room, { id, path } = {}) {
  if (room.mode() === 'plan') return { error: 'plan mode is read-only; switch modes before claiming' }
  const taskId = String(id || '').trim()
  const file = String(path || '').trim().replace(/^\/+/, '')
  if (!taskId || !file) return { error: 'task id and path are required; run find_tasks first' }
  const current = scan(room, { path: file, limit: MAX_RESULTS })
  const task = current.tasks.find(item => item.id === taskId)
  if (!task) return { error: 'stale task: comment changed or disappeared; run find_tasks again' }
  const owner = room.claimedByOther(file)
  if (owner) return { error: 'file already claimed by ' + owner.by, path: file, task }
  room.claim(file)
  return { claimed: true, path: file, task, note: 'File claim is released when this agent response ends.' }
}
