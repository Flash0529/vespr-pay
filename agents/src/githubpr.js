// GitHub, second step: send the workspace's changes back as a pull request (docs/GITHUB-INTEGRATION.md, Step 2). Step one (github.js) kept the commit the repository was opened at (`github`) and the git
// hash of every imported file (`githubBase`); this compares the workspace with that, and through the REST "git data" API (no git binary):
//   read the branch and the pinned commit's tree -> one blob per changed or added file -> a tree on top of the pinned tree (deleted files drop out) -> a commit whose parent is the pinned commit
//   -> a NEW branch vespr/<workspace>-<date> -> the pull request. It never force-pushes, never updates or deletes a branch, and never writes to the branch the workspace was opened from; a branch that moved
//   since is reported (and the files changed on both sides are listed), because the pull request is where GitHub shows such conflicts.
// Nothing leaves this computer before the room approves ONE card that lists the files, the target branch and the title and description that will be published (not even a read: what the card shows is
// a snapshot, and exactly that snapshot is what is sent). The token comes only from the agent's environment (GITHUB_TOKEN), is sent to api.github.com only, and is never logged, stored or said.
import { blobSha } from './github.js'

export const LIMITS = { files: 100, deletes: 200, perFile: 200 * 1024, total: 2 * 1024 * 1024, shown: 25, title: 120, body: 4000, branchTries: 5 }
// the same rules as the import (github.js): what is never sent back
const IGNORED = /(^|\/)(\.git|node_modules|__pycache__|\.venv|venv|dist|build|\.next|\.cache|target|\.idea|\.vscode)(\/|$)|(^|\/)\.DS_Store$/
const NAME_OK = /^[\w.\-/]+$/

const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n)
const oneLine = (s, n) => clean(String(s).replace(/\s+/g, ' '), n)
// Chat text can end up in a public pull request: long token-like strings are cut out (and the card shows the whole draft first).
export const redact = s => String(s).replace(/\b(?:gh[pousr]_|github_pat_|sk-)[A-Za-z0-9_-]{8,}/g, '[redacted]').replace(/[A-Za-z0-9_+/=-]{28,}/g, '[redacted]')
const enc = p => String(p).split('/').map(encodeURIComponent).join('/')
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '') || 'workspace'
const day = ms => new Date(ms).toISOString().slice(0, 10)
export const branchName = (room, ms = Date.now()) => `vespr/${slug(room.roomName)}-${day(ms)}`

// What differs between the workspace and the starting point. Paths are the workspace's; `repoPath` adds the folder the repository was opened at. The text is a snapshot taken now.
export function planPr ({ room, github, base }) {
  const sub = github.folder ? String(github.folder).replace(/\/+$/, '') + '/' : ''
  const out = { changed: [], added: [], deleted: [], skipped: { internal: 0, ignored: 0, name: 0, big: 0, limit: 0 } }
  const have = new Set(room.list()); let count = 0; let total = 0
  for (const p of [...have].sort()) {
    if (p.startsWith('.vespr/')) { out.skipped.internal++; continue }
    if (IGNORED.test(p)) { out.skipped.ignored++; continue }
    if (!NAME_OK.test(p) || p.includes('..') || p.startsWith('/')) { out.skipped.name++; continue }
    const text = room.read(p); if (text == null) continue
    const known = Object.prototype.hasOwnProperty.call(base, p); const sha = blobSha(text)
    if (known && base[p] === sha) continue
    const bytes = Buffer.byteLength(text)
    if (bytes > LIMITS.perFile) { out.skipped.big++; continue }
    if (count >= LIMITS.files || total + bytes > LIMITS.total) { out.skipped.limit++; continue }
    count++; total += bytes
    ;(known ? out.changed : out.added).push({ path: p, repoPath: sub + p, text, sha })
  }
  for (const p of Object.keys(base).sort()) {
    if (have.has(p)) continue
    if (out.deleted.length >= LIMITS.deletes) { out.skipped.limit++; continue }
    out.deleted.push({ path: p, repoPath: sub + p })
  }
  return out
}
export const countOf = plan => ({ changed: plan.changed.length, added: plan.added.length, deleted: plan.deleted.length })
const total = c => c.changed + c.added + c.deleted

