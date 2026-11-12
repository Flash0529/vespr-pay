import assert from 'node:assert'
import { findTasks, claimTask } from '../src/tasks.js'

function createMockRoom (files = {}, { mode = 'auto', claims = {} } = {}) {
  const currentMode = mode
  const currentClaims = { ...claims }
  const fileMap = { ...files }

  return {
    list () {
      return Object.keys(fileMap)
    },
    read (path) {
      return fileMap[path] !== undefined ? fileMap[path] : null
    },
    mode () {
      return currentMode
    },
    claimedByOther (path) {
      return currentClaims[path] ? { by: currentClaims[path] } : null
    },
    claim (path) {
      currentClaims[path] = 'coder'
      return true
    }
  }
}

// Test Suite
console.log('Running tasks.test.js...')

// 1. Basic scanning of TODO and FIXME across file types
{
  const files = {
    'app/index.js': '// TODO: add error handling\nconsole.log(1);\n// FIXME: memory leak in loop',
    'lib/helper.py': '# TODO: implement caching\ndef calc(): return 42',
    'templates/page.html': '<!-- FIXME: aria-label missing -->\n<div>content</div>',
    'styles/theme.css': '/* TODO: responsive layout */'
  }
  const room = createMockRoom(files)
  const res = findTasks(room)
  assert.strictEqual(res.tasks.length, 5, 'Should find all 5 TODO/FIXME comments')
  assert.strictEqual(res.scannedFiles, 4)
  assert.strictEqual(res.truncated, false)

  const t0 = res.tasks[0]
  assert.strictEqual(t0.path, 'app/index.js')
  assert.strictEqual(t0.line, 1)
  assert.strictEqual(t0.marker, 'TODO')
  assert.strictEqual(t0.text, 'add error handling')
  assert(t0.id.startsWith('task-'), 'Task ID must have task- prefix')

  const t1 = res.tasks[1]
  assert.strictEqual(t1.path, 'app/index.js')
  assert.strictEqual(t1.line, 3)
  assert.strictEqual(t1.marker, 'FIXME')
  assert.strictEqual(t1.text, 'memory leak in loop')
}

// 2. Ignores skipped directories and binary/lock files
{
  const files = {
    'node_modules/foo/index.js': '// TODO: ignored node_modules',
    '.git/hooks/pre-commit': '# TODO: ignored git',
    'dist/bundle.js': '// TODO: ignored dist',
    'package-lock.json': '{\n  "name": "TODO ignored lock"\n}',
    'assets/logo.png': 'binary_content_TODO',
    'valid.js': '// TODO: valid finding'
  }
  const room = createMockRoom(files)
  const res = findTasks(room)
  assert.strictEqual(res.tasks.length, 1, 'Only valid.js should be scanned')
  assert.strictEqual(res.tasks[0].path, 'valid.js')
  assert.strictEqual(res.tasks[0].text, 'valid finding')
}

// 3. Path prefix filtering
{
  const files = {
    'server/index.js': '// TODO: server route',
    'server/auth.js': '// FIXME: auth check',
    'client/app.js': '// TODO: client view'
  }
  const room = createMockRoom(files)
  const serverRes = findTasks(room, { path: 'server' })
  assert.strictEqual(serverRes.tasks.length, 2, 'Prefix server should find 2 tasks')
  assert.strictEqual(serverRes.tasks[0].path, 'server/auth.js')
  assert.strictEqual(serverRes.tasks[1].path, 'server/index.js')

  const singleFile = findTasks(room, { path: 'client/app.js' })
  assert.strictEqual(singleFile.tasks.length, 1)
  assert.strictEqual(singleFile.tasks[0].path, 'client/app.js')
}

// 4. Limit and truncation
{
  const files = {
    'multi.js': '// TODO: 1\n// TODO: 2\n// TODO: 3\n// TODO: 4'
  }
  const room = createMockRoom(files)
  const res = findTasks(room, { limit: 2 })
  assert.strictEqual(res.tasks.length, 2)
  assert.strictEqual(res.truncated, true)
}

// 5. claimTask: Plan mode rejection
{
  const files = { 'todo.js': '// TODO: task 1' }
  const room = createMockRoom(files, { mode: 'plan' })
  const res = claimTask(room, { id: 'task-fake', path: 'todo.js' })
  assert(res.error.includes('plan mode is read-only'))
}

// 6. claimTask: Missing arguments
{
  const room = createMockRoom({ 'todo.js': '// TODO: task 1' })
  const res1 = claimTask(room, { path: 'todo.js' })
  assert(res1.error.includes('task id and path are required'))
  const res2 = claimTask(room, { id: 'task-1' })
  assert(res2.error.includes('task id and path are required'))
}

// 7. claimTask: Stale / missing task
{
  const room = createMockRoom({ 'todo.js': '// normal code' })
  const res = claimTask(room, { id: 'task-missing', path: 'todo.js' })
  assert(res.error.includes('stale task'))
}

// 8. claimTask: Already claimed by someone else
{
  const files = { 'todo.js': '// TODO: important fix' }
  const room = createMockRoom(files, { claims: { 'todo.js': 'alice' } })
  const found = findTasks(room)
  assert.strictEqual(found.tasks.length, 1)
  const res = claimTask(room, { id: found.tasks[0].id, path: 'todo.js' })
  assert.strictEqual(res.error, 'file already claimed by alice')
  assert.strictEqual(res.claimed, undefined)
}

// 9. claimTask: Successful claim
{
  const files = { 'todo.js': '// TODO: ready for claim' }
  const room = createMockRoom(files)
  const found = findTasks(room)
  assert.strictEqual(found.tasks.length, 1)
  const res = claimTask(room, { id: found.tasks[0].id, path: 'todo.js' })
  assert.strictEqual(res.claimed, true)
  assert.strictEqual(res.path, 'todo.js')
  assert.strictEqual(res.task.text, 'ready for claim')
  assert(res.note.includes('released when this agent response ends'))
  // Check that room now registers the claim
  assert.strictEqual(room.claimedByOther('todo.js')?.by, 'coder')
}

console.log('All tasks.test.js assertions PASSED.')
