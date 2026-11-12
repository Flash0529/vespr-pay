// "VESPR: Show code map": a live, interactive map of the workspace beside the editor.
// The host builds the map from the shared document (so authorship and agent edits are real) and the webview (media/codemap.js) draws it.
const fs = require('node:fs')
const path = require('node:path')
const { buildMap } = require('./codemap')
const { colorFor, safeColor } = require('./binding')

let panel = null

function html ({ script, nonce, csp = true }) {
  return `<!doctype html><html><head><meta charset="utf-8">
${csp ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">` : ''}
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { --bg: var(--vscode-editor-background, #0b0c0f); --fg: var(--vscode-foreground, #e8e9ec); --line: #8b93a155; --panel: color-mix(in srgb, var(--bg) 92%, #fff 8%); --hair: color-mix(in srgb, var(--fg) 14%, transparent); --muted: color-mix(in srgb, var(--fg) 62%, transparent); --accent: #5eead4; --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Geist", "Inter", system-ui, sans-serif }
  * { box-sizing: border-box } html, body { height: 100%; margin: 0 } body { background: var(--bg); color: var(--fg); font: 13px/1.45 var(--font); display: flex; flex-direction: column; -webkit-font-smoothing: antialiased }
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 12px 16px; border-bottom: 1px solid var(--hair) }
  h1 { font-size: 15px; font-weight: 600; letter-spacing: -.01em; margin: 0 6px 0 0 } #stats { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; flex: 1 1 260px }
  input, select, button { font: inherit; color: var(--fg); background: var(--panel); border: 1px solid var(--hair); border-radius: 999px; padding: 5px 12px; outline: none } input { width: 170px } select, button { cursor: pointer } button:hover, select:hover { border-color: var(--muted) }
  input:focus-visible, select:focus-visible, button:focus-visible, li:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
  main { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 300px } #stage { position: relative; min-width: 0 } canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: grab; display: block }
  #tip { position: absolute; pointer-events: none; max-width: 240px; padding: 8px 10px; border-radius: 12px; background: var(--panel); border: 1px solid var(--hair); font-size: 12px; display: flex; flex-direction: column; gap: 2px; box-shadow: 0 8px 28px #0006 } #tip[hidden] { display: none } #tip b { font-weight: 600; word-break: break-all } #tip span { color: var(--muted) }
  #legend { position: absolute; left: 14px; bottom: 12px; right: 14px; display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 11.5px; color: var(--muted); pointer-events: none } .sw { display: inline-flex; align-items: center; gap: 6px } .sw i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; border: 1px solid var(--hair) }
  aside { border-left: 1px solid var(--hair); display: flex; flex-direction: column; min-height: 0; overflow: hidden } #detail { padding: 14px 16px; overflow: auto; flex: 1 1 55%; border-bottom: 1px solid var(--hair) } #listwrap { flex: 1 1 45%; overflow: auto; padding: 6px 8px 12px }
  h3 { font-size: 13px; font-weight: 600; margin: 0 0 8px; word-break: break-all } h4 { margin: 14px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600 } .hint, .meta { color: var(--muted); margin: 6px 0; font-size: 12px }
  #detail button { margin: 2px 0 6px; padding: 4px 12px; font-size: 12px } .bars { display: flex; flex-direction: column; gap: 5px; margin: 8px 0 } .bar { position: relative; height: 18px; border-radius: 6px; background: color-mix(in srgb, var(--fg) 7%, transparent); overflow: hidden } .bar i { position: absolute; inset: 0 auto 0 0; opacity: .5; border-radius: 6px } .bar span { position: relative; padding: 0 8px; font-size: 11.5px; line-height: 18px }
  ul { list-style: none; margin: 0; padding: 0 } .mini li { padding: 2px 0; font-size: 12px; color: var(--fg); word-break: break-all; opacity: .9 } .mini li[tabindex] { cursor: pointer } .mini li[tabindex]:hover { color: var(--accent) }
  #list li { display: flex; justify-content: space-between; gap: 8px; padding: 5px 8px; border-radius: 8px; cursor: pointer; font-size: 12.5px } #list li:hover { background: color-mix(in srgb, var(--fg) 7%, transparent) } #list li.on { background: color-mix(in srgb, var(--accent) 16%, transparent) } .mt { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap }
  @media (max-width: 760px) { main { grid-template-columns: 1fr; grid-template-rows: minmax(260px, 1fr) minmax(0, 1fr) } aside { border-left: 0; border-top: 1px solid var(--hair) } input { width: 120px } }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important } }
</style></head><body>
<header><h1>Code Map</h1><input id="q" type="search" placeholder="Find a file or symbol" aria-label="Find a file or symbol"><select id="mode" aria-label="Color by"><option value="author">Color: author</option><option value="agent">Color: people vs agents</option><option value="dir">Color: folder</option></select><button id="fit">Fit</button><span id="stats" aria-live="polite"></span></header>
<main><div id="stage"><canvas id="graph" role="img" aria-label="Interactive map of the files in this workspace and how they import each other; the list on the right has the same information"></canvas><div id="tip" hidden></div><div id="legend"></div></div>
<aside><div id="detail"></div><div id="listwrap"><ul id="list"></ul></div></aside></main>
<script nonce="${nonce}">${script}</script></body></html>`
}

async function openCodeMap ({ getFiles, onOpen, extensionPath }) {
  if (panel) { panel.reveal(); return }
  panel = vscode().window.createWebviewPanel('murmioCodeMap', 'VESPR: Code Map', vscode().ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true })
  const script = fs.readFileSync(path.join(extensionPath, 'media', 'codemap.js'), 'utf8').replace(/<\/script/gi, '<\\/script')
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  panel.webview.html = html({ script, nonce })
  let seen = new Map(); let first = true; let timer = null
  const collect = () => {
    const files = getFiles(); const out = []
    for (const p of [...files.keys()].sort()) {
      const t = files.get(p); const text = t.toString(); const spans = []; let pos = 0
      for (const op of t.toDelta()) { const len = typeof op.insert === 'string' ? op.insert.length : 0; if (op.attributes && op.attributes.by) spans.push({ start: pos, end: pos + len, by: op.attributes.by, ai: !!op.attributes.ai }); pos += len }
      out.push({ path: p, text, spans })
    }
    return out
  }
  const push = () => {
    if (!panel) return
    const files = collect(); const map = buildMap(files); const changed = []
    const now = new Map(files.map(f => [f.path, f.text.length + ':' + f.text.slice(0, 64) + f.text.slice(-64)]))
    if (!first) for (const [p, sig] of now) if (seen.get(p) !== sig) changed.push(p)
    seen = now
    const colors = {}; for (const n of map.nodes) for (const a of n.authors) colors[a.name] = safeColor(colorFor(a.name, a.ai))
    panel.webview.postMessage({ type: 'map', map, colors, changed, first }); first = false
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(push, 700) }
  const files0 = getFiles(); files0.observeDeep(schedule)
  panel.webview.onDidReceiveMessage(m => { if (m.type === 'ready') push(); if (m.type === 'open' && typeof m.path === 'string') onOpen(m.path) })
  panel.onDidDispose(() => { clearTimeout(timer); try { files0.unobserveDeep(schedule) } catch {} ; panel = null })
}

const vscode = () => require('vscode')
module.exports = { openCodeMap, html }
