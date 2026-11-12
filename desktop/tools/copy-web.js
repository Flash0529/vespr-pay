// Copy the site and the app into desktop/web, so the desktop app ships them and opens without the network.
// Notes, backups, tests and design sources stay out (the same things the public site never serves).
const fs = require('node:fs')
const path = require('node:path')
const { copyRunner } = require('./copy-runner.js')

const repo = path.resolve(__dirname, '..', '..')
const out = path.resolve(__dirname, '..', 'web')
const skip = name => /\.md$|\.bak|^test$|^design-system$|^tools$|^\.|\.map$/i.test(name)

function copy (from, to, siteRoot = false) {
  let files = 0
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip(e.name) || (siteRoot && e.name === 'downloads')) continue
    const a = path.join(from, e.name); const b = path.join(to, e.name)
    if (e.isDirectory()) files += copy(a, b)
    else if (e.isFile()) { fs.copyFileSync(a, b); files++ }
  }
  return files
}

// Fail the build before changing bundled assets if the current runner is incomplete.
console.log(`runner: ${copyRunner(repo)} canonical runtime files synchronized`)
if (out !== path.join(repo, 'desktop', 'web') || !out.startsWith(repo + path.sep)) throw new Error('Unexpected desktop web output path')
fs.rmSync(out, { recursive: true, force: true })
const site = copy(path.join(repo, 'site'), path.join(out, 'site'), true)
const app = copy(path.join(repo, 'app'), path.join(out, 'app'))
console.log(`web: ${site} site files, ${app} app files -> desktop/web`)
