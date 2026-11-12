// Image Indexer & Workspace Entity Retention Engine for VESPR SDE.
// In accordance with the VESPR team's UX specification (2026-11-07 BRIEF.md Section 7):
// - Pre-analyzes images into workflow entities (OCR tokens, UI elements, visual tags, aspect ratio, color themes).
// - Binds entities to the active workspace.
// - When an image leaves the workspace: active workspace entities are dropped (split apart),
//   but the pre-analyzed entity index is retained in the persistent cache.
// - When the image is brought back into prod/workspace: instantly restores using the retained index without re-analysis.
// - Unified search across Agentic, History, and Image-based domains.

import { slugify, extOf, generatePairedMeta, VALID_IMAGE_EXTS } from './photo-asset-pipeline.js'

export function isImageFile (filePath) {
  const ext = extOf(filePath)
  return VALID_IMAGE_EXTS.includes(ext)
}

function simpleHash (str) {
  let h = 0x811c9dc5
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return ('0000000' + (h >>> 0).toString(16)).slice(-8)
}

export function extractVisualEntities (imagePath, options = {}) {
  const p = String(imagePath || '').replace(/\\/g, '/')
  if (!p || !isImageFile(p) || options.failed || options.error || options.status === 'failed' || options.isStale) return null
  const baseName = p.split('/').pop().replace(/\.[A-Za-z0-9]+$/, '')
  const ext = extOf(p) || 'png'
  const hash = options.contentHash || simpleHash(`${p}:${options.sizeBytes || 0}:${options.description || ''}`)

  const meta = generatePairedMeta(p, {
    originalName: options.originalName || baseName,
    width: options.width || 1280,
    height: options.height || 720,
    sizeBytes: options.sizeBytes || 1024,
    description: options.description || '',
    tags: options.tags || [],
    ocrTokens: options.ocrTokens || []
  })

  const entities = []

  // 1. Structural entity
  entities.push({
    id: `ent-${hash}-asset`,
    kind: 'visual-asset',
    name: baseName,
    path: p,
    format: ext,
    aspectRatio: meta.aspectRatio,
    dimensions: `${meta.width}x${meta.height}`,
    tokens: [baseName.toLowerCase(), ext, meta.aspectRatio]
  })

  // 2. Semantic & Tag entities
  for (const tag of meta.tags) {
    entities.push({
      id: `ent-${hash}-tag-${slugify(tag)}`,
      kind: 'semantic-tag',
      name: tag,
      sourceAsset: p,
      tokens: [slugify(tag)]
    })
  }

  // 3. OCR text entities
  for (const ocr of meta.ocrTokens) {
    const rawTokens = ocr.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    if (!rawTokens.length && ocr.trim()) rawTokens.push(ocr.trim().toLowerCase())
    entities.push({
      id: `ent-${hash}-ocr-${simpleHash(ocr)}`,
      kind: 'ocr-text',
      text: ocr,
      sourceAsset: p,
      tokens: rawTokens
    })
  }

  // 4. UI Domain component entity if detected
  const lowerBase = baseName.toLowerCase()
  if (meta.searchIndex.some(t => ['diagram', 'architecture', 'flow', 'schema', 'dashboard', 'modal', 'card', 'button'].includes(t))) {
    entities.push({
      id: `ent-${hash}-ui-component`,
      kind: 'ui-component',
      name: `${baseName} Component`,
      sourceAsset: p,
      tokens: ['ui', 'component', lowerBase]
    })
  }

  return {
    contentHash: hash,
    meta,
    entities
  }
}

