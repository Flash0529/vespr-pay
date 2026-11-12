// Model access. One interface, two providers:
//   complete({ messages, tools }) -> async generator yielding { text } deltas, then one { toolCalls, done: true }
// OpenAICompat talks to any OpenAI-compatible chat endpoint (Nebius Token Factory, hosting NVIDIA Nemotron).
// Mock is a scripted stand-in so the whole product can be demoed and tested before a key exists. It says so in chat.

const NEMOTRON_ORDER = [/super/i, /ultra/i, /nano/i, /nemotron/i]

export async function discoverModel ({ baseUrl, apiKey, prefer = NEMOTRON_ORDER }) {
  const r = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!r.ok) throw new Error(`model list failed: HTTP ${r.status}`)
  const ids = ((await r.json()).data || []).map(m => m.id).filter(id => /nemotron/i.test(id) && !/(^|[-_./])vl([-_.]|$)|vision|embed|rerank|guard|reward|parse|safety/i.test(id)) // chat and coding models only: not vision-language, embedding or safety models
  for (const re of [...prefer, ...NEMOTRON_ORDER]) { const hit = ids.find(id => re.test(id)); if (hit) return hit }
  throw new Error('no Nemotron model in this account; set NEBIUS_MODEL')
}

export class OpenAICompat {
  constructor ({ baseUrl, apiKey, model, planModel }) { Object.assign(this, { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, model, planModel: planModel || model }); this.label = model; this.lastUsage = null }
  modelFor (role) { return role === 'plan' ? this.planModel : this.model }

