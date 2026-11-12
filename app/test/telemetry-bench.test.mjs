import assert from 'node:assert'
import { createTelemetryCollector } from '../telemetry-bench.js'

const col = createTelemetryCollector()

// search recording
col.recordSearchQuery({ query: 'fuzzy', executionTimeMs: 1.2, autoFillLatencyMs: 8.5, resultRenderTimeMs: 0.8, matchCount: 5 })
col.recordSearchQuery({ query: 'render', executionTimeMs: 2.1, autoFillLatencyMs: 9.0, resultRenderTimeMs: 1.1, matchCount: 3 })
col.recordSearchQuery({ query: 'nonexistent', executionTimeMs: 0.5, autoFillLatencyMs: 5.0, resultRenderTimeMs: 0.2, matchCount: 0 })

const sm = col.getSearchMetrics()
assert.strictEqual(sm.totalQueries, 3)
assert.strictEqual(sm.missCount, 1)
assert.strictEqual(sm.missRatePercent, 33.33)
assert.ok(sm.avgExecutionTimeMs > 0)
assert.ok(sm.avgAutoFillLatencyMs > 0)
assert.ok(sm.avgTotalResultLoadTimeMs > 0)

// AI recording
col.recordAiCompletion({ promptChars: 120, completionTokens: 15, latencyMs: 35.0, accepted: true })
col.recordAiCompletion({ promptChars: 150, completionTokens: 25, latencyMs: 42.0, accepted: true })
col.recordAiCompletion({ promptChars: 200, completionTokens: 5, latencyMs: 28.0, accepted: false }) // rejected

const am = col.getAiMetrics()
assert.strictEqual(am.totalRequests, 3)
assert.strictEqual(am.acceptedCount, 2)
assert.strictEqual(am.missCount, 1)
assert.strictEqual(am.missRatePercent, 33.33)
assert.ok(am.avgLatencyMs > 0)

console.log('telemetry-bench tests passed successfully')
