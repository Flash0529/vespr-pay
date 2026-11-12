// Personal Chat inference: POST /api/personal/chat  { messages: [{role:'user'|'assistant', content}] } (Bearer, a signed-in person) -> { reply, model }
// Chat mode in the app never touches a workspace, so this is a plain model call with a fixed system prompt, no tools, no files, nothing stored on the server (the thread lives on the
// person's device). It is OFF until the operator configures a model: either VESPR_PERSONAL_MODEL_URL + VESPR_PERSONAL_MODEL_KEY + VESPR_PERSONAL_MODEL (any OpenAI-compatible API) or the
// NEBIUS_API_KEY the agents already use (Nebius Token Factory, Nemotron). Without one of them the answer is 503 {error:'no_model'} and the app says so. Agents and workspace identities cannot use it; each person gets a per-minute cap.
import { readJson, sendJson, bearer, isAgentName } from './jsonstore.js'

// perMinute/perDay are per person, perMinuteAll is for the whole server, inFlight is simultaneous calls per person: sign-ups are open, and every call spends the operator's model budget
export const LIMITS = Object.freeze({ messages: 24, chars: 12000, total: 60000, perMinute: 12, perDay: 150, perMinuteAll: 120, inFlight: 2, maxTokens: 1200, replyChars: 20000 })
export const SYSTEM = 'You are VESPR, a helpful assistant in personal Chat. You have no access to the user\'s files, code, workspace or accounts, and you cannot run anything. Answer plainly and say when you are not sure.'

// The Token Factory's model ids are account-specific, so (like the agents) ask the account which Nemotron chat models it has and prefer Super, then Ultra, then Nano. Cached for an hour.
const ORDER = [/super/i, /ultra/i, /nano/i, /nemotron/i]
export async function discoverModelId ({ baseUrl, apiKey, fetchImpl }) {
  const r = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error('model list failed: HTTP ' + r.status)
  const ids = (((await r.json()) || {}).data || []).map(m => m && m.id).filter(id => typeof id === 'string' && /nemotron/i.test(id) && !/(^|[-_./])vl([-_.]|$)|vision|embed|rerank|guard|reward|parse|safety/i.test(id))
  for (const re of ORDER) { const hit = ids.find(id => re.test(id)); if (hit) return hit }
  throw new Error('no Nemotron chat model in this account')
}

// "Your VESPR AI" settings, made real: the tone is one of four fixed sentences and the person's own instructions are cleaned and capped. They are added after the fixed rules and can never replace them.
export const TONES = Object.freeze({
  concise_sde: 'Be concise and technical. Prefer short, direct answers.',
  senior_architect: 'Answer like a senior architect: weigh trade-offs and name risks.',
  exhaustive: 'Be thorough and academic: explain step by step with context.',
  pair_programmer: 'Work as a pair programmer: be collaborative, ask short clarifying questions and suggest next steps.'
})
export const INSTRUCTION_MAX = 600
export const cleanInstructions = v => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, INSTRUCTION_MAX) : ''
export function systemFor (style) {
  let s = SYSTEM; const st = style && typeof style === 'object' ? style : {}
  if (typeof st.tone === 'string' && Object.prototype.hasOwnProperty.call(TONES, st.tone)) s += ' ' + TONES[st.tone]
  const ins = cleanInstructions(st.instructions); if (ins) s += ' The user also asked you to keep this in mind (it never overrides the rules above): ' + ins
  return s
}

