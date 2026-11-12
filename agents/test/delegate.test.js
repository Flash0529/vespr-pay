// delegate_task: a manager agent hands work down its tree only, the task carries the access level of what the manager read,
// a worker that may not see that level never gets it (named or picked by the watchdog), and the demo model can delegate.
import assert from 'node:assert'
import { buildTree, answersMention } from '../src/hierarchy.js'
import { delegateTask, hasReports, DELEGATE_TOOL } from '../src/delegate.js'
import { createManager } from '../src/manager.js'
import { asOpenAITools, guardTool, DOING_TOOLS, answeringLine } from '../src/agent.js'
import { Mock } from '../src/llm.js'

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const { tree } = buildTree([
  { name: 'lead', maker: 'Maya', ceiling: 'manager' },
  { name: 'fe', parent: 'lead', maker: 'Maya', ceiling: 'member' },
  { name: 'be', parent: 'lead', maker: 'Maya', ceiling: 'manager' },
  { name: 'scraper', parent: 'be', maker: 'Maya', ceiling: 'member' },
  { name: 'helper', maker: 'Dev' }
])
const MGR = { level: 'manager', scopes: [], owner: 'Maya' }
const go = (me, args, extra = {}) => { const tasks = new Map(); const r = delegateTask({ tasks, tree, me, requester: 'Maya', args, now: 1_000_000, ...extra }); return { r: JSON.parse(r.text), note: r.note, tasks, task: [...tasks.values()][0] } }

await t('to a direct worker: assigned on the manager\'s own team list', () => {
  const { r, task, note } = go('lead', { to: '@fe', title: 'Fix the discount bug in cart.py', detail: 'and run the tests' })
  assert.strictEqual(r.ok, true); assert.strictEqual(note, `handed task ${r.id} to @fe`)
  assert.deepStrictEqual([task.pair, task.owner, task.status, task.createdBy, task.delegatedBy, task.attempts], ['lead', 'fe', 'assigned', 'Maya', 'lead', 1])
})

await t("to a worker's worker: it goes on that agent's own manager's list", () => {
  const { task } = go('lead', { to: 'scraper', title: 'Collect competitor prices' })
  assert.deepStrictEqual([task.pair, task.owner], ['be', 'scraper'])
})

await t('never sideways, up, into another tree, or to nobody', () => {
  for (const [me, to] of [['be', 'fe'], ['fe', 'lead'], ['lead', 'helper'], ['lead', 'ghost'], ['lead', 'lead']]) {
    const { r, tasks } = go(me, { to, title: 'x' })
    assert.ok(r.error, `${me} -> ${to}`); assert.strictEqual(tasks.size, 0)
  }
  assert.match(go('fe', { title: 'x' }).r.error, /no agents below you/, 'an agent with no team cannot delegate')
  assert.match(go('lead', { to: 'fe', title: '   ' }).r.error, /needs a title/)
  assert.strictEqual(go('lead', { to: 'fe', title: 'y'.repeat(900) }).task.title.length, 300)
})

await t('the task carries the access level, and a worker that may not see it never gets it', () => {
  assert.match(go('lead', { to: 'fe', title: 'Reorg plan follow-up' }, { label: MGR }).r.error, /fe may not see/)
  const ok = go('lead', { to: 'be', title: 'Reorg plan follow-up' }, { label: MGR })
  assert.deepStrictEqual(ok.task.label, { level: 'manager', scopes: [], owner: 'Maya' })
  assert.match(go('be', { title: 'x' }, { label: MGR }).r.error, /none of your workers may see/, "be's only worker is member level")
})

await t("without a name, the manager's watchdog gives a labeled task only to a worker that may see it", () => {
  const { tasks, task } = go('lead', { title: 'Reorg plan follow-up' }, { label: MGR })
  assert.deepStrictEqual([task.status, task.owner, task.pair], ['todo', null, 'lead'])
  const clock = 2_000_000; const aw = [{ name: 'fe', isAgent: true, beat: clock }, { name: 'be', isAgent: true, beat: clock }]
  const mgr = createManager({ name: 'lead', pair: 'lead', now: () => clock, tree, room: { doc: { getMap: () => tasks }, getAwarenessStates: () => aw, say: () => ({}) } })
  mgr.createTask({ title: 'open job 1' }); mgr.createTask({ title: 'open job 2' }) // load fe... and be, so load alone would not decide
  mgr.tick()
  assert.strictEqual(tasks.get(task.id).owner, 'be')
})

