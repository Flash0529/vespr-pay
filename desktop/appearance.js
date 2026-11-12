// OS-drawn wallpaper tint or crisp desktop wallpaper alignment.
// Direction: UI-FROST-DIRECTION-2026-11-10.md (the team). Read-only, local to the machine, never uploaded or logged.
// Scope: used only to paint the sidebar/chrome aligned to the window; realign on move/resize; falls back to Mica/solid where it cannot be read.

const fs = require('node:fs')
const path = require('node:path')

function resolveWallpaperPath (env = process.env) {
  if (process.platform !== 'win32') return null
  if (env.APPDATA) {
    const transcoded = path.join(env.APPDATA, 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper')
    try {
      if (fs.existsSync(transcoded) && fs.statSync(transcoded).size > 0) return transcoded
    } catch {}
  }
  return null
}

function windowAppearance ({ platform, release, reducedTransparency = false, highContrast = false, backdropMode = 'auto', wallpaperPath = null }) {
  if (reducedTransparency || highContrast || backdropMode === 'solid') {
    return { backdrop: 'solid', options: { backgroundColor: '#202022' } }
  }
  const version = /^10\.0\.(\d+)(?:\.|$)/.exec(String(release))
  const isWin11 = platform === 'win32' && version && Number(version[1]) >= 22621

  if (backdropMode === 'wallpaper' || (backdropMode === 'auto' && wallpaperPath)) {
    if (wallpaperPath && fs.existsSync(wallpaperPath)) {
      return {
        backdrop: 'wallpaper',
        wallpaperPath,
        options: { backgroundColor: '#202022' } // solid backing so no foreign windows show through
      }
    }
  }

  if (isWin11 && (backdropMode === 'mica' || backdropMode === 'auto')) {
    return { backdrop: 'mica', options: { backgroundMaterial: 'mica', backgroundColor: '#00000000' } }
  }

  return { backdrop: 'solid', options: { backgroundColor: '#202022' } }
}

module.exports = { windowAppearance, resolveWallpaperPath }
