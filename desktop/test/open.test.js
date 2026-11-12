const assert = require('node:assert')
const path = require('node:path')
const { parseUrl, parseOpenTarget, parseArgv } = require('../open.js')

console.log('Running desktop/test/open.test.js...')

// ── TEST 1: Protocol URLs (vespr://) ──────────────────────────────────────────
{
  const url1 = 'vespr://open?room=team-alpha&server=https://vespr.example.com'
  const p1 = parseUrl(url1)
  assert.strictEqual(p1.type, 'protocol')
  assert.strictEqual(p1.action, 'open')
  assert.strictEqual(p1.room, 'team-alpha')
  assert.strictEqual(p1.server, 'https://vespr.example.com')

  const url2 = 'vespr://share?token=9f8e7d6c5b4a3210'
  const p2 = parseUrl(url2)
  assert.strictEqual(p2.type, 'protocol')
  assert.strictEqual(p2.action, 'share')
  assert.strictEqual(p2.token, '9f8e7d6c5b4a3210')

  assert.strictEqual(parseUrl('https://example.com'), null)
  assert.strictEqual(parseUrl(''), null)
  console.log('  [PASS] Test 1: vespr:// protocol URLs parsed accurately')
}

// ── TEST 2: Local File & Directory Open Targets ──────────────────────────────
{
  const cwd = path.resolve('/tmp/mock-workspace')

  // Absolute file path
  const fileTarget = parseOpenTarget('/Users/alex/project/main.py', { cwd })
  assert.strictEqual(fileTarget.type, 'file')
  assert.strictEqual(fileTarget.name, 'main.py')
  assert(fileTarget.path.endsWith('main.py'))

  // Relative file path resolved against cwd
  const relTarget = parseOpenTarget('src/utils.ts', { cwd })
  assert.strictEqual(relTarget.type, 'file')
  assert.strictEqual(relTarget.name, 'utils.ts')
  assert.strictEqual(relTarget.path, path.join(cwd, 'src/utils.ts'))

  // Directory target (trailing slash)
  const dirTarget = parseOpenTarget('my-folder/', { cwd })
  assert.strictEqual(dirTarget.type, 'directory')
  assert.strictEqual(dirTarget.name, 'my-folder')

  // Flags and binary noise ignored
  assert.strictEqual(parseOpenTarget('--inspect=9229', { cwd }), null)
  assert.strictEqual(parseOpenTarget('-d', { cwd }), null)
  assert.strictEqual(parseOpenTarget('.', { cwd }), null)
  console.log('  [PASS] Test 2: Local files and directories resolved properly')
}

// ── TEST 3: CLI Argv Parsing (Packaged vs Development) ────────────────────────
{
  const cwd = path.resolve('/mock/workspace')

  // Packaged mode: argv[0] = app binary, argv[1...] = user inputs
  const packagedArgv = [
    'C:\\Program Files\\VESPR\\vespr.exe',
    '--no-sandbox',
    'C:\\Users\\shami\\Projects\\model.py',
    'vespr://open?room=lab'
  ]
  const targets1 = parseArgv(packagedArgv, { cwd, isPackaged: true })
  assert.strictEqual(targets1.length, 2)
  assert.strictEqual(targets1[0].type, 'file')
  assert.strictEqual(targets1[0].name, 'model.py')
  assert.strictEqual(targets1[1].type, 'protocol')
  assert.strictEqual(targets1[1].room, 'lab')

  // Development mode: argv[0] = electron, argv[1] = ., argv[2...] = inputs
  const devArgv = [
    '/usr/local/bin/electron',
    '.',
    '--inspect',
    'script.js'
  ]
  const targets2 = parseArgv(devArgv, { cwd, isPackaged: false })
  assert.strictEqual(targets2.length, 1)
  assert.strictEqual(targets2[0].type, 'file')
  assert.strictEqual(targets2[0].name, 'script.js')
  console.log('  [PASS] Test 3: Argv parsed in both packaged and dev execution modes')
}

// ── TEST 4: Windows Path Variations ──────────────────────────────────────────
{
  const winFile = parseOpenTarget('C:\\Users\\shami\\Desktop\\test.json')
  assert.strictEqual(winFile.type, 'file')
  assert.strictEqual(winFile.name, 'test.json')

  const winDir = parseOpenTarget('D:\\Code\\VESPR\\')
  assert.strictEqual(winDir.type, 'directory')
  assert.strictEqual(winDir.name, 'VESPR')
  console.log('  [PASS] Test 4: Windows path conventions handled correctly')
}

{
  // VESPR Test's own links (vespr-test://), e.g. "Back to the VESPR app" after connecting a service: a link, never a file to open
  const t = parseArgv(['VESPR Test.exe', 'vespr-test://connected'], { checkFs: true, isPackaged: true })
  assert.strictEqual(t.length, 1); assert.strictEqual(t[0].type, 'protocol'); assert.strictEqual(t[0].action, 'connected')
  assert.strictEqual(parseUrl('vespr-test://connected').action, 'connected')
  assert.strictEqual(parseUrl('vesprx://connected'), null)
  console.log('  [PASS] Test 5: vespr-test:// links are links')
}

console.log('All desktop/test/open.test.js assertions PASSED.')
