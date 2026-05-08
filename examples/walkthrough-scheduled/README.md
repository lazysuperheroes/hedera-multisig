# Walkthrough: async multi-sig with HIP-423 scheduled transactions

> **What you'll demonstrate:** a 2-of-3 multi-sig HBAR transfer where each
> signer reviews and signs **on their own time** — not a 120-second
> ceremony. Alice signs from her phone after lunch; bob signs from his
> CLI before bed; the network executes the transfer the moment the
> second signature lands. Up to ~62 days between create and execute
> (HIP-423 long-window).
>
> **Why this matters:** the hardest constraint on real multi-sig
> ceremonies is *getting everyone in front of a screen at the same
> time*. Treasury approvals, payroll batches, and cross-timezone team
> sign-offs don't fit in a 120-second window. Scheduled transactions
> push the window out to days. The same protocol — same KeyList, same
> thresholding, same mirror-node verifiability — without the human
> coordination headache.

This walkthrough ships the dApp's "Schedule this transaction" feature
(`v2.1.x`) and the CLI participant's native scheduled-tx handler. You
do not need to drop to a separate command to sign — the participant
gets a prompt the moment the schedule is announced, just like the
realtime flow.

What runs where:

| Component | Where | What |
|---|---|---|
| **Coordinator** (`npx hedera-multisig server …`) | Your machine, terminal 1 | WebSocket signaling channel. Holds session lifetime metadata + the announced `scheduleId`. **Doesn't broker signatures** — those go straight on-chain. |
| **dApp UI** (`/create`, `/session/...`) | Hosted: `testnet-multisig.lazysuperheroes.com` | The coordinator UI submits `ScheduleCreateTransaction` from the wallet, then announces the resulting `scheduleId` to the session. Participants join `/session/<id>` and submit `ScheduleSignTransaction` from their own wallet. |
| **HashPack** (alice's signer) | Browser extension on alice's machine | Signs alice's `ScheduleSignTransaction`. **Pays alice's own fee** (~$0.00001) — no shared paymaster. |
| **CLI participant** (bob's signer) | Your machine, terminal 3 | Receives `SCHEDULE_CREATED` over WS, reviews the inner-tx and schedule metadata, prompts `YES`, submits `ScheduleSignTransaction` directly to the network. |

> **Want the contrasting realtime flow?** See
> [`../walkthrough-dapp/`](../walkthrough-dapp/) — same accounts, same
> signers, same dApp, but a 120-second ceremony with WS-collected
> signatures. Side-by-side, the two walkthroughs make the protocol
> shape clear: realtime collects sigs into the wire-frozen tx and
> submits once at threshold; scheduled has each signer hit the
> network independently and lets the consensus layer count.

Roughly 20–30 minutes to run end-to-end. The "wait" parts are
contrived — you can sign both wallets within a minute if you're
demoing — but the architecture is the same one a real team would use
to span days.

---

## Prerequisites

1. **Operator credentials** in the project root `.env`
   (`OPERATOR_ID`, `OPERATOR_KEY`, `HEDERA_NETWORK=testnet`). See
   [`START_HERE.md`](../../START_HERE.md) if you don't have a testnet
   account yet — `portal.hedera.com` gives you 10,000 testnet ℏ for
   free.
2. **Node 20+** and `npx` on your `$PATH`.
3. **An ngrok auth token** in `.env` as `NGROK_AUTH_TOKEN=...`. Free
   tier is fine. See the dApp walkthrough's
   [Prerequisites](../walkthrough-dapp/README.md#prerequisites) for the
   one-time setup.
4. **HashPack** (or any WalletConnect-compatible Hedera wallet)
   installed on testnet.

---

## Step 1: Reuse keys + threshold account from the dApp walkthrough

The scheduled walkthrough is **protocol-equivalent** to the dApp
walkthrough — same 2-of-3 KeyList, same alice/bob/carol signer
accounts. Don't regenerate keys; copy them across:

```bash
cd examples/walkthrough-scheduled

# If you've run the dApp walkthrough already:
cp ../walkthrough-dapp/walkthrough-keys.* .
cp ../walkthrough-dapp/walkthrough-state.json .
cp ../walkthrough-dapp/walkthrough-signer-accounts.json .
```

If you haven't run it yet, do steps 1–3 of
[`../walkthrough-dapp/README.md`](../walkthrough-dapp/README.md)
(generate keys → create signer accounts → create threshold account)
**there**, then come back here. Those scripts produce all three
files.

After this step you should have:

```
walkthrough-keys.alice.encrypted   walkthrough-keys.bob.encrypted   walkthrough-keys.carol.encrypted
walkthrough-keys.json              walkthrough-state.json           walkthrough-signer-accounts.json
```

---

## Step 2: Start the coordinator with a long session timeout

The coordinator's job here is signaling, not signature collection — so
the only adjustment vs. the realtime walkthrough is `--session-timeout
86400` (24 hours, in seconds). For a multi-day window, scale up
accordingly (max ~62 days = `--session-timeout 5356800`).

In **terminal 1**:

```bash
npx hedera-multisig server \
  -t 2 \
  -k "$(node -p "require('./walkthrough-state.json').publicKeys.join(',')")" \
  --port 3001 \
  --tunnel-provider ngrok \
  --session-timeout 86400 \
  --allowed-origins https://testnet-multisig.lazysuperheroes.com
```

> **Why `--session-timeout` and not `--timeout 0`?** `--timeout 0`
> keeps the session alive *forever in the absence of activity*, which
> is great for development but bad for production: if the coordinator
> machine reboots or the tunnel drops, there's no client-side hint
> that it's gone. `--session-timeout 86400` says "this session has a
> defined 24h lifecycle" — clients know when to give up, the server
> garbage-collects abandoned sessions, and it lines up with the
> schedule's on-chain expiration. The two windows don't have to match
> exactly, but they should be in the same order of magnitude.

The server prints:

- **Public WSS URL** — the dApp connects to this
- **Session ID**, **PIN**, **coordinator token**, **HMSC connection
  string** (`hmsc:eyJz…`)
- **Session lifetime: 24h** — confirming the long window

Save the connection string. Leave terminal 1 running.

---

## Step 3: Coordinator builds + schedules the transaction

1. Open
   [`testnet-multisig.lazysuperheroes.com/create`](https://testnet-multisig.lazysuperheroes.com/create).
2. Paste the HMSC connection string. Provide the coordinator token
   when prompted.
3. Build a small HBAR transfer **from your threshold account**:
   - **From:** `<thresholdAccountId>` (from `walkthrough-state.json`)
   - **To:** your operator ID (or any testnet account)
   - **Amount:** `0.5`
4. **Open the "Schedule this transaction" disclosure** below the
   freeze-strategy panel:
   - Toggle **Schedule this transaction** ON.
   - **Expiration:** leave the default `24h`. (Try `48h` or `7d` if
     you want a longer demo.)
   - **Memo:** optional — `walkthrough payout` reads well on the
     mirror node.
   - Skip the **Advanced** sub-disclosure (payer override / admin
     key); the defaults are fine.
5. Click **Build & schedule transaction**.
6. HashPack pops up to sign the `ScheduleCreateTransaction` itself
   (your operator pays the create fee, ~$0.05). Approve.
7. The dApp shows a **Schedule Created** confirmation with the new
   `scheduleId` (e.g., `0.0.7891234`) and a HashScan link.

What just happened on-chain:

- A `ScheduleCreateTransaction` was submitted by your operator.
- It wraps your inner HBAR transfer and adds a `KeyList(2-of-3)`
  expectation — the network knows it can execute when 2 of {alice,
  bob, carol} have signed via `ScheduleSignTransaction`.
- The schedule is on-chain and queryable
  (`hedera-multisig schedule status --schedule-id <id>`).
- The coordinator broadcast `SCHEDULE_CREATED` to anyone connected
  to the WS session, including its inner-tx context for the review
  screen.

---

## Step 4: Two participants sign — on their own time

Same hybrid pattern as the dApp walkthrough: alice signs in HashPack,
bob signs from the CLI. The difference is **no countdown**. Either
signer could disappear for a day and pick up again where they left off.

### 4a. Alice joins from the dApp

Open
[`testnet-multisig.lazysuperheroes.com/join`](https://testnet-multisig.lazysuperheroes.com/join)
in alice's browser tab. Paste the connection string. Connect HashPack
+ the alice account.

The dApp routes alice to `/session/<id>`. Because the session is in
**scheduled mode**, the review surface is the dedicated
**ScheduledReview** component, not the realtime TransactionReview:

- A blue "Scheduled transaction (HIP-423)" banner at the top — sets
  the mental model: async, on-chain, long-window.
- "Expires in ~23h 58m" instead of a 120-second countdown.
- A pre-decoded inner-transaction summary (HBAR transfer details).
- Schedule metadata (memo, payer, optional admin key).
- Live mirror-node lookup confirming the schedule exists on-chain
  and how many signatures it has so far.
- Two buttons: **Approve & sign on-chain** / **Reject — broadcast
  to coordinator + other signers**.

Alice clicks **Approve & sign on-chain**. HashPack pops up showing a
`ScheduleSignTransaction` for the schedule's ID. Alice signs. Her
client submits the signed wrapper directly to the network. Within a
few seconds the mirror node updates: 1 signature collected, threshold
not yet met. The schedule is still on-chain, alive until tomorrow.

> **Note for the demo.** Alice can close her browser at this point.
> Her signature is on-chain. The coordinator is no longer in the
> critical path for her — she's done.

### 4b. Bob joins from the CLI (later)

Hours later — or seconds, if you're demoing — bob runs the
participant from his terminal:

```bash
cd examples/walkthrough-scheduled
npx hedera-multisig participant \
  --connect "$(... HMSC string from terminal 1 ...)" \
  --label bob \
  --keyfile ./walkthrough-keys.bob.encrypted \
  --passphrase walkthrough-test
```

Because the session is in **scheduled mode** and bob is a late joiner,
the participant prints:

```
💡 You joined a session that already has a scheduled transaction. Reviewing it now…

📅 Scheduled transaction (HIP-423)
Async signing — no 120-second window. Once you sign, your signature
lands on-chain via ScheduleSignTransaction. Hedera executes the
inner transaction when threshold is met or when the schedule expires.

Schedule:
  ID:      0.0.7891234
  Expires: 2026-05-09T...Z (~23h 47m from now)
  Memo:    walkthrough payout

Inner transaction:
  Type: TransferTransaction
  hbarTransfers: [...]

Verify the schedule on-chain:
  https://hashscan.io/testnet/schedule/0.0.7891234

Sign this schedule? Type YES to approve, anything else to skip:
```

Bob types `YES`. The CLI:

1. Builds a `ScheduleSignTransaction` against the schedule ID.
2. Signs it with bob's decrypted private key.
3. Submits it directly to the Hedera network via the operator
   account in `.env` (which pays the ScheduleSign fee).
4. The receipt confirms the schedule executed — threshold of 2 met
   with bob's signature.

```
✅ Schedule signature submitted on-chain
   Sign tx: 0.0.OPERATOR@1715200000.123456789
   🎉 Threshold met — Hedera executed the inner transaction.
```

The coordinator stays open. Other coordinators in the chat can verify
on the mirror node; nothing else needs to happen.

> **`--auto-approve` for headless signers.** For agent / CI flows,
> add `--yes` (existing flag, treated as auto-approve in the
> scheduled handler). The CLI signs and submits without prompting —
> useful when bob is actually a server.

> **What if bob isn't watching the WS session at all?** He can sign
> later from any machine with his keyfile, without re-joining the
> session:
> ```bash
> hedera-multisig schedule sign --schedule-id 0.0.7891234 \
>   --keyfile ./walkthrough-keys.bob.encrypted \
>   --passphrase walkthrough-test
> ```
> Same on-chain result. The WS session is a *convenience* (review
> surface + announcement), not a gating layer.

Carol does not need to sign — that's the point of 2-of-3.

---

## Step 5: Verify on the mirror node

```bash
node 01-status.js
```

This script reads `walkthrough-state.json`'s `lastScheduleId` (set by
the dApp via the coordinator's session info — or pass `--id` to
override) and prints the schedule's full mirror-node record:

```
━━━ Schedule 0.0.7891234 ━━━

  Status:       EXECUTED ✅
  Memo:         walkthrough payout
  Creator:      0.0.OPERATOR
  Payer:        0.0.OPERATOR
  Expiration:   2026-05-09T...Z
  Executed at:  2026-05-08T...Z

  Signatories (2):
    - 302a300506032b6570032100… (alice)
    - 302a300506032b6570032100… (bob)

  Inner transaction (executed):
    Type: TransferTransaction
    Threshold account → recipient: 0.5 ℏ
    Resulting tx: 0.0.7654321@1715200000.987654321
```

You can also poll directly with the existing CLI:

```bash
hedera-multisig schedule status --schedule-id 0.0.7891234
```

---

## Architecture recap

```
Terminal 1                  Browser (alice)              Terminal 3 (bob)         Hedera network
(coordinator: signaling     (HashPack + dApp)            (CLI participant)        (consensus + mirror)
 channel only)
──────────                  ──────────────                ────────────────         ──────────────
npx multisig server         /create
  --session-timeout 86400     build + schedule ↘
       ↓                                       ↘
   wss://abc.ngrok                              ScheduleCreateTransaction →→ on-chain
                                                            ↓
                                              announce SCHEDULE_CREATED to session
                              /join → /session/<id> ←──────┴───────→ CLI: SCHEDULE_CREATED handler
                                  ScheduledReview                        prompt YES
                                  approve                                approve
                                       ↓                                      ↓
                              alice signs ScheduleSign     bob signs ScheduleSign
                                       ↓                                      ↓
                              submitted to network →→→  on-chain  ←←← submitted to network
                                                            ↓
                                                  Hedera counts signatures
                                                  threshold met → execute inner tx
                                                            ↓
                                                       mirror confirms
                              (alice can close her browser between sign and execute — no WS dependency)
```

The coordinator is a **signaling channel + status feed**. Mirror
node is the source of truth for "who has signed this schedule". The
WS session is for human convenience: announcement, review surface,
stats display. It can drop and the on-chain ceremony continues.

This is a fundamentally different shape from the realtime flow —
realtime has every signature pass *through* the coordinator,
scheduled has every signature go *around* it. The same code in this
repo handles both because the two flows share the protocol seam:
"announce a tx that needs signatures → review → sign → execute".

---

## Variant: all-CLI scheduled

If you want a no-browser demo (perfect for CI / agent walkthroughs):

```bash
# Terminal 1 (coordinator) — same as step 2 above

# Terminal 2 (CLI coordinator-create — instead of the dApp /create):
INNER_BASE64=$(npx hedera-multisig offline freeze \
  -t transfer \
  -f "$(node -p "require('./walkthrough-state.json').thresholdAccountId")" \
  -T "$OPERATOR_ID" -a 0.5 --raw)

npx hedera-multisig schedule create \
  -b "$INNER_BASE64" \
  --memo "walkthrough payout" \
  --expiration-time 24h
# → prints scheduleId

# Terminals 3 & 4 (alice + bob CLI participants — they connect to the
# WS session and sign whenever):
npx hedera-multisig participant --connect "<HMSC>" --label alice \
  --keyfile ./walkthrough-keys.alice.encrypted --passphrase walkthrough-test \
  --yes  # auto-approves on SCHEDULE_CREATED

npx hedera-multisig participant --connect "<HMSC>" --label bob \
  --keyfile ./walkthrough-keys.bob.encrypted --passphrase walkthrough-test \
  --yes
```

This is the agent / treasury-bot pattern: signers are processes, not
people. They watch the WS session, auto-sign when a schedule matches
their policy, and the network executes once threshold is met.

---

## Cleanup

The walkthrough leaves on-chain artifacts (the schedule, the executed
transfer) and a few local files. Same shape as the dApp walkthrough:

```bash
rm walkthrough-keys.* walkthrough-state.json walkthrough-signer-accounts.json
# Stop the coordinator (Ctrl+C in terminal 1).
```

The on-chain schedule auto-cleans itself on expiry; an executed
schedule is closed immediately. No on-chain action required from you.

---

## Troubleshooting

**Coordinator session times out before signers finish** — you used
the default 30-minute timeout instead of `--session-timeout 86400`.
Restart with the longer flag. Existing on-chain schedule is
unaffected — late signers can still run
`hedera-multisig schedule sign --schedule-id <id>` directly without
the WS session.

**`SCHEDULE_ALREADY_EXECUTED`** — bob signed *after* threshold was
already met by alice + carol (or some other combination). This is
benign: the network treats it as a no-op success, and bob's CLI
prints the `Schedule was executed` confirmation instead of an error.

**`SCHEDULE_EXPIRED`** — the schedule's `expirationTime` passed
before threshold was reached. The network deletes the schedule;
nobody's HBAR moved. Coordinator re-runs `/create` with a fresh
schedule.

**dApp shows "Mirror node hasn't indexed this schedule yet"** —
mirror lag. The dApp polls 6× over 12 seconds before showing this.
If you see it persistently, your local time is off or the schedule
genuinely failed to land — check terminal 1 for a server-side error.

**HashPack signs but the schedule never executes** — only one
signature has landed. Check
`hedera-multisig schedule status --schedule-id <id>` to see who's
signed; the inner tx executes the moment the second eligible
signature lands. If you see two or three signatures and `EXECUTED:
no`, the executable inner tx might be invalid (wrong account, no
balance, etc.) — mirror node's `transaction_body` field shows the
exact body the network rejected.

**CLI participant says `Cannot submit ScheduleSign: missing
OPERATOR_ID / OPERATOR_KEY`** — bob's terminal has no `.env` loaded
or the env vars aren't set. The participant pays the ~$0.00001
ScheduleSign fee from `OPERATOR_ID`. The signer's *signing key* is
loaded from the keyfile separately; the operator account is just the
fee payer. For a real production setup, bob's operator would be
bob's own account, not your shared testnet operator.

---

## Why this walkthrough exists

The 120-second window is the dominant pain point in real multi-sig
adoption. Everything we ship in this repo can be split into:

- **Realtime path:** all signers online + coordinated within 120s.
  WS-collected signatures, single network submission. Best when
  cycle time matters (high-frequency treasury, agent-to-agent).
- **Scheduled path:** signers sign on their own time. Each signature
  goes on-chain individually; network counts. Best when the human
  coordination overhead is the bottleneck.

`walkthrough-dapp` shows realtime. This shows scheduled. Run them
back-to-back to see the protocol shape — same accounts, same threshold,
same dApp UI, two different temporal models. That's the pitch.
