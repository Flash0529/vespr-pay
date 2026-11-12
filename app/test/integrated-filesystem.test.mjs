import test from 'node:test'
import assert from 'node:assert/strict'
import * as FS from '../integrated-filesystem.js'

test('getScopeInfo returns scope properties and sandboxing state', () => {
  const student = { role: 'student' }
  const senior = { role: 'senior_dev' }

  const proj = FS.getScopeInfo('project', student)
  assert.equal(proj.scope, 'project')
  assert.equal(proj.canRead, true)
  assert.equal(proj.canWrite, true)
  assert.equal(proj.isSandboxed, false)

  const sysStudent = FS.getScopeInfo('system', student)
  assert.equal(sysStudent.scope, 'system')
  assert.equal(sysStudent.canRead, false)
  assert.equal(sysStudent.canWrite, false)
  assert.equal(sysStudent.isSandboxed, true)

  const sysSenior = FS.getScopeInfo('system', senior)
  assert.equal(sysSenior.canRead, true)
  assert.equal(sysSenior.canWrite, true)
  assert.equal(sysSenior.isSandboxed, false)
})

test('canAccessScope enforces role-based security boundaries', () => {
  const student = { role: 'student' }
  const junior = { role: 'junior_dev' }
  const legal = { role: 'corporate_legal' }
  const solo = { role: 'solo_dev' }

  // Student
  assert.equal(FS.canAccessScope(student, 'project', false), true)
  assert.equal(FS.canAccessScope(student, 'project', true), true)
  assert.equal(FS.canAccessScope(student, 'system', false), false)
  assert.equal(FS.canAccessScope(student, 'system', true), false)

  // Junior Dev
  assert.equal(FS.canAccessScope(junior, 'project', true), true)
  assert.equal(FS.canAccessScope(junior, 'system', false), true)
  assert.equal(FS.canAccessScope(junior, 'system', true), false)

  // Corporate Legal
  assert.equal(FS.canAccessScope(legal, 'project', false), true)
  assert.equal(FS.canAccessScope(legal, 'project', true), false)
  assert.equal(FS.canAccessScope(legal, 'system', false), true)
  assert.equal(FS.canAccessScope(legal, 'system', true), false)

  // Solo Dev
  assert.equal(FS.canAccessScope(solo, 'project', true), true)
  assert.equal(FS.canAccessScope(solo, 'system', true), true)
})

test('normalizePath resolves slashes, prefixes and parent traversal', () => {
  assert.equal(FS.normalizePath('project://src/index.js'), 'src/index.js')
  assert.equal(FS.normalizePath('system:///home/user/../user/test.sh'), 'home/user/test.sh')
  assert.equal(FS.normalizePath('src/./components/../app.js'), 'src/app.js')
  assert.equal(FS.normalizePath(''), '')
})

test('detectMimeType maps file extensions', () => {
  assert.equal(FS.detectMimeType('test.py'), 'text/x-python')
  assert.equal(FS.detectMimeType('script.js'), 'application/javascript')
  assert.equal(FS.detectMimeType('data.json'), 'application/json')
  assert.equal(FS.detectMimeType('image.png'), 'image/png')
  assert.equal(FS.detectMimeType('unknown.xyz'), 'application/octet-stream')
})

test('buildDirectoryTree creates nested hierarchy with file counts and natural sorting', () => {
  const entries = [
    { path: 'src/main.js', name: 'main.js', scope: 'project', isDirectory: false, size: 500 },
    { path: 'src/utils/math.js', name: 'math.js', scope: 'project', isDirectory: false, size: 300 },
    { path: 'package.json', name: 'package.json', scope: 'project', isDirectory: false, size: 150 },
    { path: 'README.md', name: 'README.md', scope: 'project', isDirectory: false, size: 80 }
  ]

  const tree = FS.buildDirectoryTree(entries, 'project')
  assert.equal(tree.length, 3) // "src" folder, "package.json", "README.md"

  const src = tree.find(n => n.name === 'src')
  assert.equal(src.isDirectory, true)
  assert.equal(src.fileCount, 2)
  assert.equal(src.size, 800)

  const utils = src.children.find(c => c.name === 'utils')
  assert.equal(utils.isDirectory, true)
  assert.equal(utils.fileCount, 1)
})

test('readFile, writeFile and copyBetweenScopes bidirectional transfers', () => {
  const storage = {}
  const dev = { role: 'senior_dev' }
  const student = { role: 'student' }

  // Write file to system host
  const wRes = FS.writeFile('datasets/test.csv', 'system', 'a,b,c\n1,2,3', storage, dev)
  assert.equal(wRes.success, true)
  assert.equal(storage['system:datasets/test.csv'], 'a,b,c\n1,2,3')

  // Copy from system host to project directory
  const cRes = FS.copyBetweenScopes(
    'datasets/test.csv', 'system',
    'imported/test.csv', 'project',
    storage, dev
  )
  assert.equal(cRes.success, true)
  assert.equal(storage['project:imported/test.csv'], 'a,b,c\n1,2,3')

  // Read back from project
  const rRes = FS.readFile('imported/test.csv', 'project', storage, dev)
  assert.equal(rRes.success, true)
  assert.equal(rRes.message, 'a,b,c\n1,2,3')

  // Student cannot copy from system host
  const deniedCopy = FS.copyBetweenScopes(
    'datasets/test.csv', 'system',
    'imported/stolen.csv', 'project',
    storage, student
  )
  assert.equal(deniedCopy.success, false)
  assert.match(deniedCopy.message, /denied/i)
})

