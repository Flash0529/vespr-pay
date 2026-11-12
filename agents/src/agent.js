// The agent loop: read the shared chat, think with the model, act on the shared files with tools, and talk back in the
// same shared chat (streamed live). Every file edit moves the agent's visible cursor and is logged to provenance.
import { tavilySearch } from './llm.js'
import { decide } from './policy.js'
import { detectProject } from './project.js'
import { buildMap, queryMap } from './codemap.js'
import { budgetMessage } from './budget.js'
import { findTasks, claimTask } from './tasks.js'
import { contextBlock } from './context.js'
import { canRead, highWater, restrictedNote } from './labels.js'
import { DELEGATE_TOOL, delegateTask, hasReports, briefText } from './delegate.js'
import { SKILL_RULES, SkillLibrary, skillFile, skillsFromFiles, resolveSkill } from './skills.js'
import { stepSummary, stepOk, stepError } from './steps.js'
import { LIMIT } from './ledger.js'

const MAX_STEPS = 8

const TOOLS = [
  { name: 'find_tasks', description: 'Find TODO/FIXME comments in shared workspace files. Read-only; findings include stable ids, path and line. Optional path prefix and result limit.', parameters: { type: 'object', properties: { path: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'claim_task', description: 'Revalidate and claim the owning file for a finding from find_tasks. Claim is file-level and lasts for this response. Plan mode cannot claim.', parameters: { type: 'object', properties: { id: { type: 'string' }, path: { type: 'string' } }, required: ['id', 'path'] } },
  { name: 'list_files', description: 'List every file in the shared workspace.', parameters: { type: 'object', properties: {} } },
  { name: 'read_file', description: 'Read a whole file.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'replace_in_file', description: 'Replace one exact snippet that appears exactly once in a file. Copy the old text exactly. Prefer small edits: other people are typing in the same file.', parameters: { type: 'object', properties: { path: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, required: ['path', 'old', 'new'] } },
  { name: 'run_command', description: 'Run a shell command (tests, scripts, linters) in the workspace sandbox. Text files the command creates or changes are shared back into the workspace; deleting or renaming files inside a command is not (use delete_file), and images, audio, video and other binary files, or files over 200 KB, are not either. No interactive programs.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  { name: 'write_file', description: 'Create a new file, or replace a whole file.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'request_access', description: 'Ask the people in this workspace for a right you lack: make (create files), view, edit or delete, on a file or a folder (a folder ends with /). A person who manages that place answers in chat; this waits for the answer. Use it only after a file tool says you lack a right, ask for the smallest place and the fewest rights the task needs, and give a one-sentence reason a person can check.', parameters: { type: 'object', properties: { path: { type: 'string' }, rights: { type: 'array', items: { type: 'string', enum: ['make', 'view', 'edit', 'delete'] } }, reason: { type: 'string' } }, required: ['path', 'rights', 'reason'] } },
  { name: 'delete_file', description: 'Delete a file or folder from the workspace. In most modes, this asks for approval before deleting.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'relative path of the file or folder to delete' }, recursive: { type: 'boolean', description: 'set to true when deleting a directory or multiple files' } }, required: ['path'] } }
]
const MAP_TOOL = { name: 'code_map', description: 'Ask the live Code Map of the workspace (files, symbols, who imports whom, who wrote what). query: "overview" (default), "file:<path>" (symbols, imports, importers, authors), "impact:<path>" (everything that depends on a file: use it before changing a shared file), "symbol:<name>" (where it is defined and used). Read-only and cheap; use it before exploring file by file.', parameters: { type: 'object', properties: { query: { type: 'string' } } } }
const RUN_IT_TOOLS = [
  { name: 'detect_project', description: 'Look at the workspace and work out its stack and how to install, start and test it. Read-only; use it first when unsure how to run the project.', parameters: { type: 'object', properties: {} } },
  { name: 'start_project', description: 'Install and start the project (a dev server or any long-running program) in the background in the shared sandbox and wait until it answers. Returns a preview link everyone can open. Omit command to use the detected one. Needs approval in most modes. It runs in the sandbox, not on a teammate\'s computer.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'short name, default web' }, command: { type: 'string', description: 'override the detected command; may use $PORT' } } } },
  { name: 'process_logs', description: 'Show the latest output of a process started with start_project (use it when the page does not load or the process crashed).', parameters: { type: 'object', properties: { name: { type: 'string' }, lines: { type: 'number' } } } },
  { name: 'stop_process', description: 'Stop a process started with start_project.', parameters: { type: 'object', properties: { name: { type: 'string' } } } }
]
const READ_ATTACHMENT_TOOL = { name: 'read_attachment', description: 'Read a file a person attached to the chat (Word, PowerPoint, Excel, CSV, PDF, pictures, 3D models, audio, video, text). name: the file name or id shown as "attached:" in the chat. Returns a summary, the text (cut when long), data such as sheet rows or 3D size, and notes saying what could NOT be read. Never claim to have seen, heard or watched something the notes say was not read. If the type cannot be read, call find_skill before saying you cannot.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }
const ATTACH_FILE_TOOL = { name: 'attach_file', description: 'Share a file a command made (a PNG chart, a PDF report, a zip) with the room, so everyone can see or download it. path: where the command wrote it, relative to the workspace folder. Call it right after the command that made the file (the folder is rebuilt before every command). Up to 10 MB; not for files that hold secrets. Returns the name to use: then write {{image:name}} for a picture or {{card:name}} for anything else in your reply. Works only in the agent sandbox, not on a teammate\'s computer.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }
const FIND_SKILL_TOOL = { name: 'find_skill', description: 'Find, load or install a skill (an instruction file for a kind of task). query: what the user wants, e.g. "read a pptx deck": returns matching skills from the workspace, the library and the connected GitHub sources. load: a skill name from the list in your instructions or from a search: returns its instructions. install: the name of a skill found on GitHub: asks the people in the workspace to approve it, then saves it in the workspace. Call it before telling the user you cannot do something.', parameters: { type: 'object', properties: { query: { type: 'string' }, load: { type: 'string' }, install: { type: 'string' } } } }
const PAY_TOOL = { name: 'request_payment', description: 'Ask the people in this workspace to approve a payment through PayPal. It is a SANDBOX: test money, no real money moves. You can only REQUEST: a person approves or denies it on a card in the chat, only then does the server create a PayPal order, and it is captured only after the buyer pays on PayPal\'s sandbox page. This waits for the outcome. Use it only when the work really needs something paid for, with the exact amount and what it buys. When someone asks you to buy, order, purchase, pay for or settle something, that IS such a request: never answer that you cannot make purchases. Call this tool, then say in one sentence that you asked and that nothing is paid until a person approves. If no amount was given, ask for the amount first. The server refuses over USD 50 for one request, over USD 100 for this room in 24 hours, and any currency but USD: if it refuses, tell the person, do not split the amount to get around it. Say a payment is done ONLY when the result says status "captured"; for denied, expired, cancelled, failed, refused or pending say exactly that.', parameters: { type: 'object', properties: { amount: { type: 'string', description: 'dollars as a decimal string, like "25.00"' }, currency: { type: 'string', enum: ['USD'] }, label: { type: 'string', description: 'what is being bought, short, like "Logo design invoice #42"' }, reason: { type: 'string', description: 'one or two plain sentences a person can check: why this is needed and what it gets. The server adds the room\'s spend today and the limits itself: do not invent risk scores or numbers' } }, required: ['amount', 'label', 'reason'] } }
const SEARCH_TOOL = { name: 'web_search', description: 'Search the web for current information (documentation, errors, APIs).', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }
const PLAN_TOOL = { name: 'update_plan', description: 'Show your task list to everyone in the workspace as a checklist with your reply, so people can follow the work without reading code. Call it first for any job with three or more steps, and again each time a step starts or finishes. items: the whole list in order, short plain steps; status is pending, in_progress (one at a time) or done.', parameters: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } }, required: ['text', 'status'] } } }, required: ['items'] } }

const systemPrompt = (room, files) => `You are "${room.name}", an AI teammate in a shared code workspace called VESPR. People and other agents edit the same files at the same time and everyone sees this chat, so be brief and concrete.
Work with the tools: read a file before editing it, make small targeted edits, and never rewrite a whole file unless asked. Your edits appear live in everyone's editor with your name on your cursor.
Say in one or two sentences what you did. For a job with three or more steps, call update_plan first with the steps and keep it current as you go: people follow your checklist and the live list of your actions instead of reading code. You can run commands with run_command. To understand the code before changing it use code_map (overview, file:<path>, impact:<path> before editing a shared file, symbol:<name>). To start or preview the project (a website, API or anything that keeps running) use start_project (detect_project first when unsure, process_logs when it fails, stop_process when done) and give people the preview link. Some actions need a person's approval depending on the workspace mode (currently ${room.mode()}): if one is denied, accept that and say so; in plan mode do not change anything, write the plan in chat instead. Files now: ${files.length ? files.join(', ') : '(none)'}.${room.requestPayment ? ' To pay for something use request_payment with the exact amount and what it buys: you can only ask, a person approves it in the chat, and it is a PayPal sandbox (test money). Say it is paid only when the result says captured; if it was denied, refused or did not finish, say so and do not ask again for the same thing.' : ''}`

export { history }
export const BRIEF_RULE = '\nWhen you hand work down, brief it in delegate_task: why (the decisions and limits that matter, which they may not have seen), files (the paths to start from), done (how they will know it is finished). They also get the person\'s original request.'
// An agent with a team coordinates: it reads, plans and delegates, and the tools that change things belong to its team.
// (A real model with a team still did a small job itself when only told to delegate: 2026-11-04 live check.)
export const DOING_TOOLS = new Set(['write_file', 'replace_in_file', 'delete_file', 'run_command', 'start_project', 'stop_process', 'claim_task', 'attach_file', 'find_skill', 'use_credential'])
export const guardTool = (name, coordinator) => coordinator && DOING_TOOLS.has(name)
  ? { text: JSON.stringify({ error: 'you coordinate a team and do not change files or run commands yourself: hand this to one of them with delegate_task' }), note: `${name} not run: coordinators delegate` }
  : null
export function asOpenAITools (extra, runIt = true, skills = false, attach = false, delegate = false, coordinator = false, pay = false) {
  return [...TOOLS, MAP_TOOL, PLAN_TOOL, ...(pay ? [PAY_TOOL] : []), ...(delegate ? [DELEGATE_TOOL] : []), ...(runIt ? RUN_IT_TOOLS : []), ...(skills ? [FIND_SKILL_TOOL] : []), ...(attach ? [READ_ATTACHMENT_TOOL, ATTACH_FILE_TOOL] : []), ...(extra ? [SEARCH_TOOL] : [])].filter(t => !coordinator || !DOING_TOOLS.has(t.name)).map(t => ({ type: 'function', function: t }))
}

// reader (labels.js, from room.readerFor): what the agent may read for the person it works for. Undefined = no filtering (no labels configured).
// seen: collects the labels of everything let through, so the reply can carry the highest one (highWater).
function history (room, reader, seen) {
  const out = []
  for (const m of room.chat.toArray().slice(-20)) {
    const role = m.get('role'); const text = m.get('text') ? m.get('text').toString() : ''
    if (role === 'tool' || role === 'limit' || !text) continue // a usage-limit card is for the person, not the model
    const label = m.get('label')
    if (reader !== undefined && !canRead(label, reader)) { out.push({ role: 'user', content: restrictedNote(label) }); continue }
    if (label && seen) seen.push(label)
    const mine = m.get('author') === room.name
    const ctx = mine ? '' : contextBlock(m, { reader, seen })
    const att = (m.get('attachments') || []).filter(a => a && a.name).map(a => `${a.name}${a.size ? ' ' + (a.size > 1048576 ? (a.size / 1048576).toFixed(1) + ' MB' : Math.ceil(a.size / 1024) + ' KB') : ''}${a.id ? ' id=' + a.id : ''}`)
    out.push({ role: mine ? 'assistant' : 'user', content: mine ? text : `${m.get('author')}${m.get('isAgent') ? ' (agent)' : ''}: ${text}${att.length ? `\n[attached: ${att.join('; ')}]` : ''}${ctx ? '\n' + ctx : ''}` })
  }
  return out
}

// Ask the permission policy; when it says ask, put an Approve / Deny card in front of the whole workspace.
async function gate (room, runner, kind, summary, detail, command, force) {
  const verdict = force ? 'ask' : decide(room.mode(), { kind, command }, { remoteRunner: runner.remote })
  if (verdict === 'allow') return null
  if (verdict === 'deny') return { error: room.mode() === 'plan' ? 'plan mode: nothing may be changed or run. Describe the plan in chat and wait for approval.' : 'refused: this command is not allowed in this workspace' }
  const r = await room.requestApproval({ kind, summary, detail })
  return r.approved ? null : { error: `denied by ${r.by}. Do not retry the same action; ask what they would prefer.` }
}

// the files with who wrote each stretch of them (the shared document already keeps that), for the Code Map
function workspaceFiles (room) {
  return room.list().map(path => {
    const t = room.files.get(path); const text = t.toString(); const spans = []; let pos = 0
    for (const op of t.toDelta()) { const len = typeof op.insert === 'string' ? op.insert.length : 0; if (op.attributes && op.attributes.by) spans.push({ start: pos, end: pos + len, by: op.attributes.by, ai: !!op.attributes.ai }); pos += len }
    return { path, text, spans }
  })
}

// Where files go in an answer: right after the sentence that introduces them, so the app can draw a file box in that spot (R40).
export const FILE_RULES = 'When you mention a file you created, changed or read for the user, or one they attached, write {{file:path-or-name}} on its own line directly after the sentence that introduces it, so the app shows a file box in that spot. At most one per sentence; never collect them at the end; never for a file you did not touch or mention. For a file someone should open or download write {{card:path}} the same way (a file box with Open and Download). To show a picture from this workspace write {{image:path}} (a small tile; a click opens it large) or {{image:path|big}} (large, inline). Use only paths that exist here or were attached, never invented ones. When there is nothing to show write no marker at all: never {{none}}, {{file:none}} or an empty {{file:}}. A message about a payment never carries a file marker. Only files in the workspace can show: an SVG you write with write_file is a picture (a chart, a box diagram); a file a command makes (a PNG chart, a PDF) is not in the room until you call attach_file with its path right after the command; then write {{image:name}} or {{card:name}} with the name it returns.'

// Skills ready for the model: the names and descriptions only (the body is loaded with find_skill when one matches).
function workspaceSkills (room) { return skillsFromFiles(room.list().map(p => ({ path: p, text: room.read(p) }))).lib }
function skillsPrompt (room, skills) {
  if (!skills) return ''
  const idx = [workspaceSkills(room).index(), skills.library ? skills.library.index() : ''].filter(Boolean).join('\n')
  return `\n\n${SKILL_RULES}\n\nSkills ready to use:\n${idx || '(none installed yet)'}`
}
async function findSkill (room, a, msgId, skills) {
  const err = (e, note) => ({ text: JSON.stringify({ error: e }), note })
  if (!skills) return err('skills are not available here')
  const ws = workspaceSkills(room)
  if (a.load) {
    const name = String(a.load).toLowerCase(); const text = ws.load(name) || (skills.library && skills.library.load(name))
    return text ? { text, note: `loaded the skill ${name}` } : err(`no installed skill called ${name}. Search first; a skill from GitHub must be installed (approved) before you can use it.`, `could not load the skill ${name}`)
  }
  if (a.install) {
    const name = String(a.install).toLowerCase(); const sk = skills.github && skills.github.get ? skills.github.get(name) : null
    if (!sk) return err(`no skill called ${name} in the last search. Search with query first.`, `could not install ${name}: not found`)
    if (room.mode() === 'plan') return err('plan mode: nothing may be changed. Say what the skill would add and wait for approval.', `skill ${name} not installed (plan mode)`)
    // always asked, in every mode (also Auto and Bypass): text from the internet changes what the agents do
    const r = await room.requestApproval({ kind: 'skill', summary: `Install the skill "${sk.name}" from ${sk.source}? Agents in this workspace will follow its instructions.`, detail: `${sk.description}\n\n${sk.body.slice(0, 700)}${sk.body.length > 700 ? '\n…' : ''}\n\nsha256 ${sk.sha256.slice(0, 12)}` })
    if (!r.approved) return err(`denied by ${r.by}. Do not install it; tell the user what you could not do and why.`, `skill ${name} not installed (${r.by})`)
    const f = skillFile(sk); const w = room.write(f.path, f.content, msgId)
    if (!w.ok) return err(w.error || 'could not save the skill')
    const one = new SkillLibrary(); one.add(sk)
    return { text: one.load(sk.name), note: `installed the skill ${name} from ${sk.source}` }
  }
  const res = await resolveSkill(a.query || '', { installed: ws, library: skills.library, searchGithub: skills.github })
  const names = res.candidates.map(c => c.name).join(', ')
  return { text: JSON.stringify({ found: res.found, where: res.where, needsApproval: res.needsApproval, candidates: res.candidates.slice(0, 5), tried: res.steps, githubErrors: skills.github && skills.github.errors ? skills.github.errors() : undefined, next: res.found ? (res.needsApproval ? 'ask to install it with find_skill {install: name}' : 'load it with find_skill {load: name}') : 'nothing matched: tell the user plainly what you tried, then answer as well as you can without it' }), note: `looked for a skill: "${String(a.query || '').slice(0, 60)}" → ${res.found ? res.where + ': ' + names : 'nothing found'}` }
}

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', json: 'application/json', zip: 'application/zip' }
const SECRETISH = /(^|\/)(\.[^/]*|[^/]*\.(pem|key|p12|pfx|keystore)|id_(rsa|dsa|ecdsa|ed25519)[^/]*|[^/]*(secret|token|password|passwd|credential|apikey|api_key)[^/]*)$/i
// attach_file: a file a command made in the sandbox folder goes to the room's upload store; the model then writes {{image:name}} or {{card:name}}.
async function attachFile (a, runner, room, attachments) {
  const fail = error => ({ text: JSON.stringify({ ok: false, error }), note: 'could not attach a file: ' + error })
  if (!attachments) return fail('sharing files is not available here')
  const rel = String(a.path || '').trim()
  if (!rel) return fail('path is required')
  if (!runner || typeof runner.readFile !== 'function') return fail('files can be shared only from the agent sandbox, not from a teammate\'s computer or a server')
  if (SECRETISH.test(rel)) return fail('that file looks like it holds a secret, so it is not shared')
  let f; try { f = runner.readFile(room, rel) } catch (e) { return fail(e.message) }
  const ext = (f.name.split('.').pop() || '').toLowerCase(); const type = MIME[ext] || 'application/octet-stream'
  let meta; try { meta = await attachments.put(f.name, f.buf, type) } catch (e) { return fail('could not upload it: ' + e.message) }
  const marker = /^image\//.test(type) ? `{{image:${meta.name}}}` : `{{card:${meta.name}}}`
  return { text: JSON.stringify({ ok: true, name: meta.name, id: meta.id, size: meta.size, writeThisInYourReply: marker }), note: `shared ${meta.name} (${Math.max(1, Math.round(meta.size / 1024))} KB) with the room` }
}

async function runTool (room, call, msgId, tavilyKey, runner, { processes, publicUrl = '', skills, attachments, tree, requester = '', parentTask = '', coordinator = false } = {}) {
  const a = call.args || {}
  const refused = guardTool(call.name, coordinator); if (refused) return refused // a model may still call a tool it was not offered
  if (call.name === 'delegate_task') return delegateTask({ tasks: room.doc.getMap('tasks'), tree, me: room.name, requester, label: room.outputLabel, args: a, now: Date.now(), parentTask, known: room.list().map(f => typeof f === 'string' ? f : f && f.path).filter(Boolean), ask: askFor(room, msgId, parentTask) })
  if (call.name === 'update_plan') { const items = room.setPlan(a.items); return { text: JSON.stringify({ ok: true, steps: items.length, done: items.filter(i => i.status === 'done').length }) } }
  if (call.name === 'find_tasks') { const r = findTasks(room, a); return { text: JSON.stringify(r), note: 'found ' + r.tasks.length + ' TODO/FIXME tasks' + (r.truncated ? ' (scan/results bounded)' : '') } }
  if (call.name === 'claim_task') { const r = claimTask(room, a); return { text: JSON.stringify(r), note: r.claimed ? 'claimed ' + r.path + ' for ' + r.task.marker + ' at line ' + r.task.line : 'task not claimed: ' + r.error } }
  if (call.name === 'read_attachment') {
    if (!attachments) return { text: JSON.stringify({ error: 'reading attachments is not available here' }) }
    let r; try { r = await attachments.read(a.name || a.id) } catch (e) { r = { ok: false, error: 'could not fetch the file: ' + e.message } }
    return { text: JSON.stringify(r), note: r.ok ? `read the attachment ${r.name}: ${r.summary}` : `could not read the attachment: ${r.error}` }
  }
  if (call.name === 'attach_file') return attachFile(a, runner, room, attachments)
  if (call.name === 'request_access') {
    if (!room.requestAccess) return { text: JSON.stringify({ error: 'asking for access is not available here' }) }
    const rights = (Array.isArray(a.rights) ? a.rights : []).filter(r => ['make', 'view', 'edit', 'delete'].includes(r)) // never manage
    const r = await room.requestAccess({ path: String(a.path || ''), rights, reason: String(a.reason || '') })
    const where = String(a.path || '') || 'the workspace'
    return { text: JSON.stringify(r), note: r.granted ? `${r.by || 'someone'} allowed ${rights.join(', ')} on ${where}${r.until && r.until !== 'always' ? ' for now' : ''}` : r.pending ? `asked for ${rights.join(', ')} on ${where}; waiting for an answer` : r.error ? `could not ask: ${r.error}` : `${r.by || 'someone'} said no to ${rights.join(', ')} on ${where}` }
  }
  if (call.name === 'request_payment') {
    if (!room.requestPayment) return { text: JSON.stringify({ error: 'asking for a payment is not available here' }) }
    const r = await room.requestPayment({ amount: a.amount, currency: a.currency, label: String(a.label || ''), reason: String(a.reason || a.description || '') })
    const what = `${r.amount || (a.amount !== undefined ? '$' + a.amount : 'a payment')}${r.label || a.label ? ' for ' + (r.label || a.label) : ''}`
    const note = r.error ? (r.notSetUp ? 'could not ask for a payment: PayPal sandbox is not set up here' : `the server refused the payment request: ${r.error}`)
      : r.status === 'captured' ? `${r.approvedBy} approved ${what}; PayPal (sandbox) captured it` : r.status === 'denied' ? `${r.by} denied ${what}; nothing was charged` : r.pending ? `asked for ${what}; ${r.status === 'awaiting_buyer' ? 'approved, waiting for the buyer on PayPal' : 'waiting for a person to answer'}` : `${what} did not go through (${r.status}); nothing was charged`
    return { text: JSON.stringify(r), note }
  }
  if (call.name === 'find_skill') return findSkill(room, a, msgId, skills)
  // rights first (server/access.js): never ask people to approve a change this agent may not make; say how to ask instead
  if (room.whyNot && (call.name === 'replace_in_file' || call.name === 'write_file' || call.name === 'delete_file')) {
    const p = String(a.path || '').replace(/^\/+/, '')
    const right = call.name === 'delete_file' ? 'delete' : call.name === 'write_file' && room.read(p) == null ? 'make' : 'edit'
    const why = room.whyNot(right, p)
    if (why) return { text: JSON.stringify({ error: why }), note: `no ${right} right on ${p}; it can ask for it` }
  }
  const mutating = call.name === 'replace_in_file' || call.name === 'write_file'
  if (mutating) { const other = room.claimedByOther(a.path); const no = await gate(room, runner, 'edit', `${other ? other.by + ' is working on ' + a.path + ' right now. Edit anyway? ' : ''}Edit ${a.path}`, call.name === 'write_file' ? (a.content || '').slice(0, 600) : `- ${(a.old || '').slice(0, 300)}\n+ ${(a.new || '').slice(0, 300)}`, undefined, !!other); if (no) return { text: JSON.stringify(no), note: `edit to ${a.path} not applied: ${no.error.split('.')[0]}` }; room.claim(a.path) /* visible to everyone until the agent finishes */ }
  if (call.name === 'code_map') {
    const r = queryMap(buildMap(workspaceFiles(room)), a.query)
    return { text: JSON.stringify(r), note: `asked the code map: ${a.query || 'overview'}` }
  }
  if (call.name === 'detect_project') {
    const d = detectProject({ list: () => room.list(), read: p => room.read(p) })
    return { text: JSON.stringify({ ...d, running: processes ? processes.list(room.roomName) : [] }), note: `looked at the project: ${d.stack}${d.command ? ` (start: ${d.command})` : ' (nothing to start)'}` }
  }
  if (call.name === 'start_project') {
    if (!processes) return { text: JSON.stringify({ error: 'starting long-running processes is not available here' }) }
    const d = detectProject({ list: () => room.list(), read: p => room.read(p) })
    const command = a.command || d.command
    if (!command) return { text: JSON.stringify({ error: 'nothing to start. ' + d.notes.join(' ') }), note: 'could not find a way to start the project' }
    const name = String(a.name || 'web').replace(/[^\w-]/g, '').slice(0, 20) || 'web'
    const no = await gate(room, runner, 'command', `Start "${name}" in the sandbox: ${command}`, '', command); if (no) return { text: JSON.stringify(no), note: `not started: ${no.error.split('.')[0]}` }
    let rec; try { rec = await processes.start({ room, name, command, keepPrefix: !a.command && d.keepPrefix }) } catch (e) { return { text: JSON.stringify({ error: e.message }), note: `could not start: ${e.message}` } }
    const ready = await processes.waitReady(room.roomName, name, 100_000)
    const ok = ready && ready.status === 'running'; const logs = processes.logs(room.roomName, name, 25) || ''
    const url = publicUrl + rec.previewPath
    return { text: JSON.stringify({ name, status: ready && ready.status, previewUrl: ok ? url : null, exitCode: ready && ready.exitCode, logs, hint: ok ? undefined : 'It did not come up. Read the logs, fix the cause and call start_project again, or call process_logs later.' }), note: ok ? `started "${name}": ${url}` : `"${name}" did not come up (${ready && ready.status}${ready && ready.exitCode != null ? ', exit ' + ready.exitCode : ''}). Last output:\n${logs.split('\n').slice(-8).join('\n')}` }
  }
  if (call.name === 'process_logs') { const l = processes && processes.logs(room.roomName, String(a.name || 'web'), Number(a.lines) || 40); return l == null ? { text: JSON.stringify({ error: 'no such process' }) } : { text: l || '(no output yet)', note: `read the logs of ${a.name || 'web'}` } }
  if (call.name === 'stop_process') { const ok = processes && await processes.stop(room.roomName, String(a.name || 'web')); return { text: JSON.stringify(ok ? { stopped: true } : { error: 'no such process' }), note: ok ? `stopped ${a.name || 'web'}` : 'nothing to stop' } }
  if (call.name === 'run_command') {
    const no = await gate(room, runner, 'command', `Run on ${runner.label}: ${a.command}`, '', a.command); if (no) return { text: JSON.stringify(no), note: `command not run: ${no.error.split('.')[0]}` }
    const r = await runner.exec(room, a.command || '', msgId)
    const shown = `$ ${a.command}\n${r.output.trim().slice(0, 1200)}${r.changed.length ? `\n(shared back: ${r.changed.join(', ')})` : ''}\n[exit ${r.code}]`
    return { text: JSON.stringify({ exit: r.code, output: r.output, changedFiles: r.changed }), note: shown }
  }
  if (call.name === 'delete_file') {
    const p = String(a.path || '').replace(/^\/+/, '')
    const other = room.claimedByOther(p)
    const no = await gate(room, runner, 'delete', `${other ? other.by + ' is working on ' + p + ' right now. Delete anyway? ' : ''}Delete ${p}${a.recursive ? ' (and contents)' : ''}`, `Action: delete ${p}${a.recursive ? '\nRecursive: true' : ''}`, undefined, !!other)
    if (no) return { text: JSON.stringify(no), note: `delete of ${p} not applied: ${no.error.split('.')[0]}` }
    const r = room.delete(p, msgId, !!a.recursive)
    return { text: JSON.stringify(r), note: r.ok ? `deleted ${Array.isArray(r.deleted) && r.deleted.length > 1 ? p + ' (' + r.deleted.length + ' files)' : p}` : `delete failed: ${r.error}` }
  }
  switch (call.name) {
    case 'list_files': return { text: JSON.stringify(room.list()), note: 'listed files' }
    case 'read_file': { const t = room.read(a.path); return t == null ? { text: JSON.stringify({ error: `no such file: ${a.path}` }) } : { text: t, note: `read ${a.path}` } }
    case 'replace_in_file': { const r = room.replace(a.path, a.old, a.new, msgId); return { text: JSON.stringify(r), note: r.ok ? `edited ${a.path} (line ${r.line})` : `edit failed in ${a.path}: ${r.error}` } }
    case 'write_file': { const r = room.write(a.path, a.content ?? '', msgId); return { text: JSON.stringify(r), note: r.ok ? `${r.created ? 'created' : 'rewrote'} ${a.path}` : `write failed: ${r.error}` } }
    case 'web_search': if (!tavilyKey) return { text: JSON.stringify({ error: 'web search is not configured' }) }; return { text: JSON.stringify(await tavilySearch(tavilyKey, a.query)), note: `searched the web: ${a.query}` }
    default: return { text: JSON.stringify({ error: `unknown tool ${call.name}` }) }
  }
}

// The person a turn works for: the author of the triggering chat message (index.js passes its id; a Y.Map also works). '' when unknown.
export function requesterOf (room, trigger) {
  const m = trigger && typeof trigger.get === 'function' ? trigger : room.chat.toArray().find(x => x.get('id') === trigger)
  return m && !m.get('isAgent') ? String(m.get('author') || '') : ''
}

// The person's original request, for a brief (delegate.js): the message this turn answers, or, when this agent is itself working on
// a task, the request that task's brief carries (so it reaches every level). Its label goes with it.
export function askFor (room, msgId, parentTask) {
  if (parentTask) { const t = room.doc.getMap('tasks').get(parentTask); return t && t.brief && t.brief.ask ? { ...t.brief.ask, label: t.label || null } : null }
  const m = msgId ? room.chat.toArray().find(x => x.get('id') === msgId) : null
  if (!m || m.get('isAgent')) return null
  return { by: String(m.get('author') || ''), text: m.get('text') ? m.get('text').toString() : '', label: m.get('label') || null }
}

// A task handed down by a manager (worker.js): the request the model works on, quoted as the task's own text (capped), with its brief.
export const taskRequest = task => `Task ${task.id} from your manager${task.createdBy ? ` (asked for by ${String(task.createdBy).slice(0, 60)})` : ''}: ${String(task.title || '').slice(0, 300)}${task.detail ? '\n' + String(task.detail).slice(0, 2000) : ''}${briefText(task.brief)}\nDo only this task. If it needs something outside it, say so in your reply instead of doing it. Then say in one or two sentences what you did and how you checked it.`

// The message this turn answers, as the last thing the model reads (two people asking at once, or agents chatting meanwhile,
// otherwise leave the request somewhere in the middle of the history). Restricted for this reader: only the short note.
export function answeringLine (room, trigger, reader) {
  const m = trigger && typeof trigger.get === 'function' ? trigger : room.chat.toArray().find(x => x.get('id') === trigger)
  if (!m || m.get('isAgent')) return null
  if (reader !== undefined && !canRead(m.get('label'), reader)) return { role: 'user', content: `The message you are answering: ${restrictedNote(m.get('label'))}` }
  const text = m.get('text') ? m.get('text').toString() : ''
  return text ? { role: 'user', content: `The message you are answering, from ${m.get('author')}: ${text.slice(0, 4000)}` } : null
}

export async function respond ({ room, llm, trigger, tavilyKey, runner, getRunner, processes, publicUrl, budget, skills, attachments, task, tree: treeOf, ledger, paywall }) {
  const asker = task ? String(task.createdBy || '') : requesterOf(room, trigger)
  if (paywall && !(await paywall(asker, room.roomName)).ok) { if (room.limit) room.limit(asker, LIMIT); else room.say(`${LIMIT.title} · ${LIMIT.detail}`); return } // out of usage: no model call
  const reader = typeof room.readerFor === 'function' ? room.readerFor(asker) : undefined
  const seen = task && task.label ? [task.label] : [] // work done on a labeled task carries its label
  const tree = typeof treeOf === 'function' ? treeOf() : treeOf
  const team = hasReports(tree, room.name) ? [...tree.values()].filter(n => n.parent === room.name).map(n => n.name) : []
  const coordinator = team.length > 0 && process.env.VESPR_AGENT_DOES_WORK !== '1' // VESPR_AGENT_DOES_WORK=1 lets a team lead also do work itself
  const teamLine = !team.length ? '' : coordinator
    ? `\nYou coordinate a team: ${team.join(', ')}. You do not change files or run commands yourself. Read what you need, then hand the work to the right teammate with delegate_task (one sentence, specific enough to do without asking). Give each piece of work to one teammate from start to finish: a fix includes running its tests, so never split a fix and its test run between two people, and never give two teammates the same file at the same time. After delegating, tell the person in one or two sentences who is doing what, and stop: the results come back to you on their own, so do not keep checking the files.`
    : `\nYou lead a team: ${team.join(', ')}. Hand work to them with delegate_task instead of doing it all yourself; their results come back to you for review, and you report them to the person who asked.`
  const messages = [{ role: 'system', content: systemPrompt(room, room.list()) + teamLine + (team.length ? BRIEF_RULE : '') + '\n' + FILE_RULES + skillsPrompt(room, skills) }, ...history(room, reader, seen), ...(task ? [{ role: 'user', content: taskRequest(task) }] : [answeringLine(room, trigger, reader)].filter(Boolean))]
  room.outputLabel = highWater(seen) // everything the agent writes in this turn carries the highest label it read
  const tools = asOpenAITools(!!tavilyKey, !!processes, !!skills, !!attachments, team.length > 0, coordinator, typeof room.requestPayment === 'function')
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (budget && budget.exhausted()) { room.say(budgetMessage(budget)); return }
      let said = null; let calls = []
      const role = room.mode() === 'plan' ? 'plan' : 'chat' // planning can use a bigger model than everyday chat
      for await (const ev of llm.complete({ messages, tools, role })) {
        if (ev.text) { said = said || room.say('', 'agent', llm.modelFor(role)); said.append(ev.text) }
        if (ev.done) calls = ev.toolCalls
      }
      const used = llm.lastUsage || { prompt: Math.ceil(JSON.stringify(messages).length / 4), completion: Math.ceil((said ? said.text().length : 0) / 4), estimated: true }
      room.addUsage(room.name, used); if (budget) budget.spend(used.prompt + used.completion)
      if (ledger) ledger({ person: asker || `room:${room.roomName}`, room: room.roomName, feature: role === 'plan' ? 'plan' : 'agent', model: llm.modelFor(role), usage: used }) // billed to who asked // measured when the provider reports it, estimated otherwise
      messages.push({ role: 'assistant', content: said ? said.text() : null, ...(calls.length ? { tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) })
      if (!calls.length) return
      for (const c of calls) {
        const needsRunner = c.name === 'run_command'
        const active = needsRunner && getRunner ? await getRunner() : runner
        // every call but the plan itself is a live line in the chat: "Reading cart.py" while it runs, then the tool's note
        const summary = stepSummary(c.name, c.args)
        const live = c.name !== 'update_plan' && room.startStep ? room.startStep(c.name, summary) : null
        let r
        try {
          r = needsRunner && !active
            ? { text: JSON.stringify({ error: 'the runner chosen for this workspace is offline; ask someone to start it or pick another' }), note: 'command not run: the chosen runner is offline' }
            : await runTool(room, c, trigger, tavilyKey, active, { processes, publicUrl, skills, attachments, tree, requester: asker, parentTask: task ? task.id : '', coordinator })
        } catch (e) { if (live) live.finish(`${summary} (failed)\n${String(e.message).slice(0, 300)}`, false); throw e }
        const ok = stepOk(r)
        if (live) live.finish(r.note || (ok ? '' : `${summary} (failed)${stepError(r) ? '\n' + stepError(r) : ''}`), ok)
        else if (r.note) room.say(r.note, 'tool')
        messages.push({ role: 'tool', tool_call_id: c.id, name: c.name, content: r.text })
      }
    }
    room.say('I stopped after several steps; tell me if you want me to continue.')
  } catch (e) {
    room.say(`I hit an error talking to the model: ${String(e.message).slice(0, 200)}`)
  } finally { room.releaseClaims() }
}
