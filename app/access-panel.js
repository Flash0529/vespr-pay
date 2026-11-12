// The "Who has access" panel in the Share dialog: what to show for a workspace's access list (server/access.js) and what a new grant
// may be. Pure ES module, no DOM or network: the app fetches the list, draws accessHtml, and sends grants.
export const RIGHTS = ['make', 'view', 'edit', 'delete', 'manage']
export const RIGHT_LABEL = { make: 'Make', view: 'View', edit: 'Edit', delete: 'Delete', manage: 'Manage' }
export const RIGHT_HELP = { make: 'create files', view: 'open the workspace', edit: 'change files', delete: 'remove files', manage: 'change who has access there' }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase() && String(a ?? '').trim() !== ''
const live = (g, t) => !(g && g.until && g.until <= t)
const covers = (g, p) => g === '' || p === g || p.startsWith(String(g).endsWith('/') ? g : g + '/')
export const whoLabel = who => who === '*' ? 'Everyone signed in' : String(who ?? '')
export const pathLabel = p => !p ? 'Whole workspace' : String(p)
// "until 7:14 PM" (today) or "until Nov 5, 7:14 PM"
export function untilLabel (until, now = Date.now()) {
  if (!until) return ''
  const d = new Date(until); const n = new Date(now)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return 'until ' + (d.toDateString() === n.toDateString() ? time : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' + time)
}

// what the panel shows, from GET /api/access/<room> and the signed-in name
export function accessView (data, me, now = Date.now()) {
  const d = data && typeof data === 'object' ? data : {}
  const locked = d.locked === true
  const isOwner = locked && same(d.owner, me)
  const rows = (Array.isArray(d.grants) ? d.grants : [])
    .filter(g => g && typeof g.who === 'string' && typeof g.path === 'string' && Array.isArray(g.rights) && live(g, now))
    .map(g => {
      const rights = Object.fromEntries(RIGHTS.map(r => [r, g.rights.includes(r)]))
      const until = Number(g.until) || 0
      // the owner changes any row; a manager changes rows inside the place they manage, never a manager's row; a row that ends is only removed
      const managed = isOwner || (!rights.manage && canDo(d, me, 'manage', g.path, now))
      return { who: g.who, path: g.path, whoLabel: whoLabel(g.who), where: pathLabel(g.path), rights, until, untilText: untilLabel(until, now), editable: managed && !until, removable: managed }
    })
    .sort((a, b) => (a.who === '*') - (b.who === '*') || a.who.localeCompare(b.who) || a.path.localeCompare(b.path) || a.until - b.until)
  const mine = RIGHTS.filter(r => Array.isArray(d.mine) && d.mine.includes(r))
  const manages = isOwner || (locked && (Array.isArray(d.grants) ? d.grants : []).some(g => g && live(g, now) && Array.isArray(g.rights) && g.rights.includes('manage') && (g.who === '*' || same(g.who, me))))
  return { locked, owner: locked ? String(d.owner || '') : '', isOwner, manages, rows, mine, waiting: Number(d.waiting) || 0 }
}

// a new grant from the add form: who (a name or "*"), where ("" = whole workspace), which rights
export function validateGrant ({ who, path, rights } = {}) {
  const w = String(who ?? '').trim()
  if (!w) return { ok: false, reason: 'Type the name of the person or agent' }
  if (w.length > 60) return { ok: false, reason: 'That name is too long' }
  const p = String(path ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (p.length > 300 || /[\u0000-\u001f]/.test(p) || p.split('/').some(s => s === '..' || s === '.')) return { ok: false, reason: 'Pick a place inside the workspace' }
  const rs = RIGHTS.filter(r => Array.isArray(rights) && rights.includes(r))
  if (!rs.length) return { ok: false, reason: 'Tick at least one of make, view, edit, delete or manage' }
  if (rs.includes('manage') && w === '*') return { ok: false, reason: 'Manage goes to a named person, not everyone' }
  return { ok: true, grant: { who: w, path: p, rights: rs } }
}

// the rights a row ends up with when one box is toggled: null means "remove the grant" (nothing left)
export function toggled (row, right) {
  if (!row || !RIGHTS.includes(right)) return null
  const next = RIGHTS.filter(r => (r === right ? !row.rights[r] : row.rights[r]))
  return next.length ? next : null
}

// May this person answer this request (server/access.js mayAnswer)? Locked, not their own, and the owner or a manager of that place.
export function answerable (data, me, req, now = Date.now()) {
  const d = data && typeof data === 'object' ? data : null
  if (!d || d.locked !== true || !req || same(req.who, me)) return false
  return canDo(d, me, 'manage', String(req.path ?? ''), now)
}

const reqLine = (q, can, now) => {
  const where = pathLabel(q.path)
  const head = `<b>${esc(whoLabel(q.who))}</b>${q.agent ? ' <small>agent</small>' : ''} asks for <b>${esc((q.rights || []).join(', '))}</b> on <b>${esc(where)}</b>`
  const why = q.reason ? `<p class="acc-why">“${esc(q.reason)}”</p>` : ''
  const act = can
    ? `<div class="acc-ans"><button class="btn pri" data-acc-answer="${esc(q.id)}" data-for="1h">Allow for 1 hour</button><button class="btn" data-acc-answer="${esc(q.id)}" data-for="always">Always</button><button class="btn" data-acc-answer="${esc(q.id)}" data-no="1">Deny</button></div>`
    : `<p class="acc-why">${q.status === 'pending' ? 'Waiting for an answer' : esc(q.status)}</p>`
  return `<div class="acc-req">${head}${why}${act}</div>`
}

// the panel's inner HTML. folders: workspace folders for the "where" picker (each ends with "/"); requests: from GET .../requests
export function accessHtml (view, { folders = [], busy = false, requests = [], me = '', data = null, now = Date.now() } = {}) {
  const v = view || accessView(null, '')
  const dis = busy ? ' disabled' : ''
  if (!v.locked) {
    return '<p class="fsub">This workspace is <b>open</b>: anyone signed in can make, view, edit and delete here, and agents can too. ' +
      'Lock it to choose who can do what. You become its owner and can change it any time.</p>' +
      `<div class="fact"><button class="btn" data-sh-close>Close</button><button class="btn pri" data-acc-lock${dis}>Lock this workspace</button></div>`
  }
  const head = `<div class="acc-row acc-head" aria-hidden="true"><span>Who</span><span>Where</span>${RIGHTS.map(r => `<span title="${RIGHT_HELP[r]}">${RIGHT_LABEL[r]}</span>`).join('')}<span></span></div>`
  const ownerRow = `<div class="acc-row"><span class="acc-who"><b>${esc(v.owner)}</b><small>owner</small></span><span>Whole workspace</span>${RIGHTS.map(() => '<span class="acc-cell"><span class="acc-on" aria-label="yes">✓</span></span>').join('')}<span></span></div>`
  const rows = v.rows.map(row => `<div class="acc-row"><span class="acc-who">${esc(row.whoLabel)}${row.untilText ? `<small>${esc(row.untilText)}</small>` : ''}</span><span class="acc-where">${esc(row.where)}</span>` +
    RIGHTS.map(r => {
      const can = row.editable && (r !== 'manage' || (v.isOwner && row.who !== '*'))
      return can
        ? `<span class="acc-cell"><input type="checkbox" data-acc-toggle="${r}" data-acc-who="${esc(row.who)}" data-acc-path="${esc(row.path)}" aria-label="${RIGHT_LABEL[r]} for ${esc(row.whoLabel)} on ${esc(row.where)}"${row.rights[r] ? ' checked' : ''}${dis}></span>`
        : `<span class="acc-cell">${row.rights[r] ? '<span class="acc-on" aria-label="yes">✓</span>' : '<span class="acc-off" aria-label="no">–</span>'}</span>`
    }).join('') +
    (row.removable ? `<span><button class="ib acc-x" data-acc-revoke data-acc-who="${esc(row.who)}" data-acc-path="${esc(row.path)}" aria-label="Remove ${esc(row.whoLabel)} from ${esc(row.where)}" title="Removes all of ${esc(row.whoLabel)}’s rights on ${esc(row.where)}"${dis}>×</button></span>` : '<span></span>') + '</div>').join('')
  const list = `<div class="acc-list" role="table" aria-label="Who has access">${head}${ownerRow}${rows}</div>`
  const reqs = (Array.isArray(requests) ? requests : []).filter(q => q && q.status === 'pending')
  const waiting = reqs.length ? `<div class="acc-add"><h3 class="sh-h">Waiting for an answer</h3>${reqs.map(q => reqLine(q, answerable(data, me, q, now), now)).join('')}</div>` : ''
  if (!v.manages) {
    return `<p class="fsub">Only <b>${esc(v.owner)}</b> and the people they make managers can change who has access. You can: ${v.mine.length ? v.mine.map(r => RIGHT_LABEL[r].toLowerCase()).join(', ') : 'nothing on the whole workspace (your rights are on specific folders below)'}.</p>${list}${waiting}` +
      '<div class="fact"><button class="btn" data-sh-close>Close</button></div>'
  }
  const where = ['<option value="">Whole workspace</option>', ...[...new Set(folders.filter(f => typeof f === 'string' && f))].sort().map(f => `<option value="${esc(f)}">${esc(f)}</option>`)].join('')
  const addRights = v.isOwner ? RIGHTS : RIGHTS.filter(r => r !== 'manage')
  const add = '<div class="acc-add"><h3 class="sh-h">Add someone</h3>' +
    '<div class="acc-addrow"><input id="accWho" maxlength="60" autocomplete="off" placeholder="Name, an agent such as coder, or * for everyone" aria-label="Who">' +
    `<select id="accWhere" aria-label="Where">${where}</select></div>` +
    `<div class="acc-addrow acc-rights">${addRights.map(r => `<label><input type="checkbox" data-acc-new="${r}"${r === 'view' || r === 'edit' ? ' checked' : ''}> ${RIGHT_LABEL[r]} <small>${RIGHT_HELP[r]}</small></label>`).join('')}</div>` +
    '<p class="acc-err" id="accErr" role="alert" hidden></p></div>'
  const note = v.isOwner ? 'The server checks every change against this list. Agents need a line here too, and can ask for more in chat.' : `You manage part of this workspace: you can give the rights you hold there, not manage. <b>${esc(v.owner)}</b> owns it.`
  return `<p class="fsub">${note}</p>` + list + waiting + add +
    `<div class="fact">${v.isOwner ? `<button class="btn" data-acc-unlock${dis}>Open it again</button>` : ''}<button class="btn" data-sh-close>Close</button><button class="btn pri" data-acc-add${dis}>Add</button></div>`
}

// May this person do this here? The same rule the server applies (server/access.js rightsFor), so the app can stop a change before
// sending it: an open workspace (or no list loaded yet) allows everything, the owner may do anything, otherwise the grants that have not
// ended add up by path ("" = everywhere, "src/" or "src" = that folder, "src/a.py" = that file; never a look-alike such as "srcx/").
export function canDo (data, me, right, path = '', t = Date.now()) {
  const d = data && typeof data === 'object' ? data : null
  if (!d || d.locked !== true) return true
  if (same(d.owner, me)) return true
  const p = String(path ?? '')
  return (Array.isArray(d.grants) ? d.grants : []).some(g => g && Array.isArray(g.rights) && g.rights.includes(right) && live(g, t) &&
    (g.who === '*' || same(g.who, me)) && covers(String(g.path ?? ''), p))
}
