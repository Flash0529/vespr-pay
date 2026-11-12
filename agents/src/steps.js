// What an agent is doing, in words people read without opening code: the live line for each tool call, whether it worked,
// and the task list it shows as a checklist. Pure functions; every one survives null, huge strings, __proto__ keys and NaN.
export const PLAN_STATES = ['pending', 'in_progress', 'done']
export const MAX_PLAN_ITEMS = 20
const own = (o, k) => (o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)
export const oneLine = (v, max = 160) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

// The line shown while a tool call runs. When it finishes, the tool's own note (past tense) replaces it.
export function stepSummary (name, args) {
  const a = (k, d = '') => oneLine(own(args, k) ?? d, 120)
  switch (name) {
    case 'read_file': return `Reading ${a('path')}`
    case 'replace_in_file': return `Editing ${a('path')}`
    case 'write_file': return `Writing ${a('path')}`
    case 'delete_file': return `Deleting ${a('path')}`
    case 'request_access': return `Asking for ${(Array.isArray(args && args.rights) ? args.rights : []).join(', ')} on ${a('path') || 'the workspace'}`
    case 'request_payment': return `Asking for a payment of ${own(args, 'currency') && own(args, 'currency') !== 'USD' ? a('currency') + ' ' : '$'}${a('amount')} for ${a('label')}`
    case 'list_files': return 'Listing the files'
    case 'run_command': return `$ ${a('command')}`
    case 'code_map': return `Asking the code map: ${a('query', 'overview') || 'overview'}`
    case 'find_tasks': return 'Looking for TODO and FIXME tasks'
    case 'claim_task': return `Claiming ${a('path')}`
    case 'detect_project': return 'Looking at how the project runs'
    case 'start_project': return `Starting ${a('name', 'web') || 'web'}`
    case 'process_logs': return `Reading the logs of ${a('name', 'web') || 'web'}`
    case 'stop_process': return `Stopping ${a('name', 'web') || 'web'}`
    case 'read_attachment': return `Reading the attachment ${a('name')}`
    case 'attach_file': return `Sharing ${a('path')}`
    case 'find_skill': return own(args, 'install') ? `Installing the skill ${a('install')}` : own(args, 'load') ? `Loading the skill ${a('load')}` : `Looking for a skill: ${a('query')}`
    case 'web_search': return `Searching the web: ${a('query')}`
    default: return `Using ${oneLine(name, 60) || 'a tool'}`
  }
}

// Did the call work? Tool results are JSON with error / exit / ok / claimed fields, or plain text (a file's content).
export function stepOk (result) {
  const text = typeof own(result, 'text') === 'string' ? result.text : ''
  if (!text.startsWith('{')) return true
  let r; try { r = JSON.parse(text) } catch { return true }
  if (!r || typeof r !== 'object') return true
  if (own(r, 'error')) return false
  if (typeof own(r, 'exit') === 'number' && r.exit !== 0) return false
  return own(r, 'ok') !== false && own(r, 'claimed') !== false
}

// The error text a failed call returned, for the line's detail (never the whole result).
export function stepError (result) {
  try { const r = JSON.parse(own(result, 'text')); return oneLine(own(r, 'error'), 300) } catch { return '' }
}

// update_plan input -> a clean list: at most 20 items, text on one line, a known status.
export function cleanPlan (items) {
  if (!Array.isArray(items)) return []
  const out = []
  for (const it of items.slice(0, MAX_PLAN_ITEMS)) {
    const text = oneLine(typeof it === 'string' ? it : own(it, 'text') ?? own(it, 'content'), 160)
    if (!text) continue
    const status = PLAN_STATES.includes(own(it, 'status')) ? it.status : 'pending'
    out.push({ text, status })
  }
  return out
}
