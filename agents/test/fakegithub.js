// A small fake GitHub for the skill tests (no network). It answers the calls skillsearch.js, skills.js and packs.js make, and refuses anything that is not pinned to the commit it knows:
//   GET /search/repositories?q=...   -> repositories whose `via` lists the query kind ('topic' = the query has topic:agent-skills, 'words' = the other), most stars first
//   GET /repos/o/n/commits/HEAD      -> { sha }        GET /repos/o/n/commits/<sha> -> { sha } (404 for any other sha)
//   GET /repos/o/n/git/trees/<sha>?recursive=1, GET /repos/o/n/contents/<dir>?ref=<sha>   (404 unless <sha> is the repository's commit)
//   fetchText(raw.githubusercontent.com/o/n/<sha>/<path>)
// Every call is recorded in `calls`; `fail` switches on failures.
export function skillText (name, description, body = 'Do the careful thing, then say what you did.') {
  return `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n${body}\n`
}

export function makeGithub (repos) {
  const calls = []; const fail = { search: new Set(), raw: () => false, trees: false }
  const byName = new Map(repos.map(r => [r.full_name.toLowerCase(), r]))
  const err = status => new Error('GitHub answered ' + status)
  const sizeOf = f => (typeof f === 'string' ? Buffer.byteLength(f) : f.size ?? Buffer.byteLength(f.text))
  const textOf = f => (typeof f === 'string' ? f : f.text)
  const item = r => ({
    full_name: r.full_name, name: r.full_name.split('/')[1], description: r.description ?? null, stargazers_count: r.stars ?? 100,
    license: r.license === null ? null : { spdx_id: r.license || 'MIT' }, archived: !!r.archived, fork: !!r.fork,
    pushed_at: r.pushed || '2026-10-20T00:00:00Z', topics: r.topics || [], private: false, disabled: false
  })
  const fetchJson = async url => {
    calls.push(url); const u = new URL(url); let m
    if (u.hostname !== 'api.github.com') throw new Error('blocked host: ' + u.hostname)
    if (u.pathname === '/search/repositories') {
      const q = u.searchParams.get('q'); const kind = /\btopic:agent-skills\b/.test(q) ? 'topic' : 'words'
      if (fail.search === true || fail.search.has(kind)) throw err(403)
      const items = repos.filter(r => (r.via || ['topic', 'words']).includes(kind)).sort((a, b) => (b.stars ?? 100) - (a.stars ?? 100)).slice(0, Number(u.searchParams.get('per_page') || 30)).map(item)
      return { total_count: items.length, incomplete_results: false, items }
    }
    if (!(m = /^\/repos\/([^/]+\/[^/]+)\/(commits|git\/trees|contents)\/?(.*)$/.exec(u.pathname))) throw err(404)
    const r = byName.get(m[1].toLowerCase()); if (!r) throw err(404)
    const ref = u.searchParams.get('ref')
    if (m[2] === 'commits') { if (m[3] === 'HEAD' || m[3] === r.sha) return { sha: r.sha }; throw err(404) }
    if (m[2] === 'git/trees') {
      if (m[3] !== r.sha || fail.trees) throw err(404)
      return { sha: r.sha, truncated: !!r.truncated, tree: Object.entries(r.files).map(([path, f]) => ({ path, type: 'blob', size: sizeOf(f) })) }
    }
    if (ref !== r.sha) throw err(404) // contents must be asked at the pinned commit
    const dir = decodeURIComponent(m[3]).replace(/\/$/, ''); const prefix = dir ? dir + '/' : ''; const seen = new Set(); const out = []
    for (const [path, f] of Object.entries(r.files)) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length); const head = rest.split('/')[0]
      if (rest.includes('/')) { if (!seen.has(head)) { seen.add(head); out.push({ type: 'dir', name: head, path: prefix + head }) } } else out.push({ type: 'file', name: head, path, size: sizeOf(f), download_url: `https://raw.githubusercontent.com/${r.full_name}/${r.sha}/${path}` })
    }
    if (!out.length) throw err(404)
    return out
  }
  const fetchText = async url => {
    calls.push(url); const u = new URL(url)
    if (u.hostname !== 'raw.githubusercontent.com') throw new Error('blocked host: ' + u.hostname)
    const [, o, n, sha, ...rest] = u.pathname.split('/'); const r = byName.get((o + '/' + n).toLowerCase())
    if (!r || sha !== r.sha) throw err(404)
    if (fail.raw(url)) throw err(500)
    const f = r.files[rest.join('/')]; if (f === undefined) throw err(404)
    return textOf(f)
  }
  return { fetchers: { fetchJson, fetchText }, calls, fail }
}
