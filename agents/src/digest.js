// Catch-up digest: "what did I miss?" Facts come straight from the shared document (chat, approvals, commands, and the
// authorship attributes on the text), so the summary is about what really happened, not a guess.
const fmtAgo = ms => { const m = Math.round(ms / 60000); return m < 1 ? 'under a minute' : m < 90 ? `${m} min` : `${Math.round(m / 60)} h` }
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s).replace(/\s+/g, ' ')

export function collectFacts (room, user, since) {
  const events = []
  for (const m of room.chat.toArray()) {
    const ts = m.get('ts'); if (ts < since) continue
    const who = m.get('author'); const text = m.get('text') ? m.get('text').toString() : ''
    const role = m.get('role') || 'user'
    if (who === user && role !== 'approval') continue
    if (role === 'user' || role === 'agent') { if (text) events.push({ ts, f: `${who} ${role === 'agent' ? 'replied' : 'said'}: ${clip(text, 110)}` }) }
    else if (role === 'approval') { const st = m.get('status'); if (st === 'approved' || st === 'denied') events.push({ ts, f: `${m.get('decidedBy')} ${st} "${clip(text, 80)}"` }) }
    else if (role === 'payment') { const st = m.get('status'); if (st && st !== 'pending') events.push({ ts, f: clip(text, 150) }) } // a PayPal sandbox payment request that has an outcome (server/pay.js): the card's own summary line says who asked, who approved and what happened
    else if (role === 'tool') {
      const mode = /set the agent mode to (\w+)/.exec(text); if (mode) events.push({ ts, f: `${who} switched agents to ${mode[1]} mode` })
      const cmd = /^\$ (.+)\n[\s\S]*\[exit (-?\d+)\]$/.exec(text); if (cmd) events.push({ ts, f: `${who} ran \`${clip(cmd[1], 60)}\` (exit ${cmd[2]})` })
    }
  }
  events.sort((a, b) => a.ts - b.ts)
  // edits by other people and agents since then, from the authorship attributes: who touched which file, roughly how much
  const edits = []
  for (const [file, text] of room.files) {
    const per = new Map()
    for (const op of text.toDelta()) {
      const a = op.attributes; if (typeof op.insert !== 'string' || !a || !a.by || a.by === 'import' || a.by === user || (a.t || 0) * 60000 < since - 60000) continue
      per.set(a.by, (per.get(a.by) || 0) + op.insert.split('\n').length - (op.insert.endsWith('\n') ? 1 : 0) + (op.insert.includes('\n') ? 0 : 1))
    }
    for (const [by, lines] of per) edits.push(`${by} changed ${file} (about ${Math.max(1, lines)} line${lines === 1 ? '' : 's'})`)
  }
  return [...events.map(e => e.f), ...edits]
}

export async function catchUp ({ room, llm, msg }) {
  const user = msg.get('author')
  const since = msg.get('since') || room.seen.get(user) || Date.now() - 30 * 60_000
  const facts = collectFacts(room, user, since)
  const head = `Catch-up for ${user} (you were away ${fmtAgo(Date.now() - since)}):\n`
  const out = room.say('')
  if (!facts.length) return out.append(head + '- Nothing happened while you were away.')
  let body
  if (llm.constructor.name === 'Mock') body = facts.map(f => `- ${f}`).join('\n') + '\n(demo mode: a plain list; with a model key this becomes a short summary)'
  else {
    body = await llm.once({
      maxTokens: 260,
      messages: [
        { role: 'system', content: 'You write catch-up notes for a developer who was away from a shared coding workspace. Use 3 to 6 short bullets, plain language, most important first. Name who did what and which files. Do not invent anything beyond the facts.' },
        { role: 'user', content: `${user} was away ${fmtAgo(Date.now() - since)}. Facts, oldest first:\n${facts.map(f => `- ${f}`).join('\n')}` }
      ]
    }).catch(() => facts.map(f => `- ${f}`).join('\n'))
  }
  room.addUsage(room.name, llm.lastUsage || { prompt: Math.ceil(facts.join('').length / 4), completion: Math.ceil(body.length / 4) })
  out.append(head + body)
}
