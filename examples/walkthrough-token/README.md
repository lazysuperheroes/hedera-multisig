# Walkthrough: token-association + fungible transfer + NFT transfer

> **What you'll demonstrate:** three multi-sig ceremonies in one
> session — a 2-of-3 treasury associates itself with a token + NFT
> collection, then sends fungible tokens to a recipient, then sends
> an NFT to a recipient. Same coordinator + signing flow as
> [`walkthrough-dapp`](../walkthrough-dapp/), just exercising the
> non-HBAR transaction types.
>
> Roughly 30-40 minutes end-to-end. Costs ≈ 8 ℏ from your operator
> (signer accounts + threshold creation + token + NFT setup).

This is the smoke test for the dApp's `/create` page on
**token-transfer**, **nft-transfer**, and **token-association** —
the three transaction types we built into the form but had never run
end-to-end against testnet before. If anything's broken on those
paths, this walkthrough surfaces it.

What runs where (same shape as `walkthrough-dapp`):

| Component | Where | What it does |
|---|---|---|
| **Operator** (your `.env` account) | Off-session | Creates the test fungible + NFT, funds the threshold account post-association. NOT a signer in any of the multi-sig ceremonies. |
| **Coordinator** (`hedera-multisig server`) | Your machine, terminal 1 | WebSocket coordinator. One process; three sequential ceremonies. |
| **dApp UI** (`testnet-multisig.lazysuperheroes.com`) | Your browser | Both the coordinator's `/create` page (alice's tab) and alice's `/session/<id>` participant page (alice's other tab, OR the same tab after she finishes coordinating). |
| **HashPack** (alice) | Browser extension | Holds alice's signing key. |
| **CLI participant** (bob) | Your machine, terminal 3 | Signs each ceremony from the CLI. |

Carol sits out (2-of-3 — alice + bob is enough).

> **Want the full theory first?** See
> [`walkthrough-dapp/README.md`](../walkthrough-dapp/README.md) for
> the architecture, HTTPS-dApp ⇒ WSS-coordinator constraint, and
> mixed-mode rationale. This walkthrough assumes you've read that.

---

## Prerequisites

