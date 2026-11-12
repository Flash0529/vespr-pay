// Friends and shared projects, keyed by handle (the lowercase sign-in name; an email address is never a handle).
//   GET  /api/friends                  -> { me, friends: [{handle, since}], incoming: [{handle, ts}], outgoing: [{handle, ts}] }
//   POST /api/friends/request {to}     -> { status: 'pending' | 'friends' }   (asking someone who already asked you makes you friends)
//   POST /api/friends/accept  {from}   -> { status: 'friends' }
//   POST /api/friends/decline {from}   -> { ok }      the sender is not told (their request just stays pending)
//   POST /api/friends/remove  {who}    -> { ok }      unfriend, or cancel your own pending request; also ends project sharing both ways
//   POST /api/friends/share   {room, with, role: 'view'|'edit'}  -> { ok }   list a workspace as shared with a friend
//   POST /api/friends/unshare {room, with}                       -> { ok }
//   GET  /api/friends/projects         -> { byMe: [{room, with, role, ts}], withMe: [{room, owner, role, ts}] }
// All calls need a Bearer token. Agents have no friends. A project share is a listing for the friend ("shared with me"): it does not lock the workspace,
// because any token holder can already open any workspace by name (docs/SECURITY.md). Real access control for a person outside the team is a share link (share.js).
import path from 'node:path'
import { openStore, readJson, sendJson, bearer, isAgentName } from './jsonstore.js'

const HANDLE = /^[a-z0-9][a-z0-9._-]{1,31}$/
export const defaultHandleOf = identity => { const h = String(identity || '').trim().toLowerCase(); return HANDLE.test(h) && !isAgentName(h) && !h.startsWith('guest~') ? h : null }
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a)

class FriendsError extends Error { constructor (status, code) { super(code); this.status = status; this.code = code } }
const E = (status, code) => new FriendsError(status, code)