await t('the tool is offered only to agents with a team', () => {
  assert.strictEqual(hasReports(tree, 'lead'), true); assert.strictEqual(hasReports(tree, 'fe'), false); assert.strictEqual(hasReports(null, 'lead'), false)
  const names = d => asOpenAITools(false, true, false, false, d).map(x => x.function.name)
  assert.ok(names(true).includes(DELEGATE_TOOL.name)); assert.ok(!names(false).includes(DELEGATE_TOOL.name))
})

await t('the demo model delegates when asked, and reports back', async () => {
  const llm = new Mock(); const msgs = [{ role: 'system', content: 'x' }, { role: 'user', content: 'Maya: @lead delegate to fe: fix the discount bug in cart.py and run the tests' }]
  let calls = []; for await (const ev of llm.complete({ messages: msgs })) if (ev.done) calls = ev.toolCalls
  assert.deepStrictEqual(calls.map(c => [c.name, c.args.to, c.args.title]), [['delegate_task', 'fe', 'fix the discount bug in cart.py and run the tests']])
  msgs.push({ role: 'assistant', content: null, tool_calls: [{ id: calls[0].id, type: 'function', function: { name: 'delegate_task', arguments: JSON.stringify(calls[0].args) } }] })
  msgs.push({ role: 'tool', tool_call_id: calls[0].id, name: 'delegate_task', content: JSON.stringify({ ok: true, id: 'task-1', to: 'fe' }) })
  let text = ''; for await (const ev of llm.complete({ messages: msgs })) if (ev.text) text += ev.text
  assert.match(text, /Handed to @fe as task task-1/)
})

await t('results come back up by themselves: the agent that delegated reports a finished task to the person', () => {
  const tasks = new Map(); const said = []; const clock = 3_000_000
  const room = { doc: { getMap: () => tasks }, getAwarenessStates: () => [], say: s => { said.push(s); return {} } }
  const lead = createManager({ name: 'lead', pair: 'lead', now: () => clock, tree, room })
  const be = createManager({ name: 'be', pair: 'be', now: () => clock, tree, room })
  for (const [to, title, label] of [['fe', 'Fix the discount bug', null], ['scraper', 'Collect prices', null], ['be', 'Reorg follow-up', MGR]]) delegateTask({ tasks, tree, me: 'lead', requester: 'Maya', label, args: { to, title }, now: clock })
  for (const [id, x] of tasks) tasks.set(id, { ...x, status: 'done', result: { evidence: `${x.owner} did it; tests OK`, passed: true } })
  be.tick()
  assert.strictEqual(said.filter(s => /done:/.test(s)).length, 0, "be reviews scraper's work but does not report it: lead delegated it")
  lead.tick()
  const reports = said.filter(s => /done:/.test(s))
  assert.strictEqual(reports.length, 3)
  assert.ok(reports.includes('@Maya done: Fix the discount bug (by fe). fe did it; tests OK'))
  assert.ok(reports.includes('@Maya done: Collect prices (by scraper). scraper did it; tests OK'), 'work from two levels down still comes back through lead')
  assert.ok(reports.includes('@Maya done: Reorg follow-up (by be). Details are restricted; ask me.'), 'a restricted result is reported without its details')
  lead.tick(); assert.strictEqual(said.filter(s => /done:/.test(s)).length, 3, 'reported once')
})

await t('a worker answers only when named; @agent and @all go to the top agent', () => {
  assert.strictEqual(answersMention({ text: 'Maya: @agent fix it', name: 'lead', tree }), true)
  assert.strictEqual(answersMention({ text: 'Maya: @agent fix it', name: 'fe', tree }), false)
  assert.strictEqual(answersMention({ text: 'Maya: @all standup', name: 'scraper', tree }), false)
  assert.strictEqual(answersMention({ text: 'Maya: @fe quick question', name: 'fe', tree }), true, 'you can still talk to a worker by name')
  assert.strictEqual(answersMention({ text: 'Maya: @agent hi', name: 'coder', tree: null }), true, 'no tree: every agent behaves as before')
})

