// The message box's helpers: a big paste becomes a file on the tray, Ctrl+Enter carries a list on (1. -> 2.),
// and the strip above the box says what the agent is doing right now (compact; click for the steps). Pure functions; tested.

// A paste this big reads as a file or an article, not a message: it goes on the tray as "Pasted text" instead of into the box
export const BIG_PASTE = { chars: 2500, lines: 40 }
export function isBigPaste (text) {
  const t = String(text || ''); if (!t.trim()) return false
  return t.length >= BIG_PASTE.chars || t.split('\n').length >= BIG_PASTE.lines
}
// name and size for the pasted file: its own title if it has one (a markdown heading or a short first line), else "Pasted text"
export function pasteMeta (text, n = 1) {
  const t = String(text || ''); const lines = t.split('\n')
  const first = (lines.find(l => l.trim()) || '').trim()
  const heading = /^#{1,3}\s+(.{3,60})$/.exec(first)
  const md = /^#{1,6}\s|^\s*[-*]\s|\*\*|\]\(/m.test(t)
  const code = !md && /[;{}]\s*$|^\s*(def|class|function|import|const|let|var|#include|public|package)\b/m.test(t) && (t.match(/[{};]/g) || []).length > lines.length / 4
  const base = heading ? heading[1].replace(/[\\/:*?"<>|]+/g, '').trim() : n > 1 ? `Pasted text ${n}` : 'Pasted text'
  return { name: base + (md ? '.md' : '.txt'), lines: lines.length, chars: t.length, kind: code ? 'code' : md ? 'markdown' : 'text' }
}

// Ctrl/Cmd+Enter (and Shift+Enter) on a list line starts the next item: "1. a" -> "2. ", "- a" -> "- ", "a) x" -> "b) ".
// On an empty item it ends the list instead (the marker is removed), the way editors do. Returns null when the line is not a list.
export function continueList (value, caret) {
  const v = String(value ?? ''); const at = Math.max(0, Math.min(caret ?? v.length, v.length))
  const start = v.lastIndexOf('\n', at - 1) + 1; const line = v.slice(start, at)
  const m = /^(\s*)(?:(\d{1,3})([.)])|([a-z])\)|([-*•]))(\s+)(.*)$/.exec(line)
  if (!m) return null
  const [, indent, num, sep, letter, bullet, gap, rest] = m
  if (!rest.trim()) { const value2 = v.slice(0, start) + indent + v.slice(at); return { value: value2, caret: start + indent.length, ended: true } }
  const marker = num ? String(Number(num) + 1) + sep : letter ? (letter === 'z' ? 'a' : String.fromCharCode(letter.charCodeAt(0) + 1)) + ')' : bullet
  const ins = '\n' + indent + marker + gap
  return { value: v.slice(0, at) + ins + v.slice(at), caret: at + ins.length, ended: false }
}

// The live strip above the message box: what the agent is doing now, since when, and its latest steps. null when nothing runs.
// items: the chat as the app maps it ({ r: 'me' | 'work' | 'thinking' | ..., text, status, ok, started, ts, who }).
export function activityView (items, { now = Date.now(), max = 6 } = {}) {
  const list = Array.isArray(items) ? items.filter(x => x && typeof x === 'object') : []
  let from = 0; for (let i = list.length - 1; i >= 0; i--) if (list[i].r === 'me' || list[i].r === 'team') { from = i + 1; break }
  const recent = list.slice(from)
  const steps = recent.filter(x => x.r === 'work')
  const thinking = recent.find(x => x.r === 'thinking')
  const running = steps.filter(x => x.status === 'running')
  if (!running.length && !thinking) return null
  const cur = running.length ? running[running.length - 1] : null
  const who = (cur && cur.who) || (thinking && thinking.who) || 'The agent'
  const title = cur ? String(cur.text || '').split('\n')[0].replace(/^\$ /, 'Running ') : `${who} is thinking`
  const t0 = Math.min(...[...steps.map(s => Number(s.started) || Infinity), Number(thinking && thinking.ts) || Infinity])
  return {
    who, title,
    elapsed: Number.isFinite(t0) ? Math.max(0, now - t0) : 0,
    steps: steps.slice(-max).map(s => ({ text: String(s.text || '').split('\n')[0], state: s.status === 'running' ? 'running' : s.ok === false ? 'failed' : 'done' })),
    more: Math.max(0, steps.length - max)
  }
}
// "14m 36s", "52s": the strip's clock
export function clock (ms) {
  const s = Math.floor(Math.max(0, Number(ms) || 0) / 1000); const m = Math.floor(s / 60); const h = Math.floor(m / 60)
  return h ? `${h}h ${m % 60}m` : m ? `${m}m ${s % 60}s` : `${s}s`
}
