#!/usr/bin/env node
// Runs the PayPal part of "agents ask before they spend" for real against the PayPal SANDBOX (free developer account, test money). It needs the sandbox app's
// Client ID and Secret in the environment and a person to be the buyer once: it prints the PayPal sandbox link, you open it, log in with a sandbox PERSONAL
// account and press Pay, and the script captures the order and prints the ids. Nothing here can move real money: server/paypal.js only talks to the sandbox.
//
//   export PAYPAL_CLIENT_ID=...  PAYPAL_CLIENT_SECRET=...      (or: --env-file path, a KEY=VALUE file read inside this process; values are never printed)
//   node scripts/paypal-smoke.mjs                       the PayPal client alone: token, create order, you approve, capture, idempotency checks
//   node scripts/paypal-smoke.mjs --amount 2.50         a different amount (USD, default 1.00)
//   node scripts/paypal-smoke.mjs --wait 10             minutes to wait for you to approve in the sandbox (default 8; PayPal keeps an order about three hours)
//   node scripts/paypal-smoke.mjs --poll 10             seconds between looks at the order while waiting (default 3)
//   node scripts/paypal-smoke.mjs --driver sdk          the same checks through PayPal's own server SDK instead of the hand-written client
//   node scripts/paypal-smoke.mjs --refund              after the capture, refund it in full (sandbox test money goes back to the buyer) and check the refund is idempotent and happens once
//   node scripts/paypal-smoke.mjs --server http://127.0.0.1:8241 --room demo
//        the whole product against a running VESPR server that has the same two variables: the agent token asks (VESPR_AGENT_TOKEN), the person token approves
//        (VESPR_PERSON_TOKEN, a different account), you pay on PayPal, the server captures; prints the request, order and capture ids. Tokens come from the
//        environment only.
// Exit code: 0 everything checked passed, 1 a check failed, 2 not set up (no credentials), 3 you did not approve in time.
import fs from 'node:fs'
import { createPayPal, parseAmount, money, PayPalError, NOT_SET_UP } from '../server/paypal.js'

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const out = (s = '') => process.stdout.write(s + '\n')
let failed = 0
const check = (ok, what, detail = '') => { out(`${ok ? '  ok   ' : '  FAIL '} ${what}${detail ? ': ' + detail : ''}`); if (!ok) failed++; return ok }

