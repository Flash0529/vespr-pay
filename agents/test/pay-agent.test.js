// Agents ask before they spend, end to end: the REAL server (access control on) + a fake PayPal on loopback + the real agent room and tool loop (agent.js
// request_payment -> room.requestPayment -> server/pay.js). The scripted demo agent asks; the card appears for the people; the agent cannot answer it and
// nobody can forge a card from a connection; a person approves; the "buyer" pays on the fake PayPal page; the server captures once; the agent reports the
// outcome from the server's own words. Also: a denial charges nothing, an over-limit request is refused by the server, and without PayPal credentials the
// agent says payments are not set up. No outside network.
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import assert from 'node:assert'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { joinRoom } from '../src/room.js'
import { respond, asOpenAITools } from '../src/agent.js'
import { stepSummary, stepOk } from '../src/steps.js'
import { Mock } from '../src/llm.js'
import { createFakePayPal } from '../../server/test/fakepaypal.js'

const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(60) } throw new Error('timed out waiting for: ' + what) }
const here = path.dirname(new URL(import.meta.url).pathname)
const CID = 'test-client-id-' + 'a'.repeat(20); const SEC = 'test-secret-' + 'b'.repeat(20) // throwaway
let dump = () => ''
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++ }; const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }
const dirs = []; const procs = []; const peers = []

async function startServer ({ paypal }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-pay-agent-')); dirs.push(dir)
  fs.writeFileSync(path.join(dir, 'tokens'), 'alex:tok-a\nsam:tok-s\ncoder:tok-c\n')
  const PORT = await freePort(); const base = 'http://127.0.0.1:' + PORT
  const env = { PATH: process.env.PATH, HOME: dir, MURMIO_PORT: String(PORT), MURMIO_HOST: '127.0.0.1', MURMIO_DATA: path.join(dir, 'data'), MURMIO_TOKENS_FILE: path.join(dir, 'tokens'), VESPR_ACCESS: '1', VESPR_AGENT_NAMES: 'coder', VESPR_PAY_BASE_URL: base, ...(paypal ? { PAYPAL_CLIENT_ID: CID, PAYPAL_CLIENT_SECRET: SEC, PAYPAL_API_BASE: paypal, VESPR_PAYPAL_TEST_LOOPBACK: '1' } : {}) }
  const srv = spawn('node', [path.join(here, '../../server/index.js')], { env, stdio: ['ignore', 'ignore', 'pipe'] }); procs.push(srv); let log = ''; srv.stderr.on('data', d => { log += d })
  await until(async () => { try { return (await fetch(base + '/healthz')).ok } catch { return false } }, 'the server')
  const api = (method, p, tok, body) => fetch(base + p, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }))
  return { PORT, base, api, log: () => log }
}
const person = async (S, room, tok, name) => { const doc = new Y.Doc(); const p = new WebsocketProvider(`ws://127.0.0.1:${S.PORT}/ws`, room, doc, { WebSocketPolyfill: WebSocket, params: { token: tok }, disableBc: true }); peers.push(p); await until(() => p.synced, name + ' joins'); return { doc, p, chat: doc.getArray('chat') } }
const say = (who, id, text) => { const m = new Y.Map(); const tx = new Y.Text(); who.doc.transact(() => { m.set('id', id); m.set('ts', Date.now()); m.set('author', who.name); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); who.chat.push([m]); tx.insert(0, text) }) }
const messages = P => P.chat.toArray().map(m => ({ id: m.get('id'), role: m.get('role'), author: m.get('author'), status: m.get('status'), text: m.get('text') ? m.get('text').toString() : '', m }))
const runner = { label: 'sandbox', remote: false, exec: async () => ({ code: 0, output: '', changed: [] }) }
const sleepless = () => {}; void sleepless

