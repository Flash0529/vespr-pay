// netsim: a user-space TCP proxy that makes one connection behave like a real-world network (no root, touches no other traffic).
// Each direction gets delay + jitter (order kept, as TCP keeps it), a bandwidth cap, random stalls (a congested or mobile link)
// and, optionally, a dropped connection every so often (a phone changing towers). Used by agents/tools/net-world.mjs and ai-latency.mjs.
// A side that finishes closes the other only after everything already in flight has been delivered (HTTP request/response needs it).
//   node scripts/netsim.mjs <listenPort> <targetHost:port> <profile>      profiles: see PROFILES below
//   import { startNetsim, PROFILES } from './netsim.mjs'; const sim = await startNetsim({ listen, target, profile }); sim.close()
// The numbers are typical round-trip conditions, not measurements of any one provider.
import net from 'node:net'

export const PROFILES = {
  lan: { label: 'same building (LAN)', oneWayMs: 1, jitterMs: 0 },
  region: { label: 'same region, ~30 ms round trip', oneWayMs: 15, jitterMs: 5 },
  continent: { label: 'across a continent or the Atlantic, ~100 ms', oneWayMs: 50, jitterMs: 10 },
  far: { label: 'other side of the world, ~280 ms', oneWayMs: 140, jitterMs: 30 },
  mobile: { label: 'busy mobile data, ~300 ms, 400 kbit/s, stalls', oneWayMs: 150, jitterMs: 80, kbps: 400, stallChance: 0.02, stallMs: 800 },
  satellite: { label: 'geostationary satellite, ~600 ms, stalls', oneWayMs: 300, jitterMs: 50, kbps: 2000, stallChance: 0.01, stallMs: 1500 },
  flaky: { label: 'flaky Wi-Fi: ~160 ms and the connection drops every ~15 s', oneWayMs: 80, jitterMs: 40, dropEverySec: 15 }
}

// one direction of one connection: chunks leave in order, each no earlier than its arrival + delay (+ transfer time at the cap).
// One queue and one timer per direction: a timer per chunk reorders bytes when times round differently (it corrupted WebSocket
// frames in a 2026-11-04 run, and the receiver went silent while the connection still looked open).
function lane (dst, p, rand) {
  let nextFree = 0; const queue = []; let timer = null
  const pump = () => {
    timer = null
    while (queue.length && queue[0].at <= Date.now() + 0.5) { const { chunk } = queue.shift(); if (!dst.destroyed && dst.writable) dst.write(chunk) }
    if (queue.length) timer = setTimeout(pump, Math.max(0, Math.ceil(queue[0].at - Date.now())))
  }
  const push = chunk => {
    const now = Date.now()
    let at = now + p.oneWayMs + (p.jitterMs ? (rand() * 2 - 1) * p.jitterMs : 0)
    if (p.stallChance && rand() < p.stallChance) at += p.stallMs
    if (p.kbps) at = Math.max(at, nextFree) + (chunk.length * 8) / p.kbps // ms at kbit/s
    at = Math.max(at, nextFree) // never earlier than what is already queued
    nextFree = at
    queue.push({ at, chunk })
    if (!timer) timer = setTimeout(pump, Math.max(0, Math.ceil(at - now)))
  }
  push.flushedIn = () => Math.max(0, nextFree - Date.now()) + p.oneWayMs + 5 // when everything queued has gone out
  return push
}

export function startNetsim ({ listen, host = '127.0.0.1', target, profile, rand = Math.random, onDrop = () => {} }) {
  const p = typeof profile === 'string' ? PROFILES[profile] : profile
  if (!p) throw new Error(`unknown profile ${profile}; one of ${Object.keys(PROFILES).join(', ')}`)
  const [th, tp] = String(target).split(':'); const conns = new Set()
  const server = net.createServer({ allowHalfOpen: true }, client => { // half-open: a client that finished sending can still receive
    const up = net.connect({ port: Number(tp), host: th, allowHalfOpen: true }); conns.add(client); conns.add(up)
    client.setNoDelay(true); up.setNoDelay(true)
    const toUp = lane(up, p, rand); const toClient = lane(client, p, rand)
    client.on('data', toUp); up.on('data', toClient)
    let gone = false
    const kill = () => { if (gone) return; gone = true; client.destroy(); up.destroy(); conns.delete(client); conns.delete(up) }
    // a side that finishes closes the other side only after what was already in flight toward it has been delivered
    client.on('end', () => setTimeout(() => { if (!up.destroyed) up.end() }, toUp.flushedIn()))
    up.on('end', () => setTimeout(() => { if (!client.destroyed) client.end() }, toClient.flushedIn()))
    client.on('close', () => setTimeout(kill, toUp.flushedIn() + 50)); up.on('close', () => setTimeout(kill, toClient.flushedIn() + 50))
    client.on('error', kill); up.on('error', kill)
    if (p.dropEverySec) { // exponential gaps around the mean, like real drop-outs: this one is meant to cut mid-flight
      const t = setTimeout(() => { onDrop(); kill() }, -Math.log(1 - rand()) * p.dropEverySec * 1000)
      client.on('close', () => clearTimeout(t))
    }
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(listen, host, () => resolve({ port: server.address().port, profile: p, close: () => { for (const c of conns) c.destroy(); server.close() } }))
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [listen, target, profile] = process.argv.slice(2)
  if (!listen || !target || !profile) { console.error(`usage: node scripts/netsim.mjs <listenPort> <host:port> <${Object.keys(PROFILES).join('|')}>`); process.exit(2) }
  const sim = await startNetsim({ listen: Number(listen), target, profile, onDrop: () => console.log(new Date().toISOString(), 'dropped a connection') })
  console.log(`netsim ${profile} (${sim.profile.label}) on 127.0.0.1:${sim.port} -> ${target}`)
}
