// Skill packs: at the start the app asks what the workspace is for (vibe coding, websites, design, backend, data, docs, or something else in the person's own words) and the agent adds the skills that help in that field.
//  - bundled skills ship with VESPR (src/pack-skills/): they are copied into the workspace (.vespr/skills/) straight away; they are ours and need no approval
//  - GitHub skills (UI UX Pro Max, impeccable, taste-skill) are fetched at a pinned commit, only after a person approves one card that lists exactly what comes and under which license.
//    Only each skill's SKILL.md is fetched (its instructions); scripts and data files next to it are not. An entry marked `refs` also gets the Markdown notes in its references/ folder (100 KB per file, 400 KB in all).
//  - "Something else": a short text. The agent searches GitHub for skills that fit it, with no model (skillsearch.js), and offers at most three on ONE approval card; they are installed the same way, pinned.
// The request is an entry in the shared settings (`packsRequest`); the answer is `packsApplied` and a chat message. Skills are ordinary files, so everyone sees who added them.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSkill, skillFile, fetchGithubSkills, SKILL_DIR } from './skills.js'
import { findSkills, cleanOther, extractTerms, firstSentence } from './skillsearch.js'

export const FOCUS = [
  { id: 'vibe', label: 'Vibe coding', blurb: 'Describe what you want, build it in small steps, see it run, fix it' },
  { id: 'web', label: 'Websites and web apps', blurb: 'Interfaces, front-end code, accessibility' },
  { id: 'design', label: 'UI and visual design', blurb: 'Design systems, polish, pages that do not look generic' },
  { id: 'backend', label: 'Backend and APIs', blurb: 'Services, databases, security' },
  { id: 'data', label: 'Data and analysis', blurb: 'Datasets, SQL, charts, reports' },
  { id: 'docs', label: 'Docs and writing', blurb: 'READMEs, guides, explanations' },
  { id: 'business', label: 'MIS, business and marketing', blurb: 'Workflows, spreadsheets, CRM, campaigns and dashboards' } // the team, NAV-HOSTING-DASHBOARD-PLAN section 5b: one more option next to the others
]

// Pinned to the commit that was read on 2026-10-28; the license was read from each repository.
const GH = {
  uiux: { name: 'ui-ux-pro-max', repo: 'nextlevelbuilder/ui-ux-pro-max-skill', path: '.claude/skills/ui-ux-pro-max', sha: '28b3b8dee8c976df4fa3e94aed4e092ad43fcb03', license: 'MIT', note: 'design-system-first UI/UX method' },
  impeccable: { name: 'impeccable', repo: 'pbakaus/impeccable', path: '.claude/skills/impeccable', sha: '7510e233b228864606888d252abacf5e7148bf87', license: 'Apache-2.0', note: 'design commands and anti-generic-UI rules' },
  taste: { name: 'taste-skill', repo: 'leonxlnx/taste-skill', path: 'skills/taste-skill', sha: '12af471f627f866411b4bd785b19646d3672784c', license: 'MIT', note: 'art direction and a self-review loop for pages' },
  // Pinned on 2026-10-28; MIT read from the repository. Its SKILL.md is 35 KB and it has 7 Markdown notes in references/.
  rea: {
    name: 'rea', repo: 'morluto/rea', path: '.agents/skills/reverse-engineer-anything', sha: '64196b08cab9fab15649b6d0058f980cd3f733f6', license: 'MIT', refs: true,
    note: 'a method for reverse-engineering apps and systems (SKILL.md plus its references/ notes). It is written for the REA tool server (MCP), which VESPR agents cannot call yet, so here it is reading material, not a working tool',
    caveat: 'rea is written for the REA tool server, which the agents here cannot call yet, so it is reading material, not a working tool.'
  }
}
export const PACKS = {
  vibe: { bundled: ['vibe-build-loop', 'debug-loop', 'ship-checklist', 'security-review', 'frontend-review'], github: [GH.uiux, GH.rea] },
  web: { bundled: ['web-accessibility', 'frontend-review'], github: [GH.uiux] },
  design: { bundled: ['web-accessibility'], github: [GH.uiux, GH.impeccable, GH.taste] },
  backend: { bundled: ['api-design', 'security-review', 'db-migrations', 'sql-review'], github: [] },
  data: { bundled: ['data-analysis', 'sql-review', 'agent-reach', 'watch'], github: [] },
  docs: { bundled: ['docs-writing', 'google-workspace'], github: [] },
  business: { bundled: ['data-analysis', 'docs-writing', 'google-workspace', 'agent-reach'], github: [] } // all bundled and ours: no GitHub skill, so no approval card for this field
}
export const ghUrl = e => `https://github.com/${e.repo}/tree/${e.sha}/${e.path}`

