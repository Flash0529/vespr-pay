import assert from 'node:assert'
import { createProblems, MAX_PROBLEMS, MAX_PATH, SEVERITIES } from '../problems.js'

let n = 0
const t = (name, fn) => {
  try {
    fn()
    n++
  } catch (e) {
    console.error('FAILED: ' + name)
    throw e
  }
}

t('add validates and normalizes problems', () => {
  const m = createProblems()
  assert.equal(m.add({ file: 'src/main.py', line: 12, col: 4, message: 'undefined variable x', severity: 'error' }), true)
  assert.equal(m.add({ file: 'src/main.py', line: 20, col: 1, message: 'unused import', severity: 'warn', source: 'flake8' }), true)

  const items = m.list()
  assert.equal(items.length, 2)
  assert.equal(items[0].file, 'src/main.py')
  assert.equal(items[0].line, 12)
  assert.equal(items[0].col, 4)
  assert.equal(items[0].severity, 'error')
  assert.equal(items[0].source, 'workspace')

  assert.equal(items[1].severity, 'warning')
  assert.equal(items[1].source, 'flake8')
})

t('duplicate problems are ignored', () => {
  const m = createProblems()
  assert.equal(m.add({ file: 'a.py', line: 5, col: 1, message: 'bad syntax', severity: 'error' }), true)
  assert.equal(m.add({ file: 'a.py', line: 5, col: 1, message: 'bad syntax', severity: 'error' }), false)
  assert.equal(m.list().length, 1)
})

t('max limit evicts oldest problems when capacity is reached', () => {
  const m = createProblems({ max: 3 })
  m.add({ file: 'a.py', line: 1, col: 1, message: 'p1', severity: 'info' })
  m.add({ file: 'a.py', line: 2, col: 1, message: 'p2', severity: 'info' })
  m.add({ file: 'a.py', line: 3, col: 1, message: 'p3', severity: 'info' })

  // 4th problem evicts p1
  m.add({ file: 'b.py', line: 1, col: 1, message: 'p4', severity: 'error' })
  const items = m.list()
  assert.equal(items.length, 3)
  assert.equal(items[0].message, 'p2')
  assert.equal(items[1].message, 'p3')
  assert.equal(items[2].message, 'p4')
})

t('set replaces all problems for a given file', () => {
  const m = createProblems()
  m.add({ file: 'a.py', line: 1, col: 1, message: 'old 1', severity: 'error' })
  m.add({ file: 'a.py', line: 2, col: 1, message: 'old 2', severity: 'error' })
  m.add({ file: 'b.py', line: 1, col: 1, message: 'keep me', severity: 'warning' })

  const added = m.set('a.py', [
    { line: 10, col: 5, message: 'new diagnostic', severity: 'info' }
  ])
  assert.equal(added, 1)

  const items = m.list()
  assert.equal(items.length, 2)
  assert.equal(items.find(it => it.file === 'a.py').line, 10)
  assert.equal(items.find(it => it.file === 'b.py').message, 'keep me')
})

t('clear removes problems for a file or all files', () => {
  const m = createProblems()
  m.add({ file: 'a.py', line: 1, col: 1, message: 'p1' })
  m.add({ file: 'b.py', line: 1, col: 1, message: 'p2' })

  assert.equal(m.clear('a.py'), 1)
  assert.equal(m.list().length, 1)
  assert.equal(m.list()[0].file, 'b.py')

  assert.equal(m.clear(), 1)
  assert.equal(m.list().length, 0)
})

t('summary computes counts accurately', () => {
  const m = createProblems()
  m.add({ file: 'a.py', line: 1, col: 1, message: 'err1', severity: 'error' })
  m.add({ file: 'a.py', line: 2, col: 1, message: 'err2', severity: 'error' })
  m.add({ file: 'b.py', line: 3, col: 1, message: 'warn1', severity: 'warning' })
  m.add({ file: 'c.py', line: 4, col: 1, message: 'info1', severity: 'info' })

  const s = m.summary()
  assert.deepEqual(s, { total: 4, errors: 2, warnings: 1, infos: 1 })
})

