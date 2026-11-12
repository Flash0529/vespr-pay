// Integrated Dual-Directory File System for VESPR SDE.
// Integrates workspace Project Files (project://) and User's Host System Files (system://).
// Handles role-based access control, hierarchical tree building, natural sorting, and cross-scope transfer.
// Pure ES module.

export const FS_SCOPES = {
  PROJECT: 'project',
  SYSTEM: 'system',
  CLOUD: 'cloud',
  COMPANY: 'company'
}

export function getScopeInfo (scope, account = null) {
  const normScope = (scope === FS_SCOPES.PROJECT || scope === 'project') ? 'project'
    : (scope === FS_SCOPES.SYSTEM || scope === 'system') ? 'system'
    : (scope === FS_SCOPES.CLOUD || scope === 'cloud') ? 'cloud'
    : (scope === FS_SCOPES.COMPANY || scope === 'company') ? 'company'
    : 'project'
  const canRead = canAccessScope(account, normScope, false)
  const canWrite = canAccessScope(account, normScope, true)
  const isStudent = account && account.role === 'student'

  if (normScope === 'project') {
    return {
      scope: 'project',
      rootPath: 'project://',
      displayName: 'Project Files',
      canRead,
      canWrite,
      isSandboxed: false
    }
  } else if (normScope === 'system') {
    return {
      scope: 'system',
      rootPath: 'system://',
      displayName: isStudent ? 'Host System Directory (Locked by Policy)' : 'Host System Directory (Local)',
      canRead,
      canWrite,
      isSandboxed: isStudent
    }
  } else if (normScope === 'cloud') {
    return {
      scope: 'cloud',
      rootPath: 'cloud://',
      displayName: 'Cloud Storage & Connectors (Drive, OneDrive, S3)',
      canRead,
      canWrite,
      isSandboxed: false
    }
  } else {
    return {
      scope: 'company',
      rootPath: 'company://',
      displayName: 'Company Architecture (Shared Monorepo)',
      canRead,
      canWrite,
      isSandboxed: false
    }
  }
}

// NOTE: Client-side UI filtering only for navigation view presentation; authoritative filesystem access controls must be enforced by server/kernel.
export function canAccessScope (account, scope, forWrite = false) {
  const s = String(scope || 'project').toLowerCase().replace('://', '')
  if (!account) {
    return s === 'project' || !forWrite
  }

  const role = account.role
  switch (role) {
    case 'student':
      // Students can read/write their project workspace, but host system and company files are locked.
      return s === 'project'

    case 'intern':
    case 'junior_dev':
      // Junior devs can read/write project, read company & cloud & host system; write to company/system requires elevation.
      if (s === 'project') return true
      if (s === 'cloud') return true
      if (s === 'company' || s === 'system') return !forWrite
      return false

    case 'teacher':
    case 'school_admin':
      return true

    case 'corporate_legal':
      // Corporate legal has read-only audit access across all scopes.
      return !forWrite

    case 'solo_dev':
    case 'senior_dev':
    case 'it_admin':
    default:
      return true
  }
}

export function normalizePath (rawPath, scope = 'project') {
  if (typeof rawPath !== 'string') return ''
  let p = rawPath.trim().replace(/\\/g, '/')
  if (p.toLowerCase().startsWith('project://')) p = p.slice(10)
  else if (p.toLowerCase().startsWith('system://')) p = p.slice(9)
  else if (p.toLowerCase().startsWith('cloud://')) p = p.slice(8)
  else if (p.toLowerCase().startsWith('company://')) p = p.slice(10)

  const parts = p.split('/').filter(Boolean)
  const stack = []

  for (const part of parts) {
    if (part === '.' || !part.trim()) continue
    if (part === '..') {
      if (stack.length > 0) stack.pop()
    } else {
      stack.push(part)
    }
  }

  return stack.join('/')
}

export function detectMimeType (path) {
  if (!path || typeof path !== 'string') return 'application/octet-stream'
  const idx = path.lastIndexOf('.')
  const ext = idx >= 0 ? path.slice(idx).toLowerCase() : ''

  const mimeMap = {
    '.py': 'text/x-python',
    '.cs': 'text/x-csharp',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.md': 'text/markdown',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.sh': 'application/x-sh'
  }

  return mimeMap[ext] || 'application/octet-stream'
}

export function naturalCompare (a, b) {
  const sa = String(a || '')
  const sb = String(b || '')
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' })
}

