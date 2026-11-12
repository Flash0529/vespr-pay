// "Run it": work out how to install, start and test a project from its files alone (no model needed).
// detectProject({ list, read }) -> { stack, name, install, dev, test, keepPrefix, notes }
//   list() -> every file path in the workspace;  read(path) -> its text.
// The dev command may use $PORT (the port the process manager picked) and $BASE_PATH (the preview prefix); both are also set as env vars.

const has = (list, name) => list.includes(name)
const json = text => { try { return JSON.parse(text) } catch { return null } }

function nodeProject (list, read) {
  const pkg = json(read('package.json')) || {}
  const scripts = pkg.scripts || {}
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  const notes = []
  let stack = 'node'; let dev = null; let keepPrefix = false
  if (deps.vite) { stack = 'vite'; dev = `npm run ${scripts.dev ? 'dev' : 'start'} -- --host 0.0.0.0 --port $PORT --strictPort --base $BASE_PATH`; keepPrefix = true }
  else if (deps.next) { stack = 'next'; dev = `npm run ${scripts.dev ? 'dev' : 'start'} -- -p $PORT -H 0.0.0.0`; notes.push('Next.js loads assets from root-absolute paths, so the preview page may look incomplete; set basePath in next.config for a faithful preview.') }
  else if (deps['react-scripts']) { stack = 'create-react-app'; dev = 'BROWSER=none HOST=0.0.0.0 npm start' }
  else if (scripts.dev) { dev = 'npm run dev' }
  else if (scripts.start) { dev = 'npm start' }
  else {
    const entry = ['server.js', 'index.js', 'app.js', 'main.js'].find(f => has(list, f))
    if (entry) dev = `node ${entry}`
    else notes.push('No dev/start script and no server.js, index.js or app.js: nothing to start yet.')
  }
  if (deps.express || deps.fastify || deps.koa || deps.hono) stack = stack === 'node' ? 'node-server' : stack
  const hasRealTest = scripts.test && !/no test specified/i.test(scripts.test)
  return { stack, name: pkg.name || null, install: 'npm install --no-audit --no-fund', dev, test: hasRealTest ? 'npm test' : null, keepPrefix, notes }
}

function pythonProject (list, read) {
  const reqs = ['requirements.txt', 'pyproject.toml', 'Pipfile'].filter(f => has(list, f)).map(f => read(f) || '').join('\n').toLowerCase()
  const notes = []
  let stack = 'python'; let dev = null
  const file = f => has(list, f)
  if (/\bdjango\b/.test(reqs) && file('manage.py')) { stack = 'django'; dev = 'python3 manage.py runserver 0.0.0.0:$PORT' }
  else if (/\bfastapi\b|\buvicorn\b/.test(reqs)) {
    stack = 'fastapi'; const mod = ['main', 'app', 'server'].find(m => file(`${m}.py`))
    if (mod) dev = `python3 -m uvicorn ${mod}:app --host 0.0.0.0 --port $PORT`; else notes.push('FastAPI found but no main.py/app.py/server.py to point uvicorn at.')
  } else if (/\bflask\b/.test(reqs)) {
    stack = 'flask'; const mod = ['app', 'main', 'server', 'wsgi'].find(m => file(`${m}.py`))
    if (mod) dev = `python3 -m flask --app ${mod} run --host 0.0.0.0 --port $PORT`; else notes.push('Flask found but no app.py/main.py/server.py.')
  } else if (file('index.html')) { stack = 'static'; dev = 'python3 -m http.server $PORT --bind 0.0.0.0' }
  else {
    const entry = ['app.py', 'main.py', 'server.py'].find(f => file(f))
    if (entry && /http\.server|socketserver|bottle|aiohttp|tornado|streamlit/.test(read(entry) || '')) dev = `python3 ${entry}`
    else notes.push('No web framework found: this looks like a script or library. Use run_command to run it.')
  }
  const tests = list.some(f => /(^|\/)test_.*\.py$|(^|\/)tests?\//.test(f))
  const test = /\bpytest\b/.test(reqs) ? 'python3 -m pytest -q' : tests ? 'python3 -m unittest -q' : null
  const install = reqs.trim() ? (has(list, 'requirements.txt') ? 'python3 -m venv .venv && . .venv/bin/activate && pip install -q -r requirements.txt' : 'python3 -m venv .venv && . .venv/bin/activate && pip install -q .') : null
  return { stack, name: null, install: install, dev: install && dev ? `. .venv/bin/activate && ${dev}` : dev, test, keepPrefix: false, notes }
}

export function detectProject ({ list, read }) {
  const files = list()
  const r = p => read(p) || ''
  let out
  if (has(files, 'package.json')) out = nodeProject(files, r)
  else if (has(files, 'requirements.txt') || has(files, 'pyproject.toml') || has(files, 'Pipfile') || files.some(f => f.endsWith('.py'))) out = pythonProject(files, r)
  else if (has(files, 'index.html')) out = { stack: 'static', name: null, install: null, dev: 'python3 -m http.server $PORT --bind 0.0.0.0', test: null, keepPrefix: false, notes: [] }
  else if (has(files, 'Makefile')) {
    const target = ['dev', 'serve', 'run', 'start'].find(t => new RegExp(`^${t}:`, 'm').test(r('Makefile')))
    out = { stack: 'make', name: null, install: null, dev: target ? `make ${target}` : null, test: /^test:/m.test(r('Makefile')) ? 'make test' : null, keepPrefix: false, notes: target ? [] : ['Makefile has no dev/serve/run/start target.'] }
  } else if (has(files, 'go.mod')) out = { stack: 'go', name: null, install: null, dev: 'go run .', test: 'go test ./...', keepPrefix: false, notes: ['Go must be installed in the sandbox; check the logs if it fails to start.'] }
  else if (has(files, 'Cargo.toml')) out = { stack: 'rust', name: null, install: null, dev: 'cargo run', test: 'cargo test', keepPrefix: false, notes: ['Rust must be installed in the sandbox; check the logs if it fails to start.'] }
  else out = { stack: 'unknown', name: null, install: null, dev: null, test: null, keepPrefix: false, notes: ['No package.json, requirements.txt, index.html, Makefile, go.mod or Cargo.toml found.'] }
  const command = out.dev ? [out.install, out.dev].filter(Boolean).join(' && ') : null
  return { ...out, command }
}
