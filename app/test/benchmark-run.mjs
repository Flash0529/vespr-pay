import { createTelemetryCollector } from '../telemetry-bench.js'
import { findMatches } from '../search.js'
import { searchPhotoAssets, generatePairedMeta } from '../photo-asset-pipeline.js'
import fs from 'node:fs'

const col = createTelemetryCollector()
const sampleCode = fs.readFileSync('./app/prototype.html', 'utf8')

// Sample photo assets with paired metadata
const sampleAssets = [
  { path: 'assets/asset-photo-20261105-dashboard.png', meta: generatePairedMeta('assets/asset-photo-20261105-dashboard.png', { description: 'Metrics dashboard with revenue charts', tags: ['dashboard', 'metrics', 'revenue'], ocrTokens: ['growth', 'mrr', 'arr', '99%'] }) },
  { path: 'assets/asset-photo-20261105-login.png', meta: generatePairedMeta('assets/asset-photo-20261105-login.png', { description: 'Authentication sign in page with 2FA form', tags: ['auth', 'login', '2fa'], ocrTokens: ['password', 'email', 'totp'] }) },
  { path: 'assets/asset-photo-20261105-settings.png', meta: generatePairedMeta('assets/asset-photo-20261105-settings.png', { description: 'Developer settings panel showing Cloudflare and compute workers', tags: ['settings', 'cloudflare', 'compute'], ocrTokens: ['tunnels', 'workers', 'sandbox'] }) }
]

const queries = [
  'settings', 'renderMarkdown', 'login', 'dashboard', 'revenue',
  'function', 'const', 'export', 'cloudflared', 'nonexistent_xyz_symbol',
  'auth', 'totp', 'token', 'workers', 'missing_query_foo'
]

// 500 benchmark iterations measuring search, autofill, result render, and misses
for (let i = 0; i < 500; i++) {
  const q = queries[i % queries.length]
  
  // 1. Autofill suggestion simulation
  const t0 = performance.now()
  const autoMatches = sampleAssets.filter(a => a.path.includes(q) || a.meta.tags.includes(q)).slice(0, 5)
  const t1 = performance.now()
  const autoFillLatencyMs = t1 - t0

  // 2. Full query execution across in-file code + photo assets
  const t2 = performance.now()
  const codeMatches = findMatches(sampleCode, q)
  const photoMatches = searchPhotoAssets(q, sampleAssets)
  const totalMatches = codeMatches.length + photoMatches.length
  const t3 = performance.now()
  const execMs = t3 - t2

  // 3. Result rendering
  const t4 = performance.now()
  const rendered = '<div>' + codeMatches.slice(0, 20).map(m => m.text).join('') + '</div>'
  const t5 = performance.now()
  const renderMs = t5 - t4

  col.recordSearchQuery({
    query: q,
    executionTimeMs: execMs,
    autoFillLatencyMs,
    resultRenderTimeMs: renderMs,
    matchCount: totalMatches
  })

  // 4. AI inline suggestion / auto-fill simulation (100 samples)
  if (i < 100) {
    const aiLat = 28 + (Math.random() * 24) // 28ms - 52ms
    const accepted = Math.random() > 0.12 // ~88% acceptance rate
    col.recordAiCompletion({
      promptChars: 350 + (i * 10),
      completionTokens: 18 + (i % 20),
      latencyMs: aiLat,
      accepted
    })
  }
}

const sm = col.getSearchMetrics()
const am = col.getAiMetrics()

console.log('--- TELEMETRY BENCHMARK REPORT ---')
console.log(JSON.stringify({ searchMetrics: sm, aiMetrics: am }, null, 2))
