import test from 'node:test'
import assert from 'node:assert/strict'
import { createModelRegistry, SUPPORTED_MODELS, PROVIDER_KINDS } from '../model-providers.js'

test('createModelRegistry initializes with default Flint 40B model', () => {
  const reg = createModelRegistry()
  const active = reg.getActiveModel()
  assert.equal(active.id, 'flint:40b')
  assert.equal(active.provider, PROVIDER_KINDS.LOCAL_GPU)
  assert.equal(active.sandboxSafe, true)
})

test('listModels filters by capability', () => {
  const reg = createModelRegistry()
  const predictives = reg.listModels('inline_predictive')
  assert.ok(predictives.length >= 2)
  assert.ok(predictives.some(m => m.id === 'flint:40b'))
  assert.ok(predictives.some(m => m.id === 'ollama:coder-32b'))

  const largeRepo = reg.listModels('large_repo_context')
  assert.equal(largeRepo.length, 1)
  assert.equal(largeRepo[0].id, 'kimi:k3-longcontext')
  assert.equal(largeRepo[0].contextWindow, 1048576)
})

test('setActiveModel switches active model and rejects unknown models', () => {
  const reg = createModelRegistry()
  const switchRes = reg.setActiveModel('kimi:k3-longcontext')
  assert.equal(switchRes.success, true)
  assert.equal(reg.getActiveModel().id, 'kimi:k3-longcontext')

  const badRes = reg.setActiveModel('unknown-model-xyz')
  assert.equal(badRes.success, false)
  assert.match(badRes.error, /not found/i)
  assert.equal(reg.getActiveModel().id, 'kimi:k3-longcontext')
})

test('resolveTarget enforces sandbox fallback to Flint 40B when unshare-net is active', () => {
  const reg = createModelRegistry()

  // In non-sandboxed environment, Kimi K3 is returned directly
  const direct = reg.resolveTarget('kimi:k3-longcontext', false)
  assert.equal(direct.isFallback, false)
  assert.equal(direct.model.id, 'kimi:k3-longcontext')

  // In sandboxed container (isSandboxed = true), Kimi K3 falls back to Flint 40B
  const sandboxed = reg.resolveTarget('kimi:k3-longcontext', true)
  assert.equal(sandboxed.isFallback, true)
  assert.equal(sandboxed.model.id, 'flint:40b')
  assert.match(sandboxed.reason, /prohibited in strict container sandboxes/i)

  // Flint 40B inside sandbox does NOT fall back (already sandbox-safe)
  const flintSandboxed = reg.resolveTarget('flint:40b', true)
  assert.equal(flintSandboxed.isFallback, false)
  assert.equal(flintSandboxed.model.id, 'flint:40b')
})

test('formatCompletionRequest produces structured payload for agent inlay', () => {
  const reg = createModelRegistry('flint:40b')
  const req = reg.formatCompletionRequest('def calculate_sum(a, b):', { maxTokens: 64, temperature: 0.1 })

  assert.equal(req.model, 'flint:40b')
  assert.equal(req.provider, PROVIDER_KINDS.LOCAL_GPU)
  assert.equal(req.prompt, 'def calculate_sum(a, b):')
  assert.equal(req.maxTokens, 64)
  assert.equal(req.temperature, 0.1)
  assert.ok(Array.isArray(req.stop))
})

test('formatCompletionRequest defaults temperature to 0.2 and handles options properly', () => {
  const reg = createModelRegistry('kimi:k3-longcontext')
  const req = reg.formatCompletionRequest('synthetic fixture only')
  assert.equal(req.temperature, 0.2)
  assert.equal(Number.isFinite(req.temperature), true)
  const json = JSON.parse(JSON.stringify(req))
  assert.equal(json.temperature, 0.2)
})

test('models do not expose private IPs or invented prices and flag preview status', () => {
  const reg = createModelRegistry()
  const all = reg.listModels()
  for (const m of all) {
    assert.ok(!m.endpoint.includes('100.64.0.10'), `Model ${m.id} must not reference private IP`)
    assert.equal(m.costPerMToken, undefined, `Model ${m.id} must not define invented costPerMToken`)
    if (m.id === 'nebius:nemotron-3-super') {
      assert.equal(m.preview, false, 'Server default model is not preview')
    } else {
      assert.equal(m.preview, true, `Model ${m.id} must be flagged as preview`)
    }
  }
})
