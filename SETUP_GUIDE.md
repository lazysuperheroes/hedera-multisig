# Team Setup Guide - Hedera Multi-Signature

Complete step-by-step guide for setting up multi-signature accounts and workflows for your team.

## Table of Contents

1. [Overview](#overview)
2. [Day 1: Team Preparation](#day-1-team-preparation)
3. [Day 2: Account Setup](#day-2-account-setup)
4. [Day 3: First Transaction](#day-3-first-transaction)
5. [Ongoing Operations](#ongoing-operations)
6. [Workflows Comparison](#workflows-comparison)
7. [Best Practices](#best-practices)

---

## Overview

### What You'll Accomplish

By the end of this guide, your team will have:

✅ Multi-signature Hedera account configured
✅ All team members with keys and access
✅ Tested transaction workflow
✅ Documentation for ongoing operations

### Prerequisites

**For All Team Members:**
- Node.js v16+ installed
- Access to terminal/command line
- Secure place to store private keys

**For Coordinator:**
- Existing Hedera account (to convert to multi-sig)
- Testnet HBAR for transaction fees
- Ability to share files with team securely

### Time Required

- **Day 1:** 30-60 minutes (key collection)
- **Day 2:** 15-30 minutes (account setup)
- **Day 3:** 30-45 minutes (testing)

---

## Day 1: Team Preparation

### Step 1.1: Install the Library

**Everyone runs:**

```bash
npm install @lazysuperheroes/hedera-multisig
```

Or clone the repository:

```bash
git clone https://github.com/lazysuperheroes/hedera-multisig.git
cd hedera-multisig
npm install
```

### Step 1.2: Coordinator Setup

**Coordinator runs:**

```bash
node scripts/collect-team-keys.js --mode coordinator
```

**Follow the prompts:**

```
Team/Project name: Acme Corp Treasury
Number of participants: 3

--- Participant 1 ---
Name/Label: Alice (CFO)
Email (optional): alice@acme.com

Options:
  1. Paste public key
  2. Generate new key pair for participant
  3. Load from file

Method (1/2/3) [1]: 2

✅ Key pair generated!

⚠️  SHARE THESE WITH PARTICIPANT:

Private Key:
302e020100300506032b657004220420...

Public Key:
302a300506032b6570032100...
```

**Repeat for all participants.**

**Files created:**
- `team-keys-acme-corp-treasury.json` - Team configuration
- `team-private-keys-acme-corp-treasury.json` - Private keys (if generated)
- `public-keys.txt` - List of public keys

### Step 1.3: Team Member Key Generation

**Each team member runs:**

```bash
node scripts/collect-team-keys.js --mode participant
```

**Follow the prompts:**

```
Your name: Bob (CTO)
Your email (optional): bob@acme.com

Do you have an existing Hedera key?
  1. Yes - I have a private key
  2. No - Generate new key for me

Choice (1 or 2) [2]: 2

✅ New key pair generated!

⚠️  SAVE YOUR PRIVATE KEY SECURELY:

Private Key (DER):
302e020100300506032b657004220420...

Public Key (DER):
302a300506032b6570032100...
```

**Files created:**
- `participant-bob-cto.json` - Bob's keys (SECURE!)
- `bob-cto-public.txt` - Bob's public key (share this)

### Step 1.4: Share Public Keys

**Team members send** their public key files to coordinator:

- Email `bob-cto-public.txt` to coordinator
- Or copy/paste the public key text
- **NEVER share the private key!**

### Step 1.5: Coordinator Compiles Keys

**Coordinator adds** received public keys to the team configuration.

**Manual addition:**

```bash
# Edit team-keys-acme-corp-treasury.json
# Add public keys to the "publicKeys" array
```

**Or re-run collection:**

```bash
node scripts/collect-team-keys.js --mode coordinator
```

And choose "Paste public key" for each participant.

---

## Day 2: Account Setup

### Step 2.1: Prepare Account

**Coordinator needs:**
- Hedera account ID (e.g., 0.0.12345)
- Current private key for that account
- Access to testnet or mainnet

**Test balance:**

```bash
# Set environment variables
export ACCOUNT_ID=0.0.12345
export ACCOUNT_KEY=302e020100300506032b657004220420...

# Verify account has funds (testnet)
# Visit: https://hashscan.io/testnet/account/0.0.12345
```

### Step 2.2: Run Multi-Sig Setup

**Coordinator runs:**

```bash
ACCOUNT_ID=0.0.12345 ACCOUNT_KEY=xxx node scripts/setup-multisig-account.js
```

**Follow the prompts:**

```
✅ Using account from environment variables

Network (testnet/mainnet) [testnet]: testnet

✅ Connected to Hedera testnet

Fetching current account information...

Current Account Information:
  Account ID: 0.0.12345
  Balance: 100.00000000 ℏ
  Current Key: 302a300506032b657...

═══════════════════════════════════════════════════════════
COLLECT PUBLIC KEYS FOR MULTI-SIG
═══════════════════════════════════════════════════════════

Load method (manual/file) [manual]: file
File path [./public-keys.txt]: ./public-keys.txt

✅ Loaded 3 keys from file

Public Keys:
  1. 302a300506032b657...
  2. 302a300506032b657...
  3. 302a300506032b657...

Signature threshold (1-3) [2]: 2

✅ Threshold set to 2 of 3

═══════════════════════════════════════════════════════════
MULTI-SIG CONFIGURATION
═══════════════════════════════════════════════════════════
Account: 0.0.12345
Keys: 3
Threshold: 2 of 3 signatures required
═══════════════════════════════════════════════════════════

Proceed with account update? (Y/n): Y

⏳ Updating account to multi-sig...

✅ Account successfully updated to multi-sig!

Transaction Details:
  Transaction ID: 0.0.12345@1234567890.123456789
  Status: SUCCESS
```

### Step 2.3: Verify Setup

**Account is now multi-sig!**

```
✅ Account verified:

New Account Configuration:
  Account ID: 0.0.12345
  Key Type: KeyList (Multi-Sig)
  Keys: 3
  Threshold: 2

Save configuration to file? (Y/n): Y

✅ Configuration saved to: multisig-config-0-0-12345.json
```

### Step 2.4: Document Configuration

**Save these files securely:**

- `multisig-config-0-0-12345.json` - Account configuration
- `team-keys-acme-corp-treasury.json` - Team member list
- `public-keys.txt` - Public keys list

**Share with team:**
- Account ID: 0.0.12345
- Threshold: 2 of 3
- Network: testnet
- Member list

---

## Day 3: First Transaction

### Step 3.1: Coordinator Starts Session

**Coordinator runs:**

```bash
node cli/server.js \
  --threshold 2 \
  --keys "key1,key2,key3" \
  --participants 3 \
  --network testnet
```

**Replace keys** with actual public keys from `public-keys.txt`.

**Output:**

```
🚀 Starting Hedera MultiSig Server

Network: testnet
Threshold: 2 of 3
Expected Participants: 3
Session Timeout: 30 minutes

✅ Pre-Session Created Successfully!

SESSION INFORMATION
Session ID: abc123def456
PIN: 123456
Public URL: wss://abc.ngrok.io
Local URL: ws://localhost:3000
Expires: 2025-01-15 3:30 PM

SHARE WITH PARTICIPANTS:

Server URL: wss://abc.ngrok.io
Session ID: abc123def456
PIN: 123456

Participants should run:
  node cli/participant.js --url "wss://abc.ngrok.io" --session "abc123def456" --pin "123456"

⏳ Waiting for participants to connect and become ready...
```

### Step 3.2: Share Session Credentials

**Coordinator shares via secure channel:**

- Server URL: `wss://abc.ngrok.io`
- Session ID: `abc123def456`
- PIN: `123456`

**Methods:**
- Slack/Teams message
- Email
- Encrypted chat

### Step 3.3: Participants Connect

**Each team member runs:**

```bash
node cli/participant.js \
  --url "wss://abc.ngrok.io" \
  --session "abc123def456" \
  --pin "123456"
```

**Participant experience:**

```
👥 Hedera MultiSig Participant

Connecting to session...

✅ Connected successfully!

Session Information:
  Session ID: abc123def456
  Status: waiting
  Threshold: 2 signatures required
  Expires: 2025-01-15 3:30 PM

LOAD PRIVATE KEY

⚠️  Your private key will be loaded into memory LOCALLY.
⚠️  It will NEVER be transmitted over the network.

Enter your private key (hex): ****************************

✅ Private key loaded
   Public Key: 302a300506032b657...

✅ READY - Waiting for transaction injection...

Session will remain open for: 28 minutes
```

### Step 3.4: Inject Transaction

**Coordinator sees:**

```
✅ Participant connected: alice-cfo
   Total connected: 1/3

✅ Participant READY: alice-cfo
   Ready: 1/3

✅ Participant connected: bob-cto
   Total connected: 2/3

✅ Participant READY: bob-cto
   Ready: 2/3

✅ Participant connected: carol-coo
   Total connected: 3/3

✅ Participant READY: carol-coo
   Ready: 3/3

🎉 ALL PARTICIPANTS READY!
   You can now inject a transaction for signing.

When participants are ready, press ENTER to inject a transaction...
```

**Coordinator presses ENTER**, then transaction is created and injected.

### Step 3.5: Participants Review

**Each participant sees:**

```
🔔 Transaction received for review!

╔════════════════════════════════════════════════════════════════╗
║           TRANSACTION REVIEW - MANUAL APPROVAL REQUIRED        ║
╚════════════════════════════════════════════════════════════════╝

✅ VERIFIED TRANSACTION DATA (from cryptographic bytes):
────────────────────────────────────────────────────────────────
Transaction Type: TransferTransaction
Transaction ID:   0.0.12345@1234567890.123456789
Checksum:         a3b2c1d4e5f6g7h8

Amounts:
  1. 1000 tinybars

Accounts Involved:
  1. 0.0.12345
  2. 0.0.456

────────────────────────────────────────────────────────────────

⚠️  UNVERIFIED METADATA (coordinator-provided - advisory only):
────────────────────────────────────────────────────────────────
⚠️  WARNING: This information is NOT cryptographically verified.
⚠️  Make your decision based on VERIFIED data above only.
────────────────────────────────────────────────────────────────

Description: Transfer 1000 tinybars to account 0.0.456

Amount (unverified): 1000
⚠️  This value is provided by the coordinator and not verified

Recipient (unverified): 0.0.456
⚠️  This value is provided by the coordinator and not verified

════════════════════════════════════════════════════════════════
IMPORTANT: Review the VERIFIED data carefully.
Only approve if you understand and agree with this transaction.
════════════════════════════════════════════════════════════════

Do you approve this transaction?
Type "YES" (all caps) to approve, anything else to reject.
════════════════════════════════════════════════════════════════

Your decision: YES

✍️  Signing transaction...

✅ Transaction signed and signature submitted
```

### Step 3.6: Transaction Execution

**When threshold (2) is met:**

**Coordinator sees:**

```
✅ Signature received from alice-cfo
   Signatures: 1/2

✅ Signature received from bob-cto
   Signatures: 2/2

🎉 THRESHOLD MET!
   2 signatures collected.

Execute transaction now? (Y/n): Y

✅ Transaction executed successfully!
   Transaction ID: 0.0.12345@1234567890.123456789
   Status: SUCCESS
```

**All participants see:**

```
✅ Signature threshold met! Transaction will be executed...

✅ TRANSACTION EXECUTED SUCCESSFULLY!
   Transaction ID: 0.0.12345@1234567890.123456789
   Status: SUCCESS

Disconnecting...
```

### Step 3.7: Verify on HashScan

**Visit:** https://hashscan.io/testnet/transaction/0.0.12345@1234567890.123456789

**Verify:**
- Transaction status: SUCCESS
- Multiple signatures present
- Correct amount transferred
- Correct recipient

---

## Ongoing Operations

### Regular Transaction Workflow

**For routine transactions:**

1. **Coordinator creates session** (takes 1 minute)
2. **Team connects** (takes 2-3 minutes)
3. **Coordinator injects transaction** (immediate)
4. **Team reviews and approves** (takes 1-2 minutes per person)
5. **Transaction executes** (automatic when threshold met)

**Total time:** ~5-10 minutes

### Best Practices

**Security:**
- ✅ Always verify transaction details before approving
- ✅ Check amounts and recipients match expectations
- ✅ Question suspicious metadata warnings
- ✅ Store private keys securely (encrypted storage)
- ✅ Use separate keys for different accounts/purposes

**Operations:**
- ✅ Document all transactions in team log
- ✅ Use descriptive transaction memos
- ✅ Test on testnet before mainnet
- ✅ Keep threshold reasonable (2-of-3, 3-of-5)
- ✅ Have backup signers available

**Team Coordination:**
- ✅ Schedule signing sessions in advance
- ✅ Share session credentials securely
- ✅ Confirm all signers are available
- ✅ Set expectations on response time
- ✅ Have contingency plan if signers unavailable

---

## CLI Tools & Account Manager

### Unified Account Manager

**Quick access to all tools:**

```bash
npm run account-manager
```

This launches an interactive menu with all account management operations:

```
╔═══════════════════════════════════════════════════════════╗
║      HEDERA MULTI-SIG ACCOUNT MANAGER                     ║
╚═══════════════════════════════════════════════════════════╝

Select an operation:

📋 Key Management:
  1. Generate Key Pairs
     Generate new ED25519 key pairs with optional BIP39 mnemonic

🏦 Account Setup:
  2. Create New Multi-Sig Account
     Create a brand new Hedera account with multi-sig configuration
  3. Convert to Multi-Sig
     Convert an existing single-sig account to multi-sig

🔄 Account Management:
  4. Rotate Multi-Sig Keys
     Update keys on an existing multi-sig account
  5. Revert to Single-Sig
     Convert a multi-sig account back to single-sig

📝 Transaction Tools:
  6. Inspect Transaction
     Decode and display transaction bytes without signing
  7. Sign Transaction
     Sign a frozen transaction with private keys (offline)

👥 Team Coordination:
  8. Collect Team Keys
     Collect public keys from team members
```

### Individual CLI Tools

All tools can also be run directly:

#### Key Generation

```bash
# Interactive mode
npm run generate-keys

# Generate 3 key pairs with mnemonic
npm run generate-keys -- --count 3

# Generate without mnemonic
npm run generate-keys -- --no-mnemonic
```

**Features:**
- BIP39 24-word mnemonic generation
- Direct ED25519 generation
- Batch key generation (up to 10 keys)
- Timestamped file output with security warnings

#### Create New Multi-Sig Account

```bash
# Interactive mode
npm run create-account

# With environment variables
OPERATOR_ID=0.0.XXX OPERATOR_KEY=xxx INITIAL_BALANCE=100 npm run create-account
```

**Creates:**
- Brand new Hedera account
- Multi-sig from the start (no conversion needed)
- Configurable initial balance
- Configuration file saved

#### Convert to Multi-Sig

```bash
# Interactive mode
npm run setup-multisig

# With environment variables
ACCOUNT_ID=0.0.XXX ACCOUNT_KEY=xxx npm run setup-multisig
```

**Converts:**
- Existing single-sig account → multi-sig
- Requires current account private key
- Updates key structure on-chain

#### Rotate Multi-Sig Keys

```bash
# Interactive mode
npm run update-keys

# With environment variables
ACCOUNT_ID=0.0.XXX OPERATOR_ID=0.0.YYY OPERATOR_KEY=xxx npm run update-keys
```

**Updates:**
- Multi-sig → new multi-sig configuration
- Requires signatures from CURRENT key holders
- Supports networked or offline signature collection

#### Revert to Single-Sig

```bash
# Interactive mode
npm run revert-multisig

# With environment variables
ACCOUNT_ID=0.0.XXX npm run revert-multisig
```

**Reverts:**
- Multi-sig → single-sig account
- Requires M-of-N signatures from current multi-sig
- Generates new single key or uses existing

#### Inspect Transaction

```bash
# Interactive mode
npm run query-tx

# From file
npm run query-tx -- --file transaction.json

# From base64 string
npm run query-tx -- --tx <base64-encoded-bytes>
```

**Displays:**
- Transaction type and details
- Amounts and accounts
- Current signatures
- Transaction checksum
- NO signing (read-only inspection)

#### Sign Transaction Offline

```bash
# Interactive mode
npm run sign-tx

# With single key
npm run sign-tx -- --file transaction.json --key <private-key>

# With multiple keys
npm run sign-tx -- --file transaction.json --keys <key1,key2,key3>

# Specify output file
npm run sign-tx -- --file tx.json --key <key> --output signed.json
```

**Features:**
- Air-gapped signing support
- Batch signing with multiple keys
- Signature count tracking
- Preserves metadata from input file

### Integration with Networked Workflow

**Best Practice Workflow:**

1. **Account Setup:** Use CLI tools
   ```bash
   npm run generate-keys    # Each team member
   npm run collect-keys     # Coordinator
   npm run create-account   # Coordinator
   ```

2. **Regular Transactions:** Use networked workflow
   ```bash
   # Coordinator
   npm run multisig-server -- -t 2 -k "key1,key2,key3"

   # Participants
   npm run multisig-client -- --url <url> --session <id> --pin <pin>
   ```

3. **Offline Signing:** Use CLI tools when needed
   ```bash
   npm run sign-tx          # Air-gapped signing
   npm run query-tx         # Verify before signing
   ```

4. **Account Management:** Use CLI tools
   ```bash
   npm run update-keys      # Key rotation
   npm run revert-multisig  # Emergency revert
   ```

**See also:** `examples/complete-lifecycle-workflow.js` for a comprehensive demonstration.

---

## Workflows Comparison

### Interactive Workflow (Local)
**Use when:** All signers in one location with keys available

```bash
node examples/interactive-workflow.js
```

**Pros:**
- Fastest (< 2 minutes)
- Simple setup
- No network required

**Cons:**
- All signers must be present
- Keys must be on same machine

### Offline Workflow (Air-Gapped)
**Use when:** Maximum security needed, signers in different locations

```bash
# 1. Freeze and export
node examples/offline-workflow.js

# 2. Collect signatures (email, USB)
# 3. Import and execute
```

**Pros:**
- Most secure
- Air-gapped signing possible
- Flexible timing

**Cons:**
- Slowest (hours to days)
- Manual coordination required
- Complex file management

### Networked Workflow (Remote)
**Use when:** Signers are remote, real-time signing needed

```bash
# Coordinator
node cli/server.js -t 2 -k "key1,key2,key3"

# Participants
node cli/participant.js --url <url> --session <id> --pin <pin>
```

**Pros:**
- Fast (5-10 minutes)
- Remote participants
- Real-time review
- Audit trail

**Cons:**
- Requires internet
- Needs coordination
- All signers must be online

### Web-Based Signing (WalletConnect) - NEW!
**Use when:** Signers want to use browser wallets or hardware wallets (Ledger)

```bash
# Coordinator (same as networked workflow)
node cli/server.js -t 2 -k "key1,key2,key3"

# Web Participants
# 1. Open deployed dApp in browser
# 2. Click "Join Signing Session"
# 3. Enter session URL, ID, PIN
# 4. Connect wallet (HashPack/Blade)
# 5. Review and sign in wallet
```

**Pros:**
- Hardware wallet support (Ledger, Trezor via wallet apps)
- No key files needed (keys stay in wallet)
- Mobile-friendly (works on phones/tablets)
- Browser-based (no software installation)
- Mixed sessions (CLI + Web participants together)
- Same security model (VERIFIED transaction review)

**Cons:**
- Requires deployed dApp (or local dev server)
- Need WalletConnect-compatible wallet
- Wallet must be on same network (testnet/mainnet)

**Setup Instructions:**
- **User Guide**: See `docs/WALLETCONNECT.md` for complete setup
- **Testing**: See `dapp/QUICKSTART.md` for 5-minute test
- **Deployment**: See `dapp/DEPLOYMENT.md` for production deployment

**Example: Mixed Session (CLI + Web)**

```bash
# Coordinator creates session with 4 eligible keys
# - 2 CLI participants (file-based keys)
# - 2 Web participants (wallet keys)

node scripts/start-test-server.js

# When prompted, enter 4 public keys:
# 1. CLI participant key
# 2. CLI participant key
# 3. Web participant wallet key (from HashPack)
# 4. Web participant wallet key (from Ledger via HashPack)

# CLI participants join via terminal:
node cli/participant.js --url wss://... --session abc123 --pin 123456 --key cli-key-1.txt

# Web participants join via browser:
# - Open dApp URL
# - Click "Join Signing Session"
# - Connect wallet and complete flow

# All 4 can participate, need 2 signatures (threshold)
# Server doesn't care if signature came from CLI or Web!
```

---

## Troubleshooting

### Common Issues

**Issue:** "Authentication failed"
**Solution:** Check PIN is correct, session hasn't expired

**Issue:** "Cannot inject transaction"
**Solution:** Session must be in 'waiting' state, cannot inject twice

**Issue:** "Threshold not met"
**Solution:** Need more signatures, check how many are connected/approved

**Issue:** "Transaction expired"
**Solution:** Transaction took > 120 seconds from injection to execution

**Issue:** "Tunnel connection failed"
**Solution:** Set NGROK_AUTH_TOKEN or use --no-tunnel for local-only

### Getting Help

- **Documentation:** See `README.md`, `TESTING.md`
- **Examples:** Check `examples/` directory
- **Issues:** https://github.com/lazysuperheroes/hedera-multisig/issues
- **Test:** Run `npm test` to verify setup

---

## Next Steps

**You're ready to use multi-sig!**

- Review `examples/` for code samples
- See `TESTING.md` for testing scenarios
- Check `server/README.md` for protocol details
- Explore smart contract examples (next section)

---

## Advanced: Smart Contract Multi-Sig

See `examples/smart-contract-multisig.js` for deploying and calling smart contracts with multi-sig accounts.

**Capabilities:**
- Deploy contracts with multi-sig
- Call contract functions with multi-sig
- Update contract bytecode with multi-sig
- Full ABI support for parameter decoding

---

**Congratulations!** Your team is now set up for secure multi-signature operations on Hedera.
