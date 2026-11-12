import assert from 'node:assert'
import {
  MAX_PATH,
  MAX_SEGMENTS,
  MIN_SEGMENTS,
  MAX_LABEL,
  format,
  parentOf,
  renderText,
  createBreadcrumbs
} from '../breadcrumbs.js'

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

t('constants exist and have expected bounds', () => {
  assert.strictEqual(MAX_PATH, 300)
  assert.strictEqual(MAX_SEGMENTS, 10)
  assert.strictEqual(MIN_SEGMENTS, 3)
  assert.strictEqual(MAX_LABEL, 80)
})

t('format parses single file into leaf breadcrumb', () => {
  const crumbs = format('cart.py')
  assert.strictEqual(crumbs.length, 1)
  assert.deepStrictEqual(crumbs[0], {
    label: 'cart.py',
    path: 'cart.py',
    isLeaf: true,
    isRoot: false,
    isSymbol: false,
    isEllipsis: false,
    icon: 'file'
  })
})

t('format parses nested path with folder icons and accumulated paths', () => {
  const crumbs = format('src/components/Button.tsx')
  assert.strictEqual(crumbs.length, 3)

  assert.strictEqual(crumbs[0].label, 'src')
  assert.strictEqual(crumbs[0].path, 'src')
  assert.strictEqual(crumbs[0].icon, 'folder')
  assert.strictEqual(crumbs[0].isLeaf, false)

  assert.strictEqual(crumbs[1].label, 'components')
  assert.strictEqual(crumbs[1].path, 'src/components')
  assert.strictEqual(crumbs[1].icon, 'folder')
  assert.strictEqual(crumbs[1].isLeaf, false)

  assert.strictEqual(crumbs[2].label, 'Button.tsx')
  assert.strictEqual(crumbs[2].path, 'src/components/Button.tsx')
  assert.strictEqual(crumbs[2].icon, 'file')
  assert.strictEqual(crumbs[2].isLeaf, true)
})

t('format includes root and symbol when provided', () => {
  const crumbs = format('app/editor.js', { root: 'vespr', symbol: 'mount()' })
  assert.strictEqual(crumbs.length, 4)

  assert.strictEqual(crumbs[0].label, 'vespr')
  assert.strictEqual(crumbs[0].isRoot, true)
  assert.strictEqual(crumbs[0].isLeaf, false)
  assert.strictEqual(crumbs[0].icon, 'workspace')

  assert.strictEqual(crumbs[1].label, 'app')
  assert.strictEqual(crumbs[1].icon, 'folder')

  assert.strictEqual(crumbs[2].label, 'editor.js')
  assert.strictEqual(crumbs[2].icon, 'file')
  assert.strictEqual(crumbs[2].isLeaf, false)

  assert.strictEqual(crumbs[3].label, 'mount()')
  assert.strictEqual(crumbs[3].isSymbol, true)
  assert.strictEqual(crumbs[3].isLeaf, true)
  assert.strictEqual(crumbs[3].icon, 'symbol')
})

t('compacts deep paths with an ellipsis segment when exceeding maxSegments', () => {
  const path = 'a/b/c/d/e/f/g/h/target.py'
  const crumbs = format(path, { maxSegments: 5 })
  assert.strictEqual(crumbs.length, 5)

  assert.strictEqual(crumbs[0].label, 'a')
  assert.strictEqual(crumbs[1].label, 'b')

  assert.strictEqual(crumbs[2].label, '…')
  assert.strictEqual(crumbs[2].isEllipsis, true)
  assert.strictEqual(crumbs[2].icon, 'more')
  assert.strictEqual(crumbs[2].isLeaf, false)

  assert.strictEqual(crumbs[3].label, 'h')
  assert.strictEqual(crumbs[4].label, 'target.py')
  assert.strictEqual(crumbs[4].isLeaf, true)
})

t('path normalization handles slashes, backslashes, and redundant separators', () => {
  const crumbs = format('///deep\\\\nested\\dir///file.py///')
  assert.strictEqual(crumbs.length, 4)
  assert.strictEqual(crumbs[0].label, 'deep')
  assert.strictEqual(crumbs[1].label, 'nested')
  assert.strictEqual(crumbs[2].label, 'dir')
  assert.strictEqual(crumbs[3].label, 'file.py')
  assert.strictEqual(crumbs[3].path, 'deep/nested/dir/file.py')
})

t('dot-dot segments resolve safely without escaping root', () => {
  const crumbs = format('../../../src/../lib/utils.js')
  assert.strictEqual(crumbs.length, 2)
  assert.strictEqual(crumbs[0].label, 'lib')
  assert.strictEqual(crumbs[1].label, 'utils.js')
  assert.strictEqual(crumbs[1].path, 'lib/utils.js')
})

t('hostile input immunity for format', () => {
  assert.deepStrictEqual(format(null), [])
  assert.deepStrictEqual(format(undefined), [])
  assert.deepStrictEqual(format(''), [])
  assert.deepStrictEqual(format(123), [])
  assert.deepStrictEqual(format({}), [])
  assert.deepStrictEqual(format(['a/b']), [])

  const withRootOnly = format(null, { root: 'my-project' })
  assert.strictEqual(withRootOnly.length, 1)
  assert.strictEqual(withRootOnly[0].label, 'my-project')
  assert.strictEqual(withRootOnly[0].isLeaf, true)

  const withNullByte = format('src/\u0000hidden/file.js')
  assert.strictEqual(withNullByte[1].label, 'hidden')
})

t('parentOf extracts directory path or empty string', () => {
  assert.strictEqual(parentOf('src/components/Button.tsx'), 'src/components')
  assert.strictEqual(parentOf('src/main.rs'), 'src')
  assert.strictEqual(parentOf('cart.py'), '')
  assert.strictEqual(parentOf(''), '')
  assert.strictEqual(parentOf(null), '')
  assert.strictEqual(parentOf(123), '')
  assert.strictEqual(parentOf('/a/b/c/'), 'a/b')
})

t('renderText joins breadcrumb labels with custom separator', () => {
  const crumbs = format('src/models/user.py', { root: 'shop', symbol: 'User.save()' })
  const text = renderText(crumbs)
  assert.strictEqual(text, 'shop > src > models > user.py > User.save()')

  const slashText = renderText(crumbs, ' / ')
  assert.strictEqual(slashText, 'shop / src / models / user.py / User.save()')

  assert.strictEqual(renderText(null), '')
  assert.strictEqual(renderText([]), '')
})

t('createBreadcrumbs factory sets persistent options and allows overrides', () => {
  const bc = createBreadcrumbs({ root: 'workspace-a', maxSegments: 4 })
  const list1 = bc.format('src/deep/nested/code.js')
  assert.strictEqual(list1[0].label, 'workspace-a')
  assert.strictEqual(list1.length, 4)

  const list2 = bc.format('src/deep/nested/code.js', { root: 'workspace-b' })
  assert.strictEqual(list2[0].label, 'workspace-b')

  assert.strictEqual(bc.parentOf('a/b/c'), 'a/b')
  assert.strictEqual(bc.renderText(list2), 'workspace-b > … > nested > code.js')
})

t('label length clamping respects MAX_LABEL', () => {
  const hugeSegment = 'a'.repeat(200)
  const crumbs = format(hugeSegment + '/test.py')
  assert.strictEqual(crumbs[0].label.length, MAX_LABEL)
  assert.strictEqual(crumbs[1].label, 'test.py')
})

console.log('breadcrumbs tests passed (' + n + ')')