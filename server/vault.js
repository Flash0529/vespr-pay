// The server's sealed store for long-lived secrets it holds for people (a company login's refresh token, a GitHub token): AES-256-GCM.
// Key: VESPR_CONNECTOR_KEY (64 hex), else <data>/auth/vault.key (mode 600), the same key and box format server/connectors.js uses, so both
// read each other's boxes. Set VESPR_CONNECTOR_KEY in production so the key does not sit beside what it seals.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const b64u = b => Buffer.from(b).toString('base64url')

export function createVault ({ DATA, config = process.env, random = n => crypto.randomBytes(n) }) {
  const dir = path.join(DATA, 'auth'); try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  const env = /^[0-9a-f]{64}$/i.test(String(config.VESPR_CONNECTOR_KEY || ''))
  function key () {
    if (env) return Buffer.from(config.VESPR_CONNECTOR_KEY, 'hex')
    const kf = path.join(dir, 'vault.key')
    try { const k = fs.readFileSync(kf, 'utf8').trim(); if (/^[0-9a-f]{64}$/.test(k)) return Buffer.from(k, 'hex') } catch {}
    const k = random(32).toString('hex')
    try { fs.writeFileSync(kf, k + '\n', { mode: 0o600, flag: 'wx' }) } catch { return key() } // another part of the server made it first
    return Buffer.from(k, 'hex')
  }
  function seal (obj) {
    const iv = random(12); const c = crypto.createCipheriv('aes-256-gcm', key(), iv)
    const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()])
    return { v: 1, iv: b64u(iv), tag: b64u(c.getAuthTag()), data: b64u(data) }
  }
  function open (box) {
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(box.iv, 'base64url'))
    d.setAuthTag(Buffer.from(box.tag, 'base64url'))
    return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64url')), d.final()]).toString('utf8'))
  }
  return { seal, open, source: env ? 'env' : 'file' }
}


export function createVaultKeyStore ({ DATA, vault = createVault({ DATA }), now = Date.now, random = n => crypto.randomBytes(n) } = {}) {
  const keysDir = path.join(DATA, 'auth', 'keys')
  try { fs.mkdirSync(keysDir, { recursive: true, mode: 0o700 }) } catch {}

  const userFile = userId => path.join(keysDir, `${String(userId).replace(/[^a-zA-Z0-9_\-]/g, '_')}.json`)

  function readStore (userId) {
    try {
      return JSON.parse(fs.readFileSync(userFile(userId), 'utf8'))
    } catch {
      return { userId, keys: [] }
    }
  }

  function writeStore (userId, data) {
    fs.writeFileSync(userFile(userId), JSON.stringify(data, null, 2), { mode: 0o600 })
  }

  function detectService (token) {
    const t = String(token || '').trim()
    if (/^sk-proj-/i.test(t) || /^sk-[a-zA-Z0-9]{32,}/i.test(t)) return 'OpenAI'
    if (/^sk-ant-/i.test(t)) return 'Anthropic'
    if (/^(ghp_|github_pat_)/i.test(t)) return 'GitHub'
    if (/^AIza[0-9A-Za-z\-_]{35}/i.test(t)) return 'Google Gemini'
    if (/^AKIA[0-9A-Z]{16}/i.test(t)) return 'AWS'
    if (/^sk_(live|test)_/i.test(t)) return 'Stripe'
    return 'Custom'
  }

  function saveKey (userId, { service, label, token, envVar = '' }) {
    if (!userId || !token) throw new Error('needs userId and token')
    const serv = service || detectService(token)
    const lbl = label || `${serv} API Key`
    const id = 'key-' + random(6).toString('hex')
    const prefix = token.slice(0, Math.min(8, token.length)) + '...'
    const sealed = vault.seal({ id, userId, service: serv, label: lbl, token, envVar, savedAt: now() })
    const store = readStore(userId)
    const rec = { id, service: serv, label: lbl, envVar, prefix, sealed, savedAt: now() }
    store.keys = store.keys || []
    store.keys.push(rec)
    writeStore(userId, store)
    return { id, service: serv, label: lbl, envVar, prefix, savedAt: rec.savedAt }
  }

  function listKeys (userId) {
    const store = readStore(userId)
    return (store.keys || []).map(k => ({
      id: k.id,
      service: k.service,
      label: k.label,
      envVar: k.envVar,
      prefix: k.prefix,
      savedAt: k.savedAt
    }))
  }

  function getKey (userId, id) {
    const store = readStore(userId)
    const rec = (store.keys || []).find(k => k.id === id)
    if (!rec) return null
    try {
      return vault.open(rec.sealed)
    } catch {
      return null
    }
  }

  function deleteKey (userId, id) {
    const store = readStore(userId)
    const lenBefore = (store.keys || []).length
    store.keys = (store.keys || []).filter(k => k.id !== id)
    if (store.keys.length !== lenBefore) {
      writeStore(userId, store)
      return true
    }
    return false
  }

  return { saveKey, listKeys, getKey, deleteKey, detectService }
}
