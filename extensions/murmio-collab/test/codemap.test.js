// Code Map core: imports, symbols, authorship, impact, cycles, and the agent's generated copy staying in sync.
const assert = require('node:assert')
const fs = require('node:fs'); const path = require('node:path')
const { buildMap, summarize, queryMap } = require('../lib/codemap')

const files = [
  { path: 'server/index.js', text: "import { Hub } from './hub.js'\nimport express from 'express'\nimport { log } from '../lib/log'\nexport async function start () { return new Hub() }\nconst helper = (x) => x\n" },
  { path: 'server/hub.js', text: "import { log } from '../lib/log.js'\nexport class Hub { run () { log('x') } }\n", spans: [{ start: 0, end: 40, by: 'shamit', ai: false }, { start: 40, end: 70, by: 'coder', ai: true }] },
  { path: 'lib/log.js', text: "const fmt = require('./fmt')\nexport function log (m) { return fmt(m) }\n" },
  { path: 'lib/fmt.js', text: "const { log } = require('./log')\nmodule.exports = function fmt (m) { return m }\n" },
  { path: 'app/main.py', text: "from .util import slugify\nimport helpers.text\nimport requests\n\ndef main():\n    return slugify('x')\n" },
  { path: 'app/util.py', text: "def slugify(s):\n    return s\n\nclass Slug:\n    def parse(self):\n        pass\n" },
  { path: 'helpers/text.py', text: 'def shout(s):\n    return s.upper()\n' },
  { path: 'web/index.html', text: '<html><script src="app.js"></script><link href="style.css"></html>' },
  { path: 'web/app.js', text: "console.log('hi')\n" },
  { path: 'web/style.css', text: 'body{}' },
  { path: 'README.md', text: '# x' }
]
const map = buildMap(files)
const node = p => map.nodes.find(n => n.path === p)
const edge = (a, b) => map.edges.find(e => e.from === a && e.to === b)

assert.strictEqual(map.nodes.length, files.length)
assert.ok(edge('server/index.js', 'server/hub.js'), 'relative import with extension')
assert.ok(edge('server/index.js', 'lib/log.js'), 'import without extension resolves to log.js')
assert.ok(edge('lib/log.js', 'lib/fmt.js'), 'require resolves')
assert.ok(edge('app/main.py', 'app/util.py'), 'python relative import')
assert.ok(edge('app/main.py', 'helpers/text.py'), 'python absolute import of a workspace module')
assert.ok(edge('web/index.html', 'web/app.js') && edge('web/index.html', 'web/style.css'), 'html script and link')
assert.deepStrictEqual(node('server/index.js').externals, ['express'], 'external packages are listed, not edges')
assert.ok(map.externals.some(e => e.name === 'requests'), 'python external')
assert.ok(edge('server/hub.js', 'lib/log.js').uses.includes('log'), 'which symbols are used across the import')

assert.ok(node('server/index.js').symbols.some(s => s.name === 'start' && s.kind === 'function' && s.line === 4), 'function with line number')
assert.ok(node('server/index.js').symbols.some(s => s.name === 'helper'), 'arrow function assigned to a const')
assert.ok(node('server/hub.js').symbols.some(s => s.name === 'Hub' && s.kind === 'class'))
assert.ok(node('app/util.py').symbols.some(s => s.name === 'parse' && s.kind === 'method') && node('app/util.py').symbols.some(s => s.name === 'Slug' && s.kind === 'class'))

// authorship: shamit wrote 40 chars, the agent 30 of a ~70 character file
const hub = node('server/hub.js')
assert.ok(hub.authors.find(a => a.name === 'shamit' && !a.ai) && hub.authors.find(a => a.name === 'coder' && a.ai))
assert.ok(hub.agentShare > 0.3 && hub.agentShare < 0.6, 'agent share ' + hub.agentShare)
assert.ok(map.stats.agentShare > 0 && map.stats.agentShare < 0.2)

assert.ok(map.cycles.some(c => c.includes('lib/log.js') && c.includes('lib/fmt.js')), 'import cycle found')
assert.ok(node('server/index.js').entry && node('app/main.py').entry, 'entry points')
assert.ok(node('lib/log.js').score > node('web/style.css').score, 'a hub outranks a leaf')

const sum = summarize(map)
assert.match(sum, /11 files/); assert.match(sum, /Import cycles: lib\/fmt\.js <-> lib\/log\.js/); assert.match(sum, /External packages: .*express/)
const imp = queryMap(map, 'impact:lib/fmt.js')
assert.ok(imp.transitivelyAffected.includes('server/index.js') && imp.transitivelyAffected.includes('server/hub.js'), 'impact walks importers transitively: ' + JSON.stringify(imp))
const fq = queryMap(map, 'file:hub.js'); assert.strictEqual(fq.path, 'server/hub.js'); assert.ok(fq.importedBy.includes('server/index.js')); assert.ok(fq.writtenBy.some(w => /coder \(agent\)/.test(w)))
assert.deepStrictEqual(queryMap(map, 'symbol:slugify').definedIn.map(d => d.file), ['app/util.py']); assert.deepStrictEqual(queryMap(map, 'symbol:slugify').usedBy, ['app/main.py'])
assert.ok(queryMap(map, 'file:nope.js').error && queryMap(map, 'symbol:nope').error)
assert.ok(queryMap(map, '').summary, 'default query is the overview')
assert.deepStrictEqual(buildMap([]).nodes, [], 'empty workspace')

// the agent's copy is generated from this file and must not drift
import('../../../scripts/sync-codemap.mjs').then(m => {
  const have = fs.readFileSync(path.join(__dirname, '../../../agents/src/codemap.js'), 'utf8')
  assert.strictEqual(have, m.generate(), 'agents/src/codemap.js is out of date: run node scripts/sync-codemap.mjs')
  console.log('codemap tests passed:', map.stats.files, 'files,', map.stats.edges, 'edges,', map.stats.symbols, 'symbols')
}).catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
