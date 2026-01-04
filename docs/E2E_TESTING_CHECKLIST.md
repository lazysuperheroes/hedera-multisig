# Manual E2E Testing Checklist

> Comprehensive checklist for testing the Hedera MultiSig signing flow

## Prerequisites

- [ ] HashPack wallet installed (browser extension or mobile)
- [ ] Testnet HBAR in your wallet (get from https://portal.hedera.com/faucet)
- [ ] Two terminal windows ready

---

## Test 1: CLI Server + CLI Participant

### Terminal 1 - Start Server

```bash
npm run multisig-server -- --port 3001 --threshold 1 --keys "YOUR_PUBLIC_KEY"
```

- [ ] Server starts without errors
- [ ] Displays session ID and PIN
- [ ] Shows connection URL/QR code

### Terminal 2 - Join as CLI Participant

```bash
npm run multisig-client -- --server ws://localhost:3001 --session SESSION_ID --pin PIN
```

- [ ] Client connects successfully
- [ ] Shows "waiting for transaction" status

### Terminal 1 - Inject Transaction (from coordinator)

- [ ] Create and inject a test transaction
- [ ] Participant receives transaction details

### Terminal 2 - Sign

- [ ] Transaction details displayed correctly
- [ ] Can approve/sign transaction
- [ ] Signature accepted by server

---

## Test 2: CLI Server + dApp Participant (WalletConnect)

### Terminal 1 - Start Server with Tunnel

```bash
npm run multisig-server -- --port 3001 --threshold 1 --keys "YOUR_HASHPACK_PUBLIC_KEY" --tunnel ngrok
```

- [ ] Server starts with public URL
- [ ] Note the `wss://` URL displayed

### Browser - Join via dApp

1. Go to `https://testnet-multisig.lazysuperheroes.com/join`
2. Enter connection string or manual details:
   - Server URL: `wss://xxxx.ngrok.io` (from tunnel)
   - Session ID: (from server output)
   - PIN: (from server output)

- [ ] dApp connects to server
- [ ] "Connect Wallet" button appears
- [ ] HashPack connection modal opens
- [ ] Wallet connects successfully
- [ ] Shows as "Ready" in session

### Inject Transaction & Sign

- [ ] Inject transaction from server
- [ ] dApp displays transaction review screen
- [ ] VERIFIED data shows (type, checksum, amounts)
- [ ] HashPack prompts for signature
- [ ] Signature submitted successfully
- [ ] Server shows signature received

---

## Test 3: Full 2-of-3 Multi-Sig Flow

### Setup

```bash
npm run multisig-server -- --port 3001 --threshold 2 --keys "KEY1,KEY2,KEY3" --tunnel ngrok
```

### Participants

- [ ] Participant 1 joins via CLI
- [ ] Participant 2 joins via dApp + HashPack
- [ ] Both show as "Ready"

### Signing

- [ ] Inject real testnet transfer transaction
- [ ] Both participants see transaction
- [ ] Participant 1 signs via CLI
- [ ] Participant 2 signs via HashPack
- [ ] Threshold met (2/2 signatures)
- [ ] Transaction executes on testnet
- [ ] Receipt shows SUCCESS

---

## Test 4: dApp UI/UX Checks

### Join Page (`/join`)

- [ ] Connection string input works
- [ ] QR scanner opens (if camera available)
- [ ] Manual entry toggle works
- [ ] Error shown for invalid connection

### Session Page (`/session/[id]`)

- [ ] Participant list updates in real-time
- [ ] Session countdown timer displays
- [ ] Copy buttons work (session ID, PIN)
- [ ] Share dialog opens

### Transaction Review

- [ ] Verified vs unverified data clearly separated
- [ ] Transaction type correctly identified
- [ ] Amounts formatted correctly
- [ ] Approve/Reject buttons work
- [ ] Rejection reason input works

### Mobile Responsive

- [ ] Test on phone or browser dev tools (375px width)
- [ ] All UI elements accessible
- [ ] Buttons tappable
- [ ] Mobile wallet indicator shows (compact account ID badge)

### Theme Toggle

- [ ] Theme toggle button visible in navbar
- [ ] Click cycles: Light → Dark → System → Light
- [ ] Light mode: White background, dark text
- [ ] Dark mode: Dark background, light text
- [ ] System mode: Follows OS preference
- [ ] Theme persists after page reload
- [ ] All pages support dark mode (home, join, session)

### Theme - System Preference

- [ ] Set theme to "System"
- [ ] Change OS to dark mode → dApp switches to dark
- [ ] Change OS to light mode → dApp switches to light
- [ ] Tooltip shows "System (following your OS - currently dark/light)"

### Accessibility

- [ ] Tab through page with keyboard
- [ ] Focus ring visible on interactive elements
- [ ] Theme toggle has visible focus ring
- [ ] Screen reader: Theme button has aria-label

### Network Badge

- [ ] Testnet: Orange badge with pulsing dot
- [ ] Mainnet: Green badge with solid dot
- [ ] Badge text shows "TESTNET" or "MAINNET"

---

## Test 5: Error Handling

- [ ] Invalid session ID → Shows error message
- [ ] Wrong PIN → Shows authentication error
- [ ] Server disconnect → Shows connection lost
- [ ] Wallet rejection → Shows rejected status
- [ ] Session expired → Shows expiration message

---

## Quick Smoke Test (5 minutes)

If short on time, just do this:

1. Start server: `npm run multisig-server -- --port 3001 -t 1 -k "YOUR_KEY" --tunnel ngrok`
2. Open `testnet-multisig.lazysuperheroes.com/join`
3. Enter connection details
4. Connect HashPack
5. Inject a transfer from server
6. Sign with HashPack
7. Verify transaction on HashScan

---

## Test Results

| Test | Date | Result | Notes |
|------|------|--------|-------|
| Test 1: CLI + CLI | | | |
| Test 2: CLI + dApp | | | |
| Test 3: 2-of-3 Flow | | | |
| Test 4: UI/UX | | | |
| Test 4: Theme Toggle | | | |
| Test 4: Accessibility | | | |
| Test 5: Error Handling | | | |

---

*Last updated: 2026-01-04*
