// Model choice against the real list of Nemotron models Token Factory returned on 2026-10-28 (in two orders), plus vision-language and guard models that must never be picked.
import http from 'node:http'
import assert from 'node:assert'
import { discoverModel } from '../src/llm.js'
const real = ['nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B', 'nvidia/Nemotron-3_5-Lightning', 'nvidia/Nemotron-3-Ultra-550b-a55b', 'nvidia/nemotron-3-super-120b-a12b', 'nvidia/Nemotron-3.5-Super-VL']
const extra = ['nvidia/Llama-3.1-Nemotron-Safety-Guard-8B', 'nvidia/llama-nemotron-embed-1b', 'Qwen/Qwen3-235B']
let listing = []
const srv = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: listing.map(id => ({ id })) })) })
await new Promise(r => srv.listen(0, '127.0.0.1', r))
const baseUrl = `http://127.0.0.1:${srv.address().port}/v1`
try {
  for (const order of [[...real, ...extra], [...extra, ...[...real].reverse()]]) {
    listing = order
    assert.strictEqual(await discoverModel({ baseUrl, apiKey: 'k', prefer: [/super/i] }), 'nvidia/nemotron-3-super-120b-a12b', 'everyday model is Super, never the vision-language one')
    assert.strictEqual(await discoverModel({ baseUrl, apiKey: 'k', prefer: [/ultra/i] }), 'nvidia/Nemotron-3-Ultra-550b-a55b')
    assert.strictEqual(await discoverModel({ baseUrl, apiKey: 'k', prefer: [/nano/i] }), 'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B')
  }
  listing = ['nvidia/Nemotron-3.5-Super-VL', 'nvidia/llama-nemotron-embed-1b']
  await assert.rejects(() => discoverModel({ baseUrl, apiKey: 'k' }), /no Nemotron model/, 'only unsuitable models: say so instead of picking one')
  console.log('model discovery tests passed')
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally { srv.close(); setTimeout(() => process.exit(), 100) }
