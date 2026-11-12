import assert from 'node:assert'
import {
  MIN_CHAT_WIDTH,
  MAX_CHAT_PERCENT,
  MIN_EDITOR_WIDTH,
  DEFAULT_CHAT_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MOBILE_BREAKPOINT,
  VALID_LAYOUTS,
  clampChatWidth,
  clampSidebarWidth,
  computeGutterDrag,
  isCompact,
  computePanelVisibility,
  createLayoutManager
} from '../splitlayout.js'

let n = 0
const t = (name, fn) => {
  try {
    fn()
    n++
  } catch (e) {
    console.error('FAILED: ' + name)
    throw e
  }
}

// 1. Constants
t('exports safe layout boundary constants', () => {
  assert.strictEqual(MIN_CHAT_WIDTH, 280)
  assert.strictEqual(MAX_CHAT_PERCENT, 0.62)
  assert.strictEqual(MIN_EDITOR_WIDTH, 360)
  assert.strictEqual(DEFAULT_CHAT_WIDTH, 330)
  assert.strictEqual(MIN_SIDEBAR_WIDTH, 180)
  assert.strictEqual(MAX_SIDEBAR_WIDTH, 500)
  assert.strictEqual(DEFAULT_SIDEBAR_WIDTH, 240)
  assert.strictEqual(MOBILE_BREAKPOINT, 860)
  assert.deepStrictEqual([...VALID_LAYOUTS], ['split', 'ide', 'chat'])
})

// 2. clampChatWidth
t('clamps chat width within safe minimum, maximum percent, and editor space', () => {
  // Normal 1200px container: 62% is 744px; cw - 360 is 840px. Effective max: 744px.
  assert.strictEqual(clampChatWidth(400, 1200), 400)
  assert.strictEqual(clampChatWidth(100, 1200), 280) // Clamped to min 280
  assert.strictEqual(clampChatWidth(900, 1200), 744) // Clamped to 62% (744)

  // Narrow 700px container: cw - 360 is 340px; 62% is 434px. Effective max: 340px.
  assert.strictEqual(clampChatWidth(500, 700), 340)

  // Default fallback for invalid inputs
  assert.strictEqual(clampChatWidth(null, null), DEFAULT_CHAT_WIDTH)
})

// 3. clampSidebarWidth
t('clamps sidebar width within min 180 and max bounds', () => {
  assert.strictEqual(clampSidebarWidth(250, 1200), 250)
  assert.strictEqual(clampSidebarWidth(100, 1200), 180)
  assert.strictEqual(clampSidebarWidth(800, 1200), 480) // 40% of 1200
  assert.strictEqual(clampSidebarWidth(null, null), DEFAULT_SIDEBAR_WIDTH)
})

// 4. computeGutterDrag for chat
t('computes chat width adjustment from mouse drag delta', () => {
  // Dragging left (negative delta) expands chat panel
  const expanded = computeGutterDrag(330, -50, 1200, 'chat')
  assert.strictEqual(expanded, 380)

  // Dragging right (positive delta) contracts chat panel
  const contracted = computeGutterDrag(330, 50, 1200, 'chat')
  assert.strictEqual(contracted, 280)

  // Dragging past limits is clamped
  const maxClamped = computeGutterDrag(330, -600, 1200, 'chat')
  assert.strictEqual(maxClamped, 744) // 62% of 1200
})

// 5. computeGutterDrag for sidebar
t('computes sidebar width adjustment from mouse drag delta', () => {
  // Dragging right (positive delta) expands left sidebar
  const expanded = computeGutterDrag(240, 60, 1200, 'sidebar')
  assert.strictEqual(expanded, 300)

  // Dragging left (negative delta) contracts left sidebar
  const contracted = computeGutterDrag(240, -100, 1200, 'sidebar')
  assert.strictEqual(contracted, 180)
})

// 6. isCompact
t('identifies compact mobile breakpoints', () => {
  assert.strictEqual(isCompact(860), true)
  assert.strictEqual(isCompact(720), true)
  assert.strictEqual(isCompact(861), false)
  assert.strictEqual(isCompact(1200), false)
  assert.strictEqual(isCompact(null), false)
})