  // One short, non-streaming answer (inline suggestions, digests). Returns the text.
  async once ({ messages, maxTokens = 120, stop, signal, model }) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: model || this.model, messages, max_tokens: maxTokens, temperature: 0, stop, chat_template_kwargs: { enable_thinking: false } }) // short answers (suggestions, digests) must not spend their few tokens on hidden reasoning: measured 2026-10-28, thinking on gave an EMPTY answer after 120 reasoning tokens
    })
    if (!res.ok) throw new Error(`model call failed: HTTP ${res.status}`)
    const j = await res.json()
    this.lastUsage = j.usage ? { prompt: j.usage.prompt_tokens || 0, completion: j.usage.completion_tokens || 0, ...((j.usage.prompt_tokens_details && j.usage.prompt_tokens_details.cached_tokens) ? { cached: j.usage.prompt_tokens_details.cached_tokens } : {}) } : null
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ''
  }

  async * complete ({ messages, tools, role }) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.modelFor(role), messages, tools: tools && tools.length ? tools : undefined, stream: true, stream_options: { include_usage: true }, temperature: 0.2 })
    })
    if (!res.ok) throw new Error(`model call failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
    const calls = new Map(); let buf = ''; let usage = null
    const dec = new TextDecoder()
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true })
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') continue
        let j; try { j = JSON.parse(data) } catch { continue }
        if (j.usage) usage = { prompt: j.usage.prompt_tokens || 0, completion: j.usage.completion_tokens || 0, ...((j.usage.prompt_tokens_details && j.usage.prompt_tokens_details.cached_tokens) ? { cached: j.usage.prompt_tokens_details.cached_tokens } : {}) }
        const d = j.choices && j.choices[0] && j.choices[0].delta
        if (!d) continue
        if (d.content) yield { text: d.content }
        for (const tc of d.tool_calls || []) {
          const c = calls.get(tc.index) || { id: '', name: '', args: '' }
          if (tc.id) c.id = tc.id
          if (tc.function && tc.function.name) c.name += tc.function.name
          if (tc.function && tc.function.arguments) c.args += tc.function.arguments
          calls.set(tc.index, c)
        }
      }
    }
    this.lastUsage = usage
    yield { done: true, toolCalls: [...calls.values()].map(c => ({ id: c.id || `call_${Math.random().toString(36).slice(2, 8)}`, name: c.name, args: safeJson(c.args) })) }
  }
}

const safeJson = s => { try { return JSON.parse(s || '{}') } catch { return {} } }
const sleep = ms => new Promise(r => setTimeout(r, ms))

export class Mock {
  constructor () { this.label = 'demo-mode (scripted, no model key)'; this.lastUsage = null }
  modelFor () { return this.label }

  // Scripted stand-ins for the one-shot calls, so suggestions and digests can be shown before a key exists.
  async once ({ kind, prefix = '', suffix = '', facts = [] }) {
    if (kind === 'digest') return facts.length ? facts.map(f => `- ${f}`).join('\n') : '- Nothing happened while you were away.'
    const line = prefix.split('\n').pop()
    const def = /^(\s*)def (\w+)\(.*\):\s*$/.exec(line)
    if (def && !suffix.trimStart().startsWith('"""')) return `\n${def[1]}    """${def[2].replace(/_/g, ' ')}."""`
    if (/print\($/.test(line)) return '"hello")'
    if (/for \w+ in range\($/.test(line)) return 'n):'
    if (!line.trim() && facts.length) return `# ${facts[0]}`
    return ''
  }

  async * complete ({ messages }) {
    const last = messages[messages.length - 1]
    const say = async function * (t) { for (const w of t.split(/(\s+)/)) { yield { text: w }; await sleep(25) } }
    const call = (name, args) => ({ id: `c-${name}`, name, args })
    const userAsk = [...messages].reverse().find(m => m.role === 'user')?.content || ''
    const delegateAsk = /\bdelegate\b(?:\s+(?:this\s+|it\s+)?to\s+@?([\w-]+))?\s*:\s*([^\n]+)/i.exec(userAsk)
    const wantsFix = !delegateAsk && /\bfix\b.*\b(bug|discount|test)/i.test(userAsk)
    // the fix is the scripted multi-step job, so it keeps a checklist like a real model is told to (update_plan)
    const plan = (...st) => call('update_plan', { items: ['Read the code', 'Fix the discount line', 'Run the tests'].map((text, i) => ({ text, status: st[i] })) })
    if (last.role === 'tool') {
      if (last.name === 'delegate_task') { const r = safeJson(last.content) || {}; yield * say(r.error ? `I could not hand that down: ${r.error}. (Demo mode: scripted reply.)` : `Handed to @${r.to || 'my team'} as task ${r.id}; the result comes back to me for review and then to you. (Demo mode: scripted reply.)`); return yield { done: true, toolCalls: [] } }
      if (last.name === 'update_plan') return yield { done: true, toolCalls: [] } // the closing checklist update ends the turn
      if (last.name === 'request_payment') { // the scripted agent's one payment: it reports exactly what the server said, never more
        const r = safeJson(last.content) || {}
        const line = r.error ? `The server did not take that: ${r.error}`
          : r.status === 'captured' ? `Paid: ${r.amount} for ${r.label}, approved by ${r.approvedBy}. PayPal captured it (sandbox, test money; order ${r.orderId}).`
          : r.status === 'denied' ? `${r.by} said no, so nothing was charged and I will not ask again for ${r.label}.`
          : r.pending ? `The request for ${r.amount} (${r.label}) is still ${r.status === 'awaiting_buyer' ? 'waiting for the buyer to pay on PayPal' : 'waiting for a person to approve it'}. It is not paid yet.`
          : `The payment for ${r.label} did not go through (${r.status}); nothing was charged.`
        yield * say(`${line} (Demo mode: scripted reply.)`)
        return yield { done: true, toolCalls: [] }
      }
      const prior = messages.findLast(m => m.role === 'assistant' && m.tool_calls)
      const tc = prior?.tool_calls?.find(t => t.id === last.tool_call_id) || prior?.tool_calls?.[0]
      const args = safeJson(tc?.function?.arguments)
      if (last.name === 'code_map') {
        const r = safeJson(last.content)
        if (r.error) yield * say(`The map has no answer for that: ${r.error}. (Demo mode: scripted reply.)`)
        else if (r.summary) yield * say(`Here is the map of this workspace. ${r.summary} (Demo mode: scripted reply.)`)
        else if (r.transitivelyAffected) yield * say(`${r.file} is imported directly by ${r.directlyImportedBy.join(', ') || 'nothing'}; ${r.note} (Demo mode: scripted reply.)`)
        else if (r.definedIn) yield * say(`${r.symbol} is defined in ${r.definedIn.map(d => d.file + ':' + d.line).join(', ')} and used by ${r.usedBy.join(', ') || 'nothing else'}. (Demo mode: scripted reply.)`)
        else yield * say(`${r.path}: ${r.lines} lines; defines ${r.symbols.join('; ') || 'nothing'}; imported by ${r.importedBy.join(', ') || 'nothing'}; written by ${r.writtenBy.join(', ') || 'nobody recorded'}. (Demo mode: scripted reply.)`)
        return yield { done: true, toolCalls: [] }
      }
      if (last.name === 'start_project') {
        const r = safeJson(last.content)
        yield * say(r.previewUrl ? `Started it. Open ${r.previewUrl} to see it running. (Demo mode: scripted reply.)` : `It did not come up${r.error ? ': ' + r.error : ''}. Last output: ${(r.logs || '').split('\n').slice(-3).join(' | ')} (Demo mode: scripted reply.)`)
        return yield { done: true, toolCalls: [] }
      }
      if (last.name === 'run_command') {
        const r = safeJson(last.content)
        const tail = (r.output || '').trim().split('\n').filter(Boolean).slice(-1)[0] || ''
        yield * say(r.error ? `I could not run it: ${r.error}` : `Ran it, exit code ${r.exit}${tail ? ': ' + tail : ''}. (Demo mode: scripted reply.)`)
        return yield { done: true, toolCalls: wantsFix && !r.error && r.exit === 0 ? [plan('done', 'done', 'done')] : [] }
      }
      if (last.name === 'replace_in_file' && wantsFix && !safeJson(last.content).error) {
        yield * say('Fixed. Running the tests again. ')
        return yield { done: true, toolCalls: [plan('done', 'done', 'in_progress'), call('run_command', { command: 'python3 -m unittest -q' })] }
      }
      if (last.name === 'delete_file') {
        yield * say(last.content.startsWith('{"error"') ? 'Could not delete that file.' : 'Done. The file has been deleted from the workspace.')
        return yield { done: true, toolCalls: [] }
      }
      if (last.name === 'read_file') {
        const bug = last.content.match(/^(\s*)return amount \* percent \/ 100$/m)
        if (wantsFix && bug) {
          yield * say('The discount is computed as amount * percent / 100, which is the discount itself, not the price after it. Fixing that line. ')
          return yield { done: true, toolCalls: [plan('done', 'in_progress', 'pending'), call('replace_in_file', { path: args.path, old: bug[0], new: `${bug[1]}return amount * (1 - percent / 100)` })] }
        }
        const def = last.content.match(/^def (\w+)\(.*\):$/m)
        if (def && !wantsFix) {
          yield * say(`Found ${def[1]}; adding the docstring now. `)
          return yield { done: true, toolCalls: [call('replace_in_file', { path: args.path, old: def[0] + '\n', new: `${def[0]}\n    """${def[1]}: added live by the demo-mode agent."""\n` })] }
        }
      }
      yield * say(last.content.startsWith('{"error"') ? 'That edit did not apply; with a real model I would retry with a more exact snippet.' : 'Done. The change is in the shared file and my cursor shows where. (Demo mode: scripted reply, no model key is configured yet.)')
      return yield { done: true, toolCalls: [] }
    }
    const userText = [...messages].reverse().find(m => m.role === 'user')?.content || ''
    const file = (userText.match(/[\w./-]+\.(?:py|js|ts|md|json)/) || [])[0]
    // "pay $25 for the logo invoice": the scripted agent asks for a payment through the real request_payment tool (a real model decides this itself)
    const payAsk = /\b(pay|settle|buy|purchase)\b/i.test(userText) ? /\$\s?(\d+(?:\.\d{1,2})?)\s*(?:for|on)?\s*(?:the\s+)?([^.\n$]*)/i.exec(userText) : null
    if (payAsk) {
      const what = payAsk[2].replace(/\b(please|thanks?)\b.*$/i, '').trim().replace(/\s+/g, ' ').slice(0, 60)
      yield * say(`Asking the room to approve ${payAsk[1].includes('.') ? '$' + payAsk[1] : '$' + payAsk[1] + '.00'}. `)
      return yield { done: true, toolCalls: [call('request_payment', { amount: payAsk[1], currency: 'USD', label: what ? what[0].toUpperCase() + what.slice(1) : 'Payment', reason: 'Asked for in the chat; the scripted demo agent passes the amount you typed.' })] }
    }
    if (delegateAsk) { yield * say('Handing this down. '); return yield { done: true, toolCalls: [call('delegate_task', { ...(delegateAsk[1] ? { to: delegateAsk[1] } : {}), title: delegateAsk[2].trim() })] } }
    if (wantsFix) {
      const f = (userText.match(/[\w./-]+\.py/) || ['cart.py'])[0]
      yield * say(`Opening ${f}. `)
      return yield { done: true, toolCalls: [plan('in_progress', 'pending', 'pending'), call('read_file', { path: f })] }
    }
    const impact = userText.match(/\b(?:depends? on|impact of|affects?|break if I (?:change|edit))\s+`?([\w./-]+\.\w+)`?/i)
    if (impact) { yield * say('Checking the map. '); return yield { done: true, toolCalls: [call('code_map', { query: 'impact:' + impact[1] })] } }
    if (/\b(map|overview|architecture|structure)\b|\bexplain (the |this )?(repo|project|code)/i.test(userText)) { yield * say('Opening the map. '); return yield { done: true, toolCalls: [call('code_map', { query: 'overview' })] } }
    if (/\b(start|launch|serve|preview)\b.*\b(project|website|site|app|server)\b|\brun\s+(the\s+)?(project|website|site|app|server)\b/i.test(userText)) {
      yield * say('Starting the project. ')
      return yield { done: true, toolCalls: [call('start_project', {})] }
    }
    const del = userText.match(/\b(?:delete|remove)\s+(?:file\s+)?([^`\s]+)/i)
    if (del && del[1]) {
      yield * say(`Deleting ${del[1]}. `)
      return yield { done: true, toolCalls: [call('delete_file', { path: del[1] })] }
    }
    const run = userText.match(/\brun\s+`?([^`\n]+?)`?\s*$/i)
    if (run) {
      yield * say('Running that now. ')
      return yield { done: true, toolCalls: [call('run_command', { command: run[1] })] }
    }
    if (/docstring|document/i.test(userText) && file) {
      yield * say(`Opening ${file}. `)
      return yield { done: true, toolCalls: [call('read_file', { path: file })] }
    }
    yield * say('I am the demo-mode agent: no model key is configured yet, so I follow a script. Ask me to "add a docstring to <file>" and watch me edit live.')
    yield { done: true, toolCalls: [] }
  }
}

// Optional web search for the Tavily prize: only offered to the model when a key is set.
export async function tavilySearch (apiKey, query) {
  const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ query, max_results: 4, include_answer: true }) })
  if (!r.ok) return { error: `search failed: HTTP ${r.status}` }
  const j = await r.json()
  return { answer: j.answer, results: (j.results || []).map(x => ({ title: x.title, url: x.url, snippet: (x.content || '').slice(0, 300) })) }
}

// A rejected Tavily key (HTTP 401/403) must not leave a broken web_search tool in front of the model. Network trouble does not count as rejected.
export async function tavilyWorks (apiKey) {
  try {
    const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ query: 'test', max_results: 1 }), signal: AbortSignal.timeout(8000) })
    return r.status !== 401 && r.status !== 403
  } catch { return true }
}
