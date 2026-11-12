// Keep raw storage access confined to the implementation and its deliberate legacy-data tests.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// server/access.js inspects raw incoming edits (it must see storage keys to know which file an edit touches); its tests write both storage formats
const allowed = new Set(['app/file-store.js', 'extensions/murmio-collab/lib/file-store.cjs', 'agents/test/file-identity.test.js', 'server/access.js', 'server/test/access.test.js', 'server/test/access-live.test.js'])
const skip = new Set(['node_modules', '.git', '.test-tmp'])
const patterns = [/\bgetMap\s*\(\s*(['"`])files\1\s*\)/g, /\.share\s*\.\s*get\s*\(\s*(['"`])files\1\s*\)/g, /\bget\s*\(\s*(['"`])files\1\s*,\s*(?:Y\.)?Map\s*\)/g]
const rawAccess = text => patterns.some(p => { p.lastIndex = 0; return p.test(text) })
assert.ok(rawAccess('doc.' + 'get' + 'Map(' + JSON.stringify('files') + ')'))
assert.ok(rawAccess('doc.share.' + 'get(' + JSON.stringify('files') + ')'))
assert.ok(rawAccess('doc.' + 'get(' + JSON.stringify('files') + ', Y.Map)'))
assert.equal(rawAccess('fileStore(doc).get(' + JSON.stringify('a.py') + ')'), false)
const bad = []
function walk (dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (skip.has(entry.name) || entry.isSymbolicLink() || path.relative(root, full) === path.join('desktop', 'web')) continue // desktop/web is the generated copy the desktop app bundles, not source
    if (entry.isDirectory()) walk(full)
    else if (/\.(?:[cm]?js|jsx|ts|tsx|html)$/.test(entry.name)) {
      const relative = path.relative(root, full).split(path.sep).join('/')
      if (!allowed.has(relative) && rawAccess(fs.readFileSync(full, 'utf8'))) bad.push(relative)
    }
  }
}
walk(root)
assert.deepEqual(bad, [], 'Use the logical file view outside storage internals: ' + bad.join(', '))
console.log('file-store reader guard passed')