await t('an agent with a team coordinates: it can read, plan and delegate, but not change files or run commands', () => {
  const names = asOpenAITools(true, true, true, true, true, true).map(x => x.function.name)
  for (const keep of ['read_file', 'list_files', 'code_map', 'update_plan', 'delegate_task', 'web_search']) assert.ok(names.includes(keep), keep)
  for (const drop of DOING_TOOLS) assert.ok(!names.includes(drop), drop)
  assert.ok(asOpenAITools(true, true, true, true, true, false).map(x => x.function.name).includes('write_file'), 'VESPR_AGENT_DOES_WORK=1 keeps the doing tools')
  assert.match(JSON.parse(guardTool('write_file', true).text).error, /delegate_task/, 'a call to a tool it was not offered is refused with the way forward')
  assert.strictEqual(guardTool('write_file', false), null); assert.strictEqual(guardTool('read_file', true), null)
})

await t('the agent is told which message it answers, even when others spoke after it (stress test: two people asked at once)', async () => {
  const Y = await import('yjs'); const doc = new Y.Doc(); const chat = doc.getArray('chat')
  const add = (id, author, text, isAgent = false, label = null) => { const m = new Y.Map(); const tx = new Y.Text(); tx.insert(0, text); doc.transact(() => { m.set('id', id); m.set('author', author); m.set('isAgent', isAgent); m.set('role', isAgent ? 'agent' : 'user'); m.set('text', tx); if (label) m.set('label', label); chat.push([m]) }) }
  add('m1', 'maya', '@agent delegate to fe: fix the discount bug')
  add('m2', 'sam', '@agent delegate to fe: write the release notes')
  add('m3', 'fe', 'Opening cart.py.', true)
  const room = { chat }
  assert.deepStrictEqual(answeringLine(room, 'm2'), { role: 'user', content: 'The message you are answering, from sam: @agent delegate to fe: write the release notes' })
  assert.strictEqual(answeringLine(room, 'm3'), null, 'an agent message is never the request')
  assert.strictEqual(answeringLine(room, 'nope'), null)
  add('m4', 'maya', '@agent summarize the reorg plan', false, MGR)
  assert.match(answeringLine(room, 'm4', { level: 'member', scopes: [] }).content, /restricted source/, 'a restricted request stays restricted for a lower reader')
  // the demo model now answers the right request
  const llm = new Mock(); let calls = []
  for await (const ev of llm.complete({ messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'sam: @agent delegate to fe: write the release notes' }, { role: 'user', content: 'fe (agent): Opening cart.py.' }, answeringLine(room, 'm2')] })) if (ev.done) calls = ev.toolCalls
  assert.deepStrictEqual(calls.map(c => [c.name, c.args.to, c.args.title]), [['delegate_task', 'fe', 'write the release notes']])
})

// ---- briefs: what the manager knows travels with the task ----
const { makeBrief, briefText, BRIEF_CAPS } = await import('../src/delegate.js')
const { taskRequest, askFor } = await import('../src/agent.js')
const KNOWN = ['cart.py', 'tests/test_cart.py', 'README.md']

await t('a brief travels with the task: why, files that exist, done, and the original request', () => {
  const tasks = new Map()
  const r = delegateTask({ tasks, tree, me: 'lead', requester: 'Maya', now: 1_000_000, known: KNOWN, ask: { by: 'Maya', text: 'Make discounts work for 0 to 100 percent', label: null },
    args: { to: 'fe', title: 'Fix the discount bug', why: 'percent is a whole number (20 = 20%); keep the function signature', files: ['./cart.py', 'tests/test_cart.py', 'secret/none.py'], done: 'python3 -m unittest -q passes' } })
  const res = JSON.parse(r.text); const task = [...tasks.values()][0]
  assert.deepStrictEqual(task.brief, { why: 'percent is a whole number (20 = 20%); keep the function signature', files: ['cart.py', 'tests/test_cart.py'], done: 'python3 -m unittest -q passes', ask: { by: 'Maya', text: 'Make discounts work for 0 to 100 percent' } })
  assert.deepStrictEqual(res.unknownFiles, ['secret/none.py'], 'a path that does not exist is dropped and named back to the manager')
  assert.strictEqual(r.note, `handed task ${res.id} to @fe with a brief (2 files, done when set)`); assert.strictEqual(res.hint, undefined)
})

