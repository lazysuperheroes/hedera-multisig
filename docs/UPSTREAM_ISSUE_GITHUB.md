# GitHub Issue Body — Filed

**Filed at:** [hashgraph/hedera-wallet-connect#694](https://github.com/hashgraph/hedera-wallet-connect/issues/694)

**Title:** `DAppSigner.signTransaction rebuilds TransactionBody, breaking multi-sig signature aggregation for ContractExecute`

(This document preserves the issue body as posted. The longer
write-up that informed it is at `UPSTREAM_ISSUE_WALLET_CONNECT.md`.)

---

**Describe the bug**

`DAppSigner.signTransaction` rebuilds a fresh `TransactionBody` via `transactionToTransactionBody(transaction, nodeAccountId)` and sends *that* to the wallet for signing, then reattaches the wallet's signature to the **original** preserved `signedTx.bodyBytes`. For HBAR / token transfers the rebuild serializes byte-identically to the original (verify passes); for **`ContractExecuteTransaction` it diverges** (likely default-value handling for `transactionFee` or proto field-ordering in `contractCall`). The wallet's signature is mathematically valid against the rebuilt body — but the returned SignedTransaction has the original (non-rebuilt) bodyBytes, so `verify(bodyBytes, signature)` returns false and the signature can't be aggregated into a multi-sig transaction.

The bug is wallet-independent — confirmed by testing HashPack and Kabila side-by-side, identical failure profiles. Most consumers don't hit it because `executeWithSigner` is the dominant pattern (sign + submit in one shot; the wallet's rebuild goes straight to consensus and internal consistency is enough). It surfaces only when the dApp calls `signTransaction` and submits the resulting bytes itself — most consequentially in multi-sig ceremonies where M signers must produce sigs over shared canonical bodyBytes.

**To Reproduce**

Steps to reproduce the behavior:

1. Build and freeze a `ContractExecuteTransaction` against any deployed Hedera testnet contract (single-node freeze, explicit transactionId, explicit transactionFee, gas, function parameters). Serialize via `tx.toBytes()`.

2. Pass the frozen bytes to a participant's dApp. Reconstruct: `const transaction = Transaction.fromBytes(frozenBytes);`

3. Call `signer.signTransaction(transaction)` where `signer` is the `DAppSigner` returned by `dappConnector.signers[0]`, with HashPack or Kabila paired via WalletConnect v2.

4. Extract the wallet's signature and the original bodyBytes:
   ```ts
   const signedTx = await signer.signTransaction(transaction);
   const sig = (signedTx as any)._signedTransactions.list[0].sigMap.sigPair[0].ed25519;
   const bodyBytes = (Transaction.fromBytes(frozenBytes) as any)._signedTransactions.list[0].bodyBytes;
   const walletPubKey = PublicKey.fromString(wallet.publicKey);
   console.log(walletPubKey.verify(bodyBytes, sig));   // → false (expected: true)
   ```

5. Compare `signedTx`'s bodyBytes against the original — they're byte-for-byte identical (verified via `proto.TransactionBody.decode` on both sides — no field differences). The mismatch is invisible at the wire-bytes layer.

**Expected behavior**

`walletPubKey.verify(bodyBytes, signature)` returns `true`. The wallet's signature should be over the bodyBytes that the SignedTransaction contains — that's the contract of `SignTransaction` from a consumer's perspective, and it's required for any non-execute flow (multi-sig aggregation, offline signing, batched submission, off-chain attestation).

Actually observed: `verify` returns `false`. The signature is mathematically valid but against bytes the dApp never receives back (the rebuilt `TransactionBody`).

**Screenshots**

Not applicable — it's a programmatic verify failure. The dev-console output that exposed it (browser DevTools, our localhost-gated diagnostics):

```
[multisig] wallet returned 1 sigMap entries, 0 verified against original bodies (out of 1)

[diag] body[0] identical bytes (112B) — sig-only mismatch
[diag] body[0] sigPair: field=ed25519 sigLen=64B sigHex=c055357cc0876b56661fa100f58a1fcc…
[diag] body[0] pubKeyPrefix (signed-with) = 6483e83472c00ff3f3c41be120b738d589c8512840863f96d07fc6e704674017
[diag] body[0] wallet.publicKey         = 6483e83472c00ff3f3c41be120b738d589c8512840863f96d07fc6e704674017
[diag] body[0] key match = YES (pubKeyPrefix is prefix of wallet key)

[probe] trying alternate verify paths to figure out what the wallet actually signed…
[probe] ✗ no variant matched after 19 attempts
```

Verified identical output across HashPack and Kabila — same probe count, same outcome, only the sig hex differs (because each wallet has a different private key for the test account).

**Desktop (please complete the following information):**

