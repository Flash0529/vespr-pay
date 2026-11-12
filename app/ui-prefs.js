// Interface preferences that belong to this device (not the account): glass effects, the light in the middle of a chat, and the sidebar width.
// Pure functions plus a tiny store; the page applies them as attributes on <html> (frost.css reads them), so turning glass off costs nothing and every value is validated.
import { LOOK_IDS, attrsFor } from './renditions.js'
export const DEFAULTS = Object.freeze({ glass: 'on', chatLight: 'on', sidebar: 'standard', look: 'default' })
export const CHOICES = Object.freeze({ glass: ['on', 'off'], chatLight: ['on', 'off'], sidebar: ['compact', 'standard', 'wide'], look: LOOK_IDS })
export const SIDEBAR_PX = Object.freeze({ compact: 248, standard: 280, wide: 320 })
export function normalizePrefs (input) {
  const o = input && typeof input === 'object' ? input : {}; const out = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS)) if (typeof o[k] === 'string' && CHOICES[k].includes(o[k])) out[k] = o[k]
  return out
}
// what the page sets: data-glass / data-chat-light on <html> and the --sbw override (null = leave the default responsive width)
export function attributesFor (prefs) {
  const p = normalizePrefs(prefs)
  return { 'data-glass': p.glass, 'data-chat-light': p.chatLight, sidebarPx: p.sidebar === 'standard' ? null : SIDEBAR_PX[p.sidebar], look: attrsFor(p.look) }
}
export function createUiPrefs (storage, key = 'vespr.ui-prefs.v1') {
  const read = () => { try { return normalizePrefs(JSON.parse(storage.getItem(key) || '{}')) } catch { return { ...DEFAULTS } } }
  let cur = read()
  return {
    get: () => ({ ...cur }),
    set (patch) { cur = normalizePrefs({ ...cur, ...(patch && typeof patch === 'object' ? patch : {}) }); try { storage.setItem(key, JSON.stringify(cur)) } catch { /* blocked: lasts until reload */ } return { ...cur } },
    reset () { cur = { ...DEFAULTS }; try { storage.setItem(key, JSON.stringify(cur)) } catch {} return { ...cur } }
  }
}
