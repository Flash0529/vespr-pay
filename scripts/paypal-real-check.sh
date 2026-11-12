#!/bin/bash
# The whole VESPR product against the REAL PayPal sandbox, on a throwaway local stack, with one person paying once as the sandbox buyer. Test money only.
#   scripts/paypal-real-check.sh                 PayPal sends the buyer back to http://127.0.0.1:<port> (works only if the buyer's browser is on this machine)
#   scripts/paypal-real-check.sh 10.0.0.8     an address the BUYER's browser can reach this machine on: PayPal then sends him back to VESPR's own return page there.
#                                                The throwaway server listens on all interfaces for the few minutes this runs (random tokens; the firewall decides who can reach it)
# (Only the SERVER process gets the keys: scripts/demo-stack.sh removes them from the agent, the web server and the seeding; scripts/test-demo-stack-env.sh checks it.)
# It starts the stack with the sandbox keys (from PAYPAL_ENV_FILE, default /home/user/.paypal-sandbox.env: read inside this script, never printed), has the agent ask, a person approve,
# prints the sandbox payer link, waits (default 25 minutes, WAIT=minutes) for the buyer to log in and press Pay, lets the server capture, then refunds, prints the ids, stops the stack.
# --poll 60: the script only looks at the payment a minute after approval, so a capture that is already there came from the return page, not from this script.
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENVF=${PAYPAL_ENV_FILE:-/home/user/.paypal-sandbox.env}; HOST=${1:-}
export VESPR_DEMO_DIR=${VESPR_DEMO_DIR:-/tmp/vespr-demo-stack-paypal-real} VESPR_DEMO_PORT=${VESPR_DEMO_PORT:-9611}; P=$VESPR_DEMO_PORT; D=$VESPR_DEMO_DIR
[ -f "$ENVF" ] || { echo "no sandbox env file at $ENVF (box paypal-sandbox on secret drop box)"; exit 2; }
"$ROOT/scripts/demo-stack.sh" stop >/dev/null 2>&1
( set -a; . "$ENVF"; set +a
  if [ -n "$HOST" ]; then export MURMIO_HOST=0.0.0.0 VESPR_PAY_BASE_URL="http://$HOST:$P"; echo "PayPal will send the buyer back to http://$HOST:$P/api/pay/return/<a random per-request key> (reachable check: http://$HOST:$P/healthz should say ok)"; fi
  "$ROOT/scripts/demo-stack.sh" start 2>&1 | tail -1 | cut -c1-60 )
for i in $(seq 1 20); do curl -fsS -m 2 "http://127.0.0.1:$P/healthz" >/dev/null 2>&1 && break; sleep 0.5; done
VESPR_AGENT_TOKEN=$(cat "$D/tok-coder") VESPR_PERSON_TOKEN=$(cat "$D/tok-alex") node "$ROOT/scripts/paypal-smoke.mjs" --server "http://127.0.0.1:$P" --room demo --wait "${WAIT:-25}" --poll 60 --refund
code=$?
"$ROOT/scripts/demo-stack.sh" stop | tail -1
exit $code
