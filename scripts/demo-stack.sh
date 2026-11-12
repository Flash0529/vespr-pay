#!/bin/bash
# A throwaway VESPR stack on this computer, for screenshots, recording and trying things: the collab server, one agent in demo mode (no model key), the app shell,
# the sample project plus a script that fails on purpose, and made-up test tokens. Everything listens on 127.0.0.1 only and lives in one folder.
#   scripts/demo-stack.sh start     start it (VESPR_DEMO_PORT, default 9611; the agent's inline suggestions use the next port, the shell the one after)
#   scripts/demo-stack.sh url       print the app link with a throwaway test token (it only works on this stack; it is not a secret)
#   scripts/demo-stack.sh status
#   scripts/demo-stack.sh stop      stop everything and delete the folder (the tokens go with it)
# The agent answers with scripted replies and edits (that is what demo mode is) and the app's Run button is on.
# PayPal sandbox payments (docs/PAYPAL.md): export PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET before start and the agent can ask for one ("@coder pay $25 for the logo invoice"); the
# server runs with access control on (VESPR_ACCESS=1) so nobody can forge a payment card.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIR=${VESPR_DEMO_DIR:-/tmp/vespr-demo-stack-$(id -un)}
# Only the SERVER process may hold PayPal credentials. The agent, the web server and the seeding are started with these removed from their environment (anything an agent runs as this user could read it),
# so exporting the keys for the server never hands them to the agent. scripts/test-demo-stack-env.sh fails if one of them does carry them.
NOPAY="-u PAYPAL_CLIENT_ID -u PAYPAL_CLIENT_SECRET -u PAYPAL_API_BASE -u PAYPAL_BUYER_EMAIL -u PAYPAL_BUYER_PASSWORD"
P=${VESPR_DEMO_PORT:-9611}; SUG=$((P + 1)); WEB=$((P + 2)); ROOMNAME=demo
alive() { [ -f "$DIR/$1.pid" ] && kill -0 "$(cat "$DIR/$1.pid")" 2>/dev/null; }
listening() { ss -ltn 2>/dev/null | grep -q "127.0.0.1:$1 "; }
url() { echo "http://127.0.0.1:$WEB/prototype.html?live=1&server=ws://127.0.0.1:$P&room=$ROOMNAME&name=alex#token=$(cat "$DIR/tok-alex")"; }
case "${1:-}" in
  start)
    if alive server; then echo "already running (stop it first)"; exit 1; fi
    for port in $P $SUG $WEB; do listening $port && { echo "port $port is in use: set VESPR_DEMO_PORT"; exit 1; }; done
    rm -rf "$DIR"; mkdir -p "$DIR/data"; chmod 700 "$DIR"; umask 077
    A=$(openssl rand -hex 12); C=$(openssl rand -hex 12)
    KEYOPT="-u NEBIUS_API_KEY"; [ "${VESPR_DEMO_KEEP_KEY:-0}" = 1 ] && KEYOPT="" # VESPR_DEMO_KEEP_KEY=1: the agent uses the model key from your environment (a real model decides when to ask for a payment) instead of the scripted demo mode
    S2=$(openssl rand -hex 12); printf 'alex:%s\ncoder:%s\nsam:%s\n' "$A" "$C" "$S2" > "$DIR/tokens"; printf '%s' "$A" > "$DIR/tok-alex"; printf '%s' "$C" > "$DIR/tok-coder"; printf '%s' "$S2" > "$DIR/tok-sam" # sam is a second person: VESPR_PAY_ROLES=sam:student makes the classroom case
    VESPR_ACCESS=${VESPR_ACCESS:-1} MURMIO_PORT=$P MURMIO_DATA="$DIR/data" MURMIO_TOKENS_FILE="$DIR/tokens" nohup node "$ROOT/server/index.js" > "$DIR/server.log" 2>&1 &
    echo $! > "$DIR/server.pid"
    for i in $(seq 1 40); do curl -fsS -m 2 "http://127.0.0.1:$P/healthz" >/dev/null 2>&1 && break; sleep 0.25; done
    env $KEYOPT $NOPAY MURMIO_SERVER="ws://127.0.0.1:$P" MURMIO_ROOM=$ROOMNAME MURMIO_TOKEN="$C" AGENT_NAME=coder SUGGEST_PORT=$SUG MURMIO_PUBLIC_URL="http://127.0.0.1:$P" MURMIO_HUMAN_RUNS=1 nohup node "$ROOT/agents/index.js" > "$DIR/agent.log" 2>&1 &
    echo $! > "$DIR/agent.pid"
    env $NOPAY python3 -m http.server $WEB --bind 127.0.0.1 --directory "$ROOT/app" > "$DIR/web.log" 2>&1 &
    echo $! > "$DIR/web.pid"
    for i in $(seq 1 40); do grep -q "ready in room" "$DIR/agent.log" 2>/dev/null && break; sleep 0.25; done
    env $NOPAY node "$ROOT/scripts/demo-seed.mjs" "ws://127.0.0.1:$P" $ROOMNAME "$A" alex 2>&1 | tail -1
    url > "$DIR/open-url.txt"
    echo "up: shell http://127.0.0.1:$WEB/prototype.html (demo data), live link: scripts/demo-stack.sh url (also in $DIR/open-url.txt)" ;;
  url) [ -f "$DIR/tok-alex" ] || { echo "not running"; exit 1; }; url ;;
  status) for s in server agent web; do alive $s && echo "$s: up (pid $(cat "$DIR/$s.pid"))" || echo "$s: down"; done ;;
  stop)
    for s in web agent server; do [ -f "$DIR/$s.pid" ] && kill "$(cat "$DIR/$s.pid")" 2>/dev/null; done
    sleep 1; rm -rf "$DIR"; echo "stopped, folder deleted" ;;
  *) sed -n '2,10p' "$0" ;;
esac
