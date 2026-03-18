# Agent Signing SDK Integration Guide

## What is the Agent Signing SDK?

The Agent Signing SDK enables headless, automated transaction signing for Hedera multi-sig workflows. It allows bots, AI agents, and automated policy engines to participate in signing sessions without human interaction.

An agent connects to a signing session via WebSocket, receives frozen transactions, evaluates them against configurable policy rules, and signs automatically when all conditions are met. If a policy rule rejects the transaction, the agent sends a rejection message back to the session coordinator.

Key properties:
- No readline prompts or console UI -- all communication via events and callbacks
- Private keys never leave the agent process -- only signatures are transmitted
- Composable policy rules with AND logic -- all rules must pass for approval
- Automatic reconnection on connection loss
- Full protocol compatibility with human CLI and WalletConnect participants in the same session

---

## Quick Start

```javascript
const { AgentSigningClient } = require('@lazysuperheroes/hedera-multisig/client');
const { PolicyEngine, MaxAmountRule, AllowedRecipientsRule } = require('@lazysuperheroes/hedera-multisig/client/PolicyEngine');

// 1. Define a policy
const policy = new PolicyEngine()
  .addRule(new MaxAmountRule(500))   // Max 500 HBAR per transfer
  .addRule(new AllowedRecipientsRule(['0.0.1234', '0.0.5678']));

// 2. Create the agent
const agent = new AgentSigningClient({
  approvalPolicy: policy.evaluate.bind(policy),
  label: 'treasury-bot',
  maxReconnectAttempts: 10,
  reconnectInterval: 5000,
  autoReady: true,
});

// 3. Register event handlers
agent.on('connected', ({ participantId, sessionInfo }) => {
  console.log(`Connected as ${participantId}`);
});

agent.on('transactionReceived', ({ txDetails, metadata }) => {
  console.log('Evaluating transaction:', txDetails.type);
});

agent.on('approved', ({ txDetails, reason }) => {
  console.log('Transaction approved, signing...');
});

agent.on('rejected', ({ txDetails, reason }) => {
  console.log('Transaction rejected:', reason);
});

agent.on('signed', ({ publicKey, signature }) => {
  console.log('Signature submitted');
});

agent.on('transactionExecuted', (payload) => {
  console.log('Transaction executed:', payload.transactionId);
  agent.disconnect();
});

agent.on('error', ({ message, code }) => {
  console.error('Agent error:', message);
});

// 4. Connect to the session
await agent.connect(
  'wss://multisig-server.example.com',
  'session-abc-123',
  '847291',            // PIN from session creation
  process.env.AGENT_PRIVATE_KEY
);
```

---

## Built-in Policy Rules

All rules implement the `evaluate(txDetails, metadata)` interface and return `{ approved: boolean, reason?: string }`.

### MaxAmountRule

Rejects transactions where any single transfer exceeds a maximum HBAR amount.

```javascript
const { MaxAmountRule } = require('@lazysuperheroes/hedera-multisig/client/PolicyEngine');

// Reject any transfer over 1000 HBAR
const rule = new MaxAmountRule(1000);
```

The rule inspects `txDetails.transfers` and converts tinybar amounts to HBAR for comparison. Transactions without transfers (e.g., token associate) pass automatically.

### AllowedRecipientsRule

Only approves transactions that send funds to whitelisted account IDs.

```javascript
const { AllowedRecipientsRule } = require('@lazysuperheroes/hedera-multisig/client/PolicyEngine');

// Only allow transfers to these accounts
const rule = new AllowedRecipientsRule(['0.0.1234', '0.0.5678', '0.0.9999']);
```

Only positive-amount transfers (recipients) are checked. Debited accounts (negative amounts) are not restricted. Transactions without transfers pass automatically.

### AllowedTransactionTypesRule

Restricts which Hedera transaction types the agent will sign.

```javascript
const { AllowedTransactionTypesRule } = require('@lazysuperheroes/hedera-multisig/client/PolicyEngine');

// Only sign transfers and token associations
const rule = new AllowedTransactionTypesRule([
  'TransferTransaction',
  'TokenAssociateTransaction',
]);
```

Matches against `txDetails.type` or `txDetails.transactionType`. Rejects unknown types (where neither field is set).

### TimeWindowRule

Restricts approval to specific UTC hours.

```javascript
const { TimeWindowRule } = require('@lazysuperheroes/hedera-multisig/client/PolicyEngine');

// Only approve between 09:00 and 17:00 UTC
const rule = new TimeWindowRule(9, 17);

// Overnight window (wraps midnight): 22:00 to 06:00 UTC
const overnightRule = new TimeWindowRule(22, 6);
```

### RateLimitRule

Limits the number of approvals per rolling hour.

```javascript
const { RateLimitRule } = require('@lazysuperheroes/hedera-multisig/client/PolicyEngine');

// Max 10 approvals per hour
const rule = new RateLimitRule(10);
```

