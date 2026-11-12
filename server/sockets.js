// Open-socket registry: a websocket is authenticated once, when it connects, so signing a device out has to reach the sockets that session already opened.
// Sockets are grouped by their SESSION (the hash the auth module stores), never by the raw token. Sockets opened with a static token or a share link
// are not sessions and are not tracked here (share links have their own revoke, server/share.js).
//   const reg = createSocketRegistry({ sessionKey: auth.sessionKey, sessionLive: auth.sessionLive })
//   reg.attach(ws, token)                  at upgrade time; returns true when the socket belongs to a session
//   auth.onRevoke(({ keys }) => reg.closeSessions(keys))
//   reg.start()                            a sweep every 30 s closes sockets whose session expired
export const CLOSE_SIGNED_OUT = 4401 // same family as the share-link codes (4401 expired, 4403 revoked)

export function createSocketRegistry ({ sessionKey, sessionLive, intervalMs = 30_000 }) {
  const bySession = new Map() // session key -> Set of sockets
  let timer = null

  function drop (key, ws) {
    const set = bySession.get(key)
    if (!set) return
    set.delete(ws)
    if (!set.size) bySession.delete(key)
  }

  function attach (ws, token) {
    const key = token ? sessionKey(token) : null
    if (!key) return false
    let set = bySession.get(key); if (!set) bySession.set(key, set = new Set())
    set.add(ws)
    ws.on('close', () => drop(key, ws))
    return true
  }

  function close (key, reason) {
    const set = bySession.get(key)
    if (!set) return 0
    let n = 0
    for (const ws of [...set]) { try { ws.close(CLOSE_SIGNED_OUT, reason) } catch {} drop(key, ws); n++ }
    return n
  }

  function closeSessions (keys, reason = 'signed out') {
    let n = 0
    for (const key of keys || []) if (key) n += close(key, reason)
    return n
  }

  function sweep () {
    let n = 0
    for (const key of [...bySession.keys()]) if (!sessionLive(key)) n += close(key, 'session expired')
    return n
  }

  function size () { let n = 0; for (const s of bySession.values()) n += s.size; return n }
  function start () { if (!timer) { timer = setInterval(sweep, intervalMs); timer.unref?.() } }
  function stop () { if (timer) { clearInterval(timer); timer = null } }

  return { attach, closeSessions, sweep, size, start, stop }
}
