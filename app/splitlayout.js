// SDE multi-panel split layout, resizable gutter drag, and panel visibility. Pure ES module.
export const MIN_CHAT_WIDTH = 280
export const MAX_CHAT_PERCENT = 0.62
export const MIN_EDITOR_WIDTH = 360
export const DEFAULT_CHAT_WIDTH = 330
export const MIN_SIDEBAR_WIDTH = 180
export const MAX_SIDEBAR_WIDTH = 500
export const DEFAULT_SIDEBAR_WIDTH = 240
export const MOBILE_BREAKPOINT = 860
export const VALID_LAYOUTS = Object.freeze(['split', 'ide', 'chat'])

// Clamps chat panel width within safe pixel and viewport percentage limits.
export function clampChatWidth (width, containerWidth) {
  const cw = typeof containerWidth === 'number' && Number.isFinite(containerWidth) && containerWidth > 0
    ? containerWidth
    : 1024

  const maxAllowedByPercent = Math.floor(cw * MAX_CHAT_PERCENT)
  const maxAllowedByEditor = Math.max(MIN_CHAT_WIDTH, cw - MIN_EDITOR_WIDTH)
  const effectiveMax = Math.max(MIN_CHAT_WIDTH, Math.min(maxAllowedByPercent, maxAllowedByEditor))

  const target = typeof width === 'number' && Number.isFinite(width) ? Math.floor(width) : DEFAULT_CHAT_WIDTH
  return Math.max(MIN_CHAT_WIDTH, Math.min(effectiveMax, target))
}

// Clamps sidebar width within safe minimum and maximum pixel boundaries.
export function clampSidebarWidth (width, containerWidth) {
  const cw = typeof containerWidth === 'number' && Number.isFinite(containerWidth) && containerWidth > 0
    ? containerWidth
    : 1024

  const maxAllowed = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.floor(cw * 0.4)))
  const target = typeof width === 'number' && Number.isFinite(width) ? Math.floor(width) : DEFAULT_SIDEBAR_WIDTH
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxAllowed, target))
}

// Computes updated panel width resulting from mouse drag delta.
export function computeGutterDrag (startWidth, deltaX, containerWidth, side = 'chat') {
  const sw = typeof startWidth === 'number' && Number.isFinite(startWidth) ? startWidth : DEFAULT_CHAT_WIDTH
  const dx = typeof deltaX === 'number' && Number.isFinite(deltaX) ? deltaX : 0

  if (side === 'sidebar') {
    // Dragging right increases left sidebar width
    const raw = sw + dx
    return clampSidebarWidth(raw, containerWidth)
  }

  // Right-docked chat gutter: dragging left (negative dx) increases chat width
  const raw = sw - dx
  return clampChatWidth(raw, containerWidth)
}

// Determines if viewport falls into compact/mobile breakpoint.
export function isCompact (width) {
  return typeof width === 'number' && Number.isFinite(width) && width <= MOBILE_BREAKPOINT
}

// Computes visibility flags for all SDE shell panels.
export function computePanelVisibility (state = {}) {
  const layout = typeof state.layout === 'string' && VALID_LAYOUTS.includes(state.layout.toLowerCase())
    ? state.layout.toLowerCase()
    : 'split'

  const sidebarOpen = state.sidebarOpen !== false
  const terminalOpen = !!state.terminalOpen
  const chatMin = !!state.chatMin
  const compact = !!state.isCompact

  if (layout === 'ide') {
    return {
      showEditor: true,
      showChat: false,
      showGutter: false,
      showSidebar: sidebarOpen && !compact,
      showTerminal: terminalOpen && !compact,
      showMinimap: !compact
    }
  }

  if (layout === 'chat') {
    return {
      showEditor: false,
      showChat: true,
      showGutter: false,
      showSidebar: sidebarOpen && !compact,
      showTerminal: false,
      showMinimap: false
    }
  }

  // 'split' layout
  const hasGutter = !chatMin && !compact
  return {
    showEditor: true,
    showChat: !chatMin,
    showGutter: hasGutter,
    showSidebar: sidebarOpen && !compact,
    showTerminal: terminalOpen && !compact,
    showMinimap: !compact
  }
}