export function cleanMessages (input) {
  if (!Array.isArray(input) || !input.length || input.length > LIMITS.messages) return null
  const out = []; let total = 0
  for (const m of input) {
    if (!m || typeof m !== 'object' || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') return null
    const content = m.content.replace(/\u0000/g, '').slice(0, LIMITS.chars); if (!content.trim()) return null
    total += content.length; if (total > LIMITS.total) return null
    out.push({ role: m.role, content })
  }
  return out[out.length - 1].role === 'user' ? out : null // the last turn must be the person's
}

export function createPersonalChat ({ identify, env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const hits = new Map() // identity -> [timestamps of the last 24 h]
  const busy = new Map() // identity -> calls in flight
  let allHits = []
  const cap = (name, dflt) => { const n = Number(env[name]); return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt } // the operator can tune the caps with VESPR_PERSONAL_PER_MINUTE / _PER_DAY / _PER_MINUTE_ALL
  // Explicit VESPR_PERSONAL_MODEL_* wins. Otherwise the same Nebius Token Factory key the agents already use (NEBIUS_API_KEY, optional NEBIUS_MODEL / NEBIUS_BASE_URL), so a server that
  // already runs agents needs no new secret: the operator only has to pass that variable to the server process.
  const NEBIUS_URL = 'https://api.tokenfactory.nebius.com/v1'
  const model = () => env.VESPR_PERSONAL_MODEL_URL && env.VESPR_PERSONAL_MODEL_KEY && env.VESPR_PERSONAL_MODEL
    ? { url: env.VESPR_PERSONAL_MODEL_URL, key: env.VESPR_PERSONAL_MODEL_KEY, id: env.VESPR_PERSONAL_MODEL, nebius: false }
    : env.NEBIUS_API_KEY ? { url: env.NEBIUS_BASE_URL || NEBIUS_URL, key: env.NEBIUS_API_KEY, id: env.NEBIUS_MODEL || null, nebius: true } : null
  const configured = () => !!model()
  let found = null // { id, at } for the Nebius default
  const modelId = async m => { if (m.id) return m.id; const t = now(); if (found && t - found.at < 3600000) return found.id; const id = await discoverModelId({ baseUrl: m.url, apiKey: m.key, fetchImpl }); found = { id, at: t }; return id }
  // returns '' when allowed, else which cap was hit. Counts every attempt that reaches the model path.
  const limited = who => {
    const t = now(); const day = (hits.get(who) || []).filter(x => t - x < 86400000)
    allHits = allHits.filter(x => t - x < 60000)
    const minute = day.filter(x => t - x < 60000).length
    if (minute >= cap('VESPR_PERSONAL_PER_MINUTE', LIMITS.perMinute)) { hits.set(who, day); return 'minute' }
    if (day.length >= cap('VESPR_PERSONAL_PER_DAY', LIMITS.perDay)) { hits.set(who, day); return 'day' }
    if (allHits.length >= cap('VESPR_PERSONAL_PER_MINUTE_ALL', LIMITS.perMinuteAll)) return 'server'
    day.push(t); allHits.push(t); hits.set(who, day)
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(x => t - x < 86400000)) hits.delete(k) // forget people who have not asked for a day
    return ''
  }
  return {
    configured,
    http (req, res) {
      const url = new URL(req.url, 'http://x')
      if (url.pathname !== '/api/personal/chat') return false
      if (req.method === 'OPTIONS') return false // the shared CORS handler answers preflights
      if (req.method !== 'POST') { sendJson(res, 405, { error: 'method_not_allowed' }); return true }
      const who = identify(bearer(req))
      if (!who || isAgentName(who)) { sendJson(res, who ? 403 : 401, { error: who ? 'not_allowed' : 'sign_in' }); return true }
      ;(async () => {
        let counted = false // only a call that took an in-flight slot gives it back
        try {
          if (!configured()) return sendJson(res, 503, { error: 'no_model', message: 'No model is configured on this server yet.' })
          const why = limited(who)
          if (why) return sendJson(res, 429, { error: 'slow_down', message: why === 'day' ? 'You have reached today\'s limit for AI chat. Try again tomorrow.' : why === 'server' ? 'AI chat is busy right now. Try again in a minute.' : 'Too many messages this minute. Wait a moment.' })
          if ((busy.get(who) || 0) >= LIMITS.inFlight) return sendJson(res, 429, { error: 'slow_down', message: 'Wait for your earlier messages to be answered first.' })
          busy.set(who, (busy.get(who) || 0) + 1); counted = true
          const body = await readJson(req, 200000).catch(() => null)
          const messages = cleanMessages(body && body.messages)
          if (!messages) return sendJson(res, 400, { error: 'bad_messages' })
          const m = model(); m.id = await modelId(m)
          const r = await fetchImpl(m.url.replace(/\/$/, '') + '/chat/completions', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + m.key },
            body: JSON.stringify({ model: m.id, messages: [{ role: 'system', content: systemFor(body && body.style) }, ...messages], max_tokens: LIMITS.maxTokens, temperature: 0.4, stream: false, ...(m.nebius ? { chat_template_kwargs: { enable_thinking: false } } : {}) }), // Nemotron's hidden reasoning would eat the token budget and leave an empty answer
            signal: AbortSignal.timeout(60000)
          })
          if (!r.ok) return sendJson(res, 502, { error: 'model_failed', message: 'The model did not answer (HTTP ' + r.status + ').' }) // the provider's body is never passed on
          const j = await r.json()
          const reply = String(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim().slice(0, LIMITS.replyChars)
          if (!reply) return sendJson(res, 502, { error: 'model_failed', message: 'The model sent an empty answer.' })
          sendJson(res, 200, { reply, model: String(j.model || m.id).slice(0, 80) })
        } catch (e) { if (!res.headersSent) sendJson(res, 502, { error: 'model_failed', message: 'The model could not be reached.' }) }
        finally { if (counted) { const n = (busy.get(who) || 1) - 1; if (n > 0) busy.set(who, n); else busy.delete(who) } }
      })()
      return true
    }
  }
}
