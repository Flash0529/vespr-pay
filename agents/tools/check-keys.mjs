// Checks the keys in the env file WITHOUT printing them: prints HTTP status codes and the Nemotron model ids the account can use.
//   node tools/check-keys.mjs [path/to/env-file]     (default: $NEBIUS_ENV_FILE, else ./.env)
import fs from 'node:fs'
const file = process.argv[2] || process.env.NEBIUS_ENV_FILE || '.env'
const env = {}
try { for (const l of fs.readFileSync(file, 'utf8').split('\n')) { const m = /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(l); if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '') } } catch { console.log(`no env file at ${file}`); process.exit(1) }
const base = (env.NEBIUS_BASE_URL || 'https://api.tokenfactory.nebius.com/v1').replace(/\/$/, '')
if (!env.NEBIUS_API_KEY) console.log('NEBIUS_API_KEY: not set yet (agent stays in demo mode)')
else {
  const r = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${env.NEBIUS_API_KEY}` } })
  console.log(`NEBIUS_API_KEY: HTTP ${r.status}${r.status === 401 ? ' (key rejected)' : ''}`)
  if (r.ok) { const ids = ((await r.json()).data || []).map(m => m.id); const n = ids.filter(i => /nemotron/i.test(i)); console.log(`models visible: ${ids.length}; Nemotron: ${n.length ? n.join(', ') : 'none (set NEBIUS_MODEL to an NVIDIA model id)'}`) }
}
if (!env.TAVILY_API_KEY) console.log('TAVILY_API_KEY: not set (web search tool stays off)')
else {
  const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TAVILY_API_KEY}` }, body: JSON.stringify({ query: 'nebius token factory', max_results: 1 }) })
  console.log(`TAVILY_API_KEY: HTTP ${r.status}${r.status === 401 ? ' (key rejected)' : ''}`)
}
