# Walkthrough: agent co-signing with policy

> **What you'll demonstrate:** an automated agent that auto-signs
> transactions matching its policy (max amount, allowlisted
> recipients) and rejects everything else with a clear reason. Two
> signers — a human (alice) and the agent — on a 2-of-2 threshold
> account, with the agent's `AgentSigningClient` + `PolicyEngine`
> doing the policy work.
>
> Roughly 25 minutes end-to-end. Costs ≈ 7 ℏ from your operator
> (signer accounts + threshold + scenario transfers).

The headline use case for the agent SDK: a treasury where a human
co-signer has the final say, but the agent fast-paths anything
already pre-approved by policy (payroll, recurring vendor payments,
etc.) — and refuses, loudly, anything that fails the policy. Three
demo scenarios walk that range:

| Scenario | What it tries | What the agent does |
|---|---|---|
| `allowed` | 5 ℏ → operator (allowlisted, under 10 ℏ limit) | **APPROVES** — signs, alice signs, executes ✓ |
| `over-limit` | 50 ℏ → operator (allowlisted but over limit) | **REJECTS** via `MaxAmountRule` |
| `blocked` | 5 ℏ → 0.0.98 (not allowlisted) | **REJECTS** via `AllowedRecipientsRule` |

Three terminals:

| Terminal | What runs |
|---|---|
| 1 | The coordinator (`hedera-multisig server`) |
| 2 | The agent (`node 04-run-agent.js`) — long-running, prints policy decisions |
| 3 | Alice's CLI signer (`hedera-multisig participant`) — long-running, auto-approves the verified bytes once the agent has approved |

A fourth one-shot shell runs `node 05-inject-scenario.js --scenario X` for each demo. The injector auto-discovers the coordinator via `.multisig-session.json` so you don't have to copy connection strings around.

---

## Prerequisites

- Operator account in your project root `.env`
  (`OPERATOR_ID`, `OPERATOR_KEY`, `HEDERA_NETWORK=testnet`).
- Node 20+, `npx` on `$PATH`.
- No browser wallet needed for this walkthrough — alice signs from
  CLI. The agent's signing path is also CLI-only by definition.

---

## Step 1: Generate keys (alice + agent)

```bash
cd examples/walkthrough-agent
node 01-generate-keys.js
```

Two encrypted key files: `walkthrough-keys.alice.encrypted` and
`walkthrough-keys.agent.encrypted`. Both wrapped with the testnet
passphrase `walkthrough-test`. The agent's encrypted file is loaded
by `04-run-agent.js` at startup so the agent can sign.

> **Production shape:** alice's key would live on her device
> (HashPack / hardware wallet); the agent's key would live on the
> agent's host (encrypted, passphrase from a secrets manager). For
> the demo both are on this machine — the threat model is testnet
> only.

## Step 2: Create on-chain accounts for the signing keys

```bash
node 02-create-signer-accounts.js
```

≈ 1.1 ℏ — creates a Hedera account for alice and one for the agent.
The threshold account in step 3 uses these *public keys*, not the
accounts themselves; the on-chain accounts exist so wallet/CLI tooling
can resolve "this key belongs to that account".

## Step 3: Create the 2-of-2 threshold account

```bash
node 03-create-threshold-account.js
```

≈ 5 ℏ initial balance into the new threshold account. Both alice and
the agent must sign for any tx out of it. Persists
`thresholdAccountId` to `walkthrough-state.json`.

---

## Step 4: Start the coordinator (terminal 1)

```bash
npx hedera-multisig server \
  -t 2 \
  -k "$(node -p "require('./walkthrough-state.json').publicKeys.join(',')")" \
  --port 3001 \
  --no-tunnel \
  --timeout 0
```

`--no-tunnel` because all signers are local CLI clients in this
walkthrough — no browser involvement. `--timeout 0` keeps the session
alive across all three demo scenarios.

The server prints the connection string + coordinator token. It also
writes `.multisig-session.json` to its CWD — the inject script auto-
reads that, so you don't need to copy/paste the connection details.
Keep this terminal in view; you'll watch acceptance / rejection
broadcasts here.

---

## Step 5: Start the agent (terminal 2)

```bash
# Copy the connection string from terminal 1's output, or read it from
# the session file:
node 04-run-agent.js --connect "$(node -p "require('../../.multisig-session.json').connectionString")"
```

The agent prints its policy on startup so you can see what it's
willing to sign:

```
━━━ Treasury agent ━━━

Policy:
  • Allowed tx types:  TransferTransaction
  • Max amount per tx: 10 ℏ
  • Allowed recipients: 0.0.YOUR_OPERATOR

Signer:
  • Public key: 302a300506032b6570032100…

Session:
  • Server:  ws://localhost:3001
  • Session: e2e41be1c9058eaeec…

✓ connected
✓ ready — waiting for transactions to evaluate
  (Ctrl+C to stop the agent)
```

Now the agent is parked, ready to evaluate any incoming transaction.

---

## Step 6: Start alice's CLI signer (terminal 3)

```bash
npx hedera-multisig participant \
  --connect "$(node -p "require('../../.multisig-session.json').connectionString")" \
  --key-file walkthrough-keys.alice.encrypted \
  --passphrase walkthrough-test \
  --label alice \
  --auto-approve
```

