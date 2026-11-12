// Tests for app/presets.js: setups only pick safe settings, stay inside the bundled skill fields, and match free text sensibly. Run: node app/test/presets.test.mjs
import assert from 'node:assert'
import { PRESETS, FIELD_IDS, SAFE_MODES, getPreset, suggestPreset, planFor, parseSessionHandoff } from '../presets.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }

t('ids are unique and the four jobs are there', () => {
  const ids = PRESETS.map(p => p.id)
  assert.strictEqual(new Set(ids).size, ids.length)
  for (const id of ['school', 'hackathon', 'project', 'startup']) assert.ok(getPreset(id), id)
  assert.strictEqual(getPreset('nope'), null)
})

t('no setup ever chooses Auto or Bypass, and every mode and field is a known one', () => {
  for (const p of PRESETS) {
    assert.ok(SAFE_MODES.includes(p.mode), p.id + ' mode ' + p.mode)
    assert.ok(!['auto', 'bypass'].includes(p.mode))
    for (const f of p.focus) assert.ok(FIELD_IDS.includes(f), p.id + ' field ' + f)
    assert.ok(['split', 'chat', 'ide'].includes(p.layout))
  }
})

t('no setup carries free text that would start a GitHub search', () => {
  for (const p of PRESETS) assert.ok(!('other' in p), p.id)
  for (const p of PRESETS) assert.ok(!('other' in planFor(p.id)))
})

t('starters are short plain sentences, at most three, without markup', () => {
  for (const p of PRESETS) {
    assert.ok(p.starters.length >= 1 && p.starters.length <= 3, p.id)
    for (const s of p.starters) { assert.ok(s.length <= 90, s); assert.ok(!/[<>`]/.test(s), s) }
  }
})

t('planFor cuts skill fields to what the server offers', () => {
  assert.deepStrictEqual(planFor('startup', { catalog: ['web', 'docs'] }).focus, ['web', 'docs'])
  assert.deepStrictEqual(planFor('startup', { catalog: [] }).focus, [])
  assert.deepStrictEqual(planFor('startup').focus, ['web', 'backend', 'docs'])
  assert.strictEqual(planFor('unknown'), null)
})

t('the summary says what will happen, in the person\'s words', () => {
  const s = planFor('school').summary
  assert.ok(/Split view/.test(s) && /explains its plan/.test(s) && /Docs and writing/.test(s), s)
  assert.ok(/no extra skills/.test(planFor('school', { catalog: [] }).summary))
})

t('suggestPreset reads a few words and stays quiet when nothing fits', () => {
  assert.strictEqual(suggestPreset('my chem lab report for the exam'), 'school')
  assert.strictEqual(suggestPreset('weekend hackathon with a demo for the judges'), 'hackathon')
  assert.strictEqual(suggestPreset('an MVP for our startup, first customers'), 'startup')
  assert.strictEqual(suggestPreset('a small tool I am building'), 'project')
  assert.strictEqual(suggestPreset('zzz qqq'), null)
  assert.strictEqual(suggestPreset(''), null)
  assert.strictEqual(suggestPreset(null), null)
})

t('American English only in the visible text', () => {
  const text = JSON.stringify(PRESETS.map(p => [p.name, p.blurb, p.starters]))
  assert.ok(!/colour|behaviour|organis|programme|favour|centre/i.test(text))
  assert.ok(!/\bIDE\b/.test(text))
})


t('parseSessionHandoff detects project entry, redacts keys, and configures 3-pane trio (Ask #314)', () => {
  const h1 = parseSessionHandoff('get me into this project cart-checkout')
  assert.strictEqual(h1.isHandoff, true)
  assert.strictEqual(h1.project, 'cart-checkout')
  assert.strictEqual(h1.layout, 'trio')
  assert.strictEqual(h1.workflow.sidebar, 'off')
  assert.strictEqual(h1.workflow.chat, 'left')
  assert.strictEqual(h1.workflow.editor, 'middle')
  assert.strictEqual(h1.workflow.browser, 'right')

  // Redaction of sensitive credentials
  const h2 = parseSessionHandoff('hey get me into this project with api key sk-1234567890abcdef1234567890 and secret="s3cr3t"')
  assert.strictEqual(h2.isHandoff, true)
  assert.ok(!h2.redactedPrompt.includes('sk-1234567890abcdef1234567890'))
  assert.ok(h2.redactedPrompt.includes('[REDACTED_KEY]'))
  assert.ok(h2.redactedPrompt.includes('password=[REDACTED]'))

  // Negative case
  assert.strictEqual(parseSessionHandoff('explain how this function works').isHandoff, false)
})

console.log(`presets tests passed (${n})`)
