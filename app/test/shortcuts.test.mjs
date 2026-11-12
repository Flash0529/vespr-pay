// Tests for app/shortcuts.js. Run: node app/test/shortcuts.test.mjs
import assert from 'node:assert'
import { COMMANDS, byId, parseKeys, matches, caps, isMac, tip, groups, conflicts } from '../shortcuts.js'

let n = 0
const t = (name, fn) => { try { fn(); n++ } catch (e) { console.error('FAILED: ' + name); throw e } }
const ev = (o) => ({ key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o })

t('no two commands share a combination, ids are unique', () => {
  assert.deepStrictEqual(conflicts(), [])
  assert.strictEqual(new Set(COMMANDS.map(c => c.id)).size, COMMANDS.length)
})

t('browser-reserved combinations are never used', () => {
  const reserved = ['Mod+T', 'Mod+W', 'Mod+N', 'Mod+R', 'Mod+F', 'Mod+P', 'Mod+L', 'Mod+Shift+T', 'Mod+Shift+N', 'Mod+Q', 'Mod+Tab']
  for (const c of COMMANDS) assert.ok(!reserved.includes(c.keys), c.id + ' uses ' + c.keys)
})

t('every command has plain text a person can read', () => {
  for (const c of COMMANDS) { assert.ok(c.label.length > 2 && c.label.length < 70, c.id); assert.ok(!/[<>]/.test(c.label + (c.note || '')), c.id) }
  assert.ok(!/colour|behaviour|\bIDE\b/.test(JSON.stringify(COMMANDS)))
})

t('parseKeys reads modifiers and the key', () => {
  assert.deepStrictEqual(parseKeys('Mod+Shift+V'), { mod: true, shift: true, alt: false, key: 'V' })
  assert.deepStrictEqual(parseKeys('Enter'), { mod: false, shift: false, alt: false, key: 'Enter' })
})

t('matches accepts Command or Ctrl for Mod and is exact about the rest', () => {
  assert.ok(matches(ev({ key: 'k', ctrlKey: true }), 'Mod+K'))
  assert.ok(matches(ev({ key: 'K', metaKey: true }), 'Mod+K'))
  assert.ok(!matches(ev({ key: 'k', ctrlKey: true, shiftKey: true }), 'Mod+K'))
  assert.ok(!matches(ev({ key: 'k' }), 'Mod+K'))
  assert.ok(matches(ev({ key: 'Enter', ctrlKey: true }), 'Mod+Enter'))
  assert.ok(matches(ev({ key: 'Enter' }), 'Enter'))
  assert.ok(!matches(ev({ key: 'Enter', shiftKey: true }), 'Enter'))
  assert.ok(matches(ev({ key: '/', metaKey: true }), 'Mod+/'))
  assert.ok(matches(ev({ key: '`', ctrlKey: true }), 'Mod+`'))
  assert.ok(matches(ev({ key: 'Escape' }), 'Escape'))
  assert.ok(!matches(null, 'Mod+K') && !matches(ev({ key: 'k' }), ''))
})

t('Alt shortcuts survive the Mac character change through the key code', () => {
  assert.ok(matches(ev({ key: 'ƒ', code: 'KeyF', metaKey: true, altKey: true }), 'Mod+Alt+F'))
  assert.ok(matches(ev({ key: '¡', code: 'Digit1', ctrlKey: true }), 'Mod+1'))
  assert.ok(!matches(ev({ key: 'f', code: 'KeyF', metaKey: true }), 'Mod+Alt+F'))
  assert.ok(matches(ev({ key: 'F2' }), 'F2') && !matches(ev({ key: 'F2', ctrlKey: true }), 'F2'))
  assert.ok(matches(ev({ key: 'N', code: 'KeyN', metaKey: true, altKey: true, shiftKey: true }), 'Mod+Alt+Shift+N'))
})

t('caps draw Mac symbols or PC names', () => {
  assert.deepStrictEqual(caps('Mod+B', true), ['⌘', 'B'])
  assert.deepStrictEqual(caps('Mod+B', false), ['Ctrl', 'B'])
  assert.deepStrictEqual(caps('Mod+Shift+V', true), ['⌘', '⇧', 'V'])
  assert.deepStrictEqual(caps('Mod+Alt+F', false), ['Ctrl', 'Alt', 'F'])
  assert.deepStrictEqual(caps('Mod+Alt+Shift+N', true), ['⌘', '⌥', '⇧', 'N'])
  assert.deepStrictEqual(caps('F2', false), ['F2'])
  assert.deepStrictEqual(caps('Delete', true), ['Delete'])
  assert.deepStrictEqual(caps('Enter', true), ['↵'])
  assert.deepStrictEqual(caps('Escape', false), ['Esc'])
})

t('isMac and tip', () => {
  assert.ok(isMac({ platform: 'MacIntel' })); assert.ok(!isMac({ platform: 'Linux armv8l' })); assert.ok(isMac({ userAgentData: { platform: 'macOS' } })); assert.ok(!isMac(null))
  assert.deepStrictEqual(tip('sidebar', true), { label: 'Show or hide the sidebar', caps: ['⌘', 'B'] })
  assert.strictEqual(tip('nope', true), null)
})

t('groups keep the order of the list', () => {
  const g = groups(); assert.strictEqual(g[0][0], 'Go'); assert.ok(g.every(([name, list]) => name && list.length))
})

t('retired agent-following command is not advertised or bound', () => {
  assert.strictEqual(byId('follow'), null)
  assert.ok(!COMMANDS.some(c => c.keys === 'Mod+Alt+F'))
})

console.log(`shortcuts tests passed (${n})`)