// 7. computePanelVisibility in ide mode
t('computes panel visibility for ide mode', () => {
  const v = computePanelVisibility({
    layout: 'ide',
    sidebarOpen: true,
    terminalOpen: true
  })
  assert.strictEqual(v.showEditor, true)
  assert.strictEqual(v.showChat, false)
  assert.strictEqual(v.showGutter, false)
  assert.strictEqual(v.showSidebar, true)
  assert.strictEqual(v.showTerminal, true)
  assert.strictEqual(v.showMinimap, true)
})

// 8. computePanelVisibility in chat mode
t('computes panel visibility for chat mode', () => {
  const v = computePanelVisibility({
    layout: 'chat',
    sidebarOpen: true,
    terminalOpen: true
  })
  assert.strictEqual(v.showEditor, false)
  assert.strictEqual(v.showChat, true)
  assert.strictEqual(v.showGutter, false)
  assert.strictEqual(v.showSidebar, true)
  assert.strictEqual(v.showTerminal, false) // Terminal hidden in chat-only
  assert.strictEqual(v.showMinimap, false)
})

// 9. computePanelVisibility in split mode
t('computes panel visibility for split mode and chatMin', () => {
  const vNormal = computePanelVisibility({
    layout: 'split',
    sidebarOpen: true,
    chatMin: false
  })
  assert.strictEqual(vNormal.showEditor, true)
  assert.strictEqual(vNormal.showChat, true)
  assert.strictEqual(vNormal.showGutter, true)

  const vMin = computePanelVisibility({
    layout: 'split',
    chatMin: true
  })
  assert.strictEqual(vMin.showEditor, true)
  assert.strictEqual(vMin.showChat, false)
  assert.strictEqual(vMin.showGutter, false)
})

// 10. computePanelVisibility in compact mode
t('hides secondary panels on compact screens', () => {
  const v = computePanelVisibility({
    layout: 'split',
    sidebarOpen: true,
    terminalOpen: true,
    isCompact: true
  })
  assert.strictEqual(v.showSidebar, false)
  assert.strictEqual(v.showTerminal, false)
  assert.strictEqual(v.showMinimap, false)
  assert.strictEqual(v.showGutter, false)
})

// 11. createLayoutManager state and compute
t('manages layout state transitions and geometry calculation', () => {
  const mgr = createLayoutManager({ layout: 'split', chatWidth: 350 })
  assert.strictEqual(mgr.layout, 'split')
  assert.strictEqual(mgr.chatWidth, 350)

  // Layout mode cycling
  assert.strictEqual(mgr.cycleLayout(), 'ide')
  assert.strictEqual(mgr.cycleLayout(), 'chat')
  assert.strictEqual(mgr.cycleLayout(), 'split')

  // Explicit set
  assert.strictEqual(mgr.setLayout('ide'), true)
  assert.strictEqual(mgr.setLayout('invalid'), false)
  assert.strictEqual(mgr.layout, 'ide')

  // Toggles
  assert.strictEqual(mgr.toggleTerminal(), true)
  assert.strictEqual(mgr.toggleTerminal(), false)

  // Compute geometry
  mgr.setLayout('split')
  const geo = mgr.compute(1200, 800)
  assert.strictEqual(geo.layout, 'split')
  assert.strictEqual(geo.containerWidth, 1200)
  assert.strictEqual(geo.containerHeight, 800)
  assert.strictEqual(geo.isCompact, false)
  assert.strictEqual(geo.sidebarWidth, DEFAULT_SIDEBAR_WIDTH)
  assert.strictEqual(geo.chatWidth, 350)
  // editorWidth = 1200 - 240 (sidebar) - 350 (chat) = 610
  assert.strictEqual(geo.editorWidth, 610)
})

// 12. Hostile inputs and robustness
t('handles bad types, non-finite values, and NaN gracefully', () => {
  const mgr = createLayoutManager()
  assert.strictEqual(mgr.setLayout(null), false)
  assert.strictEqual(mgr.setLayout(123), false)

  assert.strictEqual(clampChatWidth(NaN, NaN), DEFAULT_CHAT_WIDTH)
  assert.strictEqual(clampSidebarWidth(Infinity, -50), DEFAULT_SIDEBAR_WIDTH)

  const geo = mgr.compute(NaN, undefined)
  assert.ok(Number.isFinite(geo.containerWidth))
  assert.ok(Number.isFinite(geo.containerHeight))
  assert.ok(Number.isFinite(geo.editorWidth))
})

console.log('splitlayout tests passed (' + n + ')')
