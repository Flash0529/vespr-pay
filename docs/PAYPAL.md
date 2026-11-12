# VESPR Pay: agents that ask before they spend (PayPal sandbox)

In a VESPR room an AI agent can **request** a PayPal payment. The request shows up as a card in the room chat with exactly what, how much and why. A **person** approves or denies it. Only after an approval does the server create a PayPal order, and the money is captured only after the buyer approves it on **PayPal's own sandbox page**. The room's History records who asked, who approved and what PayPal did.

It is "Ask. Watch. Approve." applied to money: the agent has a tool to ask (`request_payment`) and no way to approve, to create an order or to capture one.

**Sandbox only. No real money moves.** The server talks to `https://api-m.sandbox.paypal.com` and refuses any other PayPal address (a live address needs an explicit `VESPR_PAYPAL_LIVE=1`, which nothing here sets). Every card carries the badge "PayPal sandbox, no real money".

## What happens, step by step

1. You tell the agent to pay for something: `@coder pay $25 for the logo invoice`. The model decides to call `request_payment` with structured arguments (amount, currency, label, description).
2. The server checks the request against its limits. If it is over a limit the server refuses it before anyone is asked, and a card says so (the agent cannot get around it).
3. Otherwise the server posts a **payment card** to the room: amount, what is bought, the agent's own reason, the server's own numbers (what the room had used in 24 hours, what approving leaves, the per-request limit; no invented scores) and the badge. Everyone in the room sees it. It lapses after 15 minutes.
4. A person presses **Approve $25.00** or **Deny**. The agent that asked, and anyone who is not allowed to decide approvals, cannot.
   - **Deny**: nothing is created at PayPal, nothing is charged.
   - **Approve**: the server creates a PayPal Orders v2 order and the app opens PayPal's sandbox page in a popup.
5. The buyer logs in to a sandbox **personal** account on PayPal's page and presses Pay. PayPal sends the browser back to the server, which asks PayPal itself whether the order is approved (it trusts nothing in the address) and captures it (a repeated capture returns the existing capture and takes nothing more).
6. The card turns into a receipt (PayPal order id and capture id), the agent reports the outcome in its own words, and History shows one row per step with the actor's name: `coder asked`, `alex approved`, `PayPal captured`.
7. A person can press **Refund** on the receipt: the server refunds the capture in full through PayPal (once), and the card and History show who refunded it. Agents cannot refund.

Where the money goes: an Orders v2 payment is paid to the app's **sandbox business account**, not to a person. The card therefore says "From: the demo merchant" and describes a purchase; nothing in the product claims to pay a named person.

## What the server enforces

| Rule | Where | Value |
|---|---|---|
| Only an agent asks; only a person answers | `server/pay.js` | agents (names in `VESPR_AGENT_NAMES`) cannot approve or deny, not even their own request; the person who asked cannot answer it |
| Who may answer (approve, deny, refund) | `server/pay.js` using `server/policy.js` `approval.decide`, the same rule as the existing approval cards | adults with edit rights in the workspace: personal accounts, operator-token accounts, members of a company login and school staff (teachers). **A student can never approve a payment** (the policy says "Students do not decide approvals"; the card says "Students cannot approve payments."), nor can a minor, an agent, or an account with no age on record |
| Currency | `server/pay.js` | USD only |
| Per request | `server/pay.js` | at most USD 50.00 (`VESPR_PAY_REQUEST_MAX`, dollars, to change it) |
| Per room, per 24 hours | `server/pay.js` | at most USD 100.00 counting waiting, approved and captured requests (`VESPR_PAY_ROOM_DAY_MAX`); checked again at approval |
| Amounts | `server/paypal.js` | a decimal string checked to the cent; no signs, no exponents, at most two decimals, more than zero |
| One refund per payment | `server/pay.js`, `server/paypal.js` | only a captured payment, in full, by a person; `PayPal-Request-Id` and the in-flight lock make a repeat harmless; a refunded request stops counting toward the room's daily limit |
| One order and one capture per request | `server/pay.js`, `server/paypal.js` | an in-flight lock plus `PayPal-Request-Id` on both calls; repeats return the same result. PayPal itself also holds the line: a second capture of a captured order returns the existing capture and takes nothing more (seen on the real sandbox) |
| The agent is never given a PayPal credential (only the server process holds them) | `scripts/demo-stack.sh`, `scripts/paypal-real-check.sh`, `deploy/judge/compose.yml` | the keys are in the environment of the server process and nowhere else: `scripts/demo-stack.sh` starts the agent, the web server and the seeding with `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_API_BASE` and the buyer login variables removed (`env -u`), and the judge compose file gives them to the `collab` (server) service only. The agent is never given a PayPal credential: it has none in its environment, so nothing it runs as that user can read one there. `scripts/test-demo-stack-env.sh` (in `scripts/test-all.sh`) starts a stack with fake credentials exported and fails if the agent, the web server or a child of either carries any `PAYPAL_*` variable or credential value, and also fails if the server does not carry them (so it cannot pass for the wrong reason). A file of keys on the host is a separate matter: keep it readable only by the user that runs the server. |
| The buyer's return and cancel addresses | `server/pay.js` | `GET /api/pay/return/<nonce>?token=<order id>` and `/api/pay/cancel/<nonce>?token=<order id>`: the buyer's browser has no sign-in, so the address is the key. The nonce is 128 random bits (`crypto.randomBytes(16)`) made for each request when it is approved, kept with the request, given only to PayPal inside these two addresses, compared in constant time and never shown in the room, the card, the history or the logs. PayPal's own pages show the order id to anyone with the payer link, so an order id alone does nothing: a wrong, missing, borrowed or old-style address gets the same "Unknown payment" page, asks PayPal nothing, captures nothing and cancels nothing. A retry after a failed order keeps the nonce (PayPal-Request-Id would hand back the first order with its first addresses). Requests approved before this change have the old addresses and show "Unknown payment" on return: use Check in the room instead |
| Expiry | `server/pay.js` | 15 minutes to answer, 30 minutes for the buyer to pay (`VESPR_PAY_BUYER_MINUTES`, up to 180); nothing is captured after that |
| Cards cannot be forged | `server/access.js` | with `VESPR_ACCESS=1` a connection can neither post nor change a payment card (the demo stack turns this on). The money gate does not depend on it: it lives in the server's own record (`<data>/pay/<room>.json`), not in a field of the shared document |
| Secrets | `server/paypal.js` | the client id and secret are read from the environment, never logged, returned or stored; the only PayPal values written down are the order id, the capture id and the buyer's sandbox link |

