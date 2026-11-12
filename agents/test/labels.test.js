// Access labels: an agent never reads above the person it works for, restricted context reaches the model only as a short note,
// and what the agent writes carries the highest label it read. With no labels anywhere, the model sees exactly what it saw before.
import assert from 'node:assert'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import * as Y from 'yjs'
import { LEVELS, cleanLabel, readerFor, canRead, highWater, restrictedNote } from '../src/labels.js'
import { history, requesterOf } from '../src/agent.js'
import { levelsFrom } from '../src/room.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const member = readerFor({ level: 'member' }); const manager = readerFor({ level: 'manager', scopes: ['Project:Atlas'] })
const MGR = { level: 'manager', scopes: ['project:atlas'], owner: 'Maya' }

t('labels are cleaned; an unknown level fails closed', () => {
  assert.strictEqual(cleanLabel(null), null)
  assert.deepStrictEqual(cleanLabel({ level: 'lead', scopes: [' Team:A ', 'team:a', ''], owner: 'Maya' }), { level: 'lead', scopes: ['team:a'], owner: 'Maya' })
  assert.strictEqual(cleanLabel({ level: 'ceo' }).level, LEVELS[LEVELS.length - 1])
})

t('an agent never outranks its person', () => {
  assert.strictEqual(readerFor({ level: 'member', ceiling: 'manager' }).level, 'member', 'a management agent used by a developer reads as a developer')
  assert.strictEqual(readerFor({ level: 'manager', ceiling: 'member' }).level, 'member', 'a public agent used by a manager reads as public')
  assert.strictEqual(readerFor({ level: 'manager' }).level, 'manager')
  assert.strictEqual(readerFor({ ceiling: 'manager' }).level, null, 'a person with no level reads only open things, whatever the agent is')
  assert.deepStrictEqual(manager.scopes, ['project:atlas'])
})

t('no reading up, and scopes must all be held', () => {
  assert.strictEqual(canRead(null, readerFor({})), true, 'open stays open for everyone')
  assert.strictEqual(canRead(MGR, member), false)
  assert.strictEqual(canRead(MGR, manager), true)
  assert.strictEqual(canRead(MGR, readerFor({ level: 'admin' })), false, 'a higher level without the project scope still cannot read it')
  assert.strictEqual(canRead({ level: 'member' }, readerFor({})), false, 'labeled text needs a reader with a level')
  assert.strictEqual(canRead({ level: 'nonsense' }, readerFor({ level: 'manager' })), false)
})

t('derived content inherits the highest label and every scope', () => {
  assert.strictEqual(highWater([]), null)
  assert.deepStrictEqual(highWater([{ level: 'lead', scopes: ['team:a'], owner: 'Sam' }, MGR]), { level: 'manager', scopes: ['project:atlas', 'team:a'], owner: '' })
  assert.match(restrictedNote(MGR), /restricted source; ask Maya/)
  assert.strictEqual(restrictedNote(null), '[from a restricted source]')
})

t('levels come from an operator file, not from the shared document', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'levels-')), 'levels.json')
  fs.writeFileSync(f, JSON.stringify({ Maya: { level: 'manager', scopes: ['project:atlas'] }, Dev: 'member', Bad: { level: 7 } }))
  const lv = levelsFrom(f)
  assert.deepStrictEqual(lv('Maya'), { level: 'manager', scopes: ['project:atlas'] })
  assert.deepStrictEqual(lv('Dev'), { level: 'member', scopes: [] })
  assert.deepStrictEqual(lv('Bad'), { level: null, scopes: [] })
  assert.deepStrictEqual(lv('Nobody'), { level: null, scopes: [] })
  assert.deepStrictEqual(levelsFrom('')('Maya'), { level: null, scopes: [] }, 'no file: nobody has a level, everything stays open')
  assert.deepStrictEqual(levelsFrom(f + '.missing')('Maya'), { level: null, scopes: [] })
})

// a room as the agent sees it: the shared chat plus who it works for
function roomWith (msgs) {
  const doc = new Y.Doc(); const chat = doc.getArray('chat')
  for (const o of msgs) {
    const m = new Y.Map(); const tx = new Y.Text(); tx.insert(0, o.text)
    doc.transact(() => { m.set('author', o.author); m.set('isAgent', !!o.isAgent); m.set('role', o.role || 'user'); m.set('text', tx); if (o.label) m.set('label', o.label); if (o.contexts) m.set('contexts', o.contexts); chat.push([m]) })
  }
  return { name: 'coder', chat }
}
const msgs = [
  { author: 'Dev', text: '@coder what are we focusing on?' },
  { author: 'mgmt-agent', isAgent: true, role: 'agent', text: 'Reorg: the Atlas team moves to payments in Q1.', label: MGR },
  { author: 'Maya', text: 'Hey team, focus on the payments flow this sprint.', contexts: [
    { kind: 'chat', author: 'mgmt-agent', thread: 'leadership', text: 'Reorg: the Atlas team moves to payments in Q1.', label: MGR },
    { kind: 'code', file: 'pay.py', lines: [3, 4], text: 'def charge():' }
  ] }
]

t('with no labels anywhere, the model sees exactly what it saw before', () => {
  const plain = roomWith(msgs.map(({ label, contexts, ...m }) => ({ ...m, contexts: contexts && contexts.map(({ label, ...c }) => c) })))
  assert.deepStrictEqual(history(plain, readerFor({})), history(plain))
})

t("a developer's agent gets the manager's shared words, not the manager-only source behind them", () => {
  const room = roomWith(msgs); const seen = []
  const h = history(room, member, seen)
  const all = h.map(x => x.content).join('\n')
  assert.ok(!all.includes('Reorg'), 'the management text never reaches the model')
  assert.ok(all.includes('focus on the payments flow'), 'what the manager chose to share does')
  assert.ok(all.includes('def charge():'), 'open context still comes along')
  assert.strictEqual((all.match(/restricted source; ask Maya/g) || []).length, 2, 'the message and the context each leave a short note instead')
  assert.deepStrictEqual(seen, [], 'nothing restricted was read, so the reply stays open')
  assert.strictEqual(highWater(seen), null)
})

t("a manager's agent reads it all, and its reply is labeled manager-level", () => {
  const room = roomWith(msgs); const seen = []
  const all = history(room, manager, seen).map(x => x.content).join('\n')
  assert.ok(all.includes('Reorg: the Atlas team') && all.includes('def charge():'))
  assert.deepStrictEqual(highWater(seen), { level: 'manager', scopes: ['project:atlas'], owner: 'Maya' })
})

t('the reader is the person who asked, found by the trigger id the agent loop passes', () => {
  const room = roomWith(msgs); const ids = room.chat.toArray().map((m, i) => { m.doc.transact(() => m.set('id', 'm' + i)); return 'm' + i })
  assert.strictEqual(requesterOf(room, ids[2]), 'Maya')
  assert.strictEqual(requesterOf(room, room.chat.get(0)), 'Dev', 'a message object works too')
  assert.strictEqual(requesterOf(room, ids[1]), '', 'an agent never counts as the person it works for')
  assert.strictEqual(requesterOf(room, 'nope'), '')
})

console.log(`labels tests passed (${n}): cleaning, no outranking, no reading up, scopes, high-water, operator levels file, unchanged when unlabeled, developer vs manager agent`)
