---
name: headless-chromium-checks
description: Launch headless Chromium via Chrome DevTools Protocol or Node scripts to verify page layout, inspect DOM, check console errors, test viewports, and capture high-resolution screenshots.
---
# Headless Chromium Checks

Use headless Chromium in the sandbox runner or automated test scripts to verify web applications and visual pages before reporting completion.

## First: is a browser here?

Run `which chromium chromium-browser google-chrome` (it only reads). The standard VESPR sandbox image does not include a browser. If nothing is found:
- Say so plainly. Do not report a page as checked when it was not.
- Offer what you can do instead: read the HTML and CSS and reason about the layout, run the project's own tests, or ask the room to pick a runner on a machine that has Chromium.
- Screenshots and other binary files a command makes are not shared back into the workspace, so report what you measured as text (viewport widths, overflow in pixels, console errors, failed requests).

## Headless Launch Flags

When spawning Chromium without an X display (e.g., in a Linux container or server environment), always provide these required flags:
- `--headless` or `--headless=new`
- `--disable-gpu`
- `--no-sandbox`
- `--disable-dev-shm-usage`
- `--remote-debugging-port=<PORT>` (when driving via CDP)
- `--window-size=1440,900`

## Verification Checklist

1. **Console & Error Zero-Tolerance**:
   - Collect every `console.error`, uncaught exception, and HTTP 4xx/5xx network response.
   - Any unhandled runtime error is a regression that must be diagnosed from the stack trace and fixed.

2. **Responsive Breakpoints & Layout Overflow**:
   - Check pages across 4 target viewports:
     - 1440px (Desktop wide)
     - 1024px (Tablet landscape / small laptop)
     - 768px (Tablet portrait)
     - 375px (Mobile portrait)
   - Ensure horizontal document overflow is strictly 0px:
     `document.documentElement.scrollWidth <= window.innerWidth`.

3. **DOM & Asset Integrity**:
   - Verify all `<img>` tags load completely (`img.naturalWidth > 0`).
   - Check critical interactive elements: focus trap on open modals, ARIA attributes, semantic landmarks (`<main>`, `<nav>`, `<header>`).

4. **Visual Capture**:
   - Capture clean PNG screenshots of key states: initial load, modal open, form validation errors, dark and light theme toggles.
   - Use standard full-page or clip dimensions to document changes clearly in the workspace.