export function buildDirectoryTree (entries, scope = 'project', rootPath = '') {
  const filtered = (entries || []).filter(e => e.scope === scope)
  const root = { name: '', path: rootPath, scope, isDirectory: true, children: [] }

  for (const entry of filtered) {
    const norm = normalizePath(entry.path, scope)
    const parts = norm.split('/').filter(Boolean)
    if (!parts.length) continue

    let cur = root
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i]
      const isLast = i === parts.length - 1
      const currentPath = parts.slice(0, i + 1).join('/')

      let existing = cur.children.find(c => c.name.toLowerCase() === seg.toLowerCase())
      if (!existing) {
        const isDir = !isLast || entry.isDirectory
        existing = {
          name: seg,
          path: currentPath,
          scope,
          isDirectory: isDir,
          children: isDir ? [] : undefined,
          size: isLast ? (entry.size || 0) : 0,
          fileCount: isLast && !entry.isDirectory ? 1 : 0,
          isReadOnly: !!entry.isReadOnly,
          ext: isLast && !entry.isDirectory ? (seg.lastIndexOf('.') > 0 ? seg.slice(seg.lastIndexOf('.')) : '') : ''
        }
        cur.children.push(existing)
      }
      cur = existing
    }
  }

  function decorate (node) {
    if (!node.isDirectory) {
      node.fileCount = 1
      return
    }

    let totalSize = 0
    let totalFiles = 0

    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        decorate(child)
        totalSize += child.size || 0
        totalFiles += child.fileCount || 0
      }

      node.children.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return b.isDirectory ? 1 : -1
        }
        return naturalCompare(a.name, b.name)
      })
    }

    node.size = totalSize
    node.fileCount = totalFiles
  }

  for (const top of root.children) {
    decorate(top)
  }

  root.children.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return b.isDirectory ? 1 : -1
    }
    return naturalCompare(a.name, b.name)
  })

  return root.children
}

export function writeFile (path, scope, content, storage, account = null) {
  if (!canAccessScope(account, scope, true)) {
    return {
      success: false,
      message: `Write permission denied for ${scope} scope under role ${account ? account.role : 'guest'}.`
    }
  }

  const norm = normalizePath(path, scope)
  let key = `${scope}:${norm}`
  const altKey = norm.startsWith('/') ? `${scope}:${norm.slice(1)}` : `${scope}:/${norm}`
  if ((storage.get ? storage.get(altKey) : storage[altKey]) !== undefined) {
    key = altKey
  }
  storage.set ? storage.set(key, content) : (storage[key] = content)
  const bytes = new TextEncoder().encode(content).length

  return {
    success: true,
    message: `Successfully wrote file to ${scope}://${norm}`,
    affectedPath: norm,
    bytesTransferred: bytes
  }
}

export function readFile (path, scope, storage, account = null) {
  if (!canAccessScope(account, scope, false)) {
    return {
      success: false,
      message: `Read permission denied for ${scope} scope under role ${account ? account.role : 'guest'}.`
    }
  }

  const norm = normalizePath(path, scope)
  const key = `${scope}:${norm}`
  let content = storage.get ? storage.get(key) : storage[key]
  if (content === undefined || content === null) {
    const altKey = norm.startsWith('/') ? `${scope}:${norm.slice(1)}` : `${scope}:/${norm}`
    content = storage.get ? storage.get(altKey) : storage[altKey]
  }

  if (content === undefined || content === null) {
    return {
      success: false,
      message: `File not found at ${scope}://${norm}`,
      affectedPath: norm
    }
  }

  return {
    success: true,
    message: content,
    affectedPath: norm,
    bytesTransferred: new TextEncoder().encode(content).length
  }
}

export function copyBetweenScopes (srcPath, srcScope, dstPath, dstScope, storage, account = null) {
  if (!canAccessScope(account, srcScope, false)) {
    return {
      success: false,
      message: `Read permission denied on source scope ${srcScope}.`
    }
  }

  if (!canAccessScope(account, dstScope, true)) {
    return {
      success: false,
      message: `Write permission denied on destination scope ${dstScope}.`
    }
  }

  const normSrc = normalizePath(srcPath, srcScope)
  const normDst = normalizePath(dstPath, dstScope)

  const srcKey = `${srcScope}:${normSrc}`
  const dstKey = `${dstScope}:${normDst}`

  const content = storage.get ? storage.get(srcKey) : storage[srcKey]
  if (content === undefined || content === null) {
    return {
      success: false,
      message: `Source file not found at ${srcScope}://${normSrc}`,
      affectedPath: normSrc
    }
  }

  storage.set ? storage.set(dstKey, content) : (storage[dstKey] = content)
  const bytes = new TextEncoder().encode(content).length

  return {
    success: true,
    message: `Successfully copied ${srcScope}://${normSrc} to ${dstScope}://${normDst}`,
    affectedPath: normDst,
    bytesTransferred: bytes
  }
}

