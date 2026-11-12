// Agent colour, name and presets. Pure functions plus a tiny store, so the rules can be tested without a browser.
// the team, 2026-11-10: an agent's colour is its identity in the UI (the light in its chat, its dot, its focus ring); people can rename an agent, pick a
// preset or type a hex code (Enter moves the wheel to it); the default agent is "VESPR Manager" in the logo blue.
// The stored colour is the person's choice. What is DRAWN on a dark surface is derived from it (onDark) so a deep blue such as #1F3A93 never becomes
// an unreadable icon: the derived colour keeps at least 3:1 against the surface, and the stored value is never changed by this.

export const DEFAULT_AGENT = Object.freeze({ id: 'manager', name: 'VESPR Manager', color: '#1F3A93' })
export const NAME_MAX = 40

// the team's five blues (2026-11-10), then the three room-lighting colours from ROOM-LIGHTING-SPEC, then a few distinct hues for other agents
export const PRESETS = Object.freeze([
  { name: 'Deep blue', color: '#1F3A93' }, { name: 'Royal blue', color: '#2F55C7' }, { name: 'Bright blue', color: '#4169E1' },
  { name: 'Sky', color: '#7F9CFF' }, { name: 'Mist', color: '#C9D6FF' },
  { name: 'Studio blue', color: '#0002ED' }, { name: 'Violet', color: '#7212FD' }, { name: 'Red', color: '#ED0000' },
  { name: 'Teal', color: '#34D3A4' }, { name: 'Amber', color: '#F5A94C' }, { name: 'Rose', color: '#F26D9B' }
])

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i
// '#abc' and 'abc' and '#AABBCC' are all accepted; anything else is rejected (null), never guessed
export function normalizeHex (v) {
  if (typeof v !== 'string') return null
  const m = HEX.exec(v.trim()); if (!m) return null
  let h = m[1]; if (h.length === 3) h = h.split('').map(c => c + c).join('')
  return '#' + h.toUpperCase()
}
export function hexToRgb (hex) { const h = normalizeHex(hex); if (!h) return null; return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) }
export function rgbToHex (r, g, b) { return '#' + [r, g, b].map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('').toUpperCase() }

function lin (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
export function luminance (hex) { const c = hexToRgb(hex); return c ? 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]) : 0 }
export function contrast (a, b) { const x = luminance(a); const y = luminance(b); const [hi, lo] = x > y ? [x, y] : [y, x]; return (hi + 0.05) / (lo + 0.05) }

// the surfaces an agent colour is drawn on (kept in step with presentation.css: --chat-bg and --editor-bg)
export const SURFACES = Object.freeze({ dark: ['#202022', '#000000', '#141416'], light: ['#F1F1F3', '#FFFFFF', '#EDEDEE'] })

function mix (hex, towards, t) { const a = hexToRgb(hex); const b = hexToRgb(towards); return rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t) }
function worst (hex, surfaces) { return Math.min(...surfaces.map(s => contrast(hex, s))) }
// lighten (dark UI) or darken (light UI) in small steps until the colour keeps `min` against every surface; hue is kept, only lightness moves
export function legible (hex, mode, min = 3) {
  const h = normalizeHex(hex); if (!h) return null
  const surfaces = SURFACES[mode === 'light' ? 'light' : 'dark']; const target = mode === 'light' ? '#000000' : '#FFFFFF'
  let out = h
  for (let i = 0; i <= 20 && worst(out, surfaces) < min; i++) out = mix(h, target, i * 0.05)
  return out
}
export const onDark = (hex, min = 3) => legible(hex, 'dark', min)
export const onLight = (hex, min = 3) => legible(hex, 'light', min)

// text drawn on top of an agent-coloured fill: black or white, whichever reads better
export function readableOn (hex) { return contrast(hex, '#FFFFFF') >= contrast(hex, '#000000') ? '#FFFFFF' : '#000000' }

// ---- colour square / wheel maths: the picker shows hue + saturation/value; typing a hex and pressing Enter must land on the same point
export function hexToHsv (hex) {
  const c = hexToRgb(hex); if (!c) return null
  const [r, g, b] = c.map(n => n / 255); const max = Math.max(r, g, b); const d = max - Math.min(r, g, b)
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: Math.round(((h * 60) + 360) % 360), s: max ? d / max : 0, v: max }
}
export function hsvToHex (h, s, v) {
  h = ((h % 360) + 360) % 360; const c = v * s; const x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}

// ---- the person's choices, one record per agent id. A damaged record is ignored, never trusted.
export function cleanName (v) { if (typeof v !== 'string') return null; const s = v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX); return s || null }
export function cleanRecord (r) {
  if (!r || typeof r !== 'object') return {}
  const out = {}; const c = normalizeHex(r.color); const n = cleanName(r.name)
  if (c) out.color = c
  if (n) out.name = n
  return out
}
export function createAgentStyles (storage, key = 'vespr.agent-styles.v1') {
  const read = () => { try { const o = JSON.parse(storage.getItem(key) || '{}'); const out = {}; for (const [id, r] of Object.entries(o && typeof o === 'object' ? o : {})) { const c = cleanRecord(r); if (Object.keys(c).length) out[String(id).slice(0, 80)] = c } return out } catch { return {} } }
  const write = db => { try { storage.setItem(key, JSON.stringify(db)) } catch { /* storage full or blocked: the choice lasts until reload */ } }
  let cache = read()
  return {
    get (id, fallback = {}) { const r = cache[id] || {}; return { name: r.name || fallback.name || DEFAULT_AGENT.name, color: r.color || normalizeHex(fallback.color) || DEFAULT_AGENT.color } },
    set (id, patch) { const next = { ...(cache[id] || {}), ...cleanRecord(patch) }; cache = { ...cache, [id]: next }; write(cache); return this.get(id) },
    reset (id) { const { [id]: _gone, ...rest } = cache; cache = rest; write(cache) },
    all () { return { ...cache } }
  }
}
