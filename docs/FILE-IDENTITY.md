# File identity and rename

Renaming a file changes its name, not its shared text object. Copying a `Y.Text` and deleting its original map entry discards edits that a disconnected peer still sends to that original object.

`app/file-store.js` exposes the path-oriented file interface used by the app, agents, server and extension:

- `get`, `has`, iteration, `set` and `delete` work with visible workspace paths.
- `rename(moves)` updates all names in one transaction. It preserves the exact `Y.Text`, formatting attributes and relative positions.
- `observe` reports logical keys and a batch of identity-preserving renames.
- `pathFor(text)` resolves a shared text object to its current visible name.
- `conflicts()` identifies concurrent filename conflicts and their recovery paths.

The `files` map remains the content store. Existing documents retain their original content keys without copying or deleting text. The `filePaths` map gives each content key its current filename. Supported new files receive unique storage keys so simultaneous creates cannot overwrite each other. Storage keys are internal and must never be used as filenames.

If concurrent operations request the same name, or request a file and a folder at the same path, the projection deterministically retains one requested name and exposes the other content under `.vespr-conflicts/`. The recovery directory is chosen outside existing requested roots. Both contents remain available, and the app reports the conflict. A filename conflict does not authorize deleting either copy.

An explicit delete still deletes the content. The rename fix does not introduce hidden retention of deleted files.

## Compatibility and rollout

The server advertises `settings.fileStoreVersion = 1`. New code keeps legacy path-key creation when this capability is absent and refuses rename with an upgrade message. This marker describes the document format; it is not an authorization check.

Upgrade the server, browser app, agents and standalone extension together before enabling the new rename behavior. An older peer that still holds an existing text object can contribute offline edits to that object after a rename. An older peer's own clone-and-delete rename implementation remains unsafe and must be upgraded. This patch does not make obsolete code safe.

Do not roll the server back while retaining a new-format document and expect old readers to understand it. Preserve the latest document and obtain an export with the matching reader before planning any downgrade. No migration, rollback or deployment is automatic.

Read logical files through `fileStore(doc)`, `client.files`, or `client.fileText(path)`. Direct `doc.getMap('files')` is reserved for storage internals and deliberate legacy-data fixtures. Server tree export, Git, snapshots, replay and recording helpers use the logical view. Existing snapshot exclusions still apply, including to dot-folders containing conflict recovery files.

VS Code installs the extension directory on its own. Its `lib/file-store.cjs` is a mechanical CommonJS copy of the browser module. The identity test verifies exact correspondence; update both copies together.

## Open editor behavior and validation

The browser applies remote rename batches to its active file and open tabs together. The extension keeps a bound old-path buffer connected to the same text and announces the new filename. It preserves that old local buffer instead of deleting it while the person may still be typing; it does not silently rename a dirty VS Code buffer. Open the new path when ready. Installed VS Code behavior requires a host acceptance check before release.

Focused tests cover disconnected edit/rename, reordered updates, simultaneous renames, simultaneous creates, path reuse, file/folder conflicts, cursor references, authorship, persistence reload, logical notifications and legacy compatibility. Real loopback tests exercise the client/agent/server path, renamed tree export, Git round trip, snapshot selection and replay after rename.

The server's old exported-disk-file cleanup limitation is separate: this patch exports current logical paths, but does not delete stale renamed paths or foreign local files. No full-suite, installed-extension, Safari or deployment approval follows from focused tests alone.
