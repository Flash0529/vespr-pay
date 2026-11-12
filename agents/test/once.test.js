// Short one-shot calls (suggestions, digests) must switch hidden reasoning off, or the reply can come back empty.
import http from 'node:http'
import assert from 'node:assert'
import { OpenAICompat } from '../src/llm.js'
const bodies = []
const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c }); req.on('end', () => { bodies.push(JSON.parse(b)); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'return x' } }], usage: { prompt_tokens: 9, completion_tokens: 3 } })) }) })
await new Promise(r => srv.listen(0, '127.0.0.1', r))
try {
  const llm = new OpenAICompat({ baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, apiKey: 'k', model: 'm' })
  const text = await llm.once({ messages: [{ role: 'user', content: 'x' }], maxTokens: 50 })
  assert.strictEqual(text, 'return x'); assert.deepStrictEqual(bodies[0].chat_template_kwargs, { enable_thinking: false }); assert.strictEqual(bodies[0].max_tokens, 50)
  assert.deepStrictEqual(llm.lastUsage, { prompt: 9, completion: 3 })
  console.log('one-shot call tests passed')
} catch (e) { console.error('FAILED:', e.message); process.exitCode = 1 } finally { srv.close(); setTimeout(() => process.exit(), 100) }
