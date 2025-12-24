# Server Module - Networked Multi-Signature

This module provides real-time, networked multi-signature coordination via WebSocket server. It enables a coordinator to run a local server that remote participants can connect to for interactive signing sessions.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  COORDINATOR (Your Machine)                     │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  1. Create Transaction                                     │ │
│  │  2. Freeze Transaction                                     │ │
│  │  3. Start Server                                           │ │
│  │  4. Create Session (with PIN)                             │ │
│  │  5. Monitor Participants                                   │ │
│  │  6. Execute when Threshold Met                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                            ▲  │                                 │
│                  WebSocket │  │ (ws://host:port)                │
│                            │  ▼                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              REMOTE PARTICIPANTS (Signers)                 │ │
│  │  ┌──────────┐      ┌──────────┐      ┌──────────┐        │ │
│  │  │Signer 1  │      │Signer 2  │      │Signer 3  │        │ │
│  │  │Connect   │      │Connect   │      │Connect   │        │ │
│  │  │Review TX │      │Review TX │      │Review TX │        │ │
│  │  │Sign Local│      │Sign Local│      │Sign Local│        │ │
│  │  │Send Sig  │      │Send Sig  │      │Send Sig  │        │ │
│  │  └──────────┘      └──────────┘      └──────────┘        │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Security Model

**Critical Security Guarantees:**
- ✅ Private keys NEVER transmitted over network
- ✅ Only frozen transaction bytes are shared
- ✅ Signing happens locally on client machines
- ✅ Only public key + signature sent to server
- ✅ PIN-based authentication for session access
- ✅ All signatures cryptographically verified

## Quick Start

### Coordinator Side

```javascript
const { Client } = require('@hashgraph/sdk');
const { SigningSessionManager, WebSocketServer } = require('@lazysuperheroes/hedera-multisig');

// 1. Create and freeze transaction
const transaction = new TransferTransaction()
  .addHbarTransfer('0.0.123', Hbar.fromTinybars(-1000))
  .addHbarTransfer('0.0.456', Hbar.fromTinybars(1000))
  .freezeWith(client);

// 2. Create session manager
const sessionManager = new SigningSessionManager(client, {
  verbose: true,
  autoExecute: false
});

// 3. Create signing session
const session = await sessionManager.createSession(transaction, {
  threshold: 2, // 2 of N signatures required
  onThresholdMet: async (event) => {
    console.log('Threshold met! Executing...');
    await sessionManager.executeTransaction(session.sessionId);
  }
});

console.log(`Session ID: ${session.sessionId}`);
console.log(`PIN: ${session.pin}`);

// 4. Start WebSocket server
const wsServer = new WebSocketServer(sessionManager, {
  port: 3000,
  host: 'localhost'
});

await wsServer.start();
console.log('Server running. Share Session ID and PIN with participants.');
```

### Participant Side

See `client/` module for participant implementation.

## Components

### SessionStore

In-memory storage for active signing sessions.

**Features:**
- Session lifecycle management
- Participant tracking
- Signature collection
- Automatic expiration cleanup

**Usage:**
```javascript
const store = new SessionStore({
  defaultTimeout: 1800000, // 30 minutes
  cleanupInterval: 60000    // 1 minute
});

const session = store.createSession({
  pin: '123456',
  frozenTransaction: { /* ... */ },
  threshold: 2,
  eligiblePublicKeys: [/* ... */]
});
```

### SigningSessionManager

Main coordinator for signing sessions.

**Features:**
- Session creation with PIN authentication
- Automatic public key extraction from transactions
- Event-driven architecture
- Transaction execution coordination

**API:**

#### `createSession(transaction, config)`
Create a new signing session.

```javascript
const session = await sessionManager.createSession(transaction, {
  threshold: 2,
  pin: '123456', // Optional: auto-generates if not provided
  eligiblePublicKeys: [/* ... */], // Optional: auto-extracts if not provided
  timeout: 1800000, // 30 minutes

  // Event handlers
  onParticipantConnected: (event) => { /* ... */ },
  onStatusUpdate: (event) => { /* ... */ },
  onSignatureReceived: (event) => { /* ... */ },
  onThresholdMet: (event) => { /* ... */ },
  onTransactionExecuted: (event) => { /* ... */ },
  onError: (event) => { /* ... */ }
});
```

#### `authenticate(sessionId, pin)`
Authenticate a session with PIN.

```javascript
const authenticated = sessionManager.authenticate(sessionId, pin);
```

#### `submitSignature(sessionId, participantId, signature)`
Submit a signature from a participant.

```javascript
const result = await sessionManager.submitSignature(sessionId, participantId, {
  publicKey: '302a300506032b6570...',
  signature: 'base64-signature...'
});
```

#### `executeTransaction(sessionId)`
Execute transaction with collected signatures.

```javascript
const result = await sessionManager.executeTransaction(sessionId);
// Returns: { success, transactionId, receipt, status }
```

### WebSocketServer

WebSocket server for real-time client connections.

**Features:**
- WebSocket connection handling
- PIN-based authentication
- Real-time message routing
- Automatic participant tracking

**API:**

#### `start()`
Start the WebSocket server.

```javascript
const wsServer = new WebSocketServer(sessionManager, {
  port: 3000,
  host: 'localhost',
  verbose: true
});

const serverInfo = await wsServer.start();
// Returns: { host, port, url }
```

#### `stop()`
Stop the WebSocket server.

```javascript
await wsServer.stop();
```

#### `broadcastToSession(sessionId, message, excludeParticipantId)`
Broadcast message to all participants in a session.

```javascript
wsServer.broadcastToSession(sessionId, {
  type: 'STATUS_UPDATE',
  payload: { /* ... */ }
});
```

## WebSocket Protocol

### Client → Server Messages

#### AUTH
Authenticate and join session.

```json
{
  "type": "AUTH",
  "payload": {
    "sessionId": "abc123...",
    "pin": "123456",
    "role": "participant", // or "coordinator"
    "label": "Alice" // Optional participant label
  }
}
```

#### STATUS_UPDATE
Update participant status.

```json
{
  "type": "STATUS_UPDATE",
  "payload": {
    "status": "reviewing" // or "signing", "signed"
  }
}
```

#### SIGNATURE_SUBMIT
Submit a signature.

```json
{
  "type": "SIGNATURE_SUBMIT",
  "payload": {
    "publicKey": "302a300506032b6570...",
    "signature": "base64-signature..."
  }
}
```

#### EXECUTE_TRANSACTION
Request transaction execution (coordinator only).

```json
{
  "type": "EXECUTE_TRANSACTION",
  "payload": {}
}
```

### Server → Client Messages

#### AUTH_SUCCESS
Authentication successful.

```json
{
  "type": "AUTH_SUCCESS",
  "payload": {
    "role": "participant",
    "participantId": "def456...",
    "sessionInfo": {
      "sessionId": "abc123...",
      "frozenTransaction": "base64...",
      "txDetails": { /* decoded transaction */ },
      "threshold": 2,
      "eligiblePublicKeys": [/* ... */]
    }
  }
}
```

#### AUTH_FAILED
Authentication failed.

```json
{
  "type": "AUTH_FAILED",
  "payload": {
    "message": "Invalid session ID or PIN"
  }
}
```

#### PARTICIPANT_CONNECTED
New participant connected.

```json
{
  "type": "PARTICIPANT_CONNECTED",
  "payload": {
    "participantId": "def456...",
    "label": "Alice",
    "stats": {
      "participantsConnected": 2,
      "signaturesCollected": 0,
      "signaturesRequired": 2
    }
  }
}
```

#### SIGNATURE_RECEIVED
Signature received and verified.

```json
{
  "type": "SIGNATURE_RECEIVED",
  "payload": {
    "participantId": "def456...",
    "publicKeyPreview": "...abc12345",
    "stats": {
      "signaturesCollected": 1,
      "signaturesRequired": 2
    },
    "thresholdMet": false
  }
}
```

#### THRESHOLD_MET
Signature threshold has been met.

```json
{
  "type": "THRESHOLD_MET",
  "payload": {
    "signaturesCollected": 2,
    "signaturesRequired": 2
  }
}
```

#### TRANSACTION_EXECUTED
Transaction has been executed.

```json
{
  "type": "TRANSACTION_EXECUTED",
  "payload": {
    "success": true,
    "transactionId": "0.0.123@1234567890.123456789",
    "status": "SUCCESS"
  }
}
```

## Event Handlers

The `SigningSessionManager` supports event-driven architecture for real-time monitoring:

```javascript
const session = await sessionManager.createSession(transaction, {
  threshold: 2,

  // Participant connected
  onParticipantConnected: (event) => {
    console.log(`Participant connected`);
    console.log(`Total connected: ${event.stats.participantsConnected}`);
  },

  // Participant status changed
  onStatusUpdate: (event) => {
    console.log(`Participant ${event.participantId} is now ${event.status}`);
  },

  // Signature received
  onSignatureReceived: (event) => {
    console.log(`Signature from ${event.publicKey.slice(-8)}`);
    console.log(`Progress: ${event.stats.signaturesCollected}/${event.stats.signaturesRequired}`);
  },

  // Threshold met (enough signatures)
  onThresholdMet: async (event) => {
    console.log('Threshold met! Ready to execute.');

    // Optionally auto-execute
    await sessionManager.executeTransaction(session.sessionId);
  },

  // Transaction executed successfully
  onTransactionExecuted: (event) => {
    console.log(`Transaction ID: ${event.result.transactionId}`);
    console.log(`Status: ${event.result.status}`);
  },

  // Error occurred
  onError: (event) => {
    console.error(`Error: ${event.error}`);
  }
});
```

## Configuration

### Environment Variables

```env
# Server configuration
MULTISIG_SERVER_PORT=3000
MULTISIG_SERVER_HOST=localhost

# Session configuration
MULTISIG_SESSION_TIMEOUT=1800000  # 30 minutes in ms
```

### Session Options

```javascript
{
  threshold: 2,                    // Number of signatures required
  pin: '123456',                   // PIN for authentication (auto-generated if omitted)
  eligiblePublicKeys: [/* ... */], // Eligible signers (auto-extracted if omitted)
  timeout: 1800000,                // Session timeout in ms (default: 30 min)
  autoExecute: false               // Auto-execute when threshold met
}
```

### Server Options

```javascript
{
  port: 3000,           // WebSocket server port
  host: 'localhost',    // Server host
  verbose: true         // Enable detailed logging
}
```

## Security Considerations

### Network Security
- Use behind firewall for local network only
- For production, use TLS/SSL (future enhancement)
- Consider VPN for remote participants

### Session Security
- PINs are 6-digit codes (auto-generated)
- Sessions auto-expire after 30 minutes
- Failed authentication attempts are logged

### Key Security
- Private keys NEVER leave participant machines
- Only public keys and signatures transmitted
- All signatures cryptographically verified

### Audit Logging
- All session events logged
- Participant connections tracked
- Signature submissions recorded

## Troubleshooting

### Server won't start

**Error:** `EADDRINUSE: address already in use`

**Solution:** Port is already in use. Change port in configuration.

```javascript
const wsServer = new WebSocketServer(sessionManager, {
  port: 3001 // Use different port
});
```

### Cannot extract public keys

**Error:** `Could not automatically extract eligible public keys`

**Solution:** Manually provide eligible public keys.

```javascript
const session = await sessionManager.createSession(transaction, {
  eligiblePublicKeys: [
    '302a300506032b6570032100...',
    '302a300506032b6570032100...'
  ]
});
```

### Session expired

**Solution:** Sessions expire after 30 minutes. Create a new session or increase timeout.

```javascript
const session = await sessionManager.createSession(transaction, {
  timeout: 3600000 // 1 hour
});
```

## Examples

See:
- `examples/networked-multisig-coordinator.js` - Coordinator example
- `examples/networked-multisig-participant.js` - Participant example (when client module is complete)

## Roadmap

- [ ] TLS/SSL support for encrypted connections
- [ ] Web UI dashboard for coordinators
- [ ] Persistent session storage (Redis)
- [ ] Rate limiting and DoS protection
- [ ] Session recovery after server restart

## Support

For issues or questions, see the main README or open an issue on GitHub.
