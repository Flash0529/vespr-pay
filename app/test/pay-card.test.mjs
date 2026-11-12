// The payment request card (app/pay-card.js) and how the app uses it: every state says what is true, the sandbox badge is on every card, Deny and every refusal say
// nothing was charged, nothing the agent typed can inject markup, every control has a name, History gets one row per state change, and the colors it uses pass contrast.
// Pure functions plus string checks on the shipped prototype.html and vespr-client.js; no browser, network or model.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { payCardHtml, paymentHistory, BADGE, MERCHANT, STATES, STATE_LABEL, money } from '../pay-card.js'

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const html = fs.readFileSync(path.join(root, 'app/prototype.html'), 'utf8'); const client = fs.readFileSync(path.join(root, 'app/vespr-client.js'), 'utf8')
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++ }; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++ }

const base = { id: 'pay-abc', author: 'coder', role: 'payment', status: 'pending', decidedBy: '', text: 'coder asks to pay $25.00 for Logo design invoice',
  request: { id: 'abc', who: 'coder', value: '25.00', currency: 'USD', label: 'Logo design invoice', description: 'Invoice 42 from the designer', expiresAt: Date.UTC(2026, 10, 12, 19, 15), badge: BADGE, facts: { spent: '$30.00', cap: '$100.00', left: '$45.00', perRequest: '$50.00' } },
  pay: { orderId: '', captureId: '', error: '', trail: [], buyerDeadline: 0 } }
