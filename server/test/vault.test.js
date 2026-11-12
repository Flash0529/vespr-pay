import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createVault, createVaultKeyStore } from '../vault.js'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-vault-test-'))

let n = 0
const t = (name, fn) => {
  try {
    fn()
    n++
  } catch (e) {
    console.error('FAILED: ' + name)
    throw e
  }
}

try {
  t('createVault seals and opens AES-256-GCM boxes', () => {
    const vault = createVault({ DATA })
    const secretPayload = { token: 'sk-proj-test1234567890abcdef', user: 'alex' } // secret-scan: allow
    const box = vault.seal(secretPayload)

    assert.strictEqual(box.v, 1)
    assert.ok(box.iv)
    assert.ok(box.tag)
    assert.ok(box.data)
    // Sealed data is not plaintext
    assert.ok(!box.data.includes('test1234567890abcdef'))

    const opened = vault.open(box)
    assert.deepStrictEqual(opened, secretPayload)

    // Tampering with ciphertext fails decryption
    const tampered = { ...box, data: box.data.slice(0, -2) + 'AA' }
    assert.throws(() => vault.open(tampered))
  })

  t('createVaultKeyStore detects services from token signatures', () => {
    const store = createVaultKeyStore({ DATA })
    assert.strictEqual(store.detectService('sk-proj-9999999999999999999999999999'), 'OpenAI') // secret-scan: allow
    assert.strictEqual(store.detectService('sk-ant-api03-abcdefghijklmnopqrstuvwxyz'), 'Anthropic') // secret-scan: allow
    assert.strictEqual(store.detectService('ghp_1234567890abcdefghijklmnopqrstuv'), 'GitHub') // secret-scan: allow
    assert.strictEqual(store.detectService('AIzaSyD1234567890abcdefghijklmnopqrstuv'), 'Google Gemini') // secret-scan: allow
    assert.strictEqual(store.detectService('AKIAIOSFODNN7EXAMPLE'), 'AWS')
    assert.strictEqual(store.detectService('sk_' + 'live_' + 'x'.repeat(24)), 'Stripe') // a made-up value, built here so that no key-shaped text sits in the file
    assert.strictEqual(store.detectService('some-generic-api-key-here'), 'Custom')
  })

  t('createVaultKeyStore saves, lists masked, retrieves decrypted, and deletes keys', () => {
    const store = createVaultKeyStore({ DATA })
    const k1 = store.saveKey('alex', {
      service: 'OpenAI',
      label: 'Main Production Key',
      token: 'sk-proj-prod1234567890abcdef', // secret-scan: allow
      envVar: 'OPENAI_API_KEY'
    })

    assert.ok(k1.id.startsWith('key-'))
    assert.strictEqual(k1.service, 'OpenAI')
    assert.strictEqual(k1.prefix, 'sk-proj-...') // secret-scan: allow
    assert.ok(k1.savedAt > 0)

    // List returns metadata only, never raw token
    const list = store.listKeys('alex')
    assert.strictEqual(list.length, 1)
    assert.strictEqual(list[0].id, k1.id)
    assert.strictEqual(list[0].prefix, 'sk-proj-...') // secret-scan: allow
    assert.strictEqual('token' in list[0], false)
    assert.strictEqual('sealed' in list[0], false)

    // getKey decrypts the sealed payload
    const retrieved = store.getKey('alex', k1.id)
    assert.strictEqual(retrieved.token, 'sk-proj-prod1234567890abcdef') // secret-scan: allow
    assert.strictEqual(retrieved.envVar, 'OPENAI_API_KEY')

    // Delete key
    assert.strictEqual(store.deleteKey('alex', k1.id), true)
    assert.strictEqual(store.listKeys('alex').length, 0)
    assert.strictEqual(store.getKey('alex', k1.id), null)
  })

  console.log(`vault tests passed (${n})`)
} finally {
  fs.rmSync(DATA, { recursive: true, force: true })
}
