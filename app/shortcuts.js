// Shortcuts: one list that feeds three places, so they can never disagree: the real key handling, the hover tips ("Hide sidebar  ⌘B") and the shortcut sheet.
// Pure ES module, no DOM. "Mod" is Command on a Mac and Ctrl everywhere else (the shell has always accepted either, so a Mac keyboard and a PC keyboard both work).
// Browser-reserved keys are left alone on purpose (new tab/window, close tab, reload, find, print, address bar). Run: node app/test/shortcuts.test.mjs

export const COMMANDS = [
  { id: 'palette', label: 'Search or jump to', keys: 'Mod+K', group: 'Go', note: 'Files, agents, commands and settings in one list' },
  { id: 'sidebar', label: 'Show or hide the sidebar', keys: 'Mod+B', group: 'View' },
  { id: 'chat', label: 'Show or hide the conversation', keys: 'Mod+J', group: 'View' },
  { id: 'layoutIde', label: 'Editor only (SDE)', keys: 'Mod+1', group: 'View' },
  { id: 'layoutChat', label: 'Conversation only', keys: 'Mod+2', group: 'View' },
  { id: 'layoutSplit', label: 'Editor and conversation side by side', keys: 'Mod+3', group: 'View' },
  { id: 'terminal', label: 'Show or hide the terminal', keys: 'Mod+`', group: 'View' },
  { id: 'newFile', label: 'New file', keys: 'Mod+Alt+N', group: 'Files', note: 'Created in the folder of the file you are in' },
  { id: 'newFolder', label: 'New folder', keys: 'Mod+Alt+Shift+N', group: 'Files' },
  { id: 'rename', label: 'Rename the selected file or folder', keys: 'F2', group: 'Files', note: 'Select it in the file list first' },
  { id: 'delete', label: 'Delete the selected file or folder', keys: 'Delete', group: 'Files', note: 'You are asked to confirm' },
  { id: 'run', label: 'Run this file', keys: 'Mod+Enter', group: 'Run' },
  { id: 'settings', label: 'Settings', keys: 'Mod+,', group: 'General' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', keys: 'Mod+/', group: 'General' },
  { id: 'send', label: 'Send the message', keys: 'Enter', group: 'Chat' },
  { id: 'newline', label: 'New line in the message', keys: 'Shift+Enter', group: 'Chat' },
  { id: 'plainPaste', label: 'Paste as plain text (skips the context box)', keys: 'Mod+Shift+V', group: 'Chat', note: 'A normal paste of text copied inside VESPR arrives with its file and lines attached' },
  { id: 'close', label: 'Close the open dialog or menu', keys: 'Escape', group: 'General' }
]

export const byId = id => COMMANDS.find(c => c.id === id) || null

export function parseKeys (keys) {
  const parts = String(keys || '').split('+'); const key = parts.pop()
  const m = new Set(parts)
  return { mod: m.has('Mod'), shift: m.has('Shift'), alt: m.has('Alt'), key: key === '' ? '+' : key }
}

// Does this keyboard event press that combination? `Mod` accepts Command or Ctrl. An exact match: extra modifiers do not count (Ctrl+K is not Ctrl+Shift+K).
export function matches (e, keys) {
  if (!e || !keys) return false
  const k = parseKeys(keys)
  const hasMod = !!(e.metaKey || e.ctrlKey)
  if (k.mod !== hasMod || k.shift !== !!e.shiftKey || k.alt !== !!e.altKey) return false
  const ek = String(e.key || '')
  if (k.key.length === 1) {
    // Alt changes the character on a Mac, so fall back to the physical key code for letters and digits.
    if (ek.toLowerCase() === k.key.toLowerCase()) return true
    if (e.code) { const c = String(e.code); if (/^[A-Za-z]$/.test(k.key)) return c === 'Key' + k.key.toUpperCase(); if (/^[0-9]$/.test(k.key)) return c === 'Digit' + k.key }
    return false
  }
  return ek === k.key
}

const MAC = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Enter: '↵', Escape: 'Esc' }
const PC = { Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Enter: 'Enter', Escape: 'Esc' }

// The caps to draw: ['⌘', 'B'] on a Mac, ['Ctrl', 'B'] elsewhere.
export function caps (keys, mac) {
  const k = parseKeys(keys); const map = mac ? MAC : PC; const out = []
  if (k.mod) out.push(map.Mod); if (k.alt) out.push(map.Alt); if (k.shift) out.push(map.Shift)
  out.push(map[k.key] || (k.key.length === 1 ? k.key.toUpperCase() : k.key))
  return out
}

export const isMac = nav => /Mac|iPhone|iPad/i.test(String((nav && (nav.userAgentData ? nav.userAgentData.platform : nav.platform)) || ''))

// What a hover tip shows for a command: { label, caps }.
export function tip (id, mac) { const c = byId(id); return c ? { label: c.label, caps: caps(c.keys, mac) } : null }

export const groups = () => { const g = new Map(); for (const c of COMMANDS) { if (!g.has(c.group)) g.set(c.group, []); g.get(c.group).push(c) } return [...g] }

// No two commands may share a combination (tests check this).
export const conflicts = () => { const seen = new Map(); const bad = []; for (const c of COMMANDS) { const k = c.keys; if (seen.has(k)) bad.push([seen.get(k), c.id]); else seen.set(k, c.id) } return bad }