test('deleteEntry removes file and subpaths', () => {
  const storage = {
    'project:src/index.js': 'console.log(1)',
    'project:src/sub/lib.js': 'console.log(2)'
  }
  const dev = { role: 'senior_dev' }

  const delOne = FS.deleteEntry('src/index.js', 'project', storage, dev)
  assert.equal(delOne.success, true)
  assert.equal(storage['project:src/index.js'], undefined)
  assert.notEqual(storage['project:src/sub/lib.js'], undefined)

  const delFolder = FS.deleteEntry('src/sub', 'project', storage, dev)
  assert.equal(delFolder.success, true)
  assert.equal(storage['project:src/sub/lib.js'], undefined)
})

test('searchFiles filters entries across scopes', () => {
  const proj = FS.createDefaultProjectEntries()
  const sys = FS.createDefaultSystemEntries(true)
  const all = [...proj, ...sys]

  const pyResults = FS.searchFiles('cart', 'project', all)
  assert.equal(pyResults.length, 2)
  assert.ok(pyResults.every(r => r.scope === 'project'))

  const sysResults = FS.searchFiles('backup', 'system', all)
  assert.equal(sysResults.length, 1)
  assert.equal(sysResults[0].name, 'backup.sh')
})

test('cloud and company scopes return correct metadata and permissions', () => {
  const student = { role: 'student' }
  const junior = { role: 'junior_dev' }
  const senior = { role: 'senior_dev' }

  const cloudSenior = FS.getScopeInfo('cloud', senior)
  assert.equal(cloudSenior.scope, 'cloud')
  assert.equal(cloudSenior.rootPath, 'cloud://')
  assert.equal(cloudSenior.canRead, true)
  assert.equal(cloudSenior.canWrite, true)

  const compSenior = FS.getScopeInfo('company', senior)
  assert.equal(compSenior.scope, 'company')
  assert.equal(compSenior.rootPath, 'company://')
  assert.equal(compSenior.canRead, true)
  assert.equal(compSenior.canWrite, true)

  // Student is locked out of company architecture
  assert.equal(FS.canAccessScope(student, 'company', false), false)
  assert.equal(FS.canAccessScope(student, 'company', true), false)

  // Junior dev can read company & cloud, but write to company requires elevation
  assert.equal(FS.canAccessScope(junior, 'company', false), true)
  assert.equal(FS.canAccessScope(junior, 'company', true), false)
  assert.equal(FS.canAccessScope(junior, 'cloud', true), true)
})

test('normalizePath handles cloud:// and company:// prefixes', () => {
  assert.equal(FS.normalizePath('cloud://google-drive/docs/spec.pdf'), 'google-drive/docs/spec.pdf')
  assert.equal(FS.normalizePath('company://monorepo/services/auth.js'), 'monorepo/services/auth.js')
})

test('cross-scope transfer between cloud, company, and project workspace', () => {
  const storage = {}
  const dev = { role: 'senior_dev' }

  // Seed file in cloud
  FS.writeFile('google-drive/roadmap.pdf', 'cloud', 'PDF-DATA-ROADMAP-2026', storage, dev)
  assert.equal(storage['cloud:google-drive/roadmap.pdf'], 'PDF-DATA-ROADMAP-2026')

  // Copy from cloud into project
  const cpRes = FS.copyBetweenScopes(
    'google-drive/roadmap.pdf', 'cloud',
    'imported/roadmap.pdf', 'project',
    storage, dev
  )
  assert.equal(cpRes.success, true)
  assert.equal(storage['project:imported/roadmap.pdf'], 'PDF-DATA-ROADMAP-2026')

  // Seed file in company monorepo
  FS.writeFile('monorepo/services/auth.yaml', 'company', 'service: auth\nport: 8080', storage, dev)
  // Copy from company into project
  const cpComp = FS.copyBetweenScopes(
    'monorepo/services/auth.yaml', 'company',
    'services/auth.yaml', 'project',
    storage, dev
  )
  assert.equal(cpComp.success, true)
  assert.equal(storage['project:services/auth.yaml'], 'service: auth\nport: 8080')
})

test('createDefaultCloudEntries and createDefaultCompanyEntries return valid entries', () => {
  const cloud = FS.createDefaultCloudEntries(true)
  const comp = FS.createDefaultCompanyEntries(true)

  assert.ok(cloud.length >= 2)
  assert.ok(cloud.every(e => e.scope === 'cloud'))
  assert.ok(cloud.some(e => e.name.includes('roadmap')))

  assert.ok(comp.length >= 2)
  assert.ok(comp.every(e => e.scope === 'company'))
  assert.ok(comp.some(e => e.name.includes('config.yaml')))
})

test('default system, cloud, company scopes return empty list without demo flag', () => {
  assert.deepEqual(FS.createDefaultSystemEntries(), [])
  assert.deepEqual(FS.createDefaultCloudEntries(), [])
  assert.deepEqual(FS.createDefaultCompanyEntries(), [])

  assert.ok(FS.createDefaultSystemEntries(true).length >= 4)
  assert.ok(FS.createDefaultCloudEntries(true).length >= 2)
  assert.ok(FS.createDefaultCompanyEntries(true).length >= 2)
})
