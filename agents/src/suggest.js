// Inline suggestions ("suggestive filling in"), teammate-aware: besides the text around the cursor, the prompt carries what
// teammates and agents just did and the latest chat, so a suggestion fits the live session, not just the file.
import http from 'node:http'
import fs from 'node:fs'
import { LIMIT } from './ledger.js'

const FENCE = /^```[\w-]*\n?|\n?```$/g

// What else is going on in the room, as short facts, newest first. `used` names the signals so the UI can say so.
export function teammateFacts (room, user, file) {
  const facts = []; const used = new Set(); const now = Date.now()
  for (const m of room.provenance.toArray().slice(-3).reverse()) {
    if (m.get('by') === user || now - m.get('ts') > 10 * 60_000) continue
    facts.push(`${m.get('by')} ${m.get('summary')}`); used.add(`${m.get('by')}'s edit`)
  }
  for (const m of room.chat.toArray().slice(-6).reverse()) {
    if (m.get('role') === 'tool' || m.get('role') === 'approval') continue
    const text = m.get('text') ? m.get('text').toString() : ''
    if (text && m.get('author') !== user) { facts.push(`${m.get('author')} said: ${text.slice(0, 120)}`); used.add('chat'); break }
  }
  for (const [, s] of room.provider.awareness.getStates()) {
    if (s.user && s.user.name !== user && s.cursor && s.cursor.file === file) { facts.push(`${s.user.name} is also editing ${file}`); used.add(`${s.user.name}'s cursor`) }
  }
  return { facts: facts.slice(0, 5), used: [...used] }
}

const cleanup = (text, suffix) => {
  let t = (text || '').replace(FENCE, '').replace(/\s+$/, '')
  const lines = t.split('\n'); if (lines.length > 12) t = lines.slice(0, 12).join('\n')
  const head = suffix.slice(0, 40).split('\n')[0]; if (head && t.endsWith(head)) t = t.slice(0, -head.length) // do not repeat what is already after the cursor
  return t.slice(0, 600)
}

export async function suggest ({ room, llm, model, user, file, language, prefix, suffix, budget, ledger, paywall }) {
  if (budget && budget.exhausted()) return { text: '', model: model || llm.label, used: [], budget: 'exhausted' }
  if (paywall && !(await paywall(user, room.roomName)).ok) return { text: '', model: model || llm.label, used: [], limit: LIMIT } // out of usage: no model call
  const { facts, used } = teammateFacts(room, user, file)
  let raw
  if (typeof llm.once === 'function' && llm.constructor.name === 'Mock') raw = await llm.once({ kind: 'suggest', prefix, suffix, facts })
  else {
    const context = facts.length ? `Live context from the team:\n${facts.map(f => `- ${f}`).join('\n')}\n\n` : ''
    raw = await llm.once({
      model, maxTokens: 120, stop: ['\n\n\n'],
      messages: [
        { role: 'system', content: 'You complete code. Reply with ONLY the text to insert at <CURSOR>: no explanation, no code fences, no repeating the surrounding code. Keep it short (usually one to five lines) and match the file\'s style.' },
        { role: 'user', content: `${context}File: ${file} (${language})\n\n${prefix.slice(-3000)}<CURSOR>${suffix.slice(0, 800)}` }
      ]
    })
  }
  const text = cleanup(raw, suffix)
  const spent = llm.lastUsage || { prompt: Math.ceil((prefix.length + suffix.length) / 4), completion: Math.ceil(text.length / 4), estimated: true }
  room.addUsage(`suggest:${user}`, spent); if (budget) budget.spend(spent.prompt + spent.completion)
  if (ledger) ledger({ person: user, room: room.roomName, feature: 'suggest', model: model || llm.label, usage: spent })
  return { text, model: model || llm.label, used: text ? used : [] }
}

// HTTP endpoint (inside the compose network; the realtime server proxies it). Callers authenticate with their VESPR token.
export function startSuggestServer ({ room, llm, model, port = 8242, tokensFile, extra, budget, ledger, paywall }) {
  const tokens = () => { const m = new Map(); try { for (const l of fs.readFileSync(tokensFile, 'utf8').split('\n')) { const i = l.indexOf(':'); if (i > 0) m.set(l.slice(i + 1).trim(), l.slice(0, i).trim()) } } catch {} return m }
  const cache = new Map()
  const srv = http.createServer((req, res) => {
    if (extra && extra(req, res)) return // e.g. /preview/<token>/ , which carries its own token
    const user = tokens().get((req.headers.authorization || '').replace(/^Bearer\s+/i, ''))
    if (req.method !== 'POST' || req.url !== '/suggest' || !user) { res.writeHead(user ? 404 : 401); return res.end() }
    let body = ''; req.on('data', c => { body += c; if (body.length > 20000) req.destroy() })
    req.on('end', async () => {
      try {
        const a = JSON.parse(body)
        const key = `${user}|${a.file}|${a.prefix.slice(-400)}|${a.suffix.slice(0, 100)}`
        const hit = cache.get(key); if (hit && Date.now() - hit.at < 60_000) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(hit.v)) }
        const v = await suggest({ room, llm, model, user, file: String(a.file || ''), language: String(a.language || ''), prefix: String(a.prefix || ''), suffix: String(a.suffix || ''), budget, ledger, paywall })
        cache.set(key, { at: Date.now(), v }); if (cache.size > 200) cache.delete(cache.keys().next().value)
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v))
      } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message).slice(0, 120) })) }
    })
  })
  srv.listen(port, '0.0.0.0')
  return srv
}
