// VESPR desktop (Electron).
// Jobs:
//   1. Be VESPR: the site and the app ship inside this app (folder web/) and are served from the private vespr-app:// origin, so
//      it opens instantly and offline; /auth and /api are passed on to the VESPR server by this process; the live connection goes
//      straight to the server. (An old install with an "ideUrl" setting still opens that address instead.)
//   2. Native OS integration: file associations, drag-and-drop, second-instance lock,
//      vespr:// deep links, and native File > Open dialogs.
//   3. Optionally make THIS computer a runner, so agents can build and test here
//      (e.g., building a Windows installer on a Windows PC).
// The runner asks before it runs anything for a workspace, and only runs while this app is open.
const { app, BrowserWindow, Menu, Tray, dialog, ipcMain, nativeImage, shell, protocol, net, session, safeStorage, nativeTheme, screen } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const http = require('node:http')
// One computer, one person (server/auth.js deviceGate): this computer's hardware ID, hashed with a VESPR salt so the raw ID never
// leaves it, goes with sign-in requests as x-vespr-device. null when the ID cannot be read (then the server does not bind).
function machineId () {
  try {
    if (process.platform === 'win32') return (execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true }).match(/MachineGuid\s+REG_SZ\s+(\S+)/) || [])[1] || null
    if (process.platform === 'darwin') return (execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' }).match(/"IOPlatformUUID" = "([^"]+)"/) || [])[1] || null
    return fs.readFileSync('/etc/machine-id', 'utf8').trim() || null
  } catch { return null }
}
const DEVICE_KEY = (() => { const id = machineId(); return id ? crypto.createHash('sha256').update('vespr-device-v1:' + id).digest('hex') : null })()
const { parseOpenTarget, parseUrl, parseArgv } = require('./open.js')
const sec = require('./security.js') // what the window may load, open, be granted and keep (test/security.test.js)
const { windowAppearance, resolveWallpaperPath } = require('./appearance.js')
let currentAppearance = null

