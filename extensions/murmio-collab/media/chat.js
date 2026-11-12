/* VESPR team chat: draws the shared state sent by the extension and sends your actions back. */
const vs = acquireVsCodeApi()
const $ = id => document.getElementById(id)
const log = $('log'); const inp = $('in')
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
// a very small, safe markdown: text is escaped first, then `code`, ```blocks``` and **bold** are recognised
const md = t => esc(t)
  .replace(/```[\w-]*\n?([\s\S]*?)```/g, (_m, c) => '<pre><code>' + c + '</code></pre>')
  .replace(/\{\{file:([^}\n]{1,200})\}\}/g, '<code class="filechip">$1</code>')
  .replace(/`([^`\n]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
const hhmm = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const k = n => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n))
let people = []
const colorOf = n => (people.find(p => p.name === n) || {}).color || 'var(--vscode-foreground)'

const askHtml = m => {
  const verb = m.kind === 'command' ? 'run a command' : m.kind === 'skill' ? 'install a skill' : 'edit a file'
  const state = m.status === 'pending' ? '' : m.status
  const foot = m.status === 'pending'
    ? '<div class="row"><button data-act="yes" data-id="' + esc(m.id) + '">Approve</button><button class="sec" data-act="no" data-id="' + esc(m.id) + '">Deny</button></div>'
    : '<div class="done">' + (m.status === 'approved' ? '✓ Approved' : m.status === 'denied' ? '✕ Denied' : '⏱ Expired') + (m.decidedBy && m.decidedBy !== 'timeout' ? ' by ' + esc(m.decidedBy) : '') + '</div>'
  return '<div class="ask ' + state + '"><div class="why" style="color:' + colorOf(m.author) + '">🤖 ' + esc(m.author) + ' asks to ' + verb + '</div><div class="what">' + esc(m.text) + '</div>' + (m.detail ? '<pre>' + esc(m.detail) + '</pre>' : '') + foot + '</div>'
}
const msgHtml = m => {
  if (m.role === 'approval') return askHtml(m)
  if (m.role === 'tool') return '<div class="tool">✎ ' + esc(m.author) + ': ' + esc(m.text) + '</div>'
  return '<div class="msg' + (m.isAgent ? ' agent' : '') + '" style="--accent:' + colorOf(m.author) + '"><div class="who" style="color:' + colorOf(m.author) + '">' + (m.isAgent ? '🤖 ' : '') + esc(m.author) +
    '<span class="when">' + hhmm(m.ts) + '</span>' + (m.model ? '<span class="model" title="' + esc(m.model) + '">' + esc(m.model) + '</span>' : '') + '</div><div class="body">' + md(m.text) + '</div></div>'
}
const EMPTY = '<div class="empty">Say hello, or ask an agent for help by mentioning it, for example <b>@coder run python3 -m unittest -q</b>. Everyone in the workspace sees this chat live, including what the agents are doing.</div>'

window.addEventListener('message', e => {
  const s = e.data; if (s.type !== 'state') return
  people = s.people
  $('people').innerHTML = people.map(p => '<span class="chip" title="' + esc(p.model) + '"><span class="dot" style="background:' + p.color + '"></span>' + (p.isAgent ? '🤖 ' : '') + esc(p.name) + (p.me ? ' (you)' : '') + '</span>').join('')
  const runners = [{ id: 'sandbox', label: 'Sandbox (agent container)' }, ...(s.runners || []).map(r => ({ id: r.id, label: r.label + ' (' + r.os + ')' + (r.user ? ' · ' + r.user : '') }))]
  if (!runners.some(r => r.id === s.runner)) runners.push({ id: s.runner, label: s.runner + ' (offline)' })
  $('runner').innerHTML = runners.map(r => '<option value="' + esc(r.id) + '"' + (r.id === s.runner ? ' selected' : '') + '>' + esc(r.label) + '</option>').join('')
  $('mode').value = s.mode
  $('planbar').style.display = s.mode === 'plan' ? 'flex' : 'none'
  $('meta').innerHTML = (s.claims.length ? '🔒 ' + s.claims.map(c => esc(c.by) + ' → ' + esc(c.file)).join(', ') + '<br>' : '') +
    (s.usage.length ? 'Tokens: ' + s.usage.map(u => esc(u.key.replace('suggest:', 'suggestions for ')) + ' ' + k(u.tokens)).join(' · ') : '')
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60
  log.innerHTML = s.messages.length ? s.messages.map(msgHtml).join('') : EMPTY
  if (atBottom) log.scrollTop = log.scrollHeight
})
log.addEventListener('click', e => { const b = e.target.closest('button[data-act]'); if (b) vs.postMessage({ type: 'decide', id: b.dataset.id, ok: b.dataset.act === 'yes' }) })
$('runner').addEventListener('change', e => vs.postMessage({ type: 'runner', id: e.target.value }))
$('mode').addEventListener('change', e => vs.postMessage({ type: 'mode', mode: e.target.value }))
for (const [id, type] of [['rp', 'replay'], ['cm', 'commit'], ['cu', 'catchup'], ['ln', 'lens'], ['plan', 'approvePlan']]) $(id).addEventListener('click', () => vs.postMessage({ type }))
const send = () => { if (inp.value.trim()) { vs.postMessage({ type: 'send', text: inp.value }); inp.value = '' } }
$('go').addEventListener('click', send)
inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } })
vs.postMessage({ type: 'ready' })
