// "Something else" at first run: a person types what the workspace is for in their own words and the agent looks for skills on GitHub. No model is involved, so it costs nothing and the steps are the same every time:
//   1. pull a few meaningful words out of the text (a stop-word list, at most 5)
//   2. ask the GitHub repository search two ways (the agent-skills topic, and the words plus "skill"), most stars first
//   3. keep only repositories that are not archived or forks, carry a license we accept, have at least 20 stars and were pushed to in the last ~18 months
//   4. for up to 6 of them: pin HEAD to a commit, read the git tree at that commit, take the SKILL.md that fits the words best, fetch and parse it, and drop it unless enough of the words fit
//   5. hand back at most 3, best first. Nothing is written or installed here: the caller shows one approval card first (packs.js).
// All GitHub access goes through the injected `fetchers` ({ fetchJson, fetchText }; httpFetchers in skills.js allows only api.github.com and raw.githubusercontent.com), so tests use a fake and never touch the network.
import path from 'node:path'
import { parseSkill } from './skills.js'

export const ALLOWED_LICENSES = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Unlicense', 'CC0-1.0'])
export const SEARCH_LIMITS = { text: 200, terms: 5, topicTerms: 3, minStars: 20, maxAgeDays: 548, candidates: 6, offer: 3, skillBytes: 60 * 1024, perPage: 30 }
export const SKILL_TOPICS = ['agent-skills', 'agent-skill', 'ai-skills', 'skills']
const SKIP_DIRS = /(^|\/)(tests?|__tests__|examples?|node_modules|fixtures?|templates?|vendor)(\/|$)/i

// Words that say nothing about the field. Kept as one list so the behaviour is easy to read and to test.
const STOP = new Set(`a about above across after again all almost also always am among an and another any anything are around as at be because been before being below between both but by
  can could did do does doing done down during each either else enough even ever every everything few for from further get gets getting give go goes going good got great had has have having he her here hers him his how
  i if in into is it its itself just keep know let like lot lots made make makes making many may me might more most much must my myself need needs new no nor not now of off often ok okay on once one only onto or other others our ours out over own
  perhaps please plus quite rather really same see she should since so some somehow someone something sometimes soon still such sure take than that the their theirs them then there these they thing things this those though through thus to together too toward
  try trying under until up upon us use used uses using very via want wants was way we well were what whatever when where whether which while who whom whose why will with within without would yet you your yours
  build building built create creating work working works help helps helping stuff
  skill skills agent agents ai tool tools project projects app apps code coding program programming software development developer developers`.split(/\s+/).filter(Boolean))

// Free text from a person: one line, no control characters, at most 200 characters.
export function cleanOther (s) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SEARCH_LIMITS.text).trim()
}