// Title and description from the chat and the History: the first request, who asked, which agent edited which file. No model; everything cut to size and token-like strings removed.
export function draftPr ({ room, github, plan, title = '', body = '' }) {
  const since = Number(github.importedAt) || 0; const paths = new Set([...plan.changed, ...plan.added, ...plan.deleted].map(f => f.path))
  const asks = []; const people = new Set()
  for (const m of room.chat ? room.chat.toArray() : []) {
    if (m.get('role') !== 'user' || m.get('isAgent') || (m.get('ts') || 0) < since) continue
    people.add(String(m.get('author') || '?'))
    const t = oneLine(redact(String(m.get('text') && m.get('text').toString()).replace(/^\s*@\S+\s*/, '').split('\n')[0]), 140)
    if (t && !asks.some(a => a.text === t)) asks.push({ by: String(m.get('author') || '?'), text: t })
  }
  const agents = new Map()
  for (const e of room.provenance ? room.provenance.toArray() : []) {
    if ((e.get('ts') || 0) < since || !paths.has(e.get('file'))) continue
    const who = String(e.get('by') || '?'); const a = agents.get(who) || { model: String(e.get('model') || ''), files: new Set() }; a.files.add(e.get('file')); agents.set(who, a)
  }
  const c = countOf(plan)
  const t = oneLine(redact(title), LIMITS.title) || (asks[0] ? oneLine(asks[0].text, 70) : `Changes from the VESPR workspace ${room.roomName}`)
  const lines = [`Changes made in the VESPR workspace "${oneLine(room.roomName, 60)}", starting from ${github.owner}/${github.repo} at ${github.ref} (${String(github.sha).slice(0, 7)}).`, '', `${c.changed} changed, ${c.added} added, ${c.deleted} deleted.`]
  if (clean(body, LIMITS.body)) lines.push('', redact(clean(body, LIMITS.body)))
  if (asks.length) lines.push('', '**Requests in the workspace**', ...asks.slice(0, 5).map(a => `- ${a.by}: ${a.text}`))
  const who = [...people].map(n => `- ${n} (person): took part in the chat`).concat([...agents].map(([n, a]) => `- ${n} (agent${a.model ? ', ' + a.model : ''}): edited ${[...a.files].sort().slice(0, 8).join(', ')}${a.files.size > 8 ? ` and ${a.files.size - 8} more` : ''}`))
  if (who.length) lines.push('', '**Who worked on it**', ...who, '', '_People\'s own edits are not recorded per file; agents\' edits come from the History._')
  return { title: t, body: lines.join('\n').slice(0, LIMITS.body) }
}

const list = (label, files, shown = LIMITS.shown) => (files.length ? `${label} (${files.length}): ${files.slice(0, shown).map(f => f.repoPath).join(', ')}${files.length > shown ? `, and ${files.length - shown} more` : ''}` : '')
function cardText ({ github, plan, branch, draft }) {
  const s = plan.skipped; const left = [s.internal && `${s.internal} workspace file${s.internal === 1 ? '' : 's'} under .vespr/`, s.ignored && `${s.ignored} in dependency or build folders`, s.name && `${s.name} with names GitHub paths cannot hold`, s.big && `${s.big} over 200 KB`, s.limit && `${s.limit} over the size or count limit`].filter(Boolean)
  return [
    `Repository: ${github.owner}/${github.repo}. New branch: ${branch} (a number is added if that name is taken), pull request into ${github.ref}. The workspace was opened at commit ${String(github.sha).slice(0, 7)}.`,
    '', [list('Changed', plan.changed), list('Added', plan.added), list('Deleted', plan.deleted)].filter(Boolean).join('\n'),
    left.length ? `\nNot sent: ${left.join(', ')}.` : '',
    `\nTitle: ${draft.title}\n\nDescription:\n${draft.body}`,
    `\nNothing is sent until you approve. VESPR creates a new branch and a pull request; it never pushes to ${github.ref}, never force-pushes and does not merge. If ${github.ref} has moved since the workspace was opened, a note about it is added to the description.`
  ].filter(x => x !== '').join('\n')
}

