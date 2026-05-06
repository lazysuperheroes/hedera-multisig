# WalletConnect dApp - Quick Start Guide

**5-Minute Setup for Testing**

> **Looking for the full E2E test plan?** See [`../TESTING.md`](../TESTING.md)
> for the canonical walkthroughs (Scenarios 11 + 12), tunnel/ngrok setup,
> mixed CLI+wallet sessions, and failure-mode smoke. This file is the
> minimal happy-path for the WalletConnect-only flow.

## Prerequisites

- ✅ Node.js 20+ installed (required by package.json `engines`)
- ✅ Hedera testnet account (get one at https://portal.hedera.com/register)
- ✅ HashPack or Blade wallet installed
- ✅ WalletConnect Project ID — get one free at https://cloud.walletconnect.com/, paste into `dapp/.env.local`

**Tip:** run `npm run precheck` from the repo root first — it verifies all
of the above in under 10 seconds.

---

## Step 1: Get Your Wallet Public Key (1 min)

**Using HashPack Extension:**
1. Open HashPack
2. Click account name → "Show Account Details"
3. Copy the **Public Key** (starts with `302a300506032b6570032100...`)

**Save this key** - you'll need it in Step 3.

---

## Step 2: Set Environment Variables (1 min)

Open terminal in the **root directory** (`hedera-multisig/`):

**Windows (PowerShell):**
```powershell
$env:OPERATOR_ID="0.0.YOUR_ACCOUNT_ID"
$env:OPERATOR_KEY="302e020100300506032b657004220420..."
```

**Windows (CMD):**
```cmd
set OPERATOR_ID=0.0.YOUR_ACCOUNT_ID
set OPERATOR_KEY=302e020100300506032b657004220420...
```

**macOS/Linux:**
```bash
export OPERATOR_ID="0.0.YOUR_ACCOUNT_ID"
export OPERATOR_KEY="302e020100300506032b657004220420..."
```

---

## Step 3: Start Test Server (1 min)

In the **root directory**, run:

```bash
node scripts/start-test-server.js
```

When prompted:
- **Public Key 1:** Paste your wallet public key from Step 1

The server will display:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SESSION INFORMATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Session ID: abc123def456...
PIN:        123456
Server URL: wss://xxxx.ngrok.io
```

**Keep this terminal open** and **save** the Session ID, PIN, and Server URL.

---

## Step 4: Start dApp (1 min)

Open a **new terminal** in the **root directory**:

```bash
cd dapp
npm run dev
```

Wait for:
```
✓ Ready in 719ms
- Local:   http://localhost:3000
```

Open your browser to **http://localhost:3000**

---

## Step 5: Test the Signing Flow (2 min)

### In the Browser:

1. **Join Session:**
   - Click "Join Signing Session"
   - Enter Server URL, Session ID, PIN from Step 3
   - Click "Next"

2. **Connect Wallet:**
   - Click "Connect Wallet"
   - Select HashPack/Blade in popup
   - Approve connection in wallet

3. **Join with Wallet:**
   - Verify wallet info displays (Account ID, Public Key)
   - Click "Join Session with Connected Wallet"
   - Wait for "Participant Ready" toast

### In the Server Terminal:

4. **Inject Test Transaction:**
   - Press **ENTER** when prompted
   - Server creates and sends a test transaction

### In the Browser:

5. **Review Transaction:**
   - GREEN section shows verified transaction data
   - YELLOW section shows coordinator metadata
   - Review carefully

6. **Sign:**
   - Click "Approve & Sign"
   - Approve in wallet popup
   - Wait for success message

7. **Complete:**
   - Progress shows 1/1 (100%)
   - Transaction executes
   - HashScan link displays

---

## Expected Result

✅ **Success!** You should see:
- Transaction executed successfully
- Transaction ID displayed
- HashScan link to view on-chain

---

## Troubleshooting

### "Cannot connect to server"
- Verify server is running (Step 3 terminal)
- Check Server URL matches exactly

### "Authentication failed"
- Double-check Session ID and PIN
- Session may have expired (30 min timeout)

### "Wallet public key not eligible"
- Verify you copied correct wallet public key
- Check you're using the right account in wallet

### WalletConnect modal doesn't open
- Check `.env.local` has valid `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
- Disable browser popup blocker

### Ledger not working
- Unlock Ledger device
- Open Hedera app on Ledger
- Connect HashPack to Ledger account

---

## Next Steps

### Full Testing
See [INTEGRATION_TESTING.md](./INTEGRATION_TESTING.md) for:
- Mixed session testing (CLI + Web)
- Hardware wallet (Ledger) testing
- Error handling validation
- Complete testing checklist

### Deploy to Production
See [README.md](./README.md#deployment) for Vercel deployment instructions.

---

**Happy Testing! 🚀**

Questions? Check the main [README.md](./README.md) or [INTEGRATION_TESTING.md](./INTEGRATION_TESTING.md).
