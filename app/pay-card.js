// The payment request card in the room chat (server/pay.js posts it; only the server writes it). Pure ES module, no DOM or network: the app passes in the message
// (from vespr-client.js) and who is looking, and gets HTML back. Every word on the card is true to what the server does:
//   asks         an agent asked; nothing exists at PayPal yet, nothing is charged
//   approve      a person says yes here; the server then makes a PayPal order and the buyer pays on PayPal's own sandbox page (a popup)
//   captured     PayPal took the (test) money; the card shows the order and capture ids
//   denied / expired / cancelled / failed / refused: nothing was charged
// The money goes to the app's PayPal sandbox business account (Orders v2), so the card calls it a purchase from the demo merchant, never a payment to a named person.
export const BADGE = 'PayPal sandbox, no real money'
export const MERCHANT = 'the demo merchant (this app’s PayPal sandbox business account)'
export const STATES = ['pending', 'awaiting_buyer', 'captured', 'refunded', 'denied', 'expired', 'cancelled', 'failed', 'refused']
export const STATE_LABEL = { pending: 'Waiting for approval', awaiting_buyer: 'Approved, waiting for the buyer', captured: 'Paid', refunded: 'Refunded', denied: 'Denied', expired: 'Expired', cancelled: 'Cancelled', failed: 'Failed', refused: 'Refused' }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const same = (a, b) => String(a ?? '').trim() !== '' && String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
export const money = (value, currency = 'USD') => `${currency === 'USD' ? '$' : esc(currency) + ' '}${esc(value)}`
const clock = ts => ts ? new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''
const sentence = s => { const t = String(s ?? '').trim(); return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : '' }
const strong = s => `<b>${esc(s)}</b>`
const badge = `<span class="paybadge" data-testid="pay-badge">${esc(BADGE)}</span>`

// the facts everyone sees before anything happens: what is bought, why, from whom, who asked
function facts (q, m) {
  const rows = [['Buys', esc(q.label)]]
  if (q.description) rows.push(['Why', `“${esc(q.description)}”`])
  rows.push(['From', esc(MERCHANT)])
  const f = q.facts; if (f) rows.push(['Room today', `${esc(f.spent)} of ${esc(f.cap)} used in 24 hours when asked; approving leaves ${esc(f.left)}. Limit per request ${esc(f.perRequest)}.`])
  return `<dl class="paygrid">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`
}

