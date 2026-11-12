// Photo Asset Pipeline for VESPR SDE.
// Automatic intelligent photo name normalization, paired descriptive metadata sidecar generation (.meta.json),
// and deep search indexing across visual tags and extracted OCR text. Pure ES module.

export const VALID_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'avif', 'bmp']

const EXT_TO_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp'
}

export const SEMANTIC_PHOTO_KEYWORDS = new Set([
  'architecture', 'diagram', 'flow', 'schema', 'user', 'profile', 'avatar',
  'logo', 'banner', 'header', 'footer', 'nav', 'sidebar', 'button', 'icon',
  'favicon', 'card', 'mockup', 'wireframe', 'preview', 'thumb', 'thumbnail',
  'graph', 'chart', 'spec', 'hero', 'splash', 'login', 'signup', 'checkout',
  'cart', 'payment', 'settings', 'modal', 'dialog', 'layout', 'background',
  'pattern', 'badge', 'illustration', 'cover', 'branding', 'auth', 'dashboard',
  'metrics', 'analytics', 'pipeline', 'workflow', 'state', 'theme', 'dark', 'light'
])

export function extOf (name) {
  const m = /\.([A-Za-z0-9]{1,6})$/.exec(String(name || ''))
  return m ? m[1].toLowerCase() : ''
}

export function slugify (str) {
  return String(str || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

function formatDateTag (ts) {
  const d = new Date(Number(ts) || Date.now())
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const hr = String(d.getUTCHours()).padStart(2, '0')
  const min = String(d.getUTCMinutes()).padStart(2, '0')
  return `${y}${m}${day}-${hr}${min}`
}

/**
 * Checks whether a filename already follows a descriptive naming scheme
 * (e.g. architecture-diagram.png, user-profile.webp, logo-dark.svg, auth-flow-v2.png),
 * as opposed to generic camera dumps (IMG_0492.JPG), raw screenshots (Screenshot 2026-11-05...),
 * pasted fragments (Pasted image.png), or raw UUIDs/hex hashes.
 */
export function isDescriptiveImageName (fileName) {
  const raw = String(fileName || '').trim()
  if (!raw) return false

  // Extract base filename without extension and directory
  const baseName = raw.split(/[/\\]/).pop().replace(/\.[A-Za-z0-9]{1,6}$/, '').trim()
  if (!baseName) return false

  const lower = baseName.toLowerCase()

  // 1. Explicit generic screenshot patterns
  if (/^screen[\s_-]*shot/i.test(lower)) return false
  if (/^capture[\s_-]*\d*$/i.test(lower)) return false
  if (/^snip[\s_-]*\d*$/i.test(lower)) return false
  if (/^schermopname/i.test(lower)) return false
  if (/^capture[\s_-]*d[\s_-]*e/i.test(lower)) return false
  if (/^bildschirmfoto/i.test(lower)) return false

  // 2. Camera and scanner raw dumps
  if (/^img[\s_-]*\d+$/i.test(lower) || lower === 'img') return false
  if (/^dsc[n0-9]?[\s_-]*\d+$/i.test(lower) || lower === 'dsc') return false
  if (/^dcim[\s_-]*\d+$/i.test(lower)) return false
  if (/^sam[\s_-]*\d+$/i.test(lower)) return false
  if (/^p\d{6,}$/i.test(lower)) return false
  if (/^cimg\d+$/i.test(lower)) return false

  // 3. Generic paste or editor fragments
  if (/^pasted[\s_-]*image/i.test(lower)) return false
  if (/^(image|photo|pic|picture)[\s_-]*\d*$/i.test(lower)) return false
  if (/^untitled[\s_-]*\d*$/i.test(lower)) return false
  if (/^(clipboard|upload|file|temp|tmp|new|test)[\s_-]*\d*$/i.test(lower)) return false

  // 4. UUID / Hex hashes / pure numeric timestamps
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lower)) return false
  if (/^[0-9a-f]{16,64}$/i.test(lower)) return false
  if (/^\d{6,}$/.test(lower)) return false

  // 5. Tokenize word boundaries (camelCase, hyphens, underscores, dots, spaces)
  const expanded = baseName.replace(/([a-z])([A-Z])/g, '$1 $2')
  const tokens = expanded.split(/[-_.\s]+/).map(t => t.toLowerCase()).filter(Boolean)

  // Check if any recognized semantic UI/domain keyword is present
  if (tokens.some(t => SEMANTIC_PHOTO_KEYWORDS.has(t))) {
    return true
  }

  // Check if there are 2 or more distinct alphabetical words of length >= 2
  const alphaWords = tokens.filter(t => /^[a-z]{2,}$/.test(t) && !/^\d+$/.test(t))
  if (alphaWords.length >= 2) {
    return true
  }

  return false
}

