// The sidebar "pulse" card: ONE small box that shows the most useful thing right now, and only from data that exists.
// the team, 2026-11-10: it can be a chat update to click into, a progress/completion bar, a metric (e.g. purchases when the person uses our hosting), or the
// chat the person is most likely to want next (an agent they keep using, as a button that opens a fresh chat with it).
// Rules kept here (tested): a card is built only from a real signal; a determinate bar needs a real done/total (never a made-up percentage); a metric
// needs a finite count from real telemetry; a suggestion needs repeated real use. Anything else is simply not shown. Dismissals are remembered.
// This is rule-based and local: nothing is sent anywhere. An AI-chosen card would need a server endpoint that returns cards in this same shape.

export const SUGGEST_MIN_STARTS = 3
export const SUGGEST_MIN_SHARE = 0.5
export const SUGGEST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
export const HISTORY_MAX = 50
const DAY = 24 * 60 * 60 * 1000
export const DISMISS_MS = { update: 2 * 60 * 60 * 1000, progress: 2 * 60 * 60 * 1000, metric: DAY, suggest: 7 * DAY }

const str = (v, n = 80) => typeof v === 'string' && v.length > 0 && v.length <= n
const num = v => typeof v === 'number' && Number.isFinite(v)
const clip = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n)

// signals: { approvals:[{key,agentId,agentName,convId,text}], working:[{key,agentId,agentName,convId,text,done,total}],
//            history:[{agent,ts}], currentAgent, hosting:{purchases,windowDays}|null, agents:{id:name}, dismissed:{key:untilTs} }
export function buildCards (signals = {}, now = Date.now()) {
  const s = signals && typeof signals === 'object' ? signals : {}
  const cards = []
  for (const a of Array.isArray(s.approvals) ? s.approvals : []) {
    if (!str(a && a.key)) continue
    cards.push({ key: 'u:' + a.key, type: 'update', rank: 1, agentId: a.agentId || null, title: clip((a.agentName || 'An agent') + ' needs your approval', 80), detail: clip(a.text, 90), action: a.convId ? { kind: 'open-conv', id: String(a.convId) } : { kind: 'none' } })
  }
  for (const w of Array.isArray(s.working) ? s.working : []) {
    if (!str(w && w.key)) continue
    const bar = num(w.done) && num(w.total) && w.total > 0 && w.done >= 0 && w.done <= w.total
    cards.push({ key: 'p:' + w.key, type: bar ? 'progress' : 'update', rank: 2, agentId: w.agentId || null, title: clip((w.agentName || 'An agent') + ' is working', 80), detail: clip(w.text, 90), progress: bar ? { done: w.done, total: w.total, pct: Math.round(100 * w.done / w.total) } : null, action: w.convId ? { kind: 'open-conv', id: String(w.convId) } : { kind: 'none' } })
  }
  const h = s.hosting
  if (h && num(h.purchases) && h.purchases >= 0) {
    const days = num(h.windowDays) && h.windowDays > 0 ? Math.round(h.windowDays) : 7
    cards.push({ key: 'm:purchases', type: 'metric', rank: 3, title: `${Math.round(h.purchases)} purchase${Math.round(h.purchases) === 1 ? '' : 's'}`, detail: `last ${days} day${days === 1 ? '' : 's'} on your hosting`, action: { kind: 'open-hosting' } })
  }
  const sug = suggestAgent(s.history, now, s.currentAgent)
  if (sug) {
    const name = (s.agents && s.agents[sug.agent]) || sug.agent
    cards.push({ key: 's:' + sug.agent, type: 'suggest', rank: 4, agentId: sug.agent, title: clip('Start a new chat with ' + name, 80), detail: `you used it ${sug.count} of your last ${sug.of} chats`, action: { kind: 'new-agent-chat', id: sug.agent }, label: 'Start chat' })
  }
  const dismissed = s.dismissed && typeof s.dismissed === 'object' ? s.dismissed : {}
  return cards.filter(c => !(num(dismissed[c.key]) && dismissed[c.key] > now)).sort((a, b) => a.rank - b.rank)
}

// the agent the person starts chats with again and again (real history only; needs enough starts and a clear majority)
export function suggestAgent (history, now = Date.now(), currentAgent = null) {
  const recent = (Array.isArray(history) ? history : []).filter(e => e && str(e.agent) && num(e.ts) && e.ts <= now && now - e.ts <= SUGGEST_WINDOW_MS).sort((a, b) => b.ts - a.ts).slice(0, 20)
  if (recent.length < SUGGEST_MIN_STARTS) return null
  const counts = new Map(); for (const e of recent) counts.set(e.agent, (counts.get(e.agent) || 0) + 1)
  const [agent, count] = [...counts.entries()].sort((a, b) => b[1] - a[1] || (recent.findIndex(e => e.agent === a[0]) - recent.findIndex(e => e.agent === b[0])))[0]
  if (count < SUGGEST_MIN_STARTS || count / recent.length < SUGGEST_MIN_SHARE || agent === currentAgent) return null
  return { agent, count, of: recent.length }
}

// ---- local, private storage: chat starts (agent id + time only, no message text) and dismissals
export function createPulseStore (storage, key = 'vespr.pulse.v1') {
  const read = () => { try { const o = JSON.parse(storage.getItem(key) || '{}'); return { history: (Array.isArray(o.history) ? o.history : []).filter(e => e && str(e.agent) && num(e.ts)).slice(-HISTORY_MAX), dismissed: o.dismissed && typeof o.dismissed === 'object' ? Object.fromEntries(Object.entries(o.dismissed).filter(([k, v]) => str(k, 120) && num(v))) : {} } } catch { return { history: [], dismissed: {} } } }
  let db = read()
  const write = () => { try { storage.setItem(key, JSON.stringify(db)) } catch { /* blocked storage: lasts until reload */ } }
  return {
    recordStart (agent, now = Date.now()) { if (!str(agent)) return; db.history = [...db.history, { agent, ts: now }].slice(-HISTORY_MAX); write() },
    dismiss (card, now = Date.now()) { if (!card || !str(card.key, 120)) return; db.dismissed[card.key] = now + (DISMISS_MS[card.type] || DAY); for (const [k, v] of Object.entries(db.dismissed)) if (v <= now) delete db.dismissed[k]; write() },
    history: () => db.history.slice(),
    dismissed: () => ({ ...db.dismissed }),
    clear () { db = { history: [], dismissed: {} }; write() }
  }
}
