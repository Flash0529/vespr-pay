#!/bin/bash
# Run from your own machine (it needs ssh access to the VM). Sends the judge demo to the VM and starts it. No secret is printed.
#   ../judge/deploy-to-vm.sh USER@VM_IP [SSH_KEY]        (make-env.sh DOMAIN must have been run first)
set -eu
TARGET=${1:?usage: deploy-to-vm.sh USER@HOST [SSH_KEY]}; KEY=${2:-${SSH_KEY:-$HOME/.ssh/id_ed25519}}
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
[ -f "$HERE/.env" ] && [ -f "$HERE/tokens" ] || { echo "run ./make-env.sh DOMAIN first"; exit 1; }
DOMAIN=$(grep '^DOMAIN=' "$HERE/.env" | cut -d= -f2-)
SSH=(ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$TARGET")
"${SSH[@]}" 'echo ssh-ok' >/dev/null || { echo "cannot ssh to $TARGET with $KEY: is the public key added to the VM and the public IP right?"; exit 1; }
STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/deploy/judge"
tar -C "$ROOT" --exclude=node_modules --exclude='*.bak-*' --exclude=.git --exclude='deploy/judge/.env' --exclude='deploy/judge/tokens' --exclude='deploy/judge/sample' -cf - server agents ide extensions/murmio-collab sample-project app site deploy/judge | tar -C "$STAGE" -xf -
mkdir -p "$STAGE/deploy/judge/sample" && cp -r "$ROOT/sample-project/." "$STAGE/deploy/judge/sample/" && cp "$HERE/TRY-ME.md" "$STAGE/deploy/judge/sample/TRY-ME.md"
# refuse to send anything that contains a real secret value or a key-shaped string (the .env and tokens go separately, on purpose)
python3 "$ROOT/scripts/check-secrets.py" --dir "$STAGE" || { echo "refusing to deploy: a secret is in the bundle"; exit 1; }
tar -C "$STAGE" -czf - . | "${SSH[@]}" 'mkdir -p ~/murmio && tar -C ~/murmio -xzf -'
"${SSH[@]}" 'sudo chown "$USER" ~/murmio/deploy/judge/tokens ~/murmio/deploy/judge/.env 2>/dev/null || true'   # a previous deploy handed the tokens file to uid 1000; take it back so it can be replaced
scp -q -i "$KEY" -o StrictHostKeyChecking=accept-new "$HERE/.env" "$HERE/tokens" "$TARGET:murmio/deploy/judge/"
"${SSH[@]}" 'chmod 600 ~/murmio/deploy/judge/.env ~/murmio/deploy/judge/tokens && sudo chown 1000:1000 ~/murmio/deploy/judge/tokens && bash ~/murmio/deploy/judge/bootstrap-vm.sh'   # the containers read the tokens file as uid 1000, but a VM user can have another uid (1001 on Nebius Ubuntu): give the file to uid 1000, still mode 600
# the SDE extension needs its npm packages (ws, yjs, y-websocket); node_modules is not shipped, and the VM has no Node, so install them with the SDE image's own npm (found missing on 2026-10-28: the judge SDE had no VESPR chat)
"${SSH[@]}" 'cd ~/murmio/deploy/judge && sudo docker compose build ide-judge1 >/dev/null && sudo docker run --rm --user 0 -v "$HOME/murmio/extensions/murmio-collab:/x" -w /x --entrypoint npm murmio-judge-ide-judge1 ci --omit=dev --no-audit --no-fund 2>&1 | tail -2'
"${SSH[@]}" 'cd ~/murmio/deploy/judge && sudo docker compose up -d --build --force-recreate' 
echo "started; waiting for https://collab.$DOMAIN/healthz ..."
for i in $(seq 1 60); do if curl -fsS -m 8 "https://collab.$DOMAIN/healthz" >/dev/null 2>&1; then echo "UP: https://collab.$DOMAIN is answering"; exit 0; fi; sleep 10; done
echo "not answering yet: check DNS for collab/judge1/judge2.$DOMAIN and 'sudo docker compose logs caddy' on the VM"; exit 1