export function deleteEntry (path, scope, storage, account = null) {
  if (!canAccessScope(account, scope, true)) {
    return {
      success: false,
      message: `Delete permission denied for ${scope} scope.`
    }
  }

  const norm = normalizePath(path, scope)
  const prefix = `${scope}:${norm}`

  const keys = storage.keys ? Array.from(storage.keys()) : Object.keys(storage)
  const toRemove = keys.filter(k => k === prefix || k.startsWith(prefix + '/'))

  if (!toRemove.length) {
    return {
      success: false,
      message: `Entry not found at ${scope}://${norm}`,
      affectedPath: norm
    }
  }

  for (const k of toRemove) {
    storage.delete ? storage.delete(k) : delete storage[k]
  }

  return {
    success: true,
    message: `Deleted ${toRemove.length} item(s) under ${scope}://${norm}`,
    affectedPath: norm
  }
}

export function searchFiles (query, scope = null, entries = []) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return scope ? entries.filter(e => e.scope === scope) : entries.slice()
  }

  const q = query.trim().toLowerCase()
  return entries
    .filter(e => (!scope || e.scope === scope) &&
                 (e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q)))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return b.isDirectory ? 1 : -1
      return naturalCompare(a.name, b.name)
    })
}

export function createDefaultProjectEntries () {
  const now = new Date()
  return [
    { path: 'README.md', name: 'README.md', scope: 'project', isDirectory: false, size: 820, modifiedAt: now, ext: '.md', isReadOnly: false, mimeType: 'text/markdown' },
    { path: 'cart.py', name: 'cart.py', scope: 'project', isDirectory: false, size: 1420, modifiedAt: now, ext: '.py', isReadOnly: false, mimeType: 'text/x-python' },
    { path: 'test_cart.py', name: 'test_cart.py', scope: 'project', isDirectory: false, size: 950, modifiedAt: now, ext: '.py', isReadOnly: false, mimeType: 'text/x-python' },
    { path: 'fizzbuzz.py', name: 'fizzbuzz.py', scope: 'project', isDirectory: false, size: 410, modifiedAt: now, ext: '.py', isReadOnly: false, mimeType: 'text/x-python' },
    { path: 'server/app.py', name: 'app.py', scope: 'project', isDirectory: false, size: 2800, modifiedAt: now, ext: '.py', isReadOnly: false, mimeType: 'text/x-python' },
    { path: 'server/config.json', name: 'config.json', scope: 'project', isDirectory: false, size: 560, modifiedAt: now, ext: '.json', isReadOnly: false, mimeType: 'application/json' },
    { path: 'agents/agent.js', name: 'agent.js', scope: 'project', isDirectory: false, size: 3400, modifiedAt: now, ext: '.js', isReadOnly: false, mimeType: 'application/javascript' },
    { path: 'agents/runner.js', name: 'runner.js', scope: 'project', isDirectory: false, size: 4100, modifiedAt: now, ext: '.js', isReadOnly: false, mimeType: 'application/javascript' }
  ]
}

export function createDefaultSystemEntries (includeDemo = false) {
  if (!includeDemo) return []
  const now = new Date()
  return [
    { path: '~/.bashrc', name: '.bashrc', scope: 'system', isDirectory: false, size: 3771, modifiedAt: now, ext: '', isReadOnly: false, mimeType: 'text/plain' },
    { path: '~/.config/vespr/settings.json', name: 'settings.json', scope: 'system', isDirectory: false, size: 1204, modifiedAt: now, ext: '.json', isReadOnly: false, mimeType: 'application/json' },
    { path: 'scripts/backup.sh', name: 'backup.sh', scope: 'system', isDirectory: false, size: 640, modifiedAt: now, ext: '.sh', isReadOnly: false, mimeType: 'application/x-sh' },
    { path: 'datasets/sample.csv', name: 'sample.csv', scope: 'system', isDirectory: false, size: 18500, modifiedAt: now, ext: '.csv', isReadOnly: false, mimeType: 'text/plain' }
  ]
}

export function createDefaultCloudEntries (includeDemo = false) {
  if (!includeDemo) return []
  const now = new Date()
  return [
    { path: 'google-drive/product-roadmap-2026.pdf', name: 'product-roadmap-2026.pdf', scope: 'cloud', isDirectory: false, size: 480200, modifiedAt: now, ext: '.pdf', isReadOnly: false, mimeType: 'application/pdf' },
    { path: 'onedrive/financial-projections-q4.xlsx', name: 'financial-projections-q4.xlsx', scope: 'cloud', isDirectory: false, size: 124500, modifiedAt: now, ext: '.xlsx', isReadOnly: false, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  ]
}

export function createDefaultCompanyEntries (includeDemo = false) {
  if (!includeDemo) return []
  const now = new Date()
  return [
    { path: 'monorepo/services/auth-gateway/config.yaml', name: 'config.yaml', scope: 'company', isDirectory: false, size: 1820, modifiedAt: now, ext: '.yaml', isReadOnly: false, mimeType: 'text/yaml' },
    { path: 'monorepo/policies/ip-governance.md', name: 'ip-governance.md', scope: 'company', isDirectory: false, size: 2400, modifiedAt: now, ext: '.md', isReadOnly: false, mimeType: 'text/markdown' }
  ]
}