// m: { id, author, status, decidedBy, request: { id, who, value, currency, label, description, expiresAt }, pay: { orderId, captureId, error, buyerDeadline } }
// ctx: { me, canAnswer, mark(name), ic(name) }  mark/ic draw the small icons (the app's own); canAnswer: this person may approve or deny (not an agent, has edit rights)
export function payCardHtml (m, ctx = {}) {
  const q = (m && m.request) || {}; const p = (m && m.pay) || {}
  const mark = ctx.mark || (() => ''); const ic = ctx.ic || (() => '')
  const amt = money(q.value, q.currency); const status = STATES.includes(m.status) ? m.status : 'pending'
  const id = esc(q.id || ''); const by = m.decidedBy || ''
  const aria = `Payment request, ${STATE_LABEL[status].toLowerCase()}: ${q.value} ${q.currency} for ${q.label}, asked by ${q.who || m.author}`
  const open = `<div class="ask pay" data-pay-card="${id}" data-pay-status="${status}" role="group" aria-label="${esc(aria)}">`
  const done = icon => `<div class="ask pay done" data-pay-card="${id}" data-pay-status="${status}" role="group" aria-label="${esc(aria)}"><h4>${ic(icon)}`
  const nothing = 'Nothing was charged.'
  // the server's own reason, without its final period (the card adds one) and, when it already says nothing was charged, without saying it twice
  const why = p.error ? ': ' + esc(String(p.error).replace(/[.\s]+$/, '')) : ''
  const charged = /nothing was charged/i.test(String(p.error || '')) ? '' : ' ' + nothing
  if (status === 'pending') {
    const buttons = ctx.canAnswer
      ? `<button class="btn pri" data-pay-answer="${id}" data-ok="1" data-testid="pay-approve">Approve ${amt}</button><button class="btn" data-pay-answer="${id}" data-ok="0" data-testid="pay-deny">Deny</button>`
      : `<span class="paynote" style="margin:0">${ctx.whyNot ? esc(sentence(ctx.whyNot)) + ' Waiting for someone who can approve it.' : 'Waiting for a person with edit rights to answer. An agent cannot.'}</span>`
    return `${open}<h4>${mark(q.who || m.author)}${esc(q.who || m.author)} (agent) asks to pay <span class="payamt">${amt}</span></h4>${facts(q, m)}<div class="act">${buttons}${badge}</div>`
      + `<p class="paynote">Nothing is charged unless a person approves it here and then pays on PayPal’s sandbox page.${q.expiresAt ? ` It lapses at ${esc(clock(q.expiresAt))}.` : ''}</p></div>`
  }
  if (status === 'awaiting_buyer') {
    const mine = same(ctx.me, by)
    const buttons = mine
      ? `<button class="btn pri" data-pay-open="${id}" data-testid="pay-open">Open PayPal sandbox</button><button class="btn" data-pay-check="${id}" data-testid="pay-check">Check status</button>`
      : `<span class="paynote" style="margin:0">${esc(by)} is paying on PayPal’s sandbox page.</span>`
    return `${open}<h4>${mark(q.who || m.author)}${esc(q.who || m.author)} (agent) asked to pay <span class="payamt">${amt}</span>, approved by ${strong(by)}</h4>${facts(q, m)}<div class="act">${buttons}${badge}</div>`
      + `<p class="paynote">${mine ? 'Log in to a sandbox buyer account on the PayPal window and press Pay. ' : ''}Nothing is charged until the buyer pays${p.buyerDeadline ? `; this lapses at ${esc(clock(p.buyerDeadline))}` : ''}.</p></div>`
  }
  const head = `${esc(q.who || m.author)} (agent) asked to pay <span class="payamt">${amt}</span> for ${esc(q.label)}</h4>`
  if (status === 'captured') return `${done('check')}${head}<div class="who" style="display:block">Paid. Approved by ${strong(by)}; PayPal captured it in the sandbox (test money).</div>`
    + `<p class="receipt" data-testid="pay-receipt">PayPal order ${esc(p.orderId)} · capture ${esc(p.captureId)}</p><div class="act">${ctx.canAnswer ? `<button class="btn" data-pay-refund="${id}" data-testid="pay-refund">Refund ${amt}</button>` : ''}${badge}</div></div>`
  if (status === 'refunded') return `${done('check')}${head}<div class="who" style="display:block">Refunded by ${strong(p.refundedBy)}. Paid earlier (approved by ${strong(by)}); PayPal returned the test money to the buyer.</div>`
    + `<p class="receipt" data-testid="pay-receipt">PayPal order ${esc(p.orderId)} · capture ${esc(p.captureId)}${p.refundId ? ' · refund ' + esc(p.refundId) : ''}</p><div class="act">${badge}</div></div>`
  if (status === 'denied') return `${done('x')}${head}<div class="who" style="display:block">Denied by ${strong(by)}. ${nothing}</div><div class="act">${badge}</div></div>`
  if (status === 'expired') return `${done('x')}${head}<div class="who" style="display:block">Lapsed: nobody finished it in time. ${nothing}</div><div class="act">${badge}</div></div>`
  if (status === 'cancelled') return `${done('x')}${head}<div class="who" style="display:block">Cancelled on PayPal. ${nothing}</div><div class="act">${badge}</div></div>`
  if (status === 'failed') return `${done('x')}${head}<div class="who" style="display:block">PayPal did not complete it${why}.${charged}</div><div class="act">${badge}</div></div>`
  return `${done('x')}${head}<div class="who" style="display:block">Refused by the server${why}. Nobody was asked.${charged}</div><div class="act">${badge}</div></div>`
}

// one History row per state change (the card's trail), newest first is the caller's job: same shape as the rest of History (see vespr-client.js history())
const VERB = { proposed: 'asked to pay', pending: 'asked to pay', awaiting_buyer: 'approved', captured: 'captured', refunded: 'refunded', denied: 'denied', expired: 'let expire', cancelled: 'cancelled', failed: 'could not complete', refused: 'refused' }
export function paymentHistory (m) {
  const q = m.request || {}; const trail = (m.pay && Array.isArray(m.pay.trail)) ? m.pay.trail : []
  const target = `${q.value ? (q.currency === 'USD' ? '$' : q.currency + ' ') + q.value : 'a payment'} for ${q.label || 'something'}`
  return trail.filter(t => t && typeof t.ts === 'number').map((t, i) => ({
    id: `pay-${m.id}-${i}`, ts: t.ts, who: String(t.by || 'server'), kind: same(t.by, q.who) ? 'agent' : ['PayPal', 'server', 'buyer'].includes(t.by) ? 'system' : 'person', model: '', type: 'payment',
    verb: VERB[t.to] || String(t.to || ''), target, detail: String(t.note || ''), file: '', plus: 0, minus: 0, extra: { why: `${BADGE}${m.pay && m.pay.orderId ? ' · PayPal order ' + m.pay.orderId : ''}` }
  }))
}