// The app's own origin. Registered before the app is ready: standard + secure, so pages get storage, fetch and a normal origin.
const APP_SCHEME = 'vespr-app'
const APP_HOME = 'vespr-app://vespr/app/'
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
const WEB = path.join(__dirname, 'web')
const APP_ORIGIN = 'vespr-app://vespr'
const SETTINGS_FILE = path.join(__dirname, 'connect.html')
const SETTINGS_URL = pathToFileURL(SETTINGS_FILE).href
const openOutside = url => { if (sec.safeExternal(url)) shell.openExternal(url) } // web and mail links only; never file:, ms-*: and the like
// defaults.json is written at build time: the VESPR server, and the channel.
//   stable (default): the site and the app ship inside this app (web/).
//   test: the tester build. It installs beside the normal app as "VESPR Test" with its own settings and sign-in, loads every page
//   from the test server (falling back to its own copy when the server cannot be reached), and when the test server has a newer
//   version (/version.json) it says so and reloads, so whatever was merged shows up here within a minute.
const DEFAULTS = (() => { try { return require('./defaults.json') } catch { return {} } })()
const CHANNEL = DEFAULTS.channel === 'test' ? 'test' : 'stable'
if (CHANNEL === 'test') { app.setName('VESPR Test'); app.setPath('userData', path.join(app.getPath('appData'), 'VESPR Test')) }
// the VESPR server: the person's setting, else defaults.json (https://vespr.online by default)
const siteOf = c => String((c && c.site) || defaultSite()).replace(/\/+$/, '')
const defaultSite = () => String(DEFAULTS.site || '')
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain' }
// Sign in with Google / Microsoft / GitHub / Clever: in the browser, back to this app (server/desktop-auth.js). The app starts a
// request with a PKCE pair and a one-time listener on 127.0.0.1, opens the website's desktop-signin.html, and trades the one-use code
// it gets back for its own session (with the device key). The provider's pages never run inside the app; no token is in a URL.
const b64u = buf => Buffer.from(buf).toString('base64url')
function installId () {
  const f = path.join(app.getPath('userData'), 'install-id')
  try { const v = fs.readFileSync(f, 'utf8').trim(); if (/^[A-Za-z0-9._-]{16,64}$/.test(v)) return v } catch {}
  const v = b64u(crypto.randomBytes(24)); try { fs.writeFileSync(f, v, { mode: 0o600 }) } catch {} return v
}
let browserSignIn = null
async function startBrowserSignIn (provider, pick = null) {
  const site = siteOf(cfg); if (!site) throw new Error('no VESPR server is set')
  if (browserSignIn) { try { browserSignIn.close() } catch {} browserSignIn = null }
  const verifier = b64u(crypto.randomBytes(48)); const challenge = b64u(crypto.createHash('sha256').update(verifier).digest()); const state = b64u(crypto.randomBytes(24))
  const srv = http.createServer(); browserSignIn = srv
  await new Promise((ok, no) => { srv.once('error', no); srv.listen(0, '127.0.0.1', ok) })
  const port = srv.address().port
  const r = await net.fetch(site + '/auth/desktop/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, challenge, state, redirect: 'loopback', port, deviceLabel: os.hostname().slice(0, 60), clientVersion: app.getVersion() }) })
  const t = await r.json().catch(() => ({}))
  if (!r.ok || !t.txId) { srv.close(); browserSignIn = null; throw new Error(t.error || ('the server said ' + r.status)) }
  // pick: the sign-in already chosen in the app; the browser page follows it straight away (site/js/desktop-signin.js)
  const page = (t.browserUrl || (site + '/desktop-signin.html#tx=' + t.txId)) + (pick ? '&start=' + encodeURIComponent(pick) : '')
  const timer = setTimeout(() => { try { srv.close() } catch {} if (browserSignIn === srv) browserSignIn = null }, 10 * 60 * 1000)
  srv.on('request', async (req, res) => {
    const q = new URL(req.url, 'http://127.0.0.1')
    if (q.pathname !== '/vespr-cb') { res.writeHead(404); return res.end() }
    const done = (ok, text) => { res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(`<!doctype html><meta charset=utf-8><title>VESPR</title><body style="font:15px system-ui;background:#000;color:#eee;display:grid;place-items:center;height:90vh"><p>${text}</p>`) }
    if (q.searchParams.get('state') !== state) return done(false, 'This sign-in did not come from this app. Start again from the app.')
    try {
      const headers = { 'Content-Type': 'application/json' }; if (DEVICE_KEY) headers['x-vespr-device'] = DEVICE_KEY
      const x = await net.fetch(site + '/auth/desktop/exchanges', { method: 'POST', headers, body: JSON.stringify({ txId: t.txId, code: q.searchParams.get('code'), verifier, installId: installId() }) })
      const j = await x.json().catch(() => ({}))
      if (!x.ok || !j.token) { done(false, j.error === 'device_bound' || j.code === 'device_bound' ? String(j.error || 'This computer is used by another account.') : 'The app could not finish signing in (' + (j.error || x.status) + '). Start again from the app.'); return }
      done(true, 'Signed in. You can close this tab and go back to VESPR.')
      clearTimeout(timer); try { srv.close() } catch {} if (browserSignIn === srv) browserSignIn = null
      if (win && !win.isDestroyed()) {
        await win.webContents.executeJavaScript(`try{sessionStorage.setItem('vespr-session',${JSON.stringify(j.token)});localStorage.setItem('vespr-session',${JSON.stringify(j.token)})}catch(e){};location.href='vespr-app://vespr/app/'`)
        if (win.isMinimized()) win.restore(); win.show(); win.focus()
      }
    } catch (e) { done(false, 'The app could not reach the VESPR server. Start again from the app.') }
  })
  await shell.openExternal(page)
}
const waitingPage = provider => `<!doctype html><meta charset=utf-8><link rel=stylesheet href="/css/site.css"><body class=theme-dark><main class=auth-main><div class=auth-card><h1>Continue in your browser</h1><p class=lead>Your browser opened VESPR to sign in with ${provider}. When you press Continue there, this app signs you in.</p><p class=auth-foot><a href="/signin.html">Back to sign in</a></p></div></main>`

function serveApp (req) {
  const u = new URL(req.url)
  const startP = /^\/auth\/start\/(google|microsoft|github|clever|classlink|work\/[a-z0-9-]{1,40})$/.exec(u.pathname)
  if (startP) { // a provider button inside the app (or a school or company found by "Sign in with your school or work"): sign in through the browser instead
    const which = startP[1]; const hint = u.searchParams.get('login_hint') || ''
    const pick = which + (/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(hint) ? '?login_hint=' + encodeURIComponent(hint) : '')
    const label = which.startsWith('work/') ? 'your company' : which[0].toUpperCase() + which.slice(1)
    return startBrowserSignIn(which.startsWith('work/') ? 'work' : which, pick).then(() => new Response(waitingPage(label), { headers: { 'content-type': 'text/html; charset=utf-8' } }))
      .catch(e => new Response(`<!doctype html><meta charset=utf-8><link rel=stylesheet href="/css/site.css"><body class=theme-dark><main class=auth-main><div class=auth-card><h1>Could not start</h1><p class=lead>${String(e.message).replace(/[<>&]/g, '')}</p><p class=auth-foot><a href="/signin.html">Back to sign in</a></p></div></main>`, { status: 502, headers: { 'content-type': 'text/html; charset=utf-8' } }))
  }
  if (/^\/(auth|api)\//.test(u.pathname)) { // passed on to the server; the page never talks cross-site and sends no foreign Origin
    const site = siteOf(cfg); if (!site) return new Response(JSON.stringify({ error: 'no VESPR server is set' }), { status: 503 })
    const headers = new Headers(req.headers); for (const h of ['origin', 'referer', 'cookie', 'x-vespr-device']) headers.delete(h)
    if (DEVICE_KEY && u.pathname.startsWith('/auth/')) headers.set('x-vespr-device', DEVICE_KEY) // set here, never by the page
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body
    return net.fetch(site + u.pathname + u.search, { method: req.method, headers, body, duplex: 'half', redirect: 'manual' })
  }
  let p; try { p = decodeURIComponent(u.pathname) } catch { return new Response('bad path', { status: 400 }) }
  if (p === '/app') return Response.redirect(APP_HOME, 302)
  if (p === '/wallpaper' && currentAppearance && currentAppearance.wallpaperPath) {
    try {
      const wp = currentAppearance.wallpaperPath
      const ext = path.extname(wp).toLowerCase()
      const mime = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg')
      return new Response(fs.readFileSync(wp), { headers: { 'content-type': mime, 'cache-control': 'private, max-age=3600' } })
    } catch {}
  }
  if (CHANNEL === 'test') return fromServer(u).catch(() => null).then(r => r || fromBundle(p))
  return fromBundle(p)
}
// the tester build: the page as the test server has it right now (the server already maps /app/ and folders to their pages)
async function fromServer (u) {
  const site = siteOf(cfg); if (!site) return null
  const r = await net.fetch(site + u.pathname + u.search, { cache: 'no-store', redirect: 'manual' })
  if (!r.ok) return r.status === 404 ? new Response('not found', { status: 404 }) : null
  const type = r.headers.get('content-type') || 'application/octet-stream'
  let body = Buffer.from(await r.arrayBuffer())
  if (!u.pathname.startsWith('/app/') && /^text\/html/.test(type)) body = Buffer.from(body.toString('utf8').replace('<html ', '<html class="desktop-app" '), 'utf8')
  return new Response(body, { headers: { 'content-type': type, 'cache-control': 'no-store', ...(/^text\/html/.test(type) ? { 'content-security-policy': sec.PAGE_CSP } : {}) } })
}
function fromBundle (p) {
  const inApp = p.startsWith('/app/'); const root = path.join(WEB, inApp ? 'app' : 'site')
  let rel = inApp ? p.slice(4) : p
  if (rel === '/' || rel === '') rel = inApp ? '/prototype.html' : '/index.html'
  let file = path.normalize(path.join(root, rel))
  if (file !== root && !file.startsWith(root + path.sep)) return new Response('not found', { status: 404 })
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html') } catch { return new Response('not found', { status: 404 }) }
  let body; try { body = fs.readFileSync(file) } catch { return new Response('not found', { status: 404 }) }
  // the site's pages inside the app: marked so they drop the website around them (site.css, "desktop-app")
  if (!inApp && path.extname(file) === '.html') body = Buffer.from(body.toString('utf8').replace('<html ', '<html class="desktop-app" '), 'utf8')
  const html = path.extname(file).toLowerCase() === '.html'
  return new Response(body, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store', ...(html ? { 'content-security-policy': sec.PAGE_CSP } : {}) } })
}

// Enforce single instance lock so double-clicking a file/link routes to running instance
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

// Register the link scheme: vespr:// for the normal app, vespr-test:// for VESPR Test (so each is brought back by its own links, e.g. the
// "Back to the VESPR app" button after connecting a service in the browser)
const SCHEME = CHANNEL === 'test' ? 'vespr-test' : 'vespr'
app.setAsDefaultProtocolClient(SCHEME)

// The tester build: watch the test server's version. New pages: say so and reload in 10 s (Later keeps working, with a Reload
// button). A change to the app itself (desktop/) cannot load into a running app: say so and point at the new tester installer.
let seenVersion = null; let shellNoticeShown = false
const VERSION_POLL_MS = 20 * 1000
function versionBanner (v, kind) {
  const what = String(v.subject || v.commit || '').slice(0, 90)
  const short = String(v.commit || '').slice(0, 7)
  const text = kind === 'shell' ? `The app itself changed on the test server (${short}). Install the new VESPR Test to get it.` : `New version on the test server: ${what} (${short})`
  const dl = siteOf(cfg) + '/downloads/VESPR-Test-Setup.exe'
  return `(()=>{try{let b=document.getElementById('vespr-test-update');if(b)b.remove();b=document.createElement('div');b.id='vespr-test-update';b.setAttribute('role','status');
b.style.cssText='position:fixed;z-index:2147483647;left:50%;bottom:18px;transform:translateX(-50%);max-width:min(92vw,720px);background:#1e40af;color:#fff;font:14px/1.35 system-ui,sans-serif;padding:10px 14px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.45);display:flex;gap:10px;align-items:center';
const t=document.createElement('span');const base=${JSON.stringify(text)};const btn=l=>{const x=document.createElement('button');x.textContent=l;x.style.cssText='font:inherit;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;background:#fff;color:#1e40af;white-space:nowrap';return x};
if(${JSON.stringify(kind)}==='shell'){t.textContent=base;const g=btn('Download');g.onclick=()=>window.open(${JSON.stringify(dl)});const c=btn('Close');c.onclick=()=>b.remove();b.append(t,g,c)}
else{let n=10;const msg=()=>{t.textContent=base+' · reloading in '+n+' s'};msg();const now=btn('Reload now');const later=btn('Later');now.onclick=()=>location.reload();
const iv=setInterval(()=>{n--;if(n<=0){clearInterval(iv);location.reload()}else msg()},1000);later.onclick=()=>{clearInterval(iv);t.textContent=base;later.remove()};b.append(t,now,later)}
document.body.appendChild(b)}catch(e){}})()`
}
async function checkVersion () {
  if (CHANNEL !== 'test' || !win || win.isDestroyed()) return
  try {
    const r = await net.fetch(siteOf(cfg) + '/version.json', { cache: 'no-store' }); if (!r.ok) return
    const v = await r.json(); const id = String(v.commit || ''); if (!id) return
    win.setTitle(`VESPR Test · ${id.slice(0, 7)}`)
    if (v.desktop && DEFAULTS.desktop && v.desktop !== DEFAULTS.desktop && !shellNoticeShown) { shellNoticeShown = true; await win.webContents.executeJavaScript(versionBanner(v, 'shell')); return }
    if (seenVersion === null) { seenVersion = id; return }
    if (id !== seenVersion) { seenVersion = id; await win.webContents.executeJavaScript(versionBanner(v, 'pages')) }
  } catch {}
}

let win, tray, runner = null, cfg
const pendingTargets = []

const cfgPath = () => path.join(app.getPath('userData'), 'murmio.json')
const loadCfg = () => {
  try {
    const c = JSON.parse(fs.readFileSync(cfgPath(), 'utf8'))
    c.token = sec.openSecret(c, safeStorage); delete c.tokenSealed
    return c
  } catch {
    return {
      ideUrl: '',
      site: defaultSite(),
      server: '',
      token: '',
      label: `${os.hostname()} (${process.platform})`,
      runnerOn: false,
      allowed: []
    }
  }
}
const saveCfg = () => fs.writeFileSync(cfgPath(), JSON.stringify({ ...cfg, ...sec.sealSecret(cfg.token, safeStorage) }, null, 2), { mode: 0o600 }) // the token is never written in the clear when the OS can seal it

function handleTarget (target) {
  if (!target) return
  if (!win || win.webContents.isLoading()) {
    pendingTargets.push(target)
    return
  }
  win.webContents.send('vespr:open-target', target)

  // If protocol URL provides a server/room, can navigate directly
  if (target.type === 'protocol' && target.action === 'open' && target.server && target.room && /^[a-z0-9][a-z0-9-]{0,39}$/.test(target.room)) {
    if (!sec.sameServer(target.server, siteOf(cfg))) return // a link from anywhere must not move the app to another site
    win.loadURL(APP_HOME + '?room=' + encodeURIComponent(target.room))
  }
}

function flushPendingTargets () {
  while (pendingTargets.length > 0) {
    const t = pendingTargets.shift()
    if (win) win.webContents.send('vespr:open-target', t)
  }
}

// macOS open-file event
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  const target = parseOpenTarget(filePath, { checkFs: true })
  handleTarget(target)
})

