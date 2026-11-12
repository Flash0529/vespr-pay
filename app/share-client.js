// VESPR share client: share links, friends and "where do I land" for the app shell. No framework, no dependencies; fetch is injectable so Node tests run it without a network.
//
//   const sc = createShareClient({ server: 'https://host', token })      // token = the person's login token (not needed for opening a link)
//   await sc.createLink({ room, file?, role: 'view'|'edit', expiresInSec?, label? })   // -> { id, token, ... } the token is shown once; build the link with buildShareUrl
//   await sc.listLinks(room?)  sc.revokeLink(id)                                     // links you made (state: active | expired | revoked)
//   await sc.openLink(token)   -> { room, file, role, expiresAt, by }                // no login needed
//   await sc.readSharedFile(token) -> { room, file, text }                           // file links: read-only text
//   await sc.friends()  sc.requestFriend(h)  sc.acceptFriend(h)  sc.declineFriend(h)  sc.removeFriend(h)
//   await sc.shareProject(room, handle, role)  sc.unshareProject(room, handle)  sc.projects() -> { byMe, withMe }
//   landing({ hash, lastRoom, signedIn, home })  -> where the app should open (pure function, see below)
// Every failure is a ShareError with .code (the server's code, or 'network') and .status; friendlyMessage(code) gives the sentence to show.

export class ShareError extends Error { constructor (code, status) { super(code); this.name = 'ShareError'; this.code = code; this.status = status } }

const MESSAGES = {
  link_invalid: 'This link does not work. It may have expired, been turned off, or been copied wrong. Ask the person who sent it for a new one.',
  slow_down: 'Too many tries. Wait a few minutes and try again.',
  login_required: 'Sign in to do that.',
  agents_cannot_share: 'Agents cannot create share links.',
  edit_needs_room: 'A single file can be shared as view only. To let someone edit, share the whole project.',
  bad_expiry: 'Pick an expiry between 1 minute and 1 year, or none.',
  too_many_links: 'You have 100 active links. Turn some off first.',
  no_such_link: 'That link is already gone.',
  not_a_file_link: 'This link is for a whole project, not one file.',
  file_not_found: 'That file is not in the project right now.',
  bad_handle: 'Handles use letters, numbers, dots, dashes and underscores (2 to 32 characters).',
  self: 'That is you.',
  already_friends: 'You are already friends.',
  no_request: 'That request is no longer there.',
  no_such_friend: 'That person is not on your list.',
  not_friends: 'You can only share a project with a friend. Send a friend request first.',
  too_many_friends: 'Your friends list is full.',
  too_many_requests: 'You have 20 requests waiting. Wait for answers or cancel some.',
  too_many_shares: 'You have shared as many projects as allowed.',
  no_handle: 'Pick a handle for your account first (an email address cannot be used as one).',
  no_friends_for_this_identity: 'Guests and agents do not have friends.',
  not_shared: 'That project is not shared with this person.',
  network: 'Cannot reach the server. Check your connection.'
}
export const friendlyMessage = code => MESSAGES[code] || 'Something went wrong. Try again.'

// ── links: the token lives in the #fragment, which browsers never send to any server and never put in a Referer header
export const buildShareUrl = (appBase, token) => String(appBase).replace(/#.*$/, '') + '#share=' + token
export function parseShareUrl (href) {
  const m = /[#&]share=([A-Za-z0-9_-]{43})(?:&|$)/.exec(String(href).slice(String(href).indexOf('#') < 0 ? String(href).length : String(href).indexOf('#')))
  return m ? m[1] : null
}
// What to put in history.replaceState after you have read the token: the same page with no fragment, so it is not left in the address bar, history entry or a screenshot.
export const scrubbedUrl = href => String(href).replace(/#.*$/, '')
export const wsUrlForShare = (server, room, token) => String(server).replace(/^http/, 'ws').replace(/\/$/, '') + '/ws/' + encodeURIComponent(room) + '?token=' + encodeURIComponent(token)
export const linkState = (link, now = Date.now()) => (link.revokedAt ? 'revoked' : link.expiresAt && now >= link.expiresAt ? 'expired' : 'active')
export const roleLabel = role => (role === 'edit' ? 'Can edit' : 'Can view')
export function expiryLabel (expiresAt, now = Date.now()) {
  if (!expiresAt) return 'Never expires'
  const s = Math.round((expiresAt - now) / 1000)
  if (s <= 0) return 'Expired'
  if (s < 3600) return 'Expires in ' + Math.max(1, Math.round(s / 60)) + ' min'
  if (s < 172800) return 'Expires in ' + Math.round(s / 3600) + ' h'
  return 'Expires in ' + Math.round(s / 86400) + ' days'
}

// ── landing: where the app opens. Order matters: a link in the address wins over everything (the person came for it), then the last project, then home.
//   hash       location.hash;  lastRoom  the room remembered from last time;  signedIn  bool;  home  the result of sc.friends() when signed in (or null)
//   -> { kind: 'share', token }                    redeem the link first (open it as a guest if not signed in)
//      { kind: 'signin', then?: {kind,...} }       show sign-in; "then" is where to go afterwards
//      { kind: 'room', room }                      open that project
//      { kind: 'home', attention }                 the home screen; attention = number of friend requests waiting
export function landing ({ hash = '', lastRoom = null, signedIn = false, home = null } = {}) {
  const token = parseShareUrl(hash || '')
  if (token) return { kind: 'share', token }
  if (!signedIn) return { kind: 'signin', then: lastRoom ? { kind: 'room', room: lastRoom } : { kind: 'home', attention: 0 } }
  if (lastRoom) return { kind: 'room', room: lastRoom }
  return { kind: 'home', attention: home?.incoming?.length || 0 }
}

export function createShareClient ({ server, token = null, fetchImpl = globalThis.fetch }) {
  if (!server) throw new Error('createShareClient needs a server address')
  const base = String(server).replace(/\/$/, '')
  async function call (method, route, body, auth = true) {
    let res
    try {
      res = await fetchImpl(base + route, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth && token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        referrerPolicy: 'no-referrer',
        cache: 'no-store'
      })
    } catch { throw new ShareError('network', 0) }
    let json = null; try { json = await res.json() } catch {}
    if (!res.ok) throw new ShareError((json && json.error) || 'server', res.status)
    return json
  }
  return {
    createLink: opts => call('POST', '/api/share/create', opts),
    listLinks: async room => (await call('GET', '/api/share/list' + (room ? '?room=' + encodeURIComponent(room) : ''))).links,
    revokeLink: id => call('POST', '/api/share/revoke', { id }),
    openLink: t => call('POST', '/api/share/resolve', { token: t }, false),
    readSharedFile: t => call('POST', '/api/share/file', { token: t }, false),
    friends: () => call('GET', '/api/friends'),
    requestFriend: to => call('POST', '/api/friends/request', { to }),
    acceptFriend: from => call('POST', '/api/friends/accept', { from }),
    declineFriend: from => call('POST', '/api/friends/decline', { from }),
    removeFriend: who => call('POST', '/api/friends/remove', { who }),
    shareProject: (room, handle, role) => call('POST', '/api/friends/share', { room, with: handle, role }),
    unshareProject: (room, handle) => call('POST', '/api/friends/unshare', { room, with: handle }),
    projects: () => call('GET', '/api/friends/projects')
  }
}
