// "VESPR: Replay this session": a scrub bar over everything that happened in the workspace, like a video.
// The extension host rebuilds the past from the server's session log; the webview only draws frames.
const vscode = require('vscode')
const { parseLog, Replay } = require('./replay')
const { colorFor, safeColor } = require('./binding')

async function openReplay (cfg) {
  const base = cfg.server.replace(/^ws/, 'http').replace(/\/$/, '')
  let records
  try {
    const res = await fetch(`${base}/api/log/${encodeURIComponent(cfg.room)}`, { headers: { Authorization: `Bearer ${cfg.token}` } })
    if (!res.ok) throw new Error(`server answered ${res.status}`)
    records = parseLog(Buffer.from(await res.arrayBuffer()))
  } catch (e) { return vscode.window.showErrorMessage(`VESPR replay: could not load the session log (${e.message}).`) }
  if (records.length < 2) return vscode.window.showInformationMessage('VESPR replay: nothing recorded yet in this workspace.')
  const replay = new Replay(records)
  const panel = vscode.window.createWebviewPanel('murmioReplay', 'VESPR: Replay', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true })
  const frame = (i, file) => {
    const f = replay.frame(i, file)
    const colors = {}
    for (const sp of f.spans) { const a = sp.attrs.by; if (a && a !== 'import') colors[a] = colorFor(a, !!sp.attrs.ai) }
    f.spans = f.spans.map(sp => ({ start: sp.start, end: sp.end, by: sp.attrs.by || '', ai: !!sp.attrs.ai, model: sp.attrs.model || '' }))
    f.colors = colors
    f.cursors = f.cursors.map(c => ({ ...c, color: safeColor(c.color) }))
    f.people = f.people.map(p => ({ ...p, color: safeColor(p.color) }))
    return f
  }
  panel.webview.html = html()
  panel.webview.onDidReceiveMessage(m => {
    if (m.type === 'ready') panel.webview.postMessage({ type: 'init', times: records.map(r => r.ts), frame: frame(records.length - 1) })
    if (m.type === 'seek') panel.webview.postMessage({ type: 'frame', frame: frame(m.i, m.file) })
  })
}

