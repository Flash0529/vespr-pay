// Sidebar pulse card (app/pulse.js): cards come only from real signals; no invented percentages, metrics or suggestions; dismissals stick.
import assert from 'node:assert'
import { buildCards, suggestAgent, createPulseStore, SUGGEST_MIN_STARTS, DISMISS_MS } from '../pulse.js'

const NOW = 1_800_000_000_000; const H = 3600_000; const D = 24 * H
const starts = (...agents) => agents.map((agent, i) => ({ agent, ts: NOW - (i + 1) * H }))

// ---- nothing real, nothing shown
assert.deepStrictEqual(buildCards({}, NOW), []); assert.deepStrictEqual(buildCards(null, NOW), []); assert.deepStrictEqual(buildCards(undefined, NOW), [])
assert.deepStrictEqual(buildCards({ approvals: 'x', working: 5, history: {}, hosting: 'lots' }, NOW), [], 'wrong shapes are ignored, not guessed')

// ---- an approval is an update card that opens its chat, and outranks everything
const all = buildCards({
  approvals: [{ key: 'a1', agentId: 'planner', agentName: 'planner', convId: 'c9', text: 'run the tests' }],
  working: [{ key: 'w1', agentId: 'coder', agentName: 'coder', convId: 'c1', text: 'editing cart.py', done: 2, total: 5 }],
  hosting: { purchases: 12, windowDays: 7 }, history: starts('tutor', 'tutor', 'tutor', 'coder'), currentAgent: 'coder', agents: { tutor: 'tutor' }
}, NOW)
assert.deepStrictEqual(all.map(c => c.type), ['update', 'progress', 'metric', 'suggest'], 'approval, progress, metric, suggestion in that order')
assert.deepStrictEqual(all[0].action, { kind: 'open-conv', id: 'c9' }); assert.strictEqual(all[0].title, 'planner needs your approval')
assert.deepStrictEqual(all[1].progress, { done: 2, total: 5, pct: 40 })
assert.strictEqual(all[2].title, '12 purchases'); assert.strictEqual(all[2].detail, 'last 7 days on your hosting')
assert.deepStrictEqual(all[3].action, { kind: 'new-agent-chat', id: 'tutor' }); assert.strictEqual(all[3].title, 'Start a new chat with tutor')

// ---- a progress BAR needs a real done/total; otherwise it is a plain update with no bar
for (const bad of [{}, { done: 1 }, { total: 4 }, { done: 5, total: 4 }, { done: -1, total: 4 }, { done: 1, total: 0 }, { done: NaN, total: 4 }, { done: '2', total: '4' }, { done: Infinity, total: 4 }]) {
  const c = buildCards({ working: [{ key: 'w', agentName: 'coder', text: 'busy', ...bad }] }, NOW)[0]; assert.strictEqual(c.type, 'update', JSON.stringify(bad)); assert.strictEqual(c.progress, null)
}
assert.strictEqual(buildCards({ working: [{ key: 'w', agentName: 'coder', done: 0, total: 3 }] }, NOW)[0].progress.pct, 0)
assert.strictEqual(buildCards({ working: [{ key: 'w', agentName: 'coder', done: 3, total: 3 }] }, NOW)[0].progress.pct, 100)

// ---- a metric needs a finite, non-negative count from real telemetry (zero is real; unknown is not shown)
for (const bad of [null, undefined, {}, { purchases: null }, { purchases: NaN }, { purchases: '5' }, { purchases: -1 }, { purchases: Infinity }]) assert.deepStrictEqual(buildCards({ hosting: bad }, NOW), [], JSON.stringify(bad))
assert.strictEqual(buildCards({ hosting: { purchases: 0 } }, NOW)[0].title, '0 purchases'); assert.strictEqual(buildCards({ hosting: { purchases: 1, windowDays: 1 } }, NOW)[0].detail, 'last 1 day on your hosting')

