# Walkthrough: HBAR multi-sig in 30 minutes

This walkthrough takes you from a fresh testnet account to a successfully
signed HBAR transfer through a 2-of-3 multi-sig ceremony. **This is the
recommended starting point for everyone** — treasury teams that only need
to move HBAR or fungible tokens can stop here. If you also need smart
contract calls, continue with `../walkthrough-contract/`.

You will learn:

- How to generate three signing keys
- How to convert a regular Hedera account into a 2-of-3 threshold-key account
- How to start a coordinator server
- How participants join, review, and sign a transaction
- How to confirm execution on the mirror node

Total time: **~30 minutes** including the first time you read each step.

---

## Prerequisites

You need a **funded testnet account** to use as the operator. The operator
pays network fees and creates the threshold-key account that the rest of
the walkthrough uses.

1. **Get a Hedera testnet account.**
   - Go to [portal.hedera.com](https://portal.hedera.com/) and register.
   - The portal funds new testnet accounts with ~10,000 ℏ — plenty for
     this walkthrough.
   - Save your **Account ID** (looks like `0.0.4515913`) and your
     **DER-encoded private key**.

2. **Install the library** (if you haven't already, from the repo root):

   ```bash
   npm install
   npm link  # so `hedera-multisig` is available globally; or use `npx hedera-multisig` everywhere
   ```

3. **Configure environment** (in the repo root):

   ```bash
   cp .env.example .env
   # Edit .env and set:
   #   OPERATOR_ID=0.0.YOUR_ACCOUNT_ID
   #   OPERATOR_KEY=YOUR_DER_PRIVATE_KEY
   #   HEDERA_NETWORK=testnet
   ```

4. **Move into the walkthrough directory:**

   ```bash
   cd examples/walkthrough-hbar
   ```

5. **Run the prerequisite check:**

   ```bash
   node 00-precheck.js
   ```

   This verifies your `.env` is wired up, your operator account is
   reachable, and your balance is sufficient (>2 ℏ).

---

## Step 1: Generate three signing keys

```bash
node 01-generate-keys.js
```

This creates `walkthrough-keys.json` with three Ed25519 keys named
`alice`, `bob`, and `carol`. **For testnet only.** In production, each
key would be generated on a separate device by a separate person.

The script prints each public key — you'll see them again in the next step.

---

## Step 2: Create a 2-of-3 threshold-key account

```bash
node 02-create-threshold-account.js
```

This:

1. Reads the three public keys from step 1.
2. Builds a `KeyList` with `threshold = 2`, requiring any 2 of the 3
   keys to sign for any transaction.
3. Calls `AccountCreateTransaction` to create a new Hedera account
   controlled by that threshold key.
4. Funds the new account with 5 ℏ from the operator (so we can later
   send some HBAR back).
5. Saves the new account ID and the threshold key configuration to
   `walkthrough-state.json`.

You'll see something like:

```
✅ Threshold account created: 0.0.6543210
   Threshold: 2 of 3
   Eligible keys: alice, bob, carol
   Initial balance: 5 ℏ
   View on HashScan: https://hashscan.io/testnet/account/0.0.6543210
```

---

## Step 3: Start the coordinator server

In **terminal 1**, start the multi-sig coordinator:

```bash
# From the walkthrough-hbar directory, run:
npx hedera-multisig server \
  -t 2 \
  -k "$(node -e "console.log(require('./walkthrough-state.json').publicKeys.join(','))")" \
  --port 3001 \
  --no-tunnel
```

The server prints:
- Session ID
- PIN (for participants)
- Coordinator Token (keep private — used by `/create` page)
- Connection string
- QR code

Leave this terminal running.

> **Remote signers?** Drop `--no-tunnel` to get an ngrok / localtunnel URL.
> Read `docs/COORDINATOR_GUIDE.md` for the trust model before doing this
> in production.

---

## Step 4: Build and inject the transaction (coordinator side)

Open `http://localhost:3000` (the dApp — start it in **terminal 2** with
`cd dapp && npm run dev` if it isn't running) and navigate to
**Create Session**.

Connect using the credentials printed by the server in step 3:

- Server URL: `ws://localhost:3001`
- Session ID, PIN, Coordinator Token: from terminal 1

Once connected, build a transaction:

- **Type:** HBAR transfer
- **From:** the threshold account ID (from `walkthrough-state.json`)
- **To:** your operator account ID
- **Amount:** 1 ℏ (the script funded the threshold account with 5; we
  send some back to demonstrate the full round-trip)
- **Memo:** `walkthrough-hbar`

Click **Inject Transaction**. The participants who join in step 5 will
have 120 seconds from this moment to sign.

> **CLI alternative:** if you prefer not to use the browser, the server
> CLI emits enough metadata to construct and inject the transaction
> programmatically. See `docs/COORDINATOR_GUIDE.md` "Building transactions
> from a script" for the pattern.

---

## Step 5: Participants join and sign

You now play **Alice** and **Bob** to provide 2 of 3 signatures.

In **terminal 3**, join as Alice using the CLI participant:

```bash
npx hedera-multisig participant \
  --connect "$(... server printed connection string ...)" \
  --label alice \
  --key-file ./walkthrough-keys.alice.json
```

(The `01-generate-keys.js` script writes individual encrypted-file copies
of each key — `walkthrough-keys.alice.json`, `walkthrough-keys.bob.json`,
`walkthrough-keys.carol.json` — so the CLI participant can load just one.)

You'll be prompted to review the transaction. Confirm and sign.

In **terminal 4**, join as Bob the same way:

```bash
npx hedera-multisig participant \
  --connect "..." --label bob --key-file ./walkthrough-keys.bob.json
```

After Bob signs, the threshold (2) is met; the server submits the signed
transaction to the Hedera network and prints the transaction ID.

Carol does not need to sign — that's the point of 2-of-3.

---

## Step 6: Verify on the mirror node

```bash
node 06-verify-on-mirror.js TRANSACTION_ID_FROM_STEP_5
```

This polls the mirror node (with retries for the ~3-5s lag) and prints:

- `mirrorConfirmed: true` — the network externalized the transaction
- The `consensusTimestamp` and `chargedFee`
- The actual HBAR transfers (which should match what you signed: -1 ℏ
  from the threshold account, +1 ℏ to operator, minus the fee)

You can also open HashScan directly:
`https://hashscan.io/testnet/transaction/TRANSACTION_ID`

---

## What just happened

You created a Hedera account whose authority is held jointly by three
keys, with a quorum of two. You then proposed a transaction, two of the
three key holders independently approved it without sharing private
keys, and the network executed it. This is the same pattern that
production treasury setups use — only on mainnet with audited keys.

If you are building a treasury tool that **only moves HBAR or fungible
tokens**, you are done. The same flow handles tokens via
`Type: Token transfer` in step 4 and works identically for `2-of-3`,
`3-of-5`, or any other M-of-N you configure in step 2.

If you also need to **call smart contracts** (deploy, increment, withdraw,
arbitrary functions), continue with [`../walkthrough-contract/`](../walkthrough-contract/).

---

## Cleanup

The walkthrough leaves these artifacts:

- `walkthrough-keys.json` and `walkthrough-keys.{alice,bob,carol}.json` — testnet keys; can be deleted
- `walkthrough-state.json` — records the threshold account ID; useful if you re-run later

To delete the threshold account and reclaim its balance:

```bash
# Optional — sweep the remaining balance back to operator first via another multi-sig ceremony,
# then call AccountDeleteTransaction with the threshold key's signatures.
```

---

## Troubleshooting

**`00-precheck.js` says my balance is 0** — visit [portal.hedera.com](https://portal.hedera.com/), select your account, and click "Refill Account."

**`02-create-threshold-account.js` fails with `INVALID_SIGNATURE`** — the operator key in `.env` doesn't match the operator account ID. Re-copy from the portal.

**Participants can't connect** — check the server's URL matches what you pasted (`ws://localhost:3001` for `--no-tunnel`). With a tunnel, the URL changes each session — copy from the server's output.

**Signature didn't make it in 120 seconds** — Hedera's hard limit. Use scheduled transactions (`docs/COORDINATOR_GUIDE.md` § Scheduled Transactions) for async signing up to ~62 days.
