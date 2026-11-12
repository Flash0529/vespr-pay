import assert from 'node:assert'
import {
  MAX_ENTRIES,
  MAX_PATH,
  MAX_LINE,
  parseStatus,
  formatStatusLine,
  formatFileBadge,
  groupEntries
} from '../gitstatus.js'

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
  assert.strictEqual(MAX_ENTRIES, 500)
  assert.strictEqual(MAX_PATH, 300)
  assert.strictEqual(MAX_LINE, 1000)
})

t('parseStatus returns clean status for empty input', () => {
  const s = parseStatus('')
  assert.strictEqual(s.summary.isClean, true)
  assert.strictEqual(s.summary.total, 0)
  assert.strictEqual(s.entries.length, 0)
})

t('parseStatus parses branch line with tracking and ahead/behind', () => {
  const raw = '## fix-discount...origin/fix-discount [ahead 1, behind 2]\n'
  const s = parseStatus(raw)
  assert.strictEqual(s.branch, 'fix-discount')
  assert.strictEqual(s.upstream, 'origin/fix-discount')
  assert.strictEqual(s.ahead, 1)
  assert.strictEqual(s.behind, 2)
  assert.strictEqual(s.isDetached, false)
})

t('parseStatus parses simple branch and detached HEAD', () => {
  const s1 = parseStatus('## main\n')
  assert.strictEqual(s1.branch, 'main')
  assert.strictEqual(s1.upstream, null)
  assert.strictEqual(s1.ahead, 0)

  const s2 = parseStatus('## HEAD (no branch)\n')
  assert.strictEqual(s2.branch, 'HEAD')
  assert.strictEqual(s2.isDetached, true)
})

t('parseStatus parses staged and unstaged file modifications', () => {
  const raw = `## main
M  staged_mod.py
 M unstaged_mod.py
MM both_mod.py
A  added.js
D  deleted.txt
`
  const s = parseStatus(raw)
  assert.strictEqual(s.entries.length, 5)

  assert.strictEqual(s.entries[0].path, 'staged_mod.py')
  assert.strictEqual(s.entries[0].isStaged, true)
  assert.strictEqual(s.entries[0].isUnstaged, false)

  assert.strictEqual(s.entries[1].path, 'unstaged_mod.py')
  assert.strictEqual(s.entries[1].isStaged, false)
  assert.strictEqual(s.entries[1].isUnstaged, true)

  assert.strictEqual(s.entries[2].path, 'both_mod.py')
  assert.strictEqual(s.entries[2].isStaged, true)
  assert.strictEqual(s.entries[2].isUnstaged, true)

  assert.strictEqual(s.summary.stagedCount, 4)
  assert.strictEqual(s.summary.unstagedCount, 2)
})

t('parseStatus parses untracked files and renames', () => {
  const raw = `## main
?? scratch.py
R  old_cart.py -> new_cart.py
`
  const s = parseStatus(raw)
  assert.strictEqual(s.entries.length, 2)

  assert.strictEqual(s.entries[0].path, 'scratch.py')
  assert.strictEqual(s.entries[0].isUntracked, true)

  assert.strictEqual(s.entries[1].origPath, 'old_cart.py')
  assert.strictEqual(s.entries[1].path, 'new_cart.py')
  assert.strictEqual(s.entries[1].isStaged, true)
})

t('parseStatus unquotes quoted paths with spaces', () => {
  const raw = ' M "my space/file name.py"\n'
  const s = parseStatus(raw)
  assert.strictEqual(s.entries[0].path, 'my space/file name.py')
})

t('parseStatus detects merge conflicts', () => {
  const raw = `## main
UU conflict.js
AA both_added.py
`
  const s = parseStatus(raw)
  assert.strictEqual(s.entries.length, 2)
  assert.strictEqual(s.entries[0].isConflicted, true)
  assert.strictEqual(s.entries[1].isConflicted, true)
  assert.strictEqual(s.summary.conflictCount, 2)
})

t('formatStatusLine formats status bar git indicator', () => {
  assert.strictEqual(formatStatusLine({ branch: 'main', ahead: 1, behind: 0 }), 'main 1\u2191')
  assert.strictEqual(formatStatusLine({ branch: 'main', ahead: 0, behind: 2 }), 'main 2\u2193')
  assert.strictEqual(formatStatusLine({ branch: 'main', ahead: 1, behind: 2 }), 'main 2\u2193 1\u2191')
  assert.strictEqual(formatStatusLine({ branch: 'main', ahead: 0, behind: 0 }), 'main')
  assert.strictEqual(formatStatusLine(null), 'main')
})

t('formatFileBadge returns single-character badges', () => {
  assert.strictEqual(formatFileBadge({ isConflicted: true }), '!')
  assert.strictEqual(formatFileBadge({ isUntracked: true }), '?')
  assert.strictEqual(formatFileBadge({ isStaged: true, isUnstaged: true }), 'M')
  assert.strictEqual(formatFileBadge({ isStaged: true, isUnstaged: false, staged: 'A' }), 'A')
  assert.strictEqual(formatFileBadge({ isStaged: false, isUnstaged: true, unstaged: 'D' }), 'D')
})

t('groupEntries organizes files into categorized buckets', () => {
  const raw = `## main
M  staged.js
 M unstaged.js
?? new.txt
UU conflict.txt
`
  const s = parseStatus(raw)
  const g = groupEntries(s.entries)
  assert.strictEqual(g.staged.length, 1)
  assert.strictEqual(g.unstaged.length, 1)
  assert.strictEqual(g.untracked.length, 1)
  assert.strictEqual(g.conflicted.length, 1)
})

t('hostile input immunity for parseStatus and helpers', () => {
  assert.strictEqual(parseStatus(null).summary.isClean, true)
  assert.strictEqual(parseStatus(undefined).summary.isClean, true)
  assert.strictEqual(parseStatus(12345).summary.isClean, true)
  assert.strictEqual(parseStatus('garbage random text without prefix').summary.isClean, true)
  assert.deepStrictEqual(groupEntries(null), { staged: [], unstaged: [], untracked: [], conflicted: [] })
  assert.strictEqual(formatFileBadge(null), 'M')
})

console.log('gitstatus tests passed (' + n + ')')