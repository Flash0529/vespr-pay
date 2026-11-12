// Who pays for AI in a shared project or chat (design: the team, 2026-11-04). The person who shares it picks one of three plans:
//   each   everyone pays for their own prompts (the default, and what anyone who has not accepted a plan pays)
//   split  every AI cost is split evenly between the people who accepted; the leftover micro-cents go one at a time in turn,
//          starting with the person who made the chat, so nobody always pays the odd bit
//   one    one person pays for everything: the person who made the chat, or the first person who accepts it and agrees to pay
// A plan only binds people who accepted it, and only for AI used after they accepted; changing the plan asks everyone again.
//   GET  /api/billing/plan?room=           the plan, who accepted, and what you have paid in this room
//   POST /api/billing/plan        { room, mode }            set or change the plan (whoever set it first is its maker)
//   POST /api/billing/plan/accept { room, pay? }            join the plan; pay: true takes on the whole bill of a "one" plan
//   POST /api/billing/plan/leave  { room }                  stop sharing from now on
// Storage: <data>/billing/plans.json (each room's plan versions, newest last).
import fs from 'node:fs'
import path from 'node:path'

export const MODES = ['each', 'split', 'one']
export const MODE_TEXT = { each: 'Each person pays for their own prompts', split: 'Everyone splits every cost evenly', one: 'One person pays for everything' }

