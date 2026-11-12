// Reads the esbuild metafile of the editor bundle, lists every npm package that really ended up in app/vendor/editor.js, checks its
// licence (MIT, Apache-2.0, BSD or ISC only; anything else fails the build) and, with --write, replaces the editor section of
// app/vendor/LICENSES.txt with those packages' licence texts (identical texts are printed once, with the packages that share them).
// Usage: node scripts/editor-licences.mjs <metafile.json> [--write]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const nm = join(root, 'app/editor/node_modules')
const meta = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const write = process.argv.includes('--write')
const ALLOWED = /^(MIT|ISC|Apache-2\.0|BSD-[23]-Clause|0BSD)$/

// every input that is inside node_modules -> its package folder
const dirs = new Set()
for (const input of Object.keys(meta.inputs)) {
  const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input)
  if (m) dirs.add(m[1])
}
const pkgs = [...dirs].sort().map(name => {
  const pj = JSON.parse(readFileSync(join(nm, name, 'package.json'), 'utf8'))
  const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE'].map(f => join(nm, name, f)).find(existsSync)
  return { name, version: pj.version, license: String(pj.license), text: file ? readFileSync(file, 'utf8').trim() : '' }
})
const bad = pkgs.filter(p => !ALLOWED.test(p.license) || !p.text)
if (bad.length) { console.error('editor bundle: licence not allowed or text missing for: ' + bad.map(p => `${p.name}@${p.version} (${p.license})`).join(', ')); process.exit(1) }
console.log(`editor bundle: ${pkgs.length} packages, all ${[...new Set(pkgs.map(p => p.license))].join('/')}`)
if (!write) { for (const p of pkgs) console.log(`  ${p.name}@${p.version}  ${p.license}`); process.exit(0) }

const groups = new Map()
for (const p of pkgs) { const k = p.text.replace(/\s+/g, ' '); if (!groups.has(k)) groups.set(k, { text: p.text, who: [] }); groups.get(k).who.push(`${p.name}@${p.version}`) }
const BEGIN = '==== CodeMirror 6, Lezer and helpers (bundled in editor.js) ===='
const END = '==== end of the editor bundle licences ===='
const block = [BEGIN, 'app/vendor/editor.js is an esbuild bundle (minified, so the licence texts are kept here) of app/editor/index.js and these packages, all',
  'under the licence shown. Yjs is not part of it (the page supplies it). The build tools (esbuild) are not shipped.', '']
for (const g of groups.values()) block.push('--- ' + g.who.join(', ') + ' ---', g.text, '')
block.push(END, '')
const file = join(root, 'app/vendor/LICENSES.txt')
let cur = readFileSync(file, 'utf8')
const a = cur.indexOf(BEGIN); const b = cur.indexOf(END)
if (a >= 0 && b > a) cur = cur.slice(0, a) + block.join('\n') + cur.slice(b + END.length).replace(/^\n/, '')
else cur = cur.replace(/\s*$/, '\n\n') + block.join('\n')
writeFileSync(file, cur)
console.log('wrote the editor licences into app/vendor/LICENSES.txt (' + groups.size + ' distinct texts)')
