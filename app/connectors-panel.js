// Connectors in the app (server/connectors.js): Settings > Connectors lists every service with its real state, and after a sign-in with
// Google / Microsoft / GitHub a small card offers that provider's services. Connecting opens the provider's own consent page (a new tab
// on the web, the browser in the desktop app); this page refreshes when the person comes back. Nothing here pretends: the states come
// from the server, and a service whose keys the operator has not set says so and has no button.
//   panelHtml(view, q)  -> the Settings tab's HTML        offerHtml(suggest) -> the after-sign-in card's HTML
//   mount(el, api)      -> draws the tab into el and wires it        offer(api) -> shows the card when there is something to offer
// api = { get(path), post(path, body), toast(text), open(url), app? }: app is the desktop app's link scheme (vespr / vespr-test), so the
// browser page can offer "Back to the VESPR app" when the connect is done
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const ORDER = ['Files and docs', 'Mail and calendar', 'Chat', 'Projects', 'Code', 'Design', 'Business', 'School']
const BADGE = { connected: ['Connected', '#10b981', 'rgba(16,185,129,.15)'], needs_reconnect: ['Connect again', '#f59e0b', 'rgba(245,158,11,.15)'], available: ['Not connected', '#a1a1aa', 'rgba(113,113,122,.15)'], not_set_up: ['Not set up yet', '#71717a', 'rgba(113,113,122,.10)'], not_for_account: ['Not available', '#71717a', 'rgba(113,113,122,.10)'] }
const initial = name => esc(String(name || '?').trim()[0] || '?').toUpperCase()

