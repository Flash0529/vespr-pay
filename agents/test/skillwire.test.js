// find_skill inside the agent loop: the prompt lists the skills, a search tries installed -> library -> GitHub, an outside skill needs an approval card
// in every mode, a denied one is not written, and an honest "nothing found" comes back instead of a made-up skill. Fake room and fake model, no network.
import assert from 'node:assert'
import { respond, asOpenAITools } from '../src/agent.js'
import { SkillLibrary, makeGithubSearch } from '../src/skills.js'

assert.ok(!asOpenAITools(false, false).some(t => t.function.name === 'find_skill'), 'off by default')
assert.ok(asOpenAITools(false, false, true).some(t => t.function.name === 'find_skill'))

const SHA = 'b'.repeat(40)
const raw = 'https://raw.githubusercontent.com/acme/skills/' + SHA + '/pptx/SKILL.md'
const fetchJson = async u => u.endsWith('/commits/HEAD') ? { sha: SHA } : [{ type: 'file', name: 'SKILL.md', path: 'pptx/SKILL.md', download_url: raw }]
const fetchText = async () => '---\nname: pptx-reader\ndescription: Read PowerPoint decks: slide text, notes and images.\n---\nUnzip the deck and read ppt/slides/*.xml.'
const library = new SkillLibrary(); library.add({ name: 'tutor-mode', description: 'Teach with hints.', body: 'Hints first.', source: 'starter', sha256: 'a'.repeat(64) })

function makeRoom ({ mode = 'manual', approve = true } = {}) {
  const files = new Map([['cart.py', 'x = 1']]); const said = []; const asks = []
  return {
    files, said, asks, name: 'coder', roomName: 'demo', mode: () => mode,
    list: () => [...files.keys()], read: p => (files.has(p) ? files.get(p) : null),
    write: (p, c) => { files.set(p, c); return { ok: true, created: true } },
    say: (text, role = 'agent') => { const m = { text, role, append (s) { this.text += s } }; said.push(m); return { append: s => { m.text += s }, text: () => m.text, id: 'm' + said.length } },
    addUsage () {}, releaseClaims () {}, claimedByOther: () => null,
    requestApproval: async a => { asks.push(a); return { approved: approve, by: 'alice' } },
    chat: { toArray: () => [new Map([['role', 'user'], ['text', { toString: () => 'please open this powerpoint deck' }], ['author', 'alice'], ['isAgent', false]])] }
  }
}
// a model that follows a script of tool calls and records what it was shown
function scriptedLlm (steps) {
  const seen = []; let i = 0
  return { seen, lastUsage: null, modelFor: () => 'fake', async * complete ({ messages, tools }) {
    seen.push({ messages: JSON.parse(JSON.stringify(messages)), tools: tools.map(t => t.function.name) })
    const s = steps[i++]; if (s.text) yield { text: s.text }
    yield { done: true, toolCalls: (s.calls || []).map((c, n) => ({ id: 'c' + i + n, name: c[0], args: c[1] })) }
  } }
}
const toolText = (llm, step) => llm.seen[step].messages.filter(m => m.role === 'tool').pop().content

