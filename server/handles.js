// Handles: the short, public name a person is known by to friends and in direct messages (2 to 32 characters of a-z 0-9 . _ -). Accounts sign in with an email or a name, and emails are never
// handles, so each account gets one automatically the first time it is needed (from its name, made unique) and keeps it. Token-file identities (people who sign in with a login token) are their own handle.
import { defaultHandleOf } from './friends.js'

const clean = s => String(s || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+/, '').slice(0, 28)
export function createHandles ({ getUsers, saveUsers }) {
  const all = () => Object.values(getUsers() || {})
  const byIdentity = ident => { const i = String(ident || ''); return i ? all().find(u => u.name === i || (u.email && u.email === i)) || null : null }
  const taken = h => all().some(u => u.handle === h)
  function ensure (user) {
    if (!user) return null
    if (user.handle && defaultHandleOf(user.handle)) return user.handle
    let base = clean(user.name) || clean(String(user.email || '').split('@')[0]) || 'member'
    if (base.length < 2) base += 'x'
    if (!defaultHandleOf(base)) base = 'user-' + base // names like "agent-coder" are not allowed as handles
    let h = base; for (let n = 2; taken(h) && n < 5000; n++) h = base.slice(0, 28 - String(n).length) + n
    if (taken(h)) return null
    user.handle = h; try { saveUsers(getUsers()) } catch { /* kept in memory until the next save */ }
    return h
  }
  return {
    ensure,
    handleOfIdentity: ident => { const u = byIdentity(ident); return u ? ensure(u) : defaultHandleOf(ident) },
    identityOfHandle: h => { const u = all().find(x => x.handle === h); return u ? (u.name || u.email || null) : (defaultHandleOf(h) ? h : null) }
  }
}
