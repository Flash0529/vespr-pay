// What Chat mode may do with files. the team, 2026-11-10: in Chat mode everything code- and file-related goes away except ADDING a file or folder as context.
// A company or school account may do that only if the organization allows it; a personal account is asked, and the browser's own read permission is
// checked on the file or folder before anything is read. Chat mode never writes, runs or edits (that belongs to Code mode).
// Pure rules plus small helpers, so they can be tested without a browser. Nothing is read, uploaded or stored here.

export const CHAT_ACCESS = Object.freeze({ read: true, write: false, run: false, edit: false })
export const LIMITS = Object.freeze({ maxFiles: 10, maxFileBytes: 5 * 1024 * 1024, maxFolderEntries: 500, maxTotalBytes: 20 * 1024 * 1024 })
export const ACCOUNT_KINDS = ['personal', 'company', 'school']
const SETTINGS = ['ask', 'allow', 'deny']

// files that are never offered as context, whatever the setting: credentials and keys, and folders that are only noise
const SECRET_NAME = /(^|\/)(\.env(\..*)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|kdbx|keystore)|\.npmrc|\.netrc|\.pypirc|credentials(\.json)?|secrets?(\.\w+)?|\.aws\/credentials|\.ssh\/.*)$/i
const NOISE_DIR = /(^|\/)(node_modules|\.git|\.svn|\.hg|__pycache__|\.venv|venv|dist|build|\.cache)(\/|$)/i
export const isSecretName = n => typeof n === 'string' && SECRET_NAME.test(n.replace(/\\/g, '/'))
export const isNoisePath = n => typeof n === 'string' && NOISE_DIR.test(n.replace(/\\/g, '/'))

export function cleanSettings (s) {
  const o = s && typeof s === 'object' ? s : {}
  return { files: SETTINGS.includes(o.files) ? o.files : 'ask', folders: SETTINGS.includes(o.folders) ? o.folders : 'ask' }
}

// decideAttach: may this person add this kind of thing, and what has to happen first?
//   { allow: true,  step: 'none' | 'ask-user', reason }     'ask-user' = show the permission prompt before the picker
//   { allow: false, step: 'blocked', reason, by: 'organization' | 'person' | 'account' }
export function decideAttach (input) {
  const { accountKind, policy, kind, settings } = input && typeof input === 'object' ? input : {}
  if (kind !== 'file' && kind !== 'folder') return { allow: false, step: 'blocked', by: 'account', reason: 'Unknown kind of item.' }
  const set = cleanSettings(settings); const mine = kind === 'file' ? set.files : set.folders
  const noun = kind === 'file' ? 'files' : 'folders'
  if (!ACCOUNT_KINDS.includes(accountKind)) return { allow: false, step: 'blocked', by: 'account', reason: 'Sign in to add ' + noun + ' as context.' }
  if (accountKind !== 'personal') {
    const p = policy && typeof policy === 'object' ? policy : {}
    const allowed = kind === 'file' ? p.fileContext === true : p.folderContext === true // strictly true: missing, "true" or 1 mean the organization has not allowed it
    if (!allowed) return { allow: false, step: 'blocked', by: 'organization', reason: 'Your organization has not allowed adding ' + noun + ' in Chat.' }
  }
  if (mine === 'deny') return { allow: false, step: 'blocked', by: 'person', reason: 'You turned off adding ' + noun + ' in Chat. You can change this in the file access settings.' }
  // an organization that allows it still lets the person say no; a personal account is always asked unless they chose to remember "allow"
  return { allow: true, step: mine === 'allow' ? 'none' : 'ask-user', reason: accountKind === 'personal' ? 'Personal account: VESPR checks read permission on what you pick.' : 'Allowed by your organization.' }
}

// Check the browser's read permission on a file/folder handle (File System Access API). Chat mode only ever asks for READ.
export async function ensureReadable (handle) {
  if (!handle || typeof handle !== 'object') return { ok: false, state: 'no-handle' }
  try {
    if (typeof handle.queryPermission !== 'function') return { ok: true, state: 'picker-grant' } // a plain <input type=file> pick is itself the grant
    let st = await handle.queryPermission({ mode: 'read' })
    if (st === 'prompt' && typeof handle.requestPermission === 'function') st = await handle.requestPermission({ mode: 'read' })
    return { ok: st === 'granted', state: String(st) }
  } catch (e) { return { ok: false, state: 'error', error: String(e && e.message || e).slice(0, 120) } }
}

// What of the chosen items may become context: no secrets, no noise folders, size and count limits. Returns what is kept and what was skipped and why.
export function screenItems (items) {
  const kept = []; const skipped = []; let total = 0
  for (const it of Array.isArray(items) ? items : []) {
    const name = it && typeof it.name === 'string' ? it.name : ''; const size = it && Number.isFinite(it.size) && it.size >= 0 ? it.size : null
    if (!name) { skipped.push({ name: '(unnamed)', why: 'no name' }); continue }
    if (isSecretName(name)) { skipped.push({ name, why: 'looks like a key or credential file' }); continue }
    if (isNoisePath(name)) { skipped.push({ name, why: 'a generated or version-control folder' }); continue }
    if (size === null) { skipped.push({ name, why: 'size unknown' }); continue }
    if (size > LIMITS.maxFileBytes) { skipped.push({ name, why: 'larger than 5 MB' }); continue }
    if (kept.length >= LIMITS.maxFiles) { skipped.push({ name, why: 'more than ' + LIMITS.maxFiles + ' items' }); continue }
    if (total + size > LIMITS.maxTotalBytes) { skipped.push({ name, why: 'total size limit reached' }); continue }
    total += size; kept.push({ name, size })
  }
  return { kept, skipped, total }
}

export function createFileAccessSettings (storage, key = 'vespr.file-access.v1') {
  const read = () => { try { return cleanSettings(JSON.parse(storage.getItem(key) || '{}')) } catch { return cleanSettings({}) } }
  let cur = read()
  return {
    get: () => ({ ...cur }),
    set (patch) { cur = cleanSettings({ ...cur, ...(patch && typeof patch === 'object' ? patch : {}) }); try { storage.setItem(key, JSON.stringify(cur)) } catch { /* blocked */ } return { ...cur } },
    reset () { cur = cleanSettings({}); try { storage.setItem(key, JSON.stringify(cur)) } catch { /* blocked */ } }
  }
}
