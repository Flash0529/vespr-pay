import assert from 'node:assert'
import {
  MAX_PATH,
  KNOWN_LANGUAGES,
  langOf,
  langId,
  meta,
  commentPrefix,
  isExecutable,
  isCode,
  extensionOf
} from '../langdetect.js'

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

t('constants exist and contain core languages', () => {
  assert.strictEqual(MAX_PATH, 300)
  assert.ok(Array.isArray(KNOWN_LANGUAGES))
  assert.ok(KNOWN_LANGUAGES.includes('python'))
  assert.ok(KNOWN_LANGUAGES.includes('javascript'))
  assert.ok(KNOWN_LANGUAGES.includes('typescript'))
  assert.ok(KNOWN_LANGUAGES.includes('html'))
  assert.ok(KNOWN_LANGUAGES.includes('css'))
  assert.ok(KNOWN_LANGUAGES.includes('json'))
  assert.ok(KNOWN_LANGUAGES.includes('markdown'))
  assert.ok(KNOWN_LANGUAGES.includes('shell'))
  assert.ok(KNOWN_LANGUAGES.includes('rust'))
  assert.ok(KNOWN_LANGUAGES.includes('go'))
  assert.ok(KNOWN_LANGUAGES.includes('c'))
  assert.ok(KNOWN_LANGUAGES.includes('cpp'))
  assert.ok(KNOWN_LANGUAGES.includes('yaml'))
  assert.ok(KNOWN_LANGUAGES.includes('toml'))
  assert.ok(KNOWN_LANGUAGES.includes('sql'))
  assert.ok(KNOWN_LANGUAGES.includes('docker'))
  assert.ok(KNOWN_LANGUAGES.includes('git'))
  assert.ok(KNOWN_LANGUAGES.includes('make'))
  assert.ok(KNOWN_LANGUAGES.includes('plaintext'))
})

t('langOf resolves common file extensions to display names', () => {
  assert.strictEqual(langOf('cart.py'), 'Python')
  assert.strictEqual(langOf('index.js'), 'JavaScript')
  assert.strictEqual(langOf('module.mjs'), 'JavaScript')
  assert.strictEqual(langOf('bundle.cjs'), 'JavaScript')
  assert.strictEqual(langOf('app.ts'), 'TypeScript')
  assert.strictEqual(langOf('component.tsx'), 'TypeScript')
  assert.strictEqual(langOf('widget.jsx'), 'JavaScript')
  assert.strictEqual(langOf('index.html'), 'HTML')
  assert.strictEqual(langOf('icon.svg'), 'HTML')
  assert.strictEqual(langOf('style.css'), 'CSS')
  assert.strictEqual(langOf('theme.scss'), 'CSS')
  assert.strictEqual(langOf('data.json'), 'JSON')
  assert.strictEqual(langOf('README.md'), 'Markdown')
  assert.strictEqual(langOf('build.sh'), 'Shell')
  assert.strictEqual(langOf('main.rs'), 'Rust')
  assert.strictEqual(langOf('server.go'), 'Go')
  assert.strictEqual(langOf('main.c'), 'C')
  assert.strictEqual(langOf('header.h'), 'C')
  assert.strictEqual(langOf('native.cpp'), 'C++')
  assert.strictEqual(langOf('config.yml'), 'YAML')
  assert.strictEqual(langOf('deploy.yaml'), 'YAML')
  assert.strictEqual(langOf('settings.toml'), 'TOML')
  assert.strictEqual(langOf('query.sql'), 'SQL')
  assert.strictEqual(langOf('App.java'), 'Java')
  assert.strictEqual(langOf('script.rb'), 'Ruby')
  assert.strictEqual(langOf('notes.txt'), 'Plain text')
})

t('langOf handles uppercase and mixed-case extensions', () => {
  assert.strictEqual(langOf('MAIN.PY'), 'Python')
  assert.strictEqual(langOf('index.JS'), 'JavaScript')
  assert.strictEqual(langOf('STYLE.CSS'), 'CSS')
  assert.strictEqual(langOf('PAGE.HTML'), 'HTML')
  assert.strictEqual(langOf('README.MD'), 'Markdown')
})