// ---- the calls ----
export async function openPr ({ room, api, req = {}, now = Date.now, timeoutMs, onStage = () => {} }) {
  const github = room.settings.get('github')
  if (!github || !github.owner) return { status: 'no-repo' }
  if (!api) return { status: 'no-token' }
  const plan = planPr({ room, github, base: room.settings.get('githubBase') || {} }); const c = countOf(plan)
  if (!total(c)) return { status: 'nothing', counts: c, skipped: plan.skipped }
  const branch = branchName(room, now()); const draft = draftPr({ room, github, plan, title: req.title, body: req.body })
  const res = { status: 'error', counts: c, skipped: plan.skipped, base: github.ref, branch, title: draft.title }
  onStage('asking', { branch, base: github.ref, counts: c })
  const verdict = await room.requestApproval({ kind: 'pr', summary: `Open a pull request on ${github.owner}/${github.repo}? ${[c.changed && `${c.changed} changed`, c.added && `${c.added} added`, c.deleted && `${c.deleted} deleted`].filter(Boolean).join(', ')} on a new branch, into ${github.ref}`, detail: cardText({ github, plan, branch, draft }) }, timeoutMs)
  if (!verdict.approved) return { ...res, status: 'denied', by: verdict.by }
  onStage('sending', { branch, base: github.ref, counts: c })
  const R = `/repos/${github.owner}/${github.repo}`
  try {
    // 1. the branch the workspace was opened from, and whether it moved
    let tip; try { tip = (await api('GET', `${R}/git/ref/heads/${enc(github.ref)}`)).object.sha } catch (e) { if (e.status === 404) throw new Error(`${github.ref} is not a branch of ${github.owner}/${github.repo} (was it opened from a tag or a commit?)`); throw e }
    if (tip !== github.sha) {
      res.stale = { tip, overlap: [] }
      try { const cmp = await api('GET', `${R}/compare/${github.sha}...${tip}`); const theirs = new Set((cmp.files || []).map(f => f.filename)); res.stale.ahead = cmp.ahead_by; res.stale.overlap = [...plan.changed, ...plan.added, ...plan.deleted].map(f => f.repoPath).filter(p => theirs.has(p)) } catch { /* the pull request still shows conflicts */ }
    }
    // 2. the pinned commit's tree: modes (so an executable file stays executable) and what exists
    const treeSha = (await api('GET', `${R}/git/commits/${github.sha}`)).tree.sha
    const tree = await api('GET', `${R}/git/trees/${treeSha}?recursive=1`)
    if (tree.truncated) throw new Error('that repository is too large to read in one piece; pull requests are not supported for it yet')
    const at = new Map((tree.tree || []).map(e => [e.path, e])); const left = []
    const send = []; const drop = []
    for (const f of plan.changed) { const e = at.get(f.repoPath); if (e && (e.mode === '120000' || e.type === 'commit')) left.push(`${f.repoPath} (a link or submodule)`); else send.push({ ...f, kind: 'changed', mode: (e && e.mode) || '100644' }) }
    for (const f of plan.added) { if (at.get(f.repoPath)) left.push(`${f.repoPath} (the repository already has a file there that was not imported)`); else send.push({ ...f, kind: 'added', mode: '100644' }) }
    for (const f of plan.deleted) { const e = at.get(f.repoPath); if (e) drop.push({ ...f, mode: e.mode || '100644' }) }
    const sent = { changed: send.filter(f => f.kind === 'changed').length, added: send.filter(f => f.kind === 'added').length, deleted: drop.length }
    res.left = left
    if (!send.length && !drop.length) return { ...res, status: 'nothing' }
    // 3. objects, then the only things that become visible: a new branch and the pull request
    for (const f of send) {
      const b = await api('POST', `${R}/git/blobs`, { content: f.text, encoding: 'utf-8' })
      if (b.sha !== f.sha) throw new Error(`GitHub stored ${f.repoPath} differently from what was sent`)
    }
    const nt = await api('POST', `${R}/git/trees`, { base_tree: treeSha, tree: [...send.map(f => ({ path: f.repoPath, mode: f.mode, type: 'blob', sha: f.sha })), ...drop.map(f => ({ path: f.repoPath, mode: f.mode, type: 'blob', sha: null }))] })
    const message = `${draft.title}\n\nFrom the VESPR workspace ${oneLine(room.roomName, 60)}: ${sent.changed} changed, ${sent.added} added, ${sent.deleted} deleted.`
    const commit = await api('POST', `${R}/git/commits`, { message, tree: nt.sha, parents: [github.sha] })
    let made = ''
    for (let n = 1; n <= LIMITS.branchTries && !made; n++) {
      const name = n === 1 ? branch : `${branch}-${n}`
      try { await api('POST', `${R}/git/refs`, { ref: 'refs/heads/' + name, sha: commit.sha }); made = name } catch (e) { if (!(e.status === 422 && /exist/i.test(e.message) && n < LIMITS.branchTries)) throw e }
    }
    res.branch = made; res.branchCreated = true
    let body = draft.body
    if (res.stale) body += `\n\n> Note: ${github.ref} moved after this workspace was opened (${String(github.sha).slice(0, 7)} to ${String(tip).slice(0, 7)}${res.stale.ahead ? `, ${res.stale.ahead} commit${res.stale.ahead === 1 ? '' : 's'}` : ''}).${res.stale.overlap.length ? ' Files changed on both sides: ' + res.stale.overlap.slice(0, 15).join(', ') + '.' : ''} GitHub shows any conflicts below.`
    const pr = await api('POST', `${R}/pulls`, { title: draft.title, head: made, base: github.ref, body: body.slice(0, 60000) })
    if (!/^https:\/\/github\.com\//.test(String(pr.html_url))) throw new Error('GitHub did not return a pull request link')
    return { ...res, status: 'done', url: pr.html_url, number: pr.number, counts: sent }
  } catch (e) { return { ...res, status: 'error', error: oneLine(e.message, 300) } }
}

export function describePr (r, github = {}) {
  const c = r.counts ? [r.counts.changed && `${r.counts.changed} changed`, r.counts.added && `${r.counts.added} added`, r.counts.deleted && `${r.counts.deleted} deleted`].filter(Boolean).join(', ') : ''
  const left = r.left && r.left.length ? ` Left out: ${r.left.slice(0, 6).join('; ')}.` : ''
  const stale = r.stale ? ` ${r.base} moved after the workspace was opened${r.stale.overlap.length ? `; changed on both sides: ${r.stale.overlap.slice(0, 6).join(', ')}` : ''}. The pull request shows any conflicts.` : ''
  switch (r.status) {
    case 'done': return `Opened pull request #${r.number}: ${r.url} (branch ${r.branch} into ${r.base}; ${c}). Nothing was merged or pushed to ${r.base}.${stale}${left}`
    case 'denied': return 'No pull request was opened (the room declined or nobody answered). Nothing was sent to GitHub.'
    case 'nothing': return r.left && r.left.length ? `Nothing could be sent.${left}` : 'There is nothing to send: the workspace matches the commit it was opened at.'
    case 'no-token': return 'Pull requests are not set up on this server: the operator has to give the agent a GitHub token that can write to the repository (GITHUB_TOKEN). Nothing was sent.'
    case 'no-repo': return 'Open a GitHub repository in this workspace first (View, Open a GitHub repo); a pull request needs a starting point.'
    default: return `Could not open the pull request: ${r.error || 'unknown error'}.${r.branchCreated ? ` The branch ${r.branch} was created on GitHub; the pull request was not.` : ' Nothing was changed on GitHub.'}`
  }
}

// Real network access: api.github.com only, over https, no redirects. The token goes in one header to that host, is cut out of every error text, and is never logged.
export function githubApi ({ token = '', timeoutMs = 30000, fetchImpl = globalThis.fetch } = {}) {
  const scrub = s => (token ? String(s).split(token).join('[token]') : String(s))
  const explain = (status, data) => {
    const msg = data && typeof data.message === 'string' ? oneLine(data.message, 200) : ''
    if (status === 401) return 'GitHub did not accept the token'
    if (status === 403) return 'GitHub refused (rate limit, or the token cannot write to this repository: it needs Contents and Pull requests write access)'
    if (status === 404) return 'GitHub could not find that (the repository, branch or commit), or the token cannot see it'
    if (status === 422) return 'GitHub refused: ' + (msg || 'invalid request')
    return `GitHub answered ${status}${msg ? ': ' + msg : ''}`
  }
  return async function api (method, path, body) {
    if (!token) throw new Error('no GitHub token configured')
    if (!/^\/repos\/[\w.-]+\/[\w.-]+\/[\w./?=&~%-]*$/.test(path) || path.split('?')[0].split('/').some(seg => seg === '..' || seg === '.')) throw new Error('refused a path outside the repository')
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'vespr-agent', 'X-GitHub-Api-Version': '2022-11-28', Authorization: 'Bearer ' + token }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    let res
    try { res = await fetchImpl('https://api.github.com' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs), redirect: 'error' }) } catch (e) { throw new Error(scrub('could not reach GitHub: ' + e.message)) }
    let data = null; try { data = await res.json() } catch { /* no body */ }
    if (!res.ok) { const e = new Error(scrub(explain(res.status, data))); e.status = res.status; throw e }
    return data
  }
}