`--auto-approve` because we're confident in the verified bytes for
this demo. In a real treasury workflow alice would review each tx
manually — the agent's job is to fast-path the cases where policy
already covers the decision; alice's job is the human-in-the-loop
check.

Alice's CLI prints `Ready` and waits for transactions.

---

## Step 7: Run the three scenarios (one-shot terminal)

```bash
# Scenario 1 — under limit, allowlisted recipient
node 05-inject-scenario.js --scenario allowed
```

Watch terminal 2 (the agent):

```
→ tx received  type=TransferTransaction
    0.0.THRESHOLD: -5 ℏ
    0.0.OPERATOR: 5 ℏ
✓ APPROVED by policy
✓ signature submitted
   server accepted (1/2)
🎉 threshold met — coordinator will execute
✅ executed: 0.0.OPERATOR@…
   waiting for next transaction…
```

Alice's terminal will show her auto-approving + signing. The
coordinator terminal will show threshold met + execution success.
HashScan will show the 5 ℏ moved.

```bash
# Scenario 2 — over limit, allowlisted recipient
node 05-inject-scenario.js --scenario over-limit
```

Watch terminal 2:

```
→ tx received  type=TransferTransaction
    0.0.THRESHOLD: -50 ℏ
    0.0.OPERATOR: 50 ℏ
✗ REJECTED by policy  (MaxAmountRule: Transfer amount 50 HBAR exceeds limit of 10 HBAR)
```

The agent broadcasts `TRANSACTION_REJECTED` with the reason. Alice's
CLI sees the rejection broadcast, drops the transaction, returns to
ready. The session goes back to `waiting` automatically (server-side
cleanup we shipped in 2.1.20).

```bash
# Scenario 3 — under limit, blocked recipient
node 05-inject-scenario.js --scenario blocked
```

Watch terminal 2:

```
→ tx received  type=TransferTransaction
    0.0.THRESHOLD: -5 ℏ
    0.0.98: 5 ℏ
✗ REJECTED by policy  (AllowedRecipientsRule: Recipient 0.0.98 not in allowlist)
```

Same shape as scenario 2 — clear reason, ceremony aborts.

---

## What the demo proves

1. **Composable policy.** The agent runs three rules in AND
   composition (`AllowedTransactionTypesRule`, `MaxAmountRule`,
   `AllowedRecipientsRule`). Any rule rejecting fails the whole
   policy with a named reason. The
   [PolicyEngine](../../client/PolicyEngine.js) source has 5 rules
   built-in plus a `TreasuryAgent` preset; adding your own is
   ~30 lines.
2. **Reasoning is preserved end-to-end.** When the agent rejects, the
   `MaxAmountRule: Transfer amount 50 HBAR exceeds limit of 10 HBAR`
   string travels via `TRANSACTION_REJECTED` to every other
   participant + the coordinator. Operators see WHY in plain English,
   not just "rejected."
3. **No browser, no human bottleneck on policy-clean transactions.**
   Scenario 1 ran with zero clicks. The agent + alice's
   `--auto-approve` CLI handled it. For ceremonies where the human
   wouldn't approve regardless of agent decision, drop the
   `--auto-approve` flag and alice manually reviews.
4. **Threshold is preserved.** The agent isn't a backdoor — it's
   one signer of two. Alice can refuse a transaction the agent
   approved (and vice versa). The agent's value is "auto-handle the
   easy cases" rather than "bypass human oversight".

---

## Customizing the policy

The policy lives in `04-run-agent.js`'s `MAX_HBAR_PER_TX`,
`ALLOWED_TX_TYPES`, and `buildAllowedRecipients()` constants. Tune
those, restart the agent, and the demo behavior follows. For a more
elaborate setup:

```js
const policy = new PolicyEngine()
  .addRule(new MaxAmountRule(10))
  .addRule(new AllowedRecipientsRule(['0.0.PAYROLL', '0.0.VENDOR']))
  .addRule(new AllowedTransactionTypesRule(['TransferTransaction']))
  .addRule(new TimeWindowRule({
    startUtcHour: 9, endUtcHour: 17, // only sign during business hours
  }))
  .addRule(new RateLimitRule({
    maxTxPerHour: 5,                  // throttle
  }));
```

See [`docs/AGENT_INTEGRATION.md`](../../docs/AGENT_INTEGRATION.md)
for the full PolicyEngine surface and the `TreasuryAgent` /
`ApprovalBot` presets.

---

## Cleanup

```bash
# Ctrl+C in terminals 1, 2, 3
rm walkthrough-keys.* walkthrough-signer-accounts.json walkthrough-state.json
rm -f ../../.multisig-session.json
```

---

## Troubleshooting

**Agent rejects every tx with `AllowedRecipientsRule`** — your
`walkthrough-state.json` is missing `operatorId`. Re-run step 3.

**Inject script can't find `.multisig-session.json`** — the server
writes it to its CWD. If you started the server from somewhere other
than the repo root, pass `--connect` and `--coordinator-token`
explicitly:

```bash
node 05-inject-scenario.js --scenario allowed \
  --connect "hmsc:..." \
  --coordinator-token "..."
```

**Alice's CLI sees the tx but the agent doesn't react** — make sure
the agent is in the `ready` state (look for "✓ ready — waiting for
transactions to evaluate" in terminal 2). If the agent crashed,
restart it; the coordinator session survives.