export function createCostSharing ({ DATA, identify, roomOk = r => /^[a-z0-9][a-z0-9-]{0,39}$/.test(r), may = null, entries = () => [], markup = 1.3, now = () => Date.now() }) {
  const dir = path.join(DATA, 'billing'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, 'plans.json')
  let plans = {}; try { plans = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  const save = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(plans, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); cache = null }
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
  const bearer = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const readBody = (req, max) => new Promise(resolve => { let s = ''; req.on('data', c => { s += c; if (s.length > max) req.destroy() }); req.on('end', () => resolve(s)); req.on('error', () => resolve('')) })
  const current = room => { const v = plans[room]; return v && v.length ? v[v.length - 1] : null }
  // the plan version in force at a moment, and who had joined it by then (in the order they joined; the maker is first)
  const planAt = (room, ts) => { const v = plans[room]; if (!v) return null; for (let i = v.length - 1; i >= 0; i--) if (v[i].ts <= ts) return v[i]; return null }
  const membersAt = (p, ts) => p.members.filter(m => m.ts <= ts && !(m.left && m.left <= ts)).map(m => m.name)
  // who paid for everything at a moment ("one" plans): kept as a history, so a later payer never pays for earlier prompts
  const payerAt = (p, ts) => { const x = (p.payers || []).find(y => y.from <= ts && !(y.to && y.to <= ts)); return x && membersAt(p, ts).includes(x.name) ? x.name : '' }
  const payerNow = p => { const x = (p.payers || []).find(y => !y.to); return x ? x.name : '' }

  // Every charge, recomputed from the ledger in order (cached until the ledger or a plan changes). The leftover-turn pointer
  // runs per plan version, so the same ledger always gives the same bill.
  let cache = null
  function charges () {
    const all = entries(); if (cache && cache.n === all.length) return cache.by
    cache = { n: all.length, by: bill(all) }; return cache.by
  }
  function bill (list) {
    const by = new Map(); const turn = new Map(); const add = (p, m) => by.set(p, (by.get(p) || 0) + m)
    for (const e of list) {
      const price = Math.round(e.costMicros * markup); const p = e.room ? planAt(e.room, e.ts) : null
      const members = p ? membersAt(p, e.ts) : []
      if (!p || p.mode === 'each' || !members.includes(e.person)) { add(e.person, price); continue }
      if (p.mode === 'one') { add(payerAt(p, e.ts) || e.person, price); continue }
      const n = members.length; const share = Math.floor(price / n); let left = price - share * n
      for (const m of members) add(m, share)
      let k = turn.get(p) || 0; while (left-- > 0) { add(members[k % n], 1); k++ } turn.set(p, k)
    }
    return by
  }
  const spentMicros = person => charges().get(person) || 0
  // who has to have credit for this person to use AI in this room right now
  function payersFor (person, room) {
    const p = room ? current(room) : null; const members = p ? membersAt(p, now()) : []
    if (!p || p.mode === 'each' || !members.includes(person)) return [person]
    if (p.mode === 'one') return [payerAt(p, now()) || person]
    return members
  }

  // the plan as the person sees it, with what they have paid for this chat alone (same rules, only this chat's AI use)
  function view (room, who) {
    const mine = bill(entries().filter(e => e.room === room)).get(who) || 0
    const p = current(room)
    if (!p) return { room, mode: 'each', text: MODE_TEXT.each, maker: '', members: [], payer: '', joined: false, paid_usd: mine / 1e6 }
    const members = membersAt(p, now())
    return { room, mode: p.mode, text: MODE_TEXT[p.mode], maker: p.maker, members, payer: payerNow(p), joined: members.includes(who), needs_payer: p.mode === 'one' && !payerNow(p), paid_usd: mine / 1e6 }
  }

  // payer (mode "one" only): "me" (the maker pays, the default) or "acceptor" (the first person who accepts with pay: true)
  function setPlan (who, room, mode, payer) {
    if (!roomOk(room)) return { code: 400, body: { error: 'bad room' } }
    if (!MODES.includes(mode)) return { code: 400, body: { error: `mode is one of ${MODES.join(', ')}` } }
    const p = current(room)
    if (p && p.maker !== who) return { code: 403, body: { error: `only ${p.maker}, who set this plan, can change it` } }
    const ts = now()
    // a new version: everyone is asked again and the maker is in at once
    const next = { ts, mode, maker: who, payers: mode === 'one' && payer !== 'acceptor' ? [{ name: who, from: ts }] : [], members: [{ name: who, ts }] }
    ;(plans[room] = plans[room] || []).push(next); save()
    return { code: 200, body: view(room, who) }
  }
  function accept (who, room, pay) {
    const p = current(room); if (!p) return { code: 404, body: { error: 'this chat has no shared plan; everyone pays for their own prompts' } }
    const ts = now(); const cur = payerNow(p)
    if (p.mode === 'one' && pay === true && cur && cur !== who) return { code: 409, body: { error: `${cur} already pays for everything` } }
    if (!p.members.some(x => x.name === who && !x.left)) p.members.push({ name: who, ts })
    if (p.mode === 'one' && pay === true && !cur) (p.payers = p.payers || []).push({ name: who, from: ts })
    save(); return { code: 200, body: view(room, who) }
  }
  function leave (who, room) {
    const p = current(room); if (!p) return { code: 404, body: { error: 'no plan' } }
    const m = p.members.find(x => x.name === who && !x.left); if (!m) return { code: 200, body: view(room, who) }
    const ts = now(); m.left = ts; for (const x of p.payers || []) if (x.name === who && !x.to) x.to = ts
    save(); return { code: 200, body: view(room, who) }
  }

  return {
    spentMicros, payersFor, view, setPlan, accept, leave,
    http (req, res) {
      const u = new URL(req.url, 'http://x')
      if (!u.pathname.startsWith('/api/billing/plan')) return false
      const who = identify(bearer(req)); if (!who) { json(res, 401, { error: 'sign in' }); return true }
      if (u.pathname === '/api/billing/plan' && req.method === 'GET') { const room = String(u.searchParams.get('room') || ''); if (!roomOk(room)) json(res, 400, { error: 'bad room' }); else if (may && !may(who, room, 'view')) json(res, 403, { error: 'not a member of this workspace' }); else json(res, 200, view(room, who)); return true }
      if (req.method !== 'POST') { json(res, 405, { error: 'POST' }); return true }
      readBody(req, 2048).then(raw => {
        let b = {}; try { b = JSON.parse(raw || '{}') } catch {}
        const room = String(b.room || '')
        if (may && roomOk(room) && !may(who, room, u.pathname === '/api/billing/plan' ? 'manage' : 'view')) return json(res, 403, { error: u.pathname === '/api/billing/plan' ? 'only the owner or a manager sets who pays' : 'not a member of this workspace' }) // server/access.js
        const r = u.pathname === '/api/billing/plan' ? setPlan(who, room, b.mode, b.payer)
          : u.pathname === '/api/billing/plan/accept' ? accept(who, room, b.pay)
            : u.pathname === '/api/billing/plan/leave' ? leave(who, room) : { code: 404, body: { error: 'not found' } }
        json(res, r.code, r.body)
      })
      return true
    }
  }
}
