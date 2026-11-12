---
name: google-workspace
description: Manage and automate Google Docs, Sheets, Slides, and Drive files. Covers atomic batch updates, UTF-16 position offsets, revision guarding, spreadsheet number formatting, and safe file operations.
---
# Google Workspace Automation & Integration

Follow these engineering rules when programmatically reading, creating, and modifying Google Docs, Sheets, and Slides documents.

## Core Rules for Document Modification

1. **In-Place File Edits:**
   - Always modify the existing file and preserve its URL rather than creating duplicate copies.
   - Never trash or delete files unless explicitly instructed by the user.

2. **Atomic Batch Requests & Revision Guards:**
   - Send modification requests in single atomic batches (`batchUpdate`) so all changes succeed or fail together.
   - Guard against concurrent edits: use `writeControl.requiredRevisionId` on Docs and Slides requests based on a fresh read. If rejected due to a revision mismatch, re-fetch the latest document state and re-calculate positions.

3. **Position Offsets & Formatting:**
   - **Google Docs:** Positions are 0-based UTF-16 character indices. Text insertions shift all subsequent indices; sort edits in reverse document order (end-to-beginning) when sending multiple inserts.
   - **Google Sheets:** Explicitly specify numeric sheet IDs, 0-based row/column coordinates, and comma-separated field masks (e.g. `userEnteredFormat.numberFormat`). Never pass unescaped formulas that could lead to formula injection.
   - **Google Slides:** Coordinates and dimensions use EMUs (English Metric Units; 1 inch = 914,400 EMUs, 1 pt = 12,700 EMUs). Ensure text boxes account for font scaling.

4. **Post-Write Verification:**
   - Always perform a verification read after executing batch updates to confirm that data and formatting applied correctly.

