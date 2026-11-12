// app/connectors-panel.js: the Connectors tab and the after-sign-in card draw the server's states honestly and escape everything.
import assert from 'node:assert'
import { panelHtml, offerHtml } from '../connectors-panel.js'

const view = { connectors: [
  { id: 'google_drive', name: 'Google Drive', provider: 'Google', category: 'Files and docs', what: 'Open and save the files you pick in Drive.', status: 'connected', account: 'ann@gmail.com', note: null },
  { id: 'gmail', name: 'Gmail', provider: 'Google', category: 'Mail and calendar', what: 'Read mail.', status: 'available', account: null, note: null },
  { id: 'slack', name: 'Slack', provider: 'Slack', category: 'Chat', what: 'Search channels.', status: 'not_set_up', account: null, note: 'Not set up on this server yet: the operator has to add VESPR\'s Slack app keys.' },
  { id: 'evil', name: '<img src=x onerror=alert(1)>', provider: 'X', category: 'Code', what: '"><script>', status: 'needs_reconnect', account: '<b>', note: null }
], suggest: [] }
let n = 0
const html = panelHtml(view)
assert.match(html, /data-conn-off="google_drive"/); n++
assert.match(html, /Account: <code>ann@gmail\.com<\/code>/); n++
assert.match(html, /data-conn-on="gmail"/); n++
assert.ok(!/data-conn-on="slack"|data-conn-off="slack"/.test(html), 'not set up: no button'); n++
assert.match(html, /Not set up yet/); assert.match(html, /operator has to add/); n++
assert.match(html, /data-conn-on="evil"/, 'needs reconnect: Connect'); n++
assert.ok(!html.includes('<img src=x') && !html.includes('"><script>') && !html.includes('<code><b>'), 'escaped'); n++
assert.ok(html.indexOf('Files and docs') < html.indexOf('Mail and calendar'), 'category order'); n++
assert.match(html, /1 connected\./); n++
const only = panelHtml(view, 'slack'); assert.ok(only.includes('data-conn="slack"') && !only.includes('data-conn="gmail"'), 'search'); n++
assert.match(panelHtml(view, 'zzz'), /No connector matches/); n++
const card = offerHtml([{ family: 'google', provider: 'Google', ids: ['google_drive', 'gmail'], names: { google_drive: 'Google Drive', gmail: 'Gmail' } }])
assert.match(card, /Connect your Google services\?/); n++
assert.match(card, /data-offer-id="google_drive" checked/); assert.match(card, /data-offer-id="gmail" >/, 'mail is never pre-ticked'); n++
assert.strictEqual(offerHtml([]), ''); n++
console.log(`connectors panel tests passed (${n})`)
