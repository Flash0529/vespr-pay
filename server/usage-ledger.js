// Usage ledger: what each person's AI use cost, kept on the server.
// The room's `usage` map is a live meter only: every member's browser can write it, so nothing is billed from it.
//   POST /api/usage/record   agents only (a static agent token named in VESPR_LEDGER_WRITERS): { id, room, person, feature, model,
//                            input, cached, output, estimated }. The server prices the entry from its own table; an agent never
//                            sends a cost. The id makes a retried report count once.
//   GET  /api/usage/me?days=30   the caller's own usage: tokens and price by day, feature, agent and model, at provider cost × markup
// Storage: <data>/ledger/YYYY-MM.jsonl, append-only, one entry per model call, folder 0700 / files 0600.
import fs from 'node:fs'
import path from 'node:path'

// US dollars per million tokens, Nebius Token Factory catalog, checked 2026-11-04 (tokenfactory.nebius.com/model-catalog.md).
// <data>/prices.json, when present, replaces this table (a daily sync can write it); an unknown model is billed at the dearest one.
export const DEFAULT_PRICES = {
  'nvidia/nemotron-3-super-120b-a12b': { input: 0.30, cached: 0.06, output: 0.90 },
  'nvidia/nemotron-3_5-lightning': { input: 0.06, cached: 0.03, output: 0.24 },
  'nvidia/nvidia-nemotron-3-nano-30b-a3b': { input: 0.06, cached: 0.012, output: 0.24 },
  'nvidia/nemotron-3-ultra-550b-a55b': { input: 1.00, cached: 0.12, output: 3.00 }
}
export const FEATURES = ['agent', 'plan', 'suggest', 'other']
const MAX_TOKENS = 5_000_000
const int = v => (Number.isInteger(v) && v >= 0 && v <= MAX_TOKENS ? v : null)

// cost in micro-dollars: a price per million tokens is a price in micro-dollars per token
export function priceEntry (prices, { model, input, cached, output }) {
  const table = Object.fromEntries(Object.entries(prices).map(([k, v]) => [k.toLowerCase(), v]))
  let p = table[String(model).toLowerCase()]; let unknownModel = false
  if (!p) { unknownModel = true; p = Object.values(table).reduce((a, b) => (b.input + b.output > a.input + a.output ? b : a)) } // never undercharge
  const costMicros = (input - cached) * p.input + cached * p.cached + output * p.output
  return { costMicros: Math.round(costMicros * 1000) / 1000, unknownModel }
}

export function createLedger ({ DATA, identify, isWriter, markup = Number(process.env.VESPR_MARKUP || 1.3), now = () => Date.now() }) {
  const dir = path.join(DATA, 'ledger'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const prices = () => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'prices.json'), 'utf8')) } catch { return DEFAULT_PRICES } }
  const entries = []; const ids = new Set()
  for (const f of fs.readdirSync(dir).filter(n => /^\d{4}-\d{2}\.jsonl$/.test(n)).sort()) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) { if (!line) continue; try { const e = JSON.parse(line); entries.push(e); ids.add(e.id) } catch {} }
  }
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
  const bearer = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '')

  function record (writer, b) {
    if (!b || typeof b !== 'object') return { code: 400, body: { error: 'expected a JSON object' } }
    const id = typeof b.id === 'string' && /^[\w-]{8,80}$/.test(b.id) ? b.id : null
    const person = typeof b.person === 'string' && b.person.trim() ? b.person.trim().slice(0, 60) : null
    const [input, cached, output] = [int(b.input), int(b.cached ?? 0), int(b.output)]
    if (!id || !person || input === null || cached === null || output === null || cached > input || typeof b.model !== 'string' || !b.model || b.model.length > 100) {
      return { code: 400, body: { error: 'needs id, person, model, and whole token counts (cached no more than input)' } }
    }
    if (ids.has(id)) return { code: 200, body: { ok: true, duplicate: true } }
    const feature = FEATURES.includes(b.feature) ? b.feature : 'other'
    const { costMicros, unknownModel } = priceEntry(prices(), { model: b.model, input, cached, output })
    const ts = now(); const e = { id, ts, room: String(b.room || '').slice(0, 40), person, agent: writer, feature, model: b.model, input, cached, output, estimated: !!b.estimated, costMicros, ...(unknownModel ? { unknownModel } : {}) }
    const file = path.join(dir, new Date(ts).toISOString().slice(0, 7) + '.jsonl')
    fs.appendFileSync(file, JSON.stringify(e) + '\n', { mode: 0o600 })
    entries.push(e); ids.add(id)
    return { code: 201, body: { ok: true, costMicros } }
  }

  function usageFor (person, days) {
    const since = now() - days * 86_400_000
    const add = (o, k, e) => { const x = o[k] || (o[k] = { calls: 0, input: 0, cached: 0, output: 0, price_usd: 0 }); x.calls++; x.input += e.input; x.cached += e.cached; x.output += e.output; x.price_usd += e.costMicros * markup / 1e6 }
    const total = {}; const byDay = {}; const byFeature = {}; const byAgent = {}; const byModel = {}
    for (const e of entries) {
      if (e.person !== person || e.ts < since) continue
      add(total, 'all', e); add(byDay, new Date(e.ts).toISOString().slice(0, 10), e); add(byFeature, e.feature, e); add(byAgent, e.agent, e); add(byModel, e.model, e)
    }
    const round = o => { for (const v of Object.values(o)) v.price_usd = Math.round(v.price_usd * 1e6) / 1e6; return o }
    return { person, days, markup, total: round(total).all || { calls: 0, input: 0, cached: 0, output: 0, price_usd: 0 }, byDay: round(byDay), byFeature: round(byFeature), byAgent: round(byAgent), byModel: round(byModel) }
  }

  return {
    record, usageFor, get size () { return entries.length }, markup,
    all: () => entries, // read-only use: cost-sharing.js bills shared chats from it
    // everything this person has used, at the price they pay (cost x markup), in micro-dollars: what billing subtracts from credit
    spentMicros (person) { let s = 0; for (const e of entries) if (e.person === person) s += e.costMicros * markup; return Math.round(s) },
    http (req, res) {
      const u = new URL(req.url, 'http://x')
      if (u.pathname === '/api/usage/record' && req.method === 'POST') {
        const token = bearer(req); const who = token && identify(token)
        if (!who) { json(res, 401, { error: 'sign in' }); return true }
        if (!isWriter(token)) { json(res, 403, { error: 'only agents record usage' }); return true }
        let raw = ''; req.on('data', c => { raw += c; if (raw.length > 4096) req.destroy() })
        req.on('end', () => { let b = null; try { b = JSON.parse(raw) } catch {} const r = record(who, b); json(res, r.code, r.body) })
        return true
      }
      if (u.pathname === '/api/usage/me' && req.method === 'GET') {
        const who = identify(bearer(req)); if (!who) { json(res, 401, { error: 'sign in' }); return true }
        const days = Math.min(92, Math.max(1, Number(u.searchParams.get('days')) || 30))
        json(res, 200, usageFor(who, days)); return true
      }
      return false
    }
  }
}