function html () {
  const nonce = Math.random().toString(36).slice(2)
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; height: 100vh; display: flex; flex-direction: column; }
  #top { padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: center; border-bottom: 1px solid var(--vscode-widget-border, #8884); }
  #slider { flex: 1; min-width: 120px; } button, select { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 3px; padding: 3px 10px; cursor: pointer; }
  select { color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); }
  #time { min-width: 0; flex-basis: 100%; font-variant-numeric: tabular-nums; font-size: 12px; }
  #main { flex: 1; display: flex; min-height: 0; }
  #left { flex: 2; display: flex; flex-direction: column; min-width: 0; border-right: 1px solid var(--vscode-widget-border, #8884); }
  #tabs { display: flex; gap: 4px; padding: 6px 8px; flex-wrap: wrap; } .tab { padding: 2px 9px; border-radius: 3px; cursor: pointer; font-size: 12px; background: var(--vscode-editorWidget-background); } .tab.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  #code { flex: 1; overflow: auto; margin: 0; padding: 8px 12px; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); white-space: pre; line-height: 1.5; }
  @media (max-width: 800px) { #main { flex-direction: column; } #left { flex: 1 1 52%; border-right: 0; border-bottom: 1px solid var(--vscode-widget-border, #8884); } #right { flex: 1 1 48%; min-width: 0; } #time { flex-basis: auto; } }
  .cur { display: inline-block; width: 0; border-left: 2px solid; position: relative; height: 1.1em; vertical-align: text-bottom; }
  .cur b { position: absolute; top: -1.15em; left: -1px; font: 600 10px var(--vscode-font-family); color: #000; padding: 0 4px; border-radius: 3px 3px 3px 0; white-space: nowrap; }
  #legend { padding: 6px 12px; font-size: 11.5px; border-top: 1px solid var(--vscode-widget-border, #8884); display: flex; gap: 12px; flex-wrap: wrap; } .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
  #right { flex: 1; min-width: 220px; display: flex; flex-direction: column; } #people { padding: 8px; font-size: 12px; border-bottom: 1px solid var(--vscode-widget-border, #8884); }
  #chat { flex: 1; overflow: auto; padding: 8px 10px; font-size: 12.5px; } .who { font-weight: 600; font-size: 11.5px; } .body { white-space: pre-wrap; margin: 1px 0 8px; } .tool { opacity: .7; font-size: 11.5px; white-space: pre-wrap; margin: 0 0 6px 8px; border-left: 2px solid #8886; padding-left: 6px; }
  .ask { margin: 0 0 8px 6px; padding: 5px 7px; border: 1px solid #b89500; border-radius: 4px; font-size: 12px; }
</style></head><body>
<div id="top"><button id="play">▶ Play</button><select id="speed"><option value="1">1×</option><option value="4" selected>4×</option><option value="16">16×</option><option value="64">64×</option></select><input id="slider" type="range" min="0" max="0" value="0"><span id="time"></span></div>
<div id="main"><div id="left"><div id="tabs"></div><pre id="code"></pre><div id="legend"></div></div><div id="right"><div id="people"></div><div id="chat"></div></div></div>
<script nonce="${nonce}">
  const vs = acquireVsCodeApi(); const $ = id => document.getElementById(id)
  let times = [], cur = 0, file = null, playing = false, timer = null, busy = false
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const okColor = c => /^(hsla?\([\d.,% ]+\)|#[0-9a-fA-F]{3,8})$/.test(c || '') ? c : 'currentColor'
  const tint = c => c.replace('hsl(', 'hsla(').replace(')', ', 0.28)')
  function drawCode (f) {
    const cuts = new Set([0, f.text.length]); f.spans.forEach(s => { cuts.add(s.start); cuts.add(s.end) }); f.cursors.forEach(c => cuts.add(c.index))
    const pts = [...cuts].sort((a, b) => a - b); let out = ''
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[k + 1]
      for (const c of f.cursors) if (c.index === a) out += '<span class="cur" style="border-color:' + c.color + '"><b style="background:' + c.color + '">' + (c.isAgent ? '🤖 ' : '') + esc(c.name) + '</b></span>'
      if (b === undefined) break
      const sp = f.spans.find(s => s.start <= a && s.end > a); const col = sp && f.colors[sp.by]
      const seg = esc(f.text.slice(a, b))
      out += col ? '<span style="background:' + tint(col) + '" title="' + esc(sp.by + (sp.ai ? ' (agent ' + sp.model + ')' : '')) + '">' + seg + '</span>' : seg
    }
    $('code').innerHTML = out || '<i style="opacity:.6">(empty at this moment)</i>'
  }
  function draw (f) {
    cur = f.i; $('slider').value = f.i; file = f.file
    $('time').textContent = new Date(f.ts).toLocaleTimeString() + '  ·  +' + Math.round((f.ts - f.startTs) / 1000) + 's  ·  ' + (f.i + 1) + '/' + f.total
    $('tabs').innerHTML = f.files.map(n => '<span class="tab' + (n === f.file ? ' on' : '') + '" data-f="' + esc(n) + '">' + esc(n) + '</span>').join('') || '<i style="opacity:.6;padding:2px 6px">no files yet</i>'
    drawCode(f)
    $('legend').innerHTML = Object.entries(f.colors).map(([a, c]) => '<span><span class="sw" style="background:' + c + '"></span>' + esc(a) + '</span>').join('') + '<span style="opacity:.6">text without a tint was imported with the project</span>'
    $('people').innerHTML = '<b>Here:</b> ' + (f.people.map(p => (p.isAgent ? '🤖 ' : '') + esc(p.name)).join(', ') || 'nobody') + ' · agent mode: <b>' + esc(f.mode) + '</b>'
    const col = n => (f.people.find(p => p.name === n) || {}).color || ''
    $('chat').innerHTML = f.chat.map(m => m.role === 'tool' ? '<div class="tool">✎ ' + esc(m.author) + ': ' + esc(m.text) + '</div>'
      : m.role === 'approval' ? '<div class="ask">🤖 ' + esc(m.author) + ' asks: ' + esc(m.text) + '<br><i>' + (m.status === 'pending' ? 'waiting for a decision' : esc(m.status) + (m.decidedBy ? ' by ' + esc(m.decidedBy) : '')) + '</i></div>'
      : '<div class="who" style="color:' + col(m.author) + '">' + (m.isAgent ? '🤖 ' : '') + esc(m.author) + '</div><div class="body">' + esc(m.text) + '</div>').join('')
    $('chat').scrollTop = $('chat').scrollHeight
  }
  const seek = i => { if (busy) return; busy = true; vs.postMessage({ type: 'seek', i, file }) }
  window.addEventListener('message', e => {
    if (e.data.type === 'init') { times = e.data.times; $('slider').max = times.length - 1; draw(e.data.frame) }
    if (e.data.type === 'frame') { busy = false; draw(e.data.frame) }
  })
  $('slider').addEventListener('input', e => { seek(+e.target.value) })
  $('tabs').addEventListener('click', e => { const t = e.target.closest('.tab'); if (t) { file = t.dataset.f; seek(cur) } })
  $('play').addEventListener('click', () => {
    playing = !playing; $('play').textContent = playing ? '⏸ Pause' : '▶ Play'
    clearInterval(timer); if (!playing) return
    if (cur >= times.length - 1) cur = 0
    let vt = times[cur]
    timer = setInterval(() => {
      vt += 100 * +$('speed').value
      let i = cur; while (i + 1 < times.length && times[i + 1] <= vt) i++
      if (i !== cur) seek(i)
      if (vt >= times[times.length - 1]) { playing = false; $('play').textContent = '▶ Play'; clearInterval(timer) }
    }, 100)
  })
  vs.postMessage({ type: 'ready' })
</script></body></html>`
}

module.exports = { openReplay }
