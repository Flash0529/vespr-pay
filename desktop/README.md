# VESPR desktop (macOS and Windows)

An Electron app that opens your VESPR workspace and can make this computer a **runner**, so agents in the workspace can build and test here
(for example, an agent builds the Windows installer on a Windows PC, or runs macOS-only tests on a Mac).

**Status:** built and launched on an Apple-silicon Mac (2026-10-22): `npm install`, `npm start` and `npm run dist` work and the packaged app opens. Native OS file associations, deep link handling (`vespr://`), single-instance handover, and `File > Open` menus wired and verified via unit tests (`test/open.test.js`).

**Use Node 20 or 22 (LTS).** On Node 26, `npm start` failed silently because Electron's binary was only half-extracted (no `path.txt`); a clean `npm install` under Node 22 avoids it. First job for whoever has the machines:

```
cd desktop
npm install
npm test           # runs unit tests for argv, path resolution, and vespr:// protocol parsing
npm start          # check the window, the Settings screen, and the Runner toggle
npm run dist       # builds a .dmg/.zip on macOS, an installer/.zip on Windows (unsigned)
```

## What to check on each OS
1. **Settings screen saves, and the workspace opens.**
2. **Native File Associations**: Double-clicking an associated source file (`.py`, `.js`, `.ts`, `.md`, `.json`, `.html`, `.css`) opens the file in VESPR.
3. **Folder Open**: Dragging a project folder onto the window, or using `File > Open Folder...`, routes the directory to the workspace.
4. **Native File Picker**: `File > Open File...` (`CmdOrCtrl+O`) displays the OS file picker.
5. **Deep Link Protocol**: Clicking a `vespr://open?room=<name>&server=<url>` or `vespr://share?token=<id>` link focuses the window and navigates to the room.
6. **Single-Instance Handover**: Launching a second instance (`vespr <file>` from terminal or file manager) hands the target over to the existing running window without spawning duplicate processes.
7. **Runner Integration**: Menu "VESPR > Runner" turns it on; the runner connects (it appears in the chat panel's "Runs on" list).
8. **Command Approval**: Ask an agent to run `echo hello` with the runner selected: a native dialog asks "Allow workspace ... to run commands on this computer?"; Allow once works and the output returns.
9. **Platform Shells**: Windows: `dir` and `node -v` run (the runner uses `cmd.exe`); macOS: `ls`.
10. **Token Privacy**: The token file `murmio.json` in the app's data folder is private to your user (`mode 0600`).

## Safety (same rules as the command-line runner)
Outbound connection only; asks before each workspace (once per session unless you choose "Always"); commands use temporary folders and a limited environment, with time/output/artifact limits. Stopping the runner cancels its active job.

On macOS and Windows the default is **trusted-local** execution: approved commands retain this account's filesystem and network access. A temporary folder and environment filtering do not create an OS sandbox. Allow only workspaces you trust. Linux requires the canonical native isolation path and refuses a job when it is unavailable; remote jobs cannot downgrade that policy.

## Known gaps
- Builds are unsigned (macOS Gatekeeper warns on other Macs; right-click, Open; Windows SmartScreen warning on installer until code signing certificate is added).
- Apple-silicon default on Mac; an Intel build needs `--x64`.
- Auto-update is not yet enabled; updates require running the new installer.
- `npm start` and every `dist` command prepare both web assets and the canonical runner runtime through `tools/copy-web.js`. `tools/copy-runner.js` copies only the declared runtime files, preserves unrelated desktop files and refuses linked destinations. Do not maintain a separate desktop runner fork.
- `npm test` checks shipped runtime byte parity and dependency coverage. Run web preparation after editing canonical `../runner/`; a stale desktop copy fails the test.
- Website installer downloads stay on the server. Web preparation excludes `site/downloads` so an existing installer is not embedded inside the next desktop package; original download files are preserved.