// ---- the suggestion: repeated real use only
assert.strictEqual(suggestAgent([], NOW), null); assert.strictEqual(suggestAgent(starts('coder', 'coder'), NOW), null, `fewer than ${SUGGEST_MIN_STARTS} starts is not a habit`)
assert.deepStrictEqual(suggestAgent(starts('coder', 'coder', 'coder'), NOW), { agent: 'coder', count: 3, of: 3 })
assert.strictEqual(suggestAgent(starts('coder', 'tutor', 'reviewer', 'planner', 'coder', 'tutor', 'coder'), NOW), null, '3 of 7 is under half: no clear favourite')
assert.strictEqual(suggestAgent(starts('coder', 'coder', 'coder'), NOW, 'coder'), null, 'already talking to it: nothing to suggest')
assert.strictEqual(suggestAgent(starts('coder', 'coder', 'coder').map(e => ({ ...e, ts: e.ts - 40 * D })), NOW), null, 'older than 30 days does not count')
assert.strictEqual(suggestAgent(starts('coder', 'coder', 'coder').map(e => ({ ...e, ts: NOW + D })), NOW), null, 'a start from the future is not trusted')
assert.strictEqual(suggestAgent([{ agent: 5, ts: NOW }, { agent: '', ts: NOW }, null, { agent: 'a' }, { agent: 'a', ts: 'x' }], NOW), null, 'damaged history is ignored')

// ---- dismissal hides a card until its time is up; each kind has its own quiet period
const base = { approvals: [{ key: 'a1', agentName: 'planner', convId: 'c9' }] }
assert.strictEqual(buildCards({ ...base, dismissed: { 'u:a1': NOW + H } }, NOW).length, 0); assert.strictEqual(buildCards({ ...base, dismissed: { 'u:a1': NOW - 1 } }, NOW).length, 1, 'expired dismissal: back')
assert.ok(DISMISS_MS.suggest > DISMISS_MS.update, 'a declined suggestion stays away longer than an approval request')

// ---- text from agents cannot inject markup or control characters into the card, and is bounded
const hostile = buildCards({ approvals: [{ key: 'k', agentName: 'x'.repeat(500), text: '\u0000bad\u0007\ntext' }] }, NOW)[0]
assert.ok(hostile.title.length <= 80 && hostile.detail.length <= 90 && !/[\u0000-\u001f]/.test(hostile.detail))

// ---- the local store: starts hold an agent id and a time only; capped; survives damage and blocked storage; dismissals persist
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, v), raw: m } }
{
  const st = mem(); const a = createPulseStore(st)
  for (let i = 0; i < 60; i++) a.recordStart('coder', NOW + i); assert.strictEqual(a.history().length, 50, 'history is capped')
  a.recordStart('', NOW); a.recordStart(5, NOW); assert.strictEqual(a.history().length, 50, 'junk is not recorded')
  assert.ok(!/message|text|prompt/i.test(st.raw.get('vespr.pulse.v1')), 'no message text is stored')
  const card = { key: 'p:x', type: 'progress' }; a.dismiss(card, NOW); assert.strictEqual(createPulseStore(st).dismissed()['p:x'], NOW + DISMISS_MS.progress, 'a new page load still sees the dismissal')
  a.clear(); assert.deepStrictEqual(createPulseStore(st).history(), [])
  st.setItem('vespr.pulse.v1', '{not json'); assert.deepStrictEqual(createPulseStore(st).history(), [])
  st.setItem('vespr.pulse.v1', JSON.stringify({ history: [{ agent: 'a', ts: 1 }, { agent: 5 }, null], dismissed: { ok: 5, bad: 'x', '': 1 } })); const s = createPulseStore(st); assert.deepStrictEqual(s.history(), [{ agent: 'a', ts: 1 }]); assert.deepStrictEqual(s.dismissed(), { ok: 5 })
  const blocked = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }; const b = createPulseStore(blocked); b.recordStart('coder', NOW); assert.strictEqual(b.history().length, 1)
}
console.log('pulse tests passed')
