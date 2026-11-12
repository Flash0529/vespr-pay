// Golden inputs for app/pathops.js (the explorer's create / rename / delete rules). Wrong-type inputs are "js-only".
const P = ['src/a.py', 'src/b.py', 'src/lib/c.py', 'README.md', 'docs/.keep', 'Tests/x.py']
export const calls = [
  // validateName
  ...['a.py', '  a.py  ', './a.py', '', '   ', '/a.py', 'a\\b', 'a\u0007b', 'a//b', 'a/./b', 'a/../b', '..', 'x'.repeat(121), 'x'.repeat(120),
    Array(13).fill('d').join('/'), Array(12).fill('d').join('/'), 'a b.py', 'café.py', 'name.', '.git/config', '.GIT/x', 'dir/.keep', 'dir/.KEEP',
    ' a.py ', '﻿a.py', 'a.py ', 'src/ok-name_1.ts'].map(n => ({ fn: 'validateName', args: [n] })),
  { fn: 'validateName', args: [null], note: 'js-only' },
  { fn: 'validateName', args: [42], note: 'js-only' },
  // joinPath
  { fn: 'joinPath', args: ['src', 'a.py'] },
  { fn: 'joinPath', args: ['/src/', '/a.py'] },
  { fn: 'joinPath', args: ['', 'a.py'] },
  { fn: 'joinPath', args: ['src', ''] },
  { fn: 'joinPath', args: ['///', '///x'] },
  // exists
  { fn: 'exists', args: [P, 'src/a.py'] },
  { fn: 'exists', args: [P, 'SRC/A.PY'], note: 'case-insensitive' },
  { fn: 'exists', args: [P, 'src'] },
  { fn: 'exists', args: [P, 'src/lib'] },
  { fn: 'exists', args: [P, 'docs'] },
  { fn: 'exists', args: [P, 'nope'] },
  { fn: 'exists', args: [[], 'src'] },
  { fn: 'exists', args: [['İ.py'], 'i̇.py'], note: 'trap: lowercase via JS rules' },
  // planCreate
  { fn: 'planCreate', args: [P, 'src', 'd.py', 'file'] },
  { fn: 'planCreate', args: [P, 'src', 'A.PY', 'file'], note: 'clash ignores case' },
  { fn: 'planCreate', args: [P, '', 'newdir', 'folder'] },
  { fn: 'planCreate', args: [P, 'README.md', 'x.py', 'file'], note: 'a file cannot hold a file' },
  { fn: 'planCreate', args: [P, 'src', 'lib', 'folder'] },
  { fn: 'planCreate', args: [P, 'src', 'x', 'link'] },
  { fn: 'planCreate', args: [P, 'src', '../x', 'file'] },
  { fn: 'planCreate', args: [P, Array(11).fill('d').join('/'), 'f', 'folder'], note: 'the marker makes it too deep' },
  // planRename
  { fn: 'planRename', args: [P, 'src/a.py', 'src/z.py'] },
  { fn: 'planRename', args: [P, 'src/a.py', 'src/b.py'] },
  { fn: 'planRename', args: [P, 'src/a.py', 'src/a.py'] },
  { fn: 'planRename', args: [P, 'src/a.py', 'src/A.py'], note: 'case-only rename is allowed' },
  { fn: 'planRename', args: [P, 'src', 'code'] },
  { fn: 'planRename', args: [P, 'src', 'src/inner'] },
  { fn: 'planRename', args: [P, 'src', 'docs'] },
  { fn: 'planRename', args: [P, 'src/lib/c.py', 'README.md/c.py'] },
  { fn: 'planRename', args: [P, 'README.md', 'src'], note: 'a file onto a folder name' },
  { fn: 'planRename', args: [P, 'nothing', 'x'] },
  { fn: 'planRename', args: [['b/Z.py', 'b/a.py', 'b/_.py', 'b/B.py'], 'b', 'c'], note: 'moves sorted by code unit, not by culture' },
  { fn: 'planRename', args: [P, 42, 'x'], note: 'js-only' },
  // planDelete
  { fn: 'planDelete', args: [P, 'src'] },
  { fn: 'planDelete', args: [P, 'SRC/LIB'] },
  { fn: 'planDelete', args: [P, 'README.md'] },
  { fn: 'planDelete', args: [P, 'missing'] },
  { fn: 'planDelete', args: [['z/b', 'z/B', 'z/a', 'z/_'], 'z'], note: 'trap: JS sort() is by code unit' },
  // markers
  { fn: 'isMarker', args: ['docs/.keep'] },
  { fn: 'isMarker', args: ['docs/.KEEP'] },
  { fn: 'isMarker', args: ['.keep'] },
  { fn: 'visiblePaths', args: [P] },
  { fn: 'visiblePaths', args: [[]] }
]
