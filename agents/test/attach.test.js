// attach_file: a file a command made in the sandbox folder is shared with the room through the upload store. The read is confined to the run folder
// (no absolute paths, no .., no symlinks, nothing that resolves outside), secret-looking names are refused, and the model is told what to write in its reply.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { respond, asOpenAITools, FILE_RULES } from '../src/agent.js'
import { SandboxRunner } from '../src/runner.js'
import { createAttachments } from '../src/attachments.js'

assert.ok(!asOpenAITools(false, false, false, false).some(t => t.function.name === 'attach_file'), 'off when attachments are not available')
assert.ok(asOpenAITools(false, false, false, true).some(t => t.function.name === 'attach_file'))
assert.match(FILE_RULES, /attach_file/)
assert.match(FILE_RULES, /never \{\{none\}\}, \{\{file:none\}\} or an empty \{\{file:\}\}\. A message about a payment never carries a file marker\./)

// --- the sandbox read
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-')); fs.writeFileSync(path.join(tmp, 'outside.txt'), 'not in the run folder')
const runner = new SandboxRunner({ root: tmp })
const written = []; const room0 = { roomName: 'demo', list: () => [], read: () => null, write: (p, c) => { written.push(p); return { ok: true } } }
await runner.exec(room0, "printf '\\x89PNG\\r\\n\\x1a\\n\\0\\0\\0' > chart.png; mkdir -p out; printf 'a,b\\n1,2\\n' > out/data.csv; ln -s /etc/hostname leak.txt; ln -s .. up; head -c 11000000 /dev/zero > big.bin; : > empty.bin; echo K=1 > .env; echo hi > notes.txt", 'm')
assert.ok(written.includes('out/data.csv') && written.includes('notes.txt'), 'text files made by a command still come back into the room')
assert.ok(!written.includes('leak.txt'), 'a symlink is never followed and copied into the room')
const read = n => runner.readFile(room0, n)
assert.strictEqual(read('chart.png').buf[0], 0x89); assert.strictEqual(read('chart.png').name, 'chart.png')
assert.strictEqual(read('out/data.csv').name, 'data.csv'); assert.strictEqual(read('./chart.png').name, 'chart.png')
for (const bad of ['/etc/passwd', '../outside.txt', '../../etc/passwd', 'leak.txt', 'up/outside.txt', '', '.', 'nope.png', 'out', 'out/../../outside.txt']) assert.throws(() => read(bad), Error, 'refused: ' + bad)
assert.throws(() => read('big.bin'), /more than the 10 MB/); assert.throws(() => read('empty.bin'), /empty/)
assert.strictEqual(runner.readFile(room0, 'big.bin', { max: 20 * 1024 * 1024 }).buf.length, 11000000, 'the limit is a parameter')
await runner.exec(room0, 'true', 'm2'); assert.throws(() => read('chart.png'), /rebuilt before every command/, 'the folder is rebuilt before each command')

// --- the upload (fake server)
const calls = []
const fake = async (url, o) => { calls.push({ url, o }); return { ok: true, status: 201, json: async () => ({ id: '0123456789abcdef', name: new URL(url).searchParams.get('name'), size: o.body.length, type: o.headers['Content-Type'] }) } }
const att = createAttachments({ baseUrl: 'http://srv/', token: 'tok', room: 'demo', fetchImpl: fake })
const meta = await att.put('a b.png', Buffer.from([1, 2, 3]), 'image/png')
assert.strictEqual(meta.size, 3); assert.match(calls[0].url, /^http:\/\/srv\/api\/upload\/demo\?name=a%20b\.png$/); assert.strictEqual(calls[0].o.method, 'POST'); assert.strictEqual(calls[0].o.headers.Authorization, 'Bearer tok')
for (const [status, re] of [[413, /larger/], [507, /upload limit/], [500, /HTTP 500/]]) await assert.rejects(createAttachments({ baseUrl: 'http://srv', token: 't', room: 'd', fetchImpl: async () => ({ ok: false, status }) }).put('x', Buffer.from('x')), re)

