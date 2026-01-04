# Offline (Air-Gapped) Signing Guide

> **Maximum Security Multi-Sig Workflow**
>
> This guide covers fully offline/air-gapped signing where private keys never touch a networked device.

## Overview

For high-security scenarios, Hedera MultiSig supports a fully offline workflow where:
- **Private keys remain on air-gapped devices** (never connected to internet)
- **Only frozen transactions and signatures** are transferred between devices
- **No time pressure** - signing happens before the 120-second Hedera window starts

This is ideal for:
- Treasury management with cold storage
- Compliance requirements mandating offline signing
- Maximum security for high-value transactions

## When to Use This Workflow

| Scenario | Recommended Workflow |
|----------|---------------------|
| Regular team transactions | Networked (WebSocket/dApp) |
| High-value treasury operations | **Offline** |
| Cold storage key holders | **Offline** |
| Regulatory/compliance requirements | **Offline** |
| Remote participants with connectivity | Networked |
| Mixed online + offline signers | See [Hybrid Bridge](#future-hybrid-bridge) |

## Prerequisites

### Coordinator Machine (Networked)
- Node.js 18+
- `@lazysuperheroes/hedera-multisig` installed
- Hedera account credentials (operator)
- Network connectivity to Hedera

### Signer Machine (Air-Gapped)
- Node.js 18+ (can be installed via USB)
- `@lazysuperheroes/hedera-multisig` installed offline
- Private key access
- **NO network connectivity required**

## The Offline Signing Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    OFFLINE SIGNING WORKFLOW                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  COORDINATOR (networked)              SIGNER (air-gapped)           │
│         │                                    │                      │
│         │  1. Create & freeze transaction    │                      │
│         │     → Generate base64 + checksum   │                      │
│         │                                    │                      │
│         ├──── 2. Transfer via secure ───────►│                      │
│         │        channel (Signal, USB)       │                      │
│         │                                    │                      │
│         │                    3. Decode & verify transaction         │
│         │                       → Review details                    │
│         │                       → Verify checksum                   │
│         │                                    │                      │
│         │                    4. Sign transaction                    │
│         │                       → Enter private key                 │
│         │                       → Get signature tuple               │
│         │                                    │                      │
│         │◄─── 5. Return signature ───────────┤                      │
│         │        tuple via secure channel    │                      │
│         │                                    │                      │
│         │  6. Collect all signatures         │                      │
│         │  7. Execute transaction            │                      │
│         │                                    │                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Step-by-Step Instructions

### Step 1: Coordinator Freezes Transaction

The coordinator creates and freezes the transaction, outputting base64 bytes for transfer.

**Option A: Using the OfflineWorkflow API (Recommended)**

```javascript
const { OfflineWorkflow } = require('@lazysuperheroes/hedera-multisig');
const { Client, TransferTransaction, Hbar } = require('@hashgraph/sdk');

// Setup client
const client = Client.forTestnet();
client.setOperator(operatorId, operatorKey);

// Create workflow
const workflow = new OfflineWorkflow(client, {
  exportDir: './multisig-transactions',
  verbose: true
});

// Create your transaction
const transaction = new TransferTransaction()
  .addHbarTransfer(sourceAccountId, new Hbar(-100))
  .addHbarTransfer(destinationAccountId, new Hbar(100));

// Freeze and export
const result = await workflow.freezeAndExport(transaction, {
  threshold: 2,
  requiredSigners: ['signer1-public-key', 'signer2-public-key'],
  instructions: 'Monthly treasury allocation',
  createdBy: 'Treasury Coordinator'
});

console.log('Transaction file:', result.transactionFile);
console.log('Metadata file:', result.metadataFile);
```

This creates two files:
- `multisig-transactions/0-0-12345@1234567890-000.tx` - Raw transaction bytes
- `multisig-transactions/0-0-12345@1234567890-000.json` - Human-readable metadata

**Option B: Using scripts/sign-transaction.js**

```bash
# First create a transaction JSON file, then use sign-transaction.js
node scripts/sign-transaction.js --file transaction.json
```

**Getting Base64 for Copy-Paste Transfer:**

```javascript
const fs = require('fs');

// Read the .tx file and convert to base64
const txBytes = fs.readFileSync('./multisig-transactions/your-tx.tx');
const base64 = txBytes.toString('base64');
const checksum = require('crypto')
  .createHash('sha256')
  .update(txBytes)
  .digest('hex')
  .substring(0, 16);

console.log('\n=== COPY THIS TO SIGNER ===\n');
console.log('Base64 Transaction:');
console.log(base64);
console.log('\nChecksum:', checksum);
console.log('\n===========================\n');
```

### Step 2: Transfer to Air-Gapped Device

Transfer the base64 transaction to the air-gapped signer via:

| Method | Security | Convenience |
|--------|----------|-------------|
| **Written on paper** | Highest | Low (error-prone) |
| **USB drive** | High | Medium |
| **QR code (photographed)** | High | Medium |
| **Encrypted message (Signal)** | Medium-High | High |

**Important**: Always transfer the **checksum** separately if possible, or verify it matches on the air-gapped device.

### Step 3: Signer Decodes and Verifies

On the air-gapped machine, the signer should first verify the transaction details:

```bash
# Currently, use the sign command which shows transaction details
hedera-multisig sign
```

When prompted:
1. Paste the base64 transaction bytes
2. If you have a checksum, enter it to verify
3. Review the displayed transaction details
4. **CRITICAL**: Verify the transaction matches what you expect!

**What to verify:**
- Transaction type (Transfer, ContractExecute, etc.)
- Amounts and accounts involved
- Transaction ID format
- Checksum matches

### Step 4: Signer Signs Transaction

Continue in the same `hedera-multisig sign` session:

```
STEP 1: Paste Transaction Bytes

Paste the base64-encoded transaction bytes below:
Transaction bytes: [paste base64 here]

Transaction bytes received.
Length: 256 characters

Do you have a checksum to verify? [y/n]: y
Expected checksum: a7b3c9d4...
✅ Checksum verified!

STEP 2: Review Transaction Details

Transaction Hash: abc123...
Transaction Bytes (first 64 chars): CgQQBxgLEgQQ...

⚠️  TRANSACTION DETAILS:
─────────────────────────────────────────────────────────
   Transaction bytes hash: abc123...
─────────────────────────────────────────────────────────

Do you want to sign this transaction? [y/n]: y

STEP 3: Enter Private Key

⚠️  Your private key will NOT be stored or logged
   It exists only in memory during this signing operation

🔑 Private key: [hidden input]

STEP 4: Generate Signature

🔐 Signing transaction...

✅ Signature generated successfully!

╔═══════════════════════════════════════════════════════╗
║              SIGNATURE TUPLE OUTPUT                   ║
╚═══════════════════════════════════════════════════════╝

Copy the following signature tuple and send it back to
the transaction initiator via secure channel:

─────────────────────────────────────────────────────────
302a300506032b6570032100abc123...:Sg7m2xKl9p...
─────────────────────────────────────────────────────────

BREAKDOWN (for verification):
  Public Key: 302a300506032b6570032100abc123...
  Signature:  Sg7m2xKl9p...
  Format:     publicKey:signature

🔍 Verifying signature...
✅ Signature is cryptographically valid
```

### Step 5: Return Signature to Coordinator

Transfer the signature tuple back to the coordinator via secure channel.

The signature tuple format is:
```
publicKey:signatureBase64
```

Example:
```
302a300506032b6570032100abc123def456...:Sg7m2xKl9pQr8sT0uV1wX2yZ3a4b5c6d7e8f...
```

### Step 6: Coordinator Collects Signatures

Repeat steps 2-5 for each required signer until threshold is met.

**Using OfflineWorkflow to collect and verify:**

```javascript
// Parse signature tuples from signers
const signatures = [
  {
    publicKey: '302a300506032b6570032100abc123...',
    signature: 'Sg7m2xKl9p...',
    signerLabel: 'CFO'
  },
  {
    publicKey: '302a300506032b6570032100def456...',
    signature: 'Xk9nRtYu7v...',
    signerLabel: 'Treasury Manager'
  }
];

// Collect and verify signatures
const collectionResult = await workflow.collectSignatures(
  frozenTransaction,
  signatures,
  2  // threshold
);

if (collectionResult.success) {
  console.log(`✅ Collected ${collectionResult.count} valid signatures`);
}
```

### Step 7: Coordinator Executes Transaction

Once threshold is met, execute the transaction:

```javascript
// Execute with collected signatures
const executionResult = await workflow.executeTransaction(
  frozenTransaction,
  collectionResult.signatures
);

if (executionResult.success) {
  console.log('✅ Transaction executed!');
  console.log('Transaction ID:', executionResult.transactionId);
}
```

## Security Best Practices

### For Coordinators

1. **Verify signer identities** before collecting signatures
2. **Use separate channels** for transaction bytes vs checksum
3. **Keep audit logs** of all transaction attempts
4. **Set appropriate thresholds** (e.g., 3-of-5, not 1-of-3)

### For Signers

1. **ALWAYS decode and review** transaction details before signing
2. **Verify checksum matches** what coordinator provided
3. **Confirm with coordinator** via separate channel if uncertain
4. **Keep private keys offline** - never type on networked device
5. **Clear terminal history** after signing

### Air-Gap Security

1. **Never connect signing device to network**
2. **Use dedicated signing hardware** if possible
3. **Verify software integrity** before installation
4. **Consider hardware wallets** (Ledger) for additional security

## Troubleshooting

### "Invalid base64" error
- Ensure no extra whitespace or line breaks in pasted content
- Verify the full base64 string was copied

### "Checksum mismatch" warning
- Transaction may have been modified in transit
- Re-request from coordinator via different channel
- **Do NOT sign if checksum doesn't match**

### "Invalid private key format" error
- Ensure key is in correct format (DER-encoded hex)
- Check for extra characters or truncation

### "Signature verification failed"
- Key may not match expected public key
- Transaction bytes may be corrupted
- Try signing again with fresh transfer

## File Formats

### Transaction Export File (.tx)
Raw binary transaction bytes (Hedera SDK format)

### Metadata File (.json)
```json
{
  "transactionId": "0.0.12345@1234567890.000000000",
  "transactionType": "TransferTransaction",
  "expirationTime": 1234567990,
  "expirationDate": "2024-01-15T12:00:00.000Z",
  "details": {
    "transfers": [
      { "accountId": "0.0.456", "amount": "-100 HBAR" },
      { "accountId": "0.0.789", "amount": "+100 HBAR" }
    ]
  },
  "signatureRequirements": {
    "threshold": 2,
    "requiredSigners": ["pubkey1", "pubkey2", "pubkey3"]
  },
  "instructions": "Monthly treasury allocation",
  "createdAt": "2024-01-15T11:58:00.000Z",
  "createdBy": "Treasury Coordinator"
}
```

### Signature Tuple Format
```
<publicKey>:<signatureBase64>

Example:
302a300506032b6570032100abc123...:Sg7m2xKl9pQr8sT0uV1wX2yZ3a4b5c6d...
```

## Comparison with Networked Workflow

| Aspect | Offline Workflow | Networked Workflow |
|--------|------------------|-------------------|
| **Security** | Maximum (air-gapped) | High (TLS + PIN) |
| **Convenience** | Lower (manual transfer) | Higher (real-time) |
| **Time Pressure** | None | 120-second window |
| **Coordination** | Manual | Automatic |
| **Use Case** | Treasury, cold storage | Regular operations |

## Future: Hybrid Bridge

> **Note**: A hybrid bridge allowing mixed online/offline signing in the same session is planned for a future release. This requires Hedera scheduled transaction support to remove the 120-second timing constraint. See [ROADMAP.md](./ROADMAP.md) for details.

## Related Documentation

- [SECURITY_ARCHITECTURE.md](./SECURITY_ARCHITECTURE.md) - Security model details
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Architecture overview
- [README.md](../README.md) - Getting started

---

*For questions or issues, see the [GitHub repository](https://github.com/example/hedera-multisig).*
