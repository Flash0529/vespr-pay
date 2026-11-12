---
name: security-review
description: Review code and config for common security problems: secrets, injection, authorisation, unsafe input, dependencies and logging. Use before merging or shipping.
---
# Security review

Search the actual code for each item and cite file and line. Do not print secret values; say where they are and that they must be rotated.

1. **Secrets:** keys, tokens, passwords in code, config, history, logs, error messages or client bundles. Fix: environment or a secrets store, rotate anything that leaked, scan history too.
2. **Injection:** SQL, shell, template, path and HTML built from user input. Fix: parameters, argument arrays (no shell string), allow-lists, framework escaping, resolve paths and keep them inside the intended directory.
3. **Authentication:** passwords hashed with scrypt/argon2/bcrypt and a per-user salt; constant-time compares; rate limit and lockout; session tokens random, stored hashed, expiring, revocable; 2FA where it matters.
4. **Authorisation:** every endpoint and every object access checks who is asking, on the server. Test with a second user's id. Admin routes are not only hidden in the UI.
5. **Input and output:** validate size and type; escape on output; file uploads limited by size and type, stored outside the web root, never executed; redirect targets from an allow-list.
6. **Network and browser:** HTTPS only, secure and HttpOnly cookies with SameSite, CSRF protection for cookie auth, CORS not `*` with credentials, security headers (CSP, `X-Content-Type-Options`).
7. **Dependencies and build:** lockfile present, known-vulnerable packages updated, nothing installed from unpinned URLs, CI secrets not exposed to forks.
8. **Logging and errors:** no tokens, passwords or personal data in logs; errors do not reveal internals.

Rank findings high / medium / low with a one-line fix each. Say what you did not or could not test.
