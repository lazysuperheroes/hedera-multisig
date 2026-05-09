# Walkthrough: 2-of-3 multi-sig with ECDSA (secp256k1) keys

> **What this validates:** that the entire stack — coordinator,
> dApp, CLI participant, mirror — handles **secp256k1 ECDSA** keys
> exactly the same as Ed25519 in a real ceremony. The mixed-type
> path is unit-tested already; this is the end-to-end check that
> nothing in the WalletConnect → freeze → sign → verify → execute
> pipeline silently degrades when every signer is on the
> EVM-friendly curve.

This walkthrough is **structurally identical to
[`../walkthrough-dapp/`](../walkthrough-dapp/)** — same hosted dApp,
same hybrid HashPack + CLI signing pattern, same
threshold-account / KeyList shape. The **only** difference is that
step 1 generates `ECDSA_SECP256K1` keys instead of Ed25519. We
include the four scripts here so the walkthrough is self-contained
and runnable from a fresh checkout, but if you've already worked
through `walkthrough-dapp` the procedure will feel familiar.

> **About MetaMask / Rabby.** ECDSA keys are what those wallets
> use, but they cannot sign Hedera SDK transactions today — they
> speak the EIP-155 (Ethereum) WalletConnect namespace, and the
> dApp speaks the Hedera namespace. That's a wallet-side
> compatibility limit, not a key-type limit. **HashPack imports
> ECDSA keys natively**, and that's what this walkthrough uses.

---

## Why ECDSA?

Three reasons it matters that this just works:

1. **Hedera is genuinely curve-agnostic.** The protocol accepts
   both Ed25519 and secp256k1 in `KeyList` thresholds, mixed or
   homogeneous. If our coordinator only worked for Ed25519 in
   practice, that would be a regression worth catching.
2. **EVM-native teams already have ECDSA keys.** A team coming
   from Ethereum tooling already has secp256k1 private keys in
   hardware wallets, MPC services, and HSMs. They shouldn't need
   to generate fresh Ed25519 keys to use Hedera multi-sig.
3. **Cross-pollination with EVM contract calls.** When you call
   into Hedera's EVM precompiles via `ContractCall`, a signing
   account with an ECDSA key has the same `evmAddress` it would
   have on Ethereum. Useful for accounts that bridge between
   Hedera-native and EVM-native operations.

---

## Prerequisites

Same as
[`walkthrough-dapp`](../walkthrough-dapp/README.md#prerequisites) —
`OPERATOR_ID` / `OPERATOR_KEY` / `HEDERA_NETWORK=testnet` in the
project root `.env`, Node 20+, an `NGROK_AUTH_TOKEN`, and HashPack
configured for testnet.

If you've already run the dApp walkthrough end-to-end, all of those
are already in place. The keys here are **independent** of any
other walkthrough — don't copy across; they're a different curve.

---

## Step 1: Generate three secp256k1 keys

```bash
cd examples/walkthrough-ecdsa
node 01-generate-keys.js
```

```
✓ alice    302d300706052b8104000a032200… (EVM: 0x08954…fe98236)
✓ bob      302d300706052b8104000a032200… (EVM: 0x4a13b…81c2c44)
✓ carol    302d300706052b8104000a032200… (EVM: 0xc7e25…0473e89)

✅ ECDSA keys written
   All three keys validated as secp256k1 (ECDSA).
```

The `302d300706052b8104000a032200…` prefix is the DER-encoded
SubjectPublicKeyInfo for secp256k1 — distinct from Ed25519's
`302a300506032b6570…`. The script aborts if the SDK ever returned a
mismatched curve, so this output is itself proof the keygen step
got what it asked for.

---

## Steps 2–7: Same as walkthrough-dapp

The remaining steps are mechanically identical to the dApp
walkthrough. Run them from this directory so the local state files
(`walkthrough-keys.json`, `walkthrough-signer-accounts.json`,
`walkthrough-state.json`) get written here, but the **procedure**
is the one documented at
[`../walkthrough-dapp/README.md`](../walkthrough-dapp/README.md):

```bash
node 02-create-signer-accounts.js   # ~1.65 ℏ from operator (ECDSA accounts work the same)
node 03-create-threshold-account.js # 5 ℏ initial balance, 2-of-3 ECDSA KeyList
```

Then start the coordinator and run a ceremony following
[walkthrough-dapp's steps 4–6](../walkthrough-dapp/README.md#step-4-start-the-coordinator-with-a-public-tunnel)
verbatim — copy the `npx hedera-multisig server …` command,
paste the HMSC string into the dApp, build a small HBAR transfer
from the threshold account, and have alice sign in HashPack while
bob signs from a CLI participant.

When alice imports her key into HashPack:

- **HashPack auto-detects** that the key is secp256k1 (the import
  flow inspects the DER prefix). No different setting toggle.
- **Mirror lookup uses the same flow** as Ed25519 — HashPack queries
  the mirror node for an account whose key matches alice's pubkey,
  finds the one created in step 2, and binds the WalletConnect
  session to that account ID.
- **HashPack will show alice's EVM address** in the account
  details panel (`0x08954…`) — this is just the keccak-derived
  address from her secp256k1 pubkey, not a separate identity.

Bob's CLI participant flow is identical to walkthrough-dapp:

```bash
npx hedera-multisig participant \
  --connect "$(... HMSC string from terminal 1 ...)" \
  --label bob \
  --keyfile ./walkthrough-keys.bob.encrypted \
  --passphrase walkthrough-test
```

`EncryptedFileProvider` parses both Ed25519 and ECDSA private keys
from their DER form transparently — no flag needed.

---

## Step 7: Verify on the mirror node

```bash
node 06-verify-on-mirror.js TRANSACTION_ID_FROM_STEP_5
```

Same output as the dApp walkthrough, with one extra confirmation
line: the script prints "ECDSA validation complete" when the mirror
confirms execution against a 2-of-3 secp256k1 KeyList.

---

## What this proves

If steps 1–7 all pass:

- **Coordinator** (`SignatureCollector` / `SignatureVerifier` in
  `core/`) handles secp256k1 signatures in a `KeyList` correctly —
  pubkey-keyed lookup, eligibility check, threshold counting, all
  curve-agnostic.
- **WebSocket protocol** (`shared/protocol.js`) carries ECDSA
  signatures alongside their pubkeys without trouble — `signatures:
  string[]` is just bytes; the protocol doesn't care which curve
  produced them.
- **dApp signing path** (HashPack via WalletConnect) emits valid
  secp256k1 signatures against the multi-node `bodyBytes` — the
  consensus layer accepts them against the threshold KeyList.
- **CLI signing path** (encrypted key file → `KeyProvider.sign()`)
  produces valid secp256k1 signatures the same way it does Ed25519.
- **Hedera consensus** (`receipt.status === SUCCESS` + mirror
  externalisation) treats a homogeneous-ECDSA threshold ceremony
  the same as a homogeneous-Ed25519 one.

If any step fails, the failure point tells you exactly where the
key-type-agnostic claim breaks down.

---

## Cleanup

Same as walkthrough-dapp:

```bash
rm walkthrough-keys.* walkthrough-state.json walkthrough-signer-accounts.json
# Stop the coordinator (Ctrl+C in terminal 1).
# (Optional) Remove the imported alice key from HashPack via Settings.
```

The threshold account and signer accounts continue to exist on
testnet; testnet HBAR is free, so this is fine to leave. Sweep them
deliberately if you'd rather — same procedure as walkthrough-dapp's
cleanup section.