const card = (over = {}, ctx = {}) => payCardHtml({ ...base, ...over, pay: { ...base.pay, ...(over.pay || {}) } }, { me: 'alex', canAnswer: true, mark: () => '<i data-mark></i>', ic: n => `<i data-ic="${n}"></i>`, ...ctx })
const buttons = h => [...h.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim())
const nothing = /Nothing was charged/
const attrNames = h => [...h.matchAll(/<[a-z][\w-]*((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>/gi)].flatMap(m => [...m[1].matchAll(/\s+([\w-]+)(?:="[^"]*")?/g)].map(x => x[1].toLowerCase())) // real attribute names, reading quoted values as values

// every state has a card, and every card carries the badge and the same plain facts
for (const status of STATES) {
  const h = card({ status, decidedBy: status === 'pending' || status === 'refused' || status === 'expired' ? '' : 'alex', pay: { orderId: 'ORD1', captureId: 'CAP1', error: status === 'refused' ? '$75.00 is over the limit of $50.00 for one request.' : status === 'failed' ? 'PayPal declined this payment; nothing was charged.' : '' } })
  ok(h.includes(BADGE) && h.includes('data-testid="pay-badge"'), 'the badge on the ' + status + ' card'); ok(h.includes('data-pay-card="abc"') && h.includes(`data-pay-status="${status}"`)); ok(h.includes('role="group"') && /aria-label="Payment request, [^"]*25\.00 USD for Logo design invoice, asked by coder"/.test(h), status + ' has a name for screen readers')
  ok(h.includes('$25.00') && h.includes('Logo design invoice') && h.includes('coder'), 'amount, what and who asked: ' + status); ok(!attrNames(h).some(x => /^on/.test(x)) && !/javascript:|<script/i.test(h), 'no inline handlers')
  ok(!buttons(h).some(b => b === ''), 'every button has a visible name: ' + status)
  eq(typeof STATE_LABEL[status], 'string')
}
// pending: the question, the facts, who the money goes to, Approve and Deny named with the amount, and what happens next
{
  const h = card(); eq(buttons(h), ['Approve $25.00', 'Deny']); ok(h.includes('data-pay-answer="abc" data-ok="1"') && h.includes('data-pay-answer="abc" data-ok="0"'))
  ok(/coder \(agent\) asks to pay/.test(h) && h.includes('<dt>From</dt><dd>the demo merchant (this app\u2019s PayPal sandbox business account)</dd>'), 'it says the money goes to the demo merchant, not to a named person'); ok(!/pay(s|ing)? (the )?(designer|freelancer)/i.test(h.replace(/Invoice 42 from the designer/, '')))
  ok(h.includes('“Invoice 42 from the designer”') && /Nothing is charged unless a person approves/.test(h) && /lapses at \d{1,2}:\d{2} (AM|PM)/.test(h)); ok(!h.includes('Check status') && !h.includes('Open PayPal'))
  ok(h.includes('<dt>Room today</dt><dd>$30.00 of $100.00 used in 24 hours when asked; approving leaves $45.00. Limit per request $50.00.</dd>'), 'the server\u2019s own facts next to the agent\u2019s reason')
  const w = card({}, { canAnswer: false }); eq(buttons(w), [], 'a person who may not answer gets no buttons'); ok(/Waiting for a person with edit rights to answer\. An agent cannot\./.test(w))
  const st = card({}, { canAnswer: false, whyNot: 'Students cannot approve payments.' }); eq(buttons(st), [], 'a student gets no buttons'); ok(/Students cannot approve payments\. Waiting for someone who can approve it\./.test(st), 'and is told why'); ok(/Only adults approve payments\./.test(card({}, { canAnswer: false, whyNot: 'only adults approve payments' })))
  ok(!card({ request: { ...base.request, facts: undefined } }).includes('Room today'), 'no facts row when the server sent none')
}
// approved, waiting for the buyer: the approver gets Open and Check; others see who is paying; nothing is charged yet
{
  const mine = card({ status: 'awaiting_buyer', decidedBy: 'alex', pay: { orderId: 'ORD1', buyerDeadline: Date.UTC(2026, 10, 12, 19, 40) } }); eq(buttons(mine), ['Open PayPal sandbox', 'Check status']); ok(mine.includes('data-pay-open="abc"') && mine.includes('data-pay-check="abc"')); ok(/approved by <b>alex<\/b>/.test(mine) && /Nothing is charged until the buyer pays/.test(mine) && /sandbox buyer account/.test(mine))
  const other = card({ status: 'awaiting_buyer', decidedBy: 'alex' }, { me: 'bob' }); eq(buttons(other), []); ok(/alex is paying on PayPal/.test(other) && !/sandbox buyer account/.test(other))
  ok(!card({ status: 'awaiting_buyer', decidedBy: 'ALEX' }, { me: 'alex ' }).includes('is paying on PayPal'), 'the same person, whatever the capitals')
}
// captured: the receipt with both PayPal ids and who approved
{
  const h = card({ status: 'captured', decidedBy: 'alex', pay: { orderId: 'ORD123', captureId: 'CAP456' } }); ok(/Paid\. Approved by <b>alex<\/b>; PayPal captured it in the sandbox \(test money\)/.test(h)); ok(/data-testid="pay-receipt">PayPal order ORD123 · capture CAP456</.test(h)); eq(buttons(h), ['Refund $25.00']); ok(h.includes('data-pay-refund="abc"') && h.includes('data-testid="pay-refund"') && h.includes('data-ic="check"'), 'a person who may answer can refund it')
  eq(buttons(card({ status: 'captured', decidedBy: 'alex', pay: { orderId: 'ORD123', captureId: 'CAP456' } }, { canAnswer: false })), [], 'nobody else gets the Refund button')
  const rf = card({ status: 'refunded', decidedBy: 'alex', pay: { orderId: 'ORD123', captureId: 'CAP456', refundId: 'REF789', refundedBy: 'terry' } }); eq(buttons(rf), []); ok(/Refunded by <b>terry<\/b>\. Paid earlier \(approved by <b>alex<\/b>\); PayPal returned the test money to the buyer\./.test(rf) && /order ORD123 \u00b7 capture CAP456 \u00b7 refund REF789/.test(rf) && rf.includes(BADGE), 'the refunded card')
}
// denied and every other end: nothing was charged, no buttons, no way to approve
for (const [status, text] of [['denied', /Denied by <b>bob<\/b>\. Nothing was charged\./], ['expired', /Lapsed: nobody finished it in time\. Nothing was charged\./], ['cancelled', /Cancelled on PayPal\. Nothing was charged\./], ['failed', /PayPal did not complete it: PayPal declined this payment; nothing was charged\.<\/div>/], ['refused', /Refused by the server: \$75\.00 is over the limit of \$50\.00 for one request\. Nobody was asked\. Nothing was charged\.<\/div>/]]) {
  const h = card({ status, decidedBy: status === 'denied' ? 'bob' : '', pay: { error: status === 'failed' ? 'PayPal declined this payment; nothing was charged.' : status === 'refused' ? '$75.00 is over the limit of $50.00 for one request.' : '' } })
  ok(text.test(h), status + ': ' + h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 220)); ok(!/\.\./.test(h.replace(/<[^>]+>/g, ' ')), status + ': no doubled period'); eq(buttons(h), [], status + ' has no buttons'); ok(!/data-pay-answer/.test(h)); ok(h.includes('data-ic="x"'))
}
// the agent's words are data: nothing it types becomes markup
{
  const evil = '<img src=x onerror=alert(1)>"\'&'; const h = card({ request: { ...base.request, label: evil, description: evil, who: evil, value: '1"><b>', currency: 'USD' }, author: evil })
  ok(!h.includes('<img') && !h.includes('"><b>') && !attrNames(h).some(x => /^on/i.test(x) || x === 'style' && /expression|url\(/i.test(h)), 'escaped: no tag carries an event attribute'); ok(h.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;'))
  ok(!card({ status: 'awaiting_buyer', decidedBy: evil }).includes('<img') && !card({ status: 'failed', pay: { error: evil } }).includes('<img'))
  eq(money('25.00', 'EUR'), 'EUR 25.00'); eq(money('<b>', 'USD'), '$&lt;b&gt;')
  ok(card({ status: 'weird' }).includes('data-pay-status="pending"'), 'an unknown status is shown as the safest state: waiting, no money moved')
}
// History: one row per state change, with who did it
{
  const t0 = Date.UTC(2026, 10, 12, 18, 0); const trail = [{ ts: t0, to: 'pending', by: 'coder', note: 'asked to pay $25.00 for Logo design invoice' }, { ts: t0 + 60_000, to: 'awaiting_buyer', by: 'alex', note: 'approved; PayPal order ORD1 created' }, { ts: t0 + 120_000, to: 'captured', by: 'PayPal', note: 'captured $25.00; capture CAP1' }, { ts: 'bad', to: 'x' }]
  const rows = paymentHistory({ ...base, pay: { orderId: 'ORD1', captureId: 'CAP1', trail } })
  eq(rows.map(r => [r.who, r.kind, r.verb, r.type]), [['coder', 'agent', 'asked to pay', 'payment'], ['alex', 'person', 'approved', 'payment'], ['PayPal', 'system', 'captured', 'payment']]); ok(rows.every(r => r.target === '$25.00 for Logo design invoice' && r.id.startsWith('pay-pay-abc-') && r.extra.why.includes(BADGE))); ok(rows[1].detail.includes('ORD1'))
  eq(new Set(rows.map(r => r.id)).size, 3); eq(paymentHistory({ ...base, pay: undefined }), [])
  ok(paymentHistory({ ...base, pay: { trail: [{ ts: 1, to: 'refused', by: 'server', note: 'over a limit' }] } })[0].kind === 'system')
}
// the shipped app uses it: the live chat draws the card, the buttons call the server, Approve opens PayPal's page in a popup, History has a Payments filter
{
  ok(/import\('\.\/pay-card\.js'\)/.test(html) && /PAYm\.payCardHtml\(m, \{ me: accMe\(\), canAnswer: payMayAnswer\(\)/.test(html), 'the live transcript draws it'); ok(/m\.role === 'payment' && m\.request/.test(html))
  ok(/fetch\(httpOf\(c\.server\)\+'\/api\/pay\/'\+encodeURIComponent\(c\.room\)\+path/.test(html), 'it talks to /api/pay/<room>'); ok(/payApi\('\/answer',\{id,approve:yes\}\)/.test(html) && /payApi\('\/check',/.test(html))
  ok(/window\.open\('','vespr-paypal',PAY_POPUP\)/.test(html) && /w\.location\.href=q\.approveUrl/.test(html) && /PAY_POPUP='popup=yes,width=520,height=760'/.test(html), 'the popup opens inside the click and is pointed at the sandbox link')
  ok(/Denied: nothing was charged\./.test(html) && /blocked the PayPal window/.test(html), 'a refused popup and a denial are said plainly')
  ok(/payLoad\(\)/.test(html) && /whyNot: state\.payCan===false\?state\.payWhy:''/.test(html), 'the app asks the server what this person may do and passes the reason to the card')
  ok(/pending:\/\^\(ask\( pay\)\?\|wbox busy\)\$\//.test(html) && /done:\/\^\(ask\( pay\)\? done\|wbox done\)\$\//.test(html), 'a payment card settles like the other approval cards')
  ok(/c\.dataset\.payStatus==='pending'&&!seen\.has\(k\)\)c\.scrollIntoView\(\{block:'nearest'\}\)/.test(html), 'a new pending payment card is brought into view')
  ok(/payment:'Payments'/.test(html) && /payment:'Payment'/.test(html), 'History filter and label')
  ok(/import \{ paymentHistory \} from '\.\/pay-card\.js'/.test(client) && /m\.role === 'payment' && m\.request/.test(client) && /pay: m\.get\('role'\) === 'payment'/.test(client), 'the client carries the card and its trail into History')
  // no scripted payment in the offline demo: a payment card exists only when a server posted it
  ok(!/Approve \$\d/.test(html), 'no made-up payment in the prototype')
}
// contrast: the colors the card uses, in both themes (WCAG AA, 4.5:1 for the small text)
{
  const grab = block => Object.fromEntries([...block.matchAll(/--([a-z0-9]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1], m[2]]))
  const dark = grab(html.slice(html.indexOf(':root{'), html.indexOf('[data-theme=light]{'))); const light = grab(html.slice(html.indexOf('[data-theme=light]{'), html.indexOf('[hidden]{')))
  const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  for (const [name, t] of [['dark', dark], ['light', light]]) {
    for (const [fg, bg, what] of [['text', 'card', 'card text'], ['muted', 'card', 'facts labels and notes'], ['text', 'surface2', 'the sandbox badge'], ['bg', 'text', 'the Approve button (dark text on the light fill, or the reverse)'], ['ok', 'card', 'paid'], ['bad', 'card', 'refused']]) {
      ok(t[fg] && t[bg], `${name}: --${fg} and --${bg} exist`); const r = ratio(t[fg], t[bg]); ok(r >= 4.5, `${name} theme: ${what} (--${fg} on --${bg}) is ${r.toFixed(2)}:1, needs 4.5`)
    }
  }
  // the card never hard-codes a color that would vanish in the light theme
  const css = html.slice(html.indexOf('/* payment request cards'), html.indexOf('</style>', html.indexOf('/* payment request cards'))); ok(!/#[0-9a-fA-F]{3,6}\b/.test(css) && !/backdrop-filter|text-shadow|box-shadow|blur\(/.test(css), 'theme tokens only, flat: no blur, glow or shadow')
  ok(!/#ffffff|#fff\b/.test(fs.readFileSync(path.join(root, 'app/pay-card.js'), 'utf8').replace(/\/\/.*$/gm, '')), 'no hard-coded white text in the card')
}
console.log(`pay card tests passed (${n}): every state and the badge, Approve/Deny named with the amount, nothing charged on any end, markup-proof, one History row per change, the app wiring, contrast in both themes`)
