// Telemetry and Latency Benchmarking Engine for Search Engines and AI Auto-fill.
// Measures query latency, auto-fill suggestion load time, result bar rendering time, and miss rate.
// Pure ES module.

export function createTelemetryCollector () {
  const searchSamples = []
  const aiSamples = []

  return {
    recordSearchQuery ({ query, executionTimeMs, autoFillLatencyMs, resultRenderTimeMs, matchCount, source = 'bar' }) {
      const q = String(query || '').trim()
      const execMs = Math.max(0, Number(executionTimeMs) || 0)
      const autoFillMs = Math.max(0, Number(autoFillLatencyMs) || 0)
      const renderMs = Math.max(0, Number(resultRenderTimeMs) || 0)
      const count = Math.max(0, Math.floor(Number(matchCount) || 0))
      const isMiss = count === 0

      searchSamples.push({
        query: q,
        execMs,
        autoFillMs,
        renderMs,
        totalLoadTimeMs: execMs + renderMs,
        count,
        isMiss,
        source,
        ts: Date.now()
      })
    },

    recordAiCompletion ({ promptChars, completionTokens, latencyMs, accepted = true, isInlineAutoFill = true }) {
      const pChars = Math.max(0, Math.floor(Number(promptChars) || 0))
      const cTokens = Math.max(0, Math.floor(Number(completionTokens) || 0))
      const latMs = Math.max(0, Number(latencyMs) || 0)

      aiSamples.push({
        promptChars: pChars,
        completionTokens: cTokens,
        latMs,
        accepted: !!accepted,
        isInlineAutoFill: !!isInlineAutoFill,
        ts: Date.now()
      })
    },

    getSearchMetrics () {
      if (!searchSamples.length) {
        return {
          totalQueries: 0,
          avgExecutionTimeMs: 0,
          p95ExecutionTimeMs: 0,
          avgAutoFillLatencyMs: 0,
          avgResultRenderTimeMs: 0,
          avgTotalResultLoadTimeMs: 0,
          missCount: 0,
          missRatePercent: 0
        }
      }

      const total = searchSamples.length
      const execSum = searchSamples.reduce((s, x) => s + x.execMs, 0)
      const autoFillSum = searchSamples.reduce((s, x) => s + x.autoFillMs, 0)
      const renderSum = searchSamples.reduce((s, x) => s + x.renderMs, 0)
      const totalLoadSum = searchSamples.reduce((s, x) => s + x.totalLoadTimeMs, 0)
      const missCount = searchSamples.filter(x => x.isMiss).length

      const sortedExec = [...searchSamples].map(x => x.execMs).sort((a, b) => a - b)
      const p95Idx = Math.floor(total * 0.95)
      const p95 = sortedExec[Math.min(p95Idx, total - 1)]

      return {
        totalQueries: total,
        avgExecutionTimeMs: Number((execSum / total).toFixed(2)),
        p95ExecutionTimeMs: Number(p95.toFixed(2)),
        avgAutoFillLatencyMs: Number((autoFillSum / total).toFixed(2)),
        avgResultRenderTimeMs: Number((renderSum / total).toFixed(2)),
        avgTotalResultLoadTimeMs: Number((totalLoadSum / total).toFixed(2)),
        missCount,
        missRatePercent: Number(((missCount / total) * 100).toFixed(2))
      }
    },

    getAiMetrics () {
      if (!aiSamples.length) {
        return {
          totalRequests: 0,
          avgLatencyMs: 0,
          p95LatencyMs: 0,
          acceptedCount: 0,
          missCount: 0,
          missRatePercent: 0
        }
      }

      const total = aiSamples.length
      const latSum = aiSamples.reduce((s, x) => s + x.latMs, 0)
      const sortedLat = [...aiSamples].map(x => x.latMs).sort((a, b) => a - b)
      const p95Idx = Math.floor(total * 0.95)
      const p95 = sortedLat[Math.min(p95Idx, total - 1)]
      const acceptedCount = aiSamples.filter(x => x.accepted).length
      const missCount = total - acceptedCount

      return {
        totalRequests: total,
        avgLatencyMs: Number((latSum / total).toFixed(2)),
        p95LatencyMs: Number(p95.toFixed(2)),
        acceptedCount,
        missCount,
        missRatePercent: Number(((missCount / total) * 100).toFixed(2))
      }
    },

    reset () {
      searchSamples.length = 0
      aiSamples.length = 0
    }
  }
}
