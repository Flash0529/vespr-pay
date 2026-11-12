// The Token Factory client against a fake OpenAI-compatible server (no key needed): streaming text, a split tool call, model discovery.
import http from 'node:http'
import assert from 'node:assert'
import { OpenAICompat, discoverModel } from '../src/llm.js'

const sse = objs => objs.map(o => `data: ${typeof o === 'string' ? o : JSON.stringify(o)}\n\n`).join('')
let seenBody
const srv = http.createServer((req, res) => {
  if (req.headers.authorization !== 'Bearer k123') { res.writeHead(401); return res.end() }
  if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ data: [{ id: 'meta/llama' }, { id: 'nvidia/Nemotron-Nano-9B' }, { id: 'nvidia/Nemotron-Super-49B' }] })) }
  let b = ''; req.on('data', c => { b += c }); req.on('end', () => {
    seenBody = JSON.parse(b)
    res.setHeader('Content-Type', 'text/event-stream')
    const mid = Math.floor(Math.random() * 3) + 1
    res.write(sse([{ choices: [{ delta: { content: 'Hel' } }] }, { choices: [{ delta: { content: 'lo' } }] }]))
    res.write(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"pa' } }] } }] }]))
    res.write(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.py"}' } }] } }] }, '[DONE]']))
    res.end()
  })
})
await new Promise(r => srv.listen(0, '127.0.0.1', r))
const baseUrl = `http://127.0.0.1:${srv.address().port}/v1`
try {
  assert.strictEqual(await discoverModel({ baseUrl, apiKey: 'k123' }), 'nvidia/Nemotron-Super-49B', 'prefers Super')
  const llm = new OpenAICompat({ baseUrl, apiKey: 'k123', model: 'nvidia/Nemotron-Super-49B' })
  let text = ''; let calls
  for await (const ev of llm.complete({ messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 'read_file', parameters: {} } }] })) { if (ev.text) text += ev.text; if (ev.done) calls = ev.toolCalls }
  assert.strictEqual(text, 'Hello'); assert.deepStrictEqual(calls, [{ id: 'call_1', name: 'read_file', args: { path: 'a.py' } }])
  assert.strictEqual(seenBody.stream, true); assert.strictEqual(seenBody.model, 'nvidia/Nemotron-Super-49B')
  console.log('llm tests passed')
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally { srv.close() }
