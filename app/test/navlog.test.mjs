import assert from 'node:assert'
import { createNavLog, DEFAULTS } from '../navlog.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }

t('a clean path without bounces reports nothing', () => {
  let clock = 1000
  const log = createNavLog({ now: () => clock })
  // Visit A -> B -> C -> D with no returns
  for (const s of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']) {
    clock += 1000
    log.visit(s)
  }
  assert.deepStrictEqual(log.report(), [])
})

t('10 visits of A with 2 bounces to B = ratio 0.2 reported with partner B', () => {
  let clock = 1000
  const log = createNavLog({ now: () => clock })
  // Bounce 1: A -> B -> A
  log.visit('A'); clock += 1000
  log.visit('B'); clock += 1000
  log.visit('A'); clock += 1000
  // Bounce 2: A -> B -> A
  log.visit('B'); clock += 1000
  log.visit('A'); clock += 1000
  // 7 more visits of A without bouncing (e.g. A -> X -> Y -> A)
  for (let i = 0; i < 7; i++) {
    log.visit(`X${i}`); clock += 1000
    log.visit(`Y${i}`); clock += 1000
    log.visit('A'); clock += 1000
  }
  // Total visits of A: 10 visits, exactly 2 bounces (both to B)
  const rep = log.report()
  assert.strictEqual(rep.length, 1)
  assert.strictEqual(rep[0].screen, 'A')
  assert.strictEqual(rep[0].visits, 10)
  assert.strictEqual(rep[0].bounces, 2)
  assert.strictEqual(rep[0].ratio, 0.2)
  assert.strictEqual(rep[0].partner, 'B')
})

t('below minVisits reports nothing even at ratio 1', () => {
  let clock = 1000
  const log = createNavLog({ now: () => clock })
  // A -> B -> A -> B -> A (3 visits, 2 bounces, ratio 0.67, but < 10 minVisits)
  log.visit('A'); clock += 1000
  log.visit('B'); clock += 1000
  log.visit('A'); clock += 1000
  log.visit('B'); clock += 1000
  log.visit('A'); clock += 1000
  assert.deepStrictEqual(log.report(), [])
})

t('a bounce slower than quickMs does not count', () => {
  let clock = 1000
  const log = createNavLog({ now: () => clock })
  // Slower than quickMs (30,000 ms)
  log.visit('A'); clock += 1000
  log.visit('B'); clock += 35000
  log.visit('A'); clock += 1000
  // Fill 9 more non-bouncing visits of A
  for (let i = 0; i < 9; i++) {
    log.visit(`X${i}`); clock += 1000
    log.visit(`Y${i}`); clock += 1000
    log.visit('A'); clock += 1000
  }
  assert.deepStrictEqual(log.report(), [])
})

t('a repeated visit of the same screen does not add an entry', () => {
  const log = createNavLog()
  log.visit('editor')
  log.visit('editor')
  log.visit('editor')
  assert.strictEqual(log.export().length, 1)
})

t('max drops the oldest entries', () => {
  let clock = 1000
  const log = createNavLog({ now: () => clock, max: 3 })
  log.visit('A'); clock += 100
  log.visit('B'); clock += 100
  log.visit('C'); clock += 100
  log.visit('D'); clock += 100
  const exp = log.export()
  assert.strictEqual(exp.length, 3)
  assert.deepStrictEqual(exp.map(x => x.screen), ['B', 'C', 'D'])
})

t('import rejects garbage entries', () => {
  const log = createNavLog()
  log.import([
    null,
    { screen: '' },
    { screen: 'valid', at: 1234 },
    { screen: 'too-long-'.repeat(20), at: 100 },
    { screen: 'bad-at', at: 'string' },
    { screen: 'bad-nan', at: NaN },
    { screen: 'another', at: 5678 }
  ])
  const exp = log.export()
  assert.strictEqual(exp.length, 2)
  assert.deepStrictEqual(exp.map(x => x.screen), ['valid', 'another'])
})

t('ties for partner choose the first seen', () => {
  let clock = 1000
  const log = createNavLog({ now: () => clock })
  // A -> B -> A (bounce with B at t=1000)
  log.visit('A'); clock += 500
  log.visit('B'); clock += 500
  log.visit('A'); clock += 500
  // A -> C -> A (bounce with C at t=2500)
  log.visit('C'); clock += 500
  log.visit('A'); clock += 500
  // 8 more non-bouncing visits
  for (let i = 0; i < 8; i++) {
    log.visit(`X${i}`); clock += 500
    log.visit(`Y${i}`); clock += 500
    log.visit('A'); clock += 500
  }
  // B and C each have 1 bounce. B was seen first.
  const rep = log.report()
  assert.strictEqual(rep.length, 1)
  assert.strictEqual(rep[0].partner, 'B')
})

t('report never throws on a bad options argument', () => {
  const log = createNavLog({ now: () => 1 })
  for (const bad of [null, 5, 'x', []]) assert.deepStrictEqual(log.report(bad), [])
})

console.log('navlog tests passed (' + n + ')')
