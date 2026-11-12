// secret-scan: allow
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createDataPipeline, sanitizeTrainingText } from '../data-pipeline.js'

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'vespr-pipeline-test-'))

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
  t('sanitizeTrainingText strips secret keys and passwords', () => {
    const raw = 'Connect with sk-proj-1234567890abcdefghijklmnopqrstuvwxyz123456 and password="mySecretPassword123"' // secret-scan: allow
    const clean = sanitizeTrainingText(raw)
    assert.ok(!clean.includes('sk-proj-'))
    assert.ok(!clean.includes('mySecretPassword123'))
    assert.ok(clean.includes('[REDACTED_CREDENTIAL]'))
    assert.ok(clean.includes('credential=[REDACTED]'))
  })

  t('paid plans strictly bypass data retention (Zero Data Retention guarantee)', () => {
    const pipe = createDataPipeline({ DATA })
    for (const plan of ['pro', 'team', 'enterprise', 'corporate_paid']) {
      const res = pipe.recordTrainingSample({
        who: 'sarah',
        room: 'prod-room',
        plan,
        prompt: 'Build the billing gateway',
        completion: 'class StripeGateway: pass'
      })
      assert.strictEqual(res.retained, false)
      assert.strictEqual(res.reason, 'paid_zero_data_retention_guarantee')
    }
  })

  t('free tier personal and corporate free accounts retain training samples in ChatML format', () => {
    const pipe = createDataPipeline({ DATA })

    // Personal free
    const r1 = pipe.recordTrainingSample({
      who: 'alex',
      room: 'hackathon-room',
      plan: 'free',
      prompt: 'Write an asynchronous queue in Python',
      completion: 'import asyncio\nclass WorkQueue: pass',
      language: 'python'
    })
    assert.strictEqual(r1.retained, true)
    assert.ok(r1.id.startsWith('samp-'))

    // Corporate free
    const r2 = pipe.recordTrainingSample({
      who: 'john@corp.dev',
      room: 'corp-demo',
      plan: 'free',
      isCorporate: true,
      prompt: 'Refactor database migrations in Node.js',
      completion: 'export async function up(knex) { return knex.schema.createTable(...) }',
      language: 'javascript'
    })
    assert.strictEqual(r2.retained, true)

    // Verify stats
    const stats = pipe.getDatasetStats()
    assert.strictEqual(stats.totalSamples, 2)
    assert.strictEqual(stats.plans.free, 1)
    assert.strictEqual(stats.plans.corporate_free, 1)
    assert.strictEqual(stats.languages.python, 1)
    assert.strictEqual(stats.languages.javascript, 1)

    // Read batch
    const batch = pipe.readDatasetBatch({ limit: 10 })
    assert.strictEqual(batch.length, 2)
    assert.strictEqual(batch[0].messages.length, 3)
    assert.strictEqual(batch[0].messages[0].role, 'system')
    assert.strictEqual(batch[0].messages[1].role, 'user')
    assert.strictEqual(batch[0].messages[2].role, 'assistant')
  })

  console.log(`data-pipeline tests passed (${n})`)
} finally {
  fs.rmSync(DATA, { recursive: true, force: true })
}
