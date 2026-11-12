#!/bin/bash
# Makes .env and tokens for the judge demo. Random tokens; the Nebius key is read from a file you point at with NEBIUS_ENV (a file with a NEBIUS_API_KEY=... line). Nothing secret is printed.
#   ./make-env.sh DOMAIN      e.g. ./make-env.sh 203-0-113-5.sslip.io   (or your own name, with A records for collab/judge1/judge2)
set -eu
cd "$(dirname "$0")"
DOMAIN=${1:?usage: make-env.sh DOMAIN}
KEYFILE=${NEBIUS_ENV:-./nebius.env}
rnd () { openssl rand -base64 24 | tr -d '=+/\n' | cut -c1-32; }
KEY=$(grep -E '^NEBIUS_API_KEY=' "$KEYFILE" | head -1 | cut -d= -f2- | sed -E "s/^['\"]|['\"]$//g")
[ -n "$KEY" ] || { echo "no NEBIUS_API_KEY in $KEYFILE"; exit 1; }
TAV=$(grep -E '^TAVILY_API_KEY=' "$KEYFILE" 2>/dev/null | head -1 | cut -d= -f2- | sed -E "s/^['\"]|['\"]$//g" || true)
case "$TAV" in tvly-*) ;; *) TAV="" ;; esac     # only a real-looking Tavily key is passed on
umask 077
J1=$(rnd); J2=$(rnd); AG=$(rnd); I1=$(rnd); I2=$(rnd)
cat > .env <<ENV
DOMAIN=$DOMAIN
TOKEN_JUDGE1=$J1
TOKEN_JUDGE2=$J2
TOKEN_AGENT=$AG
IDE_TOKEN_JUDGE1=$I1
IDE_TOKEN_JUDGE2=$I2
NEBIUS_API_KEY=$KEY
TAVILY_API_KEY=$TAV
MURMIO_TOKEN_CAP=${MURMIO_TOKEN_CAP:-600000}
ENV
printf 'judge1:%s\njudge2:%s\ncoder:%s\n' "$J1" "$J2" "$AG" > tokens
# the links a judge needs go to a private file (the SDE token is the login): set JUDGE_LINKS_FILE to choose where; never printed here
LINKS=${JUDGE_LINKS_FILE:-./judge-links.txt}
printf 'Judge 1 SDE: https://judge1.%s/?tkn=%s&folder=/workspace\nJudge 2 SDE: https://judge2.%s/?tkn=%s&folder=/workspace\n' "$DOMAIN" "$I1" "$DOMAIN" "$I2" > "$LINKS"
echo "wrote .env and tokens for $DOMAIN (nothing secret printed)"
