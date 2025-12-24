# CLI Tools & Account Management

Complete command-line interface tools for Hedera multi-signature account management.

## Overview

This library now includes a comprehensive set of CLI tools that provide a drop-in replacement for manual multi-sig workflows, while also integrating seamlessly with the advanced networked workflow.

## Quick Start

### Unified Account Manager

The easiest way to access all tools:

```bash
npm run account-manager
```

This launches an interactive menu with all operations. Perfect for users who prefer guided workflows.

### Individual Tools

All tools can also be run directly for automation or scripting:

```bash
npm run generate-keys      # Generate key pairs
npm run create-account      # Create new multi-sig account
npm run setup-multisig      # Convert to multi-sig
npm run update-keys         # Rotate keys
npm run revert-multisig     # Revert to single-sig
npm run query-tx            # Inspect transactions
npm run sign-tx             # Offline signing
npm run collect-keys        # Team key collection
```

## Tool Reference

### 1. Generate Key Pairs

**Purpose:** Generate new ED25519 key pairs with optional BIP39 mnemonic recovery phrases.

**Script:** `scripts/generate-keys.js`

**Usage:**

```bash
# Interactive mode (prompts for all options)
npm run generate-keys

# Generate 3 key pairs with mnemonic
npm run generate-keys -- --count 3

# Generate without mnemonic (direct ED25519)
npm run generate-keys -- --no-mnemonic

# Show help
npm run generate-keys -- --help
```

**Features:**
- BIP39 24-word mnemonic generation
- Direct ED25519 key generation
- Batch generation (1-10 keys)
- Timestamped file output
- Separate public-keys-only file
- Security warnings and best practices

**Output Files:**
- `hedera-keys-YYYY-MM-DDTHH-mm-ss.txt` - Full keys with private keys
- `public-keys-YYYY-MM-DDTHH-mm-ss.txt` - Public keys only (for sharing)

**Example:**

```bash
$ npm run generate-keys -- --count 3 --mnemonic

✅ Key pair 1 generated from mnemonic
✅ Key pair 2 generated from mnemonic
✅ Key pair 3 generated from mnemonic

Do you want to save your keys to file? Y

✅ Keys saved to: hedera-keys-2025-12-23T10-30-00.txt
✅ Public keys saved to: public-keys-2025-12-23T10-30-00.txt
```

---

### 2. Create New Multi-Sig Account

**Purpose:** Create a brand new Hedera account with multi-sig configuration from the start.

**Script:** `scripts/create-multisig-account.js`

**Usage:**

```bash
# Interactive mode
npm run create-account

# With environment variables
OPERATOR_ID=0.0.XXX OPERATOR_KEY=xxx INITIAL_BALANCE=100 npm run create-account

# Show help
npm run create-account -- --help
```

**Environment Variables:**
- `OPERATOR_ID` - Operator account ID (pays for account creation)
- `OPERATOR_KEY` - Operator private key
- `INITIAL_BALANCE` - Initial balance in HBAR (default: 10)

**Features:**
- Creates account with multi-sig from the start (no conversion)
- Configurable initial balance
- Load public keys from file or manual entry
- Set threshold (M-of-N)
- Saves configuration file
- Verifies account creation

**Output Files:**
- `multisig-account-0-0-XXXXX.json` - Account configuration

**Example:**

```bash
$ OPERATOR_ID=0.0.123 OPERATOR_KEY=xxx npm run create-account

Network (testnet/mainnet) [testnet]: testnet
Initial balance in HBAR [10]: 50

Enter public keys...
✅ Collected 3 public keys

Signature threshold (1-3) [2]: 2

✅ Account successfully created!
   New Account ID: 0.0.45678
```

---

### 3. Convert to Multi-Sig

**Purpose:** Convert an existing single-signature account to multi-sig.

**Script:** `scripts/setup-multisig-account.js`

**Usage:**

```bash
# Interactive mode
npm run setup-multisig

# With environment variables
ACCOUNT_ID=0.0.XXX ACCOUNT_KEY=xxx npm run setup-multisig

# Show help
npm run setup-multisig -- --help
```

**Environment Variables:**
- `ACCOUNT_ID` - Account to convert
- `ACCOUNT_KEY` - Current account private key
- `OPERATOR_ID` - (Optional) Operator for fee payment
- `OPERATOR_KEY` - (Optional) Operator private key

**Features:**
- Converts existing single-sig → multi-sig
- Requires current account private key
- Load new public keys from file or manual entry
- Set threshold
- Saves configuration
- Verifies conversion

**Output Files:**
- `multisig-config-0-0-XXXXX.json` - Multi-sig configuration

**CRITICAL:** This transaction uses `TransactionId.generate()` before `freezeWith()` to stabilize the hash for multi-sig workflows. The old key (current account key) must sign the transaction.

---

### 4. Rotate Multi-Sig Keys

**Purpose:** Update keys on an existing multi-sig account (key rotation).

**Script:** `scripts/update-multisig-keys.js`

**Usage:**

