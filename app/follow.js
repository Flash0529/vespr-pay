// Live follow: while an agent edits, the SDE goes where it goes (switches to its file's tab, scrolls to the line) so the person watches the work happen.
// Pure logic with an injectable clock; the shell does the actual tab switch and scroll. Rules, all tested in app/test/follow.test.js:
//  - only AGENT edits move the view, never another person's (their cursor is already shown in the editor);
//  - moves are throttled (the same file at most every `lineMs`, a different file at most every `fileMs`) so a fast typist-agent does not make the screen jump;
//  - the moment the person scrolls, clicks or types in the editor, following PAUSES (the shell shows "Paused" with a one-click resume);
//  - following can be turned off completely, and the choice is kept by the shell (localStorage).

export const LINE_MS = 450
export const FILE_MS = 1200

// 1-based line number of a character index in `text` (clamped).
export function lineAt (text, index) {
  const s = String(text == null ? '' : text); const end = Math.max(0, Math.min(Number(index) || 0, s.length))
  let n = 1; for (let i = 0; i < end; i++) if (s.charCodeAt(i) === 10) n++
  return n
}

export function createFollower ({ now = () => Date.now(), on = true, lineMs = LINE_MS, fileMs = FILE_MS } = {}) {
  let enabled = !!on; let paused = false; let lastAt = 0; let lastFile = ''; let lastLine = 0; let who = ''
  const api = {
    get enabled () { return enabled }, get paused () { return paused },
    // An edit happened. Returns { file, line } when the view should move there, otherwise null.
    onEdit (e, text) {
      if (!enabled || paused || !e || !e.ai || !e.file) return null
      const t = now(); const sameFile = e.file === lastFile
      if (lastAt && t - lastAt < (sameFile ? lineMs : fileMs)) return null
      const line = lineAt(text, e.at)
      if (sameFile && line === lastLine) { lastAt = t; return null }
      lastAt = t; lastFile = e.file; lastLine = line; who = String(e.by || 'the agent')
      return { file: e.file, line, by: who }
    },
    // The person took the wheel (scroll, click or typing in the editor).
    pause () { if (enabled && !paused) { paused = true; return true } return false },
    resume () { paused = false; lastAt = 0; return true },
    // The Follow button: off -> on; on and paused -> resume; on and running -> off.
    toggle () { if (!enabled) { enabled = true; paused = false; lastAt = 0; return 'on' } if (paused) { paused = false; lastAt = 0; return 'resumed' } enabled = false; return 'off' },
    setEnabled (v) { enabled = !!v; if (!enabled) paused = false; lastAt = 0 },
    // A short line for the button and the status bar.
    label () { if (!enabled) return 'Follow agent'; if (paused) return 'Paused · resume'; return who && lastFile ? `Following ${who} · ${lastFile}:${lastLine}` : 'Following the agent' }
  }
  return api
}