t('filter filters by file, severity, and text query', () => {
  const m = createProblems()
  m.add({ file: 'src/main.py', line: 10, col: 1, message: 'syntax error in parser', severity: 'error' })
  m.add({ file: 'src/main.py', line: 15, col: 2, message: 'deprecated call', severity: 'warning' })
  m.add({ file: 'tests/test.py', line: 5, col: 1, message: 'missing assert', severity: 'error', source: 'pytest' })

  // By file
  assert.equal(m.filter({ file: 'src/main.py' }).length, 2)

  // By severity
  assert.equal(m.filter({ severity: 'error' }).length, 2)

  // By query
  const res = m.filter({ query: 'pytest' })
  assert.equal(res.length, 1)
  assert.equal(res[0].file, 'tests/test.py')

  // Combined
  assert.equal(m.filter({ file: 'src/main.py', severity: 'error' }).length, 1)
})

t('groupByFile groups and sorts problems', () => {
  const m = createProblems()
  m.add({ file: 'z.py', line: 1, col: 1, message: 'z-problem' })
  m.add({ file: 'a.py', line: 20, col: 1, message: 'a-second' })
  m.add({ file: 'a.py', line: 5, col: 10, message: 'a-first' })

  const g = m.groupByFile()
  const keys = Object.keys(g)
  assert.deepEqual(keys, ['a.py', 'z.py'])
  assert.equal(g['a.py'][0].line, 5)
  assert.equal(g['a.py'][1].line, 20)
})

t('formatRow formats clean single-line representation', () => {
  const m = createProblems()
  const row = m.formatRow({ file: 'cart.py', line: 8, col: 41, message: 'apply_discount returns wrong value', severity: 'warning', source: 'linter' })
  assert.equal(row, 'cart.py:8:41 [warning] apply_discount returns wrong value (linter)')
})

t('rename updates single file and rewrites folder prefixes', () => {
  const m = createProblems()
  m.add({ file: 'src/a.py', line: 1, col: 1, message: 'err' })
  m.add({ file: 'src/sub/b.py', line: 2, col: 2, message: 'warn' })
  m.add({ file: 'lib/c.py', line: 3, col: 3, message: 'info' })

  assert.equal(m.rename('lib/c.py', 'lib/main.py'), 1)
  assert.equal(m.list().find(it => it.message === 'info').file, 'lib/main.py')

  assert.equal(m.rename('src', 'pkg'), 2)
  const files = m.list().map(it => it.file)
  assert.deepEqual(files, ['pkg/a.py', 'pkg/sub/b.py', 'lib/main.py'])
})

t('serialize and deserialize round trip preserves state', () => {
  const m = createProblems()
  m.add({ file: 'a.py', line: 10, col: 2, message: 'test', severity: 'error', source: 'tool' })
  const json = m.serialize()

  const m2 = createProblems()
  assert.equal(m2.deserialize(json), true)
  assert.equal(m2.list().length, 1)
  assert.deepEqual(m2.list()[0], {
    file: 'a.py',
    line: 10,
    col: 2,
    message: 'test',
    severity: 'error',
    source: 'tool'
  })
})

t('hostile inputs do not throw and are handled cleanly', () => {
  const mNull = createProblems(null)
  assert.equal(mNull.list().length, 0)

  const m = createProblems()
  assert.equal(m.add(null), false)
  assert.equal(m.add(undefined), false)
  assert.equal(m.add(123), false)
  assert.equal(m.add({ file: '' }), false)
  assert.equal(m.add({ file: 'a\u0000b.py' }), false)
  assert.equal(m.add({ file: 'x'.repeat(MAX_PATH + 10) }), false)

  assert.equal(m.set(null, []), 0)
  assert.equal(m.set('a.py', null), 0)
  assert.equal(m.clear(null), 0)
  assert.equal(m.rename(null, null), 0)

  assert.equal(m.deserialize('not json'), false)
  assert.equal(m.deserialize('{"__proto__": {"polluted": true}}'), false)
  assert.equal(m.deserialize('{"items": [null, 123, {"file": ""}]}'), true)
  assert.equal(m.list().length, 0)
})

console.log(`problems tests passed (${n})`)