```bash
# Interactive mode
npm run update-keys

# With environment variables
ACCOUNT_ID=0.0.XXX OPERATOR_ID=0.0.YYY OPERATOR_KEY=xxx npm run update-keys

# Show help
npm run update-keys -- --help
```

**Environment Variables:**
- `ACCOUNT_ID` - Multi-sig account to update
- `OPERATOR_ID` - Operator for fee payment (does NOT need to be key holder)
- `OPERATOR_KEY` - Operator private key

**Features:**
- Multi-sig → new multi-sig configuration
- Requires M-of-N signatures from CURRENT key holders
- Supports networked workflow for signature collection
- Supports offline workflow (export transaction)
- Saves new configuration

**Important:** The CURRENT key holders must sign this transaction. The operator account pays fees but doesn't need to be a key holder.

---

### 5. Revert to Single-Sig

**Purpose:** Convert a multi-sig account back to single-signature.

**Script:** `scripts/revert-to-single-sig.js`

**Usage:**

```bash
# Interactive mode
npm run revert-multisig

# With environment variables
ACCOUNT_ID=0.0.XXX npm run revert-multisig

# Show help
npm run revert-multisig -- --help
```

**Environment Variables:**
- `ACCOUNT_ID` - Multi-sig account to revert
- `OPERATOR_ID` - (Optional) Operator for fee payment
- `OPERATOR_KEY` - (Optional) Operator private key

**Features:**
- Converts multi-sig → single-sig
- Requires M-of-N signatures from current multi-sig
- Option to generate new key or use existing
- Saves new key configuration
- Supports networked or offline signature collection

**Output Files:**
- `single-sig-keys-0-0-XXXXX.json` - New single-sig keys (if generated)
- `revert-multisig-0-0-XXXXX.json` - Transaction for signature collection

---

### 6. Inspect Transaction

**Purpose:** Decode and display transaction bytes without signing (read-only inspection).

**Script:** `scripts/query-transaction.js`

**Usage:**

```bash
# Interactive mode
npm run query-tx

# From file
npm run query-tx -- --file transaction.json

# From base64 string
npm run query-tx -- --tx <base64-encoded-bytes>

# Show help
npm run query-tx -- --help
```

**Features:**
- Decode frozen transaction bytes
- Display all transaction details
- Show existing signatures
- Calculate transaction checksum
- NO signing (pure inspection)
- Supports various transaction types (transfer, account update, contract calls, etc.)

**Example Output:**

```
═══════════════════════════════════════════════════════════
TRANSACTION DETAILS
═══════════════════════════════════════════════════════════

📋 Basic Information:
  Type: TransferTransaction
  Transaction ID: 0.0.123@1234567890.123456789
  Memo: Team payment
  Max Fee: 0.10000000 ℏ (10000000 tinybars)

🔐 Signatures:
  ✅ 2 signature(s) collected
     1. 302a300506032b6570...
     2. 302a300506032b6570...

🔍 Transaction Checksum:
  SHA-256: abc123...

📝 Type-Specific Details:
  HBAR Transfers:
    → 0.0.12345: -50.00000000 ℏ
    ← 0.0.67890: +50.00000000 ℏ
```

---

### 7. Sign Transaction Offline

**Purpose:** Sign frozen transactions with private keys (offline/air-gapped signing).

**Script:** `scripts/sign-transaction.js`

**Usage:**

```bash
# Interactive mode
npm run sign-tx

# With single key
npm run sign-tx -- --file transaction.json --key <private-key>

# With multiple keys (batch signing)
npm run sign-tx -- --file transaction.json --keys <key1,key2,key3>

# Specify output file
npm run sign-tx -- --file tx.json --key <key> --output signed.json

# Show help
npm run sign-tx -- --help
```

**Features:**
- Air-gapped signing support
- Batch signing with multiple keys
- Signature count tracking
- Preserves metadata from input file
- Calculates checksums before and after
- Auto-generates output filename

**Output Files:**
- `<input>-signed.json` - Signed transaction with metadata

**Example:**

```bash
$ npm run sign-tx -- --file transaction.json --keys key1,key2,key3

⏳ Loading transaction...

Transaction Information:
  Type: TransferTransaction
  Transaction ID: 0.0.123@1234567890.123456789
  Existing Signatures: 0
  Checksum (before): abc123...

⏳ Signing transaction...

  ✅ Signature 1 added
     Public key: 302a300506032b6570...

  ✅ Signature 2 added
     Public key: 302a300506032b6570...

  ✅ Signature 3 added
     Public key: 302a300506032b6570...

✅ SIGNING COMPLETE
Signing Summary:
  Keys Used: 3
  Signatures Before: 0
  Signatures After: 3
  New Signatures: 3

✅ Signed transaction saved to: transaction-signed.json
```

---

### 8. Collect Team Keys

**Purpose:** Collect public keys from team members for multi-sig setup.

**Script:** `scripts/collect-team-keys.js`

**Usage:**

