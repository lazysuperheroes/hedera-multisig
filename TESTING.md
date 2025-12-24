# Testing Guide - Hedera Multi-Signature Library

This guide provides comprehensive instructions for testing the hedera-multisig library, including unit tests, integration tests, and end-to-end testing scenarios.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Test Environment Setup](#test-environment-setup)
3. [Running Tests](#running-tests)
4. [Integration Tests](#integration-tests)
5. [End-to-End Testing](#end-to-end-testing)
6. [Team Testing Workflow](#team-testing-workflow)
7. [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run only unit tests
npm run test:unit

# Run integration tests (requires Hedera credentials)
OPERATOR_ID=0.0.XXX OPERATOR_KEY=xxx npm test
```

---

## Test Environment Setup

### Prerequisites

1. **Node.js** (v16 or higher)
2. **Hedera Testnet Account**
   - Get free testnet HBAR: https://portal.hedera.com/
   - Save your account ID and private key

3. **Environment Variables**

Create a `.env` file in the project root:

```bash
# Operator account (for fee payment)
OPERATOR_ID=0.0.12345
OPERATOR_KEY=302e020100300506032b657004220420...

# Optional: For ngrok tunnel (networked workflow)
NGROK_AUTH_TOKEN=your_ngrok_token
```

### Optional: Multiple Test Accounts

For comprehensive testing, set up 3-5 test accounts:

```bash
# Account 1 (Main operator)
OPERATOR_ID=0.0.12345
OPERATOR_KEY=302e020100300506032b657004220420...

# Account 2 (Participant 1)
PARTICIPANT1_ID=0.0.12346
PARTICIPANT1_KEY=302e020100300506032b657004220420...

# Account 3 (Participant 2)
PARTICIPANT2_ID=0.0.12347
PARTICIPANT2_KEY=302e020100300506032b657004220420...
```

---

## Running Tests

### Unit Tests

Test core functionality without network calls:

```bash
npm run test:unit
```

**What's tested:**
- Key providers (Env, Prompt, EncryptedFile)
- Multi-key type handling
- Signature verification
- Transaction encoding/decoding

### Integration Tests

Test with actual Hedera network:

```bash
# Requires OPERATOR_ID and OPERATOR_KEY
npm test
```

**What's tested:**
- Transaction freezing and execution
- Signature collection
- Account updates
- Network communication

### Networked Workflow Tests

Test the complete networked multi-sig workflow:

```bash
# Run integration tests for networked workflow
OPERATOR_ID=0.0.XXX OPERATOR_KEY=xxx npm run test:workflows
```

**What's tested:**
- Pre-session creation
- WebSocket server startup
- Participant connections
- Transaction injection
- Signature collection
- WorkflowOrchestrator integration

---

## Integration Tests

### Test 1: Pre-Session Workflow

**File:** `test/networked-workflow.test.js`

Tests the complete pre-session pattern:

```javascript
describe('Pre-Session Creation', function() {
  it('should create a pre-session without transaction')
  it('should start WebSocket server')
});
```

**Manual Testing:**

```bash
# Terminal 1: Start coordinator
node examples/networked-multisig-coordinator.js

# Terminal 2-4: Start participants
node cli/participant.js --url ws://localhost:3000 --session <id> --pin <pin>
```

### Test 2: WorkflowOrchestrator Integration

```javascript
describe('WorkflowOrchestrator Integration', function() {
  it('should create networked session via orchestrator')
  it('should detect active session')
  it('should execute transaction with session')
});
```

### Test 3: Error Handling

```javascript
describe('Networked Workflow Error Handling', function() {
  it('should fail to create session without threshold')
  it('should fail participant connection with wrong PIN')
  it('should fail to set ready without keys loaded')
});
```

---

## End-to-End Testing

### Scenario 1: Simple Transfer with 2-of-3 Multi-Sig

**Setup:**

1. Create or convert a test account to multi-sig:

```bash
# Generate keys for 3 participants
node scripts/collect-team-keys.js --mode coordinator

# Set up the multi-sig account
ACCOUNT_ID=0.0.XXX ACCOUNT_KEY=xxx node scripts/setup-multisig-account.js
```

2. Create a pre-session:

```bash
# Terminal 1: Coordinator
node cli/server.js -t 2 -k "key1,key2,key3" -p 3
```

3. Connect participants:

```bash
# Terminal 2: Participant 1
node cli/participant.js --url <url> --session <id> --pin <pin>

# Terminal 3: Participant 2
node cli/participant.js --url <url> --session <id> --pin <pin>

# Terminal 4: Participant 3
node cli/participant.js --url <url> --session <id> --pin <pin>
```

4. Inject transaction (coordinator presses ENTER when ready)

5. Participants review and approve (type "YES")

6. Transaction executes when threshold (2) is met

**Expected Results:**
- ✅ All participants connect successfully
- ✅ All participants mark as ready
- ✅ Transaction is injected within 120 seconds
- ✅ Transaction details displayed correctly
- ✅ Metadata validation warnings shown
- ✅ 2 signatures collected
- ✅ Transaction executes successfully

### Scenario 2: Remote Participants (with Tunnel)

**Setup:**

1. Start coordinator with tunnel enabled:

```bash
NGROK_AUTH_TOKEN=xxx node cli/server.js -t 2 -k "key1,key2,key3"
```

2. Share public URL with remote participants

3. Remote participants connect using public URL:

```bash
node cli/participant.js --url wss://abc123.ngrok.io --session <id> --pin <pin>
```

**Expected Results:**
- ✅ Tunnel established (ngrok or localtunnel)
- ✅ Remote participants can connect
- ✅ All workflow steps work remotely
- ✅ Transaction executes successfully

### Scenario 3: Metadata Validation Test

**Purpose:** Verify that participants see warnings for mismatched metadata.

**Setup:**

1. Create session and connect participants

2. Inject transaction with INCORRECT metadata:

```javascript
await sessionManager.injectTransaction(sessionId, transaction, {
  metadata: {
    description: 'Transfer 100 HBAR', // Actual: 1000 tinybars
    amount: { value: 100, unit: 'HBAR' }, // Mismatch!
    recipient: { address: '0.0.999' } // Wrong account!
  }
});
```

**Expected Results:**
- ✅ Participants see transaction details
- ⚠️ Metadata validation warnings displayed:
  - "Metadata amount not found in transaction"
  - "Metadata recipient not found in transaction"
- ✅ Participants can still review VERIFIED data
- ✅ Participants can approve or reject

---

## Team Testing Workflow

### Step-by-Step Team Onboarding

**For Project Teams:**

#### Day 1: Key Collection

1. **Coordinator runs:**
```bash
node scripts/collect-team-keys.js --mode coordinator
```

2. **Team members run:**
```bash
node scripts/collect-team-keys.js --mode participant
```

3. **Team members send** public keys to coordinator

#### Day 2: Account Setup

1. **Coordinator sets up multi-sig account:**
```bash
ACCOUNT_ID=0.0.XXX ACCOUNT_KEY=xxx node scripts/setup-multisig-account.js
```

2. **Load collected keys** from `public-keys.txt`

3. **Set threshold** (e.g., 2-of-3, 3-of-5)

4. **Save configuration** for team reference

#### Day 3: First Test Transaction

1. **Coordinator creates session:**
```bash
node cli/server.js -t 2 -k "key1,key2,key3" -p 3
```

2. **Share credentials** with team:
   - Server URL
   - Session ID
   - PIN

3. **Team members connect:**
```bash
node cli/participant.js --url <url> --session <id> --pin <pin>
```

4. **Run test transaction:**
   - Small HBAR transfer
   - Verify all participants can review
   - Confirm signatures are collected
   - Verify transaction executes

#### Ongoing: Regular Operations

Use the established workflow for:
- Treasury operations
- Smart contract deployments
- Account updates
- Token operations

---

## Testing Checklist

### Pre-Session Workflow
- [ ] Create pre-session without transaction
- [ ] WebSocket server starts successfully
- [ ] Tunnel establishes (if enabled)
- [ ] Participants can connect
- [ ] Participants can load keys
- [ ] Participants can mark ready
- [ ] All participants ready triggers event
- [ ] Transaction can be injected
- [ ] Session status updates correctly

### Transaction Review
- [ ] Transaction details displayed correctly
- [ ] Transaction type identified
- [ ] Amounts extracted correctly
- [ ] Accounts extracted correctly
- [ ] Metadata displayed as UNVERIFIED
- [ ] Metadata validation warnings shown
- [ ] Transaction checksum calculated
- [ ] User can approve
- [ ] User can reject

### Signature Collection
- [ ] Participant signature submitted
- [ ] Signature verified
- [ ] Signature count updated
- [ ] Threshold detection works
- [ ] Transaction executes when threshold met
- [ ] All participants notified

### Error Handling
- [ ] Wrong PIN rejected
- [ ] Expired session handled
- [ ] Disconnection handled gracefully
- [ ] Invalid transaction rejected
- [ ] Network errors handled
- [ ] Timeout handled correctly

### WorkflowOrchestrator
- [ ] createNetworkedSession works
- [ ] executeWithSession works
- [ ] detectActiveSession works
- [ ] Session file created/deleted
- [ ] Cleanup works properly

---

## Troubleshooting

### Common Issues

#### 1. Tests Failing: "OPERATOR_ID not set"

**Solution:**
```bash
export OPERATOR_ID=0.0.12345
export OPERATOR_KEY=302e020100300506032b657004220420...
```

#### 2. Participant Connection Fails

**Possible causes:**
- Wrong PIN
- Session expired
- Server not running
- Firewall blocking connection

**Debug:**
```bash
# Check server is running
curl http://localhost:3000

# Check session is active
# Look for session ID in coordinator output

# Try local URL first
ws://localhost:3000
```

#### 3. Transaction Injection Fails

**Error:** "Cannot inject transaction - session status is ..."

**Solution:** Session must be in 'waiting' state. Cannot inject twice.

#### 4. Tunnel Not Working

**Solutions:**
```bash
# For ngrok - set auth token
export NGROK_AUTH_TOKEN=your_token

# For localtunnel - no auth needed
# Falls back automatically

# Disable tunnel for local testing
node cli/server.js --no-tunnel
```

#### 5. Signature Threshold Not Met

**Check:**
- Enough participants connected?
- All approved the transaction?
- Threshold set correctly?

**Debug:**
```javascript
// In coordinator output, look for:
"Signatures: 2/3" // Need 3 signatures, only have 2
```

---

## Performance Benchmarks

Expected timings (testnet):

| Operation | Time |
|-----------|------|
| Pre-session creation | < 2 seconds |
| Participant connection | < 1 second |
| Key loading | < 1 second |
| Transaction injection | < 2 seconds |
| Transaction review | User-dependent |
| Signature submission | < 1 second |
| Transaction execution | 3-5 seconds |
| **Total (2-of-3)** | ~10-15 seconds |

**120-Second Constraint:**
- Transaction must be created, frozen, injected, reviewed, signed, and executed within 120 seconds
- Pre-session phase (connect + load keys) is NOT counted
- Only the transaction phase counts

---

## Continuous Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v2

      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '16'

      - name: Install dependencies
        run: npm install

      - name: Run unit tests
        run: npm run test:unit

      - name: Run integration tests
        env:
          OPERATOR_ID: ${{ secrets.HEDERA_OPERATOR_ID }}
          OPERATOR_KEY: ${{ secrets.HEDERA_OPERATOR_KEY }}
        run: npm test
```

---

## Next Steps

- See `SETUP_GUIDE.md` for team onboarding
- See `examples/` for code examples
- See `server/README.md` for protocol details
- See main `README.md` for API documentation

---

**Need Help?**

- File an issue: https://github.com/lazysuperheroes/hedera-multisig/issues
- Check examples: `examples/` directory
- Review test files: `test/` directory