// macOS open-url event (vespr://)
app.on('open-url', (event, rawUrl) => {
  event.preventDefault()
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() } // e.g. back from connecting a service in the browser
  const target = parseUrl(rawUrl)
  handleTarget(target)
})

// Windows / Linux second instance handler
app.on('second-instance', (_event, commandLine, workingDirectory) => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
  const targets = parseArgv(commandLine, {
    cwd: workingDirectory,
    checkFs: true,
    isPackaged: app.isPackaged
  })
  for (const t of targets) {
    handleTarget(t)
  }
})

async function startRunner () {
  if (runner || !cfg.server || !cfg.token) return
  const { startRunner: start } = await import(pathToFileURL(path.join(__dirname, 'runner', 'lib.js')).href)
  runner = start({
    server: cfg.server,
    token: cfg.token,
    label: cfg.label,
    root: path.join(app.getPath('userData'), 'runner'),
    log: m => console.log('[runner]', m),
    canRun: async room => {
      if (cfg.allowed.includes(room)) return true
      const r = await dialog.showMessageBox(win || undefined, {
        type: 'question',
        buttons: ['Allow always', 'Allow once', 'Deny'],
        defaultId: 2,
        cancelId: 2,
        title: 'VESPR runner',
        message: `Allow the workspace "${room}" to run commands on this computer?`,
        detail: process.platform === 'linux'
          ? 'Commands require the isolated Linux runner. If isolation is unavailable, the job is refused. You can turn the runner off at any time from the VESPR menu.'
          : 'Commands run in a temporary folder with a limited environment, using this account\'s file and network access. Allow only workspaces you trust. You can turn the runner off at any time from the VESPR menu.'
      })
      if (r.response === 0) {
        cfg.allowed.push(room)
        saveCfg()
      }
      return r.response !== 2
    }
  })
  updateMenu()
}

