# WalletConnect dApp - Integration Testing Guide

This guide walks you through end-to-end integration testing of the Hedera MultiSig WalletConnect dApp.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Test Environment Setup](#test-environment-setup)
3. [Testing Scenarios](#testing-scenarios)
4. [Testing Checklist](#testing-checklist)
5. [Common Issues & Troubleshooting](#common-issues--troubleshooting)

---

## Prerequisites

### Required Accounts & Tools

1. **Hedera Testnet Account**
   - Account ID (OPERATOR_ID)
   - Private Key (OPERATOR_KEY)
   - Get one at: https://portal.hedera.com/register

2. **WalletConnect-Compatible Wallet**
   - **HashPack** (Recommended): https://www.hashpack.app/
   - **Blade Wallet**: https://www.bladewallet.io/
   - Both support hardware wallets (Ledger)

3. **Node.js** 18+ and npm installed

4. **WalletConnect Project ID**
   - Get one at: https://cloud.walletconnect.com/
   - Already configured in `.env.local`

---

## Test Environment Setup

### Step 1: Configure Environment Variables

In the **dApp directory**, ensure `.env.local` is configured:

```bash
# dapp/.env.local
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id_here
NEXT_PUBLIC_DEFAULT_NETWORK=testnet
```

In the **root directory**, set your Hedera credentials:

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

### Step 2: Install Dependencies

```bash
# Install root dependencies (if not already done)
npm install

# Install dApp dependencies
cd dapp
npm install
cd ..
```

### Step 3: Get Your Wallet Public Key

You'll need your wallet's public key to configure the test server.

**Using HashPack:**
1. Open HashPack browser extension
2. Click on your account name
3. Click "Show Account Details"
4. Copy the **Public Key** (starts with `302a300506032b6570032100...`)

**Using CLI (if you have a test key file):**
```bash
node -e "console.log(require('@hashgraph/sdk').PrivateKey.fromString('YOUR_PRIVATE_KEY').publicKey.toString())"
```

---

## Testing Scenarios

### Scenario 1: Basic WalletConnect Signing (Single Web Participant)

**Objective**: Test that a single WalletConnect participant can join a session and sign a transaction.

**Setup:**
- Threshold: 1
- Participants: 1 (your WalletConnect wallet)

**Steps:**

1. **Start the test server:**
   ```bash
   node scripts/start-test-server.js
   ```

2. **When prompted, enter configuration:**
   - Public Key 1: `<Your WalletConnect wallet public key>`

3. **Copy the session info displayed:**
   - Session ID: `abc123...`
   - PIN: `123456`
   - Server URL: `wss://xxxx.ngrok.io` or `ws://localhost:3001`

4. **In a new terminal, start the dApp:**
   ```bash
   cd dapp
   npm run dev
   ```

5. **Open browser to http://localhost:3000**

6. **Join the session:**
   - Click "Join Signing Session"
   - Enter Server URL, Session ID, PIN
   - Click "Next"

7. **Connect wallet:**
   - Click "Connect Wallet"
   - Select your wallet (HashPack/Blade)
   - Approve connection in wallet popup
   - Verify wallet info displays (Account ID, Public Key)

8. **Join session:**
   - Click "Join Session with Connected Wallet"
   - Wait for "Participant Ready" confirmation

9. **In the server terminal, press ENTER to inject test transaction**

10. **Review transaction in dApp:**
    - Verify GREEN "VERIFIED DATA" section shows:
      - Transaction checksum
      - Type: Transfer
      - Amounts: -1 HBAR, +1 HBAR
      - Accounts: Your account, 0.0.3
    - Verify YELLOW "UNVERIFIED METADATA" section shows:
      - Title: "Test HBAR Transfer"
      - Description

11. **Sign the transaction:**
    - Click "Approve & Sign"
    - Wallet popup opens
    - Approve signature in wallet
    - Verify success toast notification

12. **Verify completion:**
    - Signature progress shows 1/1 (100%)
    - Transaction executes automatically
    - Success message with transaction ID
    - HashScan link displays

**Expected Result**: ✅ Transaction executed successfully

---

### Scenario 2: Mixed Session (CLI + Web Participants)

**Objective**: Test that CLI and Web participants can work together in the same session.

**Setup:**
- Threshold: 2
- Participants: 2 (1 CLI with file-based key, 1 WalletConnect)

**Steps:**

1. **Create a test private key file** (if you don't have one):
   ```bash
   node -e "console.log(require('@hashgraph/sdk').PrivateKey.generateED25519().toString())" > test-key-1.txt
   ```

2. **Get the public key:**
   ```bash
   node -e "const pk = require('fs').readFileSync('test-key-1.txt', 'utf8').trim(); console.log(require('@hashgraph/sdk').PrivateKey.fromString(pk).publicKey.toString())"
   ```

3. **Start test server with environment variables:**
   ```bash
   set TEST_THRESHOLD=2
   set TEST_PARTICIPANTS=2
   node scripts/start-test-server.js
   ```

4. **Enter both public keys:**
   - Public Key 1: `<CLI key public key from step 2>`
   - Public Key 2: `<Your WalletConnect wallet public key>`

5. **Start dApp** (http://localhost:3000) and join session with WalletConnect (steps from Scenario 1)

6. **In a new terminal, start CLI participant:**
   ```bash
   node cli/participant.js --session <SESSION_ID> --pin <PIN> --url ws://localhost:3001 --key test-key-1.txt
   ```

7. **Wait for both participants to show "ready"** in server logs

8. **Press ENTER in server terminal to inject transaction**

9. **In CLI terminal:**
   - Review transaction
   - Type `approve` and press ENTER
   - Signature submitted

10. **In dApp browser:**
    - Review transaction
    - Click "Approve & Sign"
    - Sign in wallet

11. **Verify both signatures collected:**
    - Server shows 2/2 signatures
    - Transaction executes
    - Both participants see completion

**Expected Result**: ✅ Mixed session works, transaction executed with CLI + Web signatures

---

### Scenario 3: Hardware Wallet Signing (Ledger via HashPack)

**Objective**: Test that hardware wallet signatures work through WalletConnect.

**Prerequisites:**
- Ledger device connected
- HashPack connected to Ledger account

**Steps:**

1. **In HashPack:**
   - Connect to Ledger account
   - Verify Ledger is unlocked and Hedera app is open

2. **Follow Scenario 1 steps** but use Ledger account's public key

3. **When signing transaction:**
   - HashPack prompts "Approve on Ledger"
   - Ledger displays transaction details
   - Review on Ledger screen
   - Press both buttons to approve
   - Signature submitted to server

**Expected Result**: ✅ Hardware wallet signature accepted, transaction executed

---

### Scenario 4: Error Handling & Edge Cases

**Test 4.1: Invalid Session Credentials**

1. Join session with wrong PIN
2. **Expected**: Clear error message "Authentication failed"

**Test 4.2: Network Mismatch**

1. Configure wallet for mainnet
2. Try joining testnet session
3. **Expected**: Warning displayed (implementation dependent on wallet)

**Test 4.3: Wallet Disconnect During Session**

1. Join session successfully
2. Disconnect wallet (close HashPack or revoke connection)
3. **Expected**: Toast notification "Wallet disconnected"
4. Reconnect wallet
5. **Expected**: Can continue session without losing WebSocket connection

**Test 4.4: Session Timeout**

1. Join session but don't inject transaction for 30+ minutes
2. **Expected**: Session timeout message, graceful cleanup

**Test 4.5: User Rejects Signature**

1. Review transaction
2. Click "Approve & Sign"
3. Reject signature in wallet popup
4. **Expected**: Error toast, can retry signing

**Test 4.6: Page Refresh During Session**

1. Join session successfully
2. Refresh browser page
3. **Expected**: Session state lost (Phase 8 enhancement: localStorage recovery)

---

## Testing Checklist

### Basic Functionality
- [ ] dApp starts without errors (`npm run dev`)
- [ ] Landing page loads and displays correctly
- [ ] Join form validates inputs (URL, Session ID, PIN)
- [ ] WalletConnect modal opens when clicking "Connect Wallet"
- [ ] Can connect HashPack wallet
- [ ] Can connect Blade wallet
- [ ] Wallet info displays correctly (Account ID, Public Key)
- [ ] Can join session with correct credentials
- [ ] Can join session fails with incorrect credentials
- [ ] Transaction displays in review UI
- [ ] VERIFIED section shows correct transaction data
- [ ] UNVERIFIED section shows coordinator metadata
- [ ] Can approve and sign transaction
- [ ] Signature submitted successfully
- [ ] Progress bar updates correctly (1/2, 2/2, etc.)
- [ ] Transaction executes when threshold met
- [ ] Success message and HashScan link display

### Mixed Session Compatibility
- [ ] CLI + Web participants can join same session
- [ ] Both signature types accepted by server
- [ ] Threshold counting works across participant types
- [ ] Transaction executes with mixed signatures

### Hardware Wallet Support
- [ ] Can connect HashPack with Ledger account
- [ ] Ledger signature request displays on device
- [ ] Ledger signature accepted by server
- [ ] Transaction executes with Ledger signature

### UI/UX
- [ ] Toast notifications display for all key events
- [ ] Animations smooth and professional
- [ ] Loading states display appropriately
- [ ] Error messages are clear and actionable
- [ ] Mobile responsive (test on phone or browser DevTools)
- [ ] Step indicators update correctly
- [ ] Progress bar visually accurate

### Error Handling
- [ ] Invalid session credentials show error
- [ ] Network issues display error message
- [ ] Wallet disconnect handled gracefully
- [ ] Signature rejection allows retry
- [ ] Session timeout displays message
- [ ] WebSocket connection errors handled

### Security
- [ ] VERIFIED vs UNVERIFIED sections clearly distinguished
- [ ] Transaction checksum displayed
- [ ] Metadata validation warnings show (if applicable)
- [ ] No private keys stored or logged
- [ ] WSS used in production (local testing can use WS)

### Performance
- [ ] Page load time < 3 seconds
- [ ] Transaction decoding < 1 second
- [ ] Wallet connection < 5 seconds
- [ ] Signature submission < 2 seconds
- [ ] No console errors or warnings

---

## Common Issues & Troubleshooting

### Issue: "Cannot connect to WebSocket server"

**Possible Causes:**
- Server not running
- Incorrect server URL
- Firewall blocking connection

**Solutions:**
1. Verify server is running: `node scripts/start-test-server.js`
2. Check server URL matches (ws:// or wss://)
3. If using tunnel, verify tunnel URL is accessible
4. Try local-only: `set NO_TUNNEL=1` before starting server

---

### Issue: "Authentication failed"

**Possible Causes:**
- Incorrect Session ID
- Incorrect PIN
- Session expired

**Solutions:**
1. Copy Session ID and PIN exactly from server output
2. Check session hasn't timed out (30 min default)
3. Restart server if session expired

---

### Issue: "Wallet public key not eligible"

**Possible Causes:**
- Wallet public key not in eligible keys list
- Wrong wallet account selected

**Solutions:**
1. Verify you entered correct wallet public key when starting server
2. Check wallet is using correct account (not a different account in wallet)
3. Restart server with correct public key

---

### Issue: "Transaction checksum mismatch"

**Possible Causes:**
- Transaction modified after freezing
- Coordinator injected corrupted transaction
- Network issue during transmission

**Solutions:**
1. This is a security warning - DO NOT sign if checksum doesn't match
2. Contact coordinator to investigate
3. Reject transaction and request new session

---

### Issue: WalletConnect modal doesn't open

**Possible Causes:**
- Missing or invalid WALLETCONNECT_PROJECT_ID
- Browser popup blocker
- WalletConnect library error

**Solutions:**
1. Verify `.env.local` has valid `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
2. Check browser console for errors
3. Disable popup blocker for localhost
4. Try different browser (Chrome/Brave recommended)

---

### Issue: Ledger signature fails

**Possible Causes:**
- Ledger locked or disconnected
- Hedera app not open
- Ledger firmware outdated

**Solutions:**
1. Unlock Ledger device
2. Open Hedera app on Ledger
3. Update Ledger firmware if prompted
4. Reconnect HashPack to Ledger

---

### Issue: Toast notifications not appearing

**Possible Causes:**
- CSS not loaded
- Toast hook not initialized

**Solutions:**
1. Refresh page
2. Check browser console for errors
3. Verify `dapp/app/globals.css` loaded correctly
4. Clear browser cache

---

## Test Results Template

Use this template to document your test results:

```markdown
# WalletConnect dApp - Test Results

**Date:** YYYY-MM-DD
**Tester:** Your Name
**Environment:** Windows/macOS/Linux
**Browser:** Chrome/Firefox/Safari v.X.X
**Wallet:** HashPack/Blade v.X.X

## Scenario 1: Basic WalletConnect Signing
- [ ] PASS / [ ] FAIL
- Notes:

## Scenario 2: Mixed Session (CLI + Web)
- [ ] PASS / [ ] FAIL
- Notes:

## Scenario 3: Hardware Wallet (Ledger)
- [ ] PASS / [ ] FAIL
- Notes:

## Scenario 4: Error Handling
- Test 4.1: [ ] PASS / [ ] FAIL
- Test 4.2: [ ] PASS / [ ] FAIL
- Test 4.3: [ ] PASS / [ ] FAIL
- Test 4.4: [ ] PASS / [ ] FAIL
- Test 4.5: [ ] PASS / [ ] FAIL
- Test 4.6: [ ] PASS / [ ] FAIL

## Overall Assessment
- [ ] All critical tests passed
- [ ] Ready for production deployment
- [ ] Blockers found (list below)

### Blockers:
1.
2.

### Recommendations:
1.
2.
```

---

## Next Steps After Testing

Once all tests pass:

1. **Update README.md** with production deployment info
2. **Create video walkthrough** for user onboarding
3. **Deploy to Vercel** (see `dapp/README.md`)
4. **Update main project README** with WalletConnect section
5. **Share with community** for beta testing

---

**Happy Testing! 🚀**
