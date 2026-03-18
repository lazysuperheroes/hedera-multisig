# Manual E2E Testing Checklist (v2.0)

> Comprehensive checklist for integration testing the Hedera MultiSig system.
> Updated March 2026 to cover all v2.0 features.

## Prerequisites

- [ ] Node.js 18+ installed
- [ ] HashPack wallet installed (browser extension)
- [ ] Testnet HBAR in wallet (get from https://portal.hedera.com/faucet)
- [ ] Two testnet accounts with known private keys
- [ ] `.env` configured with OPERATOR_ID, OPERATOR_KEY, HEDERA_NETWORK=testnet
- [ ] `npm install` completed at project root and `cd dapp && npm install`

---

## Test 1: CLI Server + CLI Participant (Basic Flow)

### Terminal 1 — Start Server

```bash
npx hedera-multisig server --port 3001 --threshold 1 --keys "YOUR_PUBLIC_KEY"
```

- [ ] Server starts without errors
- [ ] Displays: Session ID, PIN, **Coordinator Token**, **Agent API Key**
- [ ] Shows connection string (`hmsc:...`) and QR code
- [ ] Connection string is valid base64

### Terminal 2 — Join with Connection String

```bash
npx hedera-multisig participant --connect hmsc:YOUR_CONNECTION_STRING --keyfile keys.enc
```

- [ ] `--connect` parses connection string correctly
- [ ] Client connects and authenticates
- [ ] Shows "waiting for transaction" status

### Terminal 1 — Inject Transaction

```bash
npx hedera-multisig transfer hbar --from 0.0.YOUR_ACCOUNT --to 0.0.OTHER_ACCOUNT --amount 1
```

- [ ] Frozen transaction output (base64 + checksum)
- [ ] Participant receives transaction details

### Terminal 2 — Sign

- [ ] Transaction details displayed correctly (type, amounts, accounts)
- [ ] VERIFIED data section shown
- [ ] Can approve/sign transaction
- [ ] Signature accepted by server

---

## Test 2: Coordinator Panel (dApp /create)

### Start Server (same as Test 1)

### Browser — Open Coordinator Panel

1. Navigate to `http://localhost:3000/create` (or Vercel URL)

- [ ] Page loads with 3-step flow
- [ ] Step 1: Can enter Server URL, Session ID, PIN, Coordinator Token
- [ ] Connects to WebSocket as coordinator
- [ ] Shows session info (threshold, eligible keys, status)

### Build Transaction

- [ ] Dropdown shows 5 transaction types
- [ ] HBAR Transfer: From, To, Amount fields render
- [ ] Token Transfer: Token ID, From, To, Amount fields render
- [ ] NFT Transfer: Token ID, Serial, From, To fields render
- [ ] Token Association: Account, Tokens fields render
- [ ] Contract Call: Contract ID, Gas, Data fields render
- [ ] **Balance display**: After entering "From" account and tabbing out, balance card shows
- [ ] "Build & Inject" button creates and sends transaction

### Share Credentials

- [ ] Session credentials displayed (Session ID, PIN, Coordinator Token)
- [ ] QR code renders
- [ ] Copy buttons work for each field
- [ ] Connection string is copiable

---

## Test 3: dApp Participant Flow (WalletConnect)

### Browser — Join via dApp

1. Navigate to `/join`
2. Enter connection string or manual details

- [ ] Connection string paste works
- [ ] QR scanner opens (if camera available)
- [ ] Manual entry form works
- [ ] Navigates to `/session/[id]`

### Wallet Connection

- [ ] "Connect Wallet" button appears
- [ ] HashPack connection modal opens
- [ ] Wallet connects (account ID shown)
- [ ] Public key displayed
- [ ] Network badge matches (testnet/mainnet)
- [ ] Shows as "Ready" in session

### Transaction Review

- [ ] Transaction received notification
- [ ] **VERIFIED** data section (green): type, amounts, checksum
- [ ] **UNVERIFIED** metadata section (yellow, collapsed by default)
- [ ] Countdown timer visible (120 seconds)
- [ ] Countdown color changes (<60s yellow, <30s red)
- [ ] Approve and Reject buttons visible
- [ ] HashPack prompts for signature on Approve
- [ ] Rejection sends reason to server

### Post-Signing

- [ ] Signature progress bar updates
- [ ] When threshold met, shows "Threshold Met!"
- [ ] Mirror node polling begins
- [ ] HashScan link displayed
- [ ] Transaction result shown (SUCCESS/FAILURE)

---

## Test 4: Full 2-of-3 Multi-Sig Flow

### Setup

```bash
npx hedera-multisig server --port 3001 --threshold 2 --keys "KEY1,KEY2,KEY3" --tunnel ngrok
```

### Mixed Participants

- [ ] Participant 1 joins via CLI (`--connect`)
- [ ] Participant 2 joins via dApp + HashPack
- [ ] Both show as "Ready" in server output
- [ ] ParticipantList component shows both

### Signing

- [ ] Inject real testnet transfer
- [ ] Both participants see transaction
- [ ] Participant 1 signs via CLI
- [ ] Participant 2 signs via HashPack
- [ ] Threshold met (2/3 signatures)
- [ ] Transaction executes on testnet
- [ ] Receipt shows SUCCESS on both terminals
- [ ] HashScan confirms transaction

---

## Test 5: Offline Signing Workflow

### Freeze

```bash
npx hedera-multisig offline freeze -t transfer --from 0.0.X --to 0.0.Y --amount 5
```

- [ ] Outputs base64 + checksum
- [ ] `--raw` outputs only base64
- [ ] `--json` outputs JSON envelope
- [ ] `-o file.txt` writes to file

### Decode

```bash
npx hedera-multisig offline decode -b "BASE64_STRING"
```

- [ ] Displays transaction type, ID, details
- [ ] `-c CHECKSUM` verifies checksum (pass/fail)
- [ ] `--abi token.json` decodes contract call functions
- [ ] Piped input works: `echo "BASE64" | npx hedera-multisig offline decode`

### Sign (Non-Interactive)

```bash
npx hedera-multisig sign --base64 "BASE64" --key-file keys.enc --passphrase secret --json
```

- [ ] Outputs JSON with signatureTuple, publicKey, signature, verified
- [ ] No interactive prompts
- [ ] Exit code 0 on success

### Execute

```bash
npx hedera-multisig offline execute -b "BASE64" -s "pubkey1:sig1" -s "pubkey2:sig2" -t 2
```

- [ ] Executes transaction on testnet
- [ ] Shows receipt with status
- [ ] `--dry-run` validates without executing

---

## Test 6: Scheduled Transactions

### Create Schedule

```bash
npx hedera-multisig offline freeze -t transfer --from 0.0.X --to 0.0.Y --amount 1 --raw > tx.txt
npx hedera-multisig schedule create --base64 "$(cat tx.txt)" --memo "Test schedule" --json
```

- [ ] Schedule created on testnet
- [ ] Schedule ID returned

### Sign Schedule

```bash
npx hedera-multisig schedule sign --schedule-id 0.0.SCHEDULE_ID --key-file keys.enc --passphrase secret
```

- [ ] Signature submitted successfully
- [ ] If threshold met, shows "Schedule executed"

### Query Status

```bash
npx hedera-multisig schedule status --schedule-id 0.0.SCHEDULE_ID --json
```

- [ ] Shows executed/pending status
- [ ] Lists signatories
- [ ] Shows expiration time

---

## Test 7: Transaction History (/history)

### After completing any signing flow:

- [ ] Navigate to `/history`
- [ ] Recent transaction appears in table
- [ ] Date, type, TX ID, status, network columns populated
- [ ] Copy button works on TX ID
- [ ] HashScan link opens correct page
- [ ] Status filter (All/Success/Failure) works
- [ ] Date range filter works
- [ ] "Export CSV" downloads a CSV file
- [ ] "Clear History" with confirmation works

---

## Test 8: All Transaction Types via CLI

Test each type freezes correctly:

```bash
# HBAR Transfer
npx hedera-multisig offline freeze -t transfer --from 0.0.X --to 0.0.Y --amount 10

# Token Transfer
npx hedera-multisig offline freeze -t token-transfer --token 0.0.T --from 0.0.X --to 0.0.Y --amount 100

# NFT Transfer
npx hedera-multisig offline freeze -t nft-transfer --token 0.0.T --serial 1 --from 0.0.X --to 0.0.Y

# Token Association
npx hedera-multisig offline freeze -t token-associate --account 0.0.X --tokens 0.0.T1,0.0.T2

# Token Dissociation
npx hedera-multisig offline freeze -t token-dissociate --account 0.0.X --tokens 0.0.T1

# Account Update
npx hedera-multisig offline freeze -t account-update --account 0.0.X --new-key PUBLIC_KEY

# Contract Execute
npx hedera-multisig offline freeze -t contract-execute --contract 0.0.C --gas 100000 --data 0xABC123

# Contract Execute with ABI
npx hedera-multisig offline freeze -t contract-execute --contract 0.0.C --abi ./token.json --function transfer --args "0.0.Y,1000"

# Token Create
npx hedera-multisig offline freeze -t token-create --name "Test" --symbol "TST" --decimals 8 --initial-supply 1000000

# Token Mint
npx hedera-multisig offline freeze -t token-mint --token 0.0.T --amount 1000

# Token Burn
npx hedera-multisig offline freeze -t token-burn --token 0.0.T --amount 500
```

- [ ] Each type produces valid base64 output
- [ ] Each can be decoded with `offline decode`
- [ ] No crashes or unhandled errors

---

## Test 9: dApp UI/UX Checks

### Navigation

- [ ] NavBar shows: Join, Coordinator, History links
- [ ] Links navigate correctly
- [ ] Active page highlighted (if applicable)

### Landing Page (`/`)

- [ ] Three use case cards visible (Treasury, Agent, Scheduled)
- [ ] Security features row visible
- [ ] "Join Signing Session" button → /join
- [ ] "Coordinator Panel" button → /create
- [ ] GitHub and npm links work

### Theme Toggle

- [ ] Toggle button visible in navbar
- [ ] Light → Dark → System → Light cycle
- [ ] Dark mode: All pages render correctly
- [ ] Theme persists after reload
- [ ] System mode follows OS preference

### Mobile Responsive

- [ ] Test at 375px width (phone)
- [ ] Navigation collapses appropriately
- [ ] All buttons tappable
- [ ] Forms usable on mobile

### Accessibility

- [ ] Tab through all interactive elements
- [ ] Focus rings visible
- [ ] Screen reader: buttons have labels

---

## Test 10: Error Handling

- [ ] Invalid session ID → Error message
- [ ] Wrong PIN → "Invalid session ID or PIN"
- [ ] Server disconnect → "Connection lost" + auto-reconnect attempt
- [ ] Wallet rejection → "Rejected" status
- [ ] Session expired → Expiration message
- [ ] Transaction expired (120s) → Timer turns red, signing disabled
- [ ] Rate limiting → "Too many failed attempts" after 5 wrong PINs
- [ ] Coordinator token wrong → "Invalid credentials or coordinator token"

---

## Quick Smoke Test (10 minutes)

If short on time:

1. `npx hedera-multisig server --port 3001 -t 1 -k "YOUR_KEY"`
2. Note Session ID, PIN, Coordinator Token
3. Open `/create`, enter server details + coordinator token
4. Build an HBAR transfer, inject
5. Open `/join` in another tab, enter connection string
6. Connect HashPack, sign
7. Check `/history` for the entry
8. Verify on HashScan

---

## Test Results

| Test | Date | Result | Notes |
|------|------|--------|-------|
| Test 1: CLI + CLI (basic) | | | |
| Test 2: Coordinator Panel | | | |
| Test 3: dApp + WalletConnect | | | |
| Test 4: 2-of-3 Multi-Sig | | | |
| Test 5: Offline Workflow | | | |
| Test 6: Scheduled TX | | | |
| Test 7: TX History | | | |
| Test 8: All TX Types | | | |
| Test 9: UI/UX | | | |
| Test 10: Error Handling | | | |

---

*Last updated: March 2026 (v2.0)*