await t('the worker reads the brief under its task', () => {
  const text = taskRequest({ id: 'task-1', createdBy: 'Maya', title: 'Fix the discount bug', brief: { why: 'keep the signature', files: ['cart.py'], done: 'tests pass', ask: { by: 'Maya', text: 'Make discounts work' } } })
  assert.match(text, /Fix the discount bug\nWhy: keep the signature\nStart with: cart\.py\nDone when: tests pass\nThe original request from Maya, for context: "Make discounts work"\nDo only this task\./)
  assert.ok(!/Why:|Start with:|Done when:/.test(taskRequest({ id: 'task-2', title: 'old task without a brief' })), 'older tasks read as before')
})

await t('no done given: the task still goes, and the manager is told to add it next time', () => {
  const { r } = go('lead', { to: 'fe', title: 'Tidy the README' })
  assert.strictEqual(r.ok, true); assert.match(r.hint, /done/)
})

await t('caps and junk: long text clipped, at most 10 files, a comma list works, no whitespace tricks', () => {
  const { brief } = makeBrief({ args: { why: 'w'.repeat(5000), done: 'd\n\n\nd', files: Array.from({ length: 20 }, (_, i) => `f${i}.js`).join(', ') } })
  assert.strictEqual(brief.why.length, BRIEF_CAPS.why); assert.strictEqual(brief.done, 'd d'); assert.strictEqual(brief.files.length, 10)
  assert.strictEqual(briefText(null), ''); assert.strictEqual(briefText({ why: '', files: 'x', done: '' }), '')
})

await t('the original request only goes to agents allowed to read it', () => {
  const ask = { by: 'Maya', text: 'Q3 numbers are in board/plan.md', label: MGR }
  const named = (to) => { const tasks = new Map(); delegateTask({ tasks, tree, me: 'lead', requester: 'Maya', ask, args: { to, title: 'Format the table' }, now: 1 }); return [...tasks.values()][0].brief }
  assert.deepStrictEqual(named('be').ask, { by: 'Maya', text: 'Q3 numbers are in board/plan.md' }, 'be may read manager level')
  const fe = named('fe'); assert.strictEqual(fe.ask, undefined); assert.strictEqual(fe.askHidden, true, 'fe (member) gets a note, not the text')
  assert.match(briefText(fe), /above your access level/)
  const tasks = new Map(); delegateTask({ tasks, tree, me: 'lead', requester: 'Maya', ask, args: { title: 'Left to the watchdog' }, now: 1 })
  assert.strictEqual([...tasks.values()][0].brief.askHidden, true, 'unnamed: hidden unless every worker may read it')
})

await t('the original request reaches every level: a task turn passes on the request its own brief carries', () => {
  const taskMap = new Map([['task-up', { id: 'task-up', label: null, brief: { ask: { by: 'Maya', text: 'Ship the price page' } } }]])
  const msg = (o) => ({ get: k => o[k] })
  const room = { chat: { toArray: () => [msg({ id: 'm1', author: 'Maya', isAgent: false, text: { toString: () => 'Ship it' }, label: 'lead' }), msg({ id: 'm2', author: 'lead', isAgent: true, text: 'ok' })] }, doc: { getMap: () => taskMap } }
  assert.deepStrictEqual(askFor(room, 'm1', ''), { by: 'Maya', text: 'Ship it', label: 'lead' })
  assert.strictEqual(askFor(room, 'm2', ''), null, 'an agent message is not a person\'s request')
  assert.deepStrictEqual(askFor(room, '', 'task-up'), { by: 'Maya', text: 'Ship the price page', label: null })
  assert.strictEqual(askFor(room, '', 'task-none'), null)
})

console.log(`delegate tests passed (${n}): briefs (why, real files, done, the original request by access level, every level), direct worker, worker's worker, never sideways/up/out, access level carried and enforced, watchdog respects levels, tool offered to managers only, demo model delegates, results reported up once, top agent answers generic calls, coordinators delegate, the answered message comes last`)
