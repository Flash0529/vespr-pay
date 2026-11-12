// VESPR Training Telemetry & Dataset Ingestion Pipeline
// Collects sanitized instruction-tuning pairs from Free Tier personal and corporate accounts
// for proprietary model training, while strictly enforcing Zero Data Retention for paid tiers.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// Secret scrub regex to guarantee no credentials enter training datasets
const SECRET_RE = /\b(?:sk-[a-zA-Z0-9_\-]{20,}|ghp_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z\-_]{25,}|Bearer\s+[a-zA-Z0-9._\-]{20,}|AKIA[0-9A-Z]{16})\b/gi
const PASS_RE = /\b(?:password|secret|key)\s*[:=]\s*['"][^'"]+['"]/gi

export function sanitizeTrainingText (text) {
  return String(text ?? '')
    .replace(SECRET_RE, '[REDACTED_CREDENTIAL]')
    .replace(PASS_RE, 'credential=[REDACTED]')
}

export function createDataPipeline ({ DATA, now = Date.now, random = n => crypto.randomBytes(n) } = {}) {
  const trainingDir = path.join(DATA, 'training')
  try { fs.mkdirSync(trainingDir, { recursive: true, mode: 0o700 }) } catch {}
  const datasetFile = path.join(trainingDir, 'dataset.jsonl')

  function isPaidTier (plan) {
    const p = String(plan || 'free').trim().toLowerCase()
    return ['pro', 'team', 'teams', 'enterprise', 'corporate_paid', 'paid'].includes(p)
  }

  function recordTrainingSample ({ who, room, plan = 'free', isCorporate = false, prompt, context = null, completion = '', diff = null, language = 'python' }) {
    if (isPaidTier(plan)) {
      return { retained: false, reason: 'paid_zero_data_retention_guarantee' }
    }

    const cleanPrompt = sanitizeTrainingText(prompt).trim()
    const cleanComp = sanitizeTrainingText(completion || diff || '').trim()
    if (!cleanPrompt || !cleanComp) {
      return { retained: false, reason: 'empty_prompt_or_completion' }
    }

    const sample = {
      id: 'samp-' + random(6).toString('hex'),
      ts: now(),
      plan: isCorporate ? 'corporate_free' : 'free',
      is_corporate: !!isCorporate,
      language: String(language || 'python').toLowerCase(),
      messages: [
        { role: 'system', content: 'You are VESPR Coder, an autonomous agent pair programmer.' },
        { role: 'user', content: cleanPrompt.slice(0, 10000) },
        { role: 'assistant', content: cleanComp.slice(0, 20000) }
      ],
      metadata: {
        who_anon: crypto.createHash('sha256').update(String(who || 'anon')).digest('hex').slice(0, 12),
        room_anon: crypto.createHash('sha256').update(String(room || 'room')).digest('hex').slice(0, 12),
        char_count: cleanPrompt.length + cleanComp.length,
        retained_under: 'terms_sec_7_free_tier'
      }
    }

    try {
      fs.appendFileSync(datasetFile, JSON.stringify(sample) + '\n', { mode: 0o600 })
      return { retained: true, id: sample.id }
    } catch (err) {
      return { retained: false, error: err.message }
    }
  }

  function getDatasetStats () {
    if (!fs.existsSync(datasetFile)) {
      return { totalSamples: 0, totalChars: 0, languages: {}, plans: { free: 0, corporate_free: 0 } }
    }
    const lines = fs.readFileSync(datasetFile, 'utf8').trim().split('\n').filter(Boolean)
    const stats = {
      totalSamples: lines.length,
      totalChars: 0,
      languages: {},
      plans: { free: 0, corporate_free: 0 }
    }
    for (const l of lines) {
      try {
        const obj = JSON.parse(l)
        stats.totalChars += obj.metadata?.char_count || 0
        const lang = obj.language || 'other'
        stats.languages[lang] = (stats.languages[lang] || 0) + 1
        const p = obj.plan || 'free'
        stats.plans[p] = (stats.plans[p] || 0) + 1
      } catch {}
    }
    return stats
  }

  function readDatasetBatch ({ limit = 100, offset = 0 } = {}) {
    if (!fs.existsSync(datasetFile)) return []
    const lines = fs.readFileSync(datasetFile, 'utf8').trim().split('\n').filter(Boolean)
    return lines.slice(offset, offset + limit).map(l => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)
  }

  function http (req, res, { identify = () => null } = {}) {
    const u = new URL(req.url, 'http://x')
    if (!u.pathname.startsWith('/api/admin/training-')) return false

    const authHdr = req.headers.authorization || ''
    const who = identify(authHdr.replace(/^Bearer\s+/i, ''))
    if (!who) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return true
    }

    if (u.pathname === '/api/admin/training-stats' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(getDatasetStats()))
      return true
    }

    if (u.pathname === '/api/admin/training-dataset' && req.method === 'GET') {
      const limit = Math.min(500, Math.max(1, Number(u.searchParams.get('limit')) || 100))
      const offset = Math.max(0, Number(u.searchParams.get('offset')) || 0)
      const batch = readDatasetBatch({ limit, offset })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ count: batch.length, samples: batch }))
      return true
    }

    return false
  }

  return {
    recordTrainingSample,
    getDatasetStats,
    readDatasetBatch,
    http,
    datasetPath: datasetFile
  }
}
