// The manager takes its workers from the agent tree: exactly its direct reports, alive by heartbeat. A peer that claims a team
// or a role about itself gets nothing, and open tasks on the team's list are picked up on the next tick.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { createManager } from '../src/manager.js'
import { buildTree, treeFrom } from '../src/hierarchy.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const { tree } = buildTree([
  { name: 'lead', maker: 'Maya', ceiling: 'manager' },
  { name: 'fe', parent: 'lead', maker: 'Maya' },
  { name: 'be', parent: 'lead', maker: 'Maya' },
  { name: 'scraper', parent: 'be', maker: 'Maya' }
])
let clock = 1_000_000
const aw = [
  { name: 'lead', isAgent: true, beat: clock },
  { name: 'fe', isAgent: true, beat: clock, state: 'idle' },
  { name: 'be', isAgent: true, beat: clock, state: 'idle' },
  { name: 'scraper', isAgent: true, beat: clock }, // works for be, not for lead
  { name: 'intruder', isAgent: true, pair: 'lead', role: 'worker', beat: clock }, // claims to be on lead's team
  { name: 'fe', isAgent: false, beat: clock + 5, state: 'typing' } // a person who typed the name "fe"
]
const said = []
const room = { getAwarenessStates: () => aw, say: s => { said.push(s); return {} } }
const mgr = createManager({ name: 'lead', pair: 'lead', tickSec: 15, stallSec: 45, now: () => clock, tree, room })

t('the workers are exactly the direct reports in the tree', () => {
  const r = mgr.getRoster()
  assert.deepStrictEqual(r.workers.map(w => w.name).sort(), ['be', 'fe'])
  assert.ok(r.workers.every(w => w.alive))
  assert.strictEqual(r.workers.find(w => w.name === 'fe').state, 'idle', 'liveness comes from the agent, not from a person using the same name')
})

const tasks = []
t('tasks go only to the tree team, never to a peer that claims the team', () => {
  for (let i = 0; i < 6; i++) tasks.push(mgr.createTask({ title: 'task ' + i, priority: i + 1 }))
  const owners = new Set(tasks.map(x => x.owner))
  assert.ok(!owners.has('intruder') && !owners.has('scraper'))
  assert.deepStrictEqual([...owners].sort(), ['be', 'fe'], 'spread over both workers by load')
})

t('rules go to the tree team only', () => {
  assert.deepStrictEqual(mgr.postRules(['tests before review']).mentions, ['fe', 'be'])
  for (const w of ['fe', 'be']) mgr.acknowledgeRules(w, 1)
})

t('a worker that stops beating loses its tasks to the other worker', () => {
  const feTasks = tasks.filter(x => x.owner === 'fe').map(x => x.id)
  clock += 20_000; for (const a of aw) if (a.name !== 'fe') a.beat = clock // fe went quiet 20 s ago (tick window 15 s)
  const out = mgr.tick()
  assert.ok(out.downCount >= 1)
  for (const id of feTasks) assert.strictEqual(mgr.getTask(id).owner, 'be', id)
  assert.ok(said.some(s => /fe is not answering, task .* goes to @be/.test(s)))
})

t('open tasks wait for a live worker, then the next tick picks them up', () => {
  let c2 = 5_000_000
  const aw2 = [{ name: 'fe', isAgent: true, beat: 0 }, { name: 'be', isAgent: true, beat: 0 }]
  const m2 = createManager({ name: 'lead', pair: 'lead', tickSec: 15, stallSec: 45, now: () => c2, tree, room: { getAwarenessStates: () => aw2, say: () => ({}) } })
  const task = m2.createTask({ title: 'nobody is up yet' })
  assert.strictEqual(task.status, 'todo'); assert.strictEqual(task.owner, null)
  c2 += 1000; aw2[1].beat = c2
  m2.tick()
  assert.strictEqual(m2.getTask(task.id).owner, 'be'); assert.strictEqual(m2.getTask(task.id).status, 'assigned')
})

t('without a tree a claiming peer gets in (why index.js never starts a manager without one)', () => {
  const m3 = createManager({ name: 'lead', pair: 'lead', now: () => clock, room: { getAwarenessStates: () => aw, say: () => ({}) } })
  assert.ok(m3.getRoster().workers.some(w => w.name === 'intruder'))
})

t('the tree file: missing or broken is an empty tree, and a change is picked up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-')); const f = path.join(dir, 'tree.json')
  assert.strictEqual(treeFrom(f)().size, 0); assert.strictEqual(treeFrom('')().size, 0)
  const get = treeFrom(f)
  fs.writeFileSync(f, JSON.stringify([{ name: 'lead', maker: 'Maya' }]))
  assert.ok(get().has('lead'))
  fs.writeFileSync(f, JSON.stringify([{ name: 'lead', maker: 'Maya' }, { name: 'fe', parent: 'lead', maker: 'Maya' }])); fs.utimesSync(f, new Date(), new Date(Date.now() + 5000))
  assert.ok(get().has('fe'))
  fs.writeFileSync(f, '{ not json'); fs.utimesSync(f, new Date(), new Date(Date.now() + 10000))
  assert.strictEqual(get().size, 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

t('a fast watchdog does not call healthy workers dead between heartbeats', () => {
  let c4 = 9_000_000
  const aw4 = [{ name: 'fe', isAgent: true, beat: c4 }, { name: 'be', isAgent: true, beat: c4 }]
  const m4 = createManager({ name: 'lead', pair: 'lead', tickSec: 3, now: () => c4, tree, room: { getAwarenessStates: () => aw4, say: () => ({}) } })
  c4 += 4000 // 4 s since the last beat: longer than a 3 s watchdog, shorter than two 5 s heartbeats
  assert.ok(m4.getRoster().workers.every(w => w.alive))
  c4 += 7000 // 11 s: two heartbeats missed
  assert.ok(m4.getRoster().workers.every(w => !w.alive))
})

console.log(`manager-tree tests passed (${n}): tree team only, no claimed members, rules to the team, quiet worker loses tasks, open tasks picked up, no tree = unsafe, tree file reload`)
