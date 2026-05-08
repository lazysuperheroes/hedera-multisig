# Walkthrough: smart contracts + multi-sig

> **Stop and read first:** if your treasury only moves HBAR or fungible
> tokens, [`../walkthrough-hbar/`](../walkthrough-hbar/) is the simpler
> path. This walkthrough is for teams that need to deploy and call smart
> contracts under multi-sig control — roughly 30 minutes end-to-end and
> fully self-contained (regenerate keys here, or copy them across from
> walkthrough-hbar if you've already got them).

This walkthrough teaches every common contract path:

1. **Deploy as a single-sig EOA**, interact normally — establishes the
   baseline so you understand what's changing.
2. **Convert that EOA to a 2-of-3 multi-sig** in one transaction
   (`AccountUpdate`).
3. **Prove single-sig is dead** — a negative test that fails with
   `INVALID_SIGNATURE`. This is the most pedagogically important step:
   it shows the conversion really took effect.
4. **Run multi-sig ceremonies** for `increment()` and `withdraw()` —
   the same operations that worked single-sig now require 2 of 3
   signers to coordinate.

There's also an **alternate path** ([`ALT-deploy-as-multisig.md`](./ALT-deploy-as-multisig.md))
where the contract is deployed directly via multi-sig from day one
— useful for production treasury contracts that should never have a
single-key window.

## Prerequisites

This walkthrough is fully self-contained. Set your operator credentials
in the project root `.env` (`OPERATOR_ID`, `OPERATOR_KEY`,
`HEDERA_NETWORK`) — see `START_HERE.md` if you don't have a testnet
account yet — then generate the three signing keys and run the precheck:

```bash
cd examples/walkthrough-contract
node setup-keys.js   # generates alice / bob / carol keys (encrypted + plaintext index)
node 00-precheck.js  # verifies env, keys, operator balance, Counter.json
```

> **Already ran `walkthrough-hbar`?** You can copy the keys across
> instead of regenerating:
> ```bash
> cp ../walkthrough-hbar/walkthrough-keys.* .
> ```
> Either path works; both produce the same `walkthrough-keys.json` shape.

## The Counter contract

[`Counter.sol`](./Counter.sol) is the smallest possible contract that
exercises both function calls and value transfer:

- `increment()` — anyone can call; bumps a counter.
- `getCount() view` — read-only.
- `withdraw()` — admin-only (the deployer); sweeps the contract's HBAR
  balance to the admin's EVM address. Demonstrates access control.
- `receive() payable` — accepts HBAR, so the contract can hold a
  balance worth withdrawing later.

[`Counter.json`](./Counter.json) is the compiled artifact (`solc 0.8.24`,
850 bytes of bytecode). If you change `Counter.sol`, recompile with
`forge build` (or any solc 0.8.x toolchain) and update `Counter.json`.

---

## Step 1 — Create a demo EOA

```bash
node 01-create-demo-eoa.js
```

Creates a fresh Hedera account whose key is `alice`'s single Ed25519
key. The operator funds it with 20 ℏ — sized so the demo account can
cover the contract deploy in step 2 (800k gas can run 5–10 ℏ on
busy-pricing testnet days), the 2 ℏ funding to the contract in step 3,
and per-tx fees on the multi-sig ceremonies in steps 7 and 8 with
margin left over. This is the EOA stage — the demo account is
controlled by one key, exactly like a personal wallet.

State written: `demo-account-state.json` with `demoAccountId`.

## Step 2 — Deploy Counter as the demo EOA

```bash
node 02-deploy-as-eoa.js
```

Uses Hedera's `ContractCreateFlow()` (the canonical SDK call that wraps
`FileCreate` + chunked `FileAppend` + `ContractCreate` automatically —
see the [Hedera docs](https://docs.hedera.com/hedera/sdks-and-apis/sdks/smart-contracts/create-a-smart-contract#contractcreateflow)).
The deploying account is the demo EOA, so `msg.sender` in the
constructor — and therefore `Counter.admin` — is the demo account's
EVM address.

Output:
```
✅ Counter deployed: 0.0.7654321
   Solidity admin = demo account's EVM address
```

## Step 3 — Fund the contract

```bash
node 03-fund-contract.js
```

Sends 2 ℏ from the demo account to the contract via
`TransferTransaction`. The contract has a `receive()` function so it
accepts incoming HBAR. We need a balance for the later `withdraw()`
ceremony to actually move something.

## Step 4 — Call increment() as the EOA (single-sig)

```bash
node 04-call-increment-as-eoa.js
```

Plain `ContractExecuteTransaction` signed by alice's key. Counter ticks
from 0 → 1. This is the "before" baseline — write down the transaction
ID so you can compare against step 7's multi-sig ceremony.

### Step 4a — Verify the count (free read via mirror node)

```bash
node query-counter.js
# → Counter: 1
```

`query-counter.js` reads `Counter.getCount()` for free via the mirror
node's `POST /api/v1/contracts/call` endpoint (HIP-584) — no operator
HBAR is spent on the read. The same script is used again in step 7 to
verify the multi-sig increment landed.

> **Mirror lag.** The mirror node trails consensus by ~3–8 seconds.
> Run the script ≥5s after a state-changing tx and you're fine. If
> you script it immediately after a tx, add `--wait` (polls with
> backoff for ~30s) and optionally `--expect <n>` (keep polling until
> `count >= n`).

---

## Step 5 — Convert the demo EOA to 2-of-3 multi-sig

```bash
node 05-convert-eoa-to-multisig.js
```

This is the headline step. It builds a single `AccountUpdateTransaction`
that:

- Replaces the demo account's key from `alice (single)` to a `KeyList`
  of `[alice, bob, carol]` with threshold 2.
- Is signed by **both** the old key (alice) **and** the new key (the
  threshold key, satisfied by alice + bob).

Hedera enforces this **dual-signature rule** for key rotations — old
key proves you currently control the account; new key prevents griefing
where someone sets your key to a key you don't hold. The script
attaches all three signatures locally because we hold every key (this
is a walkthrough); in production you'd coordinate the new-key
signatures across signers.

After this step, the demo account ID is unchanged. Its EVM address is
unchanged. The Solidity-level `Counter.admin` is unchanged. **What
changes is the authorization required to act AS this account.** That's
the multi-sig migration.

## Step 6 — Prove single-sig is dead (negative test)

```bash
node 06-prove-eoa-rejected.js
```

Tries to call `increment()` exactly the same way step 4 did — single-sig
with alice's key — and **expects** `INVALID_SIGNATURE`. Exit code:

- `0` — single-sig was rejected (✓ conversion worked)
- `1` — single-sig succeeded (BUG — file an issue)
- `2` — script error before the test could run

This is the most pedagogically important step. Run it. Confirm the
exit code is 0. Now you've proven the conversion took effect, and the
remaining steps (multi-sig ceremonies) are the only way forward.

---

## Step 7 — Multi-sig increment() ceremony

This step has three moving pieces — coordinator, two participants, and
verification — so it lives in three terminals.

### 7a. Build the frozen transaction

```bash
node 07-prepare-multisig-increment.js
```

Outputs a base64-encoded frozen `ContractExecuteTransaction` calling
`increment()`. **120-second validity window** — get participants
connected before running this.

The script also writes `multisig-increment-tx.json` with the bytes,
ABI, expected function name, and the transaction ID for later
verification.

### 7b. Start the coordinator (terminal 2)

```bash
npx hedera-multisig server \
  -t 2 \
  -k "$(node -p "require('./demo-account-state.json').thresholdConfig.publicKeys.join(',')")" \
  --port 3001 \
  --no-tunnel \
  --timeout 0 \
  --allowed-origins http://localhost:3000
```

`--allowed-origins http://localhost:3000` is required for the dApp's
browser tab to connect — the server denies browser origins by default.
CLI participants are unaffected (no `Origin` header).

`--timeout 0` keeps the session alive until you Ctrl+C the server.
Contract walkthroughs typically span a couple of injects (`increment`
then `withdraw`) and you don't want the session expiring between them.
Without the flag, the default 30-minute cap fires silently and the
next inject lands on a dead session.

Note the printed **session ID**, **PIN**, **coordinator token**, and
**connection string**.

### 7c. Inject the transaction

Open `http://localhost:3000/create` (start the dApp with
`cd ../../dapp && npm run dev` in another terminal if it isn't
running). Connect using the credentials from 7b.

For "Inject Transaction" choose **paste base64** and paste the bytes
from step 7a. Optionally paste `Counter.json`'s ABI in the ABI field —
this enables verified function-name display for participants
(green "ABI Verified ✓" badge in TransactionReview).

### 7d. Two participants sign

Two of [alice, bob, carol] join the session. Either via the dApp's
`/join` page (with their own browser, wallet-connecting to a wallet
holding their key) or via the CLI:

```bash
# Alice (terminal 3) — encrypted-file flow (recommended):
npx hedera-multisig participant \
  --connect "$(... connection string from 7b ...)" \
  --label alice \
  --keyfile ./walkthrough-keys.alice.encrypted \
  --passphrase walkthrough-test
```

```bash
# Bob (terminal 4):
npx hedera-multisig participant \
  --connect "..." --label bob \
  --keyfile ./walkthrough-keys.bob.encrypted \
  --passphrase walkthrough-test
```

> **Plaintext alternative.** If you'd rather use inline keys, swap
> `--keyfile … --passphrase walkthrough-test` for
> `-k "$(node -e "console.log(require('./walkthrough-keys.json').keys.alice.privateKey)")"`.
> `-k` is marked DEPRECATED for production (visible in process lists and
> shell history) but is a valid path for testnet experimentation. The
> encrypted flow is the production-recommended pattern — see
> [`docs/ENCRYPTED_KEYS_GUIDE.md`](../../docs/ENCRYPTED_KEYS_GUIDE.md).

When the second signer approves, the coordinator submits the signed
transaction to the network and prints the executed transaction ID.

### 7e. Verify

```bash
node verify-on-mirror.js TRANSACTION_ID_FROM_7d

# Confirm the counter advanced to 2 (1 from step 4 + 1 from this ceremony):
node query-counter.js --expect 2 --wait
# → attempt 1/12: count = 1 ⏳
# → attempt 2/12: count = 2 ✅
# → Counter: 2
```

`verify-on-mirror.js` confirms the transaction itself externalized
(`SUCCESS`, consensus timestamp, fee, transfers). `query-counter.js`
re-reads the contract state via the mirror node's free
`POST /api/v1/contracts/call` endpoint — no HBAR spent on the read.
`--expect 2 --wait` polls through the ~3–8s mirror lag until the new
state propagates.

---

## Step 8 — Multi-sig withdraw() ceremony

Same shape as step 7. The contract has 2 ℏ from step 3 — `withdraw()`
sweeps it back to the demo account.

```bash
node 08-prepare-multisig-withdraw.js
```

Inject the printed base64 into the dApp `/create` (same coordinator
session works), have two of [alice, bob, carol] sign.

Verify:

```bash
node verify-on-mirror.js TRANSACTION_ID
```

Mirror confirms — the `transfers` array shows the contract debited 2 ℏ,
the demo account credited (modulo fees).

If you tried `withdraw()` from any account that **isn't** the demo
account (the original deployer), it would revert with `not admin` —
that's the Solidity `require(msg.sender == admin)` doing its job. The
multi-sig step doesn't add a new admin; it adds a new authorization
mechanism for the existing admin.

---

## Architecture recap (what you just demonstrated)

| Layer | Before conversion | After conversion |
|---|---|---|
| Hedera account ID | `0.0.X` (demo) | `0.0.X` (unchanged) |
| Account's controlling key | `alice` (single Ed25519) | KeyList(alice, bob, carol) threshold=2 |
| Account's EVM address | derived from `0.0.X` (unchanged) | derived from `0.0.X` (unchanged) |
| `Counter.admin` (Solidity) | demo account's EVM address | demo account's EVM address (unchanged) |
| `withdraw()` requirement (Solidity) | `msg.sender == admin` | `msg.sender == admin` (unchanged) |
| Authorization required (Hedera consensus) | 1 signature from alice | 2 of 3 signatures from {alice, bob, carol} |

The contract is unchanged. The account's identity is unchanged. The
authorization required to act as that account changed. This is what
"multi-sig migration" means in practice — and why it's safe to do on
existing production accounts without touching deployed code.

## When NOT to convert an existing EOA

- The EOA has been compromised — convert before, not after, you suspect
  a breach. If keys are already exposed, rotate them in a single step
  via a different account first.
- The EOA controls dependencies (KMS keys, AWS roles, off-chain
  infrastructure). Conversion changes the SIGNING requirement; if your
  off-chain code expects to sign with a single key, it'll break.
- You can't get all three new-key signers online at the same time —
  the dual-signature rule on `AccountUpdate` requires the new key to
  sign. (Workaround: schedule the AccountUpdate via HIP-423 to allow
  async signing, but this is meta — you're using one multi-sig
  mechanism to enable another.)

In any of these cases, deploy-as-multi-sig from a fresh account is
safer. See [`ALT-deploy-as-multisig.md`](./ALT-deploy-as-multisig.md).

---

## Cleanup

```bash
# 1. (Optional) Sweep remaining HBAR from the demo account back to operator
#    via another multi-sig ceremony — same shape as step 7 but with a
#    TransferTransaction instead of ContractExecuteTransaction.
# 2. Delete the demo account (also a multi-sig ceremony — AccountDeleteTransaction).
# 3. Delete contract artifacts:
rm demo-account-state.json multisig-increment-tx.json multisig-withdraw-tx.json
```

The Counter contract on testnet is harmless to leave running — it has
no off-chain dependencies and accepts no further deposits unless you
send HBAR to it.

## Troubleshooting

**`02-deploy-as-eoa.js` fails with `INSUFFICIENT_GAS`** — bump `DEPLOY_GAS`
in the script. 800,000 is comfortable for Counter; larger contracts
need more.

**`05-convert-eoa-to-multisig.js` fails with `INVALID_SIGNATURE`** —
the dual-signature rule wasn't satisfied. Verify alice's key is in the
new KeyList (otherwise the new key can't be satisfied without involving
the old key separately).

**`06-prove-eoa-rejected.js` exits 0 but you expected something to happen** — that exit code IS the success path. The negative test passes when single-sig is rejected.

**Multi-sig ceremony in step 7/8 times out** — the frozen transaction
has a 120-second window. Get participants connected and ready BEFORE
running the prepare script. For longer windows, see
[`ALT-deploy-as-multisig.md`](./ALT-deploy-as-multisig.md) — option 2
covers scheduled transactions for ContractCreate, and the same pattern
works for ContractExecute.

**Counter's count value is unexpected** — `Counter.sol` uses
`unchecked` arithmetic (because it's a counter that physically can't
overflow in any reasonable timeframe). If you've called `increment()`
many times across walkthroughs, the count accumulates.
