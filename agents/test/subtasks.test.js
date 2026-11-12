// A manager's own task waits for the subtasks it handed down: be (lead's worker, scraper's manager) delegates part of lead's task,
// keeps the task alive until scraper's part is reviewed, then hands in both results; lead reports once to the person who asked.
import assert from 'node:assert'
import { buildTree } from '../src/hierarchy.js'
import { delegateTask } from '../src/delegate.js'
import { createManager } from '../src/manager.js'
import { createWorker } from '../src/worker.js'

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0)) }
const { tree } = buildTree([
  { name: 'lead', maker: 'Maya', ceiling: 'manager' },
  { name: 'be', parent: 'lead', maker: 'Maya', ceiling: 'manager' },
  { name: 'scraper', parent: 'be', maker: 'Maya', ceiling: 'member' }
])

function world ({ beRun, scraperRun, maxWaitMs } = {}) {
  let clock = 5_000_000; const tasks = new Map(); const said = []
  const aw = ['lead', 'be', 'scraper'].map(name => ({ name, isAgent: true, beat: clock }))
  const room = { doc: { getMap: () => tasks }, getAwarenessStates: () => aw, say: s => { said.push(s); return {} }, requestApproval: () => Promise.resolve({ approved: false }) }
  const mk = name => createManager({ name, pair: name, now: () => clock, tree, room })
  const w = { tasks, said, lead: mk('lead'), beMgr: mk('be'), now: () => clock, adv: ms => { clock += ms; for (const a of aw) a.beat = clock } }
  // be's work: hand the hard part to scraper, as a real agent would with delegate_task while working on lead's task
  w.be = createWorker({ name: 'be', pair: 'lead', tasks, now: () => clock, maxWaitMs, run: beRun || (async task => {
    const r = JSON.parse(delegateTask({ tasks, tree, me: 'be', requester: task.createdBy, parentTask: task.id, args: { to: 'scraper', title: 'Collect competitor prices' }, now: clock }).text)
    return { evidence: `Split it: handed prices to @scraper as ${r.id}.`, passed: true }
  }) })
  w.scraper = createWorker({ name: 'scraper', pair: 'be', tasks, now: () => clock, run: scraperRun || (async () => ({ evidence: 'Collected 12 prices; checks pass', passed: true, tests: { failed: 0 } })) })
  w.step = async () => { w.adv(2000); w.be.tick(); w.scraper.tick(); await flush(); w.beMgr.tick(); w.lead.tick(); await flush() }
  return w
}
const lead2be = w => JSON.parse(delegateTask({ tasks: w.tasks, tree, me: 'lead', requester: 'Maya', args: { to: 'be', title: 'Price comparison page' }, now: w.now() }).text).id

await t("be's task stays open, and alive, until scraper's part is done; then both results go up and lead reports once", async () => {
  const w = world(); const top = lead2be(w)
  await w.step() // be starts and delegates
  const sub = [...w.tasks.values()].find(x => x.parent === top)
  assert.ok(sub, 'the subtask records its parent'); assert.deepStrictEqual([sub.owner, sub.pair, sub.createdBy, sub.delegatedBy], ['scraper', 'be', 'Maya', 'be'])
  assert.strictEqual(w.be.waiting, top)
  assert.strictEqual(w.tasks.get(top).status, 'doing', 'not handed in while the subtask is open')
  for (let i = 0; i < 30 && w.tasks.get(top).status !== 'done'; i++) { await w.step(); if (i === 20) w.adv(50_000) }
  assert.strictEqual(w.tasks.get(top).owner, 'be', 'the 45 s stall rule never took the waiting task away')
  assert.strictEqual(w.tasks.get(sub.id).status, 'done'); assert.strictEqual(w.tasks.get(top).status, 'done')
  assert.match(w.tasks.get(top).result.evidence, /^Split it: handed prices to @scraper as .*\. Subtasks: Collect competitor prices \(by scraper\): Collected 12 prices; checks pass$/)
  const reports = w.said.filter(s => /done:/.test(s))
  assert.deepStrictEqual(reports.length, 1, reports.join(' | '))
  assert.match(reports[0], /^@Maya done: Price comparison page \(by be\)\. .*Subtasks: Collect competitor prices \(by scraper\): Collected 12 prices/, 'the subtask comes back through be and lead, not straight to Maya')
})

await t('a blocked subtask makes the parent fail review instead of passing silently', async () => {
  const w = world({ scraperRun: async () => ({ evidence: '', passed: false }) }); const top = lead2be(w)
  for (let i = 0; i < 40 && !['blocked', 'done'].includes(w.tasks.get(top).status); i++) await w.step()
  const sub = [...w.tasks.values()].find(x => x.parent === top)
  assert.strictEqual(sub.status, 'blocked')
  assert.notStrictEqual(w.tasks.get(top).status, 'done', 'never approved with a blocked part')
  assert.ok(w.said.some(s => /Review rejected for task .*|blocked/.test(s)))
})

await t('subtasks that never finish make the parent hand in as failed after the wait limit', async () => {
  const w = world({ maxWaitMs: 60_000, scraperRun: () => new Promise(() => {}) }); const top = lead2be(w)
  await w.step(); assert.strictEqual(w.be.waiting, top)
  w.adv(61_000); w.be.tick(); await flush()
  const t1 = w.tasks.get(top)
  assert.strictEqual(t1.status, 'review'); assert.strictEqual(t1.result.passed, false); assert.match(t1.result.evidence, /did not finish in time/)
})

await t('a task with no subtasks is handed in at once, as before', async () => {
  const w = world({ beRun: async () => ({ evidence: 'did it myself; tests OK', passed: true }) }); const top = lead2be(w)
  await w.step()
  assert.strictEqual(w.be.waiting, null)
  assert.strictEqual(w.tasks.get(top).status, 'done', 'handed in at once and approved in the same step')
  assert.strictEqual(w.tasks.get(top).result.evidence, 'did it myself; tests OK')
})

console.log(`subtasks tests passed (${n}): parent waits and stays alive, results go up the chain and are reported once, blocked subtask fails the parent, wait limit, no subtasks = unchanged`)