The rule maintains an in-memory timestamp array and cleans entries older than one hour on each evaluation. Note: the counter resets if the agent process restarts.

---

## Policy Presets

Presets combine multiple rules into a ready-to-use PolicyEngine.

### createTreasuryAgentPolicy

For treasury management bots that handle routine outbound transfers.

```javascript
const { createTreasuryAgentPolicy } = require('@lazysuperheroes/hedera-multisig/client/PolicyEngine');

const policy = createTreasuryAgentPolicy({
  maxHbar: 1000,
  allowedRecipients: ['0.0.1234', '0.0.5678'],
  allowedTypes: ['TransferTransaction', 'TokenAssociateTransaction'], // default
  maxPerHour: 20,
});

const agent = new AgentSigningClient({
  approvalPolicy: policy.evaluate.bind(policy),
});
```

### createApprovalBotPolicy

For general-purpose approval bots with time and rate constraints.

```javascript
const { createApprovalBotPolicy } = require('@lazysuperheroes/hedera-multisig/client/PolicyEngine');

const policy = createApprovalBotPolicy({
  allowedTypes: ['TransferTransaction'],
  startHour: 9,
  endHour: 17,
  maxPerHour: 50,
});
```

---

## Custom Rules

Implement the `evaluate` interface to create custom policy rules.

```javascript
class MinimumMemoRule {
  /**
   * Require a memo on every transaction.
   */
  async evaluate(txDetails, metadata) {
    if (!txDetails.memo || txDetails.memo.trim().length === 0) {
      return { approved: false, reason: 'Transaction must include a memo' };
    }
    return { approved: true };
  }
}

class CoordinatorWhitelistRule {
  constructor(trustedCoordinators) {
    this.trusted = new Set(trustedCoordinators);
  }

  async evaluate(txDetails, metadata) {
    const coordinator = metadata?.coordinatorId || metadata?.createdBy;
    if (!coordinator || !this.trusted.has(coordinator)) {
      return { approved: false, reason: `Untrusted coordinator: ${coordinator}` };
    }
    return { approved: true };
  }
}

// Use in a policy
const policy = new PolicyEngine()
  .addRule(new MaxAmountRule(500))
  .addRule(new MinimumMemoRule())
  .addRule(new CoordinatorWhitelistRule(['coordinator-abc']));
```

Rules compose with AND logic. If any rule returns `{ approved: false }`, the entire policy rejects and the agent sends a `TRANSACTION_REJECTED` message. The `reason` strings from all failed rules are joined with semicolons.

---

## Events

Register event handlers with `agent.on(event, handler)`.

| Event | Payload | Description |
|---|---|---|
| `connected` | `{ participantId, sessionInfo }` | Successfully authenticated to session |
| `ready` | (none) | Agent signaled ready with public key |
| `transactionReceived` | `{ txDetails, metadata }` | Transaction received, policy evaluation starting |
| `approved` | `{ txDetails, reason }` | Policy approved the transaction |
| `rejected` | `{ txDetails, reason }` | Policy rejected the transaction |
| `signed` | `{ publicKey, signature }` | Signature submitted to server |
| `signatureAccepted` | `{ ... }` | Server accepted the signature |
| `thresholdMet` | `{ ... }` | Signing threshold reached |
| `transactionExecuted` | `{ transactionId, ... }` | Transaction executed on Hedera network |
| `transactionExpired` | `{ ... }` | Transaction validity window (120s) expired |
| `sessionExpired` | (none) | Session expired; agent auto-disconnects |
| `error` | `{ message, code }` | Error occurred |
| `disconnected` | (none) | WebSocket connection closed |
| `reconnectFailed` | (none) | All reconnection attempts exhausted |

---

## Authentication

Agents authenticate to signing sessions using the same mechanism as human participants.

### PIN Authentication (Initial Connection)

When a session is created, the coordinator receives a PIN. Pass this PIN to `agent.connect()`:

```javascript
await agent.connect(serverUrl, sessionId, pin, privateKey);
```

The agent sends an `AUTH` message with `{ sessionId, role: 'participant', label, pin }`. On success, the server returns `AUTH_SUCCESS` with a `reconnectionToken`.

### Reconnection Token

After initial authentication, the server issues a reconnection token. On subsequent connections (after disconnect), the agent uses the token instead of the PIN:

```javascript
// Handled automatically -- the agent stores the reconnectionToken
// and uses it for reconnection attempts
```

### API Key Authentication

For programmatic session creation, agents can authenticate with an API key issued during session creation. The API key is passed in the same `pin` field:

```javascript
await agent.connect(serverUrl, sessionId, apiKey, privateKey);
```

---

## Reconnection Behavior

The AgentSigningClient automatically attempts reconnection when the WebSocket connection drops unexpectedly.

Configuration:

```javascript
const agent = new AgentSigningClient({
  approvalPolicy: policy.evaluate.bind(policy),
  maxReconnectAttempts: 10,    // default: 10
  reconnectInterval: 5000,     // default: 5000ms
});
```

Behavior:
1. On unexpected disconnect, the agent waits `reconnectInterval` milliseconds
2. Reconnection uses the stored `reconnectionToken` (no PIN needed)
3. After `maxReconnectAttempts` failures, the agent emits `reconnectFailed`
4. Calling `agent.disconnect()` prevents reconnection (intentional disconnect)
5. Successful reconnection resets the attempt counter to 0

---

## Security Considerations

### Key Management

- Store agent private keys in secure environments (HSM, KMS, encrypted environment variables)
- Never hard-code private keys in source code
- Use separate keys for agent signing -- do not reuse operator keys
- Rotate agent keys on a regular schedule

### Policy Validation

- Always define explicit policy rules -- never use a blanket `() => ({ approved: true })` policy in production
- Combine multiple rules (amount limits + recipient whitelist + type restrictions) for defense in depth
- Use `RateLimitRule` to prevent runaway automated approvals
- Use `TimeWindowRule` to restrict signing to business hours

### Monitoring

- Listen to `rejected` and `error` events and log them to an external monitoring system
- Track approval/rejection ratios for anomaly detection
- Monitor reconnection frequency -- frequent reconnects may indicate network issues
- Set up alerts for `reconnectFailed` events

### Network Security

- Always use `wss://` (TLS) connections in production
- Validate the server certificate
- Use firewall rules to restrict which IPs can connect to the signing server
- Consider using the tunnel feature (ngrok/localtunnel) only for development

---

## Example: Treasury Bot

A complete example of a treasury bot that approves HBAR transfers under 1000 HBAR to whitelisted accounts.

```javascript
const { AgentSigningClient } = require('@lazysuperheroes/hedera-multisig/client');
const {
  PolicyEngine,
  MaxAmountRule,
  AllowedRecipientsRule,
  AllowedTransactionTypesRule,
  RateLimitRule,
} = require('@lazysuperheroes/hedera-multisig/client/PolicyEngine');

// Whitelisted accounts (payroll, vendor payments, operational)
const ALLOWED_RECIPIENTS = [
  '0.0.100001',  // Payroll account
  '0.0.100002',  // Vendor payments
  '0.0.100003',  // Operational expenses
];

// Build policy
const policy = new PolicyEngine()
  .addRule(new MaxAmountRule(1000))
  .addRule(new AllowedRecipientsRule(ALLOWED_RECIPIENTS))
  .addRule(new AllowedTransactionTypesRule(['TransferTransaction']))
  .addRule(new RateLimitRule(50));

// Create agent
const agent = new AgentSigningClient({
  approvalPolicy: policy.evaluate.bind(policy),
  label: 'treasury-bot-v1',
  maxReconnectAttempts: 20,
  reconnectInterval: 3000,
});

// Logging
agent.on('connected', ({ participantId }) => {
  console.log(`[Treasury Bot] Connected: ${participantId}`);
});

agent.on('transactionReceived', ({ txDetails }) => {
  console.log(`[Treasury Bot] Evaluating: ${txDetails.type}`);
  if (txDetails.transfers) {
    for (const t of txDetails.transfers) {
      const hbar = Math.abs(parseFloat(t.amount)) / 100_000_000;
      console.log(`  ${t.accountId}: ${hbar} HBAR`);
    }
  }
});

agent.on('approved', ({ reason }) => {
  console.log(`[Treasury Bot] APPROVED - signing transaction`);
});

agent.on('rejected', ({ reason }) => {
  console.log(`[Treasury Bot] REJECTED: ${reason}`);
});

agent.on('signed', () => {
  console.log(`[Treasury Bot] Signature submitted`);
});

agent.on('transactionExecuted', (payload) => {
  console.log(`[Treasury Bot] Executed: ${payload.transactionId}`);
});

agent.on('error', ({ message }) => {
  console.error(`[Treasury Bot] Error: ${message}`);
});

agent.on('reconnectFailed', () => {
  console.error(`[Treasury Bot] All reconnection attempts exhausted`);
  process.exit(1);
});

// Connect
async function main() {
  const serverUrl = process.env.MULTISIG_SERVER_URL || 'wss://localhost:3001';
  const sessionId = process.env.SESSION_ID;
  const pin = process.env.SESSION_PIN;
  const privateKey = process.env.AGENT_PRIVATE_KEY;

  if (!sessionId || !pin || !privateKey) {
    console.error('Required env vars: SESSION_ID, SESSION_PIN, AGENT_PRIVATE_KEY');
    process.exit(1);
  }

  await agent.connect(serverUrl, sessionId, pin, privateKey);
  console.log('[Treasury Bot] Running. Press Ctrl+C to stop.');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
```
