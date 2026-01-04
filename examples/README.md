# Hedera MultiSig Examples

This folder contains example scripts demonstrating various multi-signature workflows with the Hedera network.

## Quick Start

### 1. Configure Environment

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
# Required: Account that pays transaction fees
OPERATOR_ID=0.0.12345

# Optional: Only needed for single-sig transactions
# For multisig, signatures are collected via the signing session
OPERATOR_KEY=302e...

# Network: TEST, MAIN, PREVIEW, or LOCAL (default: TEST)
ENVIRONMENT=TEST
```

### 2. Start a Signing Session Server

For networked multi-signature workflows, start the server first:

```bash
# 2-of-3 multisig with your public keys
npm run multisig-server -- -t 2 -k "pubkey1,pubkey2,pubkey3"
```

The server will display:
- **Session ID** - Share with participants
- **PIN** - Share with participants
- **Server URL** - Usually `ws://localhost:3000` or a tunnel URL

### 3. Connect Participants

Participants can connect via:

**Option A: Browser dApp**
```
Open http://localhost:3001 (if running the dApp)
Enter session ID and PIN
Connect wallet and load keys
```

**Option B: CLI**
```bash
npm run multisig-client -- --url ws://localhost:3000 --session <id> --pin <pin>
```

**Option C: Example Script**
```bash
node examples/networked-participant.js
```

### 4. Inject and Execute Transactions

Once participants are connected and ready, inject a transaction.

**Auto-Detection (Easiest):** When the server starts, it writes a `.multisig-session.json` file. Scripts automatically detect this file, so you can simply run:

```bash
# No session details needed - auto-detected!
node examples/transfer-hbar.js --receiver 0.0.456 --amount 10 --multisig --workflow networked

# Same for other transactions
node examples/transfer-token.js --token 0.0.789 --receiver 0.0.456 --amount 100 --multisig --workflow networked
node examples/associate-token.js --tokens 0.0.789 --action associate --multisig --workflow networked
```

**Manual (if needed):** You can also specify session details explicitly:

```bash
node examples/transfer-hbar.js --receiver 0.0.456 --amount 10 \
  --multisig --workflow networked \
  --server ws://localhost:3000 --session <id> --pin <pin>
```

**Via .env file:** Set defaults in your `.env`:

```bash
SESSION_SERVER=ws://localhost:3000
SESSION_ID=abc123
SESSION_PIN=123456
```

**Priority Order:** CLI args > .env variables > auto-detected session file

---

## Available Examples

### Transaction Scripts

| Script | Description |
|--------|-------------|
| `transfer-hbar.js` | Transfer HBAR between accounts |
| `transfer-token.js` | Transfer fungible tokens (auto-fetches decimals) |
| `associate-token.js` | Associate/dissociate tokens with accounts |

**Common Options:**
- `--multisig` - Enable multi-signature workflow
- `--workflow <type>` - `interactive`, `offline`, or `networked`
- `--server <url>` - WebSocket server URL
- `--session <id>` - Session ID
- `--pin <pin>` - Session PIN
- `--network <net>` - `testnet`, `mainnet`, `previewnet`, or `local`

### Workflow Examples

| Script | Description |
|--------|-------------|
| `networked-multisig-coordinator.js` | Full coordinator example with pre-session pattern |
| `networked-participant.js` | Participant connection and signing flow |
| `complete-lifecycle-workflow.js` | End-to-end tutorial of the entire multisig lifecycle |

### Advanced Examples

| Script | Description |
|--------|-------------|
| `smart-contract-multisig.js` | Deploy and call smart contracts with multisig |
| `basic-usage.js` | Core library usage with TransactionFreezer, SignatureCollector, etc. |

---

## Workflow Types

### Interactive Workflow
All signers are present locally. Keys are entered one by one:

```bash
node examples/transfer-hbar.js --receiver 0.0.456 --amount 10 --multisig --workflow interactive
```

### Offline Workflow
Export transaction to JSON file, collect signatures separately:

```bash
# Export transaction
node examples/transfer-hbar.js --receiver 0.0.456 --amount 10 --multisig --workflow offline

# Sign offline (on air-gapped machine)
npm run sign-tx -- --file transfer-hbar-1234567890.json

# Execute when threshold met
npm run execute-tx -- --file transfer-hbar-1234567890.json
```

### Networked Workflow (Recommended)
Real-time coordination with remote participants:

```bash
# 1. Start server (coordinator)
npm run multisig-server -- -t 2 -k "key1,key2,key3"

# 2. Participants connect (each on their own machine)
npm run multisig-client -- --url <url> --session <id> --pin <pin>

# 3. When ready, inject transaction
node examples/transfer-hbar.js --receiver 0.0.456 --amount 10 \
  --multisig --workflow networked --server <url> --session <id> --pin <pin>

# 4. Participants review and sign in real-time
# 5. Transaction executes automatically when threshold met
```

---

## Network Configuration

Set the network via `--network` flag or `ENVIRONMENT` in `.env`:

| Value | Network | Use Case |
|-------|---------|----------|
| `testnet` / `TEST` | Hedera Testnet | Development and testing |
| `mainnet` / `MAIN` | Hedera Mainnet | Production |
| `previewnet` / `PREVIEW` | Hedera Previewnet | Early feature testing |
| `local` / `LOCAL` | Local Node | Running local Hedera node |

```bash
# Via command line
node examples/transfer-hbar.js --network mainnet --receiver 0.0.456 --amount 10

# Via environment
ENVIRONMENT=MAIN node examples/transfer-hbar.js --receiver 0.0.456 --amount 10
```

---

## Security Notes

1. **Private keys are NEVER transmitted** over the network in networked workflows
2. **Only signatures** are sent to the coordinator
3. **Review transactions carefully** - the dApp shows both verified (on-chain) and unverified (metadata) information
4. **Use hardware wallets** when possible via WalletConnect in the browser dApp
5. **Never commit `.env`** files - they are gitignored by default

---

## Handling Transaction Rejections

When a participant rejects a transaction (via the dApp or CLI), the rejection is propagated back to the coordinator.

### What Happens on Rejection

1. **Participant rejects** - User clicks "Reject" with optional reason
2. **Server broadcasts** - `TRANSACTION_REJECTED` message sent to all participants and coordinator
3. **Coordinator receives** - Script handles rejection and exits cleanly
4. **dApp updates** - Participant's UI returns to waiting state

### Coordinator Script Output

```bash
❌ Transaction rejected by participant f83068eac22bbd54
   Reason: Transaction looks suspicious

❌ Transaction rejected: Transaction looks suspicious
```

### Integrating Rejection Handling

If you're building a custom coordinator, handle the `TRANSACTION_REJECTED` message:

```javascript
ws.on('message', async (data) => {
  const message = JSON.parse(data.toString());

  switch (message.type) {
    case 'TRANSACTION_REJECTED':
      console.log(`Transaction rejected by ${message.payload.participantId}`);
      console.log(`Reason: ${message.payload.reason}`);

      // Clean up and exit
      ws.close();

      // Notify user or retry with different transaction
      break;

    // ... other cases
  }
});
```

### Rejection Message Format

```typescript
interface TransactionRejectedPayload {
  participantId: string;  // ID of participant who rejected
  reason: string;         // Rejection reason (optional, may be generic)
  stats: {
    participantsConnected: number;
    participantsReady: number;
    signaturesCollected: number;
    signaturesRequired: number;
  };
}
```

### Best Practices

1. **Always handle rejections** - Don't leave coordinators hanging
2. **Log rejection reasons** - Useful for debugging and audit trails
3. **Consider retry logic** - Some rejections may be due to user error
4. **Set timeouts** - Don't wait indefinitely for signatures

---

## Troubleshooting

### "Missing OPERATOR_ID"
Set `OPERATOR_ID` in your `.env` file or environment.

### "OPERATOR_KEY required for single-signature transactions"
Either provide `OPERATOR_KEY` or use `--multisig` flag for multi-signature workflow.

### "Session not found"
The session may have expired (default 30 minutes) or the session ID is incorrect.

### "Authentication failed"
Check that the PIN is correct and the session is still active.

### Connection issues
- Ensure the server is running
- Check firewall settings for WebSocket connections
- For remote participants, ensure tunnel is enabled on server

### "Transaction rejected"
A participant rejected the transaction. Check the reason provided and:
- Verify the transaction details are correct
- Confirm with the participant why they rejected
- Create a new transaction if needed (rejected transactions cannot be retried)

---

## More Information

- [Main README](../README.md) - Full library documentation
- [Setup Guide](../SETUP_GUIDE.md) - Step-by-step team onboarding
- [Testing Guide](../TESTING.md) - Testing procedures
