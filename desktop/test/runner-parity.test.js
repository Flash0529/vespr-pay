const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { RUNTIME_FILES, copyRunner } = require('../tools/copy-runner.js')

const repo = path.resolve(__dirname, '..', '..')

test('shipping desktop runner bytes and relative dependencies match canonical runtime', () => {
  for (const name of RUNTIME_FILES) {
    const original = fs.readFileSync(path.join(repo, 'runner', name))
    const shipped = fs.readFileSync(path.join(repo, 'desktop', 'runner', name))
    assert.ok(original.equals(shipped), name + ' is stale; run npm run web before packaging')
    if (name.endsWith('.js')) {
      for (const match of original.toString('utf8').matchAll(/from\s+['"]\.\/(.+?)['"]/g)) {
        assert.ok(fs.existsSync(path.join(repo, 'desktop', 'runner', match[1])), 'missing runtime dependency ' + match[1])
      }
    }
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, 'desktop', 'runner', 'package.json'))).type, 'module')
  assert.ok(require('../package.json').build.files.includes('runner/**/*'))
})

function fixture (t) {
  const parent = fs.realpathSync(os.tmpdir())
  const root = fs.mkdtempSync(path.join(parent, 'vespr-runtime-copy-'))
  t.after(() => {
    // Only remove the exact fresh fixture created here, never a job-controlled path.
    assert.equal(path.dirname(root), parent)
    assert.ok(path.basename(root).startsWith('vespr-runtime-copy-'))
    fs.rmSync(root, { recursive: true, force: true })
  })
  fs.mkdirSync(path.join(root, 'runner'))
  fs.mkdirSync(path.join(root, 'desktop', 'runner'), { recursive: true })
  // Match the desktop package boundary; do not inherit a machine's parent ESM setting.
  fs.writeFileSync(path.join(root, 'desktop', 'package.json'), '{"type":"commonjs"}')
  for (const name of RUNTIME_FILES) fs.writeFileSync(path.join(root, 'runner', name), 'canonical fixture ' + name)
  return root
}

test('copy preserves unrelated desktop files and copies only the declared runtime', t => {
  const root = fixture(t)
  fs.writeFileSync(path.join(root, 'runner', 'notes.md'), 'do not ship')
  fs.writeFileSync(path.join(root, 'desktop', 'runner', 'owner-notes.txt'), 'preserve')
  fs.writeFileSync(path.join(root, 'desktop', 'runner', 'package.json'), '{"type":"module"}')
  assert.equal(copyRunner(root), RUNTIME_FILES.length)
  assert.equal(fs.readFileSync(path.join(root, 'desktop', 'runner', 'owner-notes.txt'), 'utf8'), 'preserve')
  assert.equal(fs.existsSync(path.join(root, 'desktop', 'runner', 'notes.md')), false)
  assert.equal(fs.readFileSync(path.join(root, 'desktop', 'runner', 'package.json'), 'utf8'), '{"type":"module"}')
})

test('an incomplete canonical runtime fails before overwriting an existing copy', t => {
  const root = fixture(t)
  fs.writeFileSync(path.join(root, 'desktop', 'runner', 'lib.js'), 'old runtime')
  fs.unlinkSync(path.join(root, 'runner', RUNTIME_FILES.at(-1)))
  assert.throws(() => copyRunner(root))
  assert.equal(fs.readFileSync(path.join(root, 'desktop', 'runner', 'lib.js'), 'utf8'), 'old runtime')
})

test('a linked destination is refused without touching the linked directory', t => {
  const root = fixture(t)
  const outside = path.join(root, 'separate-owner-folder')
  fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'lib.js'), 'owner data')
  fs.rmdirSync(path.join(root, 'desktop', 'runner'))
  try { fs.symlinkSync(outside, path.join(root, 'desktop', 'runner'), process.platform === 'win32' ? 'junction' : 'dir') } catch (error) {
    if (error.code === 'EPERM') { t.skip('This host cannot create test links'); return }
    throw error
  }
  assert.throws(() => copyRunner(root), /link/)
  assert.equal(fs.readFileSync(path.join(outside, 'lib.js'), 'utf8'), 'owner data')
})

test('desktop web preparation synchronizes runner before a build can ship it', t => {
  const root = fixture(t)
  for (const dir of ['site', 'app', 'desktop/tools']) fs.mkdirSync(path.join(root, dir), { recursive: true })
  fs.writeFileSync(path.join(root, 'site', 'index.html'), '<h1>fixture site</h1>')
  fs.mkdirSync(path.join(root, 'site', 'downloads'))
  fs.writeFileSync(path.join(root, 'site', 'downloads', 'installer-fixture.zip'), 'download artifact fixture')
  fs.writeFileSync(path.join(root, 'app', 'prototype.html'), '<h1>fixture app</h1>')
  for (const name of ['copy-web.js', 'copy-runner.js']) fs.copyFileSync(path.join(repo, 'desktop', 'tools', name), path.join(root, 'desktop', 'tools', name))
  const result = spawnSync(process.execPath, [path.join(root, 'desktop', 'tools', 'copy-web.js')], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.readFileSync(path.join(root, 'desktop', 'web', 'site', 'index.html'), 'utf8'), '<h1>fixture site</h1>')
  assert.equal(fs.existsSync(path.join(root, 'desktop', 'web', 'site', 'downloads')), false, 'installers must not be bundled inside another installer')
  assert.equal(fs.readFileSync(path.join(root, 'site', 'downloads', 'installer-fixture.zip'), 'utf8'), 'download artifact fixture')
  for (const name of RUNTIME_FILES) assert.ok(fs.readFileSync(path.join(root, 'runner', name)).equals(fs.readFileSync(path.join(root, 'desktop', 'runner', name))))
})
