# `DAppSigner.signTransaction` rebuilds `TransactionBody`, breaking multi-sig signature aggregation

**Repository:** [hashgraph/hedera-wallet-connect](https://github.com/hashgraph/hedera-wallet-connect)
**Affected file:** `src/lib/dapp/DAppSigner.ts` (compiled: `dist/lib/dapp/DAppSigner.js`)
**Affected method:** `DAppSigner.signTransaction(transaction)`
**Affected use case:** Any flow where the dApp pre-freezes a transaction and the wallet's signature must verify against the dApp's *original* `bodyBytes` — most notably **multi-sig ceremonies**, where signatures from M signers aggregate into one transaction against shared canonical bodyBytes.

---

## Summary

`DAppSigner.signTransaction` rebuilds a fresh `TransactionBody` from the parsed `Transaction` SDK object via `transactionToTransactionBody(transaction, nodeAccountId)`, sends THAT to the wallet for signing, then reattaches the wallet's signature to the **original** preserved `signedTx.bodyBytes`.

For HBAR transfers and token operations, the rebuilt `TransactionBody` happens to serialize byte-identically to the original — so verify against `signedTx.bodyBytes` succeeds. **For `ContractExecuteTransaction`, the rebuild produces different proto bytes** (likely default-value handling for `transactionFee` or proto field-ordering differences in `contractCall`). The wallet's signature is over the rebuilt body, not over the bodyBytes returned in the SignedTransaction structure, so verify fails.

We confirmed this is wallet-independent by testing both **HashPack** and **Kabila** against the same multi-sig contract execute on Hedera testnet:

- Both wallets fail identically — same diagnostic profile, same `bodyBytes` (preserved verbatim), same matching public key, same 64B Ed25519 sig length, sig fails to verify against `bodyBytes`.
- We ran 19 alternate-message verify probes (sha256/sha384/sha512 of bodyBytes, common prefix conventions, byte-reversal) — none matched. The wallet's signature is over content we can't reproduce from `bodyBytes`.
- CLI participants signing the same transaction via Hedera SDK's `PrivateKey.sign(bodyBytes)` produce signatures that verify and aggregate correctly — ruling out any issue in our coordinator's freeze logic.
- Tracing the WC adapter source confirmed the cause: the `transactionToTransactionBody` rebuild on line 157, with the `bodyBytes` reattachment on line 185.

## The relevant code

`dist/lib/dapp/DAppSigner.js` (current at time of writing — same shape in source TS):

```js
async signTransaction(transaction) {
    if (!transaction.isFrozen()) {
        transaction.freezeWith(this._getHederaClient());
    }
    const nodeAccountId = transaction.nodeAccountIds?.[0] ?? null;

    // ★ Rebuilds TransactionBody from the parsed Transaction object.
    //   For ContractExecuteTransaction this can serialize differently
    //   from the original bodyBytes the dApp froze.
    const transactionBody = transactionToTransactionBody(transaction, nodeAccountId);
    if (!transactionBody)
        throw new Error('Failed to serialize transaction body');
    const transactionBodyBase64 = transactionBodyToBase64String(transactionBody);

    const { signatureMap } = await this.request({
        method: HederaJsonRpcMethod.SignTransaction,
        params: {
            signerAccountId: this._signerAccountId,
            transactionBody: transactionBodyBase64,    // ← wallet signs THIS
        },
    });

    const sigMap = base64StringToSignatureMap(signatureMap);
    const originalTransactionBytes = transaction.toBytes();
    const originalTransactionList = proto.TransactionList.decode(originalTransactionBytes);
    const signedTransactionList = originalTransactionList.transactionList.map((tx) => {
        if (tx.signedTransactionBytes) {
            const signedTx = proto.SignedTransaction.decode(tx.signedTransactionBytes);
            const existingSigMap = signedTx.sigMap || proto.SignatureMap.create({});
            const mergedSigPairs = [...(existingSigMap.sigPair || []), ...(sigMap.sigPair || [])];
            const updatedSignedTx = proto.SignedTransaction.encode({
                bodyBytes: signedTx.bodyBytes,    // ← but reattaches sig to ORIGINAL bodyBytes
                sigMap: proto.SignatureMap.create({ sigPair: mergedSigPairs }),
            }).finish();
            return { signedTransactionBytes: updatedSignedTx };
        }
        // ...
    });
    // ...
}
```

The wallet receives bytes from `transactionBodyToBase64String(transactionBody)` and signs them. The returned SignedTransaction has `bodyBytes: signedTx.bodyBytes` (the preserved original). For HBAR these happen to match. For ContractExecute they don't.

## Reproduction

Multi-sig ceremony, three signers (M=2 of N=3), one signer paired via HashPack or Kabila Wallet on Hedera testnet:

1. Coordinator builds a `ContractExecuteTransaction` against any deployed testnet contract:
   ```ts
   const tx = new ContractExecuteTransaction()
     .setContractId(contractId)
     .setGas(100000)
     .setFunctionParameters(/* ABI-encoded no-arg call */)
     .setTransactionFee(200000000n)
     .setTransactionId(TransactionId.generate(operatorId))
     .setNodeAccountIds([nodeAccountId])           // single-node freeze
     .freezeWith(client);
   const frozenBytes = tx.toBytes();
   ```
2. Coordinator broadcasts `frozenBytes` to all participants.
3. Wallet participant calls `signer.signTransaction(transaction)` (where `transaction = Transaction.fromBytes(frozenBytes)`).
4. Wallet returns SignedTransaction; dApp verifies via `walletPubKey.verify(originalBodyBytes, sigMap.sigPair[0].ed25519)` → **returns `false`**.

Empirically observed:
- `signedTx._signedTransactions.list[0].bodyBytes` returned by the wallet is **byte-for-byte identical** to the original `frozenBytes`'s inner bodyBytes (we diffed via `proto.TransactionBody.decode` on both sides — no field differences).
- `pubKeyPrefix` in the returned `sigMap` matches the connected wallet's public key exactly.
- Sig is 64 bytes, correct for Ed25519.
- Direct verify against `bodyBytes` fails. Verify against sha256/sha384/sha512 of bodyBytes fails. Verify against 7 prefix patterns × 2 (raw + sha384 hashed) fails. Byte-reversal fails.

## Suggested fix

Skip the `transactionToTransactionBody` rebuild for already-frozen transactions. Use the original `signedTx.bodyBytes` directly when sending to the wallet:

```js
async signTransaction(transaction) {
    if (!transaction.isFrozen()) {
        transaction.freezeWith(this._getHederaClient());
    }

    const originalTransactionBytes = transaction.toBytes();
    const originalTransactionList = proto.TransactionList.decode(originalTransactionBytes);

    // Use the original bodyBytes from the SignedTransaction wrapper —
    // these are network-canonical and preserved verbatim from the wire.
    // Rebuilding via transactionToTransactionBody can produce different
    // proto bytes (default-value handling, field ordering) and breaks
    // multi-sig aggregation against shared bodyBytes.
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

    // ... rest of the method unchanged: merge sigMap into each
    // SignedTransaction's existing sigMap, re-encode with the original
    // bodyBytes, return the updated TransactionList.
}
```

For unfrozen transactions, the rebuild path is still needed (since there's no `bodyBytes` yet). Detect via `transaction.isFrozen()` and branch.

## Workaround (for downstream consumers in the meantime)

We've shipped a workaround in our multi-sig dApp by bypassing `DAppSigner.signTransaction` entirely. We decode the outer Transaction proto via `@hashgraph/proto`, pull the original `bodyBytes`, call `signer.request({method: HederaJsonRpcMethod.SignTransaction, params: {signerAccountId, transactionBody: base64(originalBodyBytes)}})` directly with our verbatim bytes, then reassemble the `SignedTransaction` with our original `bodyBytes` + the wallet's sigMap. Verify works, aggregation works, both HashPack and Kabila now sign contract calls correctly.

Reference implementation: https://github.com/lazysuperheroes/hedera-multisig/blob/main/dapp/lib/walletconnect.ts (`signTransaction` function)

Anyone building multi-sig coordination on Hedera with WalletConnect-paired wallets will hit this — happy to help anyone affected.

## Why this matters

This bug silently breaks any flow where the wallet's signature must verify against the dApp's *original* bodyBytes. The most consequential of these is multi-sig signature aggregation: if M signers each sign different bodyBytes (because each wallet's adapter rebuilds independently), the resulting transaction has incompatible signatures and fails at consensus. Single-signer flows mask the bug because the wallet's "rebuilt" body is still what's submitted to consensus.

Hedera's native threshold-key support is one of the chain's most distinctive features for treasury management and agent ceremonies. This bug puts a usability ceiling on building user-facing tooling for that use case via WalletConnect.

## Environment

| Component | Value |
|---|---|
| `@hashgraph/hedera-wallet-connect` | 2.0.4 (verified) |
| Wallets tested | HashPack (browser ext + WC v2), Kabila Wallet (browser ext + WC v2) |
| Network | Hedera Testnet |
| Hedera SDK | `@hashgraph/sdk@^2.49.0` |
| Tx type that fails | `ContractExecuteTransaction` |
| Tx types that work | `TransferTransaction` (HBAR + token), `TokenAssociateTransaction`, `ScheduleCreateTransaction` |

## Contact

- **Repo:** https://github.com/lazysuperheroes/hedera-multisig
- **Email:** contact@lazysuperheroes.com
- **dApp:** https://testnet-multisig.lazysuperheroes.com (file an issue on the repo with steps and we'll respond)

Happy to provide additional diagnostics, run more probes, or pair-debug if useful.