// the tool is only offered where the room can ask; the model gets structured arguments; the live line reads like a sentence
{
  const names = t => t.map(x => x.function.name)
  ok(!names(asOpenAITools(false)).includes('request_payment') && names(asOpenAITools(false, true, false, false, false, false, true)).includes('request_payment'), 'offered only when the room supports it')
  const tool = asOpenAITools(false, true, false, false, false, false, true).find(x => x.function.name === 'request_payment').function
  eq([tool.parameters.required, Object.keys(tool.parameters.properties), tool.parameters.properties.currency.enum], [['amount', 'label', 'reason'], ['amount', 'currency', 'label', 'reason'], ['USD']]); ok(/do not invent risk scores/.test(tool.parameters.properties.reason.description), 'the model is told the server adds the numbers')
  ok(/SANDBOX/.test(tool.description) && /ONLY when the result says status "captured"/.test(tool.description) && /do not split the amount/.test(tool.description), 'the tool tells the model the rules')
  ok(/buy, order, purchase, pay for or settle/.test(tool.description) && /never answer that you cannot make purchases/.test(tool.description) && /nothing is paid until a person approves/.test(tool.description) && /ask for the amount first/.test(tool.description), 'a request to buy something is asked through the tool, never refused (a real model refused "buy the $12.50 stock photos" on 2026-11-12)')
  eq(stepSummary('request_payment', { amount: '25.00', label: 'Logo invoice' }), 'Asking for a payment of $25.00 for Logo invoice'); eq(stepOk({ text: JSON.stringify({ status: 'denied' }) }), true); eq(stepOk({ text: JSON.stringify({ error: 'refused' }) }), false); eq(stepOk({ text: JSON.stringify({ status: 'expired', ok: false }) }), false)
}
try {
  const fake = createFakePayPal({ clientId: CID, clientSecret: SEC }); const pp = await fake.serve()
  const S = await startServer({ paypal: pp.base })
  const alex = await person(S, 'shop', 'tok-a', 'alex'); alex.name = 'alex'
  const agent = joinRoom({ server: 'ws://127.0.0.1:' + S.PORT, room: 'shop', token: 'tok-c', name: 'coder', color: '#0aa', model: 'fake', onRefused: () => { throw new Error('the agent was disconnected') } }); peers.push(agent.provider); await agent.ready; await agent.accessReady
  dump = () => 'chat: ' + JSON.stringify(messages(alex).map(m => [m.role, m.author, m.text.slice(0, 120)])) + '\nserver: ' + S.log().slice(-600)
  const llm = new Mock()
  let turn = 0; const askAgent = async (text, room = agent) => { const id = 'u' + (++turn); say(alex, id, text); await until(() => room.chat.toArray().some(m => m.get('id') === id), 'the agent sees the message'); return respond({ room, llm, trigger: id, runner }) }

  if (process.env.PAY_TEST_TRACE) console.error('stage 1')
  // 1. the agent asks; the card appears for everybody, pending, with the facts
  const run1 = askAgent('@coder pay $25 for the logo invoice please')
  const card = await until(() => messages(alex).find(m => m.role === 'payment'), 'the payment card'); const q = card.m.get('request')
  eq([card.author, card.status, q.value, q.currency, q.label], ['coder', 'pending', '25.00', 'USD', 'Logo invoice']); eq(q.facts, { spent: '$0.00', cap: '$100.00', left: '$75.00', perRequest: '$50.00' }, 'the server adds its own facts next to the agent\u2019s reason'); ok(/scripted demo agent passes the amount you typed/.test(q.description), 'the agent\u2019s reason is on the card'); ok(/PayPal sandbox, no real money/.test(card.text) && /coder asks to pay \$25\.00 for Logo invoice/.test(card.text), card.text)
  eq(card.m.get('isAgent'), true); eq(fake.state.creates, 0, 'nothing exists at PayPal until a person approves')
  if (process.env.PAY_TEST_TRACE) console.error('stage 2')
  // 2. the agent cannot answer, and nobody can forge or change a card from a connection
  eq((await S.api('POST', '/api/pay/shop/answer', 'tok-c', { id: q.id, approve: true })).status, 403, 'the agent cannot approve its own request')
  const sam = await person(S, 'shop', 'tok-s', 'sam'); const codes = []; sam.p.ws.addEventListener('close', e => codes.push(e.code))
  const target = sam.chat.toArray().find(m => m.get('role') === 'payment'); target.set('status', 'captured'); target.set('decidedBy', 'sam')
  await until(() => codes.includes(4409), 'a connection that edits a payment card is closed'); sam.p.disconnect()
  const sam2 = await person(S, 'shop', 'tok-s', 'sam'); const codes2 = []; sam2.p.ws.addEventListener('close', e => codes2.push(e.code)); sam2.name = 'sam'
  const fakeCard = new Y.Map(); sam2.doc.transact(() => { fakeCard.set('id', 'pay-forged'); fakeCard.set('author', 'sam'); fakeCard.set('role', 'payment'); fakeCard.set('status', 'captured'); sam2.chat.push([fakeCard]) })
  await until(() => codes2.includes(4409), 'a connection that posts a payment card is closed'); sam2.p.disconnect()
  await wait(300); eq(messages(alex).filter(m => m.role === 'payment').length, 1, 'no forged card reached the room'); eq(messages(alex).find(m => m.role === 'payment').status, 'pending', 'and the real one is untouched')
  if (process.env.PAY_TEST_TRACE) console.error('stage 3')
  // 3. a person approves: the order is made at PayPal and the person gets the sandbox link; the agent keeps waiting
  const a = await S.api('POST', '/api/pay/shop/answer', 'tok-a', { id: q.id, approve: true }); eq(a.status, 200, JSON.stringify(a.json)); const link = a.json.request.approveUrl
  eq([a.json.request.status, a.json.request.decidedBy], ['awaiting_buyer', 'alex']); ok(link.startsWith(pp.base + '/checkoutnow?token='), 'the sandbox page link'); eq(fake.state.creates, 1)
  await until(() => messages(alex).find(m => m.role === 'payment').status === 'awaiting_buyer', 'the card shows the approval'); eq(await Promise.race([run1.then(() => 'done'), wait(400).then(() => 'waiting')]), 'waiting', 'the agent is still waiting: approval is not payment')
  if (process.env.PAY_TEST_TRACE) console.error('stage 4')
  // 4. the buyer pays on the (fake) PayPal page; PayPal sends the browser back; the server captures once; the card and the agent say so
  const page = await fetch(link + '&pay=1'); const html = await page.text(); ok(/Payment received/.test(html), html.slice(0, 200)); eq(fake.state.captures, 1)
  await run1
  const m1 = messages(alex); eq(m1.find(m => m.role === 'payment').status, 'captured'); eq(m1.find(m => m.role === 'payment').m.get('decidedBy'), 'alex')
  ok(m1.some(m => m.role === 'tool' && m.author === 'coder' && /alex approved \$25\.00 for Logo invoice; PayPal \(sandbox\) captured it/.test(m.text)), 'the step line says who approved')
  ok(m1.some(m => m.role === 'agent' && /Paid: \$25\.00 for Logo invoice, approved by alex\. PayPal captured it \(sandbox, test money/.test(m.text)), 'the agent reports the server’s outcome')
  await fetch(link + '&pay=1'); eq(fake.state.captures, 1, 'the buyer pressing Pay again does not take money twice')

  if (process.env.PAY_TEST_TRACE) console.error('stage 5')
  // 5. a denial: nothing is created, nothing is charged, and the agent says so
  const creates = fake.state.creates; const run2 = askAgent('@coder buy the $12.50 stock photos')
  const card2 = await until(() => messages(alex).filter(m => m.role === 'payment')[1], 'the second card'); const q2 = card2.m.get('request'); eq(q2.value, '12.50')
  eq((await S.api('POST', '/api/pay/shop/answer', 'tok-a', { id: q2.id, approve: false })).status, 200); await run2
  const m2 = messages(alex); eq(m2.filter(m => m.role === 'payment')[1].status, 'denied'); eq(fake.state.creates, creates, 'a denial never reaches PayPal')
  ok(m2.some(m => m.role === 'agent' && /alex said no, so nothing was charged/.test(m.text)), 'the agent accepts the no'); ok(m2.some(m => m.role === 'tool' && /alex denied \$12\.50 for Stock photos; nothing was charged/.test(m.text)))

  if (process.env.PAY_TEST_TRACE) console.error('stage 6')
  // 6. over the limit: the server refuses before anyone is asked, the card says so, the agent reports it
  await askAgent('@coder pay $75 for the conference ticket')
  const m3 = messages(alex); const refused = m3.filter(m => m.role === 'payment')[2]; eq(refused.status, 'refused'); ok(/refused by the server: \$75\.00 is over the limit of \$50\.00/.test(refused.text), refused.text)
  ok(m3.some(m => m.role === 'tool' && m.status === 'failed' && /the server refused the payment request: \$75\.00 is over the limit/.test(m.text)), 'the step is shown as failed'); ok(m3.some(m => m.role === 'agent' && /The server did not take that: \$75\.00 is over the limit/.test(m.text)))
  eq(fake.state.creates, creates, 'no PayPal order for a refused request'); eq((await S.api('POST', '/api/pay/shop/answer', 'tok-a', { id: refused.m.get('request').id, approve: true })).status, 409)
  // the history the room keeps: who asked, who approved, what PayPal did, in order
  const trail = m3.find(m => m.role === 'payment').m.get('trail'); eq(trail.map(t => `${t.to}:${t.by}`), ['pending:coder', 'awaiting_buyer:alex', 'captured:PayPal'])
  ok(!/test-secret|test-client-id|fake-token/.test(S.log()), 'the server log holds no credentials')
  const log = fs.readFileSync(path.join(dirs[0], 'data', 'pay', 'shop.log.jsonl'), 'utf8'); ok(!log.includes(SEC) && !log.includes(CID))

  if (process.env.PAY_TEST_TRACE) console.error('stage 7')
  // 7. no PayPal credentials: the agent says payments are not set up, no card appears, nothing pretends to work
  const S2 = await startServer({ paypal: null }); const alex2 = await person(S2, 'shop', 'tok-a', 'alex'); alex2.name = 'alex'; alex.doc = alex2.doc; alex.chat = alex2.chat; alex.p = alex2.p
  const agent2 = joinRoom({ server: 'ws://127.0.0.1:' + S2.PORT, room: 'shop', token: 'tok-c', name: 'coder', color: '#0aa', model: 'fake', onRefused: () => {} }); peers.push(agent2.provider); await agent2.ready; await agent2.accessReady
  await askAgent('@coder pay $5 for coffee', agent2)
  const m4 = messages(alex2); eq(m4.filter(m => m.role === 'payment').length, 0, 'no card for a payment that cannot happen')
  ok(m4.some(m => m.role === 'agent' && /The server did not take that: PayPal sandbox is not set up on this server/.test(m.text)), JSON.stringify(m4.map(m => m.text)))
  eq((await S2.api('GET', '/api/pay/_status', 'tok-a')).json.configured, false); agent2.destroy()
  await pp.close(); agent.destroy()
  console.log(`pay agent tests passed (${n}): the agent asks through request_payment, the card appears, the agent cannot answer it and no connection can forge one, a person approves, the buyer pays, the server captures once and the agent reports it; a denial and an over-limit request charge nothing; no credentials, no payments`)
} catch (e) { console.error(dump()); throw e } finally {
  for (const p of peers) try { p.destroy() } catch {}
  for (const p of procs) p.kill(); for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
}
process.exit(0) // reached only when everything passed; the spawned servers' pipes would otherwise keep the process open for a moment