export function createImageIndexer (initData = {}) {
  // Active workspace entities: Map<imagePath, Array<Entity>>
  const activeEntities = new Map()

  // Retained persistent entity cache: Map<contentHash, { meta, entities, lastPath, retainedAt }>
  const retainedCache = new Map()

  if (initData.retained && typeof initData.retained === 'object') {
    for (const [h, record] of Object.entries(initData.retained)) {
      retainedCache.set(h, record)
    }
  }

  return {
    /**
     * Index an image into the active workspace.
     * If the image was previously analyzed (matching contentHash in retention cache),
     * it instantly restores pre-analyzed entities without re-running analysis.
     */
    indexImage (imagePath, options = {}) {
      const p = String(imagePath || '').replace(/\\/g, '/')
      if (!p || !isImageFile(p) || options.failed || options.error || options.status === 'failed' || options.isStale) return null
      const tagsKey = Array.isArray(options.tags) ? options.tags.join(',') : ''
      const ocrKey = Array.isArray(options.ocrTokens) ? options.ocrTokens.join(',') : ''
      const hash = options.contentHash || simpleHash(`${p}:${options.sizeBytes || 0}:${options.description || ''}:${tagsKey}:${ocrKey}:${options.width || 0}:${options.height || 0}`)

      if (retainedCache.has(hash)) {
        // Fast-path cache hit: restore pre-analyzed entities
        const cached = retainedCache.get(hash)
        cached.lastPath = p
        if (cached.meta) cached.meta.assetPath = p
        for (const ent of cached.entities) {
          ent.sourceAsset = p
          if (ent.path) ent.path = p
        }
        activeEntities.set(p, cached.entities)
        return {
          path: p,
          contentHash: hash,
          restoredFromCache: true,
          entities: cached.entities,
          meta: cached.meta
        }
      }

      // Fresh extraction
      const extracted = extractVisualEntities(p, { ...options, contentHash: hash })
      activeEntities.set(p, extracted.entities)
      retainedCache.set(hash, {
        contentHash: hash,
        meta: extracted.meta,
        entities: extracted.entities,
        lastPath: p,
        retainedAt: Date.now()
      })

      return {
        path: p,
        contentHash: hash,
        restoredFromCache: false,
        entities: extracted.entities,
        meta: extracted.meta
      }
    },

    /**
     * Drop image when it leaves the workspace.
     * Splits apart and removes live entities from active workspace context,
     * but retains the pre-analyzed index so re-adding it is instant.
     */
    dropImageFromWorkspace (imagePath) {
      const p = String(imagePath || '').replace(/\\/g, '/')
      const current = activeEntities.get(p)
      if (!current) {
        return { dropped: false, path: p }
      }

      activeEntities.delete(p)
      return {
        dropped: true,
        path: p,
        entitiesDroppedCount: current.length,
        retainedInCache: true
      }
    },

    /**
     * Explicitly restore a previously analyzed image into active workspace by hash or path.
     */
    restoreImageToWorkspace (imagePath, contentHash) {
      const p = String(imagePath || '').replace(/\\/g, '/')
      let hash = contentHash
      if (!hash) {
        const matches = [...retainedCache.entries()].filter(([, r]) => r.lastPath === p)
        if (matches.length > 0) {
          matches.sort((a, b) => (b[1].retainedAt || 0) - (a[1].retainedAt || 0))
          hash = matches[0][0]
        }
      }

      if (!hash || !retainedCache.has(hash)) {
        return { restored: false, error: 'Entity index not found in retention store' }
      }

      const cached = retainedCache.get(hash)
      cached.lastPath = p
      activeEntities.set(p, cached.entities)
      return {
        restored: true,
        path: p,
        contentHash: hash,
        entities: cached.entities
      }
    },

    getActiveEntities (pathFilter = null) {
      if (pathFilter) return activeEntities.get(pathFilter) || []
      const all = []
      for (const [p, list] of activeEntities.entries()) {
        for (const ent of list) all.push({ ...ent, activePath: p })
      }
      return all
    },

    getRetainedRecords () {
      return [...retainedCache.values()]
    },

    hasRetainedHash (hash) {
      return retainedCache.has(hash)
    },

    isImageActive (path) {
      return activeEntities.has(String(path || '').replace(/\\/g, '/'))
    },

    exportRetentionStore () {
      const out = {}
      for (const [h, rec] of retainedCache.entries()) {
        out[h] = rec
      }
      return out
    },

    /**
     * Unified search across Agentic, History, and Image domains.
     */
    search ({ query, kind = 'all', agenticContext = [], historyContext = [] }) {
      const q = String(query || '').trim().toLowerCase()
      if (!q) return []

      const terms = q.split(/\s+/).filter(Boolean)
      const results = []
      const seenIds = new Set()

      // 1. Search Active & Retained Image Entities
      if (kind === 'all' || kind === 'image' || kind === 'images') {
        for (const [p, entities] of activeEntities.entries()) {
          for (const ent of entities) {
            let score = 0
            for (const t of terms) {
              if (ent.tokens && ent.tokens.some(tok => tok.includes(t))) score += 8
              if (ent.name && ent.name.toLowerCase().includes(t)) score += 10
              if (ent.text && ent.text.toLowerCase().includes(t)) score += 6
            }
            if (score > 0 && !seenIds.has(ent.id)) {
              seenIds.add(ent.id)
              results.push({
                domain: 'image',
                id: ent.id,
                title: ent.name || ent.text || ent.kind,
                subtitle: `${ent.kind} · Active in ${p}`,
                score,
                active: true,
                entity: ent
              })
            }
          }
        }

        // Also search retained items not currently active
        for (const [hash, rec] of retainedCache.entries()) {
          const isActive = [...activeEntities.keys()].some(p => p === rec.lastPath)
          if (!isActive) {
            for (const ent of rec.entities) {
              let score = 0
              for (const t of terms) {
                if (ent.tokens && ent.tokens.some(tok => tok.includes(t))) score += 4
                if (ent.name && ent.name.toLowerCase().includes(t)) score += 6
                if (ent.text && ent.text.toLowerCase().includes(t)) score += 4
              }
              if (score > 0 && !seenIds.has(ent.id)) {
                seenIds.add(ent.id)
                results.push({
                  domain: 'image',
                  id: ent.id,
                  title: ent.name || ent.text || ent.kind,
                  subtitle: `${ent.kind} · Retained from ${rec.lastPath}`,
                  score: score - 1,
                  active: false,
                  entity: ent
                })
              }
            }
          }
        }
      }

      // 2. Search Agentic Domain (prompts, agent skills, persona)
      if (kind === 'all' || kind === 'agentic') {
        for (const item of agenticContext) {
          const title = String(item.title || item.name || '').toLowerCase()
          const text = String(item.text || item.prompt || '').toLowerCase()
          let score = 0
          for (const t of terms) {
            if (title.includes(t)) score += 10
            if (text.includes(t)) score += 5
          }
          if (score > 0) {
            results.push({
              domain: 'agentic',
              id: item.id || `agentic-${simpleHash(title)}`,
              title: item.title || item.name || 'Agent Prompt',
              subtitle: item.role || item.model || 'Agentic workflow',
              score,
              item
            })
          }
        }
      }

      // 3. Search History Domain (checkpoints, conversations, versions)
      if (kind === 'all' || kind === 'history') {
        for (const item of historyContext) {
          const title = String(item.title || item.subject || item.message || '').toLowerCase()
          const text = String(item.text || item.detail || '').toLowerCase()
          let score = 0
          for (const t of terms) {
            if (title.includes(t)) score += 10
            if (text.includes(t)) score += 4
          }
          if (score > 0) {
            results.push({
              domain: 'history',
              id: item.id || item.sha || `hist-${simpleHash(title)}`,
              title: item.title || item.subject || item.message || 'Checkpoint',
              subtitle: item.author ? `${item.author} · ${item.timeAgo || 'recent'}` : 'History checkpoint',
              score,
              item
            })
          }
        }
      }

      return results.sort((a, b) => b.score - a.score)
    }
  }
}
