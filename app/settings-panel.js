// Developer Settings System for VESPR SDE.
// Exposes extensive configuration for routing, compute workers, live web apps, Cloudflare integration,
// payment gateways, search engine, photo asset pipeline, and authentication. Pure ES module.

export const SETTINGS_TABS = [
  { id: 'routing', name: 'Routing & Domains', icon: 'route' },
  { id: 'compute', name: 'Compute & Workers', icon: 'cpu' },
  { id: 'liveApps', name: 'Live Web Apps', icon: 'globe' },
  { id: 'cloudflare', name: 'Cloudflare', icon: 'cloud' },
  { id: 'payments', name: 'Payment Gateway', icon: 'card' },
  { id: 'search', name: 'Search Engine', icon: 'search' },
  { id: 'photos', name: 'Photo Assets', icon: 'image' },
  { id: 'auth', name: 'Auth & Session', icon: 'lock' }
]

export function createDefaultSettings () {
  return {
    routing: {
      customDomain: '',
      reverseProxyPaths: [
        { pathPrefix: '/api', targetPort: 8080, stripPrefix: false },
        { pathPrefix: '/ws', targetPort: 8241, stripPrefix: false }
      ],
      webSocketForwarding: true,
      sslMode: 'strict' // strict | flexible | off
    },
    compute: {
      runnerMode: 'managed_sandbox', // managed_sandbox | byoc_socket | external_worker
      cpuQuotaPercent: 100,
      memoryLimitMb: 512,
      tmpfsSizeMb: 128,
      pidsMax: 64,
      elasticAutoscale: true,
      idleTimeoutSec: 300
    },
    liveApps: {
      previewPort: 3000,
      autoDetectDevServers: true,
      hotReloadProxy: true,
      envVariables: {
        NODE_ENV: 'development',
        PORT: '3000'
      }
    },
    cloudflare: {
      connected: false,
      apiTokenMasked: '',
      zoneId: '',
      zoneName: '',
      tunnelId: '',
      tunnelName: 'vespr-tunnel',
      autoDns: true,
      proxyTraffic: true // Cloudflare orange cloud
    },
    payments: {
      platformCreditsUsd: 20.0,
      autoRechargePack: 'credit-20',
      merchantEnabled: true,
      provider: 'stripe',
      testMode: true,
      publishableKey: '',
      secretKeyMasked: '',
      webhookSecretMasked: '',
      supportedCurrencies: ['USD', 'EUR', 'GBP'],
      billingModel: 'checkout_and_metered'
    },
    search: {
      engine: 'fuzzy', // fuzzy | inverted_index | regex | semantic
      indexPhotoMetadata: true,
      maxMatches: 100,
      autoFillLatencyTargetMs: 50,
      wholeWord: false
    },
    photos: {
      autoNormalizeNames: true,
      avoidDescriptiveNames: true,
      namePrefix: 'asset-photo',
      generatePairedSidecar: true,
      sidecarFormat: 'json', // json | text
      extractOcrTags: true
    },
    auth: {
      sessionTimeoutDays: 30,
      twoFactorEnabled: false,
      allowCleverLogin: true,
      allowGithubLogin: true,
      allowGoogleLogin: true
    }
  }
}

