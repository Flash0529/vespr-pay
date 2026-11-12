// "Something else" at first run: the agent searches GitHub for skills that fit a few words, with no model. Everything here runs against a fake GitHub (fakegithub.js): no network.
// Covers the term extraction, the two searches, every filter (license, stars, archived, fork, age), the cap on repositories opened, SKILL.md selection and ranking, the single approval card,
// pinned calls only, and the paths that must stay quiet or honest: declined, a failing install, a name that already exists, nothing found, no searchable words, GitHub down.
import assert from 'node:assert'
import * as Y from 'yjs'
import { extractTerms, buildQueries, rejectRepo, skillFiles, findSkills, cleanOther, firstSentence, SEARCH_LIMITS } from '../src/skillsearch.js'
import { installOther, startPacks, summaryOther } from '../src/packs.js'
import { makeGithub, skillText } from './fakegithub.js'

const NOW = Date.parse('2026-10-28T12:00:00Z')
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(20) } throw new Error('timed out waiting for: ' + what) }

// ---- term extraction ----
assert.deepStrictEqual(extractTerms('python data analysis'), ['python', 'data', 'analysis'])
assert.deepStrictEqual(extractTerms('react accessibility'), ['react', 'accessibility'])
assert.deepStrictEqual(extractTerms('I want to build a Rust embedded firmware for STM32 chips and other stuff'), ['rust', 'embedded', 'firmware', 'stm32', 'chips'], 'stop words go, at most 5 terms, order kept')
assert.deepStrictEqual(extractTerms('Node.js and C++ CI-CD pipelines!!'), ['node.js', 'c++', 'ci-cd', 'pipelines'], 'dots, plus and dashes inside a word survive; trailing punctuation does not')
assert.deepStrictEqual(extractTerms('python Python PYTHON pythons'), ['python'], 'the same word once, plural or not')
assert.deepStrictEqual(extractTerms('please help me with this, I need some things 2024 42'), [], 'only stop words and numbers: nothing to search for')
assert.deepStrictEqual(extractTerms(''), []); assert.deepStrictEqual(extractTerms(null), [])
assert.deepStrictEqual(extractTerms('stars:>1 user:foo -language:go'), ['stars', 'user', 'foo', 'language'], 'qualifier syntax is split into plain words')
for (const t of extractTerms('stars:>1 user:foo -language:go topic:x NOT fork:true')) assert.match(t, /^[\p{L}\p{N}][\p{L}\p{N}+#.-]*$/u, 'a term never carries search syntax: ' + t)
assert.strictEqual(extractTerms('x '.repeat(500)).length, 0, 'one-letter words are not terms')
assert.strictEqual(cleanOther('  a\u0000b \n\t c  ' + 'z'.repeat(300)).length <= 200, true); assert.strictEqual(cleanOther('  hi \n there '), 'hi there')

// ---- the two searches ----
const q = buildQueries(['python', 'data', 'analysis', 'pandas', 'plots'], NOW)
assert.strictEqual(q.length, 2)
assert.match(q[0].q, /^python data analysis topic:agent-skills /, 'the topic search uses the first three words'); assert.ok(!q[0].q.includes('pandas'))
assert.match(q[1].q, /^python data analysis pandas plots skill in:name,description,readme /, 'the second search uses all words plus "skill"')
for (const { q: s } of q) { assert.match(s, /archived:false/); assert.match(s, /fork:false/); assert.match(s, /stars:>=20/); assert.match(s, /pushed:>=2025-04-28/, 'about 18 months before the given date') }

// ---- the filters ----
const base = { full_name: 'o/r', archived: false, fork: false, license: { spdx_id: 'MIT' }, stargazers_count: 50, pushed_at: '2026-10-01T00:00:00Z' }
assert.strictEqual(rejectRepo(base, NOW), null)
for (const lic of ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Unlicense', 'CC0-1.0']) assert.strictEqual(rejectRepo({ ...base, license: { spdx_id: lic } }, NOW), null, lic + ' is accepted')
for (const lic of ['GPL-3.0', 'AGPL-3.0', 'LGPL-3.0', 'MPL-2.0', 'NOASSERTION', 'CC-BY-SA-4.0', 'other']) assert.strictEqual(rejectRepo({ ...base, license: { spdx_id: lic } }, NOW), 'license', lic + ' is not')
assert.strictEqual(rejectRepo({ ...base, license: null }, NOW), 'license', 'no license at all')
assert.strictEqual(rejectRepo({ ...base, archived: true }, NOW), 'archived'); assert.strictEqual(rejectRepo({ ...base, fork: true }, NOW), 'fork')
assert.strictEqual(rejectRepo({ ...base, stargazers_count: 19 }, NOW), 'stars'); assert.strictEqual(rejectRepo({ ...base, stargazers_count: 20 }, NOW), null, '20 stars is enough')
assert.strictEqual(rejectRepo({ ...base, pushed_at: '2025-01-01T00:00:00Z' }, NOW), 'stale'); assert.strictEqual(rejectRepo({ ...base, pushed_at: '2025-06-01T00:00:00Z' }, NOW), null)
assert.strictEqual(rejectRepo({ ...base, pushed_at: 'garbage' }, NOW), 'stale'); assert.strictEqual(rejectRepo({ ...base, full_name: '../../etc' }, NOW), 'malformed'); assert.strictEqual(rejectRepo(null, NOW), 'malformed')
// SKILL.md files in a tree
const tree = { tree: [
  { path: 'SKILL.md', type: 'blob', size: 900 }, { path: 'skills/a/SKILL.md', type: 'blob', size: 59 * 1024 }, { path: 'skills/big/SKILL.md', type: 'blob', size: 61 * 1024 },
  { path: 'tests/x/SKILL.md', type: 'blob', size: 100 }, { path: 'skills/examples/y/SKILL.md', type: 'blob', size: 100 }, { path: 'node_modules/z/SKILL.md', type: 'blob', size: 100 },
  { path: 'skills/has space/SKILL.md', type: 'blob', size: 100 }, { path: 'skills/empty/SKILL.md', type: 'blob', size: 0 }, { path: 'skills/dir', type: 'tree' }, { path: 'skills/b/README.md', type: 'blob', size: 100 }, { path: 'skills/lower/skill.md', type: 'blob', size: 100 }
] }
assert.deepStrictEqual(skillFiles(tree).map(f => f.path), ['SKILL.md', 'skills/a/SKILL.md', 'skills/lower/skill.md'], 'size, test/example/vendor folders, odd paths and non-files are skipped')
assert.strictEqual(firstSentence('Analyze data with pandas. Use for cleaning and plots.'), 'Analyze data with pandas.'); assert.strictEqual(firstSentence('no full stop here'), 'no full stop here')

// ---- the fake GitHub ----
const sha = c => c.repeat(40)
const desc = (d, extra = '') => d + extra
const repos = [
  { full_name: 'acme/data-skills', sha: sha('a'), stars: 900, topics: ['agent-skills'], description: 'Skills for data work', via: ['topic'], files: {
    'skills/pandas-analysis/SKILL.md': skillText('pandas-analysis', 'Analyze tabular data with pandas in Python. Use for cleaning, grouping and plots.'),
    'skills/web-design/SKILL.md': skillText('web-design', 'Lay out web pages.'),
    'examples/data-analysis/SKILL.md': skillText('example-analysis', 'Python data analysis example that must never be picked.'),
    'node_modules/x/python-data/SKILL.md': skillText('vendored', 'Python data analysis vendored copy.'),
    'skills/big-analysis/SKILL.md': { text: skillText('big-analysis', 'Python data analysis, but far too large.'), size: 70 * 1024 },
    'README.md': '# data skills' } },
  { full_name: 'beta/py-notebooks', sha: sha('b'), license: 'Apache-2.0', stars: 400, description: 'Python notebooks to reports', files: { 'SKILL.md': skillText('notebook-reports', 'Turn Python notebooks into data reports.') } },
  { full_name: 'gamma/python-stats-skill', sha: sha('c'), license: 'BSD-3-Clause', stars: 120, files: { 'SKILL.md': skillText('python-stats', 'Statistical analysis helpers for Python.') } },
  { full_name: 'theta/data-analysis-python', sha: sha('d'), license: 'Unlicense', stars: 50, via: ['words'], description: 'data analysis python', files: { 'SKILL.md': skillText('data-wrangling', 'Wrangle data frames in Python for analysis. The second sentence is not shown.') } },
  { full_name: 'delta/no-skill-here', sha: sha('e'), stars: 300, description: 'Python data tooling', files: { 'README.md': '# nothing to see', 'src/main.py': 'print(1)' } },
  { full_name: 'eps/bad-skill', sha: sha('f'), stars: 250, description: 'Data analysis skill', files: { 'SKILL.md': '---\nname: bad-skill\n---\nNo description, so it does not parse.' } },
  { full_name: 'zeta/off-topic-skills', sha: sha('9'), stars: 260, topics: ['agent-skills'], description: 'Python deployment skills', files: { 'skills/docker-deploy/SKILL.md': skillText('docker-deploy', 'Deploy containers for data pipelines.') } }, // one word of three: not enough
  // never offered
  { full_name: 'old/archived-thing', sha: sha('1'), stars: 5000, archived: true, description: 'python data analysis', files: { 'SKILL.md': skillText('archived-skill', 'python data analysis') } },
  { full_name: 'fork/copy', sha: sha('2'), stars: 4000, fork: true, description: 'python data analysis', files: { 'SKILL.md': skillText('forked-skill', 'python data analysis') } },
  { full_name: 'gpl/skills-gpl', sha: sha('3'), stars: 3000, license: 'GPL-3.0', description: 'python data analysis', files: { 'SKILL.md': skillText('gpl-skill', 'python data analysis') } },
  { full_name: 'nolic/skills-none', sha: sha('4'), stars: 2000, license: null, description: 'python data analysis', files: { 'SKILL.md': skillText('nolicense-skill', 'python data analysis') } },
  { full_name: 'noassert/skills-x', sha: sha('5'), stars: 1900, license: 'NOASSERTION', description: 'python data analysis', files: { 'SKILL.md': skillText('noassert-skill', 'python data analysis') } },
  { full_name: 'few/stars', sha: sha('6'), stars: 19, description: 'python data analysis', files: { 'SKILL.md': skillText('few-stars-skill', 'python data analysis') } },
  { full_name: 'stale/old-skills', sha: sha('7'), stars: 800, pushed: '2025-01-01T00:00:00Z', description: 'python data analysis', files: { 'SKILL.md': skillText('stale-skill', 'python data analysis') } },
  ...['a', 'b', 'c', 'd'].map((x, i) => ({ full_name: `filler/misc-${x}`, sha: sha('8'), stars: 21 + i, files: { 'SKILL.md': skillText('filler-' + x, 'Something unrelated.') } }))
]
const isPinnedCall = u => { const x = new URL(u); return x.hostname === 'raw.githubusercontent.com' ? /^\/[^/]+\/[^/]+\/[0-9a-f]{40}\//.test(x.pathname) : x.pathname === '/search/repositories' || /\/commits\/HEAD$/.test(x.pathname) || /\/(commits|git\/trees)\/[0-9a-f]{40}(\?|$)/.test(x.pathname + x.search) || /[?&]ref=[0-9a-f]{40}$/.test(x.search) }

{
  const gh = makeGithub(repos)
  const r = await findSkills('python data analysis', { fetchers: gh.fetchers, now: NOW })
  assert.deepStrictEqual(r.terms, ['python', 'data', 'analysis'])
  assert.strictEqual(r.queries.length, 2); assert.ok(r.queries.every(x => !x.error))
  assert.strictEqual(r.considered, repos.length, 'both searches merged without duplicates')
  assert.deepStrictEqual(r.rejected, { archived: 1, fork: 1, license: 3, stars: 1, stale: 1 }, 'every filter counted')
  const searches = gh.calls.filter(u => new URL(u).pathname === '/search/repositories'); assert.strictEqual(searches.length, 2, 'two searches, no more')
  assert.ok(searches.every(u => /sort=stars/.test(u) && /order=desc/.test(u)), 'most stars first')
  assert.strictEqual(r.examined.length, SEARCH_LIMITS.candidates, 'only six repositories are opened')
  assert.strictEqual(gh.calls.filter(u => /\/commits\/HEAD$/.test(u)).length, 6)
  const opened = new Set(r.examined.map(e => e.repo))
  assert.deepStrictEqual([...opened].sort(), ['acme/data-skills', 'delta/no-skill-here', 'eps/bad-skill', 'gamma/python-stats-skill', 'theta/data-analysis-python', 'zeta/off-topic-skills'], 'the six that fit the words best, not simply the most stars')
  for (const bad of ['old/archived-thing', 'fork/copy', 'gpl/skills-gpl', 'nolic/skills-none', 'noassert/skills-x', 'few/stars', 'stale/old-skills', 'filler/misc-a', 'beta/py-notebooks']) assert.ok(!gh.calls.some(u => u.includes('/' + bad + '/')), bad + ' is never opened')
  const why = Object.fromEntries(r.examined.map(e => [e.repo, e.status]))
  assert.deepStrictEqual(why, { 'theta/data-analysis-python': 'found', 'eps/bad-skill': 'unparsed', 'delta/no-skill-here': 'no-skill', 'acme/data-skills': 'found', 'zeta/off-topic-skills': 'no-match', 'gamma/python-stats-skill': 'found' })
  // ranking: name hit 3, path 2, description 1; a tie goes to the repository with more stars; the third-best is cut
  assert.deepStrictEqual(r.candidates.map(c => c.name), ['pandas-analysis', 'data-wrangling', 'python-stats'])
  assert.deepStrictEqual(r.candidates.map(c => c.score), [5, 5, 4])
  const top = r.candidates[0]
  assert.strictEqual(top.repo, 'acme/data-skills'); assert.strictEqual(top.sha, sha('a')); assert.strictEqual(top.license, 'MIT'); assert.strictEqual(top.stars, 900); assert.strictEqual(top.path, 'skills/pandas-analysis')
  assert.ok(!r.candidates.some(c => /example|vendored|big-analysis/.test(c.name)), 'example, node_modules and oversized SKILL.md files are never picked')
  assert.ok(!gh.calls.some(u => /examples|node_modules|big-analysis/.test(u) && /raw\.githubusercontent/.test(u)), 'and never even fetched')
  assert.ok(gh.calls.every(isPinnedCall), 'every call after the search is pinned to a commit: ' + gh.calls.filter(u => !isPinnedCall(u)).join(' '))
  assert.strictEqual(r.candidates.every(c => /^[0-9a-f]{64}$/.test(c.sha256)), true)

  // four usable skills in four repositories: only the best three are offered
  const four = makeGithub(repos.filter(x => ['acme/data-skills', 'beta/py-notebooks', 'gamma/python-stats-skill', 'theta/data-analysis-python'].includes(x.full_name)))
  const r4 = await findSkills('python data analysis', { fetchers: four.fetchers, now: NOW })
  assert.strictEqual(r4.examined.filter(e => e.status === 'found').length, 4); assert.deepStrictEqual(r4.candidates.map(c => c.name), ['pandas-analysis', 'data-wrangling', 'python-stats'], 'at most three are offered; notebook-reports is cut')

  // names that already exist are never offered; the next best moves up
  const gh2 = makeGithub(repos)
  const r2 = await findSkills('python data analysis', { fetchers: gh2.fetchers, now: NOW, exclude: new Set(['pandas-analysis']) })
  assert.deepStrictEqual(r2.candidates.map(c => c.name), ['data-wrangling', 'python-stats'])
  assert.strictEqual(r2.examined.find(e => e.repo === 'acme/data-skills').status, 'exists')
}

// how many of the words must fit: one word of three is not enough, two words need both (or one in the skill's name), and the same skill is not offered for a looser query
{
  const rs = [
    { full_name: 'a1/a11y-skills', sha: sha('a'), description: 'accessibility skills', files: { 'skills/accessibility-audit/SKILL.md': skillText('accessibility-audit', 'Audit pages for keyboard and screen reader problems.') } },
    { full_name: 'b1/globe-skills', sha: sha('b'), description: 'react globes', files: { 'skills/globe-maps/SKILL.md': skillText('globe-maps', 'Draw dotted maps that embed in React apps.') } },
    { full_name: 'c1/react-a11y-skills', sha: sha('c'), description: 'react accessibility', files: { 'skills/component-checks/SKILL.md': skillText('component-checks', 'Check React components for accessibility mistakes.') } },
    { full_name: 'd1/hig-skills', sha: sha('d'), description: 'accessibility guidelines', files: { 'skills/content-guidelines/SKILL.md': skillText('content-guidelines', 'Guidelines for content, including accessibility labels.') } }
  ]
  const gh = makeGithub(rs); const r = await findSkills('react accessibility', { fetchers: gh.fetchers, now: NOW })
  assert.deepStrictEqual(r.candidates.map(c => c.name).sort(), ['accessibility-audit', 'component-checks'], 'a name hit, or both words, is enough; one word in a description is not')
  assert.deepStrictEqual(Object.fromEntries(r.examined.map(e => [e.name, e.status])), { 'accessibility-audit': 'found', 'globe-maps': 'no-match', 'component-checks': 'found', 'content-guidelines': 'no-match' })
  const g3 = makeGithub(rs); const r3 = await findSkills('react accessibility testing tools', { fetchers: g3.fetchers, now: NOW })
  assert.deepStrictEqual(r3.terms, ['react', 'accessibility', 'testing'], 'tools is a stop word'); assert.deepStrictEqual(r3.candidates.map(c => c.name), ['component-checks'], 'three words need two of them: component-checks has two, accessibility-audit only one')
}

// one search failing is survivable; both failing is an error with the reason; no network configured is said plainly
{
  const gh = makeGithub(repos); gh.fail.search = new Set(['topic'])
  const r = await findSkills('python data analysis', { fetchers: gh.fetchers, now: NOW })
  assert.ok(r.queries[0].error && !r.queries[1].error && r.candidates.length >= 1, 'the other search still works'); assert.strictEqual(r.error, '')
  gh.fail.search = true; const r2 = await findSkills('python data analysis', { fetchers: gh.fetchers, now: NOW })
  assert.match(r2.error, /GitHub answered 403/); assert.strictEqual(r2.candidates.length, 0); assert.strictEqual(r2.examined.length, 0, 'nothing is opened after a failed search')
  assert.match((await findSkills('python data', { now: NOW })).error, /no network/)
  const none = makeGithub(repos); assert.deepStrictEqual((await findSkills('please help me with stuff', { fetchers: none.fetchers, now: NOW })).terms, []); assert.strictEqual(none.calls.length, 0, 'no words, no GitHub calls')
  // a repository that fails halfway is skipped, the rest go on
  const g3 = makeGithub(repos); g3.fail.trees = true; const r3 = await findSkills('python data analysis', { fetchers: g3.fetchers, now: NOW })
  assert.strictEqual(r3.candidates.length, 0); assert.ok(r3.examined.every(e => e.status === 'error'), 'a tree that cannot be read is an error for that repository only')
}

// ---- through the packs code: one approval card, a pinned install, honest results ----
function fakeRoom ({ answer = true, files = [] } = {}) {
  const doc = new Y.Doc(); const settings = doc.getMap('settings'); const fsm = new Map(files.map(p => [p, '']))
  const said = []; const cards = []
  return { settings, said, cards, files: fsm, list: () => [...fsm.keys()], write: (p, c) => { fsm.set(p, c); return { ok: true } }, say: t => { said.push(t); return {} },
    requestApproval: async c => { cards.push(c); return { approved: typeof answer === 'function' ? answer(c) : answer, by: 'alice' } } }
}
const skillPaths = room => [...room.files.keys()].filter(p => /SKILL\.md$/.test(p))

{ // approved
  const gh = makeGithub(repos); const room = fakeRoom()
  const o = await installOther({ room, text: 'python data analysis', fetchers: gh.fetchers, now: NOW })
  assert.strictEqual(room.cards.length, 1, 'ONE approval card for all three skills')
  const card = room.cards[0]; assert.strictEqual(card.kind, 'skill'); assert.match(card.summary, /^Install 3 skills found on GitHub for "python data analysis"\?$/)
  assert.match(card.detail, /1\. pandas-analysis {2}\(MIT, 900 stars, acme\/data-skills @ aaaaaaa\)\n {4}Analyze tabular data with pandas in Python\./, 'name, license, stars, repo@sha7 and the first sentence')
  assert.match(card.detail, /2\. data-wrangling {2}\(Unlicense, 50 stars, theta\/data-analysis-python @ ddddddd\)\n {4}Wrangle data frames in Python for analysis\.\n/); assert.ok(!card.detail.includes('second sentence'), 'only the first sentence')
  assert.match(card.detail, /3\. python-stats {2}\(BSD-3-Clause, 120 stars, gamma\/python-stats-skill @ ccccccc\)/)
  assert.match(card.detail, /Skills are instructions that the agents in this workspace will follow/)
  assert.strictEqual(room.said.length, 1); assert.match(room.said[0], /Looking on GitHub for skills about python, data, analysis/, 'the room is told the search started')
  assert.deepStrictEqual(o.github.sort(), ['data-wrangling', 'pandas-analysis', 'python-stats']); assert.deepStrictEqual(o.failed, [])
  assert.deepStrictEqual(skillPaths(room).sort(), ['.vespr/skills/data-wrangling/SKILL.md', '.vespr/skills/pandas-analysis/SKILL.md', '.vespr/skills/python-stats/SKILL.md'])
  assert.match(room.files.get('.vespr/skills/pandas-analysis/SKILL.md'), /source: "github\.com\/acme\/data-skills@aaaaaaa\/skills\/pandas-analysis"/, 'the file records where it came from and at which commit')
  assert.ok(gh.calls.every(isPinnedCall), 'the install used pinned calls only')
  const cardAt = gh.calls.length; assert.ok(cardAt > 0)
  assert.match(summaryOther(o), /installed from GitHub \(pinned\): .*pandas-analysis/)
}

{ // declined: nothing is written, nothing is fetched after the card
  const gh = makeGithub(repos); let callsAtCard = 0; const room = fakeRoom({ answer: () => { callsAtCard = gh.calls.length; return false } })
  const o = await installOther({ room, text: 'python data analysis', fetchers: gh.fetchers, now: NOW })
  assert.strictEqual(o.declined, true); assert.deepStrictEqual(o.github, []); assert.strictEqual(room.files.size, 0); assert.strictEqual(gh.calls.length, callsAtCard, 'no GitHub call after a "no"')
  assert.match(summaryOther(o), /were not installed/)
}

{ // the install fails after approval: reported, nothing half-written
  const gh = makeGithub(repos); const room = fakeRoom({ answer: () => { gh.fail.raw = () => true; return true } })
  const o = await installOther({ room, text: 'python data analysis', fetchers: gh.fetchers, now: NOW })
  assert.deepStrictEqual(o.github, []); assert.strictEqual(o.failed.length, 3); assert.match(o.failed[0], /pandas-analysis: GitHub answered 500|GitHub answered 500/); assert.strictEqual(room.files.size, 0)
  assert.match(summaryOther(o), /Could not install: .*pandas-analysis/)
  // the file changes between the card and the install: it is refused
  const g2 = makeGithub(repos); const room2 = fakeRoom({ answer: () => { g2.fail.raw = () => false; repos[0].files['skills/pandas-analysis/SKILL.md'] += '\nSneaky extra line.\n'; return true } })
  const o2 = await installOther({ room: room2, text: 'python data analysis', fetchers: g2.fetchers, now: NOW })
  repos[0].files['skills/pandas-analysis/SKILL.md'] = repos[0].files['skills/pandas-analysis/SKILL.md'].replace('\nSneaky extra line.\n', '')
  assert.ok(o2.failed.some(f => /pandas-analysis: the file is not the one that was offered/.test(f)), 'a changed file is not installed'); assert.ok(!o2.github.includes('pandas-analysis')); assert.deepStrictEqual(o2.github.sort(), ['data-wrangling', 'python-stats'])
}

{ // a name that already exists is not offered, and one that appears while the card is open is refused
  const gh = makeGithub(repos); const room = fakeRoom({ files: ['.vespr/skills/pandas-analysis/SKILL.md'], answer: () => { room.files.set('.vespr/skills/python-stats/SKILL.md', 'mine'); return true } })
  const o = await installOther({ room, text: 'python data analysis', fetchers: gh.fetchers, now: NOW })
  assert.ok(!room.cards[0].detail.includes('pandas-analysis'), 'an existing name is not on the card'); assert.deepStrictEqual(o.github, ['data-wrangling'])
  assert.ok(o.failed.some(f => /python-stats: a skill with that name already exists/.test(f))); assert.strictEqual(room.files.get('.vespr/skills/python-stats/SKILL.md'), 'mine', 'the existing file is untouched')
}

{ // nothing found: no card, and the chat says what was tried and suggests a link
  const gh = makeGithub(repos); const room = fakeRoom()
  const o = await installOther({ room, text: 'quantum basket weaving', fetchers: gh.fetchers, now: NOW })
  assert.strictEqual(room.cards.length, 0); assert.deepStrictEqual(o.offered, []); assert.strictEqual(room.files.size, 0)
  const s = summaryOther(o); assert.match(s, /found nothing I can offer/); assert.match(s, /quantum, basket, weaving/); assert.match(s, /paste its GitHub link/); assert.match(s, /\d+ repositories came back/)
  // no searchable words
  const gh2 = makeGithub(repos); const o2 = await installOther({ room: fakeRoom(), text: 'please help me with stuff', fetchers: gh2.fetchers, now: NOW })
  assert.strictEqual(gh2.calls.length, 0); assert.match(summaryOther(o2), /could not find searchable words/)
  // GitHub down
  const gh3 = makeGithub(repos); gh3.fail.search = true; const room3 = fakeRoom(); const o3 = await installOther({ room: room3, text: 'python data analysis', fetchers: gh3.fetchers, now: NOW })
  assert.match(summaryOther(o3), /could not search GitHub.*GitHub answered 403.*paste a GitHub link/); assert.strictEqual(room3.cards.length, 0)
  // no network configured
  assert.match(summaryOther(await installOther({ room: fakeRoom(), text: 'python data', fetchers: null, now: NOW })), /no network access configured/)
}

// ---- wired from startPacks: the request carries `other`; bundled packs and the search are independent; a restart does not ask again; searches are rate limited ----
{
  const gh = makeGithub(repos); const room = fakeRoom({ answer: true })
  const h = startPacks({ room, fetchers: gh.fetchers, now: () => NOW, minGapMs: 20000 })
  assert.ok(room.settings.get('packsCatalog').some(f => f.id === 'vibe'), 'the catalog lists vibe')
  assert.strictEqual(room.settings.get('packsCatalog')[0].id, 'vibe', 'vibe is the first option')
  room.settings.set('packsRequest', { id: 'r1', focus: [], other: '  python data analysis \n', by: 'alice', ts: NOW })
  const applied = await until(() => { const a = room.settings.get('packsApplied'); return a && a.other && a.other.status === 'installed' && a }, 'search finished')
  assert.strictEqual(applied.id, 'r1'); assert.deepStrictEqual(applied.focus, []); assert.strictEqual(applied.other.text, 'python data analysis', 'the text is cleaned')
  assert.deepStrictEqual(applied.other.github.sort(), ['data-wrangling', 'pandas-analysis', 'python-stats']); assert.deepStrictEqual(applied.other.offered.map(o => o.name).sort(), ['data-wrangling', 'pandas-analysis', 'python-stats'])
  assert.ok(!room.said.some(t => /No skill packs chosen/.test(t)), 'only "something else" was asked: no "no packs chosen" message')
  assert.ok(room.said.some(t => /Skills for "python data analysis": installed from GitHub/.test(t)))
  assert.strictEqual(room.cards.length, 1)
  // a second search right away is refused politely (the GitHub rate limit is shared)
  room.settings.set('packsRequest', { id: 'r2', focus: [], other: 'rust firmware', by: 'alice', ts: NOW })
  const a2 = await until(() => { const a = room.settings.get('packsApplied'); return a && a.id === 'r2' && a.other && a.other.status !== 'searching' && a }, 'second answer')
  assert.strictEqual(a2.other.status, 'error'); assert.match(a2.other.error, /searched a moment ago/); assert.strictEqual(room.cards.length, 1, 'no second card')
  h.stop()
  // a request that was already answered is not answered again when the agent restarts
  const before = room.cards.length + room.said.length
  const h2 = startPacks({ room, fetchers: gh.fetchers, now: () => NOW, minGapMs: 0 }); await wait(150); h2.stop()
  assert.strictEqual(room.cards.length + room.said.length, before, 'a restart does not ask or say anything again')
}
{ // chips and text together: the packs answer first, then the search; text with no words says so
  const gh = makeGithub(repos); const room = fakeRoom({ answer: c => /GitHub for/.test(c.summary) })
  const h = startPacks({ room, fetchers: gh.fetchers, now: () => NOW, minGapMs: 0 })
  room.settings.set('packsRequest', { id: 'r3', focus: ['docs'], other: 'python data analysis', by: 'alice', ts: NOW })
  await until(() => { const a = room.settings.get('packsApplied'); return a && a.other && a.other.status === 'installed' }, 'both done')
  assert.ok(room.files.has('.vespr/skills/docs-writing/SKILL.md'), 'the chip pack was installed'); assert.ok(room.files.has('.vespr/skills/pandas-analysis/SKILL.md'))
  const iPacks = room.said.findIndex(t => /Set up skills for Docs and writing/.test(t)); const iOther = room.said.findIndex(t => /Skills for "python data analysis"/.test(t)); assert.ok(iPacks >= 0 && iOther > iPacks, 'the packs summary comes before the search result')
  room.settings.set('packsRequest', { id: 'r4', focus: [], other: 'please, stuff', by: 'alice', ts: NOW })
  const a = await until(() => { const x = room.settings.get('packsApplied'); return x && x.id === 'r4' && x.other && x.other.status === 'no-terms' && x }, 'no-terms answer')
  assert.ok(room.said.some(t => /could not find searchable words/.test(t))); assert.deepStrictEqual(a.other.terms, [])
  h.stop()
}
console.log('skillsearch tests passed: terms, two searches, license/stars/archived/fork/age filters, six opened, ranking, one approval card, pinned calls only, declined, failed, existing name, nothing found, restart and rate limit')
setTimeout(() => process.exit(0), 100)
