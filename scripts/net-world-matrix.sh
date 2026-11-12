#!/bin/bash
# Runs agents/tools/net-world.mjs for several pairs of networks on a throwaway local stack (127.0.0.1 only, demo agents, no model key)
# and prints one line per pair. Each pair gets its own room with a top agent "lead" and a worker "fe". Nothing is left running.
#   scripts/net-world-matrix.sh [dir]        dir: a scratch folder (default /var/tmp/vespr-net-world); results in dir/results.jsonl
#   NET_PAIRS="lan:lan far:mobile"           pairs to run (default: a spread from same building to satellite and flaky Wi-Fi)
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd); D=${1:-/var/tmp/vespr-net-world}; PORT=${NET_PORT:-9631}
PAIRS=${NET_PAIRS:-"lan:lan region:continent far:far mobile:satellite flaky:far"}
mkdir -p "$D"; chmod 700 "$D"; umask 077; rm -rf "$D/results.jsonl" "$D/data" # a fresh server every run: old rooms must not answer for new ones
for n in maya dev sam priya observer lead fe; do grep -q "^$n:" "$D/tokens" 2>/dev/null || printf '%s:%s\n' $n "$(openssl rand -hex 12)" >> "$D/tokens"; done
echo '[{"name":"lead","maker":"maya","ceiling":"manager"},{"name":"fe","parent":"lead","maker":"maya"}]' > "$D/tree.json"
ss -ltn | grep -q "127.0.0.1:$PORT " && { echo "port $PORT is busy: set NET_PORT"; exit 1; }
mine () { for p in $(pgrep -u "$(id -un)" -f "$1"); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -q "^NET_WORLD_RUN=$D\$" && echo $p; done; }
stop () { for p in $(mine "$1"); do kill $p 2>/dev/null; done; }
trap 'stop agents/index.js; stop server/index.js' EXIT
( cd "$ROOT" && NET_WORLD_RUN=$D MURMIO_PORT=$PORT MURMIO_HOST=127.0.0.1 MURMIO_DATA="$D/data" MURMIO_TOKENS_FILE="$D/tokens" setsid nohup node server/index.js > "$D/server.log" 2>&1 < /dev/null & )
sleep 1.5
i=0; for pair in $PAIRS; do
  i=$((i + 1)); room="net-$(date +%H%M%S)-$i-${pair/:/-}"; m=${pair%%:*}; v=${pair##*:}
  sp=$((PORT + 1)); for a in lead fe; do role=""; [ $a = lead ] && role="AGENT_ROLE=manager"
    ( cd "$ROOT" && env -u NEBIUS_API_KEY NET_WORLD_RUN=$D $role MANAGER_TICK_SEC=3 VESPR_AGENT_TREE="$D/tree.json" MURMIO_SERVER=ws://127.0.0.1:$PORT MURMIO_ROOM=$room MURMIO_TOKEN="$(grep "^$a:" "$D/tokens" | cut -d: -f2)" AGENT_NAME=$a SUGGEST_PORT=$sp MURMIO_PUBLIC_URL=http://127.0.0.1:$PORT setsid nohup node agents/index.js > "$D/agent-$a-$i.log" 2>&1 < /dev/null & ); sp=$((sp + 1))
  done
  sleep 6
  # NET_DUOS=2: a second duo (sam + priya, networks swapped) works in the same room at the same moment: stress for the server and the agents
  ( cd "$ROOT/agents" && timeout 240 node tools/net-world.mjs --server ws://127.0.0.1:$PORT --room "$room" --tokens "$D/tokens" --maya "$m" --dev "$v" --agents --out "$D/results.jsonl" > "$D/run-$i.out" 2>&1 ) & first=$!
  if [ "${NET_DUOS:-1}" = 2 ]; then
    ( cd "$ROOT/agents" && timeout 240 node tools/net-world.mjs --server ws://127.0.0.1:$PORT --room "$room" --tokens "$D/tokens" --a-name sam --b-name priya --maya "$v" --dev "$m" --agents --out "$D/results.jsonl" > "$D/run-$i-b.out" 2>&1 ) & second=$!
    wait $second; echo "$(date +%T) $pair (sam+priya, same room, same time): exit $? $(tail -c 200 "$D/run-$i-b.out" | grep -o '"pass":[a-z]*')"
  fi
  wait $first; echo "$(date +%T) $pair (maya+dev): exit $? $(tail -c 200 "$D/run-$i.out" | grep -o '"pass":[a-z]*')"
  stop agents/index.js; sleep 1
done