```bash
# Coordinator mode
npm run collect-keys

# Participant mode
npm run collect-keys -- --participant

# Show help
npm run collect-keys -- --help
```

**Modes:**

**Coordinator Mode:** Collects keys from all team members
- Interactive prompts for each participant
- Can generate keys for participants
- Can load from files
- Saves team configuration

**Participant Mode:** Individual key export
- Generate new key or export existing
- Provides key for sharing with coordinator

**Output Files:**
- `team-keys-<timestamp>.json` - Team configuration (coordinator)
- `public-keys-<timestamp>.txt` - Public keys list (coordinator)
- `participant-key-<timestamp>.json` - Individual key export (participant)

---

## Integration Patterns

### Pattern 1: CLI-Only Workflow (Drop-in Replacement)

Perfect for teams familiar with manual workflows:

```bash
# 1. Team generates keys
npm run generate-keys

# 2. Coordinator collects keys
npm run collect-keys

# 3. Setup account
npm run create-account

# 4. Sign transactions offline
npm run sign-tx
```

**Pros:** Simple, familiar, no infrastructure
**Cons:** Manual coordination, slower

---

### Pattern 2: Hybrid Workflow (Recommended)

Best of both worlds:

```bash
# Account Setup: Use CLI tools
npm run generate-keys
npm run collect-keys
npm run create-account

# Regular Transactions: Use networked workflow
npm run multisig-server    # Coordinator
npm run multisig-client    # Participants

# Offline Signing: Use CLI tools when needed
npm run sign-tx
npm run query-tx
```

**Pros:** Simple setup, fast transactions, flexible
**Cons:** Requires learning both workflows

---

### Pattern 3: Networked-First Workflow

For teams prioritizing speed and coordination:

```bash
# Use CLI for initial setup only
npm run generate-keys
npm run create-account

# Everything else through networked workflow
npm run multisig-server
npm run multisig-client
```

**Pros:** Fastest, best coordination, real-time
**Cons:** Requires internet, all signers must be online

---

## Important Technical Notes

### TransactionId Generation

**CRITICAL:** All account update scripts (setup, update, revert) use `TransactionId.generate(operatorId)` BEFORE `freezeWith(client)`. This stabilizes the transaction hash for multi-sig workflows.

```javascript
const transaction = await new AccountUpdateTransaction()
  .setAccountId(accountId)
  .setKey(newKeyList)
  .setTransactionId(TransactionId.generate(operatorId))  // MUST come before freezeWith
  .freezeWith(client);
```

### Old Key vs Operator Key

- **Old Key:** The current account key (provides authority to change)
- **Operator Key:** Pays transaction fees (doesn't need to be key holder)

When updating accounts:
1. Operator key pays fees
2. Old key (current key holders) must sign for authority
3. New key takes effect after transaction

### Multi-Sig Chaining

If OLD key is multi-sig:
- Need M-of-N signatures from current holders
- Use networked workflow or offline signature collection

If NEW key is multi-sig:
- Just set the KeyList
- Future transactions will require M-of-N signatures

### Node ID (Deprecated)

`.setNodeAccountIds()` is NO LONGER required. Hedera now uses mesh broadcasting. The SDK handles node selection automatically.

---

## Examples

See `examples/` directory for working code:

- `complete-lifecycle-workflow.js` - Complete demonstration of CLI + networked workflow integration
- `networked-multisig-coordinator.js` - Networked workflow coordinator
- `networked-participant.js` - Networked workflow participant
- `smart-contract-multisig.js` - Smart contract deployment/calls with multi-sig

---

## Troubleshooting

### "Transaction ID not set"

**Solution:** Ensure `TransactionId.generate()` is called before `freezeWith()` in account update operations.

### "Old key signature missing"

**Solution:** For account updates, the CURRENT key holders must sign, not just the operator.

### "Keys not found in file"

**Solution:** Check file format. Public keys should be one per line, DER format. Lines starting with '#' are ignored.

### "Invalid private key"

**Solution:** Ensure private key is in DER format (starts with "302e020100..."). Check for extra spaces or newlines.

### "Threshold not met"

**Solution:** Need more signatures. Check how many keys have signed vs threshold required.

---

## Security Best Practices

✅ **Never share private keys** - Only share public keys
✅ **Store mnemonics securely** - Separate from key files
✅ **Use hardware wallets** - For high-value accounts
✅ **Test on testnet first** - Before mainnet operations
✅ **Verify transaction details** - Before signing
✅ **Keep threshold reasonable** - 2-of-3, 3-of-5 recommended
✅ **Have backup signers** - Account for unavailability
✅ **Document configuration** - Save all account configs
✅ **Regular key rotation** - Change keys periodically
✅ **Air-gap sensitive operations** - Use offline signing for critical transactions

---

## Support

- **Documentation:** See SETUP_GUIDE.md and TESTING.md
- **Examples:** Check examples/ directory
- **Issues:** https://github.com/lazysuperheroes/hedera-multisig/issues

---

**Last Updated:** December 2025
**Status:** Production Ready
