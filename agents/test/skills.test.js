// Skills library: header parsing, matching, GitHub link and repo import (with a fake network), the approval gate, and find-before-refusing.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { parseFrontmatter, parseSkill, SkillLibrary, parseGithubUrl, fetchGithubSkills, installSkill, resolveSkill, SKILL_RULES } from '../src/skills.js'

// header forms
const f = parseFrontmatter('---\nname: pptx-reader\ndescription: >\n  Read slide decks\n  and speaker notes.\ntools: [read, "write"]\nlist:\n  - a\n  - b\n---\nBody here')
assert.deepStrictEqual(f.meta, { name: 'pptx-reader', description: 'Read slide decks and speaker notes.', tools: ['read', 'write'], list: ['a', 'b'] })
assert.strictEqual(f.body, 'Body here')
assert.strictEqual(parseFrontmatter('no header').hasHeader, false)

// a usable skill, and unusable ones with readable errors
const ok = parseSkill('---\nname: Sheet-Reader\ndescription: Read xlsx and csv sheets into tables.\n---\nSteps...')
assert.strictEqual(ok.name, 'sheet-reader'); assert.match(ok.sha256, /^[0-9a-f]{64}$/)
assert.throws(() => parseSkill('---\nname: x y\ndescription: d\n---\n'), /lowercase/)
assert.throws(() => parseSkill('---\nname: ok-name\n---\nbody'), /no description/)
assert.throws(() => parseSkill('a\u0000b'), /not a text file/)
assert.strictEqual(parseSkill('---\ndescription: Folder name is used.\n---\nx', { fallbackName: 'from-folder' }).name, 'from-folder')

// library: load from disk (folder form and single-file form), skip bad files
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'))
fs.mkdirSync(path.join(dir, 'pdf-reader')); fs.writeFileSync(path.join(dir, 'pdf-reader', 'SKILL.md'), '---\nname: pdf-reader\ndescription: Extract text and tables from PDF documents.\n---\nUse the page images when text is missing.')
fs.writeFileSync(path.join(dir, 'tutor-mode.md'), '---\ndescription: Ask questions and give hints in steps instead of answers.\n---\nHints first.')
fs.writeFileSync(path.join(dir, 'broken.md'), '---\nname: broken\n---\nno description')
fs.mkdirSync(path.join(dir, 'empty-folder'))
const lib = new SkillLibrary(); const r = lib.loadDir(dir, 'workspace')
assert.strictEqual(r.loaded, 2); assert.strictEqual(r.errors.length, 1); assert.match(r.errors[0], /broken\.md/)
assert.deepStrictEqual(lib.list().map(s => s.name), ['pdf-reader', 'tutor-mode'])
assert.match(lib.index(), /- pdf-reader: Extract text/)

// matching
assert.strictEqual(lib.find('please read this PDF for me')[0].name, 'pdf-reader')
assert.strictEqual(lib.find('can you give me hints, not the answer')[0].name, 'tutor-mode')
assert.deepStrictEqual(lib.find('translate this video into french'), [], 'no invented matches')
assert.match(lib.load('pdf-reader'), /^<skill name="pdf-reader" source="workspace" sha256="[0-9a-f]{12}">\nUse the page images/)
assert.strictEqual(lib.load('nope'), null)

// GitHub links: accepted shapes and refusals
assert.deepStrictEqual(parseGithubUrl('https://github.com/acme/skills'), { owner: 'acme', repo: 'skills', ref: '', path: '' })
assert.deepStrictEqual(parseGithubUrl('https://github.com/acme/skills.git'), { owner: 'acme', repo: 'skills', ref: '', path: '' })
assert.deepStrictEqual(parseGithubUrl('https://github.com/acme/skills/tree/main/office/pptx'), { owner: 'acme', repo: 'skills', ref: 'main', path: 'office/pptx' })
assert.deepStrictEqual(parseGithubUrl('https://raw.githubusercontent.com/acme/skills/abc123/office/pptx/SKILL.md'), { owner: 'acme', repo: 'skills', ref: 'abc123', path: 'office/pptx/SKILL.md' })
for (const bad of ['http://github.com/a/b', 'https://evil.example/a/b', 'https://github.com.evil.example/a/b', 'https://github.com/onlyowner', 'ftp://github.com/a/b', 'nonsense']) assert.throws(() => parseGithubUrl(bad), undefined, bad)