export function panelHtml (view, q = '') {
  const all = (view && view.connectors) || []
  const term = String(q || '').trim().toLowerCase()
  const list = term ? all.filter(c => (c.name + ' ' + c.provider + ' ' + c.category + ' ' + c.what).toLowerCase().includes(term)) : all
  const on = all.filter(c => c.status === 'connected').length
  const cats = [...new Set([...ORDER, ...list.map(c => c.category)])].filter(cat => list.some(c => c.category === cat))
  const card = c => {
    const [label, fg, bg] = BADGE[c.status] || BADGE.available
    const btn = c.status === 'connected' ? `<button class="btn warn" style="height:26px;font-size:11px" data-conn-off="${esc(c.id)}">Disconnect</button>`
      : (c.status === 'available' || c.status === 'needs_reconnect') ? `<button class="btn pri" style="height:26px;font-size:11px" data-conn-on="${esc(c.id)}">Connect</button>` : ''
    return `<div class="cset-card" data-conn="${esc(c.id)}" style="flex-direction:column;align-items:flex-start;gap:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;width:100%;gap:8px">
        <div style="display:flex;align-items:center;gap:10px;min-width:0">
          <div aria-hidden="true" style="width:32px;height:32px;flex:none;border-radius:8px;background:#27272a;color:#e4e4e7;display:flex;align-items:center;justify-content:center;font-weight:700">${initial(c.name)}</div>
          <div style="min-width:0"><b style="font-size:13px;color:#fff">${esc(c.name)}</b><div style="font-size:11px;color:#71717a">${esc(c.provider)}</div></div>
        </div>
        <span class="badge-desktop" style="background:${bg};color:${fg};white-space:nowrap">${label}</span>
      </div>
      <div style="font-size:12px;color:#a1a1aa">${esc(c.what)}</div>
      ${c.account ? `<div style="font-size:11px;color:#a1a1aa">Account: <code>${esc(c.account)}</code></div>` : ''}
      ${c.note ? `<div style="font-size:11px;color:#71717a">${esc(c.note)}</div>` : ''}
      ${btn ? `<div style="width:100%;display:flex;justify-content:flex-end">${btn}</div>` : ''}
    </div>`
  }
  return `<div>
      <h2 style="margin:0 0 4px;font-size:18px;color:#fff">Connectors</h2>
      <div style="font-size:12px;color:#71717a">Link the services you already use, so you and your agents can work with them from VESPR. Each one asks the service for its own permission, and you can disconnect any time. ${on ? `${on} connected.` : ''}</div>
    </div>
    <input class="cset-input" data-conn-q type="search" placeholder="Search connectors" aria-label="Search connectors" value="${esc(q)}" style="margin-top:10px;width:100%;max-width:360px">
    ${cats.map(cat => `<h3 style="margin:16px 0 8px;font-size:13px;color:#e4e4e7">${esc(cat)}</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">${list.filter(c => c.category === cat).map(card).join('')}</div>`).join('')}
    ${list.length ? '' : `<div style="margin-top:14px;font-size:12px;color:#71717a">No connector matches "${esc(q)}".</div>`}`
}

export function offerHtml (suggest) {
  const s = suggest && suggest[0]; if (!s) return ''
  const names = s.names || {}
  return `<div role="dialog" aria-label="Connect your ${esc(s.provider)} services" style="font:13px/1.4 system-ui,sans-serif;color:#e4e4e7">
    <b style="font-size:14px;color:#fff">Connect your ${esc(s.provider)} services?</b>
    <div style="margin:4px 0 8px;color:#a1a1aa">You signed in with ${esc(s.provider)}. Pick what VESPR may use; ${esc(s.provider)} asks you to confirm.</div>
    ${s.ids.map(id => `<label style="display:flex;gap:8px;align-items:center;margin:4px 0"><input type="checkbox" data-offer-id="${esc(id)}" ${/mail/.test(id) ? '' : 'checked'}> ${esc(names[id] || id)}</label>`).join('')}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
      <button class="btn" data-offer-later style="height:28px">Not now</button><button class="btn pri" data-offer-go style="height:28px">Connect</button>
    </div></div>`
}

// start a connect and keep an eye out for the person coming back
async function connect (api, ids, after) {
  let r; try { r = await api.post('/auth/connectors/start', api.app ? { ids, app: api.app } : { ids }) } catch (e) { api.toast(e.message || 'Could not start'); return }
  if (!r || !r.url) { api.toast((r && r.error) || 'Could not start'); return }
  api.open(r.url)
  api.toast(`Continue in your browser: VESPR checks it is you, then ${r.provider || 'the provider'} asks`)
  watch(api, ids, after)
}
let watching = null
function watch (api, ids, after) {
  if (watching) watching.stop()
  const t0 = Date.now(); let stopped = false
  const tick = async () => {
    if (stopped) return
    try {
      const v = await api.get('/auth/connectors')
      const done = (v.connectors || []).filter(c => ids.includes(c.id) && c.status === 'connected')
      if (done.length) { stop(); api.toast('Connected ' + done.map(c => c.name).join(', ')); after && after(v); return }
    } catch {}
    if (Date.now() - t0 > 5 * 60 * 1000) stop()
  }
  const iv = setInterval(tick, 3000); const onFocus = () => tick()
  const stop = () => { stopped = true; clearInterval(iv); window.removeEventListener('focus', onFocus); if (watching && watching.stop === stop) watching = null }
  window.addEventListener('focus', onFocus)
  watching = { stop }
}

export async function mount (el, api) {
  if (!el) return
  let view; let q = ''
  const draw = () => {
    el.innerHTML = panelHtml(view, q)
    const box = el.querySelector('[data-conn-q]')
    if (box) box.oninput = () => { q = box.value; const at = box.selectionStart; draw(); const b2 = el.querySelector('[data-conn-q]'); if (b2) { b2.focus(); try { b2.setSelectionRange(at, at) } catch {} } }
    el.querySelectorAll('[data-conn-on]').forEach(b => { b.onclick = () => connect(api, [b.dataset.connOn], v => { view = v; if (el.isConnected) draw() }) })
    el.querySelectorAll('[data-conn-off]').forEach(b => {
      b.onclick = async () => {
        const c = view.connectors.find(x => x.id === b.dataset.connOff)
        if (!window.confirm(`Disconnect ${c ? c.name : 'this service'}? VESPR forgets its access.`)) return
        try { await api.post('/auth/connectors/disconnect', { id: b.dataset.connOff }); api.toast('Disconnected ' + (c ? c.name : '')); await reload() } catch (e) { api.toast(e.message || 'Could not disconnect') }
      }
    })
  }
  const reload = async () => { view = await api.get('/auth/connectors'); if (el.isConnected) draw() }
  el.innerHTML = '<div style="font-size:12px;color:#71717a">Loading connectors…</div>'
  try { await reload() } catch (e) { el.innerHTML = `<div style="font-size:12px;color:#a1a1aa">${e.status === 401 ? 'Sign in to connect services.' : 'Could not load connectors (' + esc(e.message) + ').'}</div>` }
  const onFocus = () => { if (!el.isConnected) return window.removeEventListener('focus', onFocus); reload().catch(() => {}) }
  window.addEventListener('focus', onFocus)
}

export async function offer (api) {
  let v; try { v = await api.get('/auth/connectors') } catch { return }
  const s = v && v.suggest && v.suggest[0]; if (!s) return
  s.names = Object.fromEntries((v.connectors || []).map(c => [c.id, c.name]))
  const box = document.createElement('div'); box.id = 'connOffer'
  box.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9000;width:min(92vw,340px);background:#18181b;border:1px solid #3f3f46;border-radius:12px;padding:14px;box-shadow:0 10px 30px rgba(0,0,0,.5)'
  box.innerHTML = offerHtml(v.suggest)
  document.getElementById('connOffer')?.remove(); document.body.appendChild(box)
  box.querySelector('[data-offer-later]').onclick = async () => { box.remove(); try { await api.post('/auth/connectors/dismiss', { family: s.family }) } catch {} }
  box.querySelector('[data-offer-go]').onclick = () => {
    const ids = [...box.querySelectorAll('[data-offer-id]:checked')].map(x => x.dataset.offerId)
    if (!ids.length) { api.toast('Tick at least one, or press Not now'); return }
    box.remove(); connect(api, ids)
  }
}
