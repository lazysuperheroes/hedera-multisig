# Alternate path: deploy Counter directly as multi-sig

The main walkthrough teaches **EOA → multi-sig conversion**: deploy with a
single key, get comfortable, then upgrade authorization. That's the
realistic adoption path for most teams who already have an EOA in
production.

This document covers the **deploy-as-multi-sig** path: the contract is
created from a multi-sig account on day one, with no single-key stage
and no migration. Use this when:

- You're building a treasury contract that should be multi-sig from
  inception (no one should ever have unilateral control).
- You want the Solidity-level `admin = msg.sender` to be the threshold
  account's EVM address — so subsequent admin-only functions
  (`withdraw()`, `setRate()`, etc.) are gated by multi-sig from day one.
- Your security review precludes a single-key deployment, even briefly.

## Prerequisites

You need the threshold account from the HBAR walkthrough. If you ran
`examples/walkthrough-hbar/02-create-threshold-account.js`, your
`walkthrough-hbar/walkthrough-state.json` already records the
`thresholdAccountId` (e.g. `0.0.6543210`).

Top up the threshold account so it has enough HBAR to cover deploy gas
+ fees (~3 ℏ is comfortable). You can do this from the HBAR walkthrough
itself — coordinate a multi-sig transfer FROM the threshold account, OR
just send HBAR TO it from the operator (incoming transfers don't need
the threshold's consent).

Quick top-up from operator:

```bash
# In the repo root, with .env loaded:
node -e "
const { Client, AccountId, PrivateKey, TransferTransaction, Hbar } = require('@hashgraph/sdk');
require('dotenv').config();
(async () => {
  const c = Client.forTestnet();
  c.setOperator(AccountId.fromString(process.env.OPERATOR_ID), PrivateKey.fromString(process.env.OPERATOR_KEY));
  const state = require('./examples/walkthrough-hbar/walkthrough-state.json');
  const tx = await new TransferTransaction()
    .addHbarTransfer(process.env.OPERATOR_ID, new Hbar(-3))
    .addHbarTransfer(state.thresholdAccountId, new Hbar(3))
    .execute(c);
  await tx.getReceipt(c);
  console.log('Funded', state.thresholdAccountId, 'with 3 ℏ. Tx:', tx.transactionId.toString());
})();
"
```

## Why this path is harder than EOA-then-convert

Direct multi-sig deployment requires a multi-sig ceremony for the
**deploy transaction itself**. There are two practical ways to do this:

### Option 1: ContractCreateFlow + manual signature collection (offline)

`ContractCreateFlow()` wraps `FileCreate` + chunked `FileAppend` +
`ContractCreate` into one logical operation, but it auto-executes each
sub-transaction with the operator's signature. It's not designed for
multi-sig.

For multi-sig deployment, **don't use `ContractCreateFlow`**. Use the
explicit three-step:

1. `FileCreateTransaction` to create the bytecode file.
   - Set the file's keys to the operator (so the operator can append +
     delete) — the file is ephemeral; multi-sig of the file isn't
     useful.
   - Sign + execute as the operator.
2. `FileAppendTransaction` for any chunks beyond 4 KiB.
   - Same — operator signs.
3. `ContractCreateTransaction` referencing the bytecode file ID.
   - **This** is what needs multi-sig. Set `setBytecodeFileId(fileId)`,
     `setGas(...)`, any constructor parameters, and freeze it with the
     threshold account as the **payer / transactionId account**.
   - Inject the frozen bytes into the multi-sig coordinator session.
   - Threshold-many participants sign.
   - Coordinator executes.

The `examples/smart-contract-multisig.js` example in this repo
demonstrates the explicit three-step flow.

### Option 2: ScheduleCreate wrapping ContractCreate (HIP-423)

If your signers can't be online together within 120 seconds:

1. Build the `ContractCreateTransaction` (NOT frozen).
2. Wrap it in `ScheduleCreateTransaction` and submit. The schedule
   accepts signatures for up to ~62 days.
3. Each signer runs `npx hedera-multisig schedule sign --schedule-id …`
   on their own time. The network executes the contract-create when
   threshold is met.

```bash
# After building the inner ContractCreateTransaction in your script
# and freezing it to base64:
npx hedera-multisig schedule create \
  -b "BASE64_INNER_CONTRACT_CREATE" \
  --memo "deploy Counter (multi-sig)" \
  --expiration-time 7d
```

Each signer:

```bash
npx hedera-multisig schedule sign \
  --schedule-id 0.0.SCHEDULE \
  --keyfile ../walkthrough-hbar/walkthrough-keys.alice.encrypted \
  --passphrase walkthrough-test
```

When 2 of 3 have signed, the network creates the contract. Get the
contract ID from the schedule status:

```bash
npx hedera-multisig schedule status --schedule-id 0.0.SCHEDULE
```

## When to choose which path

| You're… | Use… |
|---|---|
| Building a tutorial / proof-of-concept | EOA-then-convert (the main walkthrough) — fewer moving parts, easier to debug |
| Deploying a treasury contract for production | Deploy-as-multi-sig — no single-key window, ever |
| Working with signers across time zones | Deploy-as-multi-sig with **scheduled transactions** (option 2) — relaxes the 120s constraint to 62 days |
| Iterating on contract code | EOA-then-convert during dev; redeploy directly as multi-sig before mainnet |

## After deployment: same as the main walkthrough

Once the contract is deployed (whichever path), `increment()` and
`withdraw()` ceremonies work identically. The frozen-TX prep scripts
`07-prepare-multisig-increment.js` and `08-prepare-multisig-withdraw.js`
read the contract ID from `demo-account-state.json` — point them at
your deploy-as-multi-sig contract by editing the state file:

```json
{
  "demoAccountId": "0.0.THRESHOLD_FROM_HBAR_WALKTHROUGH",
  "contractId": "0.0.YOUR_DEPLOYED_CONTRACT",
  "convertedToMultisigAt": "skipped — deployed as multi-sig directly",
  "thresholdConfig": {
    "threshold": 2,
    "publicKeys": ["0xkey1...", "0xkey2...", "0xkey3..."]
  }
}
```

Then run `node 07-prepare-multisig-increment.js` and `node 08-prepare-multisig-withdraw.js` as documented in the main README.