export function validateSettings (raw) {
  const errors = []
  const def = createDefaultSettings()
  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Settings object must be provided'], cleaned: def }
  }

  const cleaned = JSON.parse(JSON.stringify(def))

  // Routing validation
  if (raw.routing && typeof raw.routing === 'object') {
    if (typeof raw.routing.customDomain === 'string') {
      cleaned.routing.customDomain = raw.routing.customDomain.trim().toLowerCase().slice(0, 255)
    }
    if (Array.isArray(raw.routing.reverseProxyPaths)) {
      cleaned.routing.reverseProxyPaths = raw.routing.reverseProxyPaths
        .filter(r => r && typeof r.pathPrefix === 'string' && Number.isFinite(r.targetPort))
        .map(r => ({
          pathPrefix: r.pathPrefix.trim().slice(0, 100),
          targetPort: Math.max(1, Math.min(65535, Math.floor(r.targetPort))),
          stripPrefix: !!r.stripPrefix
        }))
    }
    if (['strict', 'flexible', 'off'].includes(raw.routing.sslMode)) {
      cleaned.routing.sslMode = raw.routing.sslMode
    }
    cleaned.routing.webSocketForwarding = !!raw.routing.webSocketForwarding
  }

  // Compute validation
  if (raw.compute && typeof raw.compute === 'object') {
    if (['managed_sandbox', 'byoc_socket', 'external_worker'].includes(raw.compute.runnerMode)) {
      cleaned.compute.runnerMode = raw.compute.runnerMode
    }
    if (Number.isFinite(raw.compute.cpuQuotaPercent)) {
      cleaned.compute.cpuQuotaPercent = Math.max(10, Math.min(400, Math.floor(raw.compute.cpuQuotaPercent)))
    }
    if (Number.isFinite(raw.compute.memoryLimitMb)) {
      cleaned.compute.memoryLimitMb = Math.max(64, Math.min(8192, Math.floor(raw.compute.memoryLimitMb)))
    }
    if (Number.isFinite(raw.compute.tmpfsSizeMb)) {
      cleaned.compute.tmpfsSizeMb = Math.max(16, Math.min(2048, Math.floor(raw.compute.tmpfsSizeMb)))
    }
    if (Number.isFinite(raw.compute.pidsMax)) {
      cleaned.compute.pidsMax = Math.max(16, Math.min(1024, Math.floor(raw.compute.pidsMax)))
    }
    cleaned.compute.elasticAutoscale = raw.compute.elasticAutoscale !== false
    if (Number.isFinite(raw.compute.idleTimeoutSec)) {
      cleaned.compute.idleTimeoutSec = Math.max(30, Math.min(3600, Math.floor(raw.compute.idleTimeoutSec)))
    }
  }

  // Live Apps validation
  if (raw.liveApps && typeof raw.liveApps === 'object') {
    if (Number.isFinite(raw.liveApps.previewPort)) {
      cleaned.liveApps.previewPort = Math.max(1024, Math.min(65535, Math.floor(raw.liveApps.previewPort)))
    }
    cleaned.liveApps.autoDetectDevServers = !!raw.liveApps.autoDetectDevServers
    cleaned.liveApps.hotReloadProxy = raw.liveApps.hotReloadProxy !== false
    if (raw.liveApps.envVariables && typeof raw.liveApps.envVariables === 'object') {
      cleaned.liveApps.envVariables = { ...raw.liveApps.envVariables }
    }
  }

  // Cloudflare validation
  if (raw.cloudflare && typeof raw.cloudflare === 'object') {
    cleaned.cloudflare.connected = !!raw.cloudflare.connected
    if (typeof raw.cloudflare.zoneId === 'string') {
      cleaned.cloudflare.zoneId = raw.cloudflare.zoneId.trim().slice(0, 64)
    }
    if (typeof raw.cloudflare.zoneName === 'string') {
      cleaned.cloudflare.zoneName = raw.cloudflare.zoneName.trim().toLowerCase().slice(0, 255)
    }
    if (typeof raw.cloudflare.tunnelName === 'string') {
      cleaned.cloudflare.tunnelName = raw.cloudflare.tunnelName.trim().slice(0, 100) || 'vespr-tunnel'
    }
    cleaned.cloudflare.autoDns = raw.cloudflare.autoDns !== false
    cleaned.cloudflare.proxyTraffic = raw.cloudflare.proxyTraffic !== false
  }

  // Payments validation
  if (raw.payments && typeof raw.payments === 'object') {
    if (Number.isFinite(raw.payments.platformCreditsUsd)) {
      cleaned.payments.platformCreditsUsd = Math.max(0, Number(raw.payments.platformCreditsUsd.toFixed(2)))
    }
    if (['stripe', 'paddle'].includes(raw.payments.provider)) {
      cleaned.payments.provider = raw.payments.provider
    }
    cleaned.payments.testMode = raw.payments.testMode !== false
    if (Array.isArray(raw.payments.supportedCurrencies)) {
      cleaned.payments.supportedCurrencies = raw.payments.supportedCurrencies
        .map(c => String(c).trim().toUpperCase())
        .filter(c => ['USD', 'EUR', 'GBP', 'CAD', 'JPY', 'AUD'].includes(c))
    }
  }

  // Search validation
  if (raw.search && typeof raw.search === 'object') {
    if (['fuzzy', 'inverted_index', 'regex', 'semantic'].includes(raw.search.engine)) {
      cleaned.search.engine = raw.search.engine
    }
    cleaned.search.indexPhotoMetadata = raw.search.indexPhotoMetadata !== false
    if (Number.isFinite(raw.search.autoFillLatencyTargetMs)) {
      cleaned.search.autoFillLatencyTargetMs = Math.max(5, Math.min(500, Math.floor(raw.search.autoFillLatencyTargetMs)))
    }
  }

  // Photo pipeline validation
  if (raw.photos && typeof raw.photos === 'object') {
    if (typeof raw.photos.autoNormalizeNames === 'boolean') {
      cleaned.photos.autoNormalizeNames = raw.photos.autoNormalizeNames
    }
    if (typeof raw.photos.avoidDescriptiveNames === 'boolean') {
      cleaned.photos.avoidDescriptiveNames = raw.photos.avoidDescriptiveNames
    }
    if (typeof raw.photos.namePrefix === 'string') {
      cleaned.photos.namePrefix = raw.photos.namePrefix.trim().slice(0, 50) || 'asset-photo'
    }
    if (typeof raw.photos.generatePairedSidecar === 'boolean') {
      cleaned.photos.generatePairedSidecar = raw.photos.generatePairedSidecar
    }
    if (raw.photos.sidecarFormat === 'text' || raw.photos.sidecarFormat === 'json') {
      cleaned.photos.sidecarFormat = raw.photos.sidecarFormat
    }
    if (typeof raw.photos.extractOcrTags === 'boolean') {
      cleaned.photos.extractOcrTags = raw.photos.extractOcrTags
    }
  }

  // Auth validation
  if (raw.auth && typeof raw.auth === 'object') {
    if (Number.isFinite(raw.auth.sessionTimeoutDays)) {
      cleaned.auth.sessionTimeoutDays = Math.max(1, Math.min(365, Math.floor(raw.auth.sessionTimeoutDays)))
    }
    cleaned.auth.twoFactorEnabled = !!raw.auth.twoFactorEnabled
    cleaned.auth.allowGithubLogin = raw.auth.allowGithubLogin !== false
    cleaned.auth.allowGoogleLogin = raw.auth.allowGoogleLogin !== false
    cleaned.auth.allowCleverLogin = raw.auth.allowCleverLogin !== false
  }

  return { valid: errors.length === 0, errors, cleaned }
}

