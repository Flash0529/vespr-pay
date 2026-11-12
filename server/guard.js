// Abuse limits for one public VM (0-5,000 accounts): nobody, signed in or not, can use up the server's CPU, memory, disk or model budget.
// Every limit is per minute or per open socket, counted in memory (a restart forgets counts, which only ever loosens a limit for a minute).
//   const guard = createGuard({ trustProxy, dataDir })
//   guard.http(req, res)                 true when refused (429): every /api/ and /auth/ request counts against the caller's address
//   guard.upgrade(req, socket)           true when refused: new sockets a minute and open sockets from one address
//   guard.account(who, socket)           true when refused: open sockets for one account
//   guard.attach(ws, who, ip)            counts the socket and meters what it sends (bytes a minute per account); closes it past the budget
//   guard.newRoom(who, room)             false past the new-workspaces-a-day cap or when the disk is nearly full
//   guard.take(key, perMinute)           a named counter for one feature (inline suggestions, vault writes)
//   guard.diskOk()                       false when free space on the data disk is under the floor
// Limits come from the environment so the operator can loosen one without a code change (VESPR_LIMIT_*; see LIMITS below).
import fs from 'node:fs'

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d }

export function limitsFrom (env = process.env) {
  return {
    ipPerMin: num(env.VESPR_LIMIT_IP_PER_MIN, 900), // HTTP requests a minute from one address (the app makes ~5-20 a minute; a school behind one NAT makes many)
    upgradesPerMin: num(env.VESPR_LIMIT_UPGRADES_PER_MIN, 120), // new sockets a minute from one address
    socketsPerUser: num(env.VESPR_LIMIT_SOCKETS_PER_USER, 40), // open sockets for one account (a few workspaces on a few devices)
    socketsPerIp: num(env.VESPR_LIMIT_SOCKETS_PER_IP, 400),
    bytesPerMin: num(env.VESPR_LIMIT_MB_PER_MIN, 32) * 1024 * 1024, // what one account may send over its sockets a minute
    maxMessage: num(env.VESPR_LIMIT_MESSAGE_MB, 16) * 1024 * 1024, // one socket message (the ws default is 100 MB)
    roomsPerDay: num(env.VESPR_LIMIT_ROOMS_PER_DAY, 25), // new workspaces one account may start a day
    diskFloor: num(env.VESPR_LIMIT_DISK_FLOOR_GB, 3) * 1024 * 1024 * 1024 // below this much free space nothing new is stored
  }
}

export function createGuard ({ trustProxy = false, dataDir = '.', limits = limitsFrom(), now = Date.now, statfs = p => fs.statfsSync(p), log = m => console.log(m) } = {}) {
  const L = limits
  const windows = new Map() // key -> { n, at }
  const userSockets = new Map(); const ipSockets = new Map() // key -> open count
  const meters = new Map() // account -> { bytes, at }
  const roomsToday = new Map() // account -> { n, day }
  let disk = { at: -Infinity, ok: true }
  let warned = 0

  const clientIp = req => {
    const fwd = String(req.headers?.['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean)
    return (trustProxy && fwd.length ? fwd[fwd.length - 1] : req.socket?.remoteAddress) || '?'
  }
  function take (key, perMinute) {
    const t = now(); const w = windows.get(key)
    if (!w || t - w.at >= 60_000) { windows.set(key, { n: 1, at: t }); return true }
    return ++w.n <= perMinute
  }
  function note (what) { const t = now(); if (t - warned > 60_000) { warned = t; log('guard: refused ' + what) } } // at most one line a minute, never a token
  const bump = (map, k, d) => { const n = (map.get(k) || 0) + d; if (n > 0) map.set(k, n); else map.delete(k) }

  function http (req, res) {
    const p = String(req.url || '').split('?')[0]
    if (!(p.startsWith('/api/') || p.startsWith('/auth/') || p.startsWith('/git/'))) return false
    if (take('ip:' + clientIp(req), L.ipPerMin)) return false
    note('http ' + p.split('/').slice(0, 3).join('/'))
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' }); res.end(JSON.stringify({ error: 'Too many requests from this address. Wait a minute.' }))
    return true
  }

  function refuse (socket, why) {
    note(why)
    try { socket.write('HTTP/1.1 429 Too Many Requests\r\nRetry-After: 60\r\n\r\n'); socket.destroy() } catch {}
    return true
  }
  // before anyone is known: new sockets a minute and open sockets from one address
  function upgrade (req, socket) {
    const ip = clientIp(req)
    if (!take('up:' + ip, L.upgradesPerMin)) return refuse(socket, 'new sockets a minute')
    if ((ipSockets.get(ip) || 0) >= L.socketsPerIp) return refuse(socket, 'open sockets for one address')
    return false
  }
  // once the account is known: its open sockets
  function account (who, socket) {
    return Boolean(who) && (userSockets.get(who) || 0) >= L.socketsPerUser && refuse(socket, 'open sockets for one account')
  }

  function attach (ws, who, ip) {
    if (who) bump(userSockets, who, 1)
    bump(ipSockets, ip, 1)
    ws.on('close', () => { if (who) bump(userSockets, who, -1); bump(ipSockets, ip, -1) })
    const key = who || 'ip:' + ip
    ws.on('message', data => {
      const t = now(); let m = meters.get(key)
      if (!m || t - m.at >= 60_000) meters.set(key, m = { bytes: 0, at: t })
      m.bytes += data?.length || 0
      if (m.bytes > L.bytesPerMin) { note('socket bytes a minute'); try { ws.close(1008, 'sending too much; wait a minute') } catch {} }
    })
  }

  function diskOk () {
    const t = now()
    if (t - disk.at < 30_000) return disk.ok
    let ok = true
    try { const s = statfs(dataDir); ok = s.bavail * s.bsize >= L.diskFloor } catch {}
    if (!ok && disk.ok) log('guard: the data disk is nearly full; new workspaces and uploads are refused')
    disk = { at: t, ok }
    return ok
  }

  function newRoom (who) {
    if (!diskOk()) return false
    const day = Math.floor(now() / 86_400_000); const r = roomsToday.get(who)
    if (!r || r.day !== day) { roomsToday.set(who, { n: 1, day }); return true }
    if (r.n >= L.roomsPerDay) { note('new workspaces a day'); return false }
    r.n++; return true
  }

  // the counters forget idle keys every few minutes, so memory stays flat however many addresses call
  const sweep = setInterval(() => {
    const t = now()
    for (const [k, w] of windows) if (t - w.at >= 60_000) windows.delete(k)
    for (const [k, m] of meters) if (t - m.at >= 60_000) meters.delete(k)
    const day = Math.floor(t / 86_400_000); for (const [k, r] of roomsToday) if (r.day !== day) roomsToday.delete(k)
  }, 5 * 60_000); sweep.unref?.()

  return { http, upgrade, account, attach, newRoom, take, diskOk, clientIp, limits: L, stop: () => clearInterval(sweep), counts: () => ({ windows: windows.size, sockets: [...userSockets.values()].reduce((a, b) => a + b, 0) }) }
}