/**
 * Determines whether an incoming image should be normalized.
 * Honors user setting autoNormalizeNames (default true) and avoidDescriptiveNames (default true).
 */
export function shouldNormalizeImageName (fileName, options = {}) {
  const raw = String(fileName || '').trim()
  if (!raw) return false

  if (options.autoNormalizeNames === false) return false

  const prefix = slugify(options.namePrefix || options.prefix || 'asset-photo')
  if (raw.toLowerCase().startsWith(prefix + '-')) return false

  const avoidDescriptive = options.avoidDescriptiveNames !== false
  if (avoidDescriptive && isDescriptiveImageName(raw)) {
    return false
  }

  return true
}

export function normalizePhotoName (originalName, { timestamp = Date.now(), prefix = 'asset-photo', sequence = 1 } = {}) {
  const raw = String(originalName || '').trim()
  let ext = extOf(raw)
  if (!VALID_IMAGE_EXTS.includes(ext)) ext = 'png'

  const baseWithoutExt = raw.replace(/\.[A-Za-z0-9]{1,6}$/, '')
  let hint = slugify(baseWithoutExt)

  // Remove generic prefixes from cameras or browsers like "screenshot-2026-..." or "img-0492"
  hint = hint
    .replace(/^screenshot[-_0-9a-z]*/i, 'screenshot')
    .replace(/^screen[-_]shot[-_0-9a-z]*/i, 'screenshot')
    .replace(/^img[-_0-9]*/i, 'capture')
    .replace(/^pasted[-_]image[-_0-9]*/i, 'pasted')

  if (!hint || hint === 'image' || hint === 'photo') hint = 'capture'

  const cleanPrefix = slugify(prefix) || 'asset-photo'
  const dateStr = formatDateTag(timestamp)
  const seqStr = sequence > 1 ? `-${sequence}` : ''

  return `${cleanPrefix}-${dateStr}-${hint}${seqStr}.${ext}`
}

export function formatSidecarPath (photoPath, format = 'json') {
  const p = String(photoPath || '').replace(/\\/g, '/')
  return format === 'text' ? `${p}.desc.txt` : `${p}.meta.json`
}

