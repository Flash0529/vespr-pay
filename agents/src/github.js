// GitHub, first step: open a repository in the workspace. A person gives owner/repo or a link (optionally a branch or folder); the agent pins it to one commit, downloads that commit's
// tarball, and writes the text files into the shared workspace. The commit and the git hash of every imported file are kept in the settings, so a later "send my changes back as a pull
// request" knows exactly what was the starting point. Public repositories need no key; a private one works only if the operator gave the agent a token (GITHUB_TOKEN), which is sent to
// api.github.com only and never shown. Binary and big files, dependency folders and odd file names are skipped and counted, and files already in the workspace are never overwritten.
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { parseGithubUrl } from './skills.js'

export const LIMITS = { files: 400, perFile: 200 * 1024, total: 2 * 1024 * 1024, tarball: 25 * 1024 * 1024, unpacked: 80 * 1024 * 1024 }
const IGNORED = /(^|\/)(\.git|node_modules|__pycache__|\.venv|venv|dist|build|\.next|\.cache|target|\.idea|\.vscode)(\/|$)|(^|\/)\.DS_Store$/
const NAME_OK = /^[\w.\-/]+$/

export function parseRepo (input) {
  const t = String(input || '').trim()
  return parseGithubUrl(/^[\w.-]+\/[\w.-]+$/.test(t) ? 'https://github.com/' + t : t)
}

function parsePax (buf) { // "<length> key=value\n" records; the length counts its own digits and the newline, in bytes
  const o = {}; let pos = 0
  while (pos < buf.length) {
    const sp = buf.indexOf(32, pos); if (sp < 0) break
    const len = parseInt(buf.toString('utf8', pos, sp), 10); if (!len) break
    const rec = buf.toString('utf8', sp + 1, pos + len - 1); const eq = rec.indexOf('=')
    if (eq > 0) o[rec.slice(0, eq)] = rec.slice(eq + 1)
    pos += len
  }
  return o
}

// A tar reader for what GitHub sends: ustar headers plus pax records for long names. Files only.
export function untar (buf) {
  const out = []; let off = 0; let pax = {}
  const str = (a, b) => buf.toString('utf8', a, b).replace(/\0[\s\S]*$/, '')
  while (off + 512 <= buf.length) {
    if (buf.subarray(off, off + 512).every(b => b === 0)) break
    let name = str(off, off + 100); const size = parseInt(str(off + 124, off + 136).trim() || '0', 8); const type = String.fromCharCode(buf[off + 156] || 48)
    const prefix = str(off + 345, off + 500); if (prefix) name = prefix + '/' + name
    if (!Number.isFinite(size) || size < 0 || off + 512 + size > buf.length) throw new Error('the archive is damaged')
    const data = buf.subarray(off + 512, off + 512 + size); off += 512 + Math.ceil(size / 512) * 512
    if (type === 'x') { pax = parsePax(data); continue }
    if (type === 'g') continue
    const p = pax.path || name; pax = {}
    if (type === '0' || type === '\0') out.push({ path: p, data })
  }
  return out
}

export const blobSha = text => crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + Buffer.byteLength(text) + '\0'), Buffer.from(text, 'utf8')])).digest('hex') // what git calls the file

export async function importRepo ({ room, input, fetchJson, fetchBuffer, msgId = 'import' }) {
  const r = parseRepo(input); const api = `https://api.github.com/repos/${r.owner}/${r.repo}`
  const meta = await fetchJson(api)
  const ref = r.ref || meta.default_branch; if (!ref) throw new Error('could not tell which branch to open')
  const sha = (await fetchJson(`${api}/commits/${encodeURIComponent(ref)}`)).sha
  if (!/^[0-9a-f]{40}$/.test(String(sha))) throw new Error('could not pin the repository to a commit')
  const tarball = await fetchBuffer(`${api}/tarball/${sha}`)
  let entries; try { entries = untar(zlib.gunzipSync(tarball, { maxOutputLength: LIMITS.unpacked })) } catch (e) { throw new Error('could not read the download: ' + e.message) }
  const have = new Set(room.list()); const skipped = { ignored: 0, big: 0, binary: 0, name: 0, limit: 0, exists: 0 }; const written = []; const base = {}; let total = 0
  const sub = r.path ? r.path.replace(/\/+$/, '') + '/' : ''
  for (const e of entries) {
    const rel = e.path.split('/').slice(1).join('/'); if (!rel) continue // the first folder in the archive is the repository itself
    if (sub && !rel.startsWith(sub)) continue
    const p = rel.slice(sub.length)
    if (!p || p.includes('..') || p.startsWith('/')) { skipped.name++; continue }
    if (IGNORED.test(p)) { skipped.ignored++; continue }
    if (!NAME_OK.test(p)) { skipped.name++; continue }
    if (e.data.length > LIMITS.perFile) { skipped.big++; continue }
    if (e.data.subarray(0, 8000).includes(0)) { skipped.binary++; continue }
    if (written.length >= LIMITS.files || total + e.data.length > LIMITS.total) { skipped.limit++; continue }
    if (have.has(p)) { skipped.exists++; continue }
    const text = e.data.toString('utf8'); const w = room.write(p, text, msgId)
    if (w && w.error) { skipped.name++; continue }
    written.push(p); total += e.data.length; base[p] = blobSha(text)
  }
  const info = { owner: r.owner, repo: r.repo, ref, sha, license: (meta.license && meta.license.spdx_id) || '', private: !!meta.private, folder: r.path || '', files: written.length, importedAt: Date.now() }
  return { ...info, written, skipped, base }
}

