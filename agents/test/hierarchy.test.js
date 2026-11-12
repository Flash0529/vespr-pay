// Agent hierarchy rules: delegation goes down the tree only, makers steer what they (or their agents) made, a child never
// outranks its parent, and the tree survives bad input (unknown parents, loops, duplicates) without granting anything.
import assert from 'node:assert'
import { buildTree, chain, makerOf, canDelegate, canSteer, escalation, readerFor } from '../src/hierarchy.js'
import { canRead } from '../src/labels.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }

// Maya's team: a lead agent with a frontend and a backend agent; the backend agent made its own helper; Dev has a private helper
const { tree, problems } = buildTree([
  { name: 'lead', maker: 'Maya', ceiling: 'manager', scopes: ['project:atlas', 'project:sc'] },
  { name: 'fe', parent: 'lead', maker: 'Maya', ceiling: 'member', scopes: ['project:sc'] },
  { name: 'be', parent: 'lead', maker: 'Maya', ceiling: 'admin', scopes: ['project:sc', 'project:secret'] },
  { name: 'scraper', parent: 'be', maker: 'be', ceiling: 'lead', scopes: ['project:sc'] },
  { name: 'helper', maker: 'Dev', ceiling: 'member', visibility: 'windows' },
  { name: 'ghost', parent: 'nobody', maker: 'Sam' },
  { name: 'fe', maker: 'Eve', ceiling: 'admin' },
  { name: 'x', parent: 'y', maker: 'Sam' }, { name: 'y', parent: 'x', maker: 'Sam' }
])

t('a child never outranks its parent, and bad input is reported, not trusted', () => {
  assert.strictEqual(tree.get('be').ceiling, 'manager', 'be asked for admin under a manager-level lead')
  assert.deepStrictEqual(tree.get('be').scopes, ['project:sc'], 'a scope the parent lacks is dropped')
  assert.strictEqual(tree.get('fe').maker, 'Maya', 'a duplicate name cannot take over an existing agent')
  assert.strictEqual(tree.get('ghost').parent, '', 'an unknown parent makes it top-level, it does not attach anywhere')
  assert.ok(!tree.get('x').parent || !tree.get('y').parent, 'a loop is cut')
  assert.strictEqual(buildTree([{ name: 'q', ceiling: 'emperor' }]).tree.get('q').ceiling, 'member', 'an unknown ceiling is the lowest, not the highest')
  for (const want of [/be: ceiling admin/, /be: scopes project:secret/, /duplicate agent fe/, /ghost: parent nobody/, /loops back/]) assert.ok(problems.some(p => want.test(p)), String(want))
})

t('the chain of command and who made what', () => {
  assert.deepStrictEqual(chain(tree, 'scraper'), ['scraper', 'be', 'lead'])
  assert.strictEqual(makerOf(tree, 'scraper'), 'Maya', 'an agent made by an agent belongs to the person behind that agent')
  assert.strictEqual(makerOf(tree, 'helper'), 'Dev')
})

t('work is handed down the tree only', () => {
  assert.strictEqual(canDelegate(tree, 'lead', 'scraper'), true)
  assert.strictEqual(canDelegate(tree, 'be', 'scraper'), true)
  assert.strictEqual(canDelegate(tree, 'be', 'fe'), false, 'not sideways')
  assert.strictEqual(canDelegate(tree, 'scraper', 'lead'), false, 'not up')
  assert.strictEqual(canDelegate(tree, 'lead', 'lead'), false)
  assert.strictEqual(canDelegate(tree, 'lead', 'helper'), false, "not into someone else's tree")
  assert.strictEqual(canDelegate(tree, 'nobody', 'fe'), false)
})

t('makers steer what they made, including what their agents made', () => {
  assert.strictEqual(canSteer(tree, 'Maya', 'scraper'), true)
  assert.strictEqual(canSteer(tree, 'Dev', 'scraper'), false)
  assert.strictEqual(canSteer(tree, 'Dev', 'helper'), true)
  assert.strictEqual(canSteer(tree, 'Maya', 'helper'), false)
  assert.strictEqual(canSteer(tree, '', 'fe'), false)
})

t('when stuck, ask up the chain and then the person', () => {
  assert.deepStrictEqual(escalation(tree, 'scraper'), ['be', 'lead', 'Maya'])
  assert.deepStrictEqual(escalation(tree, 'helper'), ['Dev'])
})

t('visibility: a Windows-only agent stays Windows-only all the way down', () => {
  const { tree: t2 } = buildTree([{ name: 'spy-safe', maker: 'Maya', visibility: 'windows' }, { name: 'kid', parent: 'spy-safe', maker: 'Maya', visibility: 'browser' }])
  assert.strictEqual(t2.get('kid').visibility, 'windows')
})

t('what an agent reads for a person: never above the person, the agent, or any agent above it', () => {
  const MGR_SC = { level: 'manager', scopes: ['project:sc'] }
  const r1 = readerFor(tree, 'scraper', { level: 'admin', scopes: ['project:sc', 'project:atlas'] })
  assert.strictEqual(r1.level, 'lead', "the scraper's own ceiling")
  assert.deepStrictEqual(r1.scopes, ['project:sc'], 'only scopes both the person and the agent hold')
  assert.strictEqual(canRead(MGR_SC, r1), false)
  const r2 = readerFor(tree, 'lead', { level: 'member', scopes: ['project:sc'] })
  assert.strictEqual(r2.level, 'member', 'a manager-level agent working for a developer reads as a developer')
  assert.strictEqual(readerFor(tree, 'unknown', { level: 'admin' }).level, null, 'an agent outside the tree reads only open things')
})

console.log(`hierarchy tests passed (${n}): clamping and bad input, chain and makers, delegation down only, maker steering, escalation, visibility, reading limits`)
