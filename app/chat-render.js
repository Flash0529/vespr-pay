// How the conversation draws what the agents and people write: Markdown (headings, lists, tables, quotes, code with a copy button, safe links),
// the markers an agent can use to hand over work ({{file:..}}, {{card:..}}, {{image:..}}, [attached: ..]), and the folded "work" boxes that hold an agent's steps while it works.
// Pure functions, no DOM and no network: the shell passes in the icons and the box markup (hooks), so everything here can be tested in Node (app/test/chat-render.test.mjs).
// Everything is escaped before it is put together; links are http(s) and mailto only; a picture is shown only when the shell resolves it to a file in this workspace.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const KINDS = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'], svg: ['svg'], '3d': ['stl', 'obj', 'glb', 'gltf'], pdf: ['pdf'],
  code: ['py', 'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'sh', 'c', 'h', 'cpp', 'go', 'rs', 'java', 'sql', 'yml', 'yaml', 'toml', 'ipynb'],
  doc: ['md', 'txt', 'doc', 'docx', 'rtf', 'csv', 'tsv'], sheet: ['xls', 'xlsx'], deck: ['ppt', 'pptx', 'key'], audio: ['mp3', 'wav', 'm4a', 'ogg', 'flac'], video: ['mp4', 'mov', 'webm', 'mkv']
}
export const extOf = name => { const m = /\.([A-Za-z0-9]{1,6})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : '' }
export function fileKind (name, type = '') {
  const e = extOf(name); for (const [k, list] of Object.entries(KINDS)) if (list.includes(e)) return k
  if (/^image\//.test(type)) return type === 'image/svg+xml' ? 'svg' : 'image'
  if (type === 'application/pdf') return 'pdf'
  return 'file'
}
export const KIND_LABEL = { image: 'Image', svg: 'Image', '3d': '3D model', pdf: 'PDF', code: 'Code', doc: 'Document', sheet: 'Spreadsheet', deck: 'Slides', audio: 'Audio', video: 'Video', file: 'File' }
export function humanSize (n) { n = Number(n) || 0; if (n < 1024) return (n || 1) + ' B'; if (n < 1048576) return Math.round(n / 1024) + ' KB'; return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB' }

/* ------------------------------------------------------------------ Markdown */
// hooks: { marker(kind, arg, opt), attached({name,size,id}), ic(name), highlight(lang, code) -> html | null }
export function renderMarkdown (raw, hooks = {}) {
  const stash = []; const keep = html => { stash.push(html); return '\u0000' + (stash.length - 1) + '\u0000' }
  const ic = hooks.ic || (() => '')
  let s = String(raw ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '')

  const code = (lang, body) => {
    const l = String(lang || '').toLowerCase()
    let inner = null; if (hooks.highlight) { try { inner = hooks.highlight(l, body) } catch {} }
    return `<div class="mdcode"><div class="mdch"><span class="mdlang">${esc(l || 'text')}</span><button class="mdcopy" data-copy aria-label="Copy the code">${ic('copy')}<span>Copy</span></button></div><pre><code>${inner ?? esc(body)}</code></pre></div>`
  }
  // fenced code (a fence still open at the end, while a reply is streaming, shows as code too)
  s = s.replace(/^```([\w+.#-]*)[^\n]*\n([\s\S]*?)\n?```[ \t]*$/gm, (m, lang, body) => keep(code(lang, body)))
  s = s.replace(/^```([\w+.#-]*)[^\n]*\n([\s\S]*)$/m, (m, lang, body) => keep(code(lang, body)))
  // a marker that names no file ("{{file:none}}", "{{file:not found in this workspace}}": a real model wrote both after a payment, 2026-11-12) is not a file: drop it before it can become a box
  s = s.replace(/[ \t]*\{\{\s*(?:file|card|image|artifact)\s*:\s*(?:none|null|nil|nothing|n\/a|na|unknown|no files?|not found[^}|]*|not applicable|-+)\s*(?:\|[^}]*)?\}\}/gi, '')
  // hand-over markers
  s = s.replace(/\{\{(file|card|image|artifact):([^}|]+)(?:\|([^}]*))?\}\}/g, (m, kind, arg, opt) => keep(hooks.marker ? hooks.marker(kind, arg.trim(), (opt || '').trim()) : esc(m)))
  // a model that has nothing to hand over sometimes writes an empty marker (a real one: "{{none}}" at the end of a line, 2026-11-12). It is the model's own output, not a template of ours, and it means nothing: drop it (code blocks are already set aside above)
  s = s.replace(/[ \t]*\{\{\s*(?:none|null|nothing|n\/a|empty|no files?)\s*\}\}/gi, '').replace(/[ \t]*\{\{\s*(?:file|card|image|artifact)\s*:\s*(?:\|[^}]*)?\}\}/g, '')
  s = s.replace(/\[attached:\s*(\S+)\s*(\d+)\s*id=([a-zA-Z0-9_-]+)\]/g, (m, name, size, id) => keep(hooks.attached ? hooks.attached({ name, size: +size, id }) : esc(m)))

  const inline = text => {
    let t = esc(text)
    t = t.replace(/`([^`\n]+)`/g, (m, c) => keep('<code>' + c + '</code>'))
    t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (m, label, url) => keep(`<a href="${url}" target="_blank" rel="noopener noreferrer"${hooks.linkAttrs ? hooks.linkAttrs(url) : ''}>${label}</a>`))
    t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (m, pre, url) => pre + keep(`<a href="${url}" target="_blank" rel="noopener noreferrer"${hooks.linkAttrs ? hooks.linkAttrs(url) : ''}>${url}</a>`))
    t = t.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w])__([^_\n]+?)__(?!\w)/g, '$1<strong>$2</strong>')
    t = t.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^\w])_([^_\s][^_\n]*?)_(?!\w)/g, '$1<em>$2</em>')
    t = t.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>')
    return t
  }

  const lines = s.split('\n'); const out = []; let i = 0
  const isBlank = l => /^\s*$/.test(l)
  const blockPh = l => { const m = /^\s*\u0000(\d+)\u0000\s*$/.exec(l); return !!m && /^<(div|figure)/.test(stash[+m[1]]) } // a code block, a file box or a picture on a line of its own
  const listRe = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/
  const tableSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-') && (l.includes('|') || /^\s*:?-+:?\s*$/.test(l) === false)
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
  while (i < lines.length) {
    const l = lines[i]
    if (isBlank(l)) { i++; continue }
    if (blockPh(l)) { out.push(l.trim()); i++; continue }
    let m
    if ((m = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(l))) { out.push(`<h${m[1].length + 2} class="mdh">${inline(m[2])}</h${m[1].length + 2}>`); i++; continue }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l) && !listRe.test(l)) { out.push('<hr>'); i++; continue }
    if (/^\s*>/.test(l)) { const q = []; while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, '')); out.push('<blockquote>' + q.map(inline).join('<br>') + '</blockquote>'); continue }
    if (l.includes('|') && i + 1 < lines.length && tableSep(lines[i + 1]) && cells(l).length > 1) {
      const head = cells(l); const align = cells(lines[i + 1]).map(c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''); i += 2
      const rows = []; while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) rows.push(cells(lines[i++]))
      const td = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</${tag}>`
      out.push(`<div class="mdtable"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows.map(r => '<tr>' + head.map((_, k) => td('td', r[k] ?? '', k)).join('') + '</tr>').join('')}</tbody></table></div>`); continue
    }
    if ((m = listRe.exec(l))) { // lists, nested by indentation
      const stack = []; let html = ''
      while (i < lines.length && (m = listRe.exec(lines[i]))) {
        const ind = m[1].replace(/\t/g, '    ').length; const ord = /\d/.test(m[2]); const tag = ord ? 'ol' : 'ul'
        while (stack.length && ind < stack[stack.length - 1].ind) { html += `</li></${stack.pop().tag}>` }
        if (!stack.length || ind > stack[stack.length - 1].ind) { html += `<${tag}>`; stack.push({ ind, tag }) } else html += '</li>'
        html += '<li>' + inline(m[3]); i++
        while (i < lines.length && !isBlank(lines[i]) && !listRe.test(lines[i]) && /^\s{2,}\S/.test(lines[i])) html += '<br>' + inline(lines[i++].trim()) // a wrapped line
      }
      while (stack.length) html += `</li></${stack.pop().tag}>`
      out.push(html); continue
    }
    const para = []
    while (i < lines.length && !isBlank(lines[i]) && !/^(#{1,4})\s/.test(lines[i]) && !/^\s*>/.test(lines[i]) && !blockPh(lines[i]) && !(listRe.test(lines[i]) && para.length)) para.push(lines[i++])
    if (!para.length) { para.push(lines[i++]) }
    out.push('<p>' + para.map(inline).join('<br>') + '</p>')
  }
  let html = out.join('')
  for (let n = 0; n < 4 && /\u0000\d+\u0000/.test(html); n++) html = html.replace(/\u0000(\d+)\u0000/g, (m, k) => stash[+k] ?? '')
  return html || '<p></p>'
}

/* ------------------------------------------------------------------ the work boxes */
// An agent's steps (tool lines) are folded into one box while it works and stay as a one-line summary after.
// items: the conversation as built by the shell; a step is { r: 'work', id, ts, text, ok, detail } plus, from agents that report
// them, { status: 'running'|'done'|'failed', started, ended } (ms). Returns the list with consecutive steps grouped into
// { r: 'workgroup', id, steps, live }. A group with a running step is live wherever it is (an approval card can follow it).
const isRunning = s => !!s && s.status === 'running'
export function groupWork (items, { now = Date.now(), busy = false, liveMs = 45000 } = {}) {
  const out = []
  for (const it of items) {
    if (it && it.r === 'work') {
      let g = out[out.length - 1]
      if (!g || g.r !== 'workgroup') { g = { r: 'workgroup', id: it.id || 'w' + out.length, steps: [], live: false }; out.push(g) }
      g.steps.push(it)
    } else out.push(it)
  }
  for (const g of out) if (g && g.r === 'workgroup' && g.steps.some(isRunning)) g.live = true
  const last = out[out.length - 1]
  if (last && last.r === 'workgroup' && !last.live) { const ts = last.steps[last.steps.length - 1].ts || 0; last.live = !!busy || (ts > 0 && now - ts < liveMs) }
  return out
}
// "<1s", "12s", "1m 05s", "2h 03m"; '' for anything that is not a sensible time span
export function formatDuration (ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return '<1s'
  const s = Math.round(ms / 1000); if (s < 60) return s + 's'
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ' + String(s % 60).padStart(2, '0') + 's'
  return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'
}
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
// how long a step took, or has been running so far
export const stepTime = (s, now = Date.now()) => { const a = num(s && s.started); if (a == null) return ''; const b = num(s.ended); return formatDuration((b == null ? now : b) - a) }
export const isCommand = t => /^\$ /.test(t || '')
export function stepIcon (text, ok = true) {
  if (!ok) return 'alert'
  const t = String(text || '')
  if (isCommand(t)) return 'term'
  if (/^(read|open|view|look|list)/i.test(t)) return 'eye'
  if (/^(edit|wrote|creat|updat|fix|renam|delet|add)/i.test(t)) return 'edit'
  if (/^(search|find|grep|skill)/i.test(t)) return 'search'
  return 'check'
}
// One line for a run of technical steps, summed up: "Ran 2 commands, read cart.py, edited 3 files, 1 failed".
// Kinds keep the order they first appeared in; one file is named, several are counted.
const WORK_KINDS = [
  ['cmd', t => isCommand(t)], ['web', t => /^search(ing)? the web/i.test(t)], ['list', t => /^list/i.test(t)],
  ['read', t => /^(read|open|view|look)/i.test(t)], ['edit', t => /^(edit|replac|updat)/i.test(t)], ['write', t => /^(writ|creat)/i.test(t)],
  ['delete', t => /^delet/i.test(t)]
]
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
export function summarizeWork (steps) {
  const groups = new Map(); const failed = steps.filter(s => s.ok === false).length
  for (const s of steps) {
    const t = String(s.text || '').split('\n')[0]; const k = (WORK_KINDS.find(([, test]) => test(t)) || ['other'])[0]
    const g = groups.get(k) || { n: 0, names: new Set() }; g.n++; g.names.add(t.replace(/^\$?\s*\S+\s+/, '')); groups.set(k, g)
  }
  const file = (verb, g) => g.names.size === 1 ? `${verb} ${[...g.names][0]}` : `${verb} ${plural(g.names.size, 'file', 'files')}`
  const say = { cmd: g => `ran ${plural(g.n, 'command', 'commands')}`, web: g => g.n === 1 ? 'searched the web' : `searched the web ${g.n} times`, list: () => 'listed the files',
    read: g => file('read', g), edit: g => file('edited', g), write: g => file('wrote', g), delete: g => file('deleted', g), other: g => plural(g.n, 'other step', 'other steps') }
  const line = [...groups].map(([k, g]) => say[k](g)).join(', ')
  return (line ? line[0].toUpperCase() + line.slice(1) : 'No steps') + (failed ? `, ${failed} failed` : '')
}
export const stepLine = s => String(s.text || '').split('\n')[0].replace(/^\$ /, '')
// the box itself; ic(name) gives an icon, open says whether the list is shown.
// openSteps (a Set of step ids) turns on one-line rows that each open on a click ([data-step-toggle]) to show their output,
// like a chat log you can click into; without it every step's output shows inside the open box, as before.
// A running step's time carries data-start so the shell can tick it every second without re-rendering the feed.
export function workBox (g, { ic = () => '', who = 'The agent', open = false, openSteps = null, now = Date.now() } = {}) {
  const last = g.steps[g.steps.length - 1]; const failed = g.steps.some(s => s.ok === false)
  const current = g.steps.find(isRunning) || last
  const first = num(g.steps[0] && g.steps[0].started); const end = num(last.ended)
  const total = !g.live && first != null && end != null ? formatDuration(end - first) : ''
  const head = g.live
    ? `<span class="wsp" aria-hidden="true"></span><span class="wl"><b>${esc(who)} is working</b><span class="wcur">${esc(stepLine(current))}</span></span>`
    : `<span class="wdone${failed ? ' bad' : ''}" aria-hidden="true">${ic(failed ? 'alert' : 'check')}</span><span class="wl">${esc(summarizeWork(g.steps))}${total ? `<span class="wtot"> · ${total}</span>` : ''}</span>`
  const rows = g.steps.map((s, k) => {
    const run = isRunning(s); const t = stepTime(s, now)
    const icon = run ? '<span class="wsp sm" aria-hidden="true"></span>' : ic(stepIcon(s.text, s.ok !== false))
    const time = t ? `<span class="wdur"${run && num(s.started) != null ? ` data-start="${s.started}"` : ''}>${t}</span>` : ''
    const cls = `wst${s.ok === false ? ' err' : ''}${run ? ' run' : ''}`
    if (!openSteps || !s.detail) {
      const pre = !openSteps && s.detail ? `<pre>${esc(s.detail)}</pre>` : ''
      return `<div class="${cls}" style="--k:${Math.min(k, 12)}"><span class="wsi">${icon}</span><span class="wt">${esc(stepLine(s))}</span>${time}${pre}</div>`
    }
    const id = String(s.id || g.id + ':' + k); const isOpen = openSteps.has(id)
    return `<div class="${cls}" style="--k:${Math.min(k, 12)}" data-step="${esc(id)}"${isOpen ? ' data-open="1"' : ''}><button class="wsr" data-step-toggle aria-expanded="${isOpen}"><span class="wsi">${icon}</span><span class="wt">${esc(stepLine(s))}</span>${time}<span class="wc">${ic('chevr')}</span></button>${isOpen ? `<pre>${esc(s.detail)}</pre>` : ''}</div>`
  }).join('')
  return `<div class="wbox ${g.live ? 'busy' : 'done'}" data-work="${esc(g.id)}" data-ts="${last.ts || 0}"${open ? ' data-open="1"' : ''}><button class="wh" data-work-toggle aria-expanded="${open}">${head}<span class="wn">${g.steps.length}</span><span class="wc">${ic('chevr')}</span></button><div class="wb"><div class="wbi">${rows}</div></div></div>`
}

/* ------------------------------------------------------------------ the checklist */
// An agent's task list (update_plan), shown with its reply: done, in progress, next. plan: { items: [{ text, status }], updated }.
const PLAN_STATES = ['pending', 'in_progress', 'done']
const PLAN_LABEL = { done: 'done', in_progress: 'in progress', pending: 'not started' }
const own = (o, k) => (o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined)
export function planView (plan) {
  const raw = Array.isArray(own(plan, 'items')) ? plan.items : []
  const steps = []
  for (const it of raw.slice(0, 20)) {
    const text = String(own(it, 'text') ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
    if (text) steps.push({ text, status: PLAN_STATES.includes(own(it, 'status')) ? it.status : 'pending' })
  }
  const done = steps.filter(s => s.status === 'done').length
  const cur = steps.find(s => s.status === 'in_progress')
  return { steps, done, total: steps.length, current: cur ? cur.text : '', finished: steps.length > 0 && done === steps.length }
}
export function planBox (plan, { ic = () => '', who = 'The agent' } = {}) {
  const v = planView(plan); if (!v.total) return ''
  const rows = v.steps.map(s => `<li class="pst ${s.status}"><span class="psi" role="img" aria-label="${PLAN_LABEL[s.status]}">${s.status === 'done' ? ic('check') : s.status === 'in_progress' ? '<span class="wsp sm" aria-hidden="true"></span>' : ''}</span><span class="pt">${esc(s.text)}</span></li>`).join('')
  return `<div class="planbox${v.finished ? ' done' : ''}" data-plan="${esc(who)}"><div class="ph"><span class="pw">${esc(who)}'s plan</span><span class="pn">${v.done}/${v.total}</span></div><ol class="pl">${rows}</ol></div>`
}