// --- through the agent loop, with a scripted model
function makeRoom () {
  const said = []
  return { said, name: 'coder', roomName: 'demo', mode: () => 'auto', list: () => [], read: () => null, write: () => ({ ok: true }),
    say: (text, role = 'agent') => { const m = { text, role }; said.push(m); return { append: s => { m.text += s }, text: () => m.text, id: 'm' + said.length } },
    addUsage () {}, releaseClaims () {}, claimedByOther: () => null, requestApproval: async () => ({ approved: true, by: 'alice' }),
    chat: { toArray: () => [new Map([['role', 'user'], ['text', { toString: () => 'make a chart and show it' }], ['author', 'alice'], ['isAgent', false]])] } }
}
function scriptedLlm (steps) {
  const seen = []; let i = 0
  return { seen, lastUsage: null, modelFor: () => 'fake', async * complete ({ messages, tools }) {
    seen.push({ messages: JSON.parse(JSON.stringify(messages)), tools: tools.map(t => t.function.name) })
    const s = steps[i++]; if (s.text) yield { text: s.text }
    yield { done: true, toolCalls: (s.calls || []).map((c, n) => ({ id: 'c' + i + n, name: c[0], args: c[1] })) }
  } }
}
const lastTool = llm => llm.seen[llm.seen.length - 1].messages.filter(m => m.role === 'tool').pop().content
const sent = []; const attachments = { put: async (name, buf, type) => { sent.push({ name, size: buf.length, type }); return { id: 'abcdef0123456789', name, size: buf.length, type } } }
await runner.exec(room0, "printf '\\x89PNG\\r\\n\\x1a\\n\\0\\0\\0' > chart.png; printf 'a,b\\n1,2\\n' > data.csv; echo K=1 > .env; printf 'x\\0' > id_rsa", 'm3')

let llm = scriptedLlm([{ calls: [['attach_file', { path: 'chart.png' }]] }, { text: 'done' }]); let room = makeRoom()
await respond({ room, llm, trigger: 't', runner, attachments })
assert.ok(llm.seen[0].tools.includes('attach_file'))
let res = JSON.parse(lastTool(llm)); assert.strictEqual(res.ok, true); assert.strictEqual(res.writeThisInYourReply, '{{image:chart.png}}'); assert.deepStrictEqual(sent.pop(), { name: 'chart.png', size: 11, type: 'image/png' })
llm = scriptedLlm([{ calls: [['attach_file', { path: 'data.csv' }]] }, { text: 'done' }]); await respond({ room: makeRoom(), llm, trigger: 't', runner, attachments })
res = JSON.parse(lastTool(llm)); assert.strictEqual(res.writeThisInYourReply, '{{card:data.csv}}'); assert.strictEqual(sent.pop().type, 'text/csv')
for (const [p, re] of [['.env', /secret/], ['id_rsa', /secret/], ['/etc/hostname', /not inside/], ['../outside.txt', /not inside/], ['', /required/]]) {
  llm = scriptedLlm([{ calls: [['attach_file', { path: p }]] }, { text: 'done' }]); await respond({ room: makeRoom(), llm, trigger: 't', runner, attachments })
  res = JSON.parse(lastTool(llm)); assert.strictEqual(res.ok, false, p); assert.match(res.error, re, p)
}
assert.strictEqual(sent.length, 0, 'nothing refused was uploaded')
llm = scriptedLlm([{ calls: [['attach_file', { path: 'chart.png' }]] }, { text: 'done' }]); await respond({ room: makeRoom(), llm, trigger: 't', runner: { remote: true, exec: async () => ({}) }, attachments })
assert.match(JSON.parse(lastTool(llm)).error, /agent sandbox/, 'a teammate\'s computer cannot share files this way')
const failing = { put: async () => { throw new Error('the server answered HTTP 500') } }
llm = scriptedLlm([{ calls: [['attach_file', { path: 'chart.png' }]] }, { text: 'done' }]); await respond({ room: makeRoom(), llm, trigger: 't', runner, attachments: failing })
assert.match(JSON.parse(lastTool(llm)).error, /could not upload/)

fs.rmSync(tmp, { recursive: true, force: true })
console.log('attach tests passed')
