---
name: frontend-review
description: Review front-end code for correctness, state handling, performance and maintainability before it ships. Use for components, pages and styling changes.
---
# Front-end review

Read the diff first, then run or open the page if you can. Check, in this order:

- **Does it do what was asked** at 375, 768 and 1440 px wide, in light and dark if both exist? Look at it in a browser (a screenshot counts) rather than trusting the code.
- **State:** one source of truth per fact; no state copied from props without a reason; loading, empty and error states exist and read well; double clicks and fast typing do not break it.
- **Effects and events:** every listener, timer, observer and subscription is cleaned up; no work on every scroll or mouse move without throttling; no layout thrash (read then write).
- **Performance:** images sized and lazy-loaded; no large library for one function; lists that can grow are virtualised or paged; expensive effects stop when off screen; animate `transform` and `opacity`, not layout; avoid heavy blur or glow over animated backgrounds.
- **Styling:** tokens (colours, spacing, type) instead of one-off values; no `!important` unless overriding third-party code; responsive by default, not by patches.
- **Security:** user text goes through the framework's escaping, never `innerHTML`; links that open new tabs use `rel="noopener"`; nothing secret in client code.
- **Tests:** at least one test or scripted check for the new behaviour. If none was written, say so.

Report findings as a short list ordered by impact: what is wrong, where, the fix. Do not rewrite code that was not part of the change.