// GitHub import with a fake network: pins a commit, walks folders, keeps going past a bad skill
const SHA = 'a'.repeat(40); const calls = []
const tree = {
  '': [{ type: 'dir', name: 'office', path: 'office' }, { type: 'dir', name: 'bad', path: 'bad' }, { type: 'file', name: 'README.md', path: 'README.md' }],
  office: [{ type: 'dir', name: 'pptx', path: 'office/pptx' }],
  'office/pptx': [{ type: 'file', name: 'SKILL.md', path: 'office/pptx/SKILL.md', download_url: 'https://raw.githubusercontent.com/acme/skills/' + SHA + '/office/pptx/SKILL.md' }],
  bad: [{ type: 'file', name: 'SKILL.md', path: 'bad/SKILL.md', download_url: 'https://raw.githubusercontent.com/acme/skills/' + SHA + '/bad/SKILL.md' }]
}
const files = {
  ['https://raw.githubusercontent.com/acme/skills/' + SHA + '/office/pptx/SKILL.md']: '---\nname: pptx-reader\ndescription: Read PowerPoint decks: slide text, notes and images.\n---\nUnzip, read ppt/slides/*.xml.',
  ['https://raw.githubusercontent.com/acme/skills/' + SHA + '/bad/SKILL.md']: 'just text'
}
const fetchJson = async u => {
  calls.push(u)
  if (u.endsWith('/commits/HEAD')) return { sha: SHA }
  const m = /\/contents\/(.*)\?ref=(.*)$/.exec(u); assert.strictEqual(m[2], SHA, 'contents are read at the pinned commit')
  return tree[m[1]]
}
const fetchText = async u => files[u]
const gh = await fetchGithubSkills('https://github.com/acme/skills', { fetchJson, fetchText })
assert.strictEqual(gh.sha, SHA); assert.strictEqual(gh.skills.length, 1); assert.strictEqual(gh.skills[0].name, 'pptx-reader')
assert.match(gh.skills[0].source, /^github\.com\/acme\/skills@aaaaaaa/); assert.strictEqual(gh.errors.length, 1)
await assert.rejects(() => fetchGithubSkills('https://github.com/acme/skills', { fetchJson: async () => ({ sha: 'main' }), fetchText }), /pin/)

// installing needs a person's approval, and records where it came from
const ws = path.join(dir, 'installed')
assert.throws(() => installSkill(gh.skills[0], ws), /approval/)
assert.throws(() => installSkill(gh.skills[0], ws, { approved: 'yes' }), /approval/)
const written = installSkill(gh.skills[0], ws, { approved: true })
const back = parseSkill(fs.readFileSync(written, 'utf8'))
assert.strictEqual(back.name, 'pptx-reader'); assert.match(back.meta.source, /acme\/skills/); assert.match(back.body, /Unzip/)

// find a skill before saying no: installed first, then library, then GitHub (asks for approval), then an honest nothing
const installed = new SkillLibrary(); installed.loadDir(dir, 'workspace'); const orgLib = new SkillLibrary(); orgLib.add(gh.skills[0])
let res = await resolveSkill('read this pdf', { installed, library: orgLib })
assert.strictEqual(res.where, 'installed'); assert.strictEqual(res.needsApproval, false)
res = await resolveSkill('open this powerpoint deck', { installed, library: orgLib })
assert.strictEqual(res.where, 'library'); assert.strictEqual(res.candidates[0].name, 'pptx-reader')
res = await resolveSkill('render a 3d model', { installed, library: orgLib, searchGithub: async q => [{ name: 'glb-viewer', description: 'View glb models', source: 'github.com/x/y' }] })
assert.strictEqual(res.where, 'github'); assert.strictEqual(res.needsApproval, true); assert.deepStrictEqual(res.steps.map(s => s.where), ['installed', 'library', 'github'])
res = await resolveSkill('render a 3d model', { installed, library: orgLib, searchGithub: async () => { throw new Error('offline') } })
assert.strictEqual(res.found, false); assert.ok(res.steps.some(s => s.error === 'offline'), 'a failed search is reported, not hidden')
res = await resolveSkill('render a 3d model', { installed, library: orgLib })
assert.strictEqual(res.found, false); assert.strictEqual(res.candidates.length, 0)
assert.match(SKILL_RULES, /Before you tell the user you cannot/)

fs.rmSync(dir, { recursive: true, force: true })
console.log('skills tests passed')