export function generatePairedMeta (photoPath, options = {}) {
  const p = String(photoPath || '').replace(/\\/g, '/')
  const ext = extOf(p) || 'png'
  const mimeType = EXT_TO_MIME[ext] || 'image/png'

  const rawW = Number(options.width)
  const rawH = Number(options.height)
  const hasDimensions = Number.isFinite(rawW) && rawW > 0 && Number.isFinite(rawH) && rawH > 0
  const width = hasDimensions ? Math.floor(rawW) : (options.width === undefined ? 1200 : null)
  const height = hasDimensions ? Math.floor(rawH) : (options.height === undefined ? 800 : null)
  const rawSize = Number(options.sizeBytes)
  const sizeBytes = Number.isFinite(rawSize) && rawSize >= 0 ? Math.floor(rawSize) : 0

  let aspectRatio = null
  if (width && height && Number.isFinite(width) && Number.isFinite(height)) {
    const gcd = (a, b) => {
      a = Math.floor(a); b = Math.floor(b)
      while (b !== 0) {
        const t = b
        b = a % b
        a = t
      }
      return a
    }
    const div = gcd(width, height) || 1
    aspectRatio = `${Math.floor(width / div)}:${Math.floor(height / div)}`
  }

  const tags = Array.isArray(options.tags)
    ? [...new Set(options.tags.map(t => slugify(t)).filter(Boolean))].slice(0, 30)
    : []

  const ocrTokens = Array.isArray(options.ocrTokens)
    ? [...new Set(options.ocrTokens.map(t => String(t || '').trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 100)
    : []

  const originalName = String(options.originalName || p.split('/').pop() || '')
  const description = String(options.description || '').slice(0, 500)

  // Build aggregated searchable index tokens
  const nameTokens = p.split('/').pop().replace(/\.[A-Za-z0-9]+$/, '').split(/[-_]+/).map(t => t.toLowerCase())
  const searchIndex = [...new Set([...nameTokens, ...tags, ...ocrTokens])].filter(Boolean)

  return {
    assetPath: p,
    originalName,
    format: ext,
    mimeType,
    width,
    height,
    aspectRatio,
    sizeBytes,
    createdAt: Number(options.createdAt) || Date.now(),
    description,
    tags,
    ocrTokens,
    searchIndex
  }
}

/**
 * End-to-end ingestion processor for incoming photos.
 * Applies naming rules, preserves descriptive schemes if enabled,
 * and produces paired .meta.json sidecars.
 */
export function processIncomingPhoto (fileName, options = {}) {
  const raw = String(fileName || '').trim()
  const shouldNorm = shouldNormalizeImageName(raw, options)
  const finalName = shouldNorm ? normalizePhotoName(raw, options) : raw
  const renamed = finalName !== raw

  let sidecarPath = null
  let meta = null
  const genSidecar = options.generatePairedSidecar !== false

  if (genSidecar) {
    sidecarPath = formatSidecarPath(finalName, options.sidecarFormat || 'json')
    meta = generatePairedMeta(finalName, {
      ...options,
      originalName: raw
    })
  }

  return {
    finalName,
    renamed,
    originalName: raw,
    sidecarPath,
    meta
  }
}

export function searchPhotoAssets (query, assetList = []) {
  const q = String(query || '').trim().toLowerCase()
  if (!q || !Array.isArray(assetList)) return []

  const queryTerms = q.split(/\s+/).filter(Boolean)
  const results = []

  for (const asset of assetList) {
    if (!asset) continue
    const meta = asset.meta || asset
    const name = String(asset.path || meta.assetPath || '').toLowerCase()
    const desc = String(meta.description || '').toLowerCase()
    const tags = Array.isArray(meta.tags) ? meta.tags : []
    const ocr = Array.isArray(meta.ocrTokens) ? meta.ocrTokens : []
    const index = Array.isArray(meta.searchIndex) ? meta.searchIndex : []

    let score = 0
    const matchedTerms = []

    for (const term of queryTerms) {
      if (name.includes(term)) {
        score += 10
        matchedTerms.push(term)
      } else if (tags.some(t => t.includes(term))) {
        score += 8
        matchedTerms.push(term)
      } else if (desc.includes(term)) {
        score += 5
        matchedTerms.push(term)
      } else if (ocr.some(o => o.includes(term))) {
        score += 4
        matchedTerms.push(term)
      } else if (index.some(i => i.includes(term))) {
        score += 2
        matchedTerms.push(term)
      }
    }

    if (score > 0) {
      results.push({
        assetPath: asset.path || meta.assetPath,
        score,
        matchedTerms: [...new Set(matchedTerms)],
        meta
      })
    }
  }

  return results.sort((a, b) => b.score - a.score)
}
