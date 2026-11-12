#!/bin/bash
# Writes VESPR settings from the environment, installs the extension, seeds the workspace, starts VS Code.
set -eu
: "${MURMIO_TOKEN:?}" "${MURMIO_USER:?}" "${IDE_TOKEN:?}"
SETTINGS="$HOME/.openvscode-server/data/Machine"
mkdir -p "$SETTINGS" "$HOME/ext"
cat > "$SETTINGS/settings.json" <<JSON
{
  "murmio.server": "${MURMIO_SERVER:-ws://collab:8241}",
  "murmio.room": "${MURMIO_ROOM:-demo}",
  "murmio.token": "${MURMIO_TOKEN}",
  "murmio.userName": "${MURMIO_USER}",
  "workbench.startupEditor": "none",
  "security.workspace.trust.enabled": false,
  "security.workspace.trust.startupPrompt": "never",
  "chat.disableAIFeatures": true,
  "extensions.ignoreRecommendations": true,
  "workbench.tips.enabled": false,
  "telemetry.telemetryLevel": "off",
  "files.autoSave": "afterDelay",
  "workbench.colorTheme": "${MURMIO_THEME:-Default Dark Modern}",
  "editor.minimap.enabled": false,
  "editor.folding": false,
  "editor.glyphMargin": false,
  "editor.renderLineHighlight": "none",
  "editor.cursorBlinking": "solid",
  "editor.cursorSmoothCaretAnimation": "off",
  "editor.scrollbar.verticalScrollbarSize": 8,
  "editor.guides.indentation": false,
  "breadcrumbs.enabled": false,
  "editor.fontSize": 14,
  "workbench.layoutControl.enabled": false,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "editor.inlineSuggest.enabled": true
}
JSON
chmod 600 "$SETTINGS/settings.json"
# the trust prompt is only honored from user-level settings in the browser build, so write them there too
mkdir -p "$HOME/.openvscode-server/data/User"
cp "$SETTINGS/settings.json" "$HOME/.openvscode-server/data/User/settings.json"
rm -f "$HOME/ext/extensions.json"; rm -rf "$HOME/ext/murmio.murmio-collab-0.0.1"; mkdir -p "$HOME/ext/murmio.murmio-collab-0.0.1"
cp -r /ext-src/. "$HOME/ext/murmio.murmio-collab-0.0.1/"
if [ -z "$(ls -A /workspace 2>/dev/null)" ] && [ -d /sample ]; then cp -r /sample/. /workspace/; fi
printf '%s' "$IDE_TOKEN" > "$HOME/.ide-token"; chmod 600 "$HOME/.ide-token"
exec /opt/openvscode-server/bin/openvscode-server --host 0.0.0.0 --port 3000 \
  --connection-token-file "$HOME/.ide-token" --extensions-dir "$HOME/ext" --default-folder /workspace