// credentials: the environment, or a KEY=VALUE file read here (never printed, never put on a command line)
const envFile = arg('env-file', '')
if (envFile) {
  let text = ''; try { text = fs.readFileSync(envFile, 'utf8') } catch { out(`Could not read the env file (${envFile}).`); process.exit(2) }
  for (const line of text.split(/\r?\n/)) { const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2') }
}
const serverUrl = arg('server', '')
const driver = arg('driver', 'fetch') // fetch: the hand-written client (default); sdk: PayPal's own server SDK (server/paypal-sdk.js), the same checks
const pp = serverUrl ? null : driver === 'sdk' ? (await import('../server/paypal-sdk.js')).createSdkPayPal({ log: () => {} }) : createPayPal({ log: () => {} }) // client mode: sandbox base only; credentials from PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (server mode: the server holds them)
if (pp && !pp.configured) { out(NOT_SET_UP); out('Create a free sandbox REST app at developer.paypal.com (Apps & Credentials, Sandbox), then set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (see docs/PAYPAL.md).'); process.exit(2) }
const amount = parseAmount(arg('amount', '1.00')); if (!amount.ok) { out(amount.reason); process.exit(1) }
const waitMs = Math.max(1, Number(arg('wait', 8))) * 60_000
const pollMs = Math.max(1, Number(arg('poll', 3))) * 1000
const stamp = Date.now().toString(36)
out(pp ? `PayPal ${pp.mode} via the ${pp.driver || 'fetch'} driver (${pp.baseUrl}); amount ${money(amount.cents)}; test money only.` : `VESPR server ${serverUrl}; amount ${money(amount.cents)}; the server talks to PayPal (its own /api/pay/_status says which mode).`)

async function viaClient () {
  out('\nPayPal client (server/paypal.js):')
  const requestId = `smoke-${stamp}`
  let order
  try { order = await pp.createOrder({ requestId, cents: amount.cents, currency: 'USD', description: 'VESPR smoke test', referenceId: requestId, customId: requestId, returnUrl: 'https://example.com/vespr-smoke/return', cancelUrl: 'https://example.com/vespr-smoke/cancel' }) } catch (e) { check(false, 'create order (this also proves the client id and secret work)', e instanceof PayPalError ? `${e.code}: ${e.message}` : String(e)); return }
  check(true, 'sign in with the client id and secret, create an order', `${order.id}, ${order.status}`)
  check(/^https:\/\/www\.sandbox\.paypal\.com\//.test(order.approveUrl), 'the payer link is on www.sandbox.paypal.com')
  const again = await pp.createOrder({ requestId, cents: amount.cents, currency: 'USD', description: 'VESPR smoke test', referenceId: requestId, customId: requestId, returnUrl: 'https://example.com/vespr-smoke/return', cancelUrl: 'https://example.com/vespr-smoke/cancel' }).catch(e => ({ error: e.code }))
  check(again.id === order.id, 'the same PayPal-Request-Id returns the same order (idempotent create)', again.error || '')
  const read = await pp.getOrder(order.id)
  check(read.customId === requestId && read.value === amount.value && read.currency === 'USD', 'get order returns our custom_id, amount and currency', `${read.value} ${read.currency}`)
  const early = await pp.captureOrder(order.id, { requestId: 'early-' + requestId }).then(() => 'captured', e => e.code)
  check(early === 'order_not_approved', 'a capture before the buyer approves is refused by PayPal (ORDER_NOT_APPROVED)', early)
  out(`\nOpen this link in a browser, log in with a sandbox PERSONAL account (developer.paypal.com > Testing Tools > Sandbox accounts) and press Pay:\n\n  ${order.approveUrl}\n\nWaiting up to ${waitMs / 60000} minutes for you to approve it...`)
  const t0 = Date.now(); let st = read
  while (Date.now() - t0 < waitMs) { await sleep(pollMs); st = await pp.getOrder(order.id); if (st.status !== 'PAYER_ACTION_REQUIRED' && st.status !== 'CREATED') break }
  if (st.status !== 'APPROVED') { out(`The order is ${st.status}: not approved in time. Nothing was charged.`); process.exitCode = 3; return }
  check(true, 'the buyer approved the order', st.status)
  const cap = await pp.captureOrder(order.id, { requestId: 'cap-' + requestId }).catch(e => ({ error: `${e.code}: ${e.message}` }))
  if (!check(!cap.error && cap.status === 'COMPLETED' && cap.captureStatus === 'COMPLETED' && !!cap.captureId, 'capture', cap.error || `${cap.status}, capture ${cap.captureId}`)) return
  check(cap.value === amount.value && cap.currency === 'USD' && cap.customId === requestId, 'the capture carries our amount, currency and custom_id', `${cap.value} ${cap.currency}, custom_id ${cap.customId === requestId ? 'ours' : 'missing'}`)
  const replay = await pp.captureOrder(order.id, { requestId: 'cap-' + requestId }).catch(e => ({ error: e.code }))
  check(!replay.error && replay.captureId === cap.captureId, 'the same capture request id again returns the same capture (idempotent)', replay.error || '')
  // PayPal does not refuse a second capture of a captured order: it returns the capture that exists and takes nothing more (seen on the real sandbox, 2026-11-12); a refusal is fine too, a NEW capture is not
  const second = await pp.captureOrder(order.id, { requestId: 'again-' + requestId }).then(r => (r.captureId === cap.captureId ? 'same capture' : 'a different capture: ' + r.captureId), e => e.code)
  check(second === 'same capture' || second === 'already_captured', 'a second capture with a new request id takes nothing more (same capture returned, or refused)', second)
  if (process.argv.includes('--refund')) {
    const rid = 'ref-' + requestId
    const ref = await pp.refundCapture(cap.captureId, { requestId: rid, cents: amount.cents, currency: 'USD', note: 'VESPR smoke test refund' }).catch(e => ({ error: `${e.code}: ${e.message}` }))
    if (!check(!ref.error && ['COMPLETED', 'PENDING'].includes(ref.status), 'refund the capture in full', ref.error || `${ref.status}, refund ${ref.id}`)) return
    const rr = await pp.refundCapture(cap.captureId, { requestId: rid, cents: amount.cents, currency: 'USD' }).catch(e => ({ error: e.code }))
    check(!rr.error && rr.id === ref.id, 'the same refund request id again returns the same refund (idempotent)', rr.error || '')
    const rr2 = await pp.refundCapture(cap.captureId, { requestId: 'again-' + rid, cents: amount.cents, currency: 'USD' }).then(() => 'refunded twice', e => e.code)
    check(rr2 === 'already_refunded', 'a second refund with a new request id is refused (CAPTURE_FULLY_REFUNDED)', rr2)
    out(`Refund: ${ref.id}, ${ref.status}.`)
  }
  out(`\nResult: order ${order.id}, capture ${cap.captureId}, ${money(amount.cents)} USD, sandbox.`)
}

async function viaServer (base, room) {
  const agentTok = process.env.VESPR_AGENT_TOKEN; const personTok = process.env.VESPR_PERSON_TOKEN
  if (!agentTok || !personTok) { out('Set VESPR_AGENT_TOKEN (the agent that asks) and VESPR_PERSON_TOKEN (a different account, the person who approves).'); process.exit(1) }
  const api = async (method, path, tok, body) => { const r = await fetch(base.replace(/\/$/, '') + path, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) } }
  out(`\nVESPR server ${base}, room ${room}:`)
  const st = await api('GET', '/api/pay/_status', personTok); if (!check(st.status === 200 && st.json.configured === true, 'the server has PayPal set up', JSON.stringify({ status: st.status, configured: st.json.configured, mode: st.json.mode }))) return
  const ask = await api('POST', `/api/pay/${room}/request`, agentTok, { amount: amount.value, currency: 'USD', label: 'VESPR smoke test', description: 'scripts/paypal-smoke.mjs' })
  if (!check(ask.status === 201 && ask.json.request.status === 'pending', 'the agent asks for a payment', `${ask.status} ${ask.json.error || ask.json.request?.id}`)) return
  const id = ask.json.request.id
  check((await api('POST', `/api/pay/${room}/answer`, agentTok, { id, approve: true })).status === 403, 'the agent cannot approve its own request')
  const ok = await api('POST', `/api/pay/${room}/answer`, personTok, { id, approve: true })
  if (!check(ok.status === 200 && ok.json.request.status === 'awaiting_buyer' && !!ok.json.request.approveUrl, 'a person approves: the server creates the PayPal order', `${ok.status} ${ok.json.error || ok.json.request?.orderId}`)) return
  out(`\nOpen this link in a browser, log in with a sandbox PERSONAL account and press Pay:\n\n  ${ok.json.request.approveUrl}\n\nWaiting up to ${waitMs / 60000} minutes...`)
  const t0 = Date.now(); let cur = ok.json.request
  while (Date.now() - t0 < waitMs && cur.status === 'awaiting_buyer') { await sleep(Math.max(4000, pollMs)); const r = await api('POST', `/api/pay/${room}/check`, personTok, { id }); if (r.status === 200) cur = r.json.request }
  if (cur.status !== 'captured') { out(`The request is ${cur.status}${cur.error ? ' (' + cur.error + ')' : ''}. Nothing was charged.`); process.exitCode = cur.status === 'awaiting_buyer' ? 3 : 1; return }
  check(true, 'the buyer paid and the server captured it', `${cur.status}`)
  const trail0 = cur.trail.map(t => t.to).join('>'); check(trail0 === 'pending>awaiting_buyer>captured', 'the trail records who did what', cur.trail.map(t => `${t.to}:${t.by}`).join(' > '))
  if (process.argv.includes('--refund')) {
    check((await api('POST', `/api/pay/${room}/refund`, agentTok, { id })).status === 403, 'the agent cannot refund')
    const rf = await api('POST', `/api/pay/${room}/refund`, personTok, { id })
    if (!check(rf.status === 200 && rf.json.request.status === 'refunded' && !!rf.json.request.refundId, 'a person refunds it', `${rf.status} ${rf.json.error || rf.json.request?.refundId}`)) return
    check((await api('POST', `/api/pay/${room}/refund`, personTok, { id })).status === 409, 'a second refund is refused')
    cur = rf.json.request
  }
  out(`\nResult: request ${id}, order ${cur.orderId}, capture ${cur.captureId}${cur.refundId ? ', refund ' + cur.refundId : ''}, ${money(amount.cents)} USD, sandbox.`)
}

try {
  if (serverUrl) await viaServer(serverUrl, arg('room', 'demo')); else await viaClient()
} catch (e) { out('Unexpected: ' + (e instanceof PayPalError ? `${e.code}: ${e.message}` : e.message)); failed++ }
out(failed ? `\n${failed} check(s) failed.` : process.exitCode === 3 ? '\nStopped waiting for the buyer.' : '\nAll checks passed.')
process.exit(failed ? 1 : process.exitCode || 0)