function stopRunner () {
  if (runner) {
    runner.stop()
    runner = null
    updateMenu()
  }
}

async function chooseAndOpenFile () {
  if (!win) return
  const res = await dialog.showOpenDialog(win, {
    title: 'Open File in VESPR',
    properties: ['openFile']
  })
  if (!res.canceled && res.filePaths.length > 0) {
    const target = parseOpenTarget(res.filePaths[0], { checkFs: true })
    handleTarget(target)
  }
}

async function chooseAndOpenFolder () {
  if (!win) return
  const res = await dialog.showOpenDialog(win, {
    title: 'Open Folder in VESPR',
    properties: ['openDirectory']
  })
  if (!res.canceled && res.filePaths.length > 0) {
    const target = parseOpenTarget(res.filePaths[0], { checkFs: true })
    handleTarget(target)
  }
}

function updateMenu () {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{
      label: 'VESPR',
      submenu: [
        { label: 'About VESPR', role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', click: () => win && win.loadFile(SETTINGS_FILE) },
        { type: 'separator' },
        {
          label: runner ? 'Runner: ON (agents may build here, after asking)' : 'Runner: off',
          type: 'checkbox',
          checked: !!runner,
          click: async () => {
            cfg.runnerOn = !runner
            saveCfg()
            cfg.runnerOn ? await startRunner() : stopRunner()
          }
        },
        { label: 'Forget allowed workspaces', click: () => { cfg.allowed = []; saveCfg() } },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Workspace…', click: openIde },
        { label: 'Open File…', accelerator: 'CmdOrCtrl+O', click: chooseAndOpenFile },
        { label: 'Open Folder…', click: chooseAndOpenFolder },
        { type: 'separator' },
        ...(!isMac ? [
          { label: 'Settings…', click: () => win && win.loadFile(SETTINGS_FILE) },
          {
            label: runner ? 'Runner: ON' : 'Runner: off',
            type: 'checkbox',
            checked: !!runner,
            click: async () => {
              cfg.runnerOn = !runner
              saveCfg()
              cfg.runnerOn ? await startRunner() : stopRunner()
            }
          },
          { label: 'Forget allowed workspaces', click: () => { cfg.allowed = []; saveCfg() } },
          { type: 'separator' },
          { role: 'quit' }
        ] : [])
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  if (tray) tray.setToolTip(runner ? 'VESPR: runner on' : 'VESPR')
}

function openIde () {
  if (!win) return
  if (cfg.ideUrl) win.loadURL(cfg.ideUrl) // an old install pointed at a hosted SDE
  else if (siteOf(cfg)) win.loadURL(APP_HOME)
  else win.loadFile(SETTINGS_FILE)
}


app.whenReady().then(async () => {
  cfg = loadCfg()
  protocol.handle(APP_SCHEME, serveApp)
  const iconPath = path.join(__dirname, 'build', 'icon.png')
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(nativeImage.createFromPath(iconPath)) } catch {}
  }
  const wallpaperPath = resolveWallpaperPath()
  currentAppearance = windowAppearance({ platform: process.platform, release: os.release(), reducedTransparency: nativeTheme.prefersReducedTransparency, highContrast: nativeTheme.shouldUseHighContrastColors, wallpaperPath })
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: CHANNEL === 'test' ? 'VESPR Test' : 'VESPR',
    icon: iconPath,
    ...currentAppearance.options,
    autoHideMenuBar: true, // the File / Edit / View / Window bar stays out of sight; Alt shows it
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: ['--vespr-site=' + siteOf(cfg), '--vespr-scheme=' + SCHEME, '--vespr-backdrop=' + currentAppearance.backdrop], // read-only OS appearance capability; no wallpaper bytes
      // the tester build talks to the private test server over the tailnet (WireGuard-encrypted) at a plain http:// address
      allowRunningInsecureContent: CHANNEL === 'test' && /^http:\/\//.test(siteOf(cfg)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // the page process has no Node and no file access; the preload only bridges the calls below
      webviewTag: false,
      navigateOnDragDrop: false
    }
  })
  const updateWallpaperCoords = () => {
    if (!win || win.isDestroyed() || !currentAppearance || currentAppearance.backdrop !== 'wallpaper') return
    try {
      const bounds = win.getBounds()
      const display = screen.getDisplayMatching(bounds)
      const winX = bounds.x - display.bounds.x
      const winY = bounds.y - display.bounds.y
      const monW = display.bounds.width
      const monH = display.bounds.height
      win.webContents.executeJavaScript(`
        if (document.documentElement) {
          document.documentElement.style.setProperty('--vespr-win-x', '${winX}px');
          document.documentElement.style.setProperty('--vespr-win-y', '${winY}px');
          document.documentElement.style.setProperty('--vespr-mon-w', '${monW}px');
          document.documentElement.style.setProperty('--vespr-mon-h', '${monH}px');
          document.documentElement.style.setProperty('--vespr-wallpaper', "url('/wallpaper')");
        }
      `).catch(() => {})
    } catch {}
  }
  win.on('move', updateWallpaperCoords)
  win.on('resize', updateWallpaperCoords)
  win.webContents.on('did-finish-load', updateWallpaperCoords)
  // camera, microphone, location, USB and the rest are refused; the app gets clipboard writes, notifications and fullscreen
  session.defaultSession.setPermissionRequestHandler((wc, permission, done, details) => done(sec.mayHavePermission(permission, (details && details.requestingUrl) || wc.getURL(), APP_ORIGIN)))
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => sec.mayHavePermission(permission, origin, APP_ORIGIN))
  win.webContents.on('will-attach-webview', e => e.preventDefault())
  if (cfg.screenshotProtection) {
    try { win.setContentProtection(true) } catch {}
  }

  if (CHANNEL === 'test') {
    win.on('page-title-updated', e => e.preventDefault()) // the title says which test version is open
    win.webContents.on('did-finish-load', () => { shellNoticeShown = false; checkVersion() }) // the app-changed notice comes back on every page
    setInterval(checkVersion, VERSION_POLL_MS)
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })

  // the app's own pages stay in the window; anything else (Stripe checkout, docs, GitHub) opens in the person's browser
  const keepInApp = (e, url) => { if (!sec.mayNavigate(url, { appOrigin: APP_ORIGIN, settingsUrl: SETTINGS_URL })) { e.preventDefault(); openOutside(url) } }
  win.webContents.on('will-navigate', keepInApp)
  win.webContents.on('will-redirect', keepInApp)
  win.webContents.on('did-finish-load', () => {
    flushPendingTargets()
  })

  tray = new Tray(nativeImage.createEmpty())
  updateMenu()
  openIde()

  // Process initial command-line arguments on startup (Windows / Linux)
  const initialTargets = parseArgv(process.argv, {
    cwd: process.cwd(),
    checkFs: true,
    isPackaged: app.isPackaged
  })
  for (const t of initialTargets) {
    handleTarget(t)
  }

  if (cfg.runnerOn) await startRunner()
})

