// 30 renditions of the app's look, each a combination of a few independent choices (the team, 2026-11-10: "30 other renditions with different setups, button types, or other things").
// Every axis is a real attribute on <html> that app/variants.css styles, so a rendition is the real app, not a mock-up. Pick one in Settings > Appearance > Look.
export const AXES = Object.freeze({
  btn: ['soft', 'pill', 'square', 'outline', 'flat'],           // button and control shape
  side: ['wallpaper', 'solid', 'tint', 'glass', 'blend'],        // the left sidebar
  top: ['full', 'minimal', 'floating'],                          // the top bar
  chat: ['gray', 'black', 'tinted'],                             // the conversation surface
  comp: ['float', 'docked', 'line'],                             // the message box
  density: ['comfy', 'compact', 'roomy'],                        // spacing and sublines
  accent: ['agent', 'mono', 'amber', 'teal']                     // the highlight color
})
const R = (id, name, a) => Object.freeze({ id, name, axes: Object.freeze({ btn: 'soft', side: 'wallpaper', top: 'full', chat: 'gray', comp: 'float', density: 'comfy', accent: 'agent', ...a }) })
export const RENDITIONS = Object.freeze([
  R('r01', 'Frost (today)', {}),
  R('r02', 'Pill glass', { btn: 'pill' }),
  R('r03', 'Sharp square', { btn: 'square', side: 'solid', comp: 'docked' }),
  R('r04', 'Quiet outline', { btn: 'outline', side: 'solid', top: 'minimal' }),
  R('r05', 'Flat tint', { btn: 'flat', side: 'tint', chat: 'tinted' }),
  R('r06', 'Open glass', { btn: 'pill', side: 'glass', top: 'minimal', comp: 'line' }),
  R('r07', 'Blend', { side: 'blend', top: 'minimal', chat: 'black' }),
  R('r08', 'Floating bar', { btn: 'pill', top: 'floating' }),
  R('r09', 'Black room', { chat: 'black', side: 'solid', accent: 'mono' }),
  R('r10', 'Compact tools', { density: 'compact', btn: 'square', side: 'solid' }),
  R('r11', 'Roomy', { density: 'roomy', btn: 'pill', comp: 'float' }),
  R('r12', 'Amber glow', { accent: 'amber', side: 'tint', chat: 'tinted' }),
  R('r13', 'Teal flat', { accent: 'teal', btn: 'flat', side: 'solid' }),
  R('r14', 'Mono minimal', { accent: 'mono', btn: 'outline', top: 'minimal', side: 'blend', chat: 'black' }),
  R('r15', 'Docked compact', { comp: 'docked', density: 'compact', btn: 'square' }),
  R('r16', 'Line composer', { comp: 'line', btn: 'soft', top: 'minimal' }),
  R('r17', 'Pill floating tint', { btn: 'pill', top: 'floating', side: 'tint' }),
  R('r18', 'Glass roomy', { side: 'glass', density: 'roomy', btn: 'pill' }),
  R('r19', 'Outline wallpaper', { btn: 'outline' }),
  R('r20', 'Square wallpaper', { btn: 'square' }),
  R('r21', 'Flat blend', { btn: 'flat', side: 'blend', top: 'minimal' }),
  R('r22', 'Teal glass', { accent: 'teal', side: 'glass', btn: 'pill' }),
  R('r23', 'Amber docked', { accent: 'amber', comp: 'docked', side: 'solid' }),
  R('r24', 'Tinted pill', { chat: 'tinted', btn: 'pill', side: 'tint' }),
  R('r25', 'Black pill', { chat: 'black', btn: 'pill', side: 'wallpaper' }),
  R('r26', 'Compact line', { density: 'compact', comp: 'line', side: 'blend', top: 'minimal' }),
  R('r27', 'Roomy docked', { density: 'roomy', comp: 'docked', btn: 'soft', side: 'solid' }),
  R('r28', 'Floating mono', { top: 'floating', accent: 'mono', btn: 'outline' }),
  R('r29', 'Solid teal compact', { side: 'solid', accent: 'teal', density: 'compact', btn: 'flat' }),
  R('r30', 'Everything quiet', { btn: 'outline', side: 'blend', top: 'minimal', chat: 'black', comp: 'line', density: 'comfy', accent: 'mono' })
])
export const LOOK_IDS = Object.freeze(['default', ...RENDITIONS.map(r => r.id)])
export const attrsFor = id => { const r = RENDITIONS.find(x => x.id === id); if (!r) return {}; const o = {}; for (const [k, v] of Object.entries(r.axes)) o['data-v-' + k] = v; return o }
export const lookName = id => (RENDITIONS.find(r => r.id === id) || { name: 'Default' }).name
export const isLook = id => typeof id === 'string' && LOOK_IDS.includes(id)