export function describe (res) {
  const s = res.skipped; const bits = []
  if (s.big) bits.push(`${s.big} too big`); if (s.binary) bits.push(`${s.binary} binary`); if (s.ignored) bits.push(`${s.ignored} in dependency or build folders`)
  if (s.name) bits.push(`${s.name} with names the workspace cannot hold`); if (s.limit) bits.push(`${s.limit} over the size limit`); if (s.exists) bits.push(`${s.exists} already in the workspace and left alone`)
  return `Opened ${res.owner}/${res.repo}${res.folder ? '/' + res.folder : ''} at ${res.ref} (${res.sha.slice(0, 7)}${res.license ? ', ' + res.license : ''}${res.private ? ', private' : ''}): ${res.files} file${res.files === 1 ? '' : 's'} added.${bits.length ? ' Skipped: ' + bits.join(', ') + '.' : ''} Everything is pinned to that commit, so changes can go back as a pull request later.`
}

// Real network access, limited to GitHub hosts. The token (if any) goes to api.github.com only and is never logged.
export function githubFetchers ({ token = '', timeoutMs = 20000, fetchImpl = globalThis.fetch } = {}) {
  const hosts = new Set(['api.github.com', 'codeload.github.com'])
  const get = async (url, accept) => {
    const u = new URL(url); if (u.protocol !== 'https:' || !hosts.has(u.hostname)) throw new Error('only GitHub hosts are allowed')
    const headers = { Accept: accept, 'User-Agent': 'vespr-agent' }; if (token && u.hostname === 'api.github.com') headers.Authorization = 'Bearer ' + token
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
    if (res.status === 404) throw new Error('GitHub says that repository, branch or folder does not exist (or it is private)')
    if (res.status === 403 || res.status === 429) throw new Error('GitHub refused the request (rate limit or no access)')
    if (!res.ok) throw new Error('GitHub answered ' + res.status)
    return res
  }
  return {
    fetchJson: async url => (await get(url, 'application/vnd.github+json')).json(),
    fetchBuffer: async url => {
      const res = await get(url, 'application/vnd.github+json'); const len = Number(res.headers.get('content-length') || 0)
      if (len > LIMITS.tarball) throw new Error('that repository is too large to open here')
      const b = Buffer.from(await res.arrayBuffer()); if (b.length > LIMITS.tarball) throw new Error('that repository is too large to open here'); return b
    }
  }
}

export function startGithub ({ room, fetchers }) {
  room.settings.set('githubImport', fetchers ? 'on' : 'off')
  const done = new Set(); let queue = Promise.resolve()
  const check = () => {
    const req = room.settings.get('importRequest'); if (!req || !req.id || done.has(req.id)) return
    done.add(req.id)
    queue = queue.then(async () => {
      try {
        if (!fetchers) throw new Error('opening GitHub repositories is not set up on this server')
        const res = await importRepo({ room, input: req.url, ...fetchers, msgId: 'import-' + req.id })
        const { base, written, ...info } = res
        room.doc.transact(() => { room.settings.set('github', { ...info, by: req.by }); room.settings.set('githubBase', { ...(room.settings.get('githubBase') || {}), ...base }) })
        room.say(describe(res))
      } catch (e) { room.say('Could not open that repository: ' + e.message) }
    }).catch(e => console.error('import failed:', e.message))
  }
  room.settings.observe(check); check()
  return { stop: () => room.settings.unobserve(check) }
}