// Which page is calling: the app (its own origin) or the local settings page. Any other page gets nothing.
const fromApp = e => sec.isAppPage(e.senderFrame && e.senderFrame.url, APP_ORIGIN) || fromSettings(e)
const fromSettings = e => sec.isSettingsPage(e.senderFrame && e.senderFrame.url, SETTINGS_URL)
ipcMain.handle('vespr:set-content-protection', (e, enable) => {
  if (!fromApp(e)) return false
  const on = Boolean(enable)
  cfg.screenshotProtection = on
  saveCfg()
  if (win && !win.isDestroyed()) {
    try { win.setContentProtection(on) } catch {}
  }
  updateMenu()
  return on
})
ipcMain.handle('vespr:get-content-protection', e => fromApp(e) && Boolean(cfg.screenshotProtection))

// the settings (with the runner token) are read and changed only by the local settings page, never by a web page
ipcMain.handle('murmio:get', e => fromSettings(e) ? { ...cfg } : null)
ipcMain.handle('murmio:save', async (e, raw) => {
  if (!fromSettings(e)) return false
  const next = sec.cleanSettings(raw, { allowHttp: CHANNEL === 'test' })
  if (!next) { dialog.showMessageBox(win || undefined, { type: 'warning', message: 'Use an https:// address (http:// only for this computer).' }); return false }
  Object.assign(cfg, {
    ideUrl: next.ideUrl !== undefined ? next.ideUrl : cfg.ideUrl,
    site: next.site !== undefined && next.site ? next.site : cfg.site,
    server: next.server !== undefined ? next.server : cfg.server,
    token: next.token !== undefined ? next.token : cfg.token,
    label: next.label || cfg.label
  })
  saveCfg()
  stopRunner()
  if (cfg.runnerOn) await startRunner()
  openIde()
  return true
})

app.on('window-all-closed', () => {
  stopRunner()
  if (process.platform !== 'darwin') app.quit()
})
