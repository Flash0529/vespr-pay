---
name: web-accessibility
description: Check a web page or component against practical accessibility rules: keyboard, focus, labels, contrast, motion, headings. Use when building or reviewing UI.
---
# Web accessibility check

Work through this list on the actual markup, not from memory. Report each failure with the file and line, and fix the ones in scope.

1. **Keyboard:** every interactive thing is reachable with Tab, in a sensible order, and works with Enter/Space. No keyboard traps. Custom widgets use real `button`, `a`, `input` first; ARIA only when no native element fits.
2. **Focus:** a visible focus style on everything focusable (do not remove outlines without replacing them). Dialogs move focus in, trap it, and return it on close; Esc closes.
3. **Names:** every control has an accessible name (visible label, `aria-label` only for icon buttons). Images have `alt` (empty `alt=""` when decorative). Inputs have `<label for>`.
4. **Structure:** one `h1`, headings in order, landmarks (`header`, `nav`, `main`, `footer`), lists as lists, tables with `th scope`.
5. **Contrast and colour:** text 4.5:1 (large text 3:1), UI parts 3:1. Colour is never the only signal (add text or an icon). Check both themes if there are two.
6. **Motion and media:** respect `prefers-reduced-motion`; nothing flashes more than 3 times a second; video has captions, audio has a transcript.
7. **Forms and errors:** errors say what is wrong and how to fix it, are tied to the field (`aria-describedby`), and are announced (`aria-live="polite"`). Do not rely on placeholder text as the label.
8. **Zoom and touch:** the page works at 200% zoom and 320 px width with no horizontal scroll; touch targets are at least 24x24 CSS px (44 where there is room).

Finish with a short list: what failed, what you fixed, what is left and why. Say plainly what you could not check (screen readers, real devices).
