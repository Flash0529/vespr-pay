# Testing instructions for the judges (paste into the Devpost "testing instructions" field; replace the <...> parts)

VESPR is hosted on a Nebius AI Cloud VM and is free to use until Dec 15. Two judge logins share one workspace so you can watch two people and an AI agent in the same file. The agent calls Nebius Token Factory (NVIDIA Nemotron). Everything is capped (AI tokens, CPU, memory, upload size) so a mistake cannot run up a bill.

**Logins (private: only in the Devpost field, never in the repo)**
- Judge 1, the app: <LOGIN LINK 1, the "App as judge 1" line>
- Judge 2, the app: <LOGIN LINK 2>
- Optional, the code editor on its own: <JUDGE 1 SDE LINK>, <JUDGE 2 SDE LINK>

**Open both app links in two windows (or two browsers).** The top bar should say **Live**.

**Five things to try (about 5 minutes)**
1. In window 1 type `@coder run python3 -m unittest -q`. An **Approve / Deny card** appears in both windows; approve it in either. The agent runs the tests (they fail: the sample project has a bug) and the output appears.
2. Type `@coder fix the discount bug in cart.py and run the tests`. Approve the card. Watch the file: the old line turns **red**, the new one is typed in **green** with the agent's name, the tests pass. Both colours stay until your next message.
3. **Select a line of code** and press **Ask coder**: the agent answers about exactly that text, and it knows who changed it.
4. **Attach a file** (a spreadsheet, a Word or PowerPoint file, a PDF, a picture, a small 3D model) and ask `@coder what is in this?`. It reads what it can and says what it could not read.
5. Open **History**: every edit, run and approval, who did it and when, with an Export button.

**Good to know**
- The AI budget for the whole demo is 600,000 tokens per 24 hours; if the agent says it is out, try again later.
- Uploads are capped at 10 MB a file. The workspace is shared between the two logins and is reset from time to time.
- If something does not load, reload the page; the link keeps working. Source code: <REPO LINK> (AGPL-3.0).
