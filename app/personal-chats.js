// Personal Chat threads: each chat is its own conversation, saved on this device only (Chat mode never touches a workspace). Pure, with storage injected so it is testable.
// Before 2026-11-10 every sidebar chat opened the same single thread. A reply comes from window.VESPR_PERSONAL_AI(messages) when the host provides one (the VM's model endpoint);
// without it the thread says so plainly and the message is only saved (nothing is pretended).
export const LIMITS = Object.freeze({ threads: 60, messages: 100, chars: 450000, message: 12000, title: 48 })
const ROLES = ['user', 'assistant', 'notice']
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
export const titleFrom = text => { const t = clip(text, LIMITS.title + 1); return !t ? 'New chat' : t.length > LIMITS.title ? t.slice(0, LIMITS.title - 1) + '…' : t }
const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const cleanMsg = m => (m && ROLES.includes(m.role) && typeof m.text === 'string' && m.text.length <= LIMITS.chars) ? { role: m.role, text: m.text, at: Number.isFinite(m.at) ? m.at : 0 } : null
const cleanThread = t => {
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !/^[\w-]{1,40}$/.test(t.id)) return null
  const messages = (Array.isArray(t.messages) ? t.messages : []).map(cleanMsg).filter(Boolean).slice(-LIMITS.messages)
  return { id: t.id, title: clip(t.title, LIMITS.title) || 'New chat', created: Number.isFinite(t.created) ? t.created : 0, updated: Number.isFinite(t.updated) ? t.updated : 0, messages }
}

export function createPersonalStore (storage, accountId, now = () => Date.now()) {
  const key = 'vespr-personal-chats:' + accountId; const legacyKey = 'vespr-personal-chat:' + accountId
  let db = { threads: [], active: null }
  const save = () => { try { storage.setItem(key, JSON.stringify(db)); return true } catch { return false } }
  try {
    const o = JSON.parse(storage.getItem(key) || 'null')
    if (o && Array.isArray(o.threads)) { db.threads = o.threads.map(cleanThread).filter(Boolean).slice(0, LIMITS.threads); db.active = db.threads.some(t => t.id === o.active) ? o.active : null }
    else { // the old single thread becomes one chat, once
      const old = JSON.parse(storage.getItem(legacyKey) || '[]'); const messages = (Array.isArray(old) ? old : []).map(m => cleanMsg(m && { ...m, role: m.role === 'user' || m.role === 'notice' ? m.role : null })).filter(Boolean)
      if (messages.length) { const first = messages.find(m => m.role === 'user'); db.threads.push({ id: newId(), title: titleFrom(first && first.text), created: messages[0].at || now(), updated: messages[messages.length - 1].at || now(), messages }); db.active = db.threads[0].id; save() }
    }
  } catch { db = { threads: [], active: null } }
  const find = id => db.threads.find(t => t.id === id) || null
  return {
    list: () => db.threads.slice().sort((a, b) => b.updated - a.updated).map(t => ({ id: t.id, title: t.title, updated: t.updated, count: t.messages.length })),
    active: () => find(db.active),
    get: find,
    setActive (id) { if (id === null) { db.active = null; save(); return true } if (!find(id)) return false; db.active = id; save(); return true },
    // a new chat is only kept once it has a message, so empty "New chat" rows never pile up: start() just makes the next send create one
    start () { db.active = null; save(); return null },
    append (text, role = 'user') {
      if (!ROLES.includes(role) || typeof text !== 'string') return { ok: false, reason: 'bad' }
      if (role === 'user' && (!text.trim() || text.length > LIMITS.message)) return { ok: false, reason: text.trim() ? 'long' : 'empty' }
      let t = find(db.active)
      if (!t) {
        if (db.threads.length >= LIMITS.threads) { const oldest = db.threads.slice().sort((a, b) => a.updated - b.updated)[0]; db.threads = db.threads.filter(x => x !== oldest) }
        t = { id: newId(), title: role === 'user' ? titleFrom(text) : 'New chat', created: now(), updated: now(), messages: [] }; db.threads.push(t); db.active = t.id
      }
      if (t.messages.reduce((n, m) => n + m.text.length, 0) + text.length > LIMITS.chars) return { ok: false, reason: 'full', id: t.id }
      t.messages.push({ role, text, at: now() }); t.messages = t.messages.slice(-LIMITS.messages); t.updated = now()
      return { ok: save(), id: t.id }
    },
    rename (id, title) { const t = find(id); const c = clip(title, LIMITS.title); if (!t || !c) return false; t.title = c; save(); return true },
    remove (id) { const n = db.threads.length; db.threads = db.threads.filter(t => t.id !== id); if (db.active === id) db.active = null; save(); return db.threads.length < n },
    clear () { db = { threads: [], active: null }; save() },
    // what the model gets: only this chat's user/assistant turns, never notices
    history: id => { const t = find(id); return t ? t.messages.filter(m => m.role !== 'notice').map(m => ({ role: m.role, content: m.text })) : [] },
    // (the first user message is left out when it is just the chat's title, so a search does not list the same line twice)
    searchable: () => db.threads.map(t => { const first = t.messages.find(m => m.role === 'user'); return { id: 'personal:' + t.id, title: t.title, messages: t.messages.filter(m => m.role !== 'notice' && !(m === first && titleFrom(m.text) === t.title)).map(m => m.text).reverse() } })
  }
}
