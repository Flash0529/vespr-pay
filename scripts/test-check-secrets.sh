#!/bin/bash
# check-secrets.py: known values, key patterns, history, directories; passes clean code; never prints a value.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; cd "$T"
printf 'shamit:AbCdEfGhIjKlMnOpQrStUvWx12345678\nagent:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz\n' > tokens   # secret-scan: allow
printf 'TOKEN_X=QqQqQqQqQqQqQqQqQqQqQqQqQqQqQqQq\nDOMAIN=example.com\nAPI_BASE=https://api.example.com/v1/long/path\n' > env   # secret-scan: allow
: > none; git init -q .; git config user.email t@t; git config user.name t
export VESPR_SECRET_FILES="$T/tokens:$T/env"
S() { python3 "$HERE/check-secrets.py" "$@"; }
blocked() { if out=$(S "$@"); then echo "FAIL: not blocked: $*"; exit 1; fi; ! echo "$out" | grep -q -E "AbCdEf|QqQqQq|Zq8Lw3|ghp_[A-Za-z0-9]{10}" || { echo "FAIL: a value was printed"; exit 1; }; }

# 1. known values
echo 'hello = 1' > a.txt; git add a.txt; S --staged | grep -q "no secrets found"
echo 'token = "AbCdEfGhIjKlMnOpQrStUvWx12345678"' > b.js; git add b.js; blocked --staged
S --staged | grep -q "SECRET FOUND: b.js:1: a value from tokens"
git reset -q b.js; echo 'const k = "QqQqQqQqQqQqQqQqQqQqQqQqQqQqQqQq"' > c.js; git add c.js; blocked --staged
git reset -q c.js; echo 'x = "example.com"; y = "https://api.example.com/v1/long/path"' > d.js; git add d.js; S --staged | grep -q "no secrets found"; git reset -q d.js
echo "known values: ok"

# 2. patterns (no known values needed): the shape of the real leak, key formats, private keys
export VESPR_SECRET_FILES="$T/none"
echo '<input id="connTokenIn" value="Zq8Lw3Xr5Tn7Bv9Kd2Fh4Gj6Mp1Sc0Y" style="width:100%">' > e.html; git add e.html; blocked --staged
git reset -q e.html; echo 'const gh = "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"' > f.js; git add f.js; blocked --staged
git reset -q f.js; printf -- '-----BEGIN OPENSSH PRIVATE KEY-----\n' > g.txt; git add g.txt; blocked --staged
git reset -q g.txt; echo 'Authorization: Bearer Zq8Lw3Xr5Tn7Bv9Kd2Fh4Gj6Mp1Sc0Y' > h.txt; git add h.txt; blocked --staged
git reset -q h.txt
# things that must NOT be flagged
cat > ok.js <<'JS'
const token = opts.token || document.querySelector('#connTokenIn').value
const connectionTokenInputElementValue = 1
const MURMIO_TOKEN_CAP = 600000
placeholder="Enter access token..."
const headers = { Authorization: `Bearer ${token}` }
const k = process.env.API_TOKEN_VALUE_XYZ123abc
sha256: 3f786850e387550fdab836ed7e6dc881de23001b3f786850e387550fdab836ed
password: your-password-here-1234567890ABCdef
.token-ring-pill svg { width: 14px; height: 14px; }
const secret = "Zq8Lw3Xr5Tn7Bv9Kd2Fh4Gj6Mp1Sc0Y"  // secret-scan: allow
JS
git add ok.js; S --staged | grep -q "no secrets found"; git reset -q ok.js
echo "patterns: ok"

# 3. history: a secret that was committed and later removed is still found, and the commit is named
echo 'const t = "Zq8Lw3Xr5Tn7Bv9Kd2Fh4Gj6Mp1Sc0Y"  // the token' > leak.js; git add leak.js; git -c core.hooksPath=/dev/null commit -qm "add"
git rm -q leak.js; git -c core.hooksPath=/dev/null commit -qm "remove"
S --tree | grep -q "no secrets found"
out=$(S --history || true); echo "$out" | grep -q "leak.js:1 (commit [0-9a-f]\{8\})"; ! echo "$out" | grep -q "Zq8Lw3"
echo "history: ok"

# 4. a directory (a publish copy, a deploy bundle) and the way a file with a secret is named, not shown
mkdir bundle; echo 'DB_PASSWORD=Zq8Lw3Xr5Tn7Bv9Kd2Fh4Gj6Mp1Sc0Y' > bundle/app.env; blocked --dir bundle
S --dir bundle | grep -q "bundle/app.env:1"; mkdir clean; echo 'hello' > clean/a.txt; S --dir clean | grep -q "no secrets found"
echo "directory: ok"
echo "secret scanner tests passed"