- OS: Windows 11 Pro 10.0.26200 (also reproduced on macOS Sonoma)
- Browser: Chrome 132, Firefox 134, Brave 1.74 — all reproduce identically
- Version: `@hashgraph/hedera-wallet-connect@2.0.4`, `@hashgraph/sdk@2.49.0`, HashPack 3.7.x, Kabila Wallet 1.x (latest at time of testing)

**Smartphone (please complete the following information):**

Not tested — bug reproduces in browser-extension wallets and we have no reason to expect mobile-paired wallets to behave differently (they'd be calling the same `DAppSigner.signTransaction` code path).

**Additional context**

**Affected code:** `src/lib/dapp/DAppSigner.ts` → compiled to `dist/lib/dapp/DAppSigner.js`, `signTransaction` method. The relevant lines (compiled v2.0.4):

```js
async signTransaction(transaction) {
    if (!transaction.isFrozen()) {
        transaction.freezeWith(this._getHederaClient());
    }
    const nodeAccountId = transaction.nodeAccountIds?.[0] ?? null;

    // ★ Line 157 — rebuilds TransactionBody from parsed Transaction.
    //   For ContractExecuteTransaction this can diverge from the
    //   original SignedTransaction.bodyBytes.
    const transactionBody = transactionToTransactionBody(transaction, nodeAccountId);
    const transactionBodyBase64 = transactionBodyToBase64String(transactionBody);

    const { signatureMap } = await this.request({
        method: HederaJsonRpcMethod.SignTransaction,
        params: {
            signerAccountId: this._signerAccountId,
            transactionBody: transactionBodyBase64,    // ← wallet signs THIS
        },
    });

    // ...later, line 184-189...
    const updatedSignedTx = proto.SignedTransaction.encode({
        bodyBytes: signedTx.bodyBytes,    // ← but reattaches sig to ORIGINAL bodyBytes
        sigMap: proto.SignatureMap.create({ sigPair: mergedSigPairs }),
    }).finish();
}
```

**Tx types tested:**

| Type | Result |
|---|---|
| `TransferTransaction` (HBAR + token) | ✅ Works |
| `TokenAssociateTransaction` | ✅ Works |
| `ScheduleCreateTransaction` | ✅ Works |
| `ContractExecuteTransaction` | ❌ Fails (this bug) |

**Suggested fix:** use `signedTx.bodyBytes` directly instead of rebuilding via `transactionToTransactionBody` when the transaction is already frozen:

```ts
async signTransaction(transaction) {
    if (!transaction.isFrozen()) {
        transaction.freezeWith(this._getHederaClient());
    }

    const originalTransactionBytes = transaction.toBytes();
    const originalTransactionList = proto.TransactionList.decode(originalTransactionBytes);

    // Use the original bodyBytes — network-canonical, preserved verbatim
    // from the wire. Rebuilding via transactionToTransactionBody can
    // produce different proto bytes (default-value handling, field
    // ordering) and breaks multi-sig aggregation against shared bodyBytes.
    const headSignedTx = proto.SignedTransaction.decode(
        originalTransactionList.transactionList[0].signedTransactionBytes
    );
    const transactionBodyBase64 = Buffer.from(headSignedTx.bodyBytes).toString('base64');

    const { signatureMap } = await this.request({
        method: HederaJsonRpcMethod.SignTransaction,
        params: {
            signerAccountId: this._signerAccountId,
            transactionBody: transactionBodyBase64,
        },
    });

    // ... rest of the method unchanged: merge sigMap, re-encode with
    // original bodyBytes, return the updated TransactionList.
}
```

Behavioral analysis:
- HBAR / token transfers: rebuild was byte-identical to original anyway → no observable change.
- ContractExecute (and any other tx where rebuild diverges): previously silently broken in non-execute flows → starts working correctly.
- `executeWithSigner` users (the dominant pattern): unaffected — that's a different code path.

If preserving 100% behavior compatibility on this method matters, an alternative is a new `signTransactionVerbatim` method that uses the original bodyBytes, leaving the existing `signTransaction` as-is. Either approach works for us.

**Workaround for anyone else hitting this:** we've shipped a bypass in our multi-sig dApp — decoding the outer Transaction proto via `@hashgraph/proto`, pulling the original `bodyBytes`, calling `signer.request({method: HederaJsonRpcMethod.SignTransaction, params: {signerAccountId, transactionBody: base64(originalBodyBytes)}})` directly, then reassembling the SignedTransaction with our original `bodyBytes` + the wallet's sigMap. Both HashPack and Kabila now sign contract calls correctly in multi-sig ceremonies.

Reference implementation: https://github.com/lazysuperheroes/hedera-multisig/blob/main/dapp/lib/walletconnect.ts (`signTransaction` function)

**Happy to send a PR** if you'd like the fix landed upstream. Let me know whether you'd prefer the in-place behavioral change (use original bodyBytes) or an additive new method (`signTransactionVerbatim` or similar) — I'll match whichever direction makes sense for your release cadence and test coverage.
