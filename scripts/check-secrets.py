#!/usr/bin/env python3
"""Finds secrets before they leave the machine. It never prints a secret: only file, line (and commit) and why it was flagged.

  check-secrets.py --staged            what is about to be committed (the pre-commit hook runs this)
  check-secrets.py --tree              every tracked file in the working tree
  check-secrets.py --history           every line ever added in git history (finds old leaks, and proves a history rewrite worked)
  check-secrets.py --dir PATH          every text file under PATH (a publish copy, a deploy bundle)
  check-secrets.py --sweep             folders in VESPR_SWEEP_ROOTS (default: here) plus VESPR_SWEEP_FILES; checks that secret files are mode 600 and untracked; writes SECRET-ALERTS.md; runs VESPR_SWEEP_NOTIFY on news

Two kinds of check, both on by default:
  1. KNOWN VALUES: any value from the Pi's secret files (VESPR_SECRET_FILES, colon separated, or the defaults below). Catches a real token pasted anywhere.
  2. PATTERNS: well-known key shapes (GitHub, OpenAI-style, Google, Slack, AWS, JWT, private-key blocks) and "a high-entropy string on a line that talks about a
     token, secret, password, key or authorization". Catches secrets that are in no secret file. A line that carries the text `secret-scan: allow` is skipped (test fixtures).
Added after a real token was hard-coded into app/prototype.html (2026-10-28)."""
import json, math, os, re, subprocess, sys, time

DEFAULTS = []  # no built-in paths: name the files that hold your secrets in VESPR_SECRET_FILES (colon separated), e.g. a .env or a tokens file
NAMEY = re.compile(r'(KEY|TOKEN|SECRET|PASS|PWD)', re.I)
CTX = re.compile(r'(token|secret|passw(or)?d|passwd|api[_-]?key|apikey|authorization|bearer|private[_-]?key|credential)', re.I)
CAND = re.compile(r'[A-Za-z0-9_\-]{24,}')
PLACEHOLDER = re.compile(r'(example|your|xxxx|placeholder|changeme|dummy|sample|fake|redacted|0000)', re.I)
KNOWN = [(re.compile(p), why) for p, why in [
    (r'ghp_[A-Za-z0-9]{30,}', 'GitHub token'), (r'github_pat_[A-Za-z0-9_]{40,}', 'GitHub token'), (r'\bsk-[A-Za-z0-9_\-]{30,}', 'API key (sk-)'),
    (r'AIza[0-9A-Za-z_\-]{30,}', 'Google API key'), (r'xox[abprs]-[A-Za-z0-9\-]{10,}', 'Slack token'), (r'\bAKIA[0-9A-Z]{16}\b', 'AWS access key'),
    (r'eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}', 'JWT'), (r'-----BEGIN [A-Z ]*PRIVATE KEY-----', 'private key')]]
SKIP_DIRS = {'node_modules', '.git', '__pycache__', 'footage', 'clean', 'out', 'frames', 'publish', '.msg-cursor', 'venv', '.venv', 'site-packages'}
SKIP_EXT = ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.mov', '.webm', '.mp3', '.wav', '.ico', '.pdf', '.zip', '.gz', '.tar', '.woff', '.woff2', '.ttf', '.bin', '.glb', '.stl', '.lock', '.map')
ALLOW = 'secret-scan: allow'


def secret_file_list():
    """VESPR_SECRET_FILES (colon separated), else ~/.config/vespr/secret-files (one path per line), else nothing (patterns only)."""
    env = os.environ.get('VESPR_SECRET_FILES')
    if env is not None: return [f for f in env.split(':') if f]
    try: return [l.strip() for l in open(os.path.expanduser('~/.config/vespr/secret-files')) if l.strip() and not l.startswith('#')]
    except OSError: return list(DEFAULTS)


