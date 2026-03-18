# Getting Started with Hedera MultiSig

> **Your first multi-signature transaction in 5 minutes.**
>
> This guide walks you through installation, setup, and signing your first
> multi-sig transaction on the Hedera testnet. No blockchain experience required.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Install](#install)
3. [Set Up Your Environment](#set-up-your-environment)
4. [Quick Test: Sign Your First Multi-Sig Transaction](#quick-test-sign-your-first-multi-sig-transaction)
5. [Next Steps](#next-steps)
6. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, make sure you have the following:

| Requirement | Details |
|-------------|---------|
| **Node.js** | Version 18 or higher. Check with `node --version`. Download from [nodejs.org](https://nodejs.org/). |
| **Hedera Testnet Account** | Free account from the [Hedera Portal](https://portal.hedera.com/). You will receive an Account ID (like `0.0.12345`) and a private key. |
| **npm** | Comes with Node.js. Check with `npm --version`. |

### Creating a Hedera Testnet Account

1. Go to [portal.hedera.com](https://portal.hedera.com/)
2. Click "Register" and create a free account
3. Once logged in, you will see your **Account ID** (e.g., `0.0.4515913`) and **DER-encoded Private Key**
4. The portal automatically funds your testnet account with test HBAR (not real money)
5. Save both your Account ID and Private Key -- you will need them in the next step

---

## Install

### Option A: Install globally (recommended for CLI usage)

```bash
npm install -g @lazysuperheroes/hedera-multisig
```

After installation, the `hedera-multisig` command is available system-wide.

### Option B: Use without installing (via npx)

```bash
npx @lazysuperheroes/hedera-multisig --help
```

### Option C: Clone the repository (for development or local use)

```bash
git clone https://github.com/lazysuperheroes/hedera-multisig.git
cd hedera-multisig
npm install
```

When using the cloned repository, replace `hedera-multisig` with `node cli/index.js` in all commands below.

### Verify installation

```bash
hedera-multisig --version
hedera-multisig --help
```

You should see the version number and a list of available commands.

---

## Set Up Your Environment

Create a `.env` file in your working directory with your Hedera credentials:

```bash
# .env
OPERATOR_ID=0.0.YOUR_ACCOUNT_ID
OPERATOR_KEY=YOUR_PRIVATE_KEY
HEDERA_NETWORK=testnet
```

Replace the placeholder values with your actual testnet credentials from the Hedera Portal.

**Security note:** Never commit your `.env` file to version control. Add `.env` to your `.gitignore` file.

| Variable | Description | Example |
|----------|-------------|---------|
| `OPERATOR_ID` | Your Hedera account ID | `0.0.4515913` |
| `OPERATOR_KEY` | Your DER-encoded private key | `302e020100300506...` |
| `HEDERA_NETWORK` | Which Hedera network to use | `testnet` or `mainnet` |

---

## Quick Test: Sign Your First Multi-Sig Transaction

This walkthrough creates a simple 2-of-2 multi-sig HBAR transfer on testnet. You will play all roles (coordinator and both signers) from a single machine.

### Step 1: Generate Two Key Pairs

Multi-sig requires multiple keys. Generate two key pairs for testing:

```bash
node scripts/generate-keys.js --count 2 --no-mnemonic
```

Or use the CLI key management:

```bash
hedera-multisig keys create
```

The tool will prompt you to enter private keys. Follow the on-screen instructions. You will get output like:

```
Key Pair 1:
  Private Key: 302e020100300506032b657004220420...
  Public Key:  302a300506032b6570032100abc123...

Key Pair 2:
  Private Key: 302e020100300506032b657004220420...
  Public Key:  302a300506032b6570032100def456...
```

Save both key pairs. You will need the **public keys** for the server and the **private keys** for signing.

### Step 2: Start a Signing Server

Open a terminal and start the multi-sig server with a threshold of 2 (both keys must sign):

```bash
hedera-multisig server -t 2 -k "PUBLIC_KEY_1,PUBLIC_KEY_2" --port 3001 --no-tunnel
```

Replace `PUBLIC_KEY_1` and `PUBLIC_KEY_2` with the actual public keys from Step 1.

The server outputs critical session information:

```
Session ID:        a1b2c3d4-e5f6-...
PIN:               ABC123
Coordinator Token: XYZ789...
Agent API Key:     agent_key_...
Connection String: hmsc:eyJz...
```

**What each credential is for:**

| Credential | Who needs it | Purpose |
|------------|-------------|---------|
| **Session ID** | Participants | Identifies which session to join |
| **PIN** | Participants | Authenticates participants to the session |
| **Coordinator Token** | You (the coordinator) | Elevated privileges (inject transactions, manage session) |
| **Agent API Key** | Automated agents only | Programmatic access for bots and AI agents |
| **Connection String** | Participants | All-in-one string that encodes server URL, session ID, and PIN |

Leave this terminal running.

### Step 3: Join as a Participant

Open a **second terminal** and connect as a participant using the connection string:

```bash
hedera-multisig participant --connect hmsc:eyJz... -f keys.encrypted
```

Or join using individual parameters:

```bash
hedera-multisig participant -u ws://localhost:3001 -s SESSION_ID -p PIN
```

The participant command will prompt you to load your private key. Choose one of the options:

1. **Load from encrypted file** (most secure)
2. **Enter hex key and save as encrypted file**
3. **Enter hex key for this session only**

For testing, option 3 is fastest -- paste one of your private keys from Step 1.

Once loaded, the participant marks itself as "ready" and waits for a transaction.

### Step 4: Open the Web App (Alternative to CLI)

If you prefer a browser interface, start the dApp in a third terminal:

```bash
cd dapp
npm install
npm run dev
```

Then open [http://localhost:3000/join](http://localhost:3000/join) and paste the connection string to join the session from a browser with a wallet like HashPack.

### Step 5: Create a Test Transfer

In a **third terminal**, create a frozen HBAR transfer transaction:

```bash
hedera-multisig transfer hbar --from 0.0.YOUR_ACCOUNT --to 0.0.ANY_ACCOUNT --amount 1
```

This outputs a **base64-encoded frozen transaction** and a **checksum**. The frozen transaction is what needs to be signed.

For a fully offline workflow, you can also use:

```bash
hedera-multisig offline freeze -t transfer -f 0.0.YOUR_ACCOUNT -T 0.0.ANY_ACCOUNT -a 1
```

### Step 6: Sign with Both Keys

**Signer 1:** Sign the frozen transaction using the first private key:

```bash
hedera-multisig sign
```

The interactive sign command will:
1. Ask you to paste the base64 transaction
2. Optionally verify a checksum
3. Show transaction details for your review
4. Ask for your private key (hidden input)
5. Output a **signature tuple** in the format `publicKey:signatureBase64`

**Signer 2:** Repeat the same process with the second private key.

For non-interactive (scripted) signing:

```bash
hedera-multisig sign --base64 "FROZEN_TX_BASE64" --key-file keys.encrypted --passphrase "your-passphrase" --json
```

### Step 7: Execute the Transaction

Once you have both signature tuples, execute the transaction:

```bash
hedera-multisig offline execute \
  -b "FROZEN_TX_BASE64" \
  -s "PUBKEY1:SIG1" "PUBKEY2:SIG2" \
  -t 2
```

If both signatures are valid, the transaction executes on Hedera and you will see:

```
Transaction ID: 0.0.12345@1234567890.000
Status:         SUCCESS
Signatures:     2

View on HashScan:
  https://hashscan.io/testnet/transaction/0.0.12345@1234567890.000
```

Congratulations -- you just completed your first multi-sig transaction.

---

## Next Steps

Now that you have the basics working, explore these guides based on your role:

| Guide | Who it is for | What you will learn |
|-------|--------------|---------------------|
| [Treasury Guide](./TREASURY_GUIDE.md) | Treasury managers, finance teams | HBAR transfers, token operations, scheduled transactions, security practices |
| [Coordinator Guide](./COORDINATOR_GUIDE.md) | Session coordinators, team leads | Server setup, session management, monitoring, working with agents |
| [Agent Integration](./AGENT_INTEGRATION.md) | Developers building automated signing | AgentSigningClient, PolicyEngine, programmatic workflows |
| [Offline Signing Guide](./OFFLINE_SIGNING_GUIDE.md) | High-security environments | Air-gapped signing with maximum key isolation |

---

## Troubleshooting

### "Missing OPERATOR_ID or OPERATOR_KEY environment variables"

Your `.env` file is missing or not in the current directory. Make sure:
- The file is named exactly `.env` (not `.env.txt`)
- It contains both `OPERATOR_ID` and `OPERATOR_KEY`
- You are running commands from the same directory as the `.env` file

### "INVALID_ACCOUNT_ID" or account not found

- Double-check your Account ID format: it should look like `0.0.12345`
- Make sure you are using the correct network (testnet vs mainnet)
- Verify your account exists on [HashScan](https://hashscan.io/testnet)

### "Transaction expired"

Hedera transactions must be signed within **120 seconds** of being frozen. If you see this error:
- Freeze a new transaction and sign it more quickly
- Consider using **scheduled transactions** which remove the 120-second limit (see [Treasury Guide](./TREASURY_GUIDE.md))

### "Wrong key type" or "Invalid private key format"

Hedera supports two key types:
- **ED25519** -- The default. DER-encoded keys start with `302e020100300506032b6570...` (private) or `302a300506032b6570...` (public)
- **ECDSA (secp256k1)** -- EVM-compatible keys. DER-encoded keys start with `3030020100300706...` (private) or `302d300706...` (public)

Make sure you are using the full DER-encoded key, not a raw hex key or mnemonic phrase.

### Connection refused when joining a session

- Verify the server is still running (check the first terminal)
- Check the port matches (`--port 3001` on server, `ws://localhost:3001` when joining)
- If using `--no-tunnel`, both machines must be on the same network
- Try `ws://127.0.0.1:3001` instead of `ws://localhost:3001`

### "Threshold not met" when executing

You need at least as many valid signatures as the threshold. If you set `-t 2`, you need 2 valid signature tuples. Check:
- Both signature tuples are complete (not truncated)
- The signatures were made against the same frozen transaction bytes
- The public keys in the tuples match keys in the multi-sig account

### "INSUFFICIENT_PAYER_BALANCE"

Your operator account does not have enough HBAR to pay the transaction fee. On testnet, you can get more test HBAR from the [Hedera Portal](https://portal.hedera.com/).

---

## Getting Help

- **GitHub Issues:** [github.com/lazysuperheroes/hedera-multisig/issues](https://github.com/lazysuperheroes/hedera-multisig/issues)
- **CLI Help:** Run `hedera-multisig --help` or `hedera-multisig <command> --help` for any command
- **Hedera Documentation:** [docs.hedera.com](https://docs.hedera.com/)
