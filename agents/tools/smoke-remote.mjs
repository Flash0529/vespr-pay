import { fileStore } from '../../app/file-store.js'
// Smoke test of a DEPLOYED VESPR over the internet: connects like a judge would, asks the agent about the code map, asks it to start a web page
// (approving the card), then fetches the preview link through the public address. Prints results only; never prints a token.
//   node tools/smoke-remote.mjs collab.HOST [tokens-file] [user]
// It leaves two test files and some chat in the room: run deploy/judge/reset.sh afterwards.
import fs from 'node:fs'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

const host = process.argv[2]; if (!host) { console.error('usage: smoke-remote.mjs collab.HOST [tokens-file] [user]'); process.exit(2) }
const tokensFile = process.argv[3] || './deploy/judge/tokens'; const user = process.argv[4] || 'judge1'
const token = fs.readFileSync(tokensFile, 'utf8').split('\n').map(l => l.split(':')).find(p => p[0] === user)?.[1]?.trim()
if (!token) { console.error('no token for ' + user); process.exit(2) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, what, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(200) } throw new Error('timed out waiting for: ' + what) }
const results = []; const ok = (name, detail = '') => { results.push(['PASS', name, detail]); console.log('PASS', name, detail) }
const d = new Y.Doc(); const p = new WebsocketProvider(`wss://${host}/ws`, 'demo', d, { WebSocketPolyfill: WebSocket, params: { token }, disableBc: true })
try {
  await until(() => p.synced, 'the realtime connection to sync', 30000); ok('connected over wss and synced')
  const files = fileStore(d); const chat = d.getArray('chat'); const people = () => [...p.awareness.getStates().values()].map(s => s.user && s.user.name).filter(Boolean)
  const put = (name, text) => { const t = new Y.Text(); t.insert(0, text, { by: user }); files.set(name, t) }
  put('smoke_hello.py', 'def greet(name):\n    return "hi " + name\n'); put('index.html', '<html><head><title>smoke</title></head><body><h1>hello from a judge</h1><a href="/about.html">about</a></body></html>'); put('about.html', '<p>about page</p>')
  let n = 0; const say = text => { const m = new Y.Map(); const tx = new Y.Text(); d.transact(() => { m.set('id', `smoke-${Date.now()}-${++n}`); m.set('ts', Date.now()); m.set('author', user); m.set('isAgent', false); m.set('role', 'user'); m.set('text', tx); chat.push([m]); tx.insert(0, '@coder ' + text) }) }
  const find = (role, re, from = 0) => chat.toArray().slice(from).find(x => x.get('role') === role && re.test(x.get('text').toString()))
  d.getMap('settings').set('agentMode', 'manual')

  let from = chat.length; const t0 = Date.now(); say('give me a short map of this workspace: how many files and which ones are connected')
  const map = await until(() => find('tool', /asked the code map/, from), 'the agent to ask the code map', 60000); ok('agent used the code_map tool', `${Date.now() - t0} ms`)
  const ans = await until(() => { const a = chat.toArray().slice(from).filter(x => x.get('role') === 'agent' && x.get('text').toString().trim()); return a.length && a[a.length - 1] }, 'an answer about the map', 60000)
  ok('agent answered', `model ${ans.get('model')}: ${ans.get('text').toString().replace(/\s+/g, ' ').slice(0, 140)}`)

  from = chat.length; say('start the website and give me the preview link')
  const card = await until(() => chat.toArray().slice(from).find(x => x.get('role') === 'approval' && x.get('status') === 'pending'), 'an approval card for starting the server', 60000); ok('approval card appeared', card.get('text').toString().slice(0, 100).replace(/\s+/g, ' '))
  d.transact(() => { card.set('status', 'approved'); card.set('decidedBy', user) })
  const note = await until(() => find('tool', /started "[\w-]+": https?:\/\/\S+/, from), 'the preview link', 120000); const url = /started "[\w-]+": (https?:\/\/\S+)/.exec(note.get('text').toString())[1]
  ok('agent started the project', url.replace(/[0-9a-f]{24}/, '<token>'))
  const r = await fetch(url); const html = await r.text()
  if (r.status === 200 && /hello from a judge/.test(html)) ok('preview served through the public address', `HTTP ${r.status}, links rewritten: ${/href="\/preview\/[0-9a-f]{24}\/about\.html"/.test(html)}`); else throw new Error(`preview answered ${r.status}`)
  files.delete('smoke_hello.py'); files.delete('index.html'); files.delete('about.html')
  console.log(`\nALL ${results.length} CHECKS PASSED (people seen in the room: ${people().join(', ')})`)
} catch (e) { console.error('FAIL:', e.message); process.exitCode = 1 } finally { p.destroy(); setTimeout(() => process.exit(), 300) }
