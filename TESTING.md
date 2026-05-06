# Testing Guide — Hedera Multi-Signature Library

End-to-end testing playbook for the v2.1.0 release and ongoing regression
work. Optimised for the **first time you run it**: copy-paste-able, no
hidden steps, and explicit about where to get external credentials.

If you're new here, read top-to-bottom once. After that, the matrix in
[Phase 2 — Coverage gaps](#phase-2--coverage-gaps-manual) is the working
checklist.

## Table of contents

1. [Quick start (30 seconds to first command)](#quick-start)
2. [Phase 0 — Bootstrap](#phase-0--bootstrap)
3. [Phase 1 — Scripted walkthroughs](#phase-1--scripted-walkthroughs)
4. [Phase 2 — Coverage gaps (manual)](#phase-2--coverage-gaps-manual)
5. [Phase 3 — Failure-mode smoke](#phase-3--failure-mode-smoke)
6. [Phase 4 — dApp surface](#phase-4--dapp-surface)
7. [Networking & tunnels (ngrok)](#networking--tunnels-ngrok)
8. [Unit & coverage tests (`npm test`)](#unit--coverage-tests-npm-test)
9. [Troubleshooting](#troubleshooting)
10. [Performance benchmarks](#performance-benchmarks)
11. [CI](#ci)
12. [Appendix: legacy ad-hoc scenarios](#appendix-legacy-ad-hoc-scenarios)

---

## Quick start

```bash
# 1. One-time setup
cp .env.example .env
# edit .env — set OPERATOR_ID, OPERATOR_KEY, HEDERA_NETWORK=testnet

cp dapp/.env.example dapp/.env.local
# edit dapp/.env.local — set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID

npm install
cd dapp && npm install && cd ..

# 2. Verify your environment is ready
npm run precheck

# 3. Run the canonical end-to-end walkthrough (~30 min)
cd examples/walkthrough-hbar
node 00-precheck.js
node 01-generate-keys.js
node 02-create-threshold-account.js
# … continue per examples/walkthrough-hbar/README.md
```

Total time, cold start to first verified on-chain multi-sig transfer: **~45
minutes**, including reading.

---

## Phase 0 — Bootstrap

| # | Step | Time | Notes |
|---|------|------|-------|
| 0.1 | `cp .env.example .env`, set `OPERATOR_ID`, `OPERATOR_KEY`, `HEDERA_NETWORK=testnet` | 2 min | Get account at [portal.hedera.com](https://portal.hedera.com/) |
| 0.2 | `cp dapp/.env.example dapp/.env.local`, set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | 1 min | Free at [cloud.walletconnect.com](https://cloud.walletconnect.com/) |
| 0.3 | `npm install` and `cd dapp && npm install` | 2 min | |
| 0.4 | `npm run precheck` | 10 sec | Catches missing env vars, low operator balance, missing dApp config |
| 0.5 | (Optional) Install ngrok auth token — see [Networking & tunnels](#networking--tunnels-ngrok) | 2 min | Only needed for remote-participant tests |

That's it. The walkthrough scripts in Phase 1 generate their own keys and
create the threshold account themselves — no separate "test accounts" step.

### What `npm run precheck` checks

- Node ≥ 20
- `.env` at repo root with `OPERATOR_ID` + `OPERATOR_KEY` populated
- Operator account reachable on the configured network
- Operator balance ≥ 30 ℏ (covers all three walkthroughs: ~6 ℏ each for hbar + dapp + ~10 ℏ for contract; 5 ℏ minimum for HBAR walkthrough alone)
- `dapp/.env.local` exists with `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- `dapp/node_modules` installed (warns if missing — only needed for browser tests)
- `NGROK_AUTH_TOKEN` set (warns; only needed for `--tunnel ngrok`)
- `.testenv.json` present (informational; only relevant for Phase 2.6)

Exit code is 0 if all required checks pass (warnings are advisory). Re-run
after fixing anything ✗.

---

## Phase 1 — Scripted walkthroughs

These are the **canonical happy path**. Run both before any release.

### Scenario 11 — HBAR walkthrough (~30 min, ~6 ℏ)

Source: [`examples/walkthrough-hbar/`](./examples/walkthrough-hbar/) — see
its [README](./examples/walkthrough-hbar/README.md) for the user-facing
narrative.

What it tests:
- Threshold-key account creation via `KeyList` with `threshold = 2`
- Coordinator server start with `--no-tunnel`
- dApp `/create` injection of an HBAR transfer
- CLI `participant` flow signing with encrypted-file keys
- Mirror-node confirmation via `06-verify-on-mirror.js`

Run order (one terminal each, four in total):

```bash
# Terminal 1 — prep + coordinator
cd examples/walkthrough-hbar
node 00-precheck.js
node 01-generate-keys.js
node 02-create-threshold-account.js

npx hedera-multisig server \
  -t 2 \
  -k "$(node -e "console.log(require('./walkthrough-state.json').publicKeys.join(','))")" \
  --port 3001 \
  --no-tunnel

# Terminal 2 — dApp
cd dapp && npm run dev

# Browser — http://localhost:3000/create
#   - Connect with credentials from terminal 1 (server URL, session ID, PIN, coordinator token)
#   - Build "HBAR transfer" — from = threshold account, to = operator, amount = 1 ℏ
#   - Click Inject Transaction

# Terminal 3 — alice
cd examples/walkthrough-hbar
npx hedera-multisig participant \
  --connect "<connection string from terminal 1>" \
  --label alice \
  --keyfile ./walkthrough-keys.alice.encrypted \
  --passphrase walkthrough-test
# review and approve

# Terminal 4 — bob
npx hedera-multisig participant \
  --connect "..." --label bob \
  --keyfile ./walkthrough-keys.bob.encrypted \
  --passphrase walkthrough-test
# review and approve

# Coordinator submits the signed tx; copy the transaction ID

# Terminal 1 — verify on mirror node
node 06-verify-on-mirror.js <transactionId>
```

Expected results:

- ✅ `00-precheck.js` reports operator balance ≥ 2 ℏ
- ✅ `02-create-threshold-account.js` prints a new account ID; HashScan shows it as a threshold key (2/3)
- ✅ Coordinator server prints session ID + PIN + coordinator token + connection string
- ✅ dApp `/create` connects with the coordinator's credentials
- ✅ Transaction injection succeeds within 120 s
- ✅ Both participants see the transaction details in TransactionReview (verified amounts, recipient, fee)
- ✅ After 2 signatures, coordinator submits and prints transaction ID
- ✅ `06-verify-on-mirror.js` reports `mirrorConfirmed: true` with consensus timestamp
- ✅ Final balance: threshold account = 4 ℏ (5 initial − 1 sent), operator credited

### Scenario 12 — Smart-contract walkthrough (~30 min, ~10 ℏ)

Source: [`examples/walkthrough-contract/`](./examples/walkthrough-contract/) — see its
[README](./examples/walkthrough-contract/README.md). Self-contained as of
Phase G — generates its own keys via `setup-keys.js`. Optionally reuses
Scenario 11's keys: `cp ../walkthrough-hbar/walkthrough-keys.* .` skips
the key generation step.

What it tests:
- `ContractCreateFlow()` deployment as an EOA
- `ContractExecuteTransaction` calling `increment()` single-sig
- `AccountUpdateTransaction` converting a single-key account to a 2-of-3 KeyList (dual-signature rule: old key + new threshold key both sign)
- Negative test: the same single-sig call now returns `INVALID_SIGNATURE` after conversion
- Multi-sig ceremony for `increment()` and admin-only `withdraw()`
- **All three injection paths** into a multi-sig session: dApp build-from-form, dApp paste-frozen-base64, CLI `inject` (Phase D13)

Run order:

```bash
cd examples/walkthrough-contract

# Setup (skip if you've already done it for Scenario 11 and copied across)
node setup-keys.js                  # or: cp ../walkthrough-hbar/walkthrough-keys.* .

# EOA stage
node 00-precheck.js
node 01-create-demo-eoa.js
node 02-deploy-as-eoa.js
node 03-fund-contract.js
node 04-call-increment-as-eoa.js   # counter = 1

# Conversion stage
node 05-convert-eoa-to-multisig.js
node 06-prove-eoa-rejected.js       # MUST exit 0 (single-sig rejected as expected)

# Multi-sig ceremony stage — exercise each injection path at least once

# (Path A) Build-from-form in dApp:
#   - Open dApp /create, paste Counter.json ABI in the contract-call form,
#     pick the function from the dropdown, click Inject.

# (Path B) Paste frozen base64 in dApp /create:
node 07-prepare-multisig-increment.js   # prints base64
#   - In dApp /create, switch to "Paste Frozen TX" tab, paste, optionally
#     paste Counter.json ABI for verified function review, Inject.

# (Path C) CLI inject:
node 07-prepare-multisig-increment.js   # writes multisig-increment-tx.json
npx hedera-multisig inject \
  --connect "<connection string>" \
  --base64-file multisig-increment-tx.json
# (or pass --base64 directly)

# Two participants sign (alice + bob), coordinator submits, mirror verifies
node verify-on-mirror.js <txId>

# Withdraw — same shape:
node 08-prepare-multisig-withdraw.js
# inject (any path) + sign + verify
```

Expected results:

- ✅ `02-deploy-as-eoa.js` prints contract ID; HashScan shows the contract created by the demo account
- ✅ `04-call-increment-as-eoa.js` shows counter = 1
- ✅ `05-convert-eoa-to-multisig.js` succeeds; `AccountInfoQuery` confirms `KeyList` with `threshold = 2`
- ✅ **`06-prove-eoa-rejected.js` exits 0** (single-sig rejection is the expected outcome)
- ✅ Multi-sig increment ceremony executes; counter = 2
- ✅ Multi-sig withdraw ceremony executes; contract balance returns to 0; demo account credited (minus fee)
- ✅ TransactionReview in dApp shows green "ABI Verified ✓" badge for both contract calls when ABI is provided
- ✅ All three injection paths (A/B/C) hit at least once across the ceremonies

### Scenario 13 — Hosted-dApp + hybrid signing walkthrough (~30 min, ~6 ℏ)

Source: [`examples/walkthrough-dapp/`](./examples/walkthrough-dapp/) — see its
[README](./examples/walkthrough-dapp/README.md). Self-contained;
optionally reuses Scenario 11's keys + threshold account
(`cp ../walkthrough-hbar/walkthrough-keys.* . && cp ../walkthrough-hbar/walkthrough-state.json .`).

What it tests:
- HTTPS dApp ⇒ WSS coordinator constraint (the `--tunnel ngrok` path)
- `--allowed-origins https://testnet-multisig.lazysuperheroes.com` browser-origin allowlist
- HashPack key import + WalletConnect signing (real wallet, real browser)
- **Hybrid signing**: alice in HashPack (web), bob via CLI participant — same ceremony, same coordinator, same multi-node freeze
- Phase J ShareStep three-state behaviour: `signing` → `completed` receipt

Run order:

```bash
cd examples/walkthrough-dapp

# Setup (or copy from walkthrough-hbar to skip)
node 01-generate-keys.js
node 02-create-threshold-account.js

# Terminal 1 — coordinator with public tunnel
npx hedera-multisig server \
  -t 2 \
  -k "$(node -p "require('./walkthrough-state.json').publicKeys.join(',')")" \
  --port 3001 --tunnel ngrok \
  --allowed-origins https://testnet-multisig.lazysuperheroes.com

# Terminal 2 — coordinator UI on the public dApp
#   - Browser → testnet-multisig.lazysuperheroes.com/create
#   - Paste HMSC connection string + coordinator token
#   - Build & inject HBAR transfer

# Terminal 2 (other tab) — alice signs via HashPack
#   - Import alice key into HashPack one-time
#   - Browser → testnet-multisig.lazysuperheroes.com/join
#   - Paste connection string, pick alice account in HashPack, approve

# Terminal 3 — bob signs via CLI
npx hedera-multisig participant \
  --connect "<connection string>" --label bob \
  --keyfile ./walkthrough-keys.bob.encrypted \
  --passphrase walkthrough-test
# Type YES at the review prompt

# Verify
node 06-verify-on-mirror.js <txId>
```

Expected results:

- ✅ Server prints `wss://*.ngrok-free.app` URL on startup
- ✅ Browser at `/create` connects via WSS without mixed-content errors
- ✅ alice's signature lands first (`1/2 collected`), session monitor shows `alice → signed`
- ✅ bob's CLI signature lands second, threshold met, coordinator submits
- ✅ Mirror confirms `SUCCESS`; ShareStep flips to **CompletedReceipt** with HashScan chip + signer list
- ✅ "Build another transaction" button returns to build step without tearing down session

---

## Phase 2 — Coverage gaps (manual)

Scenarios 11–13 don't exercise these. Hit each at least once per release.

| # | Scenario | Time | Why it matters |
|---|----------|------|----------------|
| 2.1 | Networked + ngrok tunnel | 15 min | Tunnel banner detection on `/join`; remote participant joins via public URL (covered in part by Scenario 13) |
| 2.2 | Mixed CLI + dApp + HashPack wallet in same session | 20 min | sessionStorage handoff (Phase B), CLI key + WalletConnect signer interoperate (Scenario 13 also covers this) |
| 2.3 | Scheduled transactions (HIP-423) | 20 min | `npx hedera-multisig schedule create` → multiple `ScheduleSign` over time → no 120 s pressure |
| 2.4 | Offline / air-gapped workflow | 30 min | `query-tx` + `sign-tx` round-trip via JSON files |
| 2.5 | Key rotation + revert | 15 min | `npm run update-keys` (2-of-3 → 3-of-5), then `npm run revert-multisig` |
| 2.6 | Agent signer with policy engine | 20 min | `AgentSigningClient` + at least one of MaxAmountRule, AllowedRecipientsRule, RateLimitRule |

### 2.1 — Networked + ngrok tunnel

```bash
# Terminal 1 — start coordinator with ngrok tunnel
NGROK_AUTH_TOKEN=<your-token> npx hedera-multisig server \
  -t 2 \
  -k "<key1>,<key2>,<key3>" \
  --port 3001 \
  --tunnel ngrok

# Output should include:
#   Public URL: wss://abc123.ngrok-free.app
#   QR code (scan from a phone to test mobile flow)

# Terminal 2 (or a different machine) — participant joins via public URL
npx hedera-multisig participant \
  --connect "<public connection string>" \
  --label alice \
  --keyfile ./alice.encrypted --passphrase ...
```

Expected:
- ✅ Tunnel established within ~5 s; URL printed
- ✅ Browser at `/join` paste connection string → tunnel-detection banner shows ngrok-free.app domain
- ✅ Remote participant connects without DNS / firewall issues
- ✅ Transaction completes; check `06-verify-on-mirror.js`

If `--tunnel ngrok` fails: fall back to `--tunnel localtunnel` (no auth needed; less reliable). See [Networking & tunnels](#networking--tunnels-ngrok).

### 2.2 — Mixed CLI + dApp + HashPack

Most likely place to find regressions. Three roles in one session:

1. Coordinator (CLI server)
2. CLI participant signing with file-based key (alice)
3. dApp participant signing with HashPack wallet (whichever Hedera account you've imported into HashPack)

```bash
# Terminal 1 — coordinator with all three eligible keys
node scripts/start-test-server.js
# When prompted, paste 3 public keys:
#   1. Alice's CLI key (from walkthrough-keys.json)
#   2. Bob's CLI key
#   3. Your HashPack wallet's public key (HashPack → account → Show Account Details)

# Terminal 2 — dApp
cd dapp && npm run dev
# Browser: http://localhost:3000/join → paste connection string → connect HashPack

# Terminal 3 — Alice via CLI
npx hedera-multisig participant --connect "..." --label alice --keyfile ./walkthrough-keys.alice.encrypted --passphrase walkthrough-test
```

Expected:
- ✅ All three connect (server logs: `Total connected: 3/3`)
- ✅ Coordinator injects via dApp `/create` (or via terminal 1's "press ENTER")
- ✅ Both CLI alice and HashPack-via-dApp see the transaction
- ✅ Threshold met with **one CLI signature + one HashPack signature**
- ✅ Transaction submits successfully

### 2.3 — Scheduled transactions

```bash
# Create a ScheduleCreate
npx hedera-multisig schedule create \
  --tx-type transfer-hbar \
  --from <thresholdAccountId> \
  --to <recipient> \
  --amount 1 \
  --expiration-time 7d

# Output: schedule ID + link to mirror node
# Each signer independently signs over hours/days:
npx hedera-multisig schedule sign --schedule-id <id> --keyfile alice.encrypted --passphrase ...
npx hedera-multisig schedule sign --schedule-id <id> --keyfile bob.encrypted --passphrase ...

# Once threshold met, transaction executes automatically (HIP-423)
```

Expected:
- ✅ ScheduleCreate succeeds; mirror returns `expirationTime`
- ✅ ScheduleSign 1 returns `executed_at: null`
- ✅ ScheduleSign 2 (threshold) returns `executed_at: <timestamp>`
- ✅ Mirror shows the inner transaction was submitted

### 2.4 — Offline / air-gapped

```bash
# Coordinator freezes and exports
npm run query-tx -- --file proposed-tx.json   # inspect
# (Construct the frozen tx via your own script or workflows/OfflineWorkflow)

# Distribute proposed-tx.json to signers (USB, email, QR, whatever)

# Each signer signs offline
npm run sign-tx -- --file proposed-tx.json --key <privKeyA> --output signed-by-A.json
npm run sign-tx -- --file proposed-tx.json --key <privKeyB> --output signed-by-B.json

# Coordinator merges signatures and submits
# (See examples/complete-lifecycle-workflow.js for the merge pattern)
```

Expected:
- ✅ `query-tx` shows the verified transaction details
- ✅ Each `sign-tx` writes a signed JSON file with the correct signature count incremented
- ✅ Merged + submitted transaction succeeds on mirror

### 2.5 — Key rotation + revert

```bash
# Rotate: 2-of-3 → 3-of-5 (requires 2 of the current 3 to sign the AccountUpdate)
ACCOUNT_ID=<thresholdAccountId> npm run update-keys

# Revert: M-of-N → single-sig (requires M of N to sign the AccountUpdate)
ACCOUNT_ID=<thresholdAccountId> npm run revert-multisig
```

Expected:
- ✅ `AccountInfoQuery` after rotation shows new `KeyList` with `threshold = 3`, 5 keys
- ✅ `AccountInfoQuery` after revert shows a single key
- ✅ Both operations require the **dual-signature rule** (old key list + new key) — the script handles this; just confirm it succeeds

### 2.6 — Agent signer with policy engine

See [`docs/AGENT_INTEGRATION.md`](./docs/AGENT_INTEGRATION.md) for the full
policy reference. Minimum smoke test: configure `AgentSigningClient` with
`MaxAmountRule(10)` and prove it auto-signs a 5 ℏ transfer but rejects a
50 ℏ transfer.

> **Need a dedicated account for the agent?** The walkthrough's keys are
> just keys, not accounts with their own fee budgets. If your test wants
> the agent to pay its own fees from a separate account, run
> `npm run setup-test-env` to bootstrap 3 funded accounts (`.testenv.json`).
> The operator account also works fine for testing — the dedicated
> account is only useful if you're modelling realistic per-agent
> accounting.
>
> ```bash
> # Defaults: 3 accounts, 5 ℏ each
> npm run setup-test-env
>
> # Other modes
> npm run setup-test-env -- --accounts 5 --balance 10  # bigger pool
> npm run setup-test-env -- --top-up                   # refill existing
> npm run setup-test-env -- --force                    # recreate (testnet only)
> ```
>
> `.testenv.json` is gitignored.

---

## Phase 3 — Failure-mode smoke

Five quick checks; each takes ~1 minute. All should fail in the **expected**
way (clear error code, not a crash, not silent success).

| # | Failure | Expected |
|---|---------|----------|
| 3.1 | Wrong PIN | `AUTH_FAILED`, rate-limited after 3 tries (per-IP + per-session) |
| 3.2 | Idle session > 30 min, then reconnect | Reconnection rejected; new session required |
| 3.3 | Inject + only 1 of 2 signs, wait 120 s | `TRANSACTION_EXPIRED` on submit |
| 3.4 | EOA single-sig call after multi-sig conversion | `INVALID_SIGNATURE` (automated by `examples/walkthrough-contract/06-prove-eoa-rejected.js`) |
| 3.5 | Threshold-not-met submit attempt | Coordinator refuses to submit; clear error message |

### 3.1 — Wrong PIN

```bash
# Coordinator: standard server start (records correct PIN, e.g. 123456)

# Participant tries with wrong PIN:
npx hedera-multisig participant --connect "..." --pin 000000
# Expected: AUTH_FAILED. Repeat 3x — 4th attempt rate-limited.
```

### 3.2 — Expired session

Start a server, leave it idle for 31 minutes, try to connect. Should refuse.
(Speed up by setting `SESSION_TIMEOUT=10000` in env for a 10-second timeout —
useful for CI smoke.)

### 3.3 — 120 s timeout

Inject a transaction. Have only one of two participants sign. Wait. The
coordinator's submit attempt should fail with `TRANSACTION_EXPIRED`.

### 3.4 — EOA after conversion (already automated)

Already covered by `examples/walkthrough-contract/06-prove-eoa-rejected.js`.
That script asserts `INVALID_SIGNATURE` and exits 0 on success.

### 3.5 — Threshold not met

Inject. Have zero participants sign. Try to submit from coordinator. Should
refuse, not silently submit a half-signed transaction.

---

## Phase 4 — dApp surface

10-minute walk through every route in the browser. Run a coordinator
server first so the dynamic routes have data.

| Route | What to verify |
|-------|----------------|
| `/` | Landing page loads; "How this works" reassurance card visible. **Network tab:** WalletConnect chunk does NOT load (verifies C8 lazy-load). |
| `/learn` | Both walkthrough cards render; links to README sections work. |
| `/join` | Paste a tunnel URL → tunnel-detection banner shows. Paste a hosted URL → hosted banner instead. PIN field opt-in (Phase B). |
| `/create` | After coordinator AUTH: Build / Paste tabs visible. Build form: HBAR / Token / Contract toggles. ABI editor accepts JSON. |
| `/session/[id]` | Live participant list updates as they join. Signature counter increments. |
| `/history` | Past sessions listed (if any). Disclaimer about local storage visible. |

Smoke check from the command line:

```bash
curl -sI http://localhost:3000/learn | head -3
# Should return HTTP 200
```

---

## Networking & tunnels (ngrok)

The coordinator server has three tunnel modes:

| Mode | Flag | Auth required | Use when |
|------|------|---------------|----------|
| ngrok | `--tunnel ngrok` | Yes — auth token | Remote participants on different networks; production-ish demo |
| localtunnel | `--tunnel localtunnel` | No | Quick public URL without signup; less reliable, no custom domains |
| none | `--no-tunnel` | No | All participants on the same LAN or running locally |

### Getting an ngrok auth token (free)

1. Sign up: **https://dashboard.ngrok.com/signup** — email + password, no credit card.
2. Copy your token: **https://dashboard.ngrok.com/get-started/your-authtoken**
3. Install it via **one** of these:

   ```bash
   # Option A — env var (recommended for testing; the server reads this)
   export NGROK_AUTH_TOKEN=2abc...   # Linux/macOS
   $env:NGROK_AUTH_TOKEN="2abc..."   # PowerShell
   set NGROK_AUTH_TOKEN=2abc...      # Windows cmd

   # Option B — persist in ngrok's config (one-time, machine-wide)
   ngrok config add-authtoken 2abc...
   ```

4. Run the server:

   ```bash
   npx hedera-multisig server -t 2 -k "..." --tunnel ngrok
   ```

   Output should include `Public URL: wss://<random>.ngrok-free.app`. The
   URL changes per session — copy from the server's output, don't hardcode
   it in scripts.

### Common ngrok issues

- **`ERR_NGROK_4018`: tunnel session limit reached** — the free tier allows
  one active tunnel per account. Kill any other ngrok sessions, or upgrade.
- **`failed to start tunnel: authentication failed`** — wrong token. Re-copy
  from the dashboard; tokens are ~50 chars.
- **Browser shows "ngrok warning page"** — the free tier interstitial. Click
  through; participants only see this on first connect from a given
  browser.
- **No public URL printed at all** — server fell back to localtunnel.
  Check the log for the auth-token error and re-export.

For production deploys, see [`docs/COORDINATOR_GUIDE.md`](./docs/COORDINATOR_GUIDE.md)
"Trust model" before exposing a coordinator on the public internet.

---

## Unit & coverage tests (`npm test`)

```bash
# All unit + integration tests (120 s timeout for Hedera network ops)
npm test

# Unit only (no Hedera network calls)
npm run test:unit

# Workflow integration (requires OPERATOR_ID/KEY)
npm run test:workflows

# Networked workflow specifically
npm run test:networked

# Coverage report
npm run test:coverage

# Coverage gate (CI uses this)
npm run test:coverage:check

# Single file
npx mocha test/offline.test.js --timeout 120000

# Single test by name
npx mocha test/workflows.test.js --grep "Interactive" --timeout 120000
```

Coverage gate floors (set in `package.json`): **lines 56, functions 50, branches 63**.
Don't lower these without a CRITICAL justification.

---

## Troubleshooting

### `npm run precheck` says operator balance is too low

Visit https://portal.hedera.com/, select your testnet account, click
"Refill Account." That replenishes to ~10,000 ℏ.

### Walkthrough script fails with `INVALID_SIGNATURE`

The `OPERATOR_KEY` in `.env` doesn't match `OPERATOR_ID`. Re-copy both
from the portal — they must come from the same account.

### Participants can't connect

Check the connection string matches what the coordinator printed:
- `--no-tunnel` → `ws://localhost:3001` (or whichever `--port`)
- `--tunnel ngrok` → `wss://<random>.ngrok-free.app` (changes per session)

If using a tunnel, also check the participant's network can reach the
public URL (corporate firewalls sometimes block ngrok subdomains).

### `Cannot inject transaction — session status is …`

Sessions are single-injection. Once a transaction is injected, you can't
inject another into the same session. Restart the server to start fresh.

### Transaction expires (`TRANSACTION_EXPIRED`)

The 120-second window has elapsed between freeze and submit. Either move
faster, or use the scheduled-transaction workflow (Phase 2.3) which has
no such constraint.

### dApp shows "Wallet public key not eligible"

The wallet's public key isn't in the `eligiblePublicKeys` array the
coordinator used. Either:
- Check you copied the right key from HashPack (Account → Show Account Details → Public Key)
- Or restart the coordinator with the correct key list

---

## Performance benchmarks

Expected timings on testnet:

| Operation | Time |
|-----------|------|
| Pre-session creation | < 2 s |
| Participant connection | < 1 s |
| Key loading | < 1 s |
| Transaction injection | < 2 s |
| Transaction review | user-paced |
| Signature submission | < 1 s |
| Transaction execution | 3–5 s |
| **Total (2-of-3 happy path)** | **~10–15 s** |

The 120-second window is **only** the post-injection signing phase. The
pre-session phase (connect, load keys, mark ready) is unbounded — signers
can sit in the session for hours waiting for the transaction.

---

## CI

GitHub Actions runs unit tests + production audit + npm publish on tag.
See [`.github/workflows/release.yml`](./.github/workflows/release.yml).

Required secrets:
- `HEDERA_OPERATOR_ID` (testnet account)
- `HEDERA_OPERATOR_KEY`
- `NPM_TOKEN` (for publish)

Coverage gate: `npm run test:coverage:check` must pass — currently 56/50/63.

---

## Appendix: legacy ad-hoc scenarios

These pre-date the scripted walkthroughs and remain useful for targeted
regression testing.

<details>
<summary>Click to expand — Scenarios 1–10</summary>

### Scenario 1 — Simple Transfer with 2-of-3

```bash
# Terminal 1 — coordinator
node cli/server.js -t 2 -k "key1,key2,key3" -p 3

# Terminals 2-4 — participants
node cli/participant.js --url <url> --session <id> --pin <pin>
```

### Scenario 2 — Remote participants with tunnel

```bash
NGROK_AUTH_TOKEN=xxx node cli/server.js -t 2 -k "key1,key2,key3"
# Share public URL; remote participants connect normally
```

### Scenario 3 — Metadata validation

Inject a transaction with deliberately wrong metadata (amount, recipient).
Participants should see ⚠️ warnings but VERIFIED data should still match
the actual transaction.

### Scenarios 4–10

Covered by Phase 2 of this guide.

</details>

---

**Need help?**
- File an issue: https://github.com/lazysuperheroes/hedera-multisig/issues
- Examples: [`examples/`](./examples/)
- Test files: [`test/`](./test/)
