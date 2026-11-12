import fs from 'node:fs'
import path from 'node:path'

export const LIMITS = Object.freeze({ inputBytes: 2 * 1024 * 1024, inputFiles: 256, fileBytes: 200 * 1024, artifactBytes: 4 * 1024 * 1024, artifactFiles: 128, entries: 4096, outputBytes: 40 * 1024 })
export const SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'dist', 'build'])
export function safePath (name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 512 && !/[\\:\x00-\x1f\x7f]/.test(name) && name.split('/').every(p => p && p !== '.' && p !== '..')
}
export function validateJob (job) {
  if (!job || typeof job.id !== 'string' || job.id.length > 256 || typeof job.room !== 'string' || job.room.length > 256) throw new Error('invalid job identity')
  if (typeof job.command !== 'string' || !job.command.trim() || job.command.length > 16384 || job.command.includes('\0')) throw new Error('invalid command')
  const files = job.files === undefined ? {} : job.files
  if (!files || Array.isArray(files) || typeof files !== 'object') throw new Error('invalid files')
  const names = Object.keys(files); let bytes = 0
  if (names.length > LIMITS.inputFiles) throw new Error('too many input files')
  const all = new Set(names)
  for (const name of names) {
    if (!safePath(name)) throw new Error('invalid file path')
    if (typeof files[name] !== 'string') throw new Error('files must contain text')
    bytes += Buffer.byteLength(files[name])
    if (bytes > LIMITS.inputBytes) throw new Error('input size limit exceeded')
    const parts = name.split('/'); parts.pop()
    while (parts.length) { if (all.has(parts.join('/'))) throw new Error('conflicting file paths'); parts.pop() }
  }
  const timeoutMs = job.timeoutMs === undefined ? 60000 : job.timeoutMs
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw new Error('invalid timeout')
  return { id: job.id, room: job.room, command: job.command, files, timeoutMs }
}
export function prepareJob (root, job) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const rootStat = fs.lstatSync(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (process.platform !== 'win32' && ((rootStat.mode & 0o022) || rootStat.uid !== process.getuid()))) throw new Error('runner root must be an owned directory without shared write access')
  const dir = fs.mkdtempSync(path.join(path.resolve(root), 'job-'))
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true })
  try {
    fs.chmodSync(dir, 0o700)
    const files = path.join(dir, 'files'); fs.mkdirSync(files, { mode: 0o700 })
    for (const [rel, text] of Object.entries(job.files)) {
      const dest = path.join(files, rel)
      fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 })
      fs.writeFileSync(dest, text, { flag: 'wx', mode: 0o600 })
    }
    fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ command: job.command, timeoutMs: job.timeoutMs }), { mode: 0o600 })
    return { dir, files, cleanup }
  } catch (error) { cleanup(); throw error }
}

// Trusted-local mode only: this bounded collector avoids following links, but does
// not turn an owner-approved host process into an OS sandbox.
export function collectChanges (root, sent) {
  const changed = Object.create(null); let entries = 0; let bytes = 0; let count = 0
  function walk (dir, prefix = '', depth = 0) {
    if (depth > 32 || entries >= LIMITS.entries || count >= LIMITS.artifactFiles) return
    const iterator = fs.opendirSync(dir)
    try {
      let entry
      while ((entry = iterator.readSync()) && entries++ < LIMITS.entries && count < LIMITS.artifactFiles) {
        if (SKIP.has(entry.name) || entry.isSymbolicLink()) continue
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (!safePath(rel)) continue
        const full = path.join(dir, entry.name)
        try {
          const st = fs.lstatSync(full)
          if (st.isDirectory()) { walk(full, rel, depth + 1); continue }
          if (!st.isFile() || st.size > LIMITS.fileBytes) continue
          const fd = fs.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0))
          let buf
          try {
            if (!fs.fstatSync(fd).isFile()) continue
            buf = Buffer.alloc(LIMITS.fileBytes + 1)
            buf = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0))
          } finally { fs.closeSync(fd) }
          if (buf.length > LIMITS.fileBytes || buf.includes(0)) continue
          const text = buf.toString('utf8')
          if (Object.hasOwn(sent, rel) && sent[rel] === text) continue
          if (bytes + buf.length > LIMITS.artifactBytes) continue
          changed[rel] = text; bytes += buf.length; count++
        } catch { /* a disappearing file is not a reason to read a replacement */ }
      }
    } finally { iterator.closeSync() }
  }
  walk(root)
  return changed
}
