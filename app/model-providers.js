// Model Provider Layer Interface for VESPR SDE.
// In accordance with the VESPR team's specification (BRIEF.md Section 7 & ROADMAP-2026-11-07 Item 9):
// "make sure to make all this with plans to switch to kimi k3 and flint and ollama 40b and the coder one too...
//  plan and make sure what u are building wont be critically destroyed when inlay the agents code into this."
//
// Pure ES module: provides abstract interface, registry, capability negotiation, and sandbox-safe routing.

export const PROVIDER_KINDS = {
  LOCAL_GPU: 'local_gpu',
  OLLAMA: 'ollama',
  KIMI: 'kimi',
  NEBIUS: 'nebius'
}

export const SUPPORTED_MODELS = [
  {
    id: 'flint:40b',
    name: 'Flint 40B (Preview)',
    provider: PROVIDER_KINDS.LOCAL_GPU,
    endpoint: '/api/generate',
    contextWindow: 65536,
    capabilities: ['completion', 'chat', 'code', 'inline_predictive'],
    sandboxSafe: true,
    preview: true,
    latencyTier: 'ultra_fast',
    description: 'Local fine-tuned 40B model profile preview. Server-side agent inference currently defaults to NEBIUS_MODEL.'
  },
  {
    id: 'ollama:coder-32b',
    name: 'Ollama Coder 32B (Preview)',
    provider: PROVIDER_KINDS.OLLAMA,
    endpoint: '/api/generate',
    contextWindow: 32768,
    capabilities: ['completion', 'code', 'inline_predictive'],
    sandboxSafe: true,
    preview: true,
    latencyTier: 'ultra_fast',
    description: 'Specialized local code synthesis profile preview. Server-side agent inference currently defaults to NEBIUS_MODEL.'
  },
  {
    id: 'kimi:k3-longcontext',
    name: 'Moonshot Kimi K3 (Preview)',
    provider: PROVIDER_KINDS.KIMI,
    endpoint: '/api/generate',
    contextWindow: 1048576,
    capabilities: ['chat', 'tools', 'code', 'large_repo_context'],
    sandboxSafe: false,
    preview: true,
    latencyTier: 'standard',
    description: 'Long-context 1M-token architecture preview. Server-side agent inference currently defaults to NEBIUS_MODEL.'
  },
  {
    id: 'nebius:nemotron-3-super',
    name: 'Nemotron 3 Super (Active Server Model)',
    provider: PROVIDER_KINDS.NEBIUS,
    endpoint: '/api/generate',
    contextWindow: 131072,
    capabilities: ['chat', 'tools', 'code', 'orchestration'],
    sandboxSafe: false,
    preview: false,
    latencyTier: 'fast',
    description: 'Production model matching the server-side NEBIUS_MODEL configuration.'
  }
]

export function createModelRegistry (initialActiveId = 'flint:40b') {
  const models = new Map()
  for (const m of SUPPORTED_MODELS) {
    models.set(m.id, m)
  }

  let activeModelId = models.has(initialActiveId) ? initialActiveId : 'flint:40b'

  return {
    listModels (capabilityFilter = null) {
      const all = [...models.values()]
      if (!capabilityFilter) return all
      return all.filter(m => m.capabilities.includes(capabilityFilter))
    },

    getModel (id) {
      return models.get(id) || null
    },

    getActiveModel () {
      return models.get(activeModelId) || models.get('flint:40b')
    },

    setActiveModel (id) {
      if (!models.has(id)) {
        return { success: false, error: `Model '${id}' not found in registry` }
      }
      activeModelId = id
      return { success: true, activeModel: models.get(id) }
    },

    /**
     * Resolves the execution target for a given model.
     * When running inside a strict container sandbox without internet access,
     * cloud models (Kimi, Nebius) automatically fall back to local sandbox-safe models (Flint 40B).
     */
    resolveTarget (modelId, isSandboxed = false) {
      const targetModel = models.get(modelId) || models.get('flint:40b')
      if (isSandboxed && !targetModel.sandboxSafe) {
        // Fallback to Flint 40B for offline / sandboxed execution
        const fallback = models.get('flint:40b')
        return {
          model: fallback,
          isFallback: true,
          reason: `Model '${targetModel.name}' requires outbound network access which is prohibited in strict container sandboxes. Falling back to '${fallback.name}'.`
        }
      }
      return {
        model: targetModel,
        isFallback: false
      }
    },

    /**
     * Prepares standard payload structure ready for agent inlay.
     */
    formatCompletionRequest (prompt, options = {}) {
      const active = options.modelId ? (this.getModel(options.modelId) || this.getActiveModel()) : this.getActiveModel()
      const resolved = options.isSandboxed ? this.resolveTarget(active.id, true).model : active
      const temp = Number(options.temperature)
      return {
        model: resolved.id,
        provider: resolved.provider,
        endpoint: resolved.endpoint,
        prompt: String(prompt || ''),
        maxTokens: Number(options.maxTokens) || 256,
        temperature: (typeof options.temperature === 'number' && Number.isFinite(temp)) ? temp : 0.2,
        stop: options.stop || ['\n\n', '```']
      }
    }
  }
}