export function createFriends ({ DATA, identify, roomOk, mayShare = null, now = Date.now, handleOf = defaultHandleOf, maxFriends = 500, maxOutgoing = 20, maxShares = 200, mutationsPerMinute = 60 }) {
  const store = openStore(path.join(DATA, 'friends', 'graph.json'), () => ({ pairs: {}, grants: {} }))
  const { pairs, grants } = store.data // pairs: "a|b" -> { a, b, status: 'pending'|'accepted', from, ts, acceptedAt }; grants: "room|owner|friend" -> { room, owner, friend, role, ts }
  const gKey = (room, owner, friend) => room + '|' + owner + '|' + friend
  const counts = new Map() // handle -> { n, at }: a small cap on changes per minute
  const handle = h => { const x = defaultHandleOf(h); if (!x) throw E(400, 'bad_handle'); return x }
  const mine = me => Object.values(pairs).filter(p => p.a === me || p.b === me)
  const other = (p, me) => (p.a === me ? p.b : p.a)
  const throttle = me => {
    const c = counts.get(me); const t = now()
    if (!c || t - c.at > 60000) counts.set(me, { n: 1, at: t }); else if (++c.n > mutationsPerMinute) throw E(429, 'slow_down')
  }
  const dropGrants = (a, b) => { for (const [k, g] of Object.entries(grants)) if ((g.owner === a && g.friend === b) || (g.owner === b && g.friend === a)) delete grants[k] }

  const api = {
    areFriends (a, b) { const p = pairs[pairKey(a, b)]; return !!p && p.status === 'accepted' },
    list (me) {
      const ps = mine(me)
      return {
        me,
        friends: ps.filter(p => p.status === 'accepted').map(p => ({ handle: other(p, me), since: p.acceptedAt })).sort((x, y) => x.handle.localeCompare(y.handle)),
        incoming: ps.filter(p => p.status === 'pending' && p.from !== me).map(p => ({ handle: p.from, ts: p.ts })),
        outgoing: ps.filter(p => p.status === 'pending' && p.from === me).map(p => ({ handle: other(p, me), ts: p.ts }))
      }
    },
    request (me, toRaw) {
      const to = handle(toRaw); throttle(me)
      if (to === me) throw E(400, 'self')
      const k = pairKey(me, to); const p = pairs[k]
      if (p && p.status === 'accepted') throw E(409, 'already_friends')
      if (p && p.from === me) return { status: 'pending' } // asking twice changes nothing
      if (p) { p.status = 'accepted'; p.acceptedAt = now(); store.save(); return { status: 'friends' } } // they had asked first
      if (mine(me).filter(x => x.status === 'accepted').length >= maxFriends) throw E(429, 'too_many_friends')
      if (mine(me).filter(x => x.status === 'pending' && x.from === me).length >= maxOutgoing) throw E(429, 'too_many_requests')
      const [a, b] = me < to ? [me, to] : [to, me]
      pairs[k] = { a, b, status: 'pending', from: me, ts: now(), acceptedAt: null }; store.save()
      return { status: 'pending' }
    },
    accept (me, fromRaw) {
      const from = handle(fromRaw); throttle(me)
      const p = pairs[pairKey(me, from)]
      if (!p || p.status !== 'pending' || p.from !== from) throw E(404, 'no_request')
      p.status = 'accepted'; p.acceptedAt = now(); store.save(); return { status: 'friends' }
    },
    decline (me, fromRaw) {
      const from = handle(fromRaw); throttle(me)
      const k = pairKey(me, from); const p = pairs[k]
      if (!p || p.status !== 'pending' || p.from !== from) throw E(404, 'no_request')
      delete pairs[k]; store.save(); return { ok: true }
    },
    remove (me, whoRaw) {
      const who = handle(whoRaw); throttle(me)
      const k = pairKey(me, who); const p = pairs[k]
      if (!p || (p.status === 'pending' && p.from !== me)) throw E(404, 'no_such_friend') // an incoming request is answered with decline, not remove
      delete pairs[k]; dropGrants(me, who); store.save(); return { ok: true }
    },
    share (me, { room, with: withRaw, role } = {}) {
      const friend = handle(withRaw); throttle(me)
      if (typeof room !== 'string' || !roomOk(room)) throw E(400, 'bad_room')
      if (role !== 'view' && role !== 'edit') throw E(400, 'bad_role')
      const p = pairs[pairKey(me, friend)]
      if (!p || p.status !== 'accepted') throw E(403, 'not_friends')
      if (!grants[gKey(room, me, friend)] && Object.values(grants).filter(g => g.owner === me).length >= maxShares) throw E(429, 'too_many_shares')
      grants[gKey(room, me, friend)] = { room, owner: me, friend, role, ts: now() }; store.save(); return { ok: true }
    },
    unshare (me, { room, with: withRaw } = {}) {
      const friend = handle(withRaw); throttle(me)
      if (!grants[gKey(room, me, friend)]) throw E(404, 'not_shared')
      delete grants[gKey(room, me, friend)]; store.save(); return { ok: true }
    },
    projects (me) {
      const all = Object.values(grants)
      return {
        byMe: all.filter(g => g.owner === me).map(g => ({ room: g.room, with: g.friend, role: g.role, ts: g.ts })),
        withMe: all.filter(g => g.friend === me).map(g => ({ room: g.room, owner: g.owner, role: g.role, ts: g.ts }))
      }
    }
  }

  const ROUTE = /^\/api\/friends(?:\/(request|accept|decline|remove|share|unshare|projects))?$/
  function http (req, res) {
    if (!ROUTE.test(new URL(req.url, 'http://x').pathname)) return false
    handleReq(req, res).catch(() => { if (!res.headersSent) sendJson(res, 500, { error: 'server' }); else res.end() })
    return true
  }
  async function handleReq (req, res) {
    const op = ROUTE.exec(new URL(req.url, 'http://x').pathname)[1] || 'list'
    const want = op === 'list' || op === 'projects' ? 'GET' : 'POST'
    if (req.method !== want) return sendJson(res, 405, { error: 'method' })
    const identity = identify(bearer(req))
    if (!identity) return sendJson(res, 401, { error: 'login_required' })
    if (isAgentName(identity) || /^guest~/.test(identity)) return sendJson(res, 403, { error: 'no_friends_for_this_identity' })
    const me = handleOf(identity)
    if (!me) return sendJson(res, 400, { error: 'no_handle' }) // e.g. the identity is an email address: pick a handle first (docs/SHARING.md, accounts)
    let body = {}
    if (want === 'POST') { try { body = await readJson(req) } catch (c) { return sendJson(res, c === 'too_large' ? 413 : 400, { error: c }) } }
    try {
      if (op === 'list') return sendJson(res, 200, api.list(me))
      if (op === 'projects') return sendJson(res, 200, api.projects(me))
      if (op === 'request') return sendJson(res, 200, api.request(me, body.to))
      if (op === 'accept') return sendJson(res, 200, api.accept(me, body.from))
      if (op === 'decline') return sendJson(res, 200, api.decline(me, body.from))
      if (op === 'remove') return sendJson(res, 200, api.remove(me, body.who))
      if (op === 'share') { if (mayShare && body && !mayShare(me, String(body.room || ''))) return sendJson(res, 403, { error: 'needs_manage' }); return sendJson(res, 200, api.share(me, body)) } // sharing hands out access (server/access.js)
      return sendJson(res, 200, api.unshare(me, body))
    } catch (e) {
      if (e instanceof FriendsError) return sendJson(res, e.status, { error: e.code })
      throw e
    }
  }

  return { http, ...api }
}