const here = path.dirname(fileURLToPath(import.meta.url))
export function bundledSkills (dir = path.join(here, 'pack-skills')) {
  const out = new Map()
  for (const name of fs.readdirSync(dir)) {
    const f = path.join(dir, name, 'SKILL.md'); if (!fs.existsSync(f)) continue
    out.set(name, parseSkill(fs.readFileSync(f, 'utf8'), { source: 'vespr-bundled', fallbackName: name }))
  }
  return out
}

// What a choice of fields means: the skills to copy and the ones to ask about. Unknown ids are ignored.
export function planPacks (focus) {
  const ids = [...new Set((Array.isArray(focus) ? focus : []).map(String))].filter(id => PACKS[id])
  const bundled = [...new Set(ids.flatMap(id => PACKS[id].bundled))]
  const seen = new Set(); const github = []
  for (const e of ids.flatMap(id => PACKS[id].github)) if (!seen.has(e.name)) { seen.add(e.name); github.push(e) }
  return { focus: ids, bundled, github }
}

export const REF_LIMITS = { file: 100 * 1024, total: 400 * 1024, count: 40 }

// The Markdown notes in <skill folder>/references, listed and fetched at the pinned commit (the file URLs are built from that commit, whatever the listing says). A file over 100 KB is skipped, and so is
// anything that would take the total past 400 KB; both are reported. Other file types are not fetched.
export async function fetchRefs (e, { fetchJson, fetchText }) {
  const dir = e.path + '/references'
  const list = await fetchJson(`https://api.github.com/repos/${e.repo}/contents/${dir}?ref=${e.sha}`)
  if (!Array.isArray(list)) throw new Error('references is not a folder')
  const md = list.filter(i => i && i.type === 'file' && /^[\w][\w.-]*\.md$/i.test(String(i.name))).sort((a, b) => a.name.localeCompare(b.name))
  const out = { files: [], skipped: [], ignored: list.length - md.length }
  let total = 0
  for (const [n, f] of md.entries()) {
    if (n >= REF_LIMITS.count) { out.skipped.push(f.name + ' (too many files)'); continue }
    if (f.size > REF_LIMITS.file) { out.skipped.push(f.name + ' (over 100 KB)'); continue }
    if (total + (f.size || 0) > REF_LIMITS.total) { out.skipped.push(f.name + ' (past the 400 KB total)'); continue }
    const text = await fetchText(`https://raw.githubusercontent.com/${e.repo}/${e.sha}/${dir}/${f.name}`)
    const bytes = Buffer.byteLength(text)
    if (bytes > REF_LIMITS.file) { out.skipped.push(f.name + ' (over 100 KB)'); continue }
    if (total + bytes > REF_LIMITS.total) { out.skipped.push(f.name + ' (past the 400 KB total)'); continue }
    total += bytes; out.files.push({ name: f.name, text, bytes })
  }
  return out
}

// Fetch and write GitHub skills at their pinned commits (shared by the field packs and the "something else" search). `have` is the set of workspace paths and is kept up to date.
async function installEntries ({ room, entries, fetchers, msgId, have }) {
  const out = { installed: [], refs: {}, failed: [] }
  for (const e of entries) {
    try {
      if (have.has(SKILL_DIR + e.name + '/SKILL.md') || have.has(SKILL_DIR + e.name + '.md')) throw new Error('a skill with that name already exists here')
      const got = await fetchGithubSkills(ghUrl(e), fetchers)
      if (got.sha !== e.sha) throw new Error('the repository did not return the pinned commit')
      const sk = got.skills[0]; if (!sk) throw new Error(got.errors[0] || 'no SKILL.md found')
      if (e.sha256 && sk.sha256 !== e.sha256) throw new Error('the file is not the one that was offered')
      const f = skillFile({ ...sk, name: e.name }); const w = room.write(f.path, f.content, msgId)
      if (w && w.error) throw new Error(w.error)
      have.add(f.path); out.installed.push(e.name)
    } catch (err) { out.failed.push(e.name + ': ' + err.message); continue }
    if (!e.refs) continue
    try {
      const r = await fetchRefs(e, fetchers); const written = []
      for (const f of r.files) {
        const p = SKILL_DIR + e.name + '/references/' + f.name
        if (have.has(p)) { r.skipped.push(f.name + ' (already there)'); continue }
        const w = room.write(p, `<!-- from github.com/${e.repo}@${e.sha.slice(0, 7)}/${e.path}/references/${f.name} (${e.license}) -->\n` + f.text, msgId)
        if (w && w.error) r.skipped.push(`${f.name} (${w.error})`); else { have.add(p); written.push(f.name) }
      }
      out.refs[e.name] = { files: written, skipped: r.skipped }
    } catch (err) { out.failed.push(e.name + ' references: ' + err.message) }
  }
  return out
}