States: `pending` (waiting for a person) → `awaiting_buyer` (approved, PayPal order made) → `captured` → `refunded` (if a person refunds it). Also `denied`, `expired`, `cancelled` (the buyer closed PayPal), `failed` (PayPal declined it) and `refused` (over a limit).

## The payments ledger

Tools menu, **Payments** (the grid icon): every payment request in the room as a table (time, who asked, what, amount, status, who decided, PayPal order id). Sort by any column, filter under each heading, search across all of them, export CSV, and open a row for its receipt: the agent's reason, the server's own numbers, the PayPal ids and every step with who did it. It is [AG Grid Community](https://www.ag-grid.com/) (MIT), vendored unchanged in `app/vendor/` with its licence recorded in `app/vendor/LICENSES.txt` and `THIRD-PARTY.md`; it is loaded from the app's own folder, so it works offline. The rows are the server's own list (`GET /api/pay/<room>`), not a copy kept in the browser.

## In a classroom or a team

The role rule is the one VESPR already uses for every approval card (`server/policy.js`), so it carries over: a student's agent can **ask** for a payment, a student can **never approve a payment**, and a teacher (or any adult with edit rights) does. `server/test/pay-school.test.js` checks it with the real account code: a student and a teacher sign in through a (faked) school provider, the real auth module makes their accounts, and the student is refused with "Students cannot approve payments." (approve, deny and refund) while the teacher and an adult can. The student's card says why and shows no buttons. To try it without a school sign-in, mark names from your tokens file: `VESPR_PAY_ROLES=sam:student,terry:teacher scripts/demo-stack.sh start` (real school sign-ins carry their role automatically; this only gives a token login the same shape, so the same policy decides, and it can only make a name more restricted). Recorder clip Z films it.

## Run it yourself (about ten minutes)

You need Node 20 or newer, Python 3, `openssl`, `curl` and a free PayPal developer account.

**1. A sandbox app and a buyer** (developer.paypal.com, no payment details needed):
- *Apps & Credentials*, switch to **Sandbox**, **Create App** (type Merchant). Copy its **Client ID** and **Secret**.
- *Testing Tools → Sandbox Accounts*: PayPal creates a sandbox **Business** and a sandbox **Personal** account for you. Open the Personal one (View/edit account) for its email and password: that is the buyer you log in as on PayPal's page.

**2. Get the code and start it** (from a clean clone; the keys stay in your shell, never in a file in the repo):
```bash
git clone https://github.com/Flash0529/vespr-pay vespr && cd vespr
(cd server && npm ci) && (cd agents && npm ci)
export PAYPAL_CLIENT_ID='your sandbox client id'
export PAYPAL_CLIENT_SECRET='your sandbox secret'
scripts/demo-stack.sh start
scripts/demo-stack.sh url        # prints the link to open (a throwaway local login; the stack listens on 127.0.0.1 only)
```

**3. Try it.** Open the link. If a box "What will you build here?" shows first, press **Skip for now**. In the chat type `@coder pay $25 for the logo invoice`.
- A payment card appears. Press **Approve $25.00**. A PayPal window opens (allow pop-ups for the page if your browser blocks it): log in with the sandbox Personal account and press Pay.
- The card becomes a receipt with the PayPal order and capture ids, and the activity History lists who did what: **Tools → View options → History**, then the **Payments** filter (the sidebar's History row opens the file-versions page instead). The sidebar's **Payments** row shows every request as a table.
- Ask again (`@coder buy the $12.50 stock photos`) and press **Deny**: nothing is charged. Ask for `$75`: the server refuses it (over the USD 50 limit).

Stop and remove everything with `scripts/demo-stack.sh stop`.

**Which AI model?** Without a model key the agent is the scripted demo agent: its name tag reads "demo-mode (scripted, no model key)", the card's reason says the scripted agent passed the amount you typed, and it turns "pay $25 for …" into the same `request_payment` tool call a real model makes; the server, the card and the PayPal calls are the real ones. With a Nebius Token Factory key the real model (NVIDIA Nemotron) decides by itself when to call the tool: `export NEBIUS_API_KEY=... VESPR_DEMO_KEEP_KEY=1` before `scripts/demo-stack.sh start`.

**Without the keys** the feature says "PayPal sandbox is not set up on this server" and nothing pretends to work.

**A hosted server** needs `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `VESPR_PAY_BASE_URL` (the public address PayPal sends the buyer back to, for example `https://collab.example.com`) in the server's environment; `deploy/judge/compose.yml` passes them through. If the address is not set the server uses the address the approving person reached it on.

## Check it for real: `scripts/paypal-smoke.mjs`

```bash
node scripts/paypal-smoke.mjs                      # the PayPal client alone: token, order, you pay once, capture, idempotency (add --refund to refund it too)
node scripts/paypal-smoke.mjs --server http://127.0.0.1:9611 --room demo   # the whole product against a running server
```
It prints the sandbox link (an order id, no secret), waits for you to approve it, captures, and checks that a repeated request returns the same result and that a second capture attempt takes nothing more (PayPal returns the capture that exists). In `--server` mode the tokens come from `VESPR_AGENT_TOKEN` and `VESPR_PERSON_TOKEN` in the environment. Exit codes: 0 passed, 1 a check failed, 2 not set up, 3 nobody paid in time.

## Which PayPal driver: the hand-written client or PayPal's own SDK

`server/paypal.js` is a small hand-written client over `fetch` and is the default. `VESPR_PAYPAL_DRIVER=sdk` switches to `server/paypal-sdk.js`, which does the same four things (create order, get order, capture, refund) through PayPal's own server SDK, `@paypal/paypal-server-sdk` 2.5.0 (MIT). Every source file in that package says it was generated by APIMATIC v3.0 and it runs on the `@apimatic/*` runtime packages (listed in `THIRD-PARTY.md`); nothing of APIMatic's Context Plugin is used. Both drivers have the same interface, the same error codes, the same idempotency keys and the same sandbox-only rule, and `GET /api/pay/_status` says which one is answering. Try it: `VESPR_PAYPAL_DRIVER=sdk scripts/demo-stack.sh start`, or `node scripts/paypal-smoke.mjs --driver sdk`.

Checked (2026-11-12): the SDK driver passes `server/test/paypal-sdk.test.js` (the same behaviors as the fetch client, the SDK's real request building and error handling, no network), the whole payment flow in `server/test/pay.test.js` runs through it, and **the whole product, started with `VESPR_PAYPAL_DRIVER=sdk`, captured and refunded a real sandbox payment through PayPal's own SDK** (order `62P32280KH282330M`, see the next section). The default stays the hand-written client, which passed the same whole-product check (order `7PS342523U608052E`). Say the product uses the SDK only for a run that was started with `VESPR_PAYPAL_DRIVER=sdk`; each take or run should say which driver answered (`GET /api/pay/_status`).

## What has been checked against the real PayPal sandbox

Checked on 2026-11-12 with a free sandbox app's credentials (a sandbox REST app, test money only):
- **The two whole-product runs (`scripts/paypal-real-check.sh`), one per driver.** A throwaway stack with the real sandbox keys; the agent asks for USD 1.00, the server refuses to let the agent approve its own request, a person approves, the server creates the PayPal order with its own per-request return address, a buyer pays on PayPal's sandbox page, PayPal sends the buyer to the server's return page, and the server (not the script) captures once; the trail reads `pending:coder > awaiting_buyer:alex > captured:PayPal`; the agent cannot refund, a person refunds in full, a second refund is refused. Both ended "All checks passed" and PayPal itself shows both orders COMPLETED with the capture REFUNDED:
  - default hand-written client: order `7PS342523U608052E`, capture `15K25507YB9249702`, refund `6KV284687A876363S` (refunded 09:51 ET);
  - PayPal's server SDK (`VESPR_PAYPAL_DRIVER=sdk`): order `62P32280KH282330M`, capture `4F223718JG8963644`, refund `0N2124005E220252U`.
  - **How the buyer paid:** by hand, through PayPal's guest card form, not by logging in to a sandbox account (PayPal also showed its own "unable to verify your number" notice both times). The sandbox ACCOUNT login path through the product's automated buyer step (clip Y) has **not** been run, because no sandbox buyer login file was available.
- Earlier the same day at client level (`scripts/paypal-smoke.mjs`): sign-in with the client id and secret, create order, the same `PayPal-Request-Id` returning the same order, get order (it returns our `custom_id`, `reference_id`, amount and currency), a capture before the buyer approves refused by PayPal (`ORDER_NOT_APPROVED`), then, after a person paid order `48H24021HM607201A`, the real capture and refund. Two of PayPal's answers differed from the first fake and were fixed: the capture answer carries the amount and `custom_id` on the capture, not on the purchase unit, and a second capture of a captured order returns the existing capture instead of an error.
- The whole product on a local stack up to PayPal's real login page: the app opening PayPal's sandbox login page in a popup (`https://www.sandbox.paypal.com/checkoutnow`) and Check status leaving the order waiting; the login page loads in headless Chromium with an email field, a password field and Next / Log In buttons, which is what clip Y types into.

Not checked against the real sandbox: the sandbox account login typed by clip Y's automated buyer step, PayPal's behavior behind a robot check, and anything with real money (nothing here can move real money).

## Tests (no network, no keys)

`scripts/test-all.sh` runs everything. The payment parts:

| Test | What it covers |
|---|---|
| `server/test/paypal.test.js` | the client against a faked `fetch`: sandbox only, token cached and refreshed, the exact Orders v2 requests, error mapping, amounts to the cent, no secret in any log or error |
| `server/test/pay.test.js` | the state machine against a stateful fake PayPal: who may ask and answer, every limit, one order and one capture, expiry, cancel, decline, PayPal failing mid-way, restart, actor names in the trail and cards |
| `agents/test/pay-agent.test.js` | end to end with the real server and the real agent tool loop: the agent asks, cannot answer, nobody can forge a card, a person approves, the buyer pays, the server captures once, the agent reports it; denial and over-limit charge nothing; no keys means "not set up" |
| `server/test/pay-school.test.js` | the classroom story with the real auth accounts and the real approval policy: a student's agent asks, the student cannot approve, deny or refund and is told why, a teacher and an adult can |
| `app/test/pay-ledger.test.mjs` | the ledger's rows, columns, receipts, keyboard handling and wiring; that AG Grid is vendored unchanged with its MIT licence recorded and no CDN |
| `app/test/pay-card.test.mjs` | the card in every state, the badge, markup-proofing, History rows, contrast in both themes |

The fake PayPal (`server/test/fakepaypal.js`) is for tests only. The server accepts a loopback PayPal address only when `VESPR_PAYPAL_TEST_LOOPBACK=1`, which the tests set and nothing else does.

## Files

`server/paypal.js` PayPal client · `server/pay.js` the state machine, routes, room cards and audit trail · `server/access.js` (payment cards are server-only) · `agents/src/room.js` `requestPayment`, `agents/src/agent.js` the `request_payment` tool · `app/pay-card.js` the card and the History rows, wired in `app/prototype.html` and `app/vespr-client.js` · `scripts/paypal-smoke.mjs`.

HTTP routes (all under `/api/pay/`): `GET _status`, `GET <room>`, `POST <room>/request` (agents), `POST <room>/answer` (people), `POST <room>/refund` (people), `POST <room>/check`, and the buyer's browser lands on `GET return` or `GET cancel`.

## Honest limits

- Sandbox only. The sandbox has no real risk engine, so a decline in production would look different.
- The buyer step is done by a person on PayPal's page; it is not automated and not faked.
- An agent that asks waits for the answer, so it does not take other chat requests until the payment is answered, denied or lapses (up to 15 minutes, plus 30 for the buyer).
- Partial refunds, receipts by email and per-room spending policies are not built. A refund is always the full amount.
- Who counts as a teacher at a school comes from the school sign-in (staff or not); per-class rules are not used here, only the existing `approval.decide` role table with default organization settings.
