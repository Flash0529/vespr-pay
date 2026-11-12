import assert from 'node:assert'
import {
  MAX_PATHS,
  MAX_PATH_LEN,
  MAX_DEPTH,
  MAX_ROWS,
  naturalCompare,
  sortTreeNodes,
  countTreeFiles,
  buildTree,
  flattenTree,
  findNode,
  filterTree
} from '../treeview.js'

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

// 1. Constants
t('exports safe boundary constants', () => {
  assert.strictEqual(MAX_PATHS, 5000)
  assert.strictEqual(MAX_PATH_LEN, 300)
  assert.strictEqual(MAX_DEPTH, 30)
  assert.strictEqual(MAX_ROWS, 2000)
})

// 2. naturalCompare
t('performs natural case-insensitive numeric sorting', () => {
  assert.ok(naturalCompare('file2.txt', 'file10.txt') < 0)
  assert.ok(naturalCompare('file10.txt', 'file2.txt') > 0)
  assert.strictEqual(naturalCompare('file.txt', 'FILE.txt'), 0)
  assert.strictEqual(naturalCompare(null, ''), 0)
})

// 3. buildTree basic hierarchy
t('builds a hierarchical tree from flat paths', () => {
  const paths = [
    'README.md',
    'src/index.js',
    'src/utils.js'
  ]
  const tree = buildTree(paths)
  assert.strictEqual(tree.length, 2)

  // src directory is first (folders first)
  const src = tree[0]
  assert.strictEqual(src.n, 'src')
  assert.strictEqual(src.full, 'src')
  assert.strictEqual(src.dir, 1)
  assert.strictEqual(src.count, 2)
  assert.strictEqual(src.kids.length, 2)

  // README.md file is second
  const readme = tree[1]
  assert.strictEqual(readme.n, 'README.md')
  assert.strictEqual(readme.full, 'README.md')
  assert.strictEqual(readme.dir, 0)
  assert.strictEqual(readme.ext, 'md')
  assert.strictEqual(readme.count, 1)
})

// 4. buildTree deep nesting
t('builds deeply nested folder structures with accurate counts', () => {
  const paths = [
    'a/b/c/d/file.txt',
    'a/b/other.js'
  ]
  const tree = buildTree(paths)
  assert.strictEqual(tree.length, 1)
  const a = tree[0]
  assert.strictEqual(a.count, 2)

  const nodeD = findNode(tree, 'a/b/c/d')
  assert.ok(nodeD)
  assert.strictEqual(nodeD.dir, 1)
  assert.strictEqual(nodeD.count, 1)
  assert.strictEqual(nodeD.kids[0].n, 'file.txt')
  assert.strictEqual(nodeD.kids[0].ext, 'txt')
})

// 5. buildTree sorting: folders first, then natural
t('sorts directories first, then natural alphabetical', () => {
  const paths = [
    'zoo.txt',
    'beta.txt',
    'alpha',
    'docs/b.md',
    'docs/a.md',
    'alpha/1.txt'
  ]
  const tree = buildTree(paths)
  // Folders first: alpha, docs. Then files: beta.txt, zoo.txt
  assert.strictEqual(tree[0].n, 'alpha')
  assert.strictEqual(tree[0].dir, 1)
  assert.strictEqual(tree[1].n, 'docs')
  assert.strictEqual(tree[1].dir, 1)
  assert.strictEqual(tree[2].n, 'beta.txt')
  assert.strictEqual(tree[2].dir, 0)
  assert.strictEqual(tree[3].n, 'zoo.txt')
  assert.strictEqual(tree[3].dir, 0)

  // Subfolder kids sorted: a.md before b.md
  assert.strictEqual(tree[1].kids[0].n, 'a.md')
  assert.strictEqual(tree[1].kids[1].n, 'b.md')
})

// 6. buildTree keep files
t('hides .keep files by default', () => {
  const paths = [
    'empty/.keep',
    'active/file.js',
    'active/.keep'
  ]
  const tree = buildTree(paths, { hideKeepFiles: true })
  const empty = findNode(tree, 'empty')
  assert.ok(empty)
  assert.strictEqual(empty.kids.length, 0)
  assert.strictEqual(empty.count, 0)

  const active = findNode(tree, 'active')
  assert.ok(active)
  assert.strictEqual(active.kids.length, 1)
  assert.strictEqual(active.kids[0].n, 'file.js')
})

