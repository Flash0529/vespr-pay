# VESPR for VS Code

Live multiplayer editing with people **and AI agents**: named cursors, a shared team chat, room-wide approvals for what agents may do, who-wrote-what on every line, session replay, inline suggestions, and a catch-up digest.

Everything below happens in the **VESPR** side-bar panel and the editor:

- **Shared editing**: everyone, people and agents, has a cursor with a name. "VESPR: Who is here" lists them; pick someone to follow.
- **Team chat**: mention an agent (`@coder ...`). Its work streams into everyone's chat.
- **Modes**: Manual, Accept edits, Auto, Plan, Bypass. Approve / Deny cards are shared; the first answer wins and is attributed.
- **Authorship**: hover a line for who wrote it and why; "Authorship" tints text by author.
- **Replay**: rewind edits, cursors, chat and approvals.
- **Runs on**: the agent sandbox, a cloud machine, or a teammate's computer (the owner is asked first).
- **Commit**: snapshot to git with a message written from who did what and why. Clone and push with any git client.
- **Suggestions**: ghost text that also knows what teammates and agents just did.

Settings: `murmio.server`, `murmio.room`, `murmio.token`, `murmio.userName`, `murmio.suggestions`. Run "VESPR: Welcome and walkthrough" for a tour.