t('langOf handles nested paths and Windows backslashes', () => {
  assert.strictEqual(langOf('src/components/Button.tsx'), 'TypeScript')
  assert.strictEqual(langOf('deeply/nested/dir/test.py'), 'Python')
  assert.strictEqual(langOf('server\\routes\\auth.js'), 'JavaScript')
  assert.strictEqual(langOf('mixed/path\\to/file.py'), 'Python')
})

t('langOf handles compound extensions', () => {
  assert.strictEqual(langOf('types.d.ts'), 'TypeScript')
  assert.strictEqual(langOf('src/globals.d.ts'), 'TypeScript')
})

t('langOf handles special exact names and dotfiles', () => {
  assert.strictEqual(langOf('Dockerfile'), 'Docker')
  assert.strictEqual(langOf('dockerfile'), 'Docker')
  assert.strictEqual(langOf('Makefile'), 'Make')
  assert.strictEqual(langOf('makefile'), 'Make')
  assert.strictEqual(langOf('.gitignore'), 'Git')
  assert.strictEqual(langOf('.gitattributes'), 'Git')
  assert.strictEqual(langOf('.gitmodules'), 'Git')
  assert.strictEqual(langOf('.env'), 'Config')
  assert.strictEqual(langOf('.env.local'), 'Config')
  assert.strictEqual(langOf('.bashrc'), 'Shell')
  assert.strictEqual(langOf('.zshrc'), 'Shell')
  assert.strictEqual(langOf('Cargo.toml'), 'TOML')
  assert.strictEqual(langOf('package.json'), 'JSON')
  assert.strictEqual(langOf('tsconfig.json'), 'JSON')
})

t('langOf handles multi-dot filenames', () => {
  assert.strictEqual(langOf('app.test.js'), 'JavaScript')
  assert.strictEqual(langOf('schema.spec.ts'), 'TypeScript')
  assert.strictEqual(langOf('.eslintrc.json'), 'JSON')
  assert.strictEqual(langOf('archive.tar.gz'), 'Plain text')
})

t('hostile input immunity for langOf and langId', () => {
  assert.strictEqual(langOf(null), 'Plain text')
  assert.strictEqual(langOf(undefined), 'Plain text')
  assert.strictEqual(langOf(''), 'Plain text')
  assert.strictEqual(langOf(123), 'Plain text')
  assert.strictEqual(langOf({}), 'Plain text')
  assert.strictEqual(langOf(['foo.py']), 'Plain text')
  assert.strictEqual(langOf('no_extension_file'), 'Plain text')
  assert.strictEqual(langOf('weird\u0000file.py'), 'Python')
  assert.strictEqual(langOf('trailing/slash/'), 'Plain text')
  assert.strictEqual(langOf('dot_at_end.'), 'Plain text')

  const longPath = 'a/'.repeat(200) + 'test.py'
  assert.strictEqual(langOf(longPath), 'Python')

  assert.strictEqual(langId(null), 'plaintext')
  assert.strictEqual(langId(undefined), 'plaintext')
  assert.strictEqual(langId(''), 'plaintext')
  assert.strictEqual(langId(123), 'plaintext')
  assert.strictEqual(langId('app.js'), 'javascript')
  assert.strictEqual(langId('__proto__'), 'plaintext')
  assert.strictEqual(langId('constructor'), 'plaintext')
})

