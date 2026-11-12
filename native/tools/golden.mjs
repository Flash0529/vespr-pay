// Golden files: run a JavaScript module on a fixed list of inputs and record exactly what it returns, so a C# port can be held to the
// same answers (the JS module is the specification). Usage: node native/tools/golden.mjs fuzzy  ->  native/golden/fuzzy.json
// A cases file (native/golden/cases/<name>.mjs) exports { calls: [{ fn, args, note? }] }. Values JSON cannot hold are tagged:
// { "$undefined": true }, { "$nan": true }, { "$inf": 1 | -1 }, so the C# side can tell them apart from null.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const name = process.argv[2]
if (!/^[a-z][a-z0-9-]*$/.test(name || '')) { console.error('usage: node native/tools/golden.mjs <module>'); process.exit(2) }
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const mod = await import(pathToFileURL(path.join(root, 'app', name + '.js')).href)
const { calls } = await import(pathToFileURL(path.join(root, 'native', 'golden', 'cases', name + '.mjs')).href)

const tag = v => {
  if (v === undefined) return { $undefined: true }
  if (typeof v === 'number' && Number.isNaN(v)) return { $nan: true }
  if (v === Infinity || v === -Infinity) return { $inf: v > 0 ? 1 : -1 }
  if (Array.isArray(v)) return v.map(tag)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tag(x)]))
  return v
}
const out = []
for (const c of calls) {
  if (typeof mod[c.fn] !== 'function') throw new Error(`${name}.${c.fn} is not an exported function`)
  let result, threw = null
  try { result = mod[c.fn](...c.args) } catch (e) { threw = String(e && e.message || e) }
  out.push({ fn: c.fn, args: tag(c.args), ...(threw ? { throws: threw } : { result: tag(result) }), ...(c.note ? { note: c.note } : {}) })
}
const constants = Object.fromEntries(Object.entries(mod).filter(([, v]) => typeof v !== 'function').map(([k, v]) => [k, tag(v)]))
const file = path.join(root, 'native', 'golden', name + '.json')
fs.writeFileSync(file, JSON.stringify({ module: name, generated: 'from app/' + name + '.js', constants, cases: out }, null, 1) + '\n')
console.log(`golden ${name}: ${out.length} cases, ${Object.keys(constants).length} constants -> native/golden/${name}.json`)
