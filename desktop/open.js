// Pure parsing helper for native open on Windows, macOS, and Linux.
// Parses CLI arguments, drag-and-drop paths, and vespr:// protocol URLs
// without depending on Electron runtime APIs so it can be 100% unit tested.
const path = require('node:path')
const fs = require('node:fs')

const PROTOCOL_PREFIX = 'vespr://'
const IS_LINK = /^vespr(-test)?:\/\//i // the normal app's links, and VESPR Test's (vespr-test://)
const IGNORE_ARGS = new Set([
  '--', '.', './', 'electron', 'electron.exe'
])

function isFlag (arg) {
  return typeof arg === 'string' && (arg.startsWith('-') || arg.startsWith('/')) && !path.isAbsolute(arg)
}

function cleanBasename (p) {
  if (typeof p !== 'string') return ''
  const normalized = p.replace(/\\/g, '/')
  return path.posix.basename(normalized)
}

function parseUrl (rawUrl) {
  if (typeof rawUrl !== 'string' || !IS_LINK.test(rawUrl)) {
    return null
  }
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname || parsed.pathname.replace(/^\/+/, '').split('/')[0]
    const params = Object.fromEntries(parsed.searchParams.entries())
    return {
      type: 'protocol',
      raw: rawUrl,
      action: host,
      room: params.room || params.r || null,
      file: params.file || params.f || null,
      token: params.token || params.t || null,
      server: params.server || params.s || null,
      params
    }
  } catch {
    return {
      type: 'protocol',
      raw: rawUrl,
      action: 'unknown',
      params: {}
    }
  }
}

function parseOpenTarget (candidate, { cwd = process.cwd(), checkFs = false } = {}) {
  if (!candidate || typeof candidate !== 'string') return null
  const str = candidate.trim()
  if (!str) return null

  // 1. Deep link protocol URL (vespr://...)
  if (IS_LINK.test(str)) {
    return parseUrl(str)
  }

  // 2. Ignore standard flags, electron binary names, and empty values
  const baseName = cleanBasename(str).toLowerCase()
  if (isFlag(str) || IGNORE_ARGS.has(baseName) || IGNORE_ARGS.has(str)) {
    return null
  }

  // 3. Local filesystem path (file or folder)
  // Support both Windows and POSIX path conventions
  const isWinAbs = /^[a-zA-Z]:[\\/]/.test(str)
  const isPosixAbs = str.startsWith('/')
  const isAbs = isWinAbs || isPosixAbs

  let resolved = str
  if (!isAbs) {
    resolved = path.resolve(cwd, str)
  }

  let isDir = false
  let exists = true

  if (checkFs) {
    try {
      const st = fs.statSync(resolved)
      isDir = st.isDirectory()
    } catch {
      exists = false
    }
  } else {
    // Heuristic: trailing slash or no extension usually implies directory
    isDir = str.endsWith('/') || str.endsWith('\\') || !cleanBasename(resolved).includes('.')
  }

  return {
    type: isDir ? 'directory' : 'file',
    path: resolved,
    name: cleanBasename(resolved),
    exists
  }
}

function parseArgv (argv, { cwd = process.cwd(), checkFs = false, isPackaged = false } = {}) {
  if (!Array.isArray(argv)) return []
  // In development, argv[0] is electron binary and argv[1] is app folder '.'
  // In packaged apps, argv[0] is the app executable
  const startIndex = isPackaged ? 1 : 2
  const slice = argv.slice(startIndex)
  const targets = []

  for (const arg of slice) {
    const target = parseOpenTarget(arg, { cwd, checkFs })
    if (target) targets.push(target)
  }

  return targets
}

module.exports = {
  PROTOCOL_PREFIX,
  cleanBasename,
  parseUrl,
  parseOpenTarget,
  parseArgv
}