t('meta returns complete language descriptors', () => {
  const pyMeta = meta('agent.py')
  assert.strictEqual(pyMeta.id, 'python')
  assert.strictEqual(pyMeta.name, 'Python')
  assert.strictEqual(pyMeta.icon, 'python')
  assert.strictEqual(pyMeta.commentToken, '#')
  assert.strictEqual(pyMeta.runCmd, 'python3')
  assert.strictEqual(pyMeta.isExecutable, true)

  const jsMeta = meta('server.js')
  assert.strictEqual(jsMeta.id, 'javascript')
  assert.strictEqual(jsMeta.name, 'JavaScript')
  assert.strictEqual(jsMeta.icon, 'javascript')
  assert.strictEqual(jsMeta.commentToken, '//')
  assert.strictEqual(jsMeta.runCmd, 'node')
  assert.strictEqual(jsMeta.isExecutable, true)

  const mdMeta = meta('docs/guide.md')
  assert.strictEqual(mdMeta.id, 'markdown')
  assert.strictEqual(mdMeta.name, 'Markdown')
  assert.strictEqual(mdMeta.icon, 'markdown')
  assert.strictEqual(mdMeta.commentToken, null)
  assert.strictEqual(mdMeta.runCmd, null)
  assert.strictEqual(mdMeta.isExecutable, false)

  const unknownMeta = meta('LICENSE')
  assert.strictEqual(unknownMeta.id, 'plaintext')
  assert.strictEqual(unknownMeta.name, 'Plain text')
  assert.strictEqual(unknownMeta.icon, 'file')
  assert.strictEqual(unknownMeta.commentToken, null)
  assert.strictEqual(unknownMeta.isExecutable, false)
})

t('meta returns new copies preventing map mutation', () => {
  const m1 = meta('test.py')
  m1.name = 'Hacked'
  m1.isExecutable = false

  const m2 = meta('test.py')
  assert.strictEqual(m2.name, 'Python')
  assert.strictEqual(m2.isExecutable, true)
})

t('isExecutable correctly identifies runnable scripts', () => {
  assert.strictEqual(isExecutable('cart.py'), true)
  assert.strictEqual(isExecutable('deploy.sh'), true)
  assert.strictEqual(isExecutable('server.js'), true)
  assert.strictEqual(isExecutable('task.rb'), true)
  assert.strictEqual(isExecutable('Makefile'), true)
  assert.strictEqual(isExecutable('style.css'), false)
  assert.strictEqual(isExecutable('index.html'), false)
  assert.strictEqual(isExecutable('data.json'), false)
  assert.strictEqual(isExecutable(null), false)
})

t('isCode distinguishes source code and markup from plain text', () => {
  assert.strictEqual(isCode('main.py'), true)
  assert.strictEqual(isCode('app.ts'), true)
  assert.strictEqual(isCode('index.html'), true)
  assert.strictEqual(isCode('styles.css'), true)
  assert.strictEqual(isCode('Dockerfile'), true)
  assert.strictEqual(isCode('notes.txt'), false)
  assert.strictEqual(isCode('unknown_file'), false)
  assert.strictEqual(isCode(null), false)
})

t('commentPrefix returns correct comment delimiters', () => {
  assert.strictEqual(commentPrefix('app.py'), '#')
  assert.strictEqual(commentPrefix('app.js'), '//')
  assert.strictEqual(commentPrefix('app.ts'), '//')
  assert.strictEqual(commentPrefix('app.html'), '<!--')
  assert.strictEqual(commentPrefix('app.css'), '/*')
  assert.strictEqual(commentPrefix('app.sql'), '--')
  assert.strictEqual(commentPrefix('app.sh'), '#')
  assert.strictEqual(commentPrefix('app.txt'), '')
  assert.strictEqual(commentPrefix(null), '')
})

t('extensionOf extracts normalized extensions', () => {
  assert.strictEqual(extensionOf('test.py'), 'py')
  assert.strictEqual(extensionOf('TEST.JS'), 'js')
  assert.strictEqual(extensionOf('types.d.ts'), 'd.ts')
  assert.strictEqual(extensionOf('archive.tar.gz'), 'gz')
  assert.strictEqual(extensionOf('.gitignore'), '')
  assert.strictEqual(extensionOf('noext'), '')
  assert.strictEqual(extensionOf(''), '')
  assert.strictEqual(extensionOf(null), '')
  assert.strictEqual(extensionOf('file.'), '')
})

console.log('langdetect tests passed (' + n + ')')
