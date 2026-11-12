// netsim (the network-conditions proxy the network tests rely on): the delay is what the profile says, order is kept under jitter,
// and a short HTTP request/response survives a slow link (it used to lose the response when the server closed first).
import assert from 'node:assert'
import net from 'node:net'; import http from 'node:http'
import { startNetsim } from '../../scripts/netsim.mjs'

let n = 0
const t = async (name, fn) => { try { await fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)))

await t('the far profile adds about 280 ms per round trip', async () => {
  const echo = net.createServer(s => s.pipe(s)); const port = await listen(echo)
  const sim = await startNetsim({ listen: 0, target: `127.0.0.1:${port}`, profile: 'far' })
  const c = net.connect(sim.port, '127.0.0.1'); await new Promise(r => c.once('connect', r))
  const rtts = []; for (let i = 0; i < 5; i++) { const t0 = Date.now(); c.write('x'); await new Promise(r => c.once('data', r)); rtts.push(Date.now() - t0) }
  rtts.sort((a, b) => a - b); assert.ok(rtts[2] >= 200 && rtts[2] <= 420, `median ${rtts[2]} ms`)
  c.destroy(); sim.close(); echo.close()
})

await t('order is kept under jitter', async () => {
  const got = []; const sink = net.createServer(s => s.on('data', d => got.push(d.toString()))); const port = await listen(sink)
  const sim = await startNetsim({ listen: 0, target: `127.0.0.1:${port}`, profile: { oneWayMs: 20, jitterMs: 19 } })
  const c = net.connect(sim.port, '127.0.0.1'); await new Promise(r => c.once('connect', r)); c.setNoDelay(true)
  for (let i = 0; i < 40; i++) { c.write(`<${i}>`); await new Promise(r => setTimeout(r, 2)) }
  await new Promise(r => setTimeout(r, 400))
  assert.strictEqual(got.join(''), [...Array(40).keys()].map(i => `<${i}>`).join(''))
  c.destroy(); sim.close(); sink.close()
})

await t('an HTTP request gets its response over a slow link, even when the server closes right after answering', async () => {
  const api = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('Connection', 'close'); res.end('{"text":"ok"}') }) }); const port = await listen(api)
  for (const profile of ['continent', 'far', 'mobile']) {
    const sim = await startNetsim({ listen: 0, target: `127.0.0.1:${port}`, profile })
    const body = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: sim.port, method: 'POST', path: '/x', agent: false }, res => { let s = ''; res.on('data', c => { s += c }); res.on('end', () => resolve(s)) })
      req.on('error', reject); req.end('{}')
    })
    assert.strictEqual(body, '{"text":"ok"}', profile); sim.close()
  }
  api.close()
})

console.log(`netsim tests passed (${n}): profile delay, order under jitter, HTTP response survives a slow link`)
