// The payments ledger (app/pay-ledger.js): rows come straight from the server's list, the receipt is read from each request's own trail and cannot inject markup, the
// grid options open a receipt on click and on Enter or Space, and the table library (AG Grid Community, MIT) is vendored unchanged, recorded in the licence files and loaded
// from the app's own folder, never from a CDN. Pure functions plus string and file checks; the real grid was driven in a browser (docs/PAYPAL.md lists how).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ledgerRows, columnDefs, gridOptions, gridTheme, receiptHtml, csvOf, amountText } from '../pay-ledger.js'
import { BADGE } from '../pay-card.js'

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const rd = f => fs.readFileSync(path.join(root, f), 'utf8')
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++ }; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++ }

const t0 = Date.UTC(2026, 10, 12, 5, 0)
const req = (over = {}) => ({ id: 'r1', requester: 'coder', value: '25.00', currency: 'USD', label: 'Logo design invoice', description: 'Invoice 42 from the designer', status: 'captured', decidedBy: 'alex', orderId: 'ORD1', captureId: 'CAP1', refundId: '', refundedBy: '', error: '', ts: t0, trail: [{ ts: t0, to: 'pending', by: 'coder', note: 'asked to pay $25.00 for Logo design invoice' }, { ts: t0 + 60_000, to: 'awaiting_buyer', by: 'alex', note: 'approved; PayPal order ORD1 created' }, { ts: t0 + 90_000, to: 'captured', by: 'PayPal', note: 'captured $25.00; capture CAP1' }], facts: { spent: '$0.00', cap: '$100.00', left: '$75.00', perRequest: '$50.00' }, ...over })

