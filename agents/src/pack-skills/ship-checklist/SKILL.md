---
name: ship-checklist
description: A last check before sharing or deploying something that was built fast: it runs, it is safe, it is documented, and it can be undone. Use before a demo, a release or sending a link.
---
# Ship checklist

Go through these in order, with real commands and real output, not from memory.

1. **Clean start works:** from a fresh checkout, follow the README exactly (install, run). Fix the README or the project until it works. One command to run is the goal.
2. **Tests and checks pass:** run the tests, the linter or type checker if there is one, and the app itself. Look at the main screens or outputs.
3. **Secrets:** search the code and history for keys, tokens and passwords; they belong in environment variables or a secrets file that is not committed. If one was ever committed, rotate it.
4. **Input and errors:** try empty, huge and strange input on every form or endpoint. Errors show a helpful message, never a stack trace or a secret.
5. **Access:** anything private needs a sign-in on the server side, not just a hidden link. Check what a stranger can reach.
6. **Data safety:** back up data before anything destructive; migrations are reversible or clearly marked one-way.
7. **Performance in the obvious places:** images are sized, nothing loads a huge file for one icon, pages work on a phone.
8. **Docs and licence:** the README says what it is, how to run it, what is not finished; a licence file exists if others will use it; third-party code is credited.
9. **Undo plan:** know how to roll back (previous version tagged, previous deploy kept).

Finish with a short report: what you checked, what failed and was fixed, what is still open, and anything you could not check.
