// Mutation check for the Node suite: break core.js / presence.js on purpose, one way at a time, and require core.test.js to notice.
//   node app/editor/test/mutants.mjs            (about 10 minutes on a busy Pi; uses 40 fuzz seeds per mutant)
//   node app/editor/test/mutants.mjs --only heal    (only the mutants whose name contains the text)
// Each mutant is a small text edit applied to a COPY of the files in a temp folder (the real files are never touched) and the suite
// is run against the copy with EDITOR_DIR. A mutant the suite does not catch is reported and fails this script.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url)); const dir = path.resolve(here, '..')
const core = fs.readFileSync(path.join(dir, 'core.js'), 'utf8'); const presence = fs.readFileSync(path.join(dir, 'presence.js'), 'utf8')
const M = [
  ['applyLocal applies changes from the start instead of the end', 'core', /for \(let i = list\.length - 1; i >= 0; i--\)/, 'for (let i = 0; i < list.length; i++)'],
  ['inserts carry no authorship attributes', 'core', /ytext\.insert\(c\.from, sanitizeInsert\(c\.insert\), authorship\(user\)\)/, 'ytext.insert(c.from, sanitizeInsert(c.insert))'],
  ['undo tracks every origin, not only the binding\'s', 'core', /trackedOrigins: new Set\(\[origin\]\)/, 'trackedOrigins: { has: () => true }'],
  ['onRemote also reports the binding\'s own changes', 'core', /if \(transaction\.origin === origin\) return/, ''],
  ['deltaToChanges reports positions after the change, not before', 'core', /(changes\.push\(last = \{ from: pos, to: pos, insert: op\.insert \}\))/, '$1; pos += op.insert.length'],
  ['every keystroke is its own undo step (capture window 0)', 'core', /captureTimeout: 500/, 'captureTimeout: 0'],
  ['t is in seconds, not minutes', 'core', /Math\.floor\(Date\.now\(\) \/ 60000\)/, 'Math.floor(Date.now() / 1000)'],
  ['a delete is one character too short', 'core', /ytext\.delete\(c\.from, c\.to - c\.from\)/, 'ytext.delete(c.from, Math.max(0, c.to - c.from - 1))'],
  ['lone surrogates are not cleaned before they enter the shared text', 'core', /sanitizeInsert\(c\.insert\)/, 'c.insert'],
  ['the binding never heals by itself', 'core', /heal: autoHeal = true/, 'heal: autoHeal = false'],
  ['binding.heal() does nothing', 'core', /heal: healNow,/, 'heal: () => 0,'],
  ['remoteSelections includes yourself', 'presence', /clientId === awareness\.clientID \|\| /, ''],
  ['remoteSelections ignores which file the cursor is in', 'presence', / \|\| state\.cursor\.file !== file/, ''],
  ['setLocalSelection keeps the cursor when the position is missing', 'presence', /if \(!file \|\| anchor == null \|\| head == null\) \{ awareness\.setLocalStateField\('cursor', null\); return \}/, 'if (!file) { awareness.setLocalStateField(\'cursor\', null); return }\n  if (anchor == null || head == null) return']
]
const run = dirOf => spawnSync(process.execPath, [path.join(here, 'core.test.js')], { env: { ...process.env, EDITOR_DIR: dirOf, FUZZ_SEEDS: '40' }, encoding: 'utf8', timeout: 600000 })
const failsOf = r => new Set((r.stdout.match(/^ {2}FAIL {2}.*?(?= {2}\[\d+ ms\]$)/gm) || []).map(l => l.replace(/^ {2}FAIL {2}/, '')))
const base = failsOf(run(dir)); console.log(`baseline: ${base.size ? base.size + ' test(s) already fail on the real code: ' + [...base].join('; ').slice(0, 200) : 'all tests pass'}`)
let missed = 0
const only = process.argv.includes('--only') ? String(process.argv[process.argv.indexOf('--only') + 1]).toLowerCase() : ''
for (const [name, which, from, to] of M.filter(m => !only || m[0].toLowerCase().includes(only))) {
  const src = which === 'core' ? core : presence
  if (!from.test(src)) { console.log(`  n/a    ${name}: the code it targets has changed, update mutants.mjs`); missed++; continue }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-mutant-'))
  fs.writeFileSync(path.join(tmp, 'core.js'), which === 'core' ? src.replace(from, to) : core); fs.writeFileSync(path.join(tmp, 'presence.js'), which === 'presence' ? src.replace(from, to) : presence)
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}')
  const r = run(tmp); fs.rmSync(tmp, { recursive: true, force: true })
  const fresh = [...failsOf(r)].filter(n => !base.has(n))
  if (!fresh.length) { missed++; console.log(`  MISSED ${name}: no test that passes on the real code fails with it`) } else console.log(`  caught ${name}: ${fresh.length} test(s) fail, e.g. ${fresh[0].slice(0, 90)}`)
}
console.log(missed ? `\nmutation check: ${missed} of ${M.length} mutants NOT caught (FAILED)` : `\nmutation check: all ${M.length} mutants caught (passed)`)
process.exit(missed ? 1 : 0)