const entryLine = e => `${e.name}  (${e.license}, ${e.repo} @ ${e.sha.slice(0, 7)}): ${e.note}` + (e.refs ? '\n    + its references/ folder: Markdown files only, up to 100 KB each and 400 KB in all' : '')

export async function installPacks ({ room, focus, fetchers, msgId = 'packs', timeoutMs }) {
  const plan = planPacks(focus); const have = new Set(room.list()); const lib = bundledSkills()
  const result = { focus: plan.focus, bundled: [], present: [], github: [], refs: {}, failed: [], declined: false }
  for (const name of plan.bundled) {
    const sk = lib.get(name); if (!sk) { result.failed.push(name + ': not bundled'); continue }
    const f = skillFile(sk)
    if (have.has(f.path)) { result.present.push(name); continue }
    const w = room.write(f.path, f.content, msgId); if (w && w.error) result.failed.push(name + ': ' + w.error); else result.bundled.push(name)
  }
  const wanted = plan.github.filter(e => !have.has(SKILL_DIR + e.name + '/SKILL.md'))
  if (wanted.length && fetchers) {
    const detail = wanted.map(entryLine).join('\n') + `\n\nOnly each skill's SKILL.md (its instructions)${wanted.some(e => e.refs) ? ', and the Markdown files in the references/ folder where marked,' : ''} is fetched, at that exact commit. Agents in this workspace will follow these instructions.`
    const r = await room.requestApproval({ kind: 'skill', summary: `Install ${wanted.length} skill${wanted.length === 1 ? '' : 's'} from GitHub for ${plan.focus.join(' + ')}?`, detail }, timeoutMs)
    if (!r.approved) result.declined = true
    else { const got = await installEntries({ room, entries: wanted, fetchers, msgId, have }); result.github = got.installed; result.refs = got.refs; result.failed.push(...got.failed) }
  } else if (wanted.length) result.failed.push('GitHub skills skipped: no network access configured')
  return result
}

// "Something else": search GitHub for skills that fit a few words (skillsearch.js, no model), then ONE approval card with at most three, then the same pinned install as the packs.
export async function installOther ({ room, text, fetchers, msgId = 'packs', timeoutMs, now = Date.now() }) {
  text = cleanOther(text)
  const result = { text, terms: extractTerms(text), considered: 0, rejected: {}, offered: [], github: [], refs: {}, failed: [], declined: false, error: '' }
  if (!result.terms.length) return result
  if (!fetchers) { result.error = 'no network access configured'; return result }
  const exclude = new Set([...room.list()].map(p => (/^\.vespr\/skills\/([^/]+)\/SKILL\.md$/.exec(p) || /^\.vespr\/skills\/([^/]+)\.md$/.exec(p) || [])[1]).filter(Boolean))
  room.say(`Looking on GitHub for skills about ${result.terms.join(', ')}. This takes a few seconds.`)
  const found = await findSkills(text, { fetchers, now, exclude })
  result.considered = found.considered; result.rejected = found.rejected; result.error = found.error
  result.offered = found.candidates.map(c => ({ name: c.name, repo: c.repo, sha: c.sha, license: c.license, stars: c.stars }))
  if (!found.candidates.length) return result
  const n = found.candidates.length
  const detail = found.candidates.map((c, i) => `${i + 1}. ${c.name}  (${c.license}, ${c.stars} stars, ${c.repo} @ ${c.sha.slice(0, 7)})\n    ${firstSentence(c.description)}`).join('\n') +
    '\n\nSkills are instructions that the agents in this workspace will follow. Only each SKILL.md is fetched, at that exact commit; read the descriptions and decline if you are unsure.'
  const r = await room.requestApproval({ kind: 'skill', summary: `Install ${n} skill${n === 1 ? '' : 's'} found on GitHub for "${text.slice(0, 80)}"?`, detail }, timeoutMs)
  if (!r.approved) { result.declined = true; return result }
  const got = await installEntries({ room, entries: found.candidates, fetchers, msgId, have: new Set(room.list()) })
  result.github = got.installed; result.refs = got.refs; result.failed = got.failed
  return result
}

