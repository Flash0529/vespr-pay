// The browser client must stop reconnecting, and say why, when the server ends its connection on purpose: a share link turned off (4403), expired (4401) or a
// sign-out (4401 with another reason). Before 2026-11-10 a revoked guest sat on "connecting" forever. Uses a stand-in provider (no network).
import assert from 'node:assert'
import * as Y from 'yjs'
import { createClient } from '../../app/vespr-client.js'

class FakeProvider {
  constructor () { this.handlers = {}; this.shouldConnect = true; this.awareness = { setLocalStateField () {}, on () {}, getStates: () => new Map(), clientID: 1, setLocalState () {} } }
  on (ev, fn) { (this.handlers[ev] ||= []).push(fn) }
  once (ev, fn) { if (ev === 'sync') queueMicrotask(fn); else this.on(ev, fn) }
  emit (ev, arg) { for (const f of this.handlers[ev] || []) f(arg) }
  destroy () {}
}
let provider
class P extends FakeProvider { constructor (...a) { super(...a); provider = this } }
const make = async () => { const c = createClient({ server: 'ws://x', room: 'r', token: 't', name: 'guest', deps: { Y, WebsocketProvider: P, WebSocketPolyfill: class {} } }); await c.ready; return c }
const tick = () => new Promise(r => setTimeout(r, 5))

for (const [code, reason, want] of [[4403, 'revoked', 'revoked'], [4401, 'expired', 'expired'], [4401, 'signed out', 'signed-out']]) {
  const c = await make(); const seen = []; c.on('change', w => seen.push(w))
  assert.strictEqual(c.get().status, 'connected')
  provider.emit('connection-close', { code, reason }); await tick()
  assert.strictEqual(c.get().status, 'ended', `${code}/${reason}: ended`)
  assert.strictEqual(c.get().endedWhy, want, `${code}/${reason}: why`)
  assert.strictEqual(provider.shouldConnect, false, `${code}/${reason}: no more reconnecting`)
  assert.ok(seen.includes('status'), 'the app is told')
  provider.emit('status', { status: 'connecting' }); await tick()
  assert.strictEqual(c.get().status, 'ended', 'a late status event does not bring it back')
  c.destroy()
}
{ // an ordinary drop (1006) is not an end: it keeps trying, and a refused change (4409) still works as before
  const c = await make(); provider.emit('connection-close', { code: 1006 }); await tick()
  assert.strictEqual(c.get().status, 'connected'); assert.strictEqual(provider.shouldConnect, true); assert.strictEqual(c.get().endedWhy, '')
  provider.emit('connection-close', { code: 4409, reason: 'not allowed: x' }); await tick()
  assert.strictEqual(c.get().status, 'refused'); assert.strictEqual(c.get().refused, 'not allowed: x'); c.destroy()
}
console.log('client ended tests passed')
