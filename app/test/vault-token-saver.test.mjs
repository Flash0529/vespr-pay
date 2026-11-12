import assert from 'node:assert'
import {
  detectApiKeyInText,
  isKeyFilename,
  createVaultTokenSaverService
} from '../vault-token-saver.js'

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

t('detectApiKeyInText detects provider tokens accurately', () => {
  // OpenAI
  const oai = detectApiKeyInText('Please use my key sk-proj-1234567890abcdefghijklmnopqrstuvwxyz123456 for tests') // secret-scan: allow
  assert.ok(oai)
  assert.strictEqual(oai.service, 'OpenAI')
  assert.strictEqual(oai.envVar, 'OPENAI_API_KEY')
  assert.strictEqual(oai.token, 'sk-proj-1234567890abcdefghijklmnopqrstuvwxyz123456') // secret-scan: allow
  assert.strictEqual(oai.prefix, 'sk-proj-...') // secret-scan: allow

  // Anthropic
  const antKey = detectApiKeyInText('export ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz12345') // secret-scan: allow
  assert.ok(antKey)
  assert.strictEqual(antKey.service, 'Anthropic')

  // GitHub
  const gh = detectApiKeyInText('token: ghp_1234567890abcdefghijklmnopqrstuv') // secret-scan: allow
  assert.ok(gh)
  assert.strictEqual(gh.service, 'GitHub')

  // Gemini
  const gemini = detectApiKeyInText('key=AIzaSyD1234567890abcdefghijklmnopqrstuv') // secret-scan: allow
  assert.ok(gemini)
  assert.strictEqual(gemini.service, 'Google Gemini')

  // Stripe
  const stripe = detectApiKeyInText('STRIPE_SECRET_KEY=sk_test_51Mzabcdefghijklmnopqrstuvwxyz') // secret-scan: allow
  assert.ok(stripe)
  assert.strictEqual(stripe.service, 'Stripe')

  // Plain non-key text
  assert.strictEqual(detectApiKeyInText('This is just normal text with no secret keys'), null)
})

t('isKeyFilename identifies dangerous credential filenames', () => {
  assert.strictEqual(isKeyFilename('.env'), true)
  assert.strictEqual(isKeyFilename('.env.local'), true)
  assert.strictEqual(isKeyFilename('credentials.json'), true)
  assert.strictEqual(isKeyFilename('id_rsa'), true)
  assert.strictEqual(isKeyFilename('stripe_api_key.txt'), true)
  assert.strictEqual(isKeyFilename('main.py'), false)
  assert.strictEqual(isKeyFilename('README.md'), false)
})

t('createVaultTokenSaverService handles inspectDownload, save, list, and delete', async () => {
  let fakeStore = []
  const mockFetch = async (url, opts = {}) => {
    const method = opts.method || 'GET'
    if (url.endsWith('/api/vault/keys') && method === 'POST') {
      const b = JSON.parse(opts.body)
      const rec = { id: 'key-123', service: b.service, label: b.label, envVar: b.envVar, prefix: 'sk-proj-...' } // secret-scan: allow
      fakeStore.push(rec)
      return { ok: true, json: async () => ({ ok: true, key: rec }) }
    }
    if (url.endsWith('/api/vault/keys') && method === 'GET') {
      return { ok: true, json: async () => ({ keys: fakeStore }) }
    }
    if (url.includes('/api/vault/keys/key-123') && method === 'DELETE') {
      fakeStore = fakeStore.filter(x => x.id !== 'key-123')
      return { ok: true }
    }
    return { ok: false, status: 404 }
  }

  const svc = createVaultTokenSaverService({
    apiBase: 'http://test',
    fetchImpl: mockFetch,
    getAuthToken: () => 'fake-token'
  })

  // Inspect download
  const dl = svc.inspectDownload('.env', 'OPENAI_API_KEY=sk-proj-1234567890abcdefghijklmnopqrstuvwxyz123456') // secret-scan: allow
  assert.ok(dl)
  assert.strictEqual(dl.service, 'OpenAI')

  // Save to vault
  const saved = await svc.saveToVault(dl)
  assert.strictEqual(saved.id, 'key-123')

  // List keys
  const list = await svc.listVaultKeys()
  assert.strictEqual(list.length, 1)
  assert.strictEqual(list[0].service, 'OpenAI')

  // Render HTML prompt
  const html = svc.renderVaultPromptHtml(dl)
  assert.ok(html.includes('Secure Vault'))
  assert.ok(html.includes('OpenAI'))

  // Delete key
  const deleted = await svc.deleteVaultKey('key-123')
  assert.strictEqual(deleted, true)
  assert.strictEqual((await svc.listVaultKeys()).length, 0)
})

console.log(`vault-token-saver tests passed (${n})`)
