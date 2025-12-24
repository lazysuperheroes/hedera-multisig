# WalletConnect Integration Guide

## Overview

The Hedera MultiSig dApp enables participants to sign multi-signature transactions using WalletConnect-compatible wallets, including **hardware wallets** like Ledger through wallet providers.

This guide covers:
- How WalletConnect signing works
- Supported wallets
- Hardware wallet setup
- Security considerations
- Troubleshooting

---

## Table of Contents

1. [What is WalletConnect?](#what-is-walletconnect)
2. [Supported Wallets](#supported-wallets)
3. [How It Works](#how-it-works)
4. [Getting Started](#getting-started)
5. [Hardware Wallet Support](#hardware-wallet-support)
6. [Security Model](#security-model)
7. [Mixed Sessions](#mixed-sessions)
8. [FAQ](#faq)
9. [Troubleshooting](#troubleshooting)

---

## What is WalletConnect?

**WalletConnect** is an open-source protocol that connects decentralized applications (dApps) to mobile and browser wallets using end-to-end encryption.

### Key Benefits

- 🔐 **Private keys never leave your wallet** - Signing happens in your wallet app, not in the browser
- 🔑 **Hardware wallet support** - Use Ledger or other hardware wallets through compatible wallet apps
- 📱 **Mobile-friendly** - Scan QR code with mobile wallet or use browser extensions
- 🌐 **Browser-based** - No software installation required for the dApp

### Why WalletConnect for Multi-Sig?

Traditional multi-signature flows require participants to have private keys in files, which:
- Can't use hardware wallets directly
- Requires key management infrastructure
- Less convenient for occasional participants

WalletConnect enables:
- ✅ Hardware wallet participants (Ledger, Trezor via wallet apps)
- ✅ Mobile wallet participants (HashPack mobile, Blade mobile)
- ✅ Browser extension participants (HashPack, Blade)
- ✅ Mixed sessions (CLI + Web participants together)

---

## Supported Wallets

### Recommended Wallets

#### HashPack (Recommended)
- **Website**: https://www.hashpack.app/
- **Platforms**: Browser Extension, Mobile (iOS/Android)
- **Hardware Wallet**: ✅ Ledger support
- **WalletConnect**: ✅ Full support
- **Multi-Account**: ✅ Yes
- **Hedera Native**: ✅ Purpose-built for Hedera

**Why Recommended**: Official Hedera wallet, excellent hardware wallet integration, active development.

#### Blade Wallet
- **Website**: https://www.bladewallet.io/
- **Platforms**: Browser Extension, Mobile (iOS/Android)
- **Hardware Wallet**: ⚠️ Check current status
- **WalletConnect**: ✅ Full support
- **Multi-Account**: ✅ Yes
- **Hedera Native**: ✅ Purpose-built for Hedera

**Why Recommended**: Strong Hedera integration, user-friendly interface.

### Wallet Comparison

| Feature | HashPack | Blade | Other Wallets |
|---------|----------|-------|---------------|
| Ledger Support | ✅ Full | ⚠️ Check | Varies |
| WalletConnect | ✅ Full | ✅ Full | Varies |
| Browser Extension | ✅ Yes | ✅ Yes | Varies |
| Mobile App | ✅ iOS/Android | ✅ iOS/Android | Varies |
| Hedera Native | ✅ Yes | ✅ Yes | No |
| Multi-Sig Tested | ✅ Yes | ✅ Yes | ❌ No |

---

## How It Works

### Architecture

```
┌──────────────────────┐
│   Your Browser       │
│  ┌────────────────┐  │
│  │ MultiSig dApp  │  │
│  └────────┬───────┘  │
└───────────┼──────────┘
            │
            │ WalletConnect Protocol
            │ (Encrypted)
            │
┌───────────▼──────────┐
│   Wallet App         │
│  ┌────────────────┐  │
│  │  HashPack      │  │
│  │  or Blade      │  │
│  │                │  │
│  │  [Your Keys]   │  │  ← Keys never leave wallet
│  │  [Ledger]      │  │  ← Hardware wallet option
│  └────────────────┘  │
└──────────────────────┘
```

### Signing Flow

1. **Join Session**: Enter session credentials in dApp
2. **Connect Wallet**: Click "Connect Wallet" → WalletConnect modal opens
3. **Approve Connection**: Approve in your wallet app
4. **Wait for Transaction**: Coordinator injects transaction into session
5. **Review Transaction**: dApp displays transaction details
   - **VERIFIED DATA** (green) - Cryptographically verified from transaction bytes
   - **UNVERIFIED METADATA** (yellow) - Advisory info from coordinator
6. **Approve & Sign**: Click "Approve & Sign" in dApp
7. **Sign in Wallet**: Wallet prompts for signature approval
   - Desktop: Approve in browser extension
   - Mobile: Approve in mobile app
   - Ledger: Approve on hardware device
8. **Signature Submitted**: dApp extracts signature and sends to coordinator
9. **Wait for Threshold**: Other participants must also sign
10. **Execution**: Transaction executes when threshold met

### Key Difference from CLI

**CLI Participant**:
- Loads private key from file
- Signs locally with Hedera SDK
- Submits signature to coordinator

**Web Participant (WalletConnect)**:
- Connects to wallet app via WalletConnect
- Requests signature from wallet
- Wallet signs transaction (keys stay in wallet)
- Extracts signature from signed transaction
- Submits signature to coordinator

**Server Perspective**: Identical! Server can't tell if signature came from CLI or Web participant.

---

## Getting Started

### Step 1: Install a Wallet

Download and install one of the supported wallets:

**HashPack** (Recommended):
- Browser: https://chrome.google.com/webstore (search "HashPack")
- Mobile: App Store / Google Play

**Blade**:
- Browser: https://chrome.google.com/webstore (search "Blade Wallet")
- Mobile: App Store / Google Play

### Step 2: Create or Import Account

**New Account**:
1. Open wallet
2. Create new account
3. **Write down recovery phrase** (12 or 24 words)
4. Store securely offline

**Import Existing**:
1. Open wallet
2. Import account with recovery phrase
3. Or connect Ledger (see Hardware Wallet section)

### Step 3: Fund Your Account (Testnet)

For testnet testing:
1. Copy your account ID (e.g., 0.0.1234567)
2. Visit Hedera Portal: https://portal.hedera.com/
3. Login and navigate to testnet faucet
4. Request test HBAR

### Step 4: Get Your Public Key

Your coordinator needs your **public key** to add you to the signing session.

**HashPack**:
1. Open HashPack extension
2. Click account name
3. Click "Show Account Details"
4. Copy **Public Key** (starts with `302a300506032b6570032100...`)

**Blade**:
1. Open Blade extension
2. Click settings/account details
3. Copy public key

**Send to Coordinator**: Provide your public key to the session coordinator.

### Step 5: Join a Signing Session

1. **Receive Session Info** from coordinator:
   - Server URL (e.g., `wss://example.ngrok.io`)
   - Session ID
   - 6-digit PIN

2. **Open dApp**: Navigate to the deployed dApp URL

3. **Join Session**:
   - Click "Join Signing Session"
   - Enter Server URL, Session ID, PIN
   - Click "Next"

4. **Connect Wallet**:
   - Click "Connect Wallet"
   - Select your wallet in WalletConnect modal
   - Approve connection in wallet

5. **Join with Wallet**:
   - Verify wallet info (Account ID, Public Key)
   - Click "Join Session with Connected Wallet"

6. **Wait for Transaction**: Coordinator will inject transaction when ready

7. **Review & Sign**:
   - Carefully review VERIFIED transaction data
   - Check for any validation warnings
   - Click "Approve & Sign"
   - Approve in wallet popup

8. **Wait for Completion**: Other participants must also sign

9. **Success!**: View transaction on HashScan when executed

---

## Hardware Wallet Support

### Ledger with HashPack

HashPack provides excellent Ledger integration for Hedera.

#### Prerequisites

- Ledger Nano S, Nano S Plus, or Nano X
- Latest Ledger firmware
- Hedera app installed on Ledger

#### Setup Steps

1. **Update Ledger Firmware**:
   - Connect Ledger to computer
   - Open Ledger Live
   - Update to latest firmware if prompted

2. **Install Hedera App**:
   - In Ledger Live, go to "Manager"
   - Search for "Hedera"
   - Click "Install"
   - Wait for installation to complete

3. **Connect HashPack to Ledger**:
   - Open HashPack extension
   - Click "Add Account"
   - Select "Connect Hardware Wallet"
   - Select "Ledger"
   - Unlock Ledger and open Hedera app
   - Follow prompts to connect

4. **Verify Connection**:
   - HashPack should show Ledger account
   - Account will be marked with Ledger icon

#### Using Ledger for Multi-Sig

1. **Get Ledger Public Key**:
   - In HashPack, select Ledger account
   - Click account details
   - Copy public key
   - Send to coordinator

2. **Join Session** (same as regular wallet flow)

3. **Sign with Ledger**:
   - When prompted to sign in dApp
   - HashPack shows "Approve on Ledger"
   - **Review transaction on Ledger screen**:
     - Transaction type
     - Amount
     - Recipient
   - Press both buttons to approve signature
   - Signature submitted automatically

#### Ledger Security Tips

✅ **DO**:
- Always verify transaction details on Ledger screen
- Keep Ledger disconnected when not in use
- Store recovery phrase offline in secure location
- Use PIN protection on Ledger

❌ **DON'T**:
- Share recovery phrase with anyone
- Enter recovery phrase on computer
- Leave Ledger connected when not actively signing
- Trust transaction details only in wallet - verify on Ledger screen

---

## Security Model

### VERIFIED vs UNVERIFIED Data

The dApp displays transaction data in two clearly separated sections:

#### VERIFIED DATA (Green Section)

**Source**: Transaction bytes (cryptographically signed)

**What's Included**:
- Transaction checksum (SHA-256 of transaction bytes)
- Transaction type (Transfer, TokenAssociate, etc.)
- All transfer amounts
- All account IDs involved
- Smart contract function calls (if applicable)

**Trust Level**: ✅ **Fully Trusted** - This data is extracted from the actual frozen transaction bytes and verified by checksum. It cannot be spoofed by the coordinator.

#### UNVERIFIED METADATA (Yellow Section)

**Source**: Coordinator-provided information

**What's Included**:
- Transaction title
- Transaction description
- Urgency level
- Custom notes

**Trust Level**: ⚠️ **Advisory Only** - This data is provided by the coordinator and could potentially be misleading or fraudulent.

**Validation Warnings**:
- Metadata mismatch (description doesn't match actual transaction)
- Urgency language detection (e.g., "URGENT", "ACT NOW")
- Suspicious patterns

### How to Review Safely

1. **Always prioritize VERIFIED data** over UNVERIFIED metadata
2. **Check the transaction checksum** - Unique fingerprint of transaction
3. **Verify all amounts and accounts** in VERIFIED section
4. **Read validation warnings** if any appear
5. **If in doubt, reject** and contact coordinator for clarification

### Example: Detecting Fraud

**Scenario**: Malicious coordinator attempts fraud

**UNVERIFIED Metadata** (Yellow):
```
Title: "Team Bonus Payment"
Description: "1 HBAR bonus to 0.0.12345"
```

**VERIFIED Data** (Green):
```
Type: Transfer
From: 0.0.98765 (-100 HBAR)
To:   0.0.ATTACKER (+100 HBAR)

⚠️ WARNING: Metadata amount (1 HBAR) doesn't match
    actual transfer (100 HBAR)
⚠️ WARNING: Metadata recipient (0.0.12345) doesn't
    match actual recipient (0.0.ATTACKER)
```

**Result**: User sees warnings, reviews VERIFIED data, **rejects transaction**. ✅ Fraud prevented!

### Additional Security Features

- **Network Validation**: Warns if wallet network doesn't match session
- **Threshold Tracking**: Shows exactly how many signatures collected
- **Session Timeout**: Sessions expire after inactivity
- **PIN Protection**: 6-digit PIN required to join session
- **WebSocket Encryption**: Uses WSS (WebSocket Secure) in production

---

## Mixed Sessions

### CLI + Web Participants

The beauty of this architecture: **CLI and Web participants can work together seamlessly**.

#### Example Scenario

**3-of-5 Multi-Sig Account**:
- Participant 1: CLI participant (file-based key on server)
- Participant 2: CLI participant (file-based key on laptop)
- Participant 3: Web participant (HashPack browser extension)
- Participant 4: Web participant (HashPack mobile)
- Participant 5: Web participant (Ledger via HashPack)

**Threshold**: Any 3 signatures execute the transaction

**How It Works**:
1. Coordinator creates session with 5 eligible public keys (mix of CLI and Web)
2. Coordinator starts server with threshold=3
3. All 5 participants join session:
   - CLI participants: `node cli/participant.js --session ID --pin PIN --key file.txt`
   - Web participants: Open dApp, connect wallet, join session
4. Coordinator injects transaction
5. All participants review transaction (CLI shows in terminal, Web shows in browser)
6. Participants approve and sign:
   - CLI: Type "approve" and press Enter
   - Web: Click "Approve & Sign" and approve in wallet
7. First 3 signatures trigger execution (can be any combination of CLI/Web)

**Server Perspective**: All signatures are identical in format. Server validates signature cryptographically, regardless of source.

### Benefits of Mixed Sessions

- **Flexibility**: Participants use whatever signing method they prefer
- **Accessibility**: Non-technical users can participate via Web/wallet
- **Hardware Wallet Support**: Some participants can use Ledger while others use CLI
- **Zero Server Changes**: Server doesn't need to know or care about signing method

---

## FAQ

### Can I use the same wallet on mobile and desktop?

**Yes**. Most wallets sync across devices using recovery phrase or cloud backup. You can:
- Sign on mobile: Scan QR code or deep link from dApp
- Sign on desktop: Use browser extension

Just ensure the same account is active on both devices.

---

### What happens if I disconnect my wallet mid-session?

**Wallet disconnect ≠ Session disconnect**

- WebSocket connection to coordinator stays active
- You can reconnect wallet without losing session
- Once reconnected, you can continue signing
- Toast notification alerts you to wallet disconnect

**To reconnect**: Click "Connect Wallet" again and approve in wallet.

---

### Can I change wallets during a session?

**Technically yes, but not recommended.**

If you switch wallets:
- New wallet must have account matching the eligible public key you registered
- If public key doesn't match, signature will be rejected

**Recommendation**: Use the same wallet/account throughout session.

---

### How do I know my private key is safe?

**Private keys never leave your wallet**:
1. WalletConnect uses end-to-end encryption
2. Signing happens inside your wallet app
3. Only the **signature** (not the key) is sent to dApp
4. dApp never sees or handles private keys

With hardware wallet:
- Private key never leaves Ledger device
- Signing happens on-device
- Even wallet app can't access private key

---

### What networks are supported?

- **Testnet** - For testing (default)
- **Mainnet** - For production transactions

**Important**: Ensure your wallet is on the correct network:
- HashPack: Click network dropdown (top right)
- Blade: Check network in settings

If wallet network doesn't match session, you may see warnings.

---

### Can I use a different WalletConnect wallet?

The dApp uses Hedera's official WalletConnect library, which supports **any wallet implementing Hedera WalletConnect spec**.

**Tested**: HashPack, Blade
**May work**: Other Hedera wallets with WalletConnect support
**Won't work**: Wallets without Hedera integration (MetaMask, etc.)

---

### What if the coordinator's server goes offline?

**During session**:
- WebSocket connection lost
- Participants see connection error
- Session cannot continue without coordinator

**After signing complete**:
- Transaction already executed on Hedera network
- Transaction is immutable and permanent
- Coordinator server can go offline safely

**Best Practice**: Coordinator should keep server online until all sessions complete.

---

### Can I review the transaction before signing?

**Absolutely yes - and you should!**

The dApp **requires** explicit approval:
1. Transaction displays in review UI
2. You must click "Approve & Sign"
3. You can also click "Reject" to refuse signing

**Never sign without reviewing**:
- Check VERIFIED transaction data carefully
- Read all validation warnings
- Verify amounts, accounts, and transaction type
- If anything looks wrong, REJECT

---

## Troubleshooting

### WalletConnect modal doesn't open

**Possible Causes**:
- Browser popup blocker
- Invalid WalletConnect Project ID
- Network issue

**Solutions**:
1. **Disable popup blocker** for dApp domain
2. **Try different browser** (Chrome/Brave recommended)
3. **Check browser console** (F12) for specific error
4. **Contact support** if issue persists

---

### "This wallet doesn't support Hedera"

**Cause**: Selected wallet doesn't implement Hedera WalletConnect spec

**Solution**: Use HashPack or Blade wallet (officially supported)

---

### "Public key not eligible"

**Cause**: Your wallet's public key wasn't added to eligible keys by coordinator

**Solutions**:
1. **Verify public key**: Double-check you sent correct public key to coordinator
2. **Check account**: Ensure you're using correct account in wallet (not a different account)
3. **Contact coordinator**: Ask them to verify eligible keys list

---

### Transaction displays but signature fails

**Possible Causes**:
- Wallet locked
- Insufficient balance for fees
- Transaction expired
- Network issue

**Solutions**:
1. **Unlock wallet**: Ensure wallet is unlocked
2. **Check balance**: Ensure account has HBAR for transaction fees (usually tiny)
3. **Retry**: Click "Approve & Sign" again
4. **Check network**: Verify wallet is on correct network (testnet/mainnet)
5. **Contact coordinator**: May need to re-inject transaction

---

### Ledger signature fails

**Possible Causes**:
- Ledger locked
- Hedera app not open
- USB connection issue
- Firmware outdated

**Solutions**:
1. **Unlock Ledger**: Enter PIN on device
2. **Open Hedera app**: Navigate to Hedera app on Ledger
3. **Reconnect USB**: Try different USB port or cable
4. **Update firmware**: Use Ledger Live to update
5. **Restart**: Close and reopen HashPack, reconnect Ledger

---

### "Session timeout" error

**Cause**: Session expired due to inactivity (default: 30 minutes)

**Solution**:
- Contact coordinator to create new session
- Join with new session credentials
- Complete signing more quickly

**Prevention**: Coordinators can increase timeout when creating session

---

### Mobile wallet can't scan QR code

**Workaround**: Use browser extension instead, or:
1. Manually copy WalletConnect URI
2. Paste in wallet app's WalletConnect input

**Or**:
- Open dApp directly on mobile browser
- Use in-app browser from wallet (if supported)

---

### Mixed session: CLI participant signed but Web participant can't

**Troubleshooting**:
1. **Verify both are in same session**: Check session ID matches
2. **Check server status**: Ensure WebSocket server still running
3. **Review server logs**: Look for errors on coordinator side
4. **Test independently**: Try joining new session with just Web participant

**Note**: CLI and Web participants are fully compatible. If one works, both should work.

---

## Additional Resources

### Official Documentation

- **Hedera Docs**: https://docs.hedera.com/
- **WalletConnect Docs**: https://docs.walletconnect.com/
- **HashPack Docs**: https://www.hashpack.app/developers
- **Blade Docs**: https://www.bladewallet.io/developers

### Support Channels

- **Project Issues**: GitHub repository issues page
- **Hedera Discord**: https://hedera.com/discord
- **HashPack Discord**: https://hashpack.app/discord
- **WalletConnect Support**: https://walletconnect.com/support

### Tutorials

- **Getting Started with HashPack**: https://www.hashpack.app/learn
- **WalletConnect Integration**: https://docs.hedera.com/hedera/tutorials/more-tutorials/walletconnect
- **Ledger Setup**: https://www.hashpack.app/ledger

---

**Ready to use WalletConnect for multi-sig?** Head to the deployed dApp and start signing! 🚀

For more information:
- [Main README](../README.md)
- [dApp README](../dapp/README.md)
- [Integration Testing Guide](../dapp/INTEGRATION_TESTING.md)
- [Quick Start Guide](../dapp/QUICKSTART.md)