// The app asks with c.openPullRequest(); this answers. `api` is null when the operator gave no token: the app learns that from the `githubPr` setting and the request is answered without any network call.
export function startGithubPr ({ room, api, now = Date.now, timeoutMs }) {
  room.settings.set('githubPr', api ? 'on' : 'off')
  const done = new Set(); let queue = Promise.resolve()
  const check = () => {
    const req = room.settings.get('prRequest'); if (!req || !req.id || done.has(req.id)) return
    done.add(req.id)
    const was = room.settings.get('pr'); if (was && was.id === req.id) return // answered before this agent (re)started
    queue = queue.then(async () => {
      const put = patch => room.settings.set('pr', { id: req.id, by: req.by, ts: Date.now(), ...patch })
      put({ status: 'checking' })
      const r = await openPr({ room, api, req: { title: clean(req.title, LIMITS.title), body: clean(req.body, LIMITS.body) }, now, timeoutMs, onStage: (status, info) => put({ status, ...info }) })
      put({ status: r.status, url: r.url, number: r.number, branch: r.branch, base: r.base, counts: r.counts, left: r.left, stale: r.stale ? { ahead: r.stale.ahead || 0, overlap: r.stale.overlap } : undefined, error: r.error })
      room.say(describePr(r))
    }).catch(e => { console.error('pull request failed:', String(e && e.message).slice(0, 200)); try { room.settings.set('pr', { id: req.id, by: req.by, ts: Date.now(), status: 'error', error: 'something went wrong on the server' }) } catch {} })
  }
  room.settings.observe(check); check()
  return { stop: () => room.settings.unobserve(check) }
}
