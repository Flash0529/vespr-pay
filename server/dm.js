// Direct and group messages (the team, 2026-11-10: "do it"). Each conversation is its own private realtime room, 'dm-<16 hex>', that only its members can open.
//   POST /api/dm/open { with: ["handle", ...] }  (Bearer) -> { thread: { id, room, members, title, kind } }   you must be friends with each person; the same people give back the same conversation
//   GET  /api/dm/list                            (Bearer) -> { threads: [...] }                            the conversations you are in
// The realtime door asks dm.allows(room, who): a 'dm-' room opens only for a member of an existing thread (so nobody can squat or guess one), and share links never open one.
// Messages live in the room's shared chat exactly like a workspace's, so the same client shows them. Honest limit: inside the room members can write as each other (there is no
// per-message rights check here as in a locked workspace); a room only has the people you chose.
import path from 'node:path'
import crypto from 'node:crypto'
import { openStore, readJson, sendJson, bearer, isAgentName } from './jsonstore.js'

export const DM_LIMITS = Object.freeze({ maxMembers: 8, maxThreadsPerPerson: 200, titleMax: 60 })
export const isDmRoom = room => /^dm-[a-f0-9]{16}$/.test(String(room || ''))
export const reservedRoom = room => String(room || '').startsWith('dm-')

export function createDm ({ DATA, identify, handleOf, identityOf = h => h, areFriends, now = Date.now, randomBytes = crypto.randomBytes }) {
  const store = openStore(path.join(DATA, 'dm', 'threads.json'), () => ({ threads: {} }))
  const threads = store.data.threads // id -> { id, members (sorted handles), kind, title, by, created }
  const view = t => ({ id: t.id, room: 'dm-' + t.id, members: t.members, kind: t.kind, title: t.title, created: t.created })
  // A one-to-one conversation is open only while the two are still friends (unfriending closes it; becoming friends again brings it back, nothing is deleted).
  // A group keeps its members: there is no single friendship to hang it on, and nobody is removed behind their back.
  const live = (t, me) => t.members.includes(me) && (t.kind !== 'dm' || t.members.filter(h => h !== me).every(h => areFriends(me, h)))
  const mineOf = me => Object.values(threads).filter(t => live(t, me))
  const err = (status, error, message) => Object.assign(new Error(error), { status, error, message })
  function open (me, withList) {
    if (!Array.isArray(withList) || !withList.length) throw err(400, 'bad_members', 'Choose at least one friend.')
    const others = [...new Set(withList.map(h => String(h || '').trim().toLowerCase()))].filter(h => h && h !== me)
    if (!others.length) throw err(400, 'bad_members', 'Choose someone other than yourself.')
    if (others.length + 1 > DM_LIMITS.maxMembers) throw err(400, 'too_many', 'A conversation can have up to ' + DM_LIMITS.maxMembers + ' people.')
    for (const h of others) if (isAgentName(h) || !areFriends(me, h)) throw err(403, 'not_friends', 'You can only message your friends. Send a friend request first.')
    const members = [me, ...others].sort(); const key = members.join('|')
    const existing = Object.values(threads).find(t => t.members.join('|') === key); if (existing) return view(existing) // (we are friends with everyone listed, checked above)
    if (mineOf(me).length >= DM_LIMITS.maxThreadsPerPerson) throw err(429, 'too_many_threads', 'You have reached the limit of conversations.')
    let id; do { id = randomBytes(8).toString('hex') } while (threads[id])
    const t = { id, members, kind: members.length > 2 ? 'group' : 'dm', title: members.length > 2 ? members.join(', ').slice(0, DM_LIMITS.titleMax) : '', by: me, created: now() }
    threads[id] = t; store.save(); return view(t)
  }
  return {
    open, list: me => mineOf(me).sort((a, b) => b.created - a.created).map(view),
    // the realtime door: who is an identity (the signed-in name), room is the room name
    allows (room, identity) { if (!reservedRoom(room)) return true; if (!isDmRoom(room)) return false; const t = threads[String(room).slice(3)]; const me = handleOf(identity); return !!(t && me && live(t, me)) },
    http (req, res) {
      const url = new URL(req.url, 'http://x'); if (!url.pathname.startsWith('/api/dm/')) return false
      if (req.method === 'OPTIONS') return false
      const who = identify(bearer(req)); const me = who && !isAgentName(who) ? handleOf(who) : null
      if (!who) { sendJson(res, 401, { error: 'sign_in' }); return true }
      if (!me) { sendJson(res, 400, { error: 'no_handle', message: 'Your account has no handle yet.' }); return true }
      if (url.pathname === '/api/dm/list' && req.method === 'GET') { sendJson(res, 200, { threads: this.list(me).map(t => ({ ...t, members: t.members.map(h => ({ handle: h, name: identityOf(h) })) })) }); return true }
      if (url.pathname === '/api/dm/open' && req.method === 'POST') {
        ;(async () => {
          const body = await readJson(req, 2048).catch(() => null)
          try { const t = open(me, body && body.with); sendJson(res, 200, { thread: t }) } catch (e) { sendJson(res, e.status || 500, { error: e.error || 'failed', message: e.message && e.error ? e.message : 'Could not open the conversation.' }) }
        })()
        return true
      }
      sendJson(res, 404, { error: 'not_found' }); return true
    }
  }
}
