// The desktop ships the canonical runner, not an independently maintained fork.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const RUNTIME_FILES = Object.freeze(['lib.js', 'job.js', 'local.js', 'sandbox.js', 'sandbox_exec.py', 'sandbox_guard.py'])

function directory (name) {
  const stat = fs.lstatSync(name)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Runner runtime directory must not be a link: ' + name)
}

function copyRunner (repo = path.resolve(__dirname, '..', '..')) {
  repo = fs.realpathSync(repo)
  const source = path.join(repo, 'runner')
  const desktop = path.join(repo, 'desktop')
  const target = path.join(desktop, 'runner')
  directory(source); directory(desktop)
  if (fs.existsSync(target)) directory(target)
  // Read and validate the entire set before replacing any existing runtime file.
  const entries = RUNTIME_FILES.map(name => {
    const from = path.join(source, name); const to = path.join(target, name)
    const stat = fs.lstatSync(from)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Runner source must be a regular file: ' + name)
    try {
      const existing = fs.lstatSync(to)
      if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('Runner destination must be a regular file: ' + name)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    return { to, data: fs.readFileSync(from) }
  })
  fs.mkdirSync(target, { recursive: true })
  for (const { to, data } of entries) {
    if (fs.existsSync(to) && fs.readFileSync(to).equals(data)) continue
    const temporary = path.join(target, '.vespr-runtime-' + randomUUID())
    let created = false
    try {
      fs.writeFileSync(temporary, data, { flag: 'wx', mode: 0o664 }); created = true
      fs.renameSync(temporary, to); created = false
    } finally { if (created) fs.unlinkSync(temporary) }
  }
  return entries.length
}

module.exports = { RUNTIME_FILES, copyRunner }
if (require.main === module) console.log(`runner: ${copyRunner()} canonical runtime files synchronized`)