export function renderSettingsPanelHtml (settings, activeTab = 'routing') {
  const s = settings || createDefaultSettings()

  const navItems = SETTINGS_TABS.map(tab => {
    const isActive = tab.id === activeTab
    return `
      <button type="button" class="set-nav-item ${isActive ? 'active' : ''}" data-tab="${tab.id}" data-set-tab="${tab.id}">
        <span class="set-tab-title">${tab.name}</span>
      </button>`
  }).join('')

  let contentHtml = ''
  const esc = str => String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  if (activeTab === 'routing') {
    contentHtml = `
      <div class="set-sec">
        <h3>Custom Domains & Reverse Proxy</h3>
        <p class="set-desc">Configure external hostnames, automated SSL/TLS certificates, and microservice route forwarding.</p>
        <div class="set-row">
          <label>Custom Workspace Domain</label>
          <input type="text" id="setRoutingDomain" value="${esc(s.routing.customDomain)}" placeholder="e.g. dev.mycompany.com" class="set-in">
        </div>
        <div class="set-row">
          <label>SSL / TLS Encryption Mode</label>
          <select id="setRoutingSsl" class="set-select">
            <option value="strict" ${s.routing.sslMode === 'strict' ? 'selected' : ''}>Strict (Full end-to-end verification)</option>
            <option value="flexible" ${s.routing.sslMode === 'flexible' ? 'selected' : ''}>Flexible (Origin HTTP permitted)</option>
            <option value="off" ${s.routing.sslMode === 'off' ? 'selected' : ''}>Off (Plain HTTP only)</option>
          </select>
        </div>
        <div class="set-toggle-row">
          <span class="set-toggle-lbl">WebSocket Protocol Forwarding (/ws)</span>
          <button class="sw" role="switch" id="setRoutingWs" aria-checked="${s.routing.webSocketForwarding}"></button>
        </div>
      </div>`
  } else if (activeTab === 'compute') {
    contentHtml = `
      <div class="set-sec">
        <h3>Compute Sandboxes & Worker Placement</h3>
        <p class="set-desc">Allocate CPU, memory, and security container parameters for executing tests and dev servers.</p>
        <div class="set-row">
          <label>Runner Placement Mode</label>
          <select id="setComputeRunner" class="set-select">
            <option value="managed_sandbox" ${s.compute.runnerMode === 'managed_sandbox' ? 'selected' : ''}>Managed Isolated Container (Default)</option>
            <option value="byoc_socket" ${s.compute.runnerMode === 'byoc_socket' ? 'selected' : ''}>BYOC Local Socket Runner</option>
            <option value="external_worker" ${s.compute.runnerMode === 'external_worker' ? 'selected' : ''}>External Kubernetes Worker Pool</option>
          </select>
        </div>
        <div class="set-grid-2">
          <div class="set-row">
            <label>Memory Limit (MB)</label>
            <input type="number" id="setComputeMem" value="${s.compute.memoryLimitMb}" class="set-in">
          </div>
          <div class="set-row">
            <label>CPU Quota (%)</label>
            <input type="number" id="setComputeCpu" value="${s.compute.cpuQuotaPercent}" class="set-in">
          </div>
        </div>
        <div class="set-toggle-row">
          <span class="set-toggle-lbl">Elastic Worker Autoscaling</span>
          <button class="sw" role="switch" id="setComputeAutoscale" aria-checked="${s.compute.elasticAutoscale}"></button>
        </div>
      </div>`
  } else if (activeTab === 'liveApps') {
    contentHtml = `
      <div class="set-sec">
        <h3>Live Web Apps & Hot Reload</h3>
        <p class="set-desc">Configure browser preview proxying, port detection, and live application runtime environments.</p>
        <div class="set-row">
          <label>Default Preview Dev Server Port</label>
          <input type="number" id="setLivePort" value="${s.liveApps.previewPort}" class="set-in">
        </div>
        <div class="set-toggle-row">
          <span class="set-toggle-lbl">Auto-Detect Background Dev Servers</span>
          <button class="sw" role="switch" id="setLiveDetect" aria-checked="${s.liveApps.autoDetectDevServers}"></button>
        </div>
        <div class="set-toggle-row">
          <span class="set-toggle-lbl">Enable Instant Hot-Reload Preview Frame</span>
          <button class="sw" role="switch" id="setLiveHotReload" aria-checked="${s.liveApps.hotReloadProxy}"></button>
        </div>
      </div>`
  } else if (activeTab === 'cloudflare') {
    contentHtml = `
      <div class="set-sec">
        <h3>Cloudflare Integration & Tunnels</h3>
        <p class="set-desc">Direct Cloudflare Zero Trust tunnel binding, edge CDN caching, and automated DNS record management.</p>
        <div class="set-row">
          <label>Zone ID / Name</label>
          <input type="text" id="setCfZone" value="${esc(s.cloudflare.zoneName || s.cloudflare.zoneId)}" placeholder="e.g. example.com or zone id" class="set-in">
        </div>
        <div class="set-row">
          <label>Tunnel Name</label>
          <input type="text" id="setCfTunnel" value="${esc(s.cloudflare.tunnelName)}" class="set-in">
        </div>
        <div class="set-toggle-row">
          <span class="set-toggle-lbl">Auto-Provision DNS Records on Deploy</span>
          <button class="sw" role="switch" id="setCfAutoDns" aria-checked="${s.cloudflare.autoDns}"></button>
        </div>
        <div class="set-toggle-row">
          <span class="set-toggle-lbl">Cloudflare Edge Proxy (Orange Cloud)</span>
          <button class="sw" role="switch" id="setCfProxy" aria-checked="${s.cloudflare.proxyTraffic}"></button>
        </div>
      </div>`
  } else if (activeTab === 'payments') {
    contentHtml = `
      <div class="set-sec">
        <h3>Payment Gateway & In-App Merchant Checkout</h3>
        <p class="set-desc">Platform usage credit balance and embedded payment processing for built apps.</p>
        <div class="set-balance-card">
          <span>Platform Credit Balance</span>
          <span class="set-bal">$${s.payments.platformCreditsUsd.toFixed(2)}</span>
        </div>
        <div class="set-row">
          <label>In-App Merchant Gateway Provider</label>
          <select id="setPayProvider" class="set-select">
            <option value="stripe" ${s.payments.provider === 'stripe' ? 'selected' : ''}>Stripe Connect & Checkout</option>
            <option value="paddle" ${s.payments.provider === 'paddle' ? 'selected' : ''}>Paddle Billing</option>
          </select>
        </div>
        <div class="set-toggle-row">
          <span class="set-toggle-lbl">Test Mode / Sandbox</span>
          <button class="sw" role="switch" id="setPayTest" aria-checked="${s.payments.testMode}"></button>
        </div>
        <div class="set-row">
          <label>Currencies Supported</label>
          <input type="text" id="setPayCurrencies" value="${esc(s.payments.supportedCurrencies.join(', '))}" class="set-in">
        </div>
      </div>`
  } else if (activeTab === 'search') {
    contentHtml = `
      <div class="set-sec">
        <h3>Search Engine & Indexing Performance</h3>
        <p class="set-desc">Configure search algorithms, auto-fill suggestion targets, and photo metadata indexing.</p>
        <div class="set-row">
          <label>Search Algorithm Engine</label>
          <select id="setSearchEngine" class="set-select">
            <option value="fuzzy" ${s.search.engine === 'fuzzy' ? 'selected' : ''}>Fast Natural Fuzzy (Typo-tolerant)</option>
            <option value="inverted_index" ${s.search.engine === 'inverted_index' ? 'selected' : ''}>Inverted Keyword Index</option>
            <option value="regex" ${s.search.engine === 'regex' ? 'selected' : ''}>Regular Expression Matcher</option>
            <option value="semantic" ${s.search.engine === 'semantic' ? 'selected' : ''}>Vector Semantic Embeddings</option>
          </select>
        </div>
        <div class="set-row">
          <label>Auto-fill Suggestion Latency Budget (Target: &lt;50ms)</label>
          <input type="number" id="setAutoFillTarget" value="${s.search.autoFillLatencyTargetMs}" class="set-in">
        </div>
        <div class="set-toggle-row">
          <span class="set-toggle-lbl">Deep Index Photo Assets & OCR Metadata</span>
          <button class="sw" role="switch" id="setIndexPhotos" aria-checked="${s.search.indexPhotoMetadata}"></button>
        </div>
      </div>`
  } else if (activeTab === 'photos') {
    contentHtml = `
      <div class="set-sec">
        <h3>Photo Asset Ingestion & Metadata Pairing</h3>
        <p class="set-desc">Normalize uploaded image names and automatically create searchable .meta.json sidecars.</p>
        <div class="set-row">
          <label>Normalized Photo Name Prefix</label>
          <input type="text" id="setPhotoPrefix" value="${esc(s.photos.namePrefix)}" class="set-in">
        </div>
        <div class="set-toggle-row">
          <span class="set-toggle-lbl">Auto-Normalize Photo Filenames on Upload</span>
          <button class="sw" role="switch" id="setAutoNormPhotos" aria-checked="${s.photos.autoNormalizeNames}"></button>
        </div>
        <div class="set-toggle-row">
          <span class="set-toggle-lbl">Preserve Descriptive Names (Skip Normalizing Formatted Schemes)</span>
          <button class="sw" role="switch" id="setAvoidDescriptive" aria-checked="${s.photos.avoidDescriptiveNames}"></button>
        </div>
        <div class="set-toggle-row">
          <span class="set-toggle-lbl">Generate Paired Descriptive Sidecar Files (.meta.json)</span>
          <button class="sw" role="switch" id="setGenerateSidecar" aria-checked="${s.photos.generatePairedSidecar}"></button>
        </div>
        <div class="set-toggle-row">
          <span class="set-toggle-lbl">Extract Text & Visual Tags for Search</span>
          <button class="sw" role="switch" id="setExtractOcr" aria-checked="${s.photos.extractOcrTags}"></button>
        </div>
      </div>`
  } else {
    // Auth & General
    contentHtml = `
      <div class="set-sec">
        <h3>Account, Devices & Sign Out</h3>
        <p class="set-desc">Manage authenticated sessions, 2FA security, and sign out of this device.</p>
        <div class="set-toggle-row">
          <span class="set-toggle-lbl">Two-Factor Authentication (TOTP / SMS)</span>
          <button class="sw" role="switch" id="set2Fa" aria-checked="${s.auth.twoFactorEnabled}"></button>
        </div>
        <div class="set-row" style="margin-top:20px;">
          <button type="button" class="btn bad" id="setSignOutBtn">Sign Out of SDE</button>
        </div>
      </div>`
  }

  return `
    <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Developer Settings">
      <div class="settings-header">
        <h2>Developer Settings</h2>
        <span style="flex:1"></span>
        <button class="ib" id="settingsCloseBtn" aria-label="Close Settings"><svg class="i"><use href="#i-x"/></svg></button>
      </div>
      <div class="settings-body">
        <nav class="settings-sidebar">${navItems}</nav>
        <main class="settings-content">${contentHtml}</main>
      </div>
      <div class="settings-footer">
        <button type="button" class="btn" id="settingsResetBtn">Restore Defaults</button>
        <span style="flex:1"></span>
        <button type="button" class="btn pri" id="settingsSaveBtn">Save Changes</button>
      </div>
    </div>`
}