const label = id => (FOCUS.find(f => f.id === id) || { label: id }).label
const refsText = refs => Object.entries(refs || {}).map(([n, r]) => `${n} references: ${r.files.length ? r.files.join(', ') : 'none'}${r.skipped.length ? ' (skipped: ' + r.skipped.join(', ') + ')' : ''}.`).join(' ')
export function summary (r) {
  if (!r.focus.length) return 'No skill packs chosen. You can pick a field any time from the View menu.'
  const parts = [`Set up skills for ${r.focus.map(label).join(', ')}.`]
  if (r.bundled.length) parts.push(`Added ${r.bundled.join(', ')}.`)
  if (r.present.length) parts.push(`Already here: ${r.present.join(', ')}.`)
  if (r.github.length) parts.push(`Installed from GitHub (pinned): ${r.github.join(', ')}.`)
  if (r.refs && Object.keys(r.refs).length) parts.push(refsText(r.refs))
  for (const e of Object.values(GH)) if (r.github.includes(e.name) && e.caveat) parts.push('Note: ' + e.caveat)
  if (r.declined) parts.push('The GitHub skills were not installed (the room declined or nobody answered).')
  if (r.failed.length) parts.push('Could not install: ' + r.failed.join('; ') + '.')
  parts.push('They are ordinary files in .vespr/skills/, so you can read, edit or delete them.')
  return parts.join(' ')
}

const REJECTED = { archived: 'archived', fork: 'forks', license: 'without an accepted license', stars: 'with fewer than 20 stars', stale: 'not updated for 18 months', malformed: 'unreadable', unavailable: 'unavailable' }
export function summaryOther (o) {
  const q = `"${o.text}"`
  if (!o.terms.length) return `I could not find searchable words in ${q}. Try a few specific words, for example "rust embedded firmware".`
  if (o.error) return `I could not search GitHub for ${o.terms.join(', ')} (${o.error}). Try again in a minute, or paste a GitHub link to a skill in the chat.`
  if (o.declined) return `The skills found for ${q} were not installed (the room declined or nobody answered).`
  if (!o.offered.length) {
    const why = Object.entries(o.rejected).map(([k, v]) => `${v} ${REJECTED[k] || k}`).join(', ')
    return `I searched GitHub for skills about ${o.terms.join(', ')} and found nothing I can offer${o.considered ? ` (${o.considered} repositories came back${why ? ': ' + why : ''}; the others had no matching SKILL.md)` : ''}. I only offer skills with a license like MIT or Apache-2.0 that are maintained. If you know one, paste its GitHub link in the chat.`
  }
  const parts = [`Skills for ${q}:`]
  if (o.github.length) parts.push(`installed from GitHub (pinned): ${o.github.join(', ')}.`)
  if (o.refs && Object.keys(o.refs).length) parts.push(refsText(o.refs))
  if (o.failed.length) parts.push('Could not install: ' + o.failed.join('; ') + '.')
  if (!o.github.length && !o.failed.length) parts.push('nothing was installed.')
  return parts.join(' ')
}

// What goes into the shared settings: plain data, no skill text.
const otherState = (o, status) => ({ text: o.text, status, terms: o.terms, considered: o.considered, offered: o.offered, github: o.github, declined: o.declined, failed: o.failed, error: o.error })

export function startPacks ({ room, fetchers, timeoutMs, now = Date.now, minGapMs = 20_000 }) {
  room.settings.set('packsCatalog', FOCUS.map(f => ({ id: f.id, label: f.label, blurb: f.blurb })))
  const done = new Set(); let queue = Promise.resolve(); let lastSearch = 0
  const check = () => {
    const req = room.settings.get('packsRequest'); if (!req || !req.id || done.has(req.id)) return
    done.add(req.id)
    const was = room.settings.get('packsApplied'); if (was && was.id === req.id) return // already answered before this agent (re)started: do not ask again
    queue = queue.then(async () => {
      const other = cleanOther(req.other)
      const r = await installPacks({ room, focus: req.focus, fetchers, msgId: 'packs-' + req.id, timeoutMs })
      const base = { id: req.id, focus: r.focus, bundled: r.bundled, present: r.present, github: r.github, refs: r.refs, declined: r.declined, failed: r.failed }
      room.settings.set('packsApplied', { ...base, ...(other ? { other: { text: other, status: 'searching' } } : {}), ts: Date.now() })
      if (r.focus.length || !other) room.say(summary(r))
      if (!other) return
      let o
      if (minGapMs && now() - lastSearch < minGapMs) { o = { text: other, terms: extractTerms(other), considered: 0, rejected: {}, offered: [], github: [], refs: {}, failed: [], declined: false, error: 'I searched a moment ago; ask again in a few seconds' } } else {
        lastSearch = now()
        o = await installOther({ room, text: other, fetchers, msgId: 'packs-' + req.id, timeoutMs, now: now() })
      }
      const status = o.error ? 'error' : !o.terms.length ? 'no-terms' : o.declined ? 'declined' : !o.offered.length ? 'none' : o.github.length ? 'installed' : 'failed'
      room.settings.set('packsApplied', { ...base, other: otherState(o, status), ts: Date.now() })
      room.say(summaryOther(o))
    }).catch(e => console.error('packs failed:', e.message))
  }
  room.settings.observe(check); check()
  return { stop: () => room.settings.unobserve(check) }
}
