// The agent's side of the usage ledger (server/usage-ledger.js): every model call is reported with who it was for, never with a price.
// Reporting never gets in the way of the work: it runs in the background, retries a server that is down, and only logs if it gives up.
//   const report = createLedgerReporter({ server, token }); report({ person, room, feature, model, usage })
//   usage = llm.lastUsage or the estimate: { prompt, completion, cached?, estimated? }
import { randomUUID } from 'node:crypto'

export function createLedgerReporter ({ server, token, fetchImpl = globalThis.fetch, retryMs = [1000, 5000, 20000], log = m => console.error(m), id = () => 'u-' + randomUUID() }) {
  const url = String(server).replace(/^ws/, 'http').replace(/\/$/, '') + '/api/usage/record'
  return function report ({ person, room, feature, model, usage }) {
    if (!usage || !person) return null
    const body = { id: id(), room: room || '', person, feature, model: String(model || 'unknown'), input: Math.max(0, Math.round(usage.prompt || 0)), cached: Math.max(0, Math.round(usage.cached || 0)), output: Math.max(0, Math.round(usage.completion || 0)), estimated: !!usage.estimated }
    if (body.cached > body.input) body.cached = body.input
    const send = attempt => Promise.resolve().then(() => fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }))
      .then(r => { if (r.status >= 500) throw new Error('server ' + r.status); if (!r.ok) log(`usage not recorded (HTTP ${r.status}): ${body.feature} for ${body.person}`) })
      .catch(e => { if (attempt < retryMs.length) setTimeout(() => send(attempt + 1), retryMs[attempt]); else log(`usage not recorded after ${retryMs.length + 1} tries: ${e.message}`) })
    send(0)
    return body.id
  }
}

// The paywall: before a model call on someone's behalf the agent asks the server whether they still have usage
// (GET /api/billing/allowance, agent tokens only). A yes is kept for okMs and a no for noMs, so buying more unlocks within seconds.
// If the server cannot answer, the call goes ahead and the miss is logged: the ledger still records it, so nothing goes unbilled.
//   const allowed = createPaywall({ server, token }); if (!(await allowed(person, room)).ok) room.limit(person, LIMIT)
// The room matters in a shared chat: whoever pays there (cost-sharing.js) needs credit, not only the person asking.
export const LIMIT = { title: 'Usage limit reached', detail: 'Get more usage to keep working' }
export function createPaywall ({ server, token, fetchImpl = globalThis.fetch, okMs = 30000, noMs = 5000, now = () => Date.now(), log = m => console.error(m) }) {
  const base = String(server).replace(/^ws/, 'http').replace(/\/$/, '')
  const seen = new Map()
  return async function allowed (person, room = '') {
    if (!person) return { ok: true } // nobody to bill (a system task): the ledger books it to the room
    const key = person + '|' + room; const hit = seen.get(key); if (hit && now() < hit.until) return hit.v
    try {
      const r = await fetchImpl(`${base}/api/billing/allowance?person=${encodeURIComponent(person)}&room=${encodeURIComponent(room)}`, { headers: { Authorization: 'Bearer ' + token } })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      const j = await r.json(); const v = { ok: j.ok === true }
      seen.set(key, { v, until: now() + (v.ok ? okMs : noMs) }); if (seen.size > 1000) seen.delete(seen.keys().next().value)
      return v
    } catch (e) { log(`usage check failed for ${person} (${e.message}); answering anyway`); return { ok: true, unchecked: true } }
  }
}
