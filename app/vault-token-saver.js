// Ask #301 & #400: API Key Token Saver & Secure Vault Client
// Detects API keys in clipboard copies or downloaded credentials, derivations for service types,
// and securely vaults secrets to AES-256-GCM server storage instead of plaintext exposure.

export const PATTERNS = [
  { service: 'Anthropic', envVar: 'ANTHROPIC_API_KEY', re: /\b(sk-ant-[a-zA-Z0-9_\-]{30,})\b/ },
  { service: 'OpenAI', envVar: 'OPENAI_API_KEY', re: /\b(sk-(?!ant-)(?:proj-)?[a-zA-Z0-9_\-]{32,})\b/ },
  { service: 'GitHub', envVar: 'GITHUB_TOKEN', re: /\b((?:ghp_|github_pat_)[a-zA-Z0-9_\-]{30,})\b/ },
  { service: 'Google Gemini', envVar: 'GEMINI_API_KEY', re: /\b(AIza[0-9A-Za-z\-_]{35})\b/ },
  { service: 'AWS', envVar: 'AWS_ACCESS_KEY_ID', re: /\b(AKIA[0-9A-Z]{16})\b/ },
  { service: 'Stripe', envVar: 'STRIPE_SECRET_KEY', re: /\b(sk_(?:live|test)_[a-zA-Z0-9]{24,})\b/ }
]

const KEY_FILE_NAMES = [
  /^\.env(?:\..+)?$/i,
  /^credentials\.json$/i,
  /^id_rsa$/i,
  /api[_-]?key/i,
  /secret/i
]

export function isKeyFilename (name) {
  const n = String(name || '').trim().split(/[\\/]/).pop()
  return KEY_FILE_NAMES.some(p => p.test(n))
}

export function detectApiKeyInText (text, source = '') {
  const s = String(text ?? '').trim()
  if (!s || s.length < 16) return null

  for (const { service, envVar, re } of PATTERNS) {
    const m = s.match(re)
    if (m) {
      const token = m[1]
      return {
        detected: true,
        service,
        envVar,
        token,
        prefix: token.slice(0, Math.min(8, token.length)) + '...',
        label: `${service} API Key`,
        source: source || 'clipboard'
      }
    }
  }

  // Check if .env formatted line like SOME_KEY=xxx
  const envMatch = s.match(/^([A-Z0-9_]+_KEY|[A-Z0-9_]+_TOKEN)\s*=\s*['"]?([a-zA-Z0-9_\-.]{20,})['"]?/m)
  if (envMatch) {
    const varName = envMatch[1]
    const token = envMatch[2]
    return {
      detected: true,
      service: 'Custom API',
      envVar: varName,
      token,
      prefix: token.slice(0, 8) + '...',
      label: `${varName} Credential`,
      source: source || 'env_export'
    }
  }

  return null
}

export function createVaultTokenSaverService ({ apiBase = '', fetchImpl = (typeof fetch !== 'undefined' ? fetch : null), getAuthToken = () => '' } = {}) {
  let cachedKeys = []

  return {
    detect: detectApiKeyInText,
    isKeyFilename,

    inspectDownload (filename, content = '') {
      if (isKeyFilename(filename)) {
        const detected = detectApiKeyInText(content, `download:${filename}`)
        if (detected) return detected
        return {
          detected: true,
          service: 'Key File',
          envVar: 'SECRET_KEY',
          token: content.trim(),
          prefix: filename,
          label: `${filename} Secrets`,
          source: `download:${filename}`
        }
      }
      return detectApiKeyInText(content, `download:${filename}`)
    },

    async saveToVault (tokenInfo) {
      if (!fetchImpl) throw new Error('Fetch not available')
      const token = getAuthToken()
      const res = await fetchImpl(`${apiBase}/api/vault/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          service: tokenInfo.service,
          label: tokenInfo.label,
          token: tokenInfo.token,
          envVar: tokenInfo.envVar
        })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      cachedKeys.push(data.key)
      return data.key
    },

    async listVaultKeys () {
      if (!fetchImpl) return cachedKeys
      const token = getAuthToken()
      try {
        const res = await fetchImpl(`${apiBase}/api/vault/keys`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        })
        if (res.ok) {
          const data = await res.json()
          cachedKeys = data.keys || []
        }
      } catch {}
      return cachedKeys
    },

    async deleteVaultKey (id) {
      if (!fetchImpl) return false
      const token = getAuthToken()
      const res = await fetchImpl(`${apiBase}/api/vault/keys/${id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
      if (res.ok) {
        cachedKeys = cachedKeys.filter(k => k.id !== id)
        return true
      }
      return false
    },

    renderVaultPromptHtml (tokenInfo) {
      if (!tokenInfo) return ''
      return `
        <div class="vault-prompt-card" role="dialog" aria-label="API Key Vault Detected">
          <div class="vault-prompt-header">
            <span class="vault-badge-shield">🛡️ Secure Vault</span>
            <b>API Key Detected</b>
          </div>
          <p class="vault-prompt-text">
            VESPR detected a <b>${tokenInfo.service}</b> key (<code>${tokenInfo.prefix}</code>).
            Would you like to securely vault it with AES-256-GCM encryption so it is never committed to Git or leaked?
          </p>
          <div class="vault-prompt-actions">
            <button class="btn pri vault-save-btn" data-vault-save="1">Save to Encrypted Vault</button>
            <button class="btn vault-dismiss-btn" data-vault-dismiss="1">Ignore</button>
          </div>
        </div>
      `.trim()
    }
  }
}