// 7. changedPaths propagation
t('propagates chg flags from files up to parent folders', () => {
  const paths = [
    'src/feature/code.js',
    'src/other.js',
    'docs/read.md'
  ]
  const tree = buildTree(paths, { changedPaths: ['src/feature/code.js'] })
  const code = findNode(tree, 'src/feature/code.js')
  const feature = findNode(tree, 'src/feature')
  const src = findNode(tree, 'src')
  const docs = findNode(tree, 'docs')

  assert.strictEqual(code.chg, true)
  assert.strictEqual(feature.chg, true)
  assert.strictEqual(src.chg, true)
  assert.strictEqual(docs.chg, false)
})

// 8. countTreeFiles
t('recursively counts files across nodes', () => {
  const tree = buildTree(['a/1.js', 'a/2.js', 'b/c/3.js', 'root.txt'])
  assert.strictEqual(countTreeFiles(tree), 4)
  assert.strictEqual(countTreeFiles(null), 0)
  assert.strictEqual(countTreeFiles({ dir: 0 }), 1)
})

// 9. flattenTree visible rows
t('flattens tree into rows respecting isOpen and activePath', () => {
  const paths = [
    'src/components/button.jsx',
    'src/index.js',
    'package.json'
  ]
  const tree = buildTree(paths)

  // Nothing open
  const closedRows = flattenTree(tree, () => false)
  assert.strictEqual(closedRows.length, 2) // src, package.json
  assert.strictEqual(closedRows[0].n, 'src')
  assert.strictEqual(closedRows[0].dir, 1)
  assert.strictEqual(closedRows[0].open, false)
  assert.strictEqual(closedRows[0].depth, 0)

  // src open, components closed, active on package.json
  const openSet = new Set(['src'])
  const openRows = flattenTree(tree, path => openSet.has(path), { activePath: 'package.json' })
  assert.strictEqual(openRows.length, 4) // src (open), components (closed), index.js, package.json (active)
  assert.strictEqual(openRows[0].n, 'src')
  assert.strictEqual(openRows[0].open, true)
  assert.strictEqual(openRows[1].n, 'components')
  assert.strictEqual(openRows[1].depth, 1)
  assert.strictEqual(openRows[1].open, false)
  assert.strictEqual(openRows[2].n, 'index.js')
  assert.strictEqual(openRows[2].depth, 1)
  assert.strictEqual(openRows[3].n, 'package.json')
  assert.strictEqual(openRows[3].active, true)
})

// 10. findNode lookup
t('finds nodes by full path and returns null when not found', () => {
  const tree = buildTree(['dir/subdir/file.txt'])
  assert.strictEqual(findNode(tree, 'dir').dir, 1)
  assert.strictEqual(findNode(tree, 'dir/subdir').dir, 1)
  assert.strictEqual(findNode(tree, 'dir/subdir/file.txt').dir, 0)
  assert.strictEqual(findNode(tree, 'nonexistent'), null)
  assert.strictEqual(findNode(tree, null), null)
})

// 11. filterTree
t('filters tree nodes and retains ancestor directories', () => {
  const paths = [
    'src/components/Button.jsx',
    'src/components/Header.jsx',
    'src/utils/math.js',
    'README.md'
  ]
  const tree = buildTree(paths)
  const filtered = filterTree(tree, 'button')

  assert.strictEqual(filtered.length, 1)
  assert.strictEqual(filtered[0].n, 'src')
  assert.strictEqual(filtered[0].kids.length, 1)
  assert.strictEqual(filtered[0].kids[0].n, 'components')
  assert.strictEqual(filtered[0].kids[0].kids.length, 1)
  assert.strictEqual(filtered[0].kids[0].kids[0].n, 'Button.jsx')
})

// 12. Hostile inputs and robustness
t('handles hostile inputs, empty paths, backslashes, and bounds safely', () => {
  // Empty and bad types
  assert.deepStrictEqual(buildTree(null), [])
  assert.deepStrictEqual(buildTree(undefined), [])
  assert.deepStrictEqual(buildTree('not-an-array'), [])
  assert.deepStrictEqual(buildTree(['', '   ', '//']), [])

  // Windows backslashes
  const treeWin = buildTree(['src\\win\\test.js'])
  assert.ok(findNode(treeWin, 'src/win/test.js'))

  // Prototype pollution attempt
  const treeProto = buildTree(['__proto__/test.js', 'constructor/test.js'])
  assert.strictEqual(Object.prototype.polluted, undefined)

  // Cap huge paths array
  const bigList = Array.from({ length: 6000 }, (_, i) => 'f' + i + '.txt')
  const treeBig = buildTree(bigList)
  assert.ok(treeBig.length <= MAX_PATHS)
})

console.log('treeview tests passed (' + n + ')')
