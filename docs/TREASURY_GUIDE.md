# Treasury Management Guide

> **Complete guide for managing multi-sig treasury operations on Hedera.**
>
> This guide is for treasury managers, finance teams, and anyone who needs to
> move HBAR, tokens, or NFTs under multi-signature control.

---

## Table of Contents

1. [Overview: What is Multi-Sig?](#overview-what-is-multi-sig)
2. [Setting Up a Multi-Sig Account](#setting-up-a-multi-sig-account)
3. [HBAR Transfers](#hbar-transfers)
4. [Token Transfers](#token-transfers)
5. [Token Association](#token-association)
6. [Smart Contract Calls](#smart-contract-calls)
7. [Scheduled Transactions](#scheduled-transactions)
8. [Using the Web App](#using-the-web-app)
9. [Security Best Practices](#security-best-practices)
10. [Audit Trail](#audit-trail)

---

## Overview: What is Multi-Sig?

Multi-signature (multi-sig) means that a transaction requires approval from
multiple parties before it can execute. Instead of a single person controlling
funds with one key, you distribute control across a team.

### The M-of-N Concept

A multi-sig configuration is described as "M-of-N," where:

- **N** = the total number of authorized signers (key holders)
- **M** = the minimum number of signatures required to approve a transaction

**Common configurations:**

| Configuration | Use Case |
|--------------|----------|
| **2-of-3** | Small team treasury. Any 2 of 3 team members can approve. One person being unavailable does not block operations. |
| **3-of-5** | Corporate treasury. Requires majority approval. Tolerates 2 unavailable signers. |
| **2-of-2** | Two-person approval. Both must agree. Maximum security, no redundancy. |
| **1-of-3** | Convenience accounts. Any single authorized person can transact. Lower security. |

### Why Use Multi-Sig?

- **No single point of failure** -- one lost or compromised key does not endanger funds
- **Separation of duties** -- no single person can move funds alone
- **Audit trail** -- every transaction shows which keys signed
- **Compliance** -- meets requirements for multi-party authorization
- **Key rotation** -- individual signers can be added or removed without changing the account

### How It Works

1. A **coordinator** creates a transaction (e.g., "send 1,000 HBAR to vendor")
2. The transaction is **frozen** -- locked into a specific form that cannot be altered
3. Each required signer **reviews** the frozen transaction details
4. Each signer independently **signs** the transaction with their private key
5. Once enough signatures are collected (the threshold M), the transaction **executes** on the Hedera network

Private keys never leave each signer's device. Only the frozen transaction bytes and signatures are shared.

---

## Setting Up a Multi-Sig Account

Before you can use multi-sig, you need a Hedera account configured with a **threshold key** (a key list that requires M-of-N signatures).

### Step 1: Collect Public Keys from All Signers

Each signer generates their own key pair and shares only their **public key**:

```bash
node scripts/generate-keys.js
```

Or generate multiple keys at once:

```bash
node scripts/generate-keys.js --count 3 --no-mnemonic
```

Each signer keeps their private key secret and sends their public key to the coordinator.

### Step 2: Create the Multi-Sig Account

Use the account creation script:

```bash
node scripts/create-multisig-account.js
```

The interactive script will ask you to:

1. Choose a network (testnet or mainnet)
2. Enter your operator credentials (the account that pays for creation)
3. Set an initial HBAR balance for the new account
4. Enter the public keys of all signers
5. Set the signature threshold (M)

The script creates a new Hedera account with a `KeyList` configured from the start. You will receive a new Account ID (e.g., `0.0.5678901`) that requires M-of-N signatures for all transactions.

### Step 3: Convert an Existing Account (Alternative)

If you already have a Hedera account and want to convert it to multi-sig:

```bash
node scripts/setup-multisig-account.js
```

This updates the account's key from a single key to a threshold key list. **Important:** the current (old) key must sign this update transaction. Once converted, the old single key can no longer authorize transactions alone.

### Step 4: Verify the Account Configuration

Check your account on [HashScan](https://hashscan.io/) to confirm the key structure shows a threshold key with the correct number of public keys.

---

## HBAR Transfers

The most common treasury operation: sending HBAR from your multi-sig account.

### Method 1: Using the Transfer Command (Recommended)

The `transfer hbar` command creates a frozen transaction ready for signing:

```bash
hedera-multisig transfer hbar \
  --from 0.0.YOUR_MULTISIG_ACCOUNT \
  --to 0.0.RECIPIENT_ACCOUNT \
  --amount 100
```

This outputs:
- **Base64-encoded transaction** -- the frozen transaction bytes
- **Checksum** -- a short hash for integrity verification

### Method 2: Using Offline Freeze

The `offline freeze` command provides the same functionality with more options:

```bash
hedera-multisig offline freeze \
  -t transfer \
  -f 0.0.YOUR_MULTISIG_ACCOUNT \
  -T 0.0.RECIPIENT_ACCOUNT \
  -a 100
```

### Save to File

Save the frozen transaction to a file instead of displaying it on screen:

```bash
hedera-multisig transfer hbar \
  --from 0.0.1234 \
  --to 0.0.5678 \
  --amount 100 \
  --output payroll-march.txt
```

### Full Workflow: Freeze, Verify, Sign, Execute

**1. Coordinator freezes the transaction:**

```bash
hedera-multisig offline freeze -t transfer -f 0.0.1234 -T 0.0.5678 -a 100
```

**2. Coordinator shares the base64 and checksum with signers** via a secure channel (Signal, encrypted email, or USB drive for air-gapped signers).

**3. Each signer decodes and verifies the transaction:**

```bash
hedera-multisig offline decode -b "BASE64_TRANSACTION_HERE" -c "CHECKSUM_HERE"
```

The decode command shows the transaction type, amounts, and accounts involved. Signers should confirm these match the expected operation.

**4. Each signer signs the transaction:**

```bash
hedera-multisig sign
```

The sign command walks through an interactive process:
- Paste the base64 transaction
- Optionally verify the checksum
- Review transaction details
- Enter private key (input is hidden)
- Receive a **signature tuple** (`publicKey:signatureBase64`)

For scripted signing:

```bash
hedera-multisig sign \
  --base64 "BASE64_TX" \
  --key-file keys.encrypted \
  --passphrase "your-passphrase" \
  --json
```

**5. Coordinator collects all signature tuples and executes:**

```bash
hedera-multisig offline execute \
  -b "BASE64_TRANSACTION" \
  -s "PUBKEY1:SIG1" "PUBKEY2:SIG2" \
  -t 2
```

You can also load signatures from a file:

```bash
hedera-multisig offline execute \
  -f transaction.txt \
  --sig-file signatures.txt \
  -t 2
```

The signatures file should contain one signature tuple per line:

```
302a300506032b6570032100abc123...:Sg7m2xKl9p...
302a300506032b6570032100def456...:Xk9nRtYu7v...
```

**6. Verify on HashScan:**

After successful execution, the CLI displays a HashScan link where you can view the transaction details and confirm it completed as expected.

### Dry Run (Validate Without Executing)

To verify signatures without actually submitting to the network:

```bash
hedera-multisig offline execute \
  -b "BASE64_TX" \
  -s "PUBKEY1:SIG1" "PUBKEY2:SIG2" \
  -t 2 \
  --dry-run
```

---

## Token Transfers

### Fungible Token Transfers

Transfer fungible tokens (like stablecoins or utility tokens) from a multi-sig account:

```bash
hedera-multisig transfer token \
  --token 0.0.TOKEN_ID \
  --from 0.0.YOUR_MULTISIG_ACCOUNT \
  --to 0.0.RECIPIENT_ACCOUNT \
  --amount 1000
```

Or using the offline freeze command:

```bash
hedera-multisig offline freeze \
  -t token-transfer \
  --token 0.0.TOKEN_ID \
  -f 0.0.YOUR_MULTISIG_ACCOUNT \
  -T 0.0.RECIPIENT_ACCOUNT \
  -a 1000
```

**Note:** The `--amount` value is in the token's **smallest unit**. If your token has 2 decimals, an amount of `1000` means 10.00 tokens. Check the token's decimal configuration on HashScan.

### NFT Transfers

Transfer a specific NFT by its serial number:

```bash
hedera-multisig transfer nft \
  --token 0.0.NFT_TOKEN_ID \
  --serial 42 \
  --from 0.0.YOUR_MULTISIG_ACCOUNT \
  --to 0.0.RECIPIENT_ACCOUNT
```

Or using offline freeze:

```bash
hedera-multisig offline freeze \
  -t nft-transfer \
  --token 0.0.NFT_TOKEN_ID \
  --serial 42 \
  -f 0.0.YOUR_MULTISIG_ACCOUNT \
  -T 0.0.RECIPIENT_ACCOUNT
```

After freezing, the signing and execution process is identical to HBAR transfers: decode, verify, sign, collect, execute.

---

## Token Association

On Hedera, an account must **associate** with a token before it can receive that token. This is a security feature that prevents accounts from being spammed with unwanted tokens.

### Associate Tokens

Associate one or more tokens with a multi-sig account:

```bash
hedera-multisig token associate \
  --account 0.0.YOUR_MULTISIG_ACCOUNT \
  --tokens 0.0.TOKEN_1
```

Associate multiple tokens at once:

```bash
hedera-multisig token associate \
  --account 0.0.YOUR_MULTISIG_ACCOUNT \
  --tokens 0.0.TOKEN_1,0.0.TOKEN_2,0.0.TOKEN_3
```

Or using offline freeze:

```bash
hedera-multisig offline freeze \
  -t token-associate \
  --account 0.0.YOUR_MULTISIG_ACCOUNT \
  --tokens 0.0.TOKEN_1,0.0.TOKEN_2
```

### Dissociate Tokens

Remove a token association (the token balance must be zero):

```bash
hedera-multisig token dissociate \
  --account 0.0.YOUR_MULTISIG_ACCOUNT \
  --tokens 0.0.TOKEN_1
```

Or using offline freeze:

```bash
hedera-multisig offline freeze \
  -t token-dissociate \
  --account 0.0.YOUR_MULTISIG_ACCOUNT \
  --tokens 0.0.TOKEN_1
```

All token association transactions go through the same multi-sig workflow: freeze, distribute to signers, collect signatures, execute.

---

## Smart Contract Calls

Execute smart contract functions from a multi-sig account.

### With ABI File (Recommended)

If you have the contract's ABI (Application Binary Interface) file, the CLI can automatically encode your function call:

```bash
hedera-multisig offline freeze \
  -t contract-execute \
  -c 0.0.CONTRACT_ID \
  --abi ./contract-abi.json \
  --function transfer \
  --args "0.0.5678,1000"
```

| Option | Description |
|--------|-------------|
| `-c, --contract` | The contract's account ID on Hedera |
| `--abi` | Path to the ABI JSON file for the contract |
| `--function` | Name of the function to call |
| `--args` | Comma-separated function arguments |
| `-g, --gas` | Gas limit (default: 100,000) |

**Why ABI matters for multi-sig:** When you include the ABI file, every signer can independently decode and verify exactly what the smart contract call will do. Without the ABI, signers see only raw hex data and must trust the coordinator's description.

### With Raw Hex Data

If you have pre-encoded function call data:

```bash
hedera-multisig offline freeze \
  -t contract-execute \
  -c 0.0.CONTRACT_ID \
  -d "0xa9059cbb000000000000000000000000..." \
  -g 150000
```

### Decoding Contract Calls

When reviewing a frozen smart contract transaction, signers can decode the call data using the ABI:

```bash
hedera-multisig offline decode \
  -b "BASE64_TX" \
  --abi ./contract-abi.json
```

This shows the function name, parameter names, and values -- allowing signers to verify the call before signing.

---

## Scheduled Transactions

For teams working across time zones or situations where the 120-second signing window is too tight, Hedera's **scheduled transactions** allow signing over hours or days.

### How Scheduled Transactions Work

1. A coordinator wraps the transaction in a `ScheduleCreateTransaction` and submits it to the Hedera network
2. The scheduled transaction lives on-chain with a unique **Schedule ID**
3. Each signer independently signs the schedule at their convenience using `ScheduleSignTransaction`
4. When the signature threshold is met, the Hedera network **automatically executes** the transaction
5. No coordinator needs to be online for execution

### Step 1: Freeze the Inner Transaction

First, create the transaction you want to schedule:

```bash
hedera-multisig offline freeze \
  -t transfer \
  -f 0.0.YOUR_MULTISIG_ACCOUNT \
  -T 0.0.RECIPIENT \
  -a 500 \
  --raw
```

The `--raw` flag outputs only the base64 string, which is convenient for piping.

### Step 2: Create the Schedule

Wrap the frozen transaction in a schedule:

```bash
hedera-multisig schedule create \
  -b "BASE64_FROZEN_TX" \
  --memo "Q1 vendor payment"
```

The output includes the **Schedule ID** (e.g., `0.0.98765`). Share this with all signers.

### Step 3: Each Signer Signs the Schedule

Each signer independently signs the scheduled transaction:

```bash
hedera-multisig schedule sign \
  --schedule-id 0.0.98765 \
  --key-file my-keys.encrypted \
  --passphrase "my-passphrase"
```

Signers can do this at any time before the schedule expires. There is no 120-second pressure.

### Step 4: Check Status

Monitor how many signatures have been collected:

```bash
hedera-multisig schedule status --schedule-id 0.0.98765
```

This shows:
- Whether the transaction is pending, executed, or deleted
- Who has signed so far
- When the schedule expires

```bash
# JSON output for scripting
hedera-multisig schedule status --schedule-id 0.0.98765 --json
```

### When to Use Scheduled vs. Real-Time Signing

| Scenario | Recommended Approach |
|----------|---------------------|
| All signers are available now | Real-time (server/participant) |
| Signers in different time zones | **Scheduled** |
| High-value transaction needing careful review | **Scheduled** |
| Routine recurring payments | Either (scheduled is more relaxed) |
| Emergency transaction | Real-time (fastest) |

---

## Using the Web App

The Hedera MultiSig dApp provides a browser-based interface for joining signing sessions. It works alongside the CLI server.

### Joining a Session

1. A coordinator starts a server and shares the **connection string** (starts with `hmsc:...`)
2. Open the dApp at `http://localhost:3000/join` (or the deployed URL)
3. Paste the connection string
4. Connect your wallet (HashPack, Blade, or other WalletConnect-compatible wallets)

### Reviewing Transactions

When the coordinator injects a transaction, you will see:

- **VERIFIED data** (shown with a green indicator) -- information that is cryptographically proven from the frozen transaction bytes (transaction type, amounts, accounts)
- **UNVERIFIED data** (shown with a yellow indicator) -- labels and descriptions added by the coordinator that cannot be cryptographically verified

**Always base your signing decision on the VERIFIED data.** The unverified data is helpful context but could potentially be misleading.

### Signing with a Hardware Wallet

If your wallet supports it (e.g., Ledger via HashPack), signing happens on the hardware device:

1. Review the transaction details in the dApp
2. Click "Approve and Sign"
3. Confirm the transaction on your hardware device
4. The signature is automatically submitted to the session

### Mixed Sessions

CLI participants and web app participants can join the same session. This means some signers can use the dApp with hardware wallets while others use the CLI with encrypted key files.

---

## Security Best Practices

### Key Storage

| Method | Security Level | Best For |
|--------|---------------|----------|
| **Encrypted key file** (`keys create`) | High | Daily operations |
| **Hardware wallet** (Ledger via HashPack) | Very High | Regular signing |
| **Air-gapped machine** | Maximum | High-value treasury |
| **Environment variable** | Medium | Development/testing only |
| **Plaintext on disk** | None -- never do this | -- |

Create an encrypted key file:

```bash
hedera-multisig keys create --output my-treasury-key.encrypted
```

Test that it works:

```bash
hedera-multisig keys test my-treasury-key.encrypted
```

### Transaction Verification

Before signing any transaction:

1. **Decode it first** -- always use `offline decode` to see what you are signing
2. **Verify the checksum** -- the checksum confirms the transaction was not altered in transit
3. **Check amounts and recipients** -- confirm the destination account and amount match what you expect
4. **Cross-reference out of band** -- verify with the coordinator through a separate channel (phone call, in-person) for high-value transactions
5. **Understand VERIFIED vs. UNVERIFIED** -- in the dApp, only trust cryptographically verified data for your signing decision

### Operational Security

- **Never share private keys** -- share only public keys and signature tuples
- **Use separate channels** -- send the transaction bytes and checksum through different communication channels
- **Set appropriate thresholds** -- higher is more secure but requires more coordination
- **Rotate keys periodically** -- use `account-update` to add/remove signers as team members change
- **Keep encrypted file backups** -- losing an encrypted key file is equivalent to losing the key
- **Store passphrases in a password manager** -- the passphrase for encrypted key files must be at least 12 characters
- **Audit all transactions** -- review the audit trail regularly

### What Not to Do

- Never type a private key into a website you did not deploy yourself
- Never send private keys over email, Slack, or any messaging platform
- Never store unencrypted private keys in files, environment variables, or version control on production systems
- Never sign a transaction you have not personally decoded and verified
- Never use `--key` flag in production (it exposes the key in process lists and shell history)

---

## Audit Trail

### Transaction Logs

When running with `--verbose`, the server logs all session events:

- Participant connections and disconnections
- Transaction injections
- Signature submissions
- Threshold met events
- Transaction execution results

### Session File

While a server is running, it writes a `.multisig-session.json` file in the working directory containing session metadata:

```json
{
  "sessionId": "a1b2c3d4-e5f6-...",
  "network": "testnet",
  "threshold": 2,
  "expectedParticipants": 3,
  "createdAt": 1710000000000,
  "expiresAt": 1710001800000
}
```

### HashScan Verification

Every executed transaction is permanently recorded on the Hedera ledger. View transaction details on HashScan:

- **Testnet:** `https://hashscan.io/testnet/transaction/TRANSACTION_ID`
- **Mainnet:** `https://hashscan.io/mainnet/transaction/TRANSACTION_ID`

HashScan shows:
- All signers who signed the transaction
- Exact amounts and recipients
- Timestamp and consensus information
- Transaction fees paid

### Exporting Logs

Use the `--log-file` and `--export-logs` flags to save server logs to a file for compliance:

```bash
hedera-multisig server \
  -t 2 -k "key1,key2,key3" \
  --log-file treasury-server.log \
  --export-logs ./audit/
```

### JSON Output for Record-Keeping

All commands support `--json` output for structured logging and integration with audit systems:

```bash
hedera-multisig transfer hbar \
  --from 0.0.1234 \
  --to 0.0.5678 \
  --amount 100 \
  --json > transaction-record.json
```

```bash
hedera-multisig schedule status \
  --schedule-id 0.0.98765 \
  --json > schedule-status.json
```

---

## Quick Reference: All Transaction Types

| Transaction Type | Offline Freeze Command | Transfer/Token Command |
|-----------------|----------------------|----------------------|
| HBAR transfer | `offline freeze -t transfer` | `transfer hbar` |
| Fungible token transfer | `offline freeze -t token-transfer` | `transfer token` |
| NFT transfer | `offline freeze -t nft-transfer` | `transfer nft` |
| Token associate | `offline freeze -t token-associate` | `token associate` |
| Token dissociate | `offline freeze -t token-dissociate` | `token dissociate` |
| Account key update | `offline freeze -t account-update` | -- |
| Smart contract call | `offline freeze -t contract-execute` | -- |
| Token create | `offline freeze -t token-create` | -- |
| Token mint | `offline freeze -t token-mint` | -- |
| Token burn | `offline freeze -t token-burn` | -- |

---

## Related Documentation

- [Getting Started](./GETTING_STARTED.md) -- Installation and first transaction
- [Coordinator Guide](./COORDINATOR_GUIDE.md) -- Managing signing sessions
- [Offline Signing Guide](./OFFLINE_SIGNING_GUIDE.md) -- Air-gapped signing workflow
- [Security Architecture](./SECURITY_ARCHITECTURE.md) -- Technical security model
- [Agent Integration](./AGENT_INTEGRATION.md) -- Automated signing with policy engines