// Creates an isolated layout state manager.
export function createLayoutManager (initial = {}) {
  let layout = typeof initial.layout === 'string' && VALID_LAYOUTS.includes(initial.layout.toLowerCase())
    ? initial.layout.toLowerCase()
    : 'split'

  let chatWidth = clampChatWidth(initial.chatWidth)
  let sidebarWidth = clampSidebarWidth(initial.sidebarWidth)
  let sidebarOpen = initial.sidebarOpen !== false
  let terminalOpen = !!initial.terminalOpen
  let chatMin = !!initial.chatMin

  function setLayout (mode) {
    if (typeof mode !== 'string') return false
    const clean = mode.toLowerCase().trim()
    if (!VALID_LAYOUTS.includes(clean)) return false
    layout = clean
    return true
  }

  function cycleLayout () {
    const idx = VALID_LAYOUTS.indexOf(layout)
    const nextIdx = (idx + 1) % VALID_LAYOUTS.length
    layout = VALID_LAYOUTS[nextIdx]
    return layout
  }

  function setChatWidth (width, containerWidth) {
    chatWidth = clampChatWidth(width, containerWidth)
    return chatWidth
  }

  function setSidebarWidth (width, containerWidth) {
    sidebarWidth = clampSidebarWidth(width, containerWidth)
    return sidebarWidth
  }

  function toggleSidebar () {
    sidebarOpen = !sidebarOpen
    return sidebarOpen
  }

  function toggleTerminal () {
    terminalOpen = !terminalOpen
    return terminalOpen
  }

  function toggleChatMin () {
    chatMin = !chatMin
    return chatMin
  }

  function compute (containerWidth = 1024, containerHeight = 768) {
    const cw = typeof containerWidth === 'number' && Number.isFinite(containerWidth) && containerWidth > 0
      ? containerWidth
      : 1024
    const ch = typeof containerHeight === 'number' && Number.isFinite(containerHeight) && containerHeight > 0
      ? containerHeight
      : 768

    const compact = isCompact(cw)
    const effectiveChatWidth = clampChatWidth(chatWidth, cw)
    const effectiveSidebarWidth = clampSidebarWidth(sidebarWidth, cw)

    const panels = computePanelVisibility({
      layout,
      sidebarOpen,
      terminalOpen,
      chatMin,
      isCompact: compact
    })

    const visibleSidebarWidth = panels.showSidebar ? effectiveSidebarWidth : 0
    let mainWidth = Math.max(0, cw - visibleSidebarWidth)

    let editorWidth = 0
    let finalChatWidth = 0

    if (panels.showEditor && panels.showChat) {
      finalChatWidth = effectiveChatWidth
      editorWidth = Math.max(0, mainWidth - finalChatWidth)
    } else if (panels.showEditor) {
      editorWidth = mainWidth
    } else if (panels.showChat) {
      finalChatWidth = mainWidth
    }

    return {
      layout,
      containerWidth: cw,
      containerHeight: ch,
      isCompact: compact,
      sidebarWidth: effectiveSidebarWidth,
      chatWidth: finalChatWidth,
      editorWidth,
      panels
    }
  }

  return {
    setLayout,
    cycleLayout,
    setChatWidth,
    setSidebarWidth,
    toggleSidebar,
    toggleTerminal,
    toggleChatMin,
    compute,
    get layout () { return layout },
    get chatWidth () { return chatWidth },
    get sidebarWidth () { return sidebarWidth },
    get sidebarOpen () { return sidebarOpen },
    get terminalOpen () { return terminalOpen },
    get chatMin () { return chatMin }
  }
}
