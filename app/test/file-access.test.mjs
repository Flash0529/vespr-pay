// Chat-mode file access rules (app/file-access.js): organization policy, personal permission check, no write/run, secrets and limits.
import assert from 'node:assert'
import { CHAT_ACCESS, LIMITS, decideAttach, ensureReadable, screenItems, isSecretName, isNoisePath, cleanSettings, createFileAccessSettings } from '../file-access.js'

// ---- Chat mode can read what the person adds and nothing else
assert.deepStrictEqual(CHAT_ACCESS, { read: true, write: false, run: false, edit: false }); assert.ok(Object.isFrozen(CHAT_ACCESS) && Object.isFrozen(LIMITS))

// ---- company and school: only if the organization says yes, strictly
for (const kind of ['company', 'school']) {
  for (const policy of [undefined, null, {}, { fileContext: false }, { fileContext: 'true' }, { fileContext: 1 }, { folderContext: true }, 'yes', []]) {
    const d = decideAttach({ accountKind: kind, policy, kind: 'file' }); assert.strictEqual(d.allow, false, kind + ' ' + JSON.stringify(policy)); assert.strictEqual(d.by, 'organization')
  }
  assert.deepStrictEqual(decideAttach({ accountKind: kind, policy: { fileContext: true }, kind: 'file' }), { allow: true, step: 'ask-user', reason: 'Allowed by your organization.' })
  assert.strictEqual(decideAttach({ accountKind: kind, policy: { fileContext: true }, kind: 'folder' }).allow, false, 'files allowed does not allow folders')
  assert.strictEqual(decideAttach({ accountKind: kind, policy: { fileContext: true, folderContext: true }, kind: 'folder' }).allow, true)
  assert.strictEqual(decideAttach({ accountKind: kind, policy: { fileContext: true }, kind: 'file', settings: { files: 'deny' } }).by, 'person', 'the person can still say no inside an allowing organization')
}
// ---- personal: allowed after a permission step, unless the person turned it off; remembering "allow" skips the prompt, never the browser check
assert.deepStrictEqual(decideAttach({ accountKind: 'personal', kind: 'file' }).step, 'ask-user'); assert.strictEqual(decideAttach({ accountKind: 'personal', kind: 'file', settings: { files: 'allow' } }).step, 'none')
assert.strictEqual(decideAttach({ accountKind: 'personal', kind: 'folder', settings: { folders: 'deny' } }).allow, false); assert.strictEqual(decideAttach({ accountKind: 'personal', kind: 'file', settings: { folders: 'deny' } }).allow, true, 'files and folders are separate settings')
assert.strictEqual(decideAttach({ accountKind: 'personal', policy: { fileContext: false }, kind: 'file' }).allow, true, 'organization policy does not apply to a personal account')
// ---- no account, unknown account, unknown kind: blocked
for (const a of [undefined, null, '', 'guest', 'admin', 5]) assert.strictEqual(decideAttach({ accountKind: a, kind: 'file' }).allow, false, String(a))
for (const k of [undefined, 'dir', 'write', 'repo', 5]) assert.strictEqual(decideAttach({ accountKind: 'personal', kind: k }).allow, false, String(k))
assert.strictEqual(decideAttach().allow, false); assert.strictEqual(decideAttach(null).allow, false)

// ---- the browser's read permission is checked and only READ is ever requested
{
  const asked = []; const mk = (q, r) => ({ queryPermission: async o => { asked.push(['q', o.mode]); return q }, requestPermission: async o => { asked.push(['r', o.mode]); return r } })
  assert.deepStrictEqual(await ensureReadable(mk('granted', 'denied')), { ok: true, state: 'granted' })
  assert.deepStrictEqual(await ensureReadable(mk('prompt', 'granted')), { ok: true, state: 'granted' }); assert.deepStrictEqual(await ensureReadable(mk('prompt', 'denied')), { ok: false, state: 'denied' })
  assert.deepStrictEqual(await ensureReadable(mk('denied', 'granted')), { ok: false, state: 'denied' }, 'a denied permission is not re-requested behind the person\'s back')
  assert.ok(asked.every(([, m]) => m === 'read'), 'only read permission is ever asked for: ' + JSON.stringify(asked))
  assert.deepStrictEqual(await ensureReadable({}), { ok: true, state: 'picker-grant' }); assert.deepStrictEqual(await ensureReadable(null), { ok: false, state: 'no-handle' })
  assert.strictEqual((await ensureReadable({ queryPermission: async () => { throw new Error('boom') } })).ok, false)
}
// ---- secrets and noise never become context; limits hold
for (const n of ['.env', '.env.production', 'app/.env', 'id_rsa', '.ssh/id_ed25519', 'server.pem', 'cert.key', 'a/b/credentials.json', '.npmrc', 'vault.kdbx', 'C:\\Users\\x\\.ssh\\config']) assert.ok(isSecretName(n), n)
for (const n of ['environment.md', 'notes.txt', 'keyboard.txt', 'src/app.js', 'README.md', 'envelope.pdf']) assert.ok(!isSecretName(n), n)
for (const n of ['node_modules/x/index.js', 'a/.git/config', 'project/__pycache__/m.pyc']) assert.ok(isNoisePath(n), n); assert.ok(!isNoisePath('src/gitignore.md'))
{
  const r = screenItems([{ name: 'notes.md', size: 100 }, { name: '.env', size: 10 }, { name: 'big.bin', size: LIMITS.maxFileBytes + 1 }, { name: 'node_modules/a.js', size: 1 }, { name: 'x', size: -1 }, { name: 'y' }, null, { size: 5 }])
  assert.deepStrictEqual(r.kept, [{ name: 'notes.md', size: 100 }]); assert.strictEqual(r.skipped.length, 7); assert.strictEqual(r.total, 100)
  const many = screenItems(Array.from({ length: 25 }, (_, i) => ({ name: 'f' + i + '.txt', size: 10 }))); assert.strictEqual(many.kept.length, LIMITS.maxFiles)
  const heavy = screenItems(Array.from({ length: 6 }, (_, i) => ({ name: 'h' + i + '.txt', size: 4 * 1024 * 1024 }))); assert.strictEqual(heavy.kept.length, 5, 'total size cap 20 MB'); assert.strictEqual(screenItems('nope').kept.length, 0)
}
// ---- settings: valid values only, per kind, survives damage and blocked storage
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v) } }
assert.deepStrictEqual(cleanSettings({ files: 'allow', folders: 'root' }), { files: 'allow', folders: 'ask' }); assert.deepStrictEqual(cleanSettings(null), { files: 'ask', folders: 'ask' })
{ const st = mem(); const a = createFileAccessSettings(st); assert.deepStrictEqual(a.get(), { files: 'ask', folders: 'ask' }); a.set({ files: 'allow' }); a.set({ folders: 'bogus' }); assert.deepStrictEqual(createFileAccessSettings(st).get(), { files: 'allow', folders: 'ask' }); a.reset(); assert.deepStrictEqual(createFileAccessSettings(st).get(), { files: 'ask', folders: 'ask' })
  st.setItem('vespr.file-access.v1', '{x'); assert.deepStrictEqual(createFileAccessSettings(st).get(), { files: 'ask', folders: 'ask' }); const b = createFileAccessSettings({ getItem () { throw new Error('x') }, setItem () { throw new Error('x') } }); assert.strictEqual(b.set({ files: 'deny' }).files, 'deny') }
console.log('file access tests passed')
