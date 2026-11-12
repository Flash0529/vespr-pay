// The payments ledger: every payment request in the room as a sortable, filterable table (AG Grid Community, MIT, vendored in app/vendor/, no CDN), and a receipt for the row
// you open. Pure ES module: it builds rows, column definitions, grid options and receipt HTML from the server's list (GET /api/pay/<room>, server/pay.js); the app draws it.
// Nothing here is made up: a row is exactly one payment request the server holds, and the receipt is read from that request's own trail.
import { STATE_LABEL, BADGE, MERCHANT } from './pay-card.js'

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const sym = c => (c === 'USD' ? '$' : String(c || '') + ' ')
export const amountText = (value, currency = 'USD') => `${sym(currency)}${value}`
const when = ts => (ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const clock = ts => (ts ? new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '')

// one row per payment request, newest first; the whole request rides along so the receipt needs no second fetch
export function ledgerRows (requests) {
  return (Array.isArray(requests) ? requests : []).filter(r => r && typeof r.id === 'string').map(r => ({
    id: r.id, ts: Number(r.ts) || 0, requester: String(r.requester || ''), what: String(r.label || ''), amount: Number(r.value) || 0, amountText: amountText(r.value, r.currency),
    status: String(r.status || ''), statusText: STATE_LABEL[r.status] || String(r.status || ''), decidedBy: String(r.decidedBy || ''), orderId: String(r.orderId || ''), request: r
  })).sort((a, b) => b.ts - a.ts)
}

// Column definitions. Every column sorts and filters (Community filters: text, number, date). Status is words, never colour alone; the dot is extra.
export function columnDefs () {
  return [
    { colId: 'ts', headerName: 'Time', field: 'ts', sort: 'desc', width: 148, minWidth: 140, flex: 0, filter: 'agDateColumnFilter', filterValueGetter: p => (p.data ? new Date(p.data.ts) : null), valueFormatter: p => when(p.value), comparator: (a, b) => a - b },
    { colId: 'requester', headerName: 'Asked by', field: 'requester', minWidth: 100, filter: 'agTextColumnFilter' },
    { colId: 'what', headerName: 'What', field: 'what', minWidth: 120, flex: 2, filter: 'agTextColumnFilter' },
    { colId: 'amount', headerName: 'Amount', field: 'amount', type: 'numericColumn', minWidth: 100, filter: 'agNumberColumnFilter', valueFormatter: p => (p.data ? p.data.amountText : '') },
    { colId: 'status', headerName: 'Status', field: 'statusText', minWidth: 126, filter: 'agTextColumnFilter', cellClass: p => 'plst plst-' + (p.data ? p.data.status : '') },
    { colId: 'decidedBy', headerName: 'Decided by', field: 'decidedBy', minWidth: 112, filter: 'agTextColumnFilter', valueFormatter: p => p.value || '—' },
    { colId: 'orderId', headerName: 'PayPal order', field: 'orderId', minWidth: 150, flex: 1.3, filter: 'agTextColumnFilter', cellClass: 'plmono', valueFormatter: p => p.value || '—' }
  ]
}

// The grid wears the app's own colours (CSS variables), so both themes work and nothing is hard-coded.
export function gridTheme (agGrid) {
  return agGrid.themeQuartz.withParams({
    backgroundColor: 'var(--surface)', foregroundColor: 'var(--text)', headerBackgroundColor: 'var(--surface2)', headerTextColor: 'var(--text)', borderColor: 'var(--hair2)',
    accentColor: 'var(--agent)', rowHoverColor: 'var(--surface2)', selectedRowBackgroundColor: 'var(--agent-bg)', oddRowBackgroundColor: 'var(--surface)',
    fontFamily: 'var(--font)', fontSize: 12, headerFontSize: 11.5, headerFontWeight: 600, rowBorder: true, wrapperBorderRadius: 10, inputBackgroundColor: 'var(--input)'
  })
}

// Grid options. A click or Enter / Space on a row opens its receipt; arrow keys, Tab, sort and filter are the grid's own (keyboard reachable).
export function gridOptions (agGrid, { rows = [], onOpen = () => {} } = {}) {
  return {
    theme: gridTheme(agGrid), rowData: rows, columnDefs: columnDefs(), defaultColDef: { sortable: true, filter: true, floatingFilter: true, resizable: true, flex: 1 }, // a filter box under every heading: filtering is visible and keyboard reachable, and the headings keep their full words
    getRowId: p => p.data.id, rowSelection: { mode: 'singleRow', checkboxes: false, enableClickSelection: true }, animateRows: false,
    overlayNoRowsTemplate: '<span>No payment requests in this room yet.</span>',
    onRowClicked: e => { if (e.data) onOpen(e.data) },
    onCellKeyDown: e => { const k = e.event && e.event.key; if (e.data && (k === 'Enter' || k === ' ')) { e.event.preventDefault(); onOpen(e.data) } }
  }
}

// The receipt for one request: what, how much, who asked and decided, the agent's reason and the server's facts, the PayPal ids, and every step with its actor.
export function receiptHtml (r) {
  if (!r) return ''
  const rows = [['Asked by', `${esc(r.requester)} (agent)`], ['Reason', r.description ? `“${esc(r.description)}”` : '—'], ['From', esc(MERCHANT)]]
  if (r.facts) rows.push(['Room today', `${esc(r.facts.spent)} of ${esc(r.facts.cap)} used in 24 hours when asked; approving left ${esc(r.facts.left)}. Limit per request ${esc(r.facts.perRequest)}.`])
  if (r.decidedBy) rows.push([r.status === 'denied' ? 'Denied by' : 'Approved by', esc(r.decidedBy)])
  if (r.refundedBy) rows.push(['Refunded by', esc(r.refundedBy)])
  if (r.orderId) rows.push(['PayPal order', `<code>${esc(r.orderId)}</code>`])
  if (r.captureId) rows.push(['PayPal capture', `<code>${esc(r.captureId)}</code>`])
  if (r.refundId) rows.push(['PayPal refund', `<code>${esc(r.refundId)}</code>`])
  if (r.error) rows.push(['Note', esc(r.error)])
  const steps = (Array.isArray(r.trail) ? r.trail : []).filter(t => t && typeof t.ts === 'number').map(t => `<li><time>${esc(clock(t.ts))}</time> <b>${esc(t.by)}</b> ${esc(t.note || t.to)}</li>`).join('')
  return `<article class="plrec" data-pl-receipt="${esc(r.id)}" aria-label="Receipt: ${esc(amountText(r.value, r.currency))} for ${esc(r.label)}, ${esc((STATE_LABEL[r.status] || r.status).toLowerCase())}">`
    + `<h3><span class="payamt">${esc(amountText(r.value, r.currency))}</span> for ${esc(r.label)}</h3><p class="plstate">${esc(STATE_LABEL[r.status] || r.status)}</p>`
    + `<dl class="paygrid">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`
    + `<h4>Steps</h4><ol class="plsteps">${steps}</ol><div class="act"><button class="btn" data-pl-chat="${esc(r.id)}" data-testid="pl-show-in-chat">Show in chat</button><span class="paybadge">${esc(BADGE)}</span></div></article>`
}

// CSV of the rows as shown to the grid (also available from the grid's own export): time, asked by, what, amount, status, decided by, order id
export function csvOf (rows) {
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"'
  return ['time,requested by,what,amount,status,decided by,paypal order'].concat(rows.map(r => [new Date(r.ts).toISOString(), r.requester, r.what, r.amountText, r.statusText, r.decidedBy, r.orderId].map(q).join(','))).join('\n')
}
