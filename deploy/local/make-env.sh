#!/bin/bash
# Makes .env, tokens and links.txt for a local run. Random tokens. The Nebius key comes from $NEBIUS_API_KEY or a NEBIUS_API_KEY=... line in ./nebius.env.
# Nothing secret is printed. Without a key the agent runs in its scripted demo mode.
set -eu
cd "$(dirname "$0")"
rnd () { openssl rand -base64 24 | tr -d '=+/\n' | cut -c1-32; }
KEY=${NEBIUS_API_KEY:-}
if [ -z "$KEY" ] && [ -f nebius.env ]; then KEY=$(grep -E '^NEBIUS_API_KEY=' nebius.env | head -1 | cut -d= -f2- | sed -E "s/^['\"]|['\"]$//g"); fi
A=$(rnd); B=$(rnd); AG=$(rnd); IA=$(rnd); IB=$(rnd)
umask 077
printf 'TOKEN_ALICE=%s\nTOKEN_BOB=%s\nTOKEN_AGENT=%s\nIDE_TOKEN_ALICE=%s\nIDE_TOKEN_BOB=%s\nNEBIUS_API_KEY=%s\n' "$A" "$B" "$AG" "$IA" "$IB" "$KEY" > .env
printf 'alice:%s\nbob:%s\ncoder:%s\n' "$A" "$B" "$AG" > tokens
chmod 644 tokens     # local use only: the containers run as another user id and must be able to read it
printf 'alice: http://localhost:3001/?tkn=%s&folder=/workspace\nbob:   http://localhost:3002/?tkn=%s&folder=/workspace\n' "$IA" "$IB" > links.txt
echo "wrote .env, tokens and links.txt$([ -z "$KEY" ] && echo ' (no Nebius key: the agent will run in scripted demo mode)')"
