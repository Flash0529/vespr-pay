#!/bin/bash
# Only the server process may hold PayPal credentials. Starts a throwaway demo stack (scripts/demo-stack.sh, the same script scripts/paypal-real-check.sh uses) with FAKE PayPal variables in
# the environment, then reads the environment of every process the stack started: the SERVER must have the credentials (so this test cannot pass for the wrong reason), and the agent, the web
# server and anything they started must have none of them. Linux only (/proc). Nothing is contacted: the fake keys are never used, no PayPal call is made.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd); D=$(mktemp -d /tmp/vespr-envtest-XXXXXX); fails=0
cleanup() { VESPR_DEMO_DIR=$D VESPR_DEMO_PORT=$P "$ROOT/scripts/demo-stack.sh" stop >/dev/null 2>&1; rm -rf "$D" "$D.start.log"; }
trap cleanup EXIT
# three free ports in a row
P=0; for try in $(seq 1 40); do c=$((9800 + (RANDOM % 80) * 4)); if ! ss -ltn 2>/dev/null | grep -qE ":($c|$((c + 1))|$((c + 2))) "; then P=$c; break; fi; done
[ "$P" != 0 ] || { echo "demo stack env test FAILED: no free ports"; exit 1; }
FAKE_ID="envtest-id-$(openssl rand -hex 6)"; FAKE_SECRET="envtest-secret-$(openssl rand -hex 6)"
( export PAYPAL_CLIENT_ID=$FAKE_ID PAYPAL_CLIENT_SECRET=$FAKE_SECRET PAYPAL_API_BASE=https://api-m.sandbox.paypal.com PAYPAL_BUYER_EMAIL=buyer@example.test PAYPAL_BUYER_PASSWORD=envtest-password
  VESPR_DEMO_DIR=$D VESPR_DEMO_PORT=$P "$ROOT/scripts/demo-stack.sh" start >"$D.start.log" 2>&1 ) 
names() { tr '\0' '\n' < "/proc/$1/environ" 2>/dev/null | cut -d= -f1; }
holds() { names "$1" | grep -E '^PAYPAL_' | tr '\n' ' '; }
check() { # name pidfile must-hold
  local pid; pid=$(cat "$D/$2.pid" 2>/dev/null)
  if [ -z "$pid" ] || [ ! -d "/proc/$pid" ]; then echo "FAIL  $1: not running ($2.pid)"; fails=$((fails + 1)); return; fi
  local h; h=$(holds "$pid")
  if [ "$3" = yes ]; then
    if echo "$h" | grep -q PAYPAL_CLIENT_ID && echo "$h" | grep -q PAYPAL_CLIENT_SECRET; then echo "ok    $1 (pid $pid) holds the PayPal credentials, as it must"; else echo "FAIL  $1 (pid $pid) lacks them: the test could not tell anything; holds: ${h:-nothing}"; fails=$((fails + 1)); fi
  else
    if [ -z "$h" ]; then echo "ok    $1 (pid $pid) holds no PayPal variable"; else echo "FAIL  $1 (pid $pid) carries PayPal variables: $h"; fails=$((fails + 1)); fi
  fi
  # everything it started (children, grandchildren) too
  for c in $(pgrep -P "$pid" 2>/dev/null); do local hc; hc=$(holds "$c"); [ "$3" = no ] && [ -n "$hc" ] && { echo "FAIL  $1's child $c carries: $hc"; fails=$((fails + 1)); }; done
}
check "the server" server yes
check "the agent" agent no
check "the web server" web no
# the values themselves must not be in the agent's or the web server's environment under any name
for s in agent web; do pid=$(cat "$D/$s.pid" 2>/dev/null); if [ -n "$pid" ] && tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | grep -qF -e "$FAKE_ID" -e "$FAKE_SECRET"; then echo "FAIL  the $s environment contains a credential value"; fails=$((fails + 1)); fi; done
if [ $fails -eq 0 ]; then echo "demo stack env tests passed: only the server process holds the PayPal credentials; the agent, the web server and their children hold none"; exit 0; fi
echo "demo stack env test FAILED ($fails): see above; $(tail -2 "$D.start.log" 2>/dev/null | tr '\n' ' ')"; exit 1
