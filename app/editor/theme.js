// The editor's look: the shell's own CSS variables (--bg --surface --text --muted --faint --hair --agent --ok --bad), so dark and light
// follow the page (html[data-theme]) with nothing to switch here. 12 px mono, small line height, quiet gutters, no heavy effects.
// Every colour has a fallback, so a page that defines none of the variables still gets a readable dark editor.
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

const mix = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`
const text = 'var(--text, #ececee)'; const muted = 'var(--muted, #9b9ba3)'; const faint = 'var(--faint, #80808a)'
const hair = 'var(--hair, rgba(255,255,255,.075))'; const hair2 = 'var(--hair2, rgba(255,255,255,.12))'
const agent = 'var(--agent, #6c9dff)'; const ok = 'var(--ok, #86efac)'; const bad = 'var(--bad, #fda4af)'; const warn = 'var(--warn, #fbbf77)'
const font = 'var(--font, system-ui, -apple-system, "Segoe UI", sans-serif)'
const mono = 'var(--mono, ui-monospace, "SF Mono", "Geist Mono", "JetBrains Mono", Menlo, Consolas, monospace)'

// syntax colours: the same palette as the shell's old read-only view (keywords blue, strings amber, numbers green)
const darkSyntax = { '--sx-fg': '#f2f2f4', '--sx-kw': '#7dd3fc', '--sx-str': '#fbbf77', '--sx-num': '#86efac', '--sx-fn': '#c4b5fd', '--sx-type': '#a5b4fc' }
const lightSyntax = { '--sx-fg': '#1b1b1d', '--sx-kw': '#0b6fa6', '--sx-str': '#a35f08', '--sx-num': '#1a7f45', '--sx-fn': '#6d28d9', '--sx-type': '#4f5bd5' }

export const editorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', color: text, backgroundColor: 'var(--surface, #1c1c1e)', ...darkSyntax },
  '[data-theme=light] &': lightSyntax,
  '&.cm-focused': { outline: `2px solid ${agent}`, outlineOffset: '-2px' }, // a visible focus ring, inside so a scrolling parent never clips it
  '.cm-scroller': { fontFamily: mono, lineHeight: '1.55', scrollbarWidth: 'thin' },
  '.cm-content': { padding: '16px 0 12px', caretColor: text }, // top room so a name label above the first line is not cut off
  '.cm-line': { padding: '0 16px 0 6px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: text, borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: mix(agent, 26) },
  '&:not(.cm-focused) > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: mix(agent, 14) },
  '.cm-activeLine': { backgroundColor: mix(text, 4.5) },
  '.cm-gutters': { backgroundColor: 'transparent', color: faint, border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '40px', padding: '0 12px 0 8px' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: text },
  '.cm-specialChar': { color: faint },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: mix(text, 12), outline: `1px solid ${mix(text, 25)}` },
  '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: mix(bad, 22) },
  '.cm-selectionMatch': { backgroundColor: mix(text, 9) },
  '.cm-searchMatch': { backgroundColor: mix(warn, 24), outline: 'none' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: mix(warn, 46) },

  // search panel (quiet, the shell's controls)
  '.cm-panels': { backgroundColor: 'var(--bg, #131314)', color: text, font: `11px ${font}` },
  '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${hair}` },
  '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${hair}` },
  '.cm-panel.cm-search': { padding: '6px 28px 6px 10px' },
  '.cm-panel.cm-search label': { color: muted, fontSize: '11px' },
  '.cm-panel.cm-search [name=close]': { color: muted, top: '4px', right: '8px' },
  '.cm-textfield': { backgroundColor: 'var(--input, #1b1b1d)', border: `1px solid ${hair2}`, color: text, borderRadius: '6px', fontSize: '11px', padding: '2px 7px', outline: 'none' },
  '.cm-textfield:focus': { borderColor: agent },
  '.cm-button': { backgroundColor: 'var(--surface2, #232326)', backgroundImage: 'none', border: `1px solid ${hair2}`, color: text, borderRadius: '6px', fontSize: '11px', padding: '2px 9px' },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: mix(text, 14) },

  // tooltips (problem messages)
  '.cm-tooltip': { backgroundColor: 'var(--surface2, #232326)', color: text, border: `1px solid ${hair2}`, borderRadius: '7px', overflow: 'hidden' },
  '.cm-problem-tip': { font: `11px/1.5 ${font}`, padding: '5px 9px', maxWidth: '360px', whiteSpace: 'pre-wrap', color: text },

  // hover: who wrote it and why
  '.cm-hover-info': { display: 'flex', flexDirection: 'column' },
  '.cm-hover-info > * + *': { borderTop: `1px solid ${hair}` },
  '.cm-who': { font: `11px/1.5 ${font}`, padding: '6px 10px', maxWidth: '320px', display: 'flex', flexDirection: 'column', gap: '2px' },
  '.cm-who-head': { display: 'flex', alignItems: 'baseline', gap: '7px' },
  '.cm-who-name': { fontWeight: '600', color: text },
  '.cm-who-badge': { font: `600 9.5px/1.4 ${font}`, padding: '0 6px', borderRadius: '99px', color: agent, border: `1px solid ${mix(agent, 45)}` },
  '.cm-who-time': { marginLeft: 'auto', paddingLeft: '10px', font: `10.5px ${mono}`, color: faint },
  '.cm-who-model, .cm-who-note': { font: `10.5px ${mono}`, color: muted },
  '.cm-who-req': { color: muted, borderLeft: `2px solid ${agent}`, paddingLeft: '8px', marginTop: '3px', display: '-webkit-box', WebkitLineClamp: '3', WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },

  // problems: a quiet red line, a dot in the gutter
  '.cm-problem-line': { backgroundColor: mix(bad, 9), boxShadow: `inset 2px 0 0 ${bad}` },
  '.cm-problem-gutter': { width: '14px' },
  '.cm-problem-gutter .cm-gutterElement': { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0' },
  '.cm-problem-dot': { display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', backgroundColor: bad },

  // what an agent just changed
  '.cm-recent': { borderRadius: '2px' },
  '.cm-recent-add': { backgroundColor: mix(ok, 15) },
  '.cm-recent-del': { backgroundColor: mix(bad, 15), textDecoration: 'line-through', textDecorationColor: mix(bad, 70) },
  '.cm-recent-fade': { animation: 'cm-recent-fade var(--ttl, 6000ms) ease-in forwards' },
  '.cm-recent-tick': { display: 'inline-block', width: '0', height: '1.15em', borderLeft: `2px solid ${bad}`, margin: '0 -1px', verticalAlign: 'text-bottom' },
  '.cm-flash-line': { animation: 'cm-flash-line 1.4s ease-out' },
  '@keyframes cm-recent-fade': { to: { backgroundColor: 'transparent', textDecorationColor: 'transparent' } },
  '@keyframes cm-flash-line': { from: { backgroundColor: mix(agent, 30) }, to: { backgroundColor: 'transparent' } },

  // other people's carets and selections; --c is always a colour this file built from numbers, never raw peer text
  '.cm-rsel': { backgroundColor: 'color-mix(in srgb, var(--c) 26%, transparent)', borderRadius: '2px' },
  '.cm-rc': { position: 'relative', borderLeft: '2px solid var(--c)', marginLeft: '-1px', marginRight: '-1px', boxSizing: 'border-box' },
  '.cm-rc::after': { content: '""', position: 'absolute', left: '-6px', right: '-6px', top: '0', bottom: '0' }, // a wider target for the hover
  '.cm-rc-label': { position: 'absolute', left: '-2px', bottom: '100%', zIndex: '5', font: `600 10px/1.5 ${font}`, padding: '0 6px', borderRadius: '5px 5px 5px 0', whiteSpace: 'nowrap', userSelect: 'none', backgroundColor: 'var(--c)', color: 'var(--ink)', animation: 'cm-rc-fade 250ms ease 3500ms forwards' },
  '.cm-rc.is-agent': { '--c': agent, '--ink': 'var(--bg, #131314)' },
  '.cm-rc:hover .cm-rc-label, .cm-rc-label:hover': { animation: 'none', opacity: '1' }, // idle labels fade out but stay on hover
  '@keyframes cm-rc-fade': { to: { opacity: '0' } },
  '@media (prefers-reduced-motion: reduce)': {
    '.cm-rc-label': { animationDuration: '1ms' },
    '.cm-recent-fade': { animationDuration: '1ms' },
    '.cm-flash-line': { animation: 'none', backgroundColor: mix(agent, 18) }
  }
})

const syntax = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.tagName], color: 'var(--sx-kw)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.docString], color: 'var(--sx-str)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.integer, t.float], color: 'var(--sx-num)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: faint, fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: 'var(--sx-fn)' },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)], color: 'var(--sx-type)' },
  { tag: [t.attributeName, t.propertyName], color: 'var(--sx-type)' },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator, t.meta], color: muted },
  { tag: t.heading, fontWeight: '600', color: 'var(--sx-fg)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: agent },
  { tag: t.invalid, color: bad }
])

export const highlighting = syntaxHighlighting(syntax)
