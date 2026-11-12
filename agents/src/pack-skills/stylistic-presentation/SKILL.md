---
name: stylistic-presentation
description: Present technical explanations, analysis, and execution plans with clean visual structure: ASCII diagram boxes, structured summary tables, small text charts, status pills, and clear checklists. Use whenever summarizing complex architectures, plans, or test results.
---
# Stylistic Technical Presentation

Follow these presentation standards when communicating architectural plans, execution summaries, or technical breakdowns in the team chat:

1. **Visual Framing & Diagrams**
   - Visual architecture should use clean ASCII / Unicode block diagrams:
     ```
     ┌─────────────────┐       ┌─────────────────┐
     │  Client Buffer  ├──────►│   Room Server   │
     └─────────────────┘       └─────────────────┘
     ```
   - Use Markdown tables for metrics, comparisons, and status inventories.
   - Keep diagrams compact and readable on mobile and tablet viewports.

2. **Clear Status Indicators**
   - Use recognizable indicators rather than verbose explanations:
     - `✓` for verified states
     - `!` for items requiring attention
     - `•` for structured list items
   - When citing line changes or test outcomes, give exact numbers: `Ran 3 tests in 0.002s (all green)`.

3. **Small Charts and Symbols**
   - A quick chart in chat is a Markdown table with a text bar scaled to the largest value (`████░░░░ 40`), or a short list with `✓` / `!` marks. It renders everywhere.
   - A chart or box diagram as a picture is an SVG text file made with `write_file` (text, so it is in the workspace). Show it with `{{image:chart.svg|big}}` (or `{{image:chart.svg}}` for a small tile) on its own line. Say it is a file you wrote; do not say you have seen it rendered unless a tool showed you. A PNG a command makes is not shared back, so it cannot be shown.
   - Keep comments in code short and about why, not what.

4. **File Referencing Convention**
   - Whenever introducing a file created, edited, or inspected, place `{{file:path}}` on its own line immediately after the sentence that mentions it. This signals the SDE shell to draw an interactive file chip.

5. **Brevity & Organization**
   - Lead with the outcome in the first sentence.
   - Break complex answers into 3 to 5 numbered steps or logical sections with horizontal dividers (`---`).
   - Avoid walls of unstyled plain text.