// rows: one per request, newest first, numbers are numbers, words are words
{
  const rows = ledgerRows([req({ id: 'a', ts: t0 }), req({ id: 'b', ts: t0 + 5000, status: 'denied', value: '12.5', decidedBy: 'bob', orderId: '' }), null, { nope: 1 }, req({ id: 'c', ts: t0 + 9000, status: 'refused', value: '75.00', decidedBy: '', orderId: '' })])
  eq(rows.map(r => r.id), ['c', 'b', 'a'], 'newest first; rows with no id are dropped'); eq(rows.map(r => r.amount), [75, 12.5, 25]); eq(rows.map(r => r.statusText), ['Refused', 'Denied', 'Paid'])
  eq([rows[1].amountText, rows[1].decidedBy, rows[1].orderId], ['$12.5', 'bob', '']); ok(rows[2].request.trail.length === 3, 'the whole request rides along'); eq(ledgerRows(undefined), []); eq(ledgerRows('x'), []); eq(amountText('5.00', 'EUR'), 'EUR 5.00')
}
// columns: the seven the ledger promises, all sortable and filterable, newest first by default, numbers sort as numbers
{
  const cols = columnDefs(); eq(cols.map(c => c.headerName), ['Time', 'Asked by', 'What', 'Amount', 'Status', 'Decided by', 'PayPal order']); ok(cols.every(c => typeof c.filter === 'string' && /^ag(Text|Number|Date)ColumnFilter$/.test(c.filter)), 'Community filters only (text, number, date)')
  eq(cols.find(c => c.sort).colId, 'ts'); eq(cols.find(c => c.sort).sort, 'desc'); eq(cols.find(c => c.colId === 'amount').type, 'numericColumn'); eq(cols.find(c => c.colId === 'ts').comparator(5, 3) > 0, true)
  eq(cols.find(c => c.colId === 'decidedBy').valueFormatter({ value: '' }), '—', 'empty cells say so'); eq(cols.find(c => c.colId === 'orderId').valueFormatter({ value: 'ORD' }), 'ORD')
  eq(cols.find(c => c.colId === 'status').cellClass({ data: { status: 'captured' } }), 'plst plst-captured', 'status has words plus a dot class, never colour alone'); ok(cols.find(c => c.colId === 'ts').valueFormatter({ value: t0 }).length > 5)
}
// grid options with a fake grid library
{
  let themeParams = null; const fake = { themeQuartz: { withParams: p => { themeParams = p; return { theme: 'fake', p } } } }
  const opened = []; const o = gridOptions(fake, { rows: [{ id: 'x' }], onOpen: r => opened.push(r.id) })
  ok(o.theme.theme === 'fake' && o.rowData.length === 1 && o.columnDefs.length === 7 && o.getRowId({ data: { id: 'q' } }) === 'q'); eq(o.rowSelection, { mode: 'singleRow', checkboxes: false, enableClickSelection: true }); eq(o.defaultColDef.sortable, true); eq(o.defaultColDef.filter, true); eq(o.defaultColDef.floatingFilter, true); ok(/No payment requests/.test(o.overlayNoRowsTemplate))
  o.onRowClicked({ data: { id: 'clicked' } }); o.onRowClicked({}); let prevented = 0
  for (const key of ['Enter', ' ']) o.onCellKeyDown({ data: { id: 'key-' + key.trim() }, event: { key, preventDefault: () => { prevented++ } } })
  o.onCellKeyDown({ data: { id: 'no' }, event: { key: 'a', preventDefault: () => { prevented++ } } }); o.onCellKeyDown({ event: { key: 'Enter', preventDefault: () => {} } })
  eq(opened, ['clicked', 'key-Enter', 'key-'], 'click, Enter and Space open a receipt; other keys and empty rows do not'); eq(prevented, 2)
  gridTheme(fake); ok(Object.entries(themeParams).filter(([k, v]) => /Color$/.test(k)).every(([, v]) => /^var\(--[a-z0-9-]+\)$/.test(v)), 'every colour is one of the app’s theme variables: both themes, nothing hard-coded')
}
// the receipt: facts, ids, every step with its actor; the agent's words are data
{
  const h = receiptHtml(req({ status: 'refunded', refundId: 'REF1', refundedBy: 'terry' }))
  ok(h.includes('<h3><span class="payamt">$25.00</span> for Logo design invoice</h3>') && h.includes('<p class="plstate">Refunded</p>') && h.includes('data-pl-receipt="r1"') && h.includes(BADGE) && h.includes('data-pl-chat="r1"'))
  for (const s of ['coder (agent)', '“Invoice 42 from the designer”', 'the demo merchant', '$0.00 of $100.00 used in 24 hours when asked; approving left $75.00', '<dt>Approved by</dt><dd>alex</dd>', '<dt>Refunded by</dt><dd>terry</dd>', '<code>ORD1</code>', '<code>CAP1</code>', '<code>REF1</code>']) ok(h.includes(s), s)
  eq([...h.matchAll(/<li><time>[^<]*<\/time> <b>([^<]*)<\/b>/g)].map(m => m[1]), ['coder', 'alex', 'PayPal'], 'a step per state change, with who did it')
  ok(receiptHtml(req({ status: 'denied', decidedBy: 'bob' })).includes('<dt>Denied by</dt><dd>bob</dd>')); ok(receiptHtml(req({ status: 'refused', decidedBy: '', error: 'over the limit', orderId: '', captureId: '' })).includes('<dt>Note</dt><dd>over the limit</dd>')); eq(receiptHtml(null), '')
  const evil = '<img src=x onerror=alert(1)>"\'&'; const e = receiptHtml(req({ label: evil, requester: evil, description: evil, decidedBy: evil, orderId: evil, error: evil, trail: [{ ts: t0, to: 'x', by: evil, note: evil }], facts: { spent: evil, cap: evil, left: evil, perRequest: evil } }))
  ok(!e.includes('<img') && !/<[a-z][^>]*\son[a-z]+=/i.test(e.replace(/aria-label="[^"]*"/g, '')), 'nothing the agent typed becomes markup'); ok(e.includes('&lt;img src=x onerror=alert(1)&gt;'))
}
eq(csvOf(ledgerRows([req({ label: 'He said "hi"' })])).split('\n')[1].split('","')[2], 'He said ""hi""', 'CSV quotes are doubled'); eq(csvOf([]).split('\n').length, 1)

// the app: a labelled modal dialog, a named button, the library loaded from the app's own folder, focus back to a visible control, live refresh
{
  const html = rd('app/prototype.html')
  ok(/<div class="scrim" id="plScrim" hidden><div class="sheet payledger" role="dialog" aria-modal="true" aria-labelledby="plTitle">/.test(html), 'a modal dialog the existing Tab trap and Esc handling already cover')
  ok(/<label class="plsearch"><span class="plsr">Search payments<\/span><input id="plSearch"/.test(html) && /id="plX" aria-label="Close payments"/.test(html) && /id="payLedgerBtn" data-testid="open-payments" aria-label="Payments ledger"/.test(html), 'every control has a name')
  ok(/s\.src='vendor\/ag-grid-community\.min\.js'/.test(html) && /import\('\.\/pay-ledger\.js'\)/.test(html), 'the table library comes from the app’s own folder'); ok(!/https?:\/\/[^"' ]*(unpkg|jsdelivr|cdnjs|ag-grid)/i.test(html), 'no CDN or outside address for it')
  ok(/PLopener&&PLopener\.isConnected&&PLopener\.offsetParent\?PLopener:\$\('#developerToolsBtn'\)/.test(html), 'closing returns focus to a control you can see'); ok(/!\$\('#plScrim'\)\.hidden && PLm\) plRefresh\(\)/.test(html), 'the table follows the room live while open')
  ok(/data-pl-chat/.test(html) && /payApi\(''\)/.test(html), 'Show in chat; the list is the server’s own')
}
// the library: vendored unchanged, MIT, version and checksum recorded, listed in THIRD-PARTY.md
{
  const lib = fs.readFileSync(path.join(root, 'app/vendor/ag-grid-community.min.js')); const sum = crypto.createHash('sha256').update(lib).digest('hex')
  ok(/^\(function\([A-Za-z]+,[A-Za-z]+\)\{typeof exports=="object"/.test(lib.slice(0, 120).toString()) && lib.includes('themeQuartz') && lib.includes('createGrid'), 'the UMD build, with the theming API')
  const lic = rd('app/vendor/LICENSES.txt'); ok(lic.includes('AG Grid Community 36.2.0') && lic.includes(sum) && /The MIT License/.test(lic.slice(lic.indexOf('AG Grid Community'))) && /Copyright \(c\) 2015-2026 AG GRID LTD/.test(lic), 'version, checksum and the licence text are recorded')
  const tp = rd('THIRD-PARTY.md'); ok(/AG Grid Community 36\.2\.0[^|]*\|[^|]*\|\s*MIT\s*\|[^|]*app\/vendor\/ag-grid-community\.min\.js/.test(tp), 'listed in THIRD-PARTY.md')
}
console.log(`pay ledger tests passed (${n}): rows from the server's list, seven sortable filterable columns, click/Enter/Space open a receipt, markup-proof receipts with every step's actor, theme variables only, the app wiring, AG Grid Community vendored unchanged with its MIT licence recorded and no CDN`)
