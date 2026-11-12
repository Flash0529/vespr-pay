// Language detection and file metadata helper for the SDE shell. Pure ES module.
export const MAX_PATH = 300
export const KNOWN_LANGUAGES = [
  'python',
  'javascript',
  'typescript',
  'html',
  'css',
  'json',
  'markdown',
  'shell',
  'rust',
  'go',
  'c',
  'cpp',
  'yaml',
  'toml',
  'sql',
  'docker',
  'git',
  'make',
  'config',
  'plaintext'
]

const DEFAULT_META = Object.freeze({
  id: 'plaintext',
  name: 'Plain text',
  icon: 'file',
  commentToken: null,
  runCmd: null,
  isExecutable: false
})

const LANG_MAP = {
  python: {
    id: 'python',
    name: 'Python',
    icon: 'python',
    commentToken: '#',
    runCmd: 'python3',
    isExecutable: true
  },
  javascript: {
    id: 'javascript',
    name: 'JavaScript',
    icon: 'javascript',
    commentToken: '//',
    runCmd: 'node',
    isExecutable: true
  },
  typescript: {
    id: 'typescript',
    name: 'TypeScript',
    icon: 'typescript',
    commentToken: '//',
    runCmd: 'node',
    isExecutable: false
  },
  html: {
    id: 'html',
    name: 'HTML',
    icon: 'html',
    commentToken: '<!--',
    runCmd: null,
    isExecutable: false
  },
  css: {
    id: 'css',
    name: 'CSS',
    icon: 'css',
    commentToken: '/*',
    runCmd: null,
    isExecutable: false
  },
  json: {
    id: 'json',
    name: 'JSON',
    icon: 'json',
    commentToken: null,
    runCmd: null,
    isExecutable: false
  },
  markdown: {
    id: 'markdown',
    name: 'Markdown',
    icon: 'markdown',
    commentToken: null,
    runCmd: null,
    isExecutable: false
  },
  shell: {
    id: 'shell',
    name: 'Shell',
    icon: 'terminal',
    commentToken: '#',
    runCmd: 'sh',
    isExecutable: true
  },
  rust: {
    id: 'rust',
    name: 'Rust',
    icon: 'rust',
    commentToken: '//',
    runCmd: 'cargo run',
    isExecutable: false
  },
  go: {
    id: 'go',
    name: 'Go',
    icon: 'go',
    commentToken: '//',
    runCmd: 'go run',
    isExecutable: false
  },
  c: {
    id: 'c',
    name: 'C',
    icon: 'code',
    commentToken: '//',
    runCmd: null,
    isExecutable: false
  },
  cpp: {
    id: 'cpp',
    name: 'C++',
    icon: 'code',
    commentToken: '//',
    runCmd: null,
    isExecutable: false
  },
  yaml: {
    id: 'yaml',
    name: 'YAML',
    icon: 'gear',
    commentToken: '#',
    runCmd: null,
    isExecutable: false
  },
  toml: {
    id: 'toml',
    name: 'TOML',
    icon: 'gear',
    commentToken: '#',
    runCmd: null,
    isExecutable: false
  },
  sql: {
    id: 'sql',
    name: 'SQL',
    icon: 'database',
    commentToken: '--',
    runCmd: null,
    isExecutable: false
  },
  docker: {
    id: 'docker',
    name: 'Docker',
    icon: 'container',
    commentToken: '#',
    runCmd: null,
    isExecutable: false
  },
  git: {
    id: 'git',
    name: 'Git',
    icon: 'branch',
    commentToken: '#',
    runCmd: null,
    isExecutable: false
  },
  make: {
    id: 'make',
    name: 'Make',
    icon: 'terminal',
    commentToken: '#',
    runCmd: 'make',
    isExecutable: true
  },
  config: {
    id: 'config',
    name: 'Config',
    icon: 'gear',
    commentToken: '#',
    runCmd: null,
    isExecutable: false
  },
  java: {
    id: 'java',
    name: 'Java',
    icon: 'code',
    commentToken: '//',
    runCmd: null,
    isExecutable: false
  },
  ruby: {
    id: 'ruby',
    name: 'Ruby',
    icon: 'code',
    commentToken: '#',
    runCmd: 'ruby',
    isExecutable: true
  }
}

const EXT_TO_LANG = {
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  svg: 'html',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  mdown: 'markdown',
  mkd: 'markdown',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  rs: 'rust',
  go: 'go',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  hh: 'cpp',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  java: 'java',
  rb: 'ruby',
  dockerfile: 'docker',
  txt: 'plaintext',
  text: 'plaintext',
  log: 'plaintext',
  env: 'config',
  ini: 'config',
  conf: 'config'
}

const EXACT_TO_LANG = {
  dockerfile: 'docker',
  makefile: 'make',
  'cargo.toml': 'toml',
  'package.json': 'json',
  'tsconfig.json': 'json',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  '.bashrc': 'shell',
  '.zshrc': 'shell',
  '.profile': 'shell',
  '.bash_profile': 'shell',
  '.env': 'config',
  '.env.local': 'config',
  '.env.example': 'config',
  '.env.development': 'config',
  '.env.test': 'config',
  '.env.production': 'config'
}

function cleanString (filename) {
  if (typeof filename !== 'string') return ''
  return filename.replace(/\u0000/g, '').trim()
}

function extractBasename (pathStr) {
  const norm = cleanString(pathStr).replace(/\\/g, '/')
  const lastSlash = norm.lastIndexOf('/')
  const base = lastSlash >= 0 ? norm.slice(lastSlash + 1) : norm
  return base.slice(0, MAX_PATH)
}

export function extensionOf (filename) {
  const base = extractBasename(filename).toLowerCase()
  if (!base) return ''

  // Compound extensions take priority
  if (base.endsWith('.d.ts')) return 'd.ts'

  const lastDot = base.lastIndexOf('.')
  if (lastDot <= 0) return ''
  return base.slice(lastDot + 1)
}

function resolveLangKey (filename) {
  const base = extractBasename(filename).toLowerCase()
  if (!base) return 'plaintext'

  // Exact filename takes precedence over extension rules
  if (Object.prototype.hasOwnProperty.call(EXACT_TO_LANG, base)) {
    return EXACT_TO_LANG[base]
  }

  // Compound extensions
  if (base.endsWith('.d.ts')) return 'typescript'

  const lastDot = base.lastIndexOf('.')
  if (lastDot === -1) return 'plaintext'

  const ext = base.slice(lastDot + 1)
  if (Object.prototype.hasOwnProperty.call(EXT_TO_LANG, ext)) {
    return EXT_TO_LANG[ext]
  }

  return 'plaintext'
}

export function langId (filename) {
  return resolveLangKey(filename)
}

export function langOf (filename) {
  const key = resolveLangKey(filename)
  return LANG_MAP[key] ? LANG_MAP[key].name : DEFAULT_META.name
}

export function meta (filename) {
  const key = resolveLangKey(filename)
  const entry = LANG_MAP[key]
  if (!entry) return { ...DEFAULT_META }
  return { ...entry }
}

export function commentPrefix (filename) {
  return meta(filename).commentToken || ''
}

export function isExecutable (filename) {
  return meta(filename).isExecutable === true
}

export function isCode (filename) {
  return resolveLangKey(filename) !== 'plaintext'
}
