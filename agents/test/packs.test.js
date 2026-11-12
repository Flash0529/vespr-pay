// Skill packs: the first-run question ("what is this workspace for?") adds the matching skills. Bundled ones are copied in at once; GitHub ones only after the room approves one card,
// at the pinned commit. Real collab server and a real agent room; GitHub is a fake.
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { joinRoom } from '../src/room.js'
import { FOCUS, PACKS, planPacks, bundledSkills, ghUrl, startPacks, installPacks, fetchRefs, REF_LIMITS, summary } from '../src/packs.js'
import { parseSkill, skillsFromFiles } from '../src/skills.js'
import { createClient } from '../../app/vespr-client.js'
import { makeGithub, skillText } from './fakegithub.js'

// the manifest is consistent
const lib = bundledSkills(); assert.ok(lib.size >= 8, 'bundled skills load and parse')
for (const [id, p] of Object.entries(PACKS)) {
  assert.ok(FOCUS.some(f => f.id === id), 'a pack for every field: ' + id)
  for (const n of p.bundled) assert.ok(lib.has(n), `${id} names a skill that exists: ${n}`)
  for (const e of p.github) { assert.match(e.sha, /^[0-9a-f]{40}$/, e.name + ' is pinned to a full commit'); assert.ok(['MIT', 'Apache-2.0'].includes(e.license), e.name + ' has a licence we can use'); assert.match(ghUrl(e), /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/tree\/[0-9a-f]{40}\//) }
}
for (const f of FOCUS) assert.ok(PACKS[f.id], 'every field has a pack: ' + f.id)
for (const sk of lib.values()) { assert.ok(sk.description.length > 30 && sk.body.length > 400, sk.name + ' has real content') }
// Vibe coding is the first option: five bundled skills, UI UX Pro Max, and rea (pinned, with its references and an honest note)
assert.strictEqual(FOCUS[0].id, 'vibe'); assert.strictEqual(FOCUS[0].label, 'Vibe coding'); assert.match(FOCUS[0].blurb, /Describe what you want.*small steps.*see it run.*fix it/i)
assert.deepStrictEqual(PACKS.vibe.bundled, ['vibe-build-loop', 'debug-loop', 'ship-checklist', 'security-review', 'frontend-review'])
assert.deepStrictEqual(PACKS.vibe.github.map(e => e.name), ['ui-ux-pro-max', 'rea'])
const REA = PACKS.vibe.github[1]
assert.deepStrictEqual({ repo: REA.repo, path: REA.path, sha: REA.sha, license: REA.license, refs: REA.refs }, { repo: 'morluto/rea', path: '.agents/skills/reverse-engineer-anything', sha: '64196b08cab9fab15649b6d0058f980cd3f733f6', license: 'MIT', refs: true })
assert.match(REA.note, /REA tool server/); assert.match(REA.note, /cannot call/); assert.match(REA.note, /reading material, not a working tool/, 'the card says plainly that the agents cannot use the tool server')
assert.strictEqual(ghUrl(REA), 'https://github.com/morluto/rea/tree/64196b08cab9fab15649b6d0058f980cd3f733f6/.agents/skills/reverse-engineer-anything')
assert.ok(PACKS.vibe.github.slice(0, 1).every(e => !e.refs), 'only rea asks for references')
const THIRD = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../../THIRD-PARTY.md'), 'utf8'); assert.match(THIRD, /rea.*morluto\/rea.*64196b0.*MIT/, 'rea is listed in THIRD-PARTY.md')
// the app offers exactly these fields
const shell = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../../app/prototype.html'), 'utf8')
for (const f of FOCUS) assert.ok(shell.includes(`data-focus="${f.id}"`), 'the app offers ' + f.id)
// planning
assert.deepStrictEqual(planPacks(['web', 'nope', 'web']).focus, ['web'])
assert.deepStrictEqual(planPacks(['web', 'design']).github.map(e => e.name), ['ui-ux-pro-max', 'impeccable', 'taste-skill'], 'no skill is listed twice')
assert.deepStrictEqual(planPacks(['backend', 'data']).bundled.filter(n => n === 'sql-review').length, 1)
assert.deepStrictEqual(planPacks([]).bundled, []); assert.deepStrictEqual(planPacks('web').focus, [], 'a non-list is ignored')

// a fake GitHub: any folder has one SKILL.md at the commit that was asked for
const asked = []; const askedText = []
const REF_NAMES = ['01-overview.md', '02-binary-analysis.md', '03-network.md', '04-protocols.md', '05-reporting.md', '06-safety.md', '07-glossary.md']
const fakeSkill = u => `---\nname: ${u.split('/').slice(-2)[0]}\ndescription: A fake third-party skill for the test, long enough to pass the checks.\n---\nFake body for ${u.split('/').slice(-2)[0]}.`
const fetchers = {
  fetchJson: async u => {
    asked.push(u); let m
    if ((m = /\/commits\/([0-9a-f]{40})$/.exec(u))) return { sha: m[1] }
    if ((m = /\/repos\/([^/]+)\/([^/]+)\/contents\/(.*)\/references\?ref=([0-9a-f]{40})$/.exec(u))) return [...REF_NAMES.map(n => ({ type: 'file', name: n, path: m[3] + '/references/' + n, size: 300, download_url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[4]}/${m[3]}/references/${n}` })), { type: 'file', name: 'diagram.png', size: 900, path: m[3] + '/references/diagram.png' }, { type: 'dir', name: 'extra', path: m[3] + '/references/extra' }]
    if ((m = /\/repos\/([^/]+)\/([^/]+)\/contents\/(.*)\?ref=([0-9a-f]{40})$/.exec(u))) return [{ type: 'file', name: 'SKILL.md', path: m[3] + '/SKILL.md', download_url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[4]}/${m[3]}/SKILL.md` }]
    throw new Error('unexpected ' + u)
  },
  fetchText: async u => { askedText.push(u); return /\/references\//.test(u) ? `# Notes: ${u.split('/').pop()}\nA reference note.\n` : fakeSkill(u) }
}

const usedTestPorts = new Set(); const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(err => { if (err) return reject(err); if (usedTestPorts.has(p)) return resolve(freePort()); usedTestPorts.add(p); resolve(p) }) }) })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(50) } throw new Error('timed out waiting for: ' + what) }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-packs-'))
fs.writeFileSync(path.join(dir, 'tokens'), 'alice:tok-a\ncoder:tok-c\n')
const PORT = await freePort(); const here = path.dirname(new URL(import.meta.url).pathname)
const srv = spawn('node', [path.join(here, '../../server/index.js')], { env: { ...process.env, MURMIO_PORT: PORT, MURMIO_DATA: dir, MURMIO_TOKENS_FILE: path.join(dir, 'tokens') }, stdio: 'ignore' })
let alice, agent, handler, alice2, agent2, handler2
try {
  await wait(800)
  const server = 'ws://127.0.0.1:' + PORT; const deps = { Y, WebsocketProvider, WebSocketPolyfill: WebSocket }
  alice = createClient({ server, room: 'r1', token: 'tok-a', name: 'alice', deps }); await alice.ready
  agent = joinRoom({ server, room: 'r1', token: 'tok-c', name: 'coder', color: '#5eead4', model: 'fake-model' }); await agent.ready
  handler = startPacks({ room: agent, fetchers })
  await until(() => alice.get().packsCatalog.length === FOCUS.length, 'the app learns the fields')
  assert.strictEqual(alice.get().focus, null, 'nothing chosen yet: the app shows the question')

  // web + design: bundled skills at once, then one approval card for the three GitHub skills
  alice.setFocus(['web', 'design'])
  await until(() => agent.list().includes('.vespr/skills/frontend-review/SKILL.md') && agent.list().includes('.vespr/skills/web-accessibility/SKILL.md'), 'bundled skills copied in')
  assert.deepStrictEqual(alice.get().focus, ['web', 'design'])
  const card = await until(() => alice.get().approvals.pending.find(m => m.kind === 'skill'), 'one approval card')
  assert.match(card.text, /Install 3 skills from GitHub for web \+ design/); for (const n of ['ui-ux-pro-max', 'impeccable', 'taste-skill']) assert.match(card.detail, new RegExp(n))
  assert.match(card.detail, /MIT/); assert.match(card.detail, /Apache-2\.0/); assert.match(card.detail, /@ 28b3b8d/)
  assert.ok(!agent.list().some(p => p.includes('ui-ux-pro-max')), 'nothing from GitHub before approval'); assert.strictEqual(asked.length, 0, 'no network call before approval')
  assert.strictEqual(alice.decide(card.id, true), true)
  const applied = await until(() => alice.get().packs, 'applied')
  assert.deepStrictEqual(applied.github.sort(), ['impeccable', 'taste-skill', 'ui-ux-pro-max']); assert.deepStrictEqual(applied.failed, [])
  for (const n of ['ui-ux-pro-max', 'impeccable', 'taste-skill']) assert.ok(agent.list().includes(`.vespr/skills/${n}/SKILL.md`), n + ' installed')
  assert.ok(asked.every(u => /\/(commits\/[0-9a-f]{40}$|contents\/.*\?ref=[0-9a-f]{40}$)/.test(u)), 'every GitHub call is pinned to a full commit')
  const text = agent.read('.vespr/skills/ui-ux-pro-max/SKILL.md'); assert.match(text, /source: "github\.com\/nextlevelbuilder\/ui-ux-pro-max-skill@28b3b8d/)
  // the agent can use them: they load as workspace skills
  const ws = skillsFromFiles(agent.list().map(p => ({ path: p, text: agent.read(p) }))).lib; for (const n of ['web-accessibility', 'frontend-review', 'ui-ux-pro-max']) assert.ok(ws.list().some(s => s.name === n), n + ' is a workspace skill')
  await until(() => alice.get().messages.some(m => m.isAgent && /Set up skills for Websites and web apps, UI and visual design/.test(m.text)), 'the agent reports in chat')

  // asking again changes nothing (idempotent) and a different field adds only what is missing
  const before = agent.list().length
  alice.setFocus(['web', 'design', 'backend'])
  await until(() => agent.list().includes('.vespr/skills/api-design/SKILL.md'), 'backend skills added')
  await wait(400); assert.strictEqual(alice.get().approvals.pending.length, 0, 'GitHub skills already here: no second card')
  assert.strictEqual(agent.list().length, before + 4, 'only the four backend skills were added')

  // Vibe coding in a fresh workspace: five bundled skills at once; ONE card for ui-ux-pro-max and rea, with the honest note; rea's references come with it, pinned
  alice2 = createClient({ server, room: 'r2', token: 'tok-a', name: 'alice', deps }); await alice2.ready
  agent2 = joinRoom({ server, room: 'r2', token: 'tok-c', name: 'coder', color: '#5eead4', model: 'fake-model' }); await agent2.ready
  handler2 = startPacks({ room: agent2, fetchers })
  await until(() => alice2.get().packsCatalog.length === FOCUS.length, 'the second workspace learns the fields')
  assert.strictEqual(alice2.get().packsCatalog[0].id, 'vibe', 'the app is told vibe comes first')
  asked.length = 0; askedText.length = 0
  alice2.setFocus(['vibe'])
  await until(() => PACKS.vibe.bundled.every(n => agent2.list().includes(`.vespr/skills/${n}/SKILL.md`)), 'the five vibe skills copied in')
  const vcard = await until(() => alice2.get().approvals.pending.find(m => m.kind === 'skill'), 'one card for the two GitHub skills')
  assert.match(vcard.text, /Install 2 skills from GitHub for vibe/); assert.match(vcard.detail, /ui-ux-pro-max/); assert.match(vcard.detail, /rea {2}\(MIT, morluto\/rea @ 64196b0\)/)
  assert.match(vcard.detail, /VESPR agents cannot call yet/); assert.match(vcard.detail, /reading material, not a working tool/); assert.match(vcard.detail, /references\/ folder: Markdown files only, up to 100 KB each and 400 KB in all/)
  assert.strictEqual(asked.length, 0, 'nothing fetched before the card is answered'); assert.ok(!agent2.list().some(p => p.includes('/rea/')))
  assert.strictEqual(alice2.decide(vcard.id, true), true)
  const vApplied = await until(() => alice2.get().packs, 'vibe applied')
  assert.deepStrictEqual(vApplied.github.sort(), ['rea', 'ui-ux-pro-max']); assert.deepStrictEqual(vApplied.failed, []); assert.deepStrictEqual(vApplied.bundled.sort(), [...PACKS.vibe.bundled].sort())
  assert.deepStrictEqual(Object.keys(vApplied.refs), ['rea']); assert.deepStrictEqual(vApplied.refs.rea.files, REF_NAMES, 'all seven Markdown notes, in order; the .png and the folder are not fetched'); assert.deepStrictEqual(vApplied.refs.rea.skipped, [])
  for (const n of REF_NAMES) { const t = agent2.read('.vespr/skills/rea/references/' + n); assert.ok(t && t.startsWith('<!-- from github.com/morluto/rea@64196b0/.agents/skills/reverse-engineer-anything/references/' + n + ' (MIT) -->\n# Notes'), n + ' written with its source') }
  assert.ok(!agent2.list().some(p => p.endsWith('diagram.png') || p.includes('/extra')), 'only Markdown is written')
  assert.ok(agent2.read('.vespr/skills/rea/SKILL.md').includes('source: "github.com/morluto/rea@64196b0'), 'rea itself is installed under the name rea, with its source')
  assert.ok(asked.every(u => /\/(commits\/[0-9a-f]{40}$|contents\/.*\?ref=[0-9a-f]{40}$)/.test(u)), 'the references listing is pinned too'); assert.ok(asked.some(u => u.endsWith('/contents/.agents/skills/reverse-engineer-anything/references?ref=64196b08cab9fab15649b6d0058f980cd3f733f6')))
  assert.ok(askedText.every(u => /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[0-9a-f]{40}\//.test(u)), 'and so is every file download')
  const vsay = await until(() => alice2.get().messages.find(m => m.isAgent && /Set up skills for Vibe coding/.test(m.text)), 'the agent reports in chat')
  assert.match(vsay.text, /Installed from GitHub \(pinned\): ui-ux-pro-max, rea|Installed from GitHub \(pinned\): rea, ui-ux-pro-max/); assert.match(vsay.text, /rea references: 01-overview\.md/); assert.match(vsay.text, /Note: rea is written for the REA tool server, which the agents here cannot call yet/)
  // the shell's question and the agent's text request: `other` travels with the request, trimmed and capped
  const idOther = alice2.setFocus([], { other: '  rust\nembedded   firmware ' + 'x'.repeat(300) })
  const reqOther = await until(() => { const r = agent2.settings.get('packsRequest'); return r && r.id === idOther && r }, 'the request with text')
  assert.deepStrictEqual(reqOther.focus, []); assert.ok(reqOther.other.startsWith('rust embedded firmware xxx') && reqOther.other.length === 200, 'cleaned and capped at 200 characters')
  assert.strictEqual(alice2.get().focus.length, 0)
  const idNone = alice2.setFocus([], { other: '   ' }); assert.notStrictEqual(agent2.settings.get('packsRequest').id, idNone, 'an empty answer with no text asks for nothing')

  // a declined card installs nothing from GitHub, and says so
  const dir2 = []; const room2 = { settings: agent.settings, list: () => [], write: (p, c) => { dir2.push(p); return { ok: true } }, requestApproval: async () => ({ approved: false, by: 'alice' }), say: () => {} }
  const r2 = await installPacks({ room: room2, focus: ['design'], fetchers }); assert.strictEqual(r2.declined, true); assert.deepStrictEqual(r2.github, []); assert.match(summary(r2), /not installed/)
  // a GitHub skill that cannot be fetched is reported, not hidden; the pinned commit must come back
  const bad = { fetchJson: async u => /\/commits\//.test(u) ? { sha: 'a'.repeat(40) } : [{ type: 'file', name: 'SKILL.md', path: 'x/SKILL.md', download_url: 'https://raw.githubusercontent.com/o/r/' + 'a'.repeat(40) + '/x/SKILL.md' }], fetchText: fetchers.fetchText }
  const room3 = { settings: agent.settings, list: () => [], write: () => ({ ok: true }), requestApproval: async () => ({ approved: true, by: 'alice' }), say: () => {} }
  const r3 = await installPacks({ room: room3, focus: ['design'], fetchers: bad }); assert.deepStrictEqual(r3.github, []); assert.strictEqual(r3.failed.length, 3); assert.match(r3.failed[0], /pinned commit/)
  assert.match(summary({ focus: [], bundled: [], present: [], github: [], failed: [], declined: false }), /No skill packs chosen/)
  // rea's references: caps, odd files, a listing that lies, a missing folder; and a declined card fetches nothing at all
  const bigText = kb => '# note\n' + 'x'.repeat(kb * 1024 - 7)
  const ref = { name: 'x', repo: 'o/r', path: 'skills/rea', sha: 'a'.repeat(40), license: 'MIT', refs: true }
  const gh = makeGithub([{ full_name: 'o/r', sha: 'a'.repeat(40), files: {
    'skills/rea/SKILL.md': skillText('rea', 'A skill with a references folder for the test.'),
    'skills/rea/references/a.md': bigText(90), 'skills/rea/references/b.md': bigText(90), 'skills/rea/references/c.md': bigText(90), 'skills/rea/references/d.md': bigText(90),
    'skills/rea/references/e.md': bigText(90), 'skills/rea/references/huge.md': bigText(101), 'skills/rea/references/liar.md': { text: bigText(150), size: 10 },
    'skills/rea/references/notes.txt': 'not markdown', 'skills/rea/references/sub/deep.md': 'in a folder', 'skills/rea/references/.hidden.md': 'dot file', 'skills/rea/references/z-small.md': 'tiny'
  } }])
  const refs = await fetchRefs(ref, gh.fetchers)
  assert.deepStrictEqual(refs.files.map(f => f.name), ['a.md', 'b.md', 'c.md', 'd.md', 'z-small.md'], 'each file is at most 100 KB; the total stops at 400 KB')
  assert.deepStrictEqual(refs.skipped.sort(), ['e.md (past the 400 KB total)', 'huge.md (over 100 KB)', 'liar.md (over 100 KB)'].sort(), 'what was left out is named, with the reason')
  assert.ok(refs.files.reduce((n, f) => n + f.bytes, 0) <= REF_LIMITS.total && refs.files.every(f => f.bytes <= REF_LIMITS.file))
  assert.ok(!gh.calls.some(u => /notes\.txt|deep\.md|hidden\.md|huge\.md/.test(u) && u.includes('raw.')), 'non-Markdown files, folders, dot files and files listed over 100 KB are never downloaded')
  assert.ok(gh.calls.every(u => /^https:\/\/raw\.githubusercontent\.com\/o\/r\/a{40}\//.test(u) || /\?ref=a{40}$/.test(u)), 'pinned')
  // through installPacks: the references folder is missing at that commit -> SKILL.md still installed, the failure is reported honestly
  const PIN = Object.fromEntries(PACKS.vibe.github.map(e => [e.name, e]))
  const mk = (withRefs) => makeGithub([
    { full_name: PIN['ui-ux-pro-max'].repo, sha: PIN['ui-ux-pro-max'].sha, files: { [PIN['ui-ux-pro-max'].path + '/SKILL.md']: skillText('ui-ux-pro-max', 'A fake UI skill for the test, long enough.') } },
    { full_name: 'morluto/rea', sha: PIN.rea.sha, files: { [PIN.rea.path + '/SKILL.md']: skillText('reverse-engineer-anything', 'A fake rea skill for the test, long enough.'), ...(withRefs ? { [PIN.rea.path + '/references/one.md']: '# one' } : {}) } }
  ])
  const files4 = new Map(); const room4 = { settings: agent.settings, list: () => [...files4.keys()], write: (p, c) => { files4.set(p, c); return { ok: true } }, requestApproval: async () => ({ approved: true, by: 'alice' }), say: () => {} }
  const r4 = await installPacks({ room: room4, focus: ['vibe'], fetchers: mk(false).fetchers })
  assert.deepStrictEqual(r4.github.sort(), ['rea', 'ui-ux-pro-max'], 'both skills are installed'); assert.strictEqual(r4.failed.length, 1); assert.match(r4.failed[0], /^rea references: GitHub answered 404/)
  assert.ok(files4.has('.vespr/skills/rea/SKILL.md') && ![...files4.keys()].some(p => p.includes('/references/')))
  assert.match(summary(r4), /Could not install: rea references/)
  // with the folder present, and a reference file that already exists: it is kept, not overwritten
  const files5 = new Map([['.vespr/skills/rea/references/one.md', 'mine']]); const room5 = { ...room4, list: () => [...files5.keys()], write: (p, c) => { files5.set(p, c); return { ok: true } } }
  const r5 = await installPacks({ room: room5, focus: ['vibe'], fetchers: mk(true).fetchers })
  assert.deepStrictEqual(r5.refs.rea, { files: [], skipped: ['one.md (already there)'] }); assert.strictEqual(files5.get('.vespr/skills/rea/references/one.md'), 'mine')
  // declined: no network call at all, and no references
  const gh6 = mk(true); const files6 = new Map(); const room6 = { ...room4, list: () => [...files6.keys()], write: (p, c) => { files6.set(p, c); return { ok: true } }, requestApproval: async () => ({ approved: false, by: 'alice' }) }
  const r6 = await installPacks({ room: room6, focus: ['vibe'], fetchers: gh6.fetchers }); assert.strictEqual(r6.declined, true); assert.strictEqual(gh6.calls.length, 0); assert.ok(![...files6.keys()].some(p => p.includes('/rea/')), 'five bundled skills only'); assert.strictEqual(r6.bundled.length, 5)
  // business (MIS, business and marketing), the team's section 5b: every bundled skill it names exists, and it needs no GitHub approval card
{ const b = bundledSkills(); const plan = planPacks(['business']); assert.deepStrictEqual(plan.focus, ['business']); assert.ok(plan.bundled.length >= 3 && plan.bundled.every(n => b.has(n)), 'every named skill is shipped'); assert.deepStrictEqual(plan.github, [], 'ours only, so no approval card')
  assert.ok(FOCUS.some(f => f.id === 'business' && /business/i.test(f.label))); assert.ok(Object.keys(PACKS).every(id => FOCUS.some(f => f.id === id)) && FOCUS.every(f => PACKS[f.id]), 'FOCUS and PACKS list the same fields') }
console.log('packs tests passed: manifest, vibe pack, pinned GitHub skills behind one approval, rea references (capped) with the honest note, bundled skills at once, idempotent, declined and failed reported')
} finally {
  try { handler && handler.stop() } catch {}
  try { alice && alice.destroy && alice.destroy() } catch {}
  try { agent && agent.destroy() } catch {}
  try { handler2 && handler2.stop() } catch {}
  try { alice2 && alice2.destroy && alice2.destroy() } catch {}
  try { agent2 && agent2.destroy() } catch {}
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); setTimeout(() => process.exit(0), 200)
}
