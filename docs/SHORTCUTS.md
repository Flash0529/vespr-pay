# Shortcuts and macros

Every VESPR action is a **named command** with a stable ID, so it works from the Command Palette, from a key, from a `keybindings.json` entry with arguments, and from any macro tool that can press keys or call VS Code commands (Keyboard Maestro, AutoHotkey, BetterTouchTool, Raycast, Stream Deck). Nothing needs the mouse.

Default keys use a chord: press **Ctrl+Alt+M** (**Cmd+Alt+M** on a Mac), release, then one letter. Rebind any of them in *Keyboard Shortcuts* (search "VESPR").

| Keys after the prefix | Command ID | What it does |
|---|---|---|
| `c` | `murmio.chat` | Open the team chat |
| `m` | `murmio.codemap` | Show the Code Map (files, imports, symbols, who wrote what) |
| `a` | `murmio.approve` | Approve the newest pending agent request |
| `d` | `murmio.deny` | Deny the newest pending agent request |
| `u` | `murmio.runIt` | Ask the agent to start the project and post a preview link |
| `k` | `murmio.askAgent` | Ask the agent (input box, pre-filled with `@coder `) |
| `t` | `murmio.say` | Say something in the team chat |
| `s` | `murmio.mode` | Pick the agent mode (manual, acceptEdits, auto, plan, bypass) |
| `w` | `murmio.catchUp` | Catch me up on what happened while I was away |
| `r` | `murmio.replay` | Replay this session |
| `l` | `murmio.lens` | Toggle the authorship lens |
| `g` | `murmio.commit` | Commit the workspace to git |
| `p` | `murmio.people` | Who is here |
| `f` | `murmio.follow` | Follow a collaborator |

## Commands that take arguments (for macros)
Bind them in `keybindings.json`:
```json
[
  { "key": "ctrl+alt+1", "command": "murmio.say", "args": "@coder run the tests" },
  { "key": "ctrl+alt+2", "command": "murmio.askAgent", "args": { "agent": "coder", "text": "explain the Code Map overview" } },
  { "key": "ctrl+alt+3", "command": "murmio.mode", "args": "plan" },
  { "key": "ctrl+alt+4", "command": "murmio.mode", "args": "acceptEdits" }
]
```
- `murmio.say` takes a string or `{ "text": "..." }`.
- `murmio.askAgent` takes a string or `{ "agent": "coder", "text": "..." }` and adds the `@agent` mention for you.
- `murmio.mode` takes one of `manual`, `acceptEdits`, `auto`, `plan`, `bypass`; with no argument it shows a picker.
- `murmio.approve` and `murmio.deny` answer only the newest pending card and say so in the status bar when there is none.

## Limits
- A browser may keep some Ctrl+Alt combinations for itself; if a chord does nothing, rebind it. In the desktop app and on a Mac the defaults work.
- Chords are a convention, not a promise: the stable part is the command IDs above.
- Tested: the approve/deny path and the keybinding table (`extensions/murmio-collab/test/shortcuts.test.js`). Not yet tried in a real browser on his PC.