// 1) installed -> library hit needs no approval; the prompt lists the skills
{
  const room = makeRoom(); const llm = scriptedLlm([{ calls: [['find_skill', { query: 'teach me with hints' }]] }, { calls: [['find_skill', { load: 'tutor-mode' }]] }, { text: 'ok' }])
  await respond({ room, llm, trigger: 't', runner: {}, skills: { library } })
  assert.match(llm.seen[0].messages[0].content, /Skills ready to use:\n- tutor-mode: Teach with hints\./)
  assert.match(llm.seen[0].messages[0].content, /Before you tell the user you cannot/)
  assert.match(llm.seen[0].messages[0].content, /\{\{file:path-or-name\}\} on its own line directly after the sentence that introduces it/, 'the file-placement rule is in the prompt')
  for (const re of [/\{\{card:path\}\}/, /\{\{image:path\}\}/, /\{\{image:path\|big\}\}/, /an SVG you write with write_file is a picture/]) assert.match(llm.seen[0].messages[0].content, re, 'the hand-over markers are in the prompt: ' + re)
  assert.ok(llm.seen[0].tools.includes('find_skill'))
  const r1 = JSON.parse(toolText(llm, 1)); assert.strictEqual(r1.where, 'library'); assert.strictEqual(r1.needsApproval, false)
  assert.match(toolText(llm, 2), /<skill name="tutor-mode" source="starter"[^>]*>\nHints first\./)
  assert.strictEqual(room.asks.length, 0)
}
// 2) GitHub hit: asks first, in every mode, writes into the workspace only after Approve
for (const mode of ['manual', 'auto', 'bypass']) {
  const room = makeRoom({ mode }); const github = makeGithubSearch(['https://github.com/acme/skills'], { fetchJson, fetchText })
  const llm = scriptedLlm([{ calls: [['find_skill', { query: 'open this powerpoint deck' }]] }, { calls: [['find_skill', { install: 'pptx-reader' }]] }, { text: 'done' }])
  await respond({ room, llm, trigger: 't', runner: {}, skills: { library, github } })
  const found = JSON.parse(toolText(llm, 1)); assert.strictEqual(found.where, 'github'); assert.strictEqual(found.needsApproval, true); assert.deepStrictEqual(found.tried.map(t => t.where), ['installed', 'library', 'github'])
  assert.strictEqual(room.asks.length, 1, 'asked in ' + mode); assert.strictEqual(room.asks[0].kind, 'skill'); assert.match(room.asks[0].summary, /pptx-reader.*acme\/skills@bbbbbbb/); assert.match(room.asks[0].detail, /Unzip the deck/)
  assert.ok(room.files.has('.vespr/skills/pptx-reader/SKILL.md'), 'saved in the workspace after approval')
  assert.match(toolText(llm, 2), /<skill name="pptx-reader"/)
  assert.ok(room.said.some(m => m.role === 'tool' && /installed the skill pptx-reader/.test(m.text)))
}
// 3) denied: nothing is written and the model is told not to retry
{
  const room = makeRoom({ approve: false }); const github = makeGithubSearch(['https://github.com/acme/skills'], { fetchJson, fetchText })
  const llm = scriptedLlm([{ calls: [['find_skill', { query: 'open this powerpoint deck' }]] }, { calls: [['find_skill', { install: 'pptx-reader' }]] }, { text: 'sorry' }])
  await respond({ room, llm, trigger: 't', runner: {}, skills: { library, github } })
  assert.ok(![...room.files.keys()].some(p => p.startsWith('.vespr/')), 'nothing saved'); assert.match(JSON.parse(toolText(llm, 2)).error, /denied by alice/)
}
// 4) plan mode: no card, no write
{
  const room = makeRoom({ mode: 'plan' }); const github = makeGithubSearch(['https://github.com/acme/skills'], { fetchJson, fetchText })
  const llm = scriptedLlm([{ calls: [['find_skill', { query: 'open this powerpoint deck' }]] }, { calls: [['find_skill', { install: 'pptx-reader' }]] }, { text: 'plan' }])
  await respond({ room, llm, trigger: 't', runner: {}, skills: { library, github } })
  assert.strictEqual(room.asks.length, 0); assert.match(JSON.parse(toolText(llm, 2)).error, /plan mode/)
}
// 5) nothing matches: an honest empty answer; installing a name that was never found is refused; GitHub down is reported
{
  const room = makeRoom(); const github = makeGithubSearch(['https://github.com/acme/skills'], { fetchJson: async () => { throw new Error('offline') }, fetchText })
  const llm = scriptedLlm([{ calls: [['find_skill', { query: 'render a 3d model' }]] }, { calls: [['find_skill', { install: 'made-up' }], ['find_skill', { load: 'made-up' }]] }, { text: 'I could not find a skill for that.' }])
  await respond({ room, llm, trigger: 't', runner: {}, skills: { library, github } })
  const r = JSON.parse(toolText(llm, 1)); assert.strictEqual(r.found, false); assert.deepStrictEqual(r.candidates, []); assert.match(r.githubErrors[0], /offline/); assert.match(r.next, /tell the user plainly/)
  const last = llm.seen[2].messages.filter(m => m.role === 'tool').slice(-2).map(m => JSON.parse(m.content).error)
  assert.match(last[0], /Search with query first/); assert.match(last[1], /no installed skill called made-up/)
}
// 6) without skills configured the tool is absent and the prompt is unchanged
{
  const room = makeRoom(); const llm = scriptedLlm([{ text: 'hi' }])
  await respond({ room, llm, trigger: 't', runner: {} })
  assert.ok(!llm.seen[0].tools.includes('find_skill')); assert.ok(!/Skills ready to use/.test(llm.seen[0].messages[0].content))
}
console.log('skillwire tests passed')
