// Navigation Model & Look and Feel Verification Suite
// Tests the team's 8-item Home Bar sequence, Pinned Workspaces/Chats empty-state hiding,
// Two-level navigation (Home Bar vs Workspace Bar with '‹ All workspaces' way out),
// Esc / Ctrl+Shift+H keybinding hooks, 8-hue palette assignment,
// Dashboard slot, and compact agent activity strip when chat pane is hidden.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const protoSource = readFileSync(new URL('../prototype.html', import.meta.url), 'utf8')
const cssSource = readFileSync(new URL('../presentation.css', import.meta.url), 'utf8')
const frostSource = readFileSync(new URL('../frost.css', import.meta.url), 'utf8')

test('Sidebar look and feel has Windows 11 Mica backdrop rule with blur and saturation', () => {
  assert.match(cssSource, /html\[data-backdrop=mica\] #app \.sidebar/)
  assert.match(cssSource, /backdrop-filter:\s*blur\(28px\)\s*saturate\(125%\)/)
})

test('Chat pane has ambient soft glow pseudo-element', () => {
  assert.match(cssSource, /#app \.chat::before/)
  assert.match(cssSource, /radial-gradient\(ellipse 70% 90px at 50% 0%/)
})

test('Agent palette assigns neutral grey to orchestrator and 8 distinct hues to sub-agents', () => {
  assert.match(protoSource, /ORCHESTRATOR_HUE\s*=\s*'#9ca3af'/)
  assert.match(protoSource, /HUE_8\s*=\s*\[/)
  const hueMatch = protoSource.match(/HUE_8\s*=\s*\[(.*?)\]/s)
  assert.ok(hueMatch, 'HUE_8 array must exist')
  const hues = hueMatch[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean)
  assert.equal(hues.length, 8, 'HUE_8 array must contain exactly 8 distinct hues')
})

test('Home bar: one primary action, a small create menu, foldable sections ordered by mode, honest empty states', () => {
  assert.match(protoSource, /newBtn\('create-chat', 'plus', 'New chat'/, 'New chat is the one primary action')
  assert.match(protoSource, /newBtn\('create-workspace'/, 'New workspace stays, inside the create menu')
  assert.match(protoSource, /dmReal \? newBtn\('create-dm'/, 'New message only exists when direct messages are really switched on (no button that only says "not switched on")')
  assert.match(protoSource, /data-home-act="\$\{act\}"/, 'actions keep the data-home-act hook the click handler reads')
  assert.match(protoSource, /class="sb-new-more" data-sb-newmenu="1" aria-haspopup="menu" aria-expanded=/, 'the menu button says it opens a menu and whether it is open')
  assert.match(protoSource, /class="sb-new-menu" role="menu"/)
  assert.match(protoSource, /e\.key === 'Escape' && state\.sbNewMenu/, 'Esc closes the create menu and gives focus back')
  assert.match(protoSource, /pinned-ws-label/, 'Pinned section class must exist')
  assert.match(protoSource, /pinned-chat-label/, 'Pinned chats section class must exist')
  const tpl = protoSource.slice(protoSource.indexOf("$('#nav').innerHTML = `\n    <div class=\"sb-new sb-primary\""))
  const at = k => tpl.indexOf(k)
  const order = ['class="sb-new sb-primary"', 'class="sb-new-menu"', '${pinnedWsHtml}', '${pinnedChatsHtml}', '${orderedSecs}']
  order.forEach((k, i) => { assert.ok(at(k) > 0, k + ' must be in the home template'); if (i) assert.ok(at(k) > at(order[i - 1]), k + ' must follow ' + order[i - 1]) })
  assert.match(protoSource, /codeMode \? \['ws', 'chats', 'msgs', 'agents'\] : \['chats', 'ws', 'msgs', 'agents'\]/, 'the section for the current mode comes first')
  assert.match(protoSource, /data-sb-fold="\$\{key\}" aria-expanded=/, 'every section header folds, and says whether it is open')
  assert.match(protoSource, /class="sb-empty">A workspace is a folder/, 'an empty Workspaces section explains itself and offers to start one')
  // only a few of each, expandable in place
  assert.match(protoSource, /LIM = \{ agents: 4, chats: 5, msgs: 3, ws: 4 \}/)
  assert.match(protoSource, /data-sb-more/)
  assert.doesNotMatch(protoSource, /class="sidebar-extra"/)
  assert.doesNotMatch(protoSource, /id="sidebarCustomizeBtn"/)
  // flat rows (the team, 2026-11-10: no button look): the new actions have no fill, hover is the lighter shade
  assert.match(frostSource, /\.sb-primary \.sb-new-btn \{ border:0 !important; box-shadow:none !important;[^}]*background:transparent !important/)
})

test('Workspace bar shows History, Payments, Share and Skills as rows (they were only in the Tools menu)', () => {
  for (const [id, proxy] of [['sb-history', 'histBtn'], ['sb-payments', 'payLedgerBtn'], ['sb-share', 'shareBtn']]) {
    assert.match(protoSource, new RegExp('data-sb-proxy="' + proxy + '" data-testid="' + id + '"'), id + ' presses the real ' + proxy)
  }
  assert.match(protoSource, /if \(t\.closest\('\[data-sb-proxy\]'\)\)/, 'one handler forwards the row to the existing button, so behavior stays in one place')
  assert.match(protoSource, /class="sbs sb-room" aria-label="This workspace"/)
})

test('Workspace Bar renders back row with "‹ All workspaces" and Esc hook', () => {
  assert.match(protoSource, /class="row back-to-home-btn" data-home-act="exit-workspace"/)
  assert.match(protoSource, /All workspaces/)
  assert.match(protoSource, /function enterWorkspace\(/)
  assert.match(protoSource, /function exitWorkspace\(/)
})

test('Esc key listener handles exitWorkspace when no modal is open', () => {
  assert.match(protoSource, /if \(e\.key === 'Escape'\)/)
  assert.match(protoSource, /exitWorkspace\(\)/)
  assert.match(protoSource, /e\.key\.toLowerCase\(\) === 'h'\) {\s*e\.preventDefault\(\);\s*exitWorkspace\(\)/)
})

test('Dashboard slot card is rendered at the bottom of the sidebar above user footer', () => {
  assert.match(protoSource, /id="dashboardSlot"/)
  assert.match(protoSource, /function renderDashboardSlot\(\)/)
  assert.match(cssSource, /\.dashboard-slot/)
})

test('Compact one-line agent activity strip exists when chat is hidden in Code mode', () => {
  assert.match(protoSource, /id="sidebarAgentStrip"/)
  assert.match(protoSource, /function renderAgentStrip\(\)/)
  assert.match(cssSource, /\.sidebar-agent-strip/)
})


test('Hosting & Cloud Dashboard section exists with header controls and guardrail notice', () => {
  assert.match(protoSource, /id="hostingPage"/)
  assert.match(protoSource, /class="hosting-header"/)
  assert.match(protoSource, /class="hosting-guardrail-notice"/)
  // the notice says plainly that nothing is connected; it no longer claims isolation, quotas or email checks that do not run
  assert.match(protoSource, /no hosting service is connected to this server\. Isolation, quotas and email checks are not running here\./)
  assert.doesNotMatch(protoSource, /eBPF egress filtering active|Staging VM Active|Verified Healthy|d10bebb/)
  assert.match(protoSource, /id="hostingGlobalStatusBadge" style="font-size:10px">Preview: not connected</)
  for (const fn of ['promptAddCustomDomain', 'promptNewMailbox', 'promptAddSecret', 'promptAddContainer', 'promptConnectDashboard']) {
    const body = protoSource.slice(protoSource.indexOf('function ' + fn + '('), protoSource.indexOf('\n}\n', protoSource.indexOf('function ' + fn + '(')))
    assert.doesNotMatch(body, /prompt\(|Configured|Created mailbox|saved encrypted|Started container|Connected external/, fn + ' claims nothing it did not do')
  }
  assert.match(cssSource, /\.hosting-page/)
  assert.match(cssSource, /\.hosting-grid-4/)
  assert.match(cssSource, /\.hosting-terminal/)
})

test('Hosting tab button is dynamically rendered in topbar mode selector when hosting is active', () => {
  assert.match(protoSource, /function renderHostingTab\(\)/)
  assert.match(protoSource, /hostingTabBtn/)
  assert.match(protoSource, /function openHostingDashboard\(\)/)
  assert.match(protoSource, /function closeHostingDashboard\(\)/)
  assert.match(cssSource, /\.hosting-tab-btn/)
})

test('Clicking dashboard slot connects to openHostingDashboard', () => {
  assert.match(protoSource, /slot\.onclick\s*=\s*\(\)\s*=>\s*\{\s*openHostingDashboard\(\);?\s*\}/)
})

test('Hosting dashboard switches between Agentic 4-card overview and Manual Developer infrastructure', () => {
  assert.match(protoSource, /function setHostingViewMode\(/)
  assert.match(protoSource, /card_sites/)
  assert.match(protoSource, /card_domains/)
  assert.match(protoSource, /card_email/)
  assert.match(protoSource, /card_usage/)
  assert.match(protoSource, /card_vms/)
  assert.match(protoSource, /card_containers/)
  assert.match(protoSource, /card_logs/)
  assert.match(protoSource, /function deployWorkspaceAction\(\)/)
})

test('Hosting sidebar renders dedicated navigation sections when activeView is hosting', () => {
  assert.match(protoSource, /if \(state\.activeView === 'hosting'\)/)
  assert.match(protoSource, /data-hosting-section=/)
  assert.match(protoSource, /id: 'sites'/)
  assert.match(protoSource, /id: 'vms'/)
  assert.match(protoSource, /Back to SDE/)
})


test('Dynamic bar slot is reserved in sidebar with 4:3 aspect ratio and hidden when empty', () => {
  assert.match(protoSource, /id="dynamicBarSlot"/)
  assert.match(protoSource, /function renderDynamicBar\(\)/)
  assert.match(cssSource, /\.dynamic-bar-slot/)
  assert.match(cssSource, /aspect-ratio:\s*4\s*\/\s*3/)
  assert.match(cssSource, /\.dynamic-bar-slot\[hidden\]/)
})

test('Click learning engine enforces privacy rules, UI-only telemetry, and minor opt-out', () => {
  assert.match(protoSource, /function recordUIInteraction\(/)
  assert.match(protoSource, /function evaluateInteractionMiss\(/)
  assert.match(protoSource, /state\.analyticsOptOut/)
  assert.match(protoSource, /role === 'student'/)
  assert.match(protoSource, /dismissDynamicBar\(\)/)
  assert.match(protoSource, /setDynamicBarSuggestion\(/)
})


test('Group chat deduplication: the server returns the same conversation for the same people, and the app opens Messages', () => {
  // 2026-11-10: conversations are server rooms now (server/dm.js, tested in server/test/dm.test.js: "same people, same conversation"); the old in-memory name matching is gone
  assert.match(protoSource, /function openMessages/)
  assert.match(protoSource, /\/api\/dm\/open/)
  assert.doesNotMatch(protoSource, /Switched to existing conversation with/)
})

test('/vespr slash command triggers assistant bot directly in conversation thread', () => {
  assert.match(protoSource, /v\.startsWith\('\/vespr'\)/)
  assert.match(protoSource, /who: 'VESPR Bot'/)
  assert.match(protoSource, /VESPR Bot replied in thread/)
})

test('Unified command palette provides domain filter tabs for all, agentic, history, and images', () => {
  assert.match(protoSource, /id="palFilterRow"/)
  assert.match(protoSource, /data-pal-filter="all"/)
  assert.match(protoSource, /data-pal-filter="agentic"/)
  assert.match(protoSource, /data-pal-filter="history"/)
  assert.match(protoSource, /data-pal-filter="image"/)
  assert.match(cssSource, /\.pal-filter-row/)
  assert.match(cssSource, /\.pal-filter-tab/)
})

test('Sidebar rows are flat one-liners: no border or ring, lighter shade on hover, description in the tooltip', () => {
  assert.match(protoSource, /const sbRow = /)
  assert.match(protoSource, /title="\$\{esc\(tip\)\}"/, 'each row carries its description as a tooltip')
  assert.match(frostSource, /\.sb-row \{[^}]*height:26px/, 'rows are one small line')
  assert.match(frostSource, /\.sb-row:hover[^{]*\{[^}]*background:var\(--sb-hover\)/)
  assert.match(frostSource, /\.sb-row\[aria-current=true\] \{[^}]*background:var\(--sb-sel\)/)
  assert.match(frostSource, /\.sb-row \{[^}]*border:0/, 'no border on a row')
  assert.match(frostSource, /\.sb-row, \.sb-new-btn, \.sb-more[^{]*:focus-visible \{ outline:2px solid/, 'keyboard focus is a real outline')
  assert.match(protoSource, /<section class="sbs" data-sec="chats" aria-label="Chats">/, 'sections are labelled for screen readers')
  assert.match(frostSource, /--bar-r:14px/, 'floating top bar is less round than the old pill')
  assert.match(frostSource, /\.m\.me \{ justify-content:flex-start/, 'messages I send are bound left')
  assert.match(frostSource, /#in \{ text-align:var\(--compose-align\)/, 'the box I type into is right-bound (one variable flips it)')
})

test('Live editor incorporates predictive code completion and ghost text inline suggestions', () => {
  assert.match(protoSource, /getGhostPrediction/)
  assert.match(protoSource, /state\._ghostSuggestion/)
  assert.match(protoSource, /⚡ Tab to complete/)
  assert.match(protoSource, /Accepted completion/)
  assert.match(cssSource, /\.syntax-ghost/)
})

test('Settings modal includes Chat & Friends, Hosting, and Dev Tool Ads governance panels', () => {
  assert.match(protoSource, /data-cset-tab="chat_friends"/)
  assert.match(protoSource, /data-cset-tab="hosting"/)
  assert.match(protoSource, /data-cset-tab="ad_rules"/)
  assert.match(protoSource, /Corporate workspace federation/)
  // 2026-11-10: the invented hosting rows (containers, email lock, quota) and the unproven ad/telemetry claims are gone on purpose
  assert.doesNotMatch(protoSource, /Outbound email anti-abuse lock|vespr-collab \(:8241\)|Corporate Free Tier rules/)
  assert.match(protoSource, /Navigation learning/)
})

test('Model Provider Layer is wired into live editor, agent dispatch, and settings', () => {
  assert.match(protoSource, /import\('\.\/model-providers\.js'\)/)
  assert.match(protoSource, /createModelRegistry/)
  assert.match(protoSource, /id="csetActiveModelSelect"/)
  assert.match(protoSource, /Flint 40B \(Preview \/ Unwired\)/)
  assert.match(protoSource, /Ollama Coder 32B \(Preview \/ Unwired\)/)
  assert.match(protoSource, /Moonshot Kimi K3 \(Preview \/ Unwired\)/)
  assert.match(protoSource, /Nemotron 3 Super \(Active Server Model\)/)
  assert.match(protoSource, /id="csetSandboxFallback"/)
  assert.match(protoSource, /resolveTarget\(window\.modelRegistry\.getActiveModel\(\)\.id,\s*state\.isSandboxed\s*!==\s*false\)/)
  assert.match(protoSource, /Sandbox safety:/)
})

test('a teammate Mac Blueprint parity: Thin usage bar and guided highlights', () => {
  assert.match(protoSource, /id="chatUsageStrip"/)
  assert.match(protoSource, /id="chatUsageTxt"/)
  assert.match(protoSource, /id="chatUsageFill"/)
  assert.match(protoSource, /function renderUsageStrip\(\)/)
  assert.match(protoSource, /function triggerGuidedHighlight\(/)
  assert.match(protoSource, /window\.triggerGuidedHighlight\s*=/)
  assert.match(cssSource, /\.chat-usage-strip/)
  assert.match(cssSource, /\.usage-track/)
  assert.match(cssSource, /height:\s*3px/)
  assert.match(cssSource, /\.guide-pulsing-ring/)
  assert.match(cssSource, /@keyframes guidePulse/)
})

test('Zero mock and privacy compliance: no private IPs or fabricated VM or test claims in client source', () => {
  assert.ok(!protoSource.includes('100.64.0.10'), 'prototype.html must not contain private homelab IP')
  assert.ok(!protoSource.includes('41 unit tests'), 'prototype.html must not contain fake canned unit test counts')
  assert.ok(!protoSource.includes('vm-nebius-staging-01'), 'prototype.html must not contain fake staging VM strings')
  const devSource = readFileSync(new URL('../account-devices.js', import.meta.url), 'utf8')
  assert.ok(!devSource.includes('100.64.0.10'), 'account-devices.js must not contain private homelab IP')
})

test('the Chat start screen promotes nothing unless there is a real sponsored item (no "Explore paid plans" while paid plans are not open)', () => {
  assert.match(protoSource, /adEligible:\(\)=>\{const m=ACC_FLAVORS&&state\.currentAccount&&ACC_FLAVORS\.getAccountMonetization\(state\.currentAccount\);return !!\(m&&m\.showAds&&m\.sponsoredAd\)\}/)
})

test('Settings > Organization directory shows nothing as connected (no made-up GitHub org, SCIM feed or sample audit events)', () => {
  for (const fake of ['apex-systems-cloud', 'LIVE INGESTION ACTIVE', 'CONNECTED · 5 MEMBERS', 'Successfully synchronized', 'syncEnterpriseGitHub', "import('./enterprise-sync.js')"]) assert.ok(!protoSource.includes(fake), 'no ' + fake)
  assert.match(protoSource, /Nothing is connected today\./)
})

test('Settings > Roles says it is a preview and does not call keyword rules an AI', () => {
  assert.ok(!protoSource.includes('AI Smart Role Synthesizer') && !protoSource.includes('Synthesized &amp; Activated') && !protoSource.includes('Created AI Role'))
  assert.match(protoSource, /Preview: nothing enforces these yet/)
  assert.match(protoSource, /This is not an AI, and the draft is only shown here/)
})

test('Chat & Friends, Hosting and Promotions: no made-up "Integration Active" card, no Save that saves nothing, no switch that toasts a result it did not produce', () => {
  assert.doesNotMatch(protoSource, /Integration Active|Managed according to VESPR workspace policy/)
  assert.doesNotMatch(protoSource, /toast\('Settings saved'\)/)
  assert.doesNotMatch(protoSource, /Group deduplication rule updated|VESPR bot command enabled|Workspace federation active/)
  // the four Chat & Friends controls nothing reads are disabled, unchecked, and named for screen readers
  const cf = protoSource.slice(protoSource.indexOf("if (activeCsetTab === 'chat_friends')"), protoSource.indexOf("if (activeCsetTab === 'hosting')"))
  assert.equal((cf.match(/type="checkbox" disabled aria-label="[^"]+\(not active yet\)"/g) || []).length, 3)
  assert.equal((cf.match(/<button type="button" disabled>/g) || []).length, 3)
  assert.doesNotMatch(cf, /type="checkbox" checked|class="active"/)
  // the catch-all no longer prints a card for the three tabs that draw their own page
  assert.match(protoSource, /\['chat_friends', 'hosting', 'ad_rules'\]\.includes\(activeCsetTab\)/)
  assert.match(frostSource, /\.cset-toggle input:disabled \+ \.cset-slider/)
})

test('Promotions page does not promise a VESPR promotion the Chat screen no longer shows', () => {
  const copy = readFileSync(new URL('../settings-copy.js', import.meta.url), 'utf8')
  assert.doesNotMatch(protoSource + copy, /small VESPR promotion/)
  assert.match(copy, /'Promotions': \{ live: true, text: 'A sponsored item appears on the Chat home screen only when your account has one/)
})

test('Account and Shortcuts: no invented devices, organization id or macro buttons; devices come from the server', () => {
  assert.doesNotMatch(protoSource, /Smyrna|Atlanta, Georgia|b7b8fed3|Log out of all devices|logoutAllOtherDevices/)
  assert.doesNotMatch(protoSource, /New macro recorder ready|Running macro:|Run Macro/)
  // the Organization ID row appears only for an account that has one
  assert.match(protoSource, /state\.account && state\.account\.orgId \? `<div class="cset-sec">/)
  // the list is the server's (GET /auth/devices) and each other device gets a real sign-out (POST /auth/devices/revoke)
  const fn = protoSource.slice(protoSource.indexOf('async function loadDevicesBox'), protoSource.indexOf('async function loadOrgPolicyBox'))
  assert.match(fn, /fetch\('\/auth\/devices', \{ headers: \{ Authorization: 'Bearer ' \+ t \}/)
  assert.match(fn, /fetch\('\/auth\/devices\/revoke', \{ method: 'POST'/)
  assert.match(fn, /d\.current \? '' : `<button/, 'the current device has no sign-out button')
  assert.match(protoSource, /if \(activeCsetTab === 'account'\) loadDevicesBox\(\)/)
})

test('Settings menu: flat groups, access and permissions has its own group, every tab is still reachable', () => {
  const nav = protoSource.slice(protoSource.indexOf('<aside class="cset-sidebar">'), protoSource.indexOf('</aside>', protoSource.indexOf('<aside class="cset-sidebar">')))
  assert.doesNotMatch(nav, /<details|settings-group|qd-sep/, 'no collapsible sub-menus in the menu')
  const tabsIn = h => { const from = nav.indexOf('>' + h + '<'); const to = nav.indexOf('\n      </div>', from); return [...nav.slice(from, to).matchAll(/data-cset-tab="(\w+)"/g)].map(m => m[1]) }
  assert.deepEqual(tabsIn('Access &amp; permissions'), ['privacy', 'capabilities', 'chat_files', 'roles', 'enterprise_sync'])
  assert.deepEqual(tabsIn('Developer'), ['code', 'connectors', 'cowork', 'hosting', 'apikeys'])
  assert.ok(!tabsIn('Developer').includes('roles') && !tabsIn('Developer').includes('enterprise_sync'), 'permission pages are not buried in Developer')
  const all = [...nav.matchAll(/data-cset-tab="(\w+)"/g)].map(m => m[1]).sort()
  assert.deepEqual(all, ['account', 'ad_rules', 'apikeys', 'appearance', 'billing', 'capabilities', 'chat_files', 'chat_friends', 'code', 'connectors', 'cowork', 'desktop', 'enterprise_sync', 'hosting', 'notifications', 'privacy', 'roles', 'shortcuts', 'usage', 'wellbeing', 'your_ai'])
  assert.equal(new Set(all).size, 21)
  // the narrow-screen picker is built from the same groups
  const pres = readFileSync(new URL('../presentation.js', import.meta.url), 'utf8')
  assert.match(pres, /optgroup/)
  assert.doesNotMatch(pres, /closest\('details'\)|settings-group/)
  assert.match(frostSource, /\.cset-nav-group \+ \.cset-nav-group/)
})

test('Settings > Roles: grouped one-line rows, permissions open on demand in plain words, the draft box is folded away', () => {
  const roles = protoSource.slice(protoSource.indexOf("activeCsetTab === 'roles'"), protoSource.indexOf("activeCsetTab === 'enterprise_sync'"))
  assert.match(roles, /roleGroup\('School'/); assert.match(roles, /roleGroup\('Company'/); assert.match(roles, /roleGroup\('Personal'/)
  assert.match(roles, /<details class="role-row">/)
  assert.match(roles, /<details class="role-draft">[\s\S]*id="rolePromptIn"[\s\S]*id="synthesizedRoleOutput"/)
  assert.doesNotMatch(roles, /Shell: <b>|FS: <b>|Net: <b>|BUILT-IN|MFA Required/, 'no chip rows, no repeated built-in badge')
  for (const w of ['No terminal', 'Only allowed websites', 'Reads the project, cannot change it', '365 days (FERPA)', 'Needs a second step (MFA)']) assert.ok(roles.includes(w), w)
  assert.match(frostSource, /\.role-row\[open\] > summary::before/)
})

test('Main screen shows no invented numbers or people, and no sample identity before sign-in', () => {
  assert.match(protoSource, /<div class="effort-control" id="effortBtn" hidden/, 'reasoning effort is not sent to the server, so the control is hidden')
  assert.match(protoSource, /<div class="token-ring-pill" hidden/, 'no context ring until real token counts arrive')
  assert.match(protoSource, /trp\.hidden = !\(total > 0\)/)
  assert.doesNotMatch(protoSource, /18\.2k \/ 128k|62% of this week|id="chatUsageFill" style="width:62%"/)
  assert.match(protoSource, /<div class="pres" aria-label="People here"><\/div>/, 'presence starts empty; only live presence fills it')
  assert.match(frostSource, /#app \.pres:empty, #app \.token-ring-pill\[hidden\], #app \.effort-control\[hidden\] \{ display:none !important; \}/)
  assert.match(protoSource, /<span id="meName">Not signed in<\/span><small id="runnerState">This device only<\/small>/)
  assert.doesNotMatch(protoSource, /state\.currentAccount = m\.PRECONFIGURED_ACCOUNTS\[0\]/, 'nobody becomes the sample student by default')
  assert.doesNotMatch(protoSource, /Quick-Draw Drawer|Devices & Corporate Governance/, 'tooltips say what happens')
})