// The out-of-usage card: "Usage limit reached · Resets at ...", "Get more usage to keep working",
// a Get more usage button and Open usage settings. Only the person it is for sees the card; everyone else sees a quiet note.
export function limitCard (it, { ic = () => '', mine = false } = {}) {
  it = it || {}
  if (!mine) return `<div class="m note"><div class="body">${esc(it.who || 'The agent')} paused: the person who asked is out of usage.</div></div>`
  const resets = Number(it.resets) > 0 ? ` · Resets at ${new Date(Number(it.resets)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''
  return `<div class="limitcard" role="status" data-limit="${esc(it.id || '')}"><div class="lt">${ic('clock')}<span><b>${esc(it.title || 'Usage limit reached')}</b>${esc(resets)}</span></div>` +
    `<div class="ld">${esc(it.detail || 'Get more usage to keep working')}</div>` +
    '<div class="lb"><button type="button" class="lbtn pri" data-billing="buy">Get more usage</button><button type="button" class="lbtn" data-billing="usage">Open usage settings</button></div><div class="lu" hidden></div></div>'
}
export const money = n => { n = Number(n) || 0; return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2) }
// What Open usage settings shows inside the card: the balance, what was used, and the credit packs to buy
export function usagePanel (me) {
  me = me || {}
  const packs = (Array.isArray(me.packs) ? me.packs : []).map(p => `<button type="button" class="lbtn" data-billing="buy" data-pack="${esc(p.id)}">Add ${esc(money(p.usd))}</button>`).join('')
  return `<div class="lus"><span>Balance <b>${money(me.balance_usd)}</b></span><span>Used <b>${money(me.spent_usd)}</b></span></div><div class="lb">${packs}</div>`
}