// Light plural stemming on both sides of every comparison (the same idea as the skill finder in skills.js).
const stem = w => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
const tok = s => (String(s).toLowerCase().match(/[\p{L}\p{N}]+[+#]*/gu) || []).map(stem)

// Up to `max` meaningful words, in the order they were written. A word may carry . - + # inside it (node.js, c++, ci-cd); it never carries search syntax, because only letters, digits and those four survive.
export function extractTerms (text, max = SEARCH_LIMITS.terms) {
  const words = cleanOther(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) || []
  const out = []; const seen = new Set()
  for (let w of words) {
    w = w.replace(/[.-]+$/, '')
    if (w.length < 2 || /^\d+$/.test(w) || STOP.has(w)) continue
    const key = tok(w).join(' '); if (seen.has(key)) continue
    seen.add(key); out.push(w); if (out.length >= max) break
  }
  return out
}

const isoDay = ms => new Date(ms).toISOString().slice(0, 10)

// The two repository searches. The filters in the query only save work: every result is checked again in acceptRepo(), whatever the server did with the query.
export function buildQueries (terms, now = Date.now()) {
  const common = `archived:false fork:false stars:>=${SEARCH_LIMITS.minStars} pushed:>=${isoDay(now - SEARCH_LIMITS.maxAgeDays * 86400000)}`
  return [
    { label: 'topic', q: `${terms.slice(0, SEARCH_LIMITS.topicTerms).join(' ')} topic:agent-skills ${common}` },
    { label: 'words', q: `${terms.join(' ')} skill in:name,description,readme ${common}` }
  ]
}
const searchUrl = q => 'https://api.github.com/search/repositories?' + new URLSearchParams({ q, sort: 'stars', order: 'desc', per_page: String(SEARCH_LIMITS.perPage) }).toString()

// null when the repository may be offered, else the reason (one word, counted in the report).
export function rejectRepo (r, now = Date.now()) {
  if (!r || typeof r !== 'object' || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(String(r.full_name))) return 'malformed'
  if (r.archived) return 'archived'
  if (r.fork) return 'fork'
  if (r.private || r.disabled) return 'unavailable'
  if (!r.license || !ALLOWED_LICENSES.has(r.license.spdx_id)) return 'license'
  if (!(r.stargazers_count >= SEARCH_LIMITS.minStars)) return 'stars'
  const pushed = Date.parse(r.pushed_at)
  if (!(pushed >= now - SEARCH_LIMITS.maxAgeDays * 86400000)) return 'stale'
  return null
}

// How many of the terms appear in a text. A term such as node.js counts when all of its pieces do.
const termKeys = terms => terms.map(t => ({ t, parts: tok(t) }))
const hits = (keys, text) => { const set = new Set(tok(text)); return keys.filter(k => k.parts.length && k.parts.every(p => set.has(p))).map(k => k.t) }

// Which repositories to look at first, since only 6 are opened: words in the name, description or topics, and signs that the repository is about skills.
function repoRank (keys, r) {
  const topics = Array.isArray(r.topics) ? r.topics : []
  const own = hits(keys, [r.full_name, r.description || '', topics.join(' ')].join(' ')).length
  const skillish = topics.some(t => SKILL_TOPICS.includes(t)) ? 5 : /\bskills?\b/i.test(`${r.name} ${r.description || ''}`) ? 2 : 0
  return own * 10 + skillish
}

// SKILL.md files in a git tree: not too big, not in test/example/vendor folders, plain path characters only (they go into URLs).
export function skillFiles (tree) {
  const out = []
  for (const e of (tree && Array.isArray(tree.tree) ? tree.tree : [])) {
    if (!e || e.type !== 'blob' || typeof e.path !== 'string' || !/(^|\/)SKILL\.md$/i.test(e.path)) continue
    if (!/^[\w.\-/]+$/.test(e.path) || e.path.includes('..') || SKIP_DIRS.test(e.path)) continue
    if (!(e.size > 0) || e.size > SEARCH_LIMITS.skillBytes) continue
    out.push({ path: e.path, dir: path.posix.dirname(e.path) === '.' ? '' : path.posix.dirname(e.path), size: e.size })
  }
  return out
}

// Before the file is fetched: the best SKILL.md by words in its folder name (counts triple) and the rest of its path. Shallower wins a tie.
function pickFile (keys, files, repoName) {
  let best = null
  for (const f of files) {
    const segs = f.dir ? f.dir.split('/') : []
    const nameHits = hits(keys, (segs[segs.length - 1] || repoName).replace(/[-_]+/g, ' ')).length
    const pathHits = hits(keys, segs.slice(0, -1).join(' ').replace(/[-_]+/g, ' ')).length
    const pre = nameHits * 3 + pathHits
    if (!best || pre > best.pre || (pre === best.pre && (segs.length < best.depth || (segs.length === best.depth && f.path < best.f.path)))) best = { f, pre, depth: segs.length }
  }
  return best && best.f
}

const sentence = d => { const s = String(d || '').replace(/\s+/g, ' ').trim(); const m = /^(.{12,}?[.!?])(\s|$)/.exec(s); return (m ? m[1] : s).slice(0, 220) }
export const firstSentence = sentence

// The whole search. Returns what it found and what it looked at, so "nothing found" can say why. `exclude` holds skill names that already exist in the workspace (they are never offered).
export async function findSkills (text, { fetchers, now = Date.now(), exclude = new Set() } = {}) {
  const { fetchJson, fetchText } = fetchers || {}
  const terms = extractTerms(text); const keys = termKeys(terms)
  const res = { terms, queries: [], considered: 0, rejected: {}, examined: [], candidates: [], error: '' }
  if (!terms.length) return res
  if (typeof fetchJson !== 'function' || typeof fetchText !== 'function') { res.error = 'no network access configured'; return res }

  // 1+2. search
  const seen = new Map()
  for (const { label, q } of buildQueries(terms, now)) {
    try {
      const body = await fetchJson(searchUrl(q)); const items = Array.isArray(body && body.items) ? body.items : []
      res.queries.push({ label, q, returned: items.length, total: Number(body && body.total_count) || 0 })
      for (const r of items) if (r && r.full_name && !seen.has(r.full_name)) seen.set(r.full_name, r)
    } catch (err) { res.queries.push({ label, q, returned: 0, total: 0, error: err.message }) }
  }
  if (res.queries.every(q => q.error)) { res.error = res.queries[0].error; return res }

  // 3. filter
  res.considered = seen.size; const ok = []
  for (const r of seen.values()) { const why = rejectRepo(r, now); if (why) res.rejected[why] = (res.rejected[why] || 0) + 1; else ok.push(r) }
  ok.sort((a, b) => repoRank(keys, b) - repoRank(keys, a) || b.stargazers_count - a.stargazers_count)

  // 4. open the best few: pin, read the tree, pick one SKILL.md, parse it
  const found = new Map()
  for (const r of ok.slice(0, SEARCH_LIMITS.candidates)) {
    const note = (status, extra) => res.examined.push({ repo: r.full_name, status, ...extra })
    try {
      const api = 'https://api.github.com/repos/' + r.full_name
      const sha = (await fetchJson(api + '/commits/HEAD')).sha
      if (!/^[0-9a-f]{40}$/.test(String(sha))) { note('error', { why: 'could not pin to a commit' }); continue }
      const tree = await fetchJson(api + '/git/trees/' + sha + '?recursive=1')
      const files = skillFiles(tree)
      if (!files.length) { note('no-skill', { sha, truncated: !!(tree && tree.truncated) }); continue }
      const f = pickFile(keys, files, r.name)
      const raw = await fetchText('https://raw.githubusercontent.com/' + r.full_name + '/' + sha + '/' + f.path)
      let sk
      try { sk = parseSkill(raw, { source: 'github.com/' + r.full_name + '@' + sha.slice(0, 7) + '/' + f.dir, fallbackName: path.posix.basename(f.dir || r.name).toLowerCase() }) } catch (err) { note('unparsed', { sha, path: f.path, why: err.message }); continue }
      // how well it fits: a word in the skill's name counts 3, in its folder path 2, in its description 1, only in the repository's own text 1; it must fit through its own text, not just through the repository
      const own = { name: hits(keys, sk.name.replace(/-/g, ' ')), path: hits(keys, f.dir.replace(/[-_]+/g, ' ')), desc: hits(keys, sk.description) }
      const repoOnly = hits(keys, [r.full_name, r.description || '', (r.topics || []).join(' ')].join(' '))
      const matched = [...new Set([...own.name, ...own.path, ...own.desc])]
      const score = keys.reduce((s, k) => s + (own.name.includes(k.t) ? 3 : own.path.includes(k.t) ? 2 : own.desc.includes(k.t) ? 1 : repoOnly.includes(k.t) ? 1 : 0), 0)
      // enough of the words must fit: 3 or more words need at least half of them; 1 or 2 words need all of them, or one in the skill's name or folder (a single word in a description is not enough)
      const enough = keys.length >= 3 ? matched.length >= Math.ceil(keys.length / 2) : matched.length === keys.length || score >= 3
      if (!matched.length || !enough) { note('no-match', { sha, path: f.path, name: sk.name }); continue }
      const cand = { name: sk.name, description: sk.description, repo: r.full_name, sha, path: f.dir, file: f.path, license: r.license.spdx_id, stars: r.stargazers_count, score, matched, sha256: sk.sha256, source: sk.source }
      if (exclude.has(sk.name)) { note('exists', { sha, name: sk.name }); continue }
      const prev = found.get(sk.name); if (!prev || cand.score > prev.score) found.set(sk.name, cand)
      note('found', { sha, path: f.path, name: sk.name, score })
    } catch (err) { note('error', { why: err.message }) }
  }

  // 5. the best three
  res.candidates = [...found.values()].sort((a, b) => b.score - a.score || b.stars - a.stars || a.name.localeCompare(b.name)).slice(0, SEARCH_LIMITS.offer)
  return res
}
