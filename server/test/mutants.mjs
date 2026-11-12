// Mutation check for the sharing code: break it on purpose, one change at a time; every test file that covers it must then FAIL.
// Usage: node test/mutants.mjs   (from server/). Files are restored after each run, also on a crash.
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

const M = [
  ['share.js', "randomBytes(32).toString('base64url')", "randomBytes(8).toString('base64url')", 'share'],
  ['share.js', "hash: hashToken(token)", "hash: token", 'share'],
  ['share.js', "return l && state(l) === 'active' ? l : null", "return l ? l : null", 'share'],
  ['share.js', "l.revokedAt ? 'revoked'", "false ? 'revoked'", 'share'],
  ['share.js', "expiresAt && now() >= l.expiresAt", "expiresAt && now() > l.expiresAt", 'share'],
  ['share.js', "if (!l || l.by !== who) return false", "if (!l) return false", 'share'],
  ['share.js', "for (const ws of sockets.get(id) || []) { try { ws.close(4403, 'revoked') } catch {} }", "", 'share'],
  ['share.js', "if (l.room !== room || l.file) return null", "if (l.file) return null", 'share'],
  ['share.js', "if (l.room !== room || l.file) return null", "if (l.room !== room) return null", 'share'],
  ['share.js', "if (role !== 'view' && role !== 'edit') return", "if (!role) return", 'share'],
  ['share.js', "if (role === 'edit') return { code: 400, error: 'edit_needs_room' }", "", 'share'],
  ['share.js', "p.split(/[\\\\/]/).includes('..')", "false", 'share'],
  ['share.js', "if (isAgentName(who)) return", "if (false) return", 'share'],
  ['share.js', "return b[0] === 0 && b.length > 1 && b[1] === 0", "return b[0] === 0", 'share'],
  ['share.js', "if (role === 'edit') return true\n    const b", "if (true) return true\n    const b", 'share'],
  ['share.js', "return f.n >= maxFailures", "return false", 'share'],
  ['share.js', "if (!l) { fail(ip); return sendJson(res, 404, { error: 'link_invalid' }) }", "if (!l) return sendJson(res, 404, { error: 'link_invalid' })", 'share'],
  ['share.js', "trustProxy && String", "true && String", 'share'],
  ['share.js', "ws.on('close', () => { clearTimeout(timer);", "ws.on('close', () => {", 'share'],
  ['jsonstore.js', "'Referrer-Policy': 'no-referrer'", "'X-Other': 'no-referrer'", 'share'],
  ['jsonstore.js', "{ mode: 0o600 }", "{ mode: 0o644 }", 'share'],
  ['share.js', "if (!who || /^guest~/.test(who)) return", "if (!who) return", 'share'],
  ['friends.js', "if (to === me) throw E(400, 'self')", "", 'friends'],
  ['friends.js', "if (p) { p.status = 'accepted'", "if (p) { p.status = 'pending'", 'friends'],
  ['friends.js', "p.status !== 'pending' || p.from !== from) throw E(404, 'no_request')\n      p.status", "p.status !== 'pending') throw E(404, 'no_request')\n      p.status", 'friends'],
  ['friends.js', "if (!p || p.status !== 'accepted') throw E(403, 'not_friends')", "", 'friends'],
  ['friends.js', "delete pairs[k]; dropGrants(me, who); store.save()", "delete pairs[k]; store.save()", 'friends'],
  ['friends.js', "|| (p.status === 'pending' && p.from !== me)) throw E(404, 'no_such_friend')", ") throw E(404, 'no_such_friend')", 'friends'],
  ['friends.js', "return HANDLE.test(h) && !isAgentName(h) && !h.startsWith('guest~') ? h : null", "return h || null", 'friends'],
  ['friends.js', "if (isAgentName(identity) || /^guest~/.test(identity)) return", "if (false) return", 'friends'],
  ['friends.js', "else if (++c.n > mutationsPerMinute) throw", "else if (false) throw", 'friends'],
  ['friends.js', ".filter(x => x.status === 'pending' && x.from === me).length >= maxOutgoing", ".filter(x => false).length >= maxOutgoing", 'friends'],
  ['friends.js', "if (!grants[gKey(room, me, friend)]) throw E(404, 'not_shared')", "", 'friends'],
  ['friends.js', "all.filter(g => g.friend === me)", "all.filter(g => true)", 'friends'],
  ['../app/share-client.js', "if (token) return { kind: 'share', token }\n  if (!signedIn)", "if (!signedIn)", 'shareclient'],
  ['../app/share-client.js', "{43}", "{4,}", 'shareclient'],
  ['../app/share-client.js', "referrerPolicy: 'no-referrer'", "", 'shareclient'],
  ['../app/share-client.js', "auth && token ?", "token ?", 'shareclient'],
  ['../app/share-client.js', "if (lastRoom) return { kind: 'room', room: lastRoom }", "", 'shareclient']
]
let missed = 0
for (const [file, from, to, test] of M) {
  const src = fs.readFileSync(file, 'utf8')
  if (!src.includes(from)) { console.log('NO MATCH  ', file, JSON.stringify(from.slice(0, 50))); missed++; continue }
  fs.writeFileSync(file, src.replace(from, to))
  let r; try { r = spawnSync('node', [`test/${test}.test.js`], { encoding: 'utf8', timeout: 60000 }) } finally { fs.writeFileSync(file, src) }
  const killed = r.status !== 0
  console.log(killed ? 'killed    ' : 'SURVIVED  ', file, JSON.stringify(from.slice(0, 60)))
  if (!killed) missed++
}
console.log(`mutation check: ${M.length - missed} of ${M.length} killed`)
process.exit(missed ? 1 : 0)
