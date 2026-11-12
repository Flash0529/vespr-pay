// The browser's built-in frosted wallpaper (the team, 2026-11-10: "the browser gets a preinstalled frosted glass wallpaper; changing or customizing it is paid").
// Every wallpaper is a CSS gradient built from the brand blues, so nothing is downloaded and nothing can be decoded or tracked. The person's choice is only honoured
// when the account is entitled; until real billing exists nobody is, so everyone sees the default and no control is shown. Pure functions plus a tiny store, tested without a browser.
export const DEFAULT_ID = 'frost'
// Circles with fixed pixel radii, never percentages: a percentage ellipse is stretched to whatever box it is painted in, which squished the picture into the tall narrow sidebar.
const g = (a, b, c, d) => `radial-gradient(circle 300px at 18% 12%, ${a}, transparent 100%), radial-gradient(circle 260px at 92% 30%, ${b}, transparent 100%), radial-gradient(circle 380px at 40% 104%, ${c}, transparent 100%), ${d}`
export const WALLPAPERS = Object.freeze({
  frost: Object.freeze({ name: 'Frost', dark: g('#2F55C7', '#1F3A93', '#4169E1', '#0B1230'), light: g('#C9D6FF', '#7F9CFF', '#DCE5FF', '#EEF2FF') }),
  dusk: Object.freeze({ name: 'Dusk', dark: g('#1F3A93', '#5B3A9E', '#2F55C7', '#0A0F24'), light: g('#C9D6FF', '#D9CCF5', '#BFD0FF', '#F0EEFF') }),
  graphite: Object.freeze({ name: 'Graphite', dark: g('#2A2D36', '#1D2029', '#34384A', '#0C0D12'), light: g('#E3E5EC', '#D5D8E2', '#EEF0F5', '#F6F7FA') })
})
// what to draw: the stored choice only counts when entitled and known; anything else is the default
export function resolveWallpaper (stored, entitled) {
  const id = entitled === true && typeof stored === 'string' && Object.prototype.hasOwnProperty.call(WALLPAPERS, stored) ? stored : DEFAULT_ID
  return { id, ...WALLPAPERS[id] }
}
export const cssFor = (w, mode) => (mode === 'light' ? w.light : w.dark)
export function createWallpaperStore (storage, key = 'vespr.web-wallpaper.v1') {
  const read = () => { try { const v = JSON.parse(storage.getItem(key) || 'null'); return typeof v === 'string' ? v : null } catch { return null } }
  let cur = read()
  return { get: () => cur, set (id) { if (!Object.prototype.hasOwnProperty.call(WALLPAPERS, id)) return false; cur = id; try { storage.setItem(key, JSON.stringify(id)) } catch { /* blocked: lasts until reload */ } return true } }
}