def secret_values(files):
    vals = {}  # value -> source file name
    for f in files:
        try: lines = open(f, errors='ignore').read().splitlines()
        except OSError: continue
        for l in lines:
            l = l.strip()
            if not l or l.startswith('#'): continue
            cand = []
            if '=' in l and re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', l):
                k, _, v = l.partition('='); v = v.strip().strip('"\'')
                if NAMEY.search(k): cand.append(v)
            elif ':' in l and re.match(r'^[A-Za-z0-9_.-]+:[^\s:]+$', l): cand.append(l.partition(':')[2])
            elif len(lines) == 1 and re.match(r'^[^\s]{20,}$', l): cand.append(l)  # a file holding just one secret
            for v in cand:
                if len(v) >= 16 and not v.startswith(('http://', 'https://', '/')) and not re.match(r'^[a-z.-]+$', v): vals[v] = os.path.basename(f)
    return vals


def entropy(s):
    return -sum(c / len(s) * math.log2(c / len(s)) for c in (s.count(ch) for ch in set(s)))


def secretish(s):  # long, random-looking, mixed (not an identifier, not a hex hash)
    return (len(s) >= 24 and re.search(r'[0-9]', s) and re.search(r'[a-z]', s) and re.search(r'[A-Z]', s) and not re.fullmatch(r'[0-9a-fA-F]+', s)
            and not PLACEHOLDER.search(s) and entropy(s) >= 4.2)


def check_line(line, vals, patterns=True):
    """-> list of reasons (never the value)."""
    if ALLOW in line: return []
    out = []
    for v, src in vals.items():
        if v in line: out.append('a value from ' + src)
    if patterns:
        for rx, why in KNOWN:
            if rx.search(line) and not PLACEHOLDER.search(line): out.append(why)
        if CTX.search(line):
            for m in CAND.finditer(line):
                pre = line[max(0, m.start() - 2):m.start()]
                if pre.endswith(('${', '$')) or 'process.env' in line[max(0, m.start() - 12):m.start()]: continue
                if secretish(m.group(0)): out.append('a random-looking string next to the word token/secret/key/password'); break
    return list(dict.fromkeys(out))


def git(*a, cwd=None): return subprocess.run(['git', *a], capture_output=True, text=True, errors='ignore', cwd=cwd).stdout


def scan_diff(text, vals, patterns, commit=''):
    hits = []; path = None; ln = 0
    for line in text.splitlines():
        if line.startswith('commit ') and len(line) == 47 and not commit == 'staged': commit = line[7:15]; continue
        if line.startswith('+++ '): path = line[6:] if line.startswith('+++ b/') else line[4:]; continue
        m = re.match(r'^@@ -\S+ \+(\d+)', line)
        if m: ln = int(m.group(1)) - 1; continue
        if line.startswith('+') and not line.startswith('+++'):
            ln += 1
            for why in check_line(line[1:], vals, patterns): hits.append((path, ln, why, commit if commit != 'staged' else ''))
    return hits


def scan_text(path, text, vals, patterns):
    return [(path, i, why, '') for i, line in enumerate(text.splitlines(), 1) for why in check_line(line, vals, patterns)]


def walk(root, vals, patterns, limit=1_500_000, skip=()):
    hits = []
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in SKIP_DIRS]
        for f in fn:
            p = os.path.join(dp, f)
            if f.lower().endswith(SKIP_EXT) or '.bak-' in f or p in skip: continue
            try:
                if os.path.getsize(p) > limit or os.path.islink(p): continue
                text = open(p, errors='ignore').read()
            except OSError: continue
            if '\0' in text[:4000]: continue
            hits += scan_text(p, text, vals, patterns)
    return hits


IGNORE_PATHS = ('scripts/test-check-secrets.sh',)  # the scanner's own test: it holds deliberate fake secrets


def report(hits, label):
    hits = [h for h in hits if not str(h[0]).endswith(IGNORE_PATHS)]
    for path, ln, why, commit in hits: print(f'SECRET FOUND: {path}:{ln}{" (commit " + commit + ")" if commit else ""}: {why} (value not shown)')
    if hits: print(f'Blocked/flagged ({len(hits)}). Remove the value (read it from the environment or ask for it at run time), then try again. A deliberate fixture can carry "{ALLOW}".'); return 1
    print(f'no secrets found ({label})'); return 0