Same as [`walkthrough-dapp`](../walkthrough-dapp/README.md#prerequisites)
— operator credentials in `.env`, Node 20+, ngrok auth token,
HashPack extension. If you've already run `walkthrough-dapp` you can
skip steps 1-3 below by copying state across:

```bash
cd examples/walkthrough-token

# Reuse keys, signer accounts, and threshold account from dapp walkthrough
cp ../walkthrough-dapp/walkthrough-keys.* .
cp ../walkthrough-dapp/walkthrough-signer-accounts.json .
cp ../walkthrough-dapp/walkthrough-state.json .
```

---

## Steps 1-3 — same setup as walkthrough-dapp

```bash
cd examples/walkthrough-token

# 1. Generate three Ed25519 keys (alice, bob, carol)
node 01-generate-keys.js

# 2. Create on-chain Hedera accounts for each signer
#    (~1.65 ℏ — needed for HashPack to bind a session)
node 02-create-signer-accounts.js

# 3. Create the 2-of-3 threshold-key account that holds funds
#    (~1 ℏ; this is the multi-sig treasury)
node 03-create-threshold-account.js
```

These are byte-identical to `walkthrough-dapp`'s 01-03. See
[that README](../walkthrough-dapp/README.md#step-1-generate-three-signing-keys)
for the per-step explanation.

After step 3, `walkthrough-state.json` has `thresholdAccountId` —
that's your multi-sig treasury account.

---

## Step 4 — Operator creates a test fungible + NFT (single-sig)

```bash
node 04-create-test-token.js
```

Creates:

- **WALK** — a fungible token, 1000-unit supply, 0 decimals,
  operator is the treasury.
- **WALKNFT** — a 1-NFT collection, single mint with serial 1,
  operator is the treasury.

Both are paid for and signed by your `.env` operator. Persists
`fungibleTokenId`, `nftId`, and `nftSerialNumber` to
`walkthrough-state.json`.

> Why operator-as-treasury and not the threshold account? Because the
> *threshold account* is what we're going to demonstrate spending
> from — and to do that, it first has to **associate** with both
> tokens (Ceremony A) and **receive** them (step 5). If we made the
> threshold account the treasury directly, we'd skip the most
> interesting part of the walkthrough.

---

## Step 5 — Start the coordinator

In **terminal 1**:

```bash
npx hedera-multisig server \
  -t 2 \
  -k "$(node -p "require('./walkthrough-state.json').publicKeys.join(',')")" \
  --port 3001 \
  --tunnel-provider ngrok \
  --timeout 0 \
  --allowed-origins https://testnet-multisig.lazysuperheroes.com
```

`--timeout 0` keeps the session alive across all three ceremonies.
The server prints session ID, PIN, coordinator token, and the public
WSS URL — keep that terminal in view, you'll watch the rejection /
acceptance broadcasts there.

---

## Ceremony A — Multi-sig token-association

Goal: the threshold account associates itself with both the WALK
fungible token and the WALKNFT collection. Without this, step 6
(funding) will fail with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`.

### A.1. Coordinate (alice's browser, tab 1)

1. Open `https://testnet-multisig.lazysuperheroes.com/create`.
2. Connect HashPack (top-right). Use alice's key — see
   `walkthrough-keys.json` for the imported account.
3. Paste the **connection string** the coordinator printed in step 5.
4. Click **Build from form** and pick **Token association**.
5. Fill the form:
   - **Account**: paste your `thresholdAccountId` from
     `walkthrough-state.json`. **Important** — the form pre-fills
     with alice's wallet account, which is wrong; replace it with the
     threshold account ID.
   - **Token IDs**: paste both, comma-separated, copied from
     `walkthrough-state.json`:
     `<fungibleTokenId>, <nftId>`
   - **Fee payer** callout below the form should say "Account ...
     pays from the threshold account" — that's correct (the threshold
     account pays the association fee from its own balance).
6. The freeze section should auto-pick `subset` strategy with
   subsetSize=1 (the package default since 2.1.10 — see root README).
   Leave it.
7. Click **Build & inject transaction**.

The dApp transitions to the share/monitor view. Alice's tab still
shows the coordinator perspective.

### A.2. Sign as alice (HashPack, in alice's session tab)

Open `/session/<id>` in a new tab. The dApp will detect the existing
HashPack pairing and auto-advance into the review screen for the
TokenAssociate transaction. Verify the on-screen verified data:

- **Type**: TokenAssociateTransaction
- **Account**: your `thresholdAccountId`
- **Tokens**: the two token IDs from step 4

Click **Approve & Sign**. HashPack will prompt — approve.

### A.3. Sign as bob (CLI)

In **terminal 3**:

```bash
npx hedera-multisig participant \
  --connect "$(node -p 'process.env.MULTISIG_CONNECTION_STRING || "<paste-from-step-5>"')" \
  --key-file walkthrough-keys.bob.encrypted \
  --passphrase walkthrough-test \
  --label bob \
  --auto-approve
```

(`--auto-approve` because we're confident in the verified data;
real ceremonies should review.)

### A.4. Wait for execution

The coordinator terminal prints:

```
✅ Threshold met! Executing...
✅ Transaction executed: 0.0.X@…
```

The dApp's coordinator tab shows "Transaction Executed" with a
HashScan link.

---

## Step 6 — Operator funds the threshold account (single-sig)

```bash
node 05-fund-treasury.js
```

Operator transfers 100 WALK + NFT #1 to the threshold account.
Single-sig (operator owns both). If you skipped Ceremony A, this
fails with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` — go back and do A
first.

---

## Ceremony B — Multi-sig fungible token transfer

Goal: threshold account sends 25 WALK back to the operator.

### B.1. Reset for the new transaction

In the coordinator's `/create` tab, click **Inject new transaction**
(or whatever the post-execution button reads — should reset the
form). The session stays alive.

### B.2. Build the transfer

- **Build from form** → **Token transfer**
- **Token ID**: your `fungibleTokenId`
- **From**: paste `thresholdAccountId` (override the wallet pre-fill)
- **To**: paste your operator account ID
- **Amount (smallest unit)**: `25`
- Freeze: leave at `subset` / size 1
- Click **Build & inject transaction**

### B.3. Sign as alice + bob

Same pattern as Ceremony A.3 — alice approves in HashPack, bob
auto-signs from CLI.

### B.4. Verify

Coordinator prints success. Check on HashScan that the threshold
account's WALK balance dropped to 75, operator's went up by 25.

---

## Ceremony C — Multi-sig NFT transfer

Goal: threshold account sends NFT #1 back to the operator.

### C.1. Reset + build

In the coordinator's `/create` tab, **Inject new transaction**.

- **Build from form** → **NFT transfer**
- **Token ID**: your `nftId`
- **Serial Number**: `1` (from `walkthrough-state.json#nftSerialNumber`)
- **From**: `thresholdAccountId`
- **To**: your operator account ID
- Freeze: subset / size 1
- Click **Build & inject transaction**

### C.2. Sign + verify

Same as B. After execution, the operator owns NFT #1 again.

---

## Verification

After all three ceremonies, the operator account should hold:

- 925 WALK (1000 − 100 sent + 25 returned)
- NFT #1

The threshold account should hold:

- 75 WALK (100 received − 25 sent)
- 0 NFTs

You can verify via HashScan, the dApp's BalanceCard on `/create`
(reconnect with the threshold account ID to see), or the mirror node
directly:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/accounts/<thresholdAccountId>/tokens" | jq
```

---

## Cleanup

```bash
# Burn the test tokens (optional — they're testnet-only)
# Or just leave them; testnet wipes periodically.

# Remove the walkthrough state files (gitignored anyway)
rm walkthrough-keys.* walkthrough-signer-accounts.json walkthrough-state.json
```

---

## Troubleshooting

**`TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` from step 6** — Ceremony A
didn't complete successfully. Check the coordinator log: did
threshold-met fire? Did execution succeed? If not, run Ceremony A
again before step 6.

**HashPack shows the wrong account when connecting on `/create`** —
disconnect via the NavBar, reconnect, pick the correct paired
account. HashPack remembers the last-used account between sessions.

**"Coordinator's description (not verified)"** is yellow on the
participant review screen — that's fine for these txns; the metadata
fields the dApp can verify against the frozen tx (type, transfers,
accounts, nodeAccountIds) appear in the green VERIFIED section. The
yellow box only contains supplementary fields.

**Subset size auto-defaulted to 1, why?** That's the package default
for wallet compatibility. For these CLI+wallet ceremonies, leave it.
See the root [README's "Node freeze defaults"](../../README.md#-node-freeze-defaults--read-this-if-youre-integrating)
section for the wallet re-freeze rationale.

**Other walkthrough-dapp troubleshooting** applies — see
[that file](../walkthrough-dapp/README.md#troubleshooting).
