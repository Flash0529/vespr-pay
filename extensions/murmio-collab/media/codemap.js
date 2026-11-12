// VESPR Code Map: the drawing side. The extension host builds the map (lib/codemap.js) and sends it; this file only draws and reacts.
// Canvas force layout, no libraries. Messages in: { type: 'map', map, colors, changed }. Messages out: { type: 'ready' } and { type: 'open', path }.
(function () {
  const vs = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage () {} }
  const $ = id => document.getElementById(id)
  const canvas = $('graph'); const ctx = canvas.getContext('2d')
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const css = n => getComputedStyle(document.body).getPropertyValue(n).trim()
  let map = null; let colors = {}; let nodes = []; let links = []; let byId = new Map()
  let view = { x: 0, y: 0, k: 1 }; let alpha = 1; let hover = null; let selected = null; let drag = null; let pan = null
  let mode = 'author'; let query = ''; const pulses = new Map(); let W = 0; let H = 0; let raf = 0

  const TEAL = '#5eead4'; const GRAY = '#8b93a1'
  let dupes = new Set(); const label = n => { const parts = n.path.split('/'); return dupes.has(parts[parts.length - 1]) && parts.length > 1 ? parts.slice(-2).join('/') : parts[parts.length - 1] } // same name in two folders: show the folder too
  const radius = n => Math.min(20, 4.5 + Math.sqrt(n.loc || 1) * 0.65)
  const mix = (a, b, t) => { const p = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)); const x = p(a); const y = p(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('') }
  const dirHue = d => { let h = 0; for (const c of d) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 55% 62%)` }
  const colorOf = n => {
    if (mode === 'agent') return mix(GRAY, TEAL, Math.min(1, n.agentShare * 1.2))
    if (mode === 'dir') return n.dir ? dirHue(n.dir) : GRAY
    const top = n.authors[0]; return top ? (colors[top.name] || (top.ai ? TEAL : '#a5b4fc')) : GRAY
  }

  function setMap (m, changed) {
    map = m; const old = byId; const fresh = old.size === 0
    const dirList = [...new Set(m.nodes.map(n => n.dir))].sort(); const ring = 90 + 16 * Math.sqrt(m.nodes.length) // each folder starts in its own part of a ring, so the layout settles into folder neighbourhoods
    nodes = m.nodes.map(n => { const o = old.get(n.id); const a = (dirList.indexOf(n.dir) / dirList.length) * Math.PI * 2; return Object.assign(n, { x: o ? o.x : Math.cos(a) * ring + (Math.random() - .5) * 70, y: o ? o.y : Math.sin(a) * ring + (Math.random() - .5) * 70, vx: 0, vy: 0 }) })
    { const seen = new Map(); dupes = new Set(); for (const n of nodes) { const b = n.path.split('/').pop(); if (seen.has(b)) dupes.add(b); seen.set(b, 1) } }
    byId = new Map(nodes.map(n => [n.id, n])); links = m.edges.map(e => ({ s: byId.get(e.from), t: byId.get(e.to), uses: e.uses })).filter(l => l.s && l.t)
    for (const p of changed || []) pulses.set(p, performance.now())
    if (fresh) { alpha = 1; for (let i = 0; i < 480 && alpha > 0.02; i++) tick(0.992); alpha = 0.08; fitView() } else alpha = Math.max(alpha, 0.35)
    if (selected) selected = byId.get(selected.id) || null
    $('stats').textContent = `${m.stats.files} files · ${m.stats.loc.toLocaleString()} lines · ${m.stats.symbols} symbols · ${m.stats.edges} imports · ${Math.round(m.stats.agentShare * 100)}% by agents`
    renderLegend(); renderList(); renderDetail(); kick()
  }

  function tick (cool = 0.985) {
    const n = nodes.length; if (!n) return
    const dirs = new Map(); for (const a of nodes) { const d = dirs.get(a.dir) || { x: 0, y: 0, c: 0 }; d.x += a.x; d.y += a.y; d.c++; dirs.set(a.dir, d) }
    for (let i = 0; i < n; i++) {
      const a = nodes[i]
      for (let j = i + 1; j < n; j++) { const b = nodes[j]; let dx = a.x - b.x; let dy = a.y - b.y; let d2 = dx * dx + dy * dy || 0.01; const min = radius(a) + radius(b) + 14; if (d2 > 90000) continue
        const f = (3400 / d2) * alpha; const d = Math.sqrt(d2); dx /= d; dy /= d; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f
        if (d < min) { const push = (min - d) * 0.15; a.vx += dx * push; a.vy += dy * push; b.vx -= dx * push; b.vy -= dy * push } }
      const c = dirs.get(a.dir); a.vx += (c.x / c.c - a.x) * 0.03 * alpha; a.vy += (c.y / c.c - a.y) * 0.03 * alpha // same folder drifts together
      a.vx -= a.x * 0.004 * alpha; a.vy -= a.y * 0.004 * alpha
    }
    for (const l of links) { const dx = l.t.x - l.s.x; const dy = l.t.y - l.s.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const f = (d - 95) * 0.035 * alpha; const fx = (dx / d) * f; const fy = (dy / d) * f; l.s.vx += fx; l.s.vy += fy; l.t.vx -= fx; l.t.vy -= fy }
    for (const a of nodes) { if (drag && drag.node === a) { a.vx = a.vy = 0; continue } a.vx *= 0.82; a.vy *= 0.82; a.x += a.vx; a.y += a.vy }
    alpha *= cool; if (alpha < 0.012) alpha = 0
  }

  const sx = x => x * view.k + view.x + W / 2; const sy = y => y * view.k + view.y + H / 2
  const wx = x => (x - view.x - W / 2) / view.k; const wy = y => (y - view.y - H / 2) / view.k
  const matches = n => !query || n.path.toLowerCase().includes(query) || n.symbols.some(s => s.name.toLowerCase().includes(query))

  function draw (now) {
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); ctx.clearRect(0, 0, W, H)
    const focus = hover || selected; const near = new Set(); if (focus) { near.add(focus.id); for (const l of links) { if (l.s === focus) near.add(l.t.id); if (l.t === focus) near.add(l.s.id) } }
    ctx.lineWidth = 1
    for (const l of links) {
      const hot = focus && (l.s === focus || l.t === focus); const dim = (focus && !hot) || (query && !(matches(l.s) && matches(l.t)))
      const x1 = sx(l.s.x); const y1 = sy(l.s.y); const x2 = sx(l.t.x); const y2 = sy(l.t.y)
      ctx.strokeStyle = hot ? (l.s === focus ? '#7dd3fc' : '#fda4af') : css('--line'); ctx.globalAlpha = dim ? 0.12 : hot ? 0.95 : 0.55
      ctx.beginPath(); const mx = (x1 + x2) / 2 - (y2 - y1) * 0.08; const my = (y1 + y2) / 2 + (x2 - x1) * 0.08; ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke()
      if (hot || view.k > 1.4) { const ang = Math.atan2(y2 - my, x2 - mx); const r = (radius(l.t) + 2) * view.k; const ax = x2 - Math.cos(ang) * r; const ay = y2 - Math.sin(ang) * r; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - Math.cos(ang - .4) * 6, ay - Math.sin(ang - .4) * 6); ctx.lineTo(ax - Math.cos(ang + .4) * 6, ay - Math.sin(ang + .4) * 6); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill() }
    }
    ctx.globalAlpha = 1
    const labelled = new Set([...nodes].sort((a, b) => b.score - a.score).slice(0, 18).map(n => n.id)); const boxes = []
    const room = (x, y, w) => { const b = [x - w / 2, y - 11, x + w / 2, y + 3]; if (boxes.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) return false; boxes.push(b); return true }
    for (const n of nodes) {
      const x = sx(n.x); const y = sy(n.y); const r = radius(n) * view.k; const dim = (focus && !near.has(n.id)) || (query && !matches(n))
      ctx.globalAlpha = dim ? 0.18 : 1
      const col = colorOf(n)
      const t0 = pulses.get(n.path); if (t0 && !reduceMotion) { const age = (now - t0) / 1600; if (age < 1) { ctx.beginPath(); ctx.arc(x, y, r + 4 + age * 26, 0, 7); ctx.strokeStyle = TEAL; ctx.globalAlpha = (1 - age) * 0.7; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; ctx.globalAlpha = dim ? 0.18 : 1 } else pulses.delete(n.path) }
      if (n.agentShare > 0.5 && mode === 'author') { ctx.beginPath(); ctx.arc(x, y, r + 3, 0, 7); ctx.strokeStyle = TEAL; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1 } // mostly written by an agent
      const g = ctx.createRadialGradient(x - r * .3, y - r * .35, r * .1, x, y, r); g.addColorStop(0, mix(col.startsWith('#') ? col : '#cccccc', '#ffffff', .35)); g.addColorStop(1, col.startsWith('#') ? col : '#cccccc')
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = col.startsWith('#') ? g : col; ctx.fill()
      if (n === selected || n === hover) { ctx.beginPath(); ctx.arc(x, y, r + 3, 0, 7); ctx.strokeStyle = css('--fg'); ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = 1 }
      if (n.entry) { ctx.beginPath(); ctx.arc(x, y, Math.max(1.6, r * .22), 0, 7); ctx.fillStyle = css('--bg'); ctx.fill() }
      if (labelled.has(n.id) || n === hover || n === selected || (query && matches(n)) || view.k > 1.8) {
        ctx.font = `${n === hover || n === selected ? 600 : 500} 11px ${css('--font')}`; const text = label(n); const force = n === hover || n === selected
        if (force || room(x, y + r + 13, ctx.measureText(text).width + 6)) { ctx.globalAlpha = dim ? 0.2 : 0.95; ctx.fillStyle = css('--fg'); ctx.textAlign = 'center'; ctx.fillText(text, x, y + r + 13) }
      }
    }
    ctx.globalAlpha = 1
  }

  function frame (now) {
    raf = 0; if (alpha > 0) for (let i = 0; i < 2; i++) tick()
    draw(now || performance.now())
    if (alpha > 0 || pulses.size || drag) raf = requestAnimationFrame(frame)
  }
  function kick () { if (reduceMotion && alpha > 0) { for (let i = 0; i < 260 && alpha > 0; i++) tick() } if (!raf) raf = requestAnimationFrame(frame) }

  function resize () { const r = canvas.getBoundingClientRect(); W = r.width; H = r.height; canvas.width = W * devicePixelRatio; canvas.height = H * devicePixelRatio; kick(); draw(performance.now()) }
  addEventListener('resize', resize)
  function at (e) { const r = canvas.getBoundingClientRect(); const x = wx(e.clientX - r.left); const y = wy(e.clientY - r.top); let best = null; let bd = 1e9; for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y) - radius(n); if (d < 6 / view.k && d < bd) { bd = d; best = n } } return best }
  canvas.addEventListener('mousemove', e => {
    if (drag) { const r = canvas.getBoundingClientRect(); drag.node.x = wx(e.clientX - r.left); drag.node.y = wy(e.clientY - r.top); drag.moved = true; alpha = Math.max(alpha, 0.25); kick(); return }
    if (pan) { view.x += e.movementX; view.y += e.movementY; kick(); return }
    const n = at(e); if (n !== hover) { hover = n; canvas.style.cursor = n ? 'pointer' : 'grab'; showTip(n, e); kick() } else if (n) showTip(n, e)
  })
  canvas.addEventListener('mousedown', e => { const n = at(e); if (n) drag = { node: n, moved: false }; else { pan = true; canvas.style.cursor = 'grabbing' } })
  addEventListener('mouseup', () => { if (drag && !drag.moved) { selected = drag.node; renderDetail(); renderList() } if (!drag && pan && !hover) { /* background click keeps selection */ } drag = null; pan = null; canvas.style.cursor = hover ? 'pointer' : 'grab'; kick() })
  canvas.addEventListener('dblclick', e => { const n = at(e); if (n) vs.postMessage({ type: 'open', path: n.path }) })
  canvas.addEventListener('mouseleave', () => { hover = null; $('tip').hidden = true; kick() })
  canvas.addEventListener('wheel', e => { e.preventDefault(); const r = canvas.getBoundingClientRect(); const mx = e.clientX - r.left; const my = e.clientY - r.top; const k = Math.min(4, Math.max(0.25, view.k * Math.exp(-e.deltaY * 0.0014))); const px = wx(mx); const py = wy(my); view.k = k; view.x = mx - W / 2 - px * k; view.y = my - H / 2 - py * k; kick() }, { passive: false })

  function showTip (n, e) {
    const tip = $('tip'); if (!n) { tip.hidden = true; return }
    const r = canvas.getBoundingClientRect(); tip.hidden = false; tip.style.left = Math.min(r.width - 250, e.clientX - r.left + 14) + 'px'; tip.style.top = Math.min(r.height - 120, e.clientY - r.top + 14) + 'px'
    tip.replaceChildren(el('b', n.path), el('span', `${n.loc} lines · imported by ${n.in} · imports ${n.out}`), el('span', n.authors.map(a => `${a.name}${a.ai ? ' (agent)' : ''} ${Math.round(a.share * 100)}%`).join(', ') || 'no authorship recorded'))
  }
  function el (tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e }

  function renderLegend () {
    const lg = $('legend'); lg.replaceChildren()
    const sw = (c, t) => { const s = el('span', null, 'sw'); const d = el('i'); d.style.background = c; s.append(d, document.createTextNode(t)); lg.append(s) }
    if (mode === 'agent') { sw(GRAY, 'written by people'); sw(TEAL, 'written by agents') }
    else if (mode === 'dir') { for (const d of [...new Set(nodes.map(n => n.dir))].slice(0, 8)) sw(d ? dirHue(d) : GRAY, d || 'root') }
    else { const seen = new Map(); for (const n of nodes) for (const a of n.authors.slice(0, 1)) seen.set(a.name, a.ai); for (const [name, ai] of seen) sw(colors[name] || (ai ? TEAL : '#a5b4fc'), name + (ai ? ' (agent)' : '')); sw('transparent', 'teal ring: mostly agent-written · hollow centre: entry point') }
  }
  function renderList () {
    const ul = $('list'); ul.replaceChildren()
    for (const n of [...nodes].sort((a, b) => b.score - a.score).filter(matches).slice(0, 80)) {
      const li = el('li', null, n === selected ? 'on' : ''); li.tabIndex = 0; li.setAttribute('role', 'button')
      li.append(el('span', label(n), 'nm'), el('span', `${n.in}↓ ${n.out}↑`, 'mt'))
      li.title = n.path; const go = () => { selected = n; renderDetail(); renderList(); alpha = Math.max(alpha, 0.05); kick() }
      li.addEventListener('click', go); li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } }); ul.append(li)
    }
  }
  function renderDetail () {
    const d = $('detail'); d.replaceChildren()
    if (!selected) { d.append(el('p', 'Click a file for its symbols, imports and authors. Double-click to open it. Drag to rearrange; scroll to zoom.', 'hint')); return }
    const n = selected; d.append(el('h3', n.path))
    const open = el('button', 'Open file'); open.addEventListener('click', () => vs.postMessage({ type: 'open', path: n.path })); d.append(open)
    d.append(el('p', `${n.loc} lines · ${n.lang} · ${n.entry ? 'entry point · ' : ''}imported by ${n.in} · imports ${n.out}`, 'meta'))
    if (n.authors.length) { const bars = el('div', null, 'bars'); for (const a of n.authors) { const row = el('div', null, 'bar'); const f = el('i'); f.style.width = Math.max(3, a.share * 100) + '%'; f.style.background = colors[a.name] || (a.ai ? TEAL : '#a5b4fc'); row.append(f, el('span', `${a.name}${a.ai ? ' (agent)' : ''} ${Math.round(a.share * 100)}%`)); bars.append(row) } d.append(bars) }
    const list = (title, items, click) => { if (!items.length) return; d.append(el('h4', title)); const ul = el('ul', null, 'mini'); for (const it of items.slice(0, 12)) { const li = el('li', it.text); if (click) { li.tabIndex = 0; li.addEventListener('click', () => click(it)) } ul.append(li) } d.append(ul) }
    list('Symbols', n.symbols.map(s => ({ text: `${s.kind} ${s.name}  :${s.line}` })))
    const jump = it => { const t = byId.get(it.id); if (t) { selected = t; renderDetail(); renderList(); kick() } }
    list('Imports', links.filter(l => l.s === n).map(l => ({ text: l.t.path + (l.uses.length ? `  (${l.uses.join(', ')})` : ''), id: l.t.id })), jump)
    list('Imported by', links.filter(l => l.t === n).map(l => ({ text: l.s.path, id: l.s.id })), jump)
    if (n.externals.length) list('Packages', n.externals.map(x => ({ text: x })))
  }

  $('mode').addEventListener('change', e => { mode = e.target.value; renderLegend(); kick() })
  $('q').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); renderList(); kick() })
  function fitView () { view = { x: 0, y: 0, k: 1 }; if (nodes.length && W) { const xs = nodes.map(n => n.x); const ys = nodes.map(n => n.y); const w = Math.max(...xs) - Math.min(...xs) + 140; const h = Math.max(...ys) - Math.min(...ys) + 140; view.k = Math.min(1.8, Math.max(.25, Math.min(W / w, H / h))); view.x = -((Math.max(...xs) + Math.min(...xs)) / 2) * view.k; view.y = -((Math.max(...ys) + Math.min(...ys)) / 2) * view.k } kick() }
  $('fit').addEventListener('click', fitView)
  addEventListener('message', e => { const m = e.data; if (m && m.type === 'map') { colors = m.colors || colors; setMap(m.map, m.changed); } })
  new ResizeObserver(resize).observe(canvas)
  resize(); vs.postMessage({ type: 'ready' })
  window.__codemap = { setMap, get nodes () { return nodes }, get alpha () { return alpha } } // for the screenshot harness
})()