def sweep(vals):
    """The whole shared workspace. Writes SECRET-ALERTS.md and posts an alert when the findings change; exit 1 on findings."""
    roots = [r for r in os.environ.get('VESPR_SWEEP_ROOTS', os.getcwd()).split(':') if r]; hits = []
    sources = [f for f in secret_file_list() if os.path.exists(f)]
    for r in roots:  # the secret files themselves are meant to hold secrets: they are checked for who can read them instead
        if os.path.isdir(r): hits += walk(r, vals, True, skip=set(sources))
    for f in sources:
        mode = os.stat(f).st_mode & 0o777
        if mode & 0o077: hits.append((f, 0, 'a secret file that other users can read (mode ' + oct(mode)[2:] + ', should be 600)', ''))
        if git('ls-files', '--error-unmatch', os.path.abspath(f)): hits.append((f, 0, 'a secret file that is tracked by git', ''))
    for f in [x for x in os.environ.get('VESPR_SWEEP_FILES', '').split(':') if x]:  # extra single files (notes, runbooks)
        try: hits += scan_text(f, open(f, errors='ignore').read(), vals, True)
        except OSError: pass
    hits = [h for h in hits if not h[0].endswith(('SECRET-ALERTS.md',) + IGNORE_PATHS)]
    key = sorted({f'{p}:{l}:{w}' for p, l, w, _ in hits}); stamp = time.strftime('%Y-%m-%d %H:%M:%S')
    state = os.path.join(os.environ.get('VESPR_SWEEP_STATE', os.getcwd()), '.secret-sweep.json'); last = []
    try: last = json.load(open(state))
    except Exception: pass
    alerts = os.path.join(os.environ.get('VESPR_SWEEP_STATE', os.getcwd()), 'SECRET-ALERTS.md')
    with open(alerts, 'w') as f:
        f.write(f'# Secret sweep ({stamp})\n\n' + ('No secrets found in the swept folders.\n' if not hits else 'These files hold something that looks like a secret (values are never shown). Remove them and rotate anything real.\n\n' + '\n'.join(f'- {k}' for k in key) + '\n'))
    if key != last:
        json.dump(key, open(state, 'w'))
        if key:
            msg = 'SECRET SWEEP: ' + str(len(key)) + ' possible secret(s) found: ' + '; '.join(key[:6]) + (' ...' if len(key) > 6 else '') + '. Values not shown. Fix and rotate; see SECRET-ALERTS.md.'
            notify = os.environ.get('VESPR_SWEEP_NOTIFY')  # a command that takes the message as its last argument (e.g. a chat or board poster)
            if notify: subprocess.run(notify.split() + [msg], capture_output=True)
    return report(hits, 'sweep')


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else '--staged'
    if mode not in ('--staged', '--tree', '--history', '--dir', '--sweep'): sys.exit(__doc__)
    vals = secret_values(secret_file_list())
    patterns = os.environ.get('VESPR_SECRET_PATTERNS', '1') != '0'
    if mode == '--staged': sys.exit(report(scan_diff(git('diff', '--cached', '-U0', '--no-color'), vals, patterns, 'staged'), mode))
    if mode == '--tree':
        hits = []
        for f in git('ls-files').splitlines():
            if f.lower().endswith(SKIP_EXT) or '.bak-' in f: continue
            try: hits += scan_text(f, open(f, errors='ignore').read(), vals, patterns)
            except OSError: pass
        sys.exit(report(hits, mode))
    if mode == '--history': sys.exit(report(scan_diff(git('log', '--all', '-p', '-U0', '--no-color', '--format=commit %H'), vals, patterns), mode))
    if mode == '--dir':
        if len(sys.argv) < 3: sys.exit('usage: check-secrets.py --dir PATH')
        sys.exit(report(walk(sys.argv[2], vals, patterns), 'dir ' + sys.argv[2]))
    sys.exit(sweep(vals))
