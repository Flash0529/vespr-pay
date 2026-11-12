// The live activity log inside the agent loop: every tool call becomes a chat line when it starts and is finished in place
// (done or failed, with the tool's note); update_plan sets the checklist and writes no line. Fake room and model, no network.
import assert from 'node:assert'
import { respond, asOpenAITools } from '../src/agent.js'

assert.ok(asOpenAITools(false, false).some(t => t.function.name === 'update_plan'), 'update_plan is always offered')

function makeRoom ({ readThrows = false } = {}) {
  const files = new Map([['cart.py', 'def total():\n    return 1\n']]); const said = []; const steps = []; const plans = []
  return {
    files, said, steps, plans, name: 'coder', roomName: 'demo', mode: () => 'auto',
    list: () => [...files.keys()],
    read: p => { if (readThrows) throw new Error('disk gone'); return files.has(p) ? files.get(p) : null },
    replace: (p, o, n) => (files.has(p) && files.get(p).includes(o) ? (files.set(p, files.get(p).replace(o, n)), { ok: true, line: 2 }) : { error: 'old text not found; read the file again and copy it exactly' }),
    say: (text, role = 'agent') => { const m = { text, role }; said.push(m); return { append: s => { m.text += s }, text: () => m.text, id: 'm' + said.length } },
    startStep: (tool, summary) => { const s = { tool, summary, status: 'running', note: null }; steps.push(s); return { id: 's' + steps.length, finish (note, ok = true) { s.note = note; s.status = ok ? 'done' : 'failed' } } },
    setPlan: items => { plans.push(items); return items.filter(i => i && i.text) },
    addUsage () {}, releaseClaims () {}, claimedByOther: () => null, claim () {},
    requestApproval: async () => ({ approved: true, by: 'alice' }),
    chat: { toArray: () => [new Map([['role', 'user'], ['text', { toString: () => 'fix the total' }], ['author', 'alice'], ['isAgent', false]])] }
  }
}
function scriptedLlm (turns) {
  let i = 0
  return { lastUsage: null, modelFor: () => 'fake', async * complete () {
    const s = turns[i++] || {}; if (s.text) yield { text: s.text }
    yield { done: true, toolCalls: (s.calls || []).map((c, n) => ({ id: 'c' + i + n, name: c[0], args: c[1] })) }
  } }
}
const runner = { label: 'sandbox', remote: false, exec: async () => ({ code: 1, output: 'FAILED (failures=1)', changed: [] }) }

// 1) plan + read + a failed edit + a failing command: four calls, three live lines, one checklist update
{
  const room = makeRoom()
  const llm = scriptedLlm([
    { text: 'On it. ', calls: [['update_plan', { items: [{ text: 'Read the code', status: 'in_progress' }, { text: 'Fix it', status: 'pending' }] }], ['read_file', { path: 'cart.py' }]] },
    { calls: [['replace_in_file', { path: 'cart.py', old: 'nope', new: 'x' }], ['run_command', { command: 'python3 -m unittest -q' }]] },
    { text: 'The tests still fail.' }
  ])
  await respond({ room, llm, trigger: 'u1', runner })
  assert.strictEqual(room.plans.length, 1, 'one checklist update'); assert.strictEqual(room.plans[0][0].text, 'Read the code')
  assert.deepStrictEqual(room.steps.map(s => s.tool), ['read_file', 'replace_in_file', 'run_command'], 'update_plan writes no activity line')
  assert.deepStrictEqual(room.steps.map(s => s.summary), ['Reading cart.py', 'Editing cart.py', '$ python3 -m unittest -q'], 'the live text while each runs')
  assert.deepStrictEqual(room.steps.map(s => s.status), ['done', 'failed', 'failed'], 'a failed edit and a non-zero exit are marked failed')
  assert.strictEqual(room.steps[0].note, 'read cart.py', "finished in place with the tool's own note")
  assert.match(room.steps[1].note, /^edit failed in cart\.py/); assert.match(room.steps[2].note, /^\$ python3 -m unittest -q[\s\S]*\[exit 1\]$/)
  assert.ok(!room.said.some(m => m.role === 'tool'), 'with live steps, no separate tool messages are posted')
  assert.ok(room.steps.every(s => s.status !== 'running'), 'nothing is left running')
}

// 2) a tool that throws: its line is finished as failed with the reason, then the loop reports the error as before
{
  const room = makeRoom({ readThrows: true })
  await respond({ room, llm: scriptedLlm([{ calls: [['read_file', { path: 'cart.py' }]] }]), trigger: 'u1', runner })
  assert.strictEqual(room.steps.length, 1); assert.strictEqual(room.steps[0].status, 'failed'); assert.match(room.steps[0].note, /^Reading cart\.py \(failed\)\ndisk gone/)
  assert.ok(room.said.some(m => /hit an error/.test(m.text)), 'the loop still says what went wrong')
}

// 3) a call that fails without a note (no such file) still gets a readable failed line with the reason
{
  const room = makeRoom()
  await respond({ room, llm: scriptedLlm([{ calls: [['read_file', { path: 'missing.py' }]] }, { text: 'Not there.' }]), trigger: 'u1', runner })
  assert.strictEqual(room.steps[0].status, 'failed'); assert.strictEqual(room.steps[0].note, 'Reading missing.py (failed)\nno such file: missing.py')
}

// 4) a room without startStep (older room objects) keeps the old behavior: one tool message per note
{
  const room = makeRoom(); delete room.startStep
  await respond({ room, llm: scriptedLlm([{ calls: [['read_file', { path: 'cart.py' }]] }, { text: 'ok' }]), trigger: 'u1', runner })
  assert.deepStrictEqual(room.said.filter(m => m.role === 'tool').map(m => m.text), ['read cart.py'])
}
console.log('activity tests passed')
