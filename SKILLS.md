# SKILLS.md -- AI Agent Onboarding Guide

Practical reference for AI coding agents (Claude, Cursor, Copilot, etc.) working on this codebase.
This is NOT a repeat of README.md. It covers what you need to know to write, debug, and review code here.

---

## 1. Project Summary

Hedera MultiSig is a multi-signature transaction coordination library for the Hedera blockchain. It provides M-of-N threshold signing across three workflow modes:

- **Interactive** -- All signers present, real-time local signing
- **Offline / Air-gapped** -- Manual exchange of frozen transaction files and signature files
- **Networked** -- WebSocket-based remote coordination with pre-session workflow

Three primary use cases:

1. **Treasury management** -- Multi-party approval for HBAR/token transfers from shared accounts
2. **Agent signing** -- Automated bots with policy engines that sign without human interaction
3. **Scheduled transactions** -- Hedera native scheduled transactions with multi-sig collection

---

## 2. Architecture Overview

```
core/              Transaction lifecycle: freeze, decode, sign, verify, execute
server/            WebSocket server, session management, session store (memory + Redis)
client/            SigningClient (interactive), AgentSigningClient (headless), PolicyEngine
cli/               Commander.js CLI with subcommands (server, participant, sign, offline, etc.)
workflows/         WorkflowOrchestrator, InteractiveWorkflow, OfflineWorkflow, ScheduledWorkflow
keyManagement/     KeyProvider interface + implementations (Prompt, EncryptedFile, Env)
shared/            Logger, TimerController, protocol constants, transaction-decoder, crypto-utils
ui/                ProgressIndicator, ErrorFormatter, TransactionDisplay (CLI display helpers)
dapp/              Next.js WalletConnect browser dApp (separate build)
scripts/           Account management utilities (generate-keys, create-account, etc.)
examples/          Usage examples (transfer-hbar, transfer-token)
```

### The Pre-Session Workflow

Hedera transactions have a **120-second validity window** after being frozen. The networked workflow handles this with a two-phase approach:

1. **Pre-session phase**: Participants connect, authenticate, and load their keys. This can take as long as needed (hours, days).
2. **Signing phase**: The coordinator injects the frozen transaction. All participants must sign within 120 seconds.

This is the most important architectural constraint in the codebase. Any code that touches transaction lifecycle must respect this timing model.

### Session State Machine

Sessions progress through states defined in `shared/protocol.js`:

```
waiting -> transaction-received -> signing -> executing -> completed
                                                       \-> transaction-expired -> waiting (retry)
```

Terminal states: `completed`, `expired`, `cancelled`.

### Coordination Transport Abstraction

The system has a `CoordinationTransport` interface (`shared/CoordinationTransport.js`) that decouples coordination from transport:

- **`WebSocketTransport`** — wraps the existing WebSocket server (current default)
- **`FloraTransport`** — stub for future HCS-16 on-chain coordination via HCS topics
- **Factory**: `createTransport('websocket' | 'flora', options)`

The `SigningSessionManager` is already transport-agnostic — it manages state through method calls and event handlers with no WebSocket coupling. The `AgentSigningClient` accepts a `transportType` option.

---

## 3. Key Files

| What you need | Where to find it |
|---|---|
| Transaction freezing | `core/TransactionFreezer.js` |
| Transaction decoding | `core/TransactionDecoder.js` |
| Signature collection | `core/SignatureCollector.js` |
| Signature verification | `core/SignatureVerifier.js` |
| Transaction execution | `core/TransactionExecutor.js` |
| WebSocket server | `server/WebSocketServer.js` |
| Session management | `server/SigningSessionManager.js` |
| Session storage | `server/SessionStore.js` (memory), `server/stores/RedisSessionStore.js` |
| Interactive client | `client/SigningClient.js` |
| Agent client | `client/AgentSigningClient.js` |
| Policy engine | `client/PolicyEngine.js` |
| Protocol constants | `shared/protocol.js` (message types, session states, error codes) |
| Error classes | `shared/errors.js` (MultiSigError hierarchy with error codes) |
| Timer management | `shared/TimerController.js` |
| Crypto utilities | `shared/crypto-utils.js` (timing-safe compare, ID generation) |
| Transport abstraction | `shared/CoordinationTransport.js` (WebSocket + Flora stub) |
| Mirror node client | `shared/mirror-node-client.js` (exchange rates, token info, schedules) |
| Logger | `shared/logger.js` |
| CLI entry point | `cli/index.js` |
| CLI utilities | `cli/utils/cliUtils.js` (ExitCodes, JsonOutput) |
| Offline commands | `cli/commands/offline.js` |
| Key validation | `keyManagement/KeyValidator.js` |
| Encrypted key files | `keyManagement/EncryptedFileProvider.js` |

---

## 4. Development Commands

```bash
# Run all tests (needs 120s timeout for Hedera network operations)
npm test

# Unit tests only (key providers, WebSocket, session store)
npm run test:unit

# Workflow integration tests
npm run test:workflows

# Networked workflow tests
npm run test:networked

# Coverage report
npm run test:coverage

# Single test file
npx mocha test/offline.test.js --timeout 120000

# Single test by name
npx mocha test/workflows.test.js --grep "Interactive" --timeout 120000

# Debug mode
DEBUG=* npx mocha test/workflows.test.js --timeout 120000

# Generate JSDoc documentation
npm run docs
```

---

## 5. Code Conventions

### Module System

**CommonJS only** (`require` / `module.exports`). The project uses `"type": "commonjs"` in package.json. Do not use ESM `import`/`export`.

### Static-Only Classes in core/

Core classes (`TransactionFreezer`, `TransactionDecoder`, `SignatureCollector`, `SignatureVerifier`) use **static methods only**. They are never instantiated. This is intentional -- they are pure utility classes.

```javascript
// Correct
const result = await SignatureVerifier.verify(frozenTx, signatures, { threshold: 2 });

// Wrong -- do not instantiate
const verifier = new SignatureVerifier();
```

### Async SessionStore API

All `SessionStore` methods are `async` even for the in-memory implementation. This ensures compatibility with the Redis implementation (`RedisSessionStore`) which requires async I/O.

```javascript
// Always await SessionStore methods
const session = await store.getSession(sessionId);
await store.updateSession(sessionId, updates);
```

### Transaction Freezing

Always generate a `TransactionId` before freezing to ensure hash stability across multi-sig participants:

```javascript
const txId = TransactionId.generate(operatorId);
transaction.setTransactionId(txId);
transaction.freezeWith(client);
```

### Type Detection

Use `instanceof` checks for transaction type detection, never `constructor.name` (which breaks under minification):

```javascript
// Correct
if (tx instanceof TransferTransaction) { ... }

// Wrong
if (tx.constructor.name === 'TransferTransaction') { ... }
```

### Error Handling

Use error codes from `shared/protocol.js` (`ERROR_CODES`) for WebSocket error messages. CLI commands use exit codes from `cli/utils/cliUtils.js` (`ExitCodes`).

---

## 6. Security Model

### Keys Never Transmitted

The fundamental security guarantee: private keys never leave the signer's process. The server only sees frozen transaction bytes and signatures. The server validates format and eligibility but never has access to private keys.

### VERIFIED vs UNVERIFIED

The UI distinguishes between:
- **VERIFIED** data: Cryptographically derived (transaction bytes, signatures, public keys)
- **UNVERIFIED** data: Coordinator-provided metadata (descriptions, labels, memos)

Never present UNVERIFIED data as trusted without clearly marking it.

### Coordinator Tokens

Session coordinators authenticate with a token that grants elevated privileges (inject transactions, trigger execution). Stored separately from participant PINs.

### Reconnection Tokens

After initial PIN authentication, participants receive a reconnection token for subsequent connections. This prevents PIN reuse and allows seamless reconnection.

### Timing-Safe Comparison

PIN and token comparisons use `crypto.timingSafeEqual` via `shared/crypto-utils.js` to prevent timing attacks. Never use `===` for secret comparison.

---

## 7. Protocol

### WebSocket Message Types

Defined in `shared/protocol.js`. All server and client code must import from this module -- no string literals.

**Client -> Server:**
`AUTH`, `PARTICIPANT_READY`, `STATUS_UPDATE`, `SIGNATURE_SUBMIT`, `TRANSACTION_INJECT`, `TRANSACTION_REJECTED`, `EXECUTE_TRANSACTION`, `PING`

**Server -> Client:**
`AUTH_SUCCESS`, `AUTH_FAILED`, `TRANSACTION_RECEIVED`, `SIGNATURE_ACCEPTED`, `SIGNATURE_REJECTED`, `SIGNATURE_RECEIVED`, `THRESHOLD_MET`, `TRANSACTION_EXECUTED`, `TRANSACTION_EXPIRED`, `TRANSACTION_REJECTED`, `PARTICIPANT_CONNECTED`, `PARTICIPANT_READY`, `PARTICIPANT_DISCONNECTED`, `PARTICIPANT_STATUS_UPDATE`, `SESSION_EXPIRED`, `INJECTION_FAILED`, `EXECUTION_FAILED`, `ERROR`, `PONG`

### Session States

`waiting`, `transaction-received`, `signing`, `executing`, `completed`, `transaction-expired`, `expired`, `cancelled`

### Participant States

`connected`, `ready`, `reviewing`, `signing`, `signed`, `rejected`, `disconnected`

### Error Codes

Authentication: `AUTH_INVALID_CREDENTIALS`, `AUTH_RATE_LIMITED`, `AUTH_KEY_NOT_ELIGIBLE`, `AUTH_COORDINATOR_TOKEN_INVALID`

Session: `SESSION_NOT_FOUND`, `SESSION_EXPIRED`, `SESSION_INVALID_STATE`

Signature: `SIGNATURE_INVALID`, `SIGNATURE_DUPLICATE`, `SIGNATURE_KEY_NOT_ELIGIBLE`, `SIGNATURE_NO_TRANSACTION`

Transaction: `TRANSACTION_EXPIRED`, `TRANSACTION_INVALID`, `TRANSACTION_INJECTION_FAILED`, `TRANSACTION_EXECUTION_FAILED`

Protocol: `MESSAGE_INVALID`, `MESSAGE_TOO_LARGE`

### Roles

`coordinator`, `participant`, `agent`

---

## 8. Testing

### Framework

Mocha + Chai (expect style). All test files live in `test/` and end with `.test.js`.

```javascript
const { expect } = require('chai');

describe('ComponentName', function() {
  this.timeout(120000); // Required for Hedera network tests

  it('does something', async function() {
    const result = await SomeClass.doThing();
    expect(result.valid).to.equal(true);
  });
});
```

### Patterns

- **Async tests**: Use `async function` with `await` -- Mocha handles promise rejection automatically
- **SessionStore tests**: Always test both `SessionStore` (memory) and `RedisSessionStore` (if Redis available, skip otherwise)
- **Mock TimerController**: For tests involving timeouts, create a local `TimerController` instance and inject it to control timing deterministically
- **Test cleanup**: Use `afterEach` to clean up created files, sessions, or timers
- **120s timeout**: Always set `this.timeout(120000)` for tests that interact with the Hedera network

### Running Specific Tests

```bash
# By file
npx mocha test/offline.test.js --timeout 120000

# By name pattern
npx mocha test/workflows.test.js --grep "threshold" --timeout 120000

# With debug output
DEBUG=* npx mocha test/sessionStore.test.js --timeout 120000
```

---

## 9. Common Tasks

### How to Add a New Transaction Type

1. Add the type mapping in `shared/transaction-decoder.js` (the `getTransactionTypeName` function)
2. Add decoding logic in `core/TransactionDecoder.js` -- add a case to the decoder that extracts relevant fields
3. Update `core/TransactionFreezer.js` if the type needs special freezing logic
4. Add the type string to `AllowedTransactionTypesRule` in relevant policy presets (`client/PolicyEngine.js`)
5. Add a CLI command in `cli/commands/` if it needs direct CLI support
6. Add tests in `test/` covering freeze-decode-sign-verify round trip

### How to Add a New CLI Command

1. Create a new file in `cli/commands/` following existing patterns (see `cli/commands/transfer.js`)
2. Register the command in `cli/index.js` with Commander.js
3. Use `ExitCodes` from `cli/utils/cliUtils.js` for process exit codes
4. Support `--json` output mode using `JsonOutput` from `cli/utils/cliUtils.js`
5. Add a test file or tests in an existing test file

### How to Add a Policy Rule

1. Create a class with an `async evaluate(txDetails, metadata)` method
2. Return `{ approved: true }` or `{ approved: false, reason: 'explanation' }`
3. Add it to the rule exports in `client/PolicyEngine.js`
4. Optionally add it to a preset function (`createTreasuryAgentPolicy`, etc.)
5. Add tests covering approval and rejection cases

### How to Add a New SessionStore Backend

1. Create a new file in `server/stores/` implementing the same async API as `SessionStore`
2. Required methods: `createSession`, `getSession`, `updateSession`, `deleteSession`, `getActiveSessions`, `cleanup`
3. Export it from `server/stores/index.js`
4. Add tests following the pattern in `test/sessionStore.test.js`

### How to Add a New Coordination Transport

1. Create a class extending `CoordinationTransport` from `shared/CoordinationTransport.js`
2. Implement: `start()`, `stop()`, `broadcast()`, `sendTo()`, `sendToCoordinator()`, `getType()`
3. Use `_emitMessage()`, `_emitConnect()`, `_emitDisconnect()` to dispatch events to handlers
4. Register the type in `TRANSPORT_TYPES` and the `createTransport` factory
5. See `FloraTransport` stub for documented method-by-method specification

### How to Add a New WebSocket Message Type

1. Add the message type constant to `shared/protocol.js` (either `CLIENT_MESSAGES` or `SERVER_MESSAGES`)
2. Add handling in `server/WebSocketServer.js` (for client messages) or `client/SigningClient.js` (for server messages)
3. Update `client/AgentSigningClient.js` if agents need to handle the message
4. Add tests

---

## 10. Git Conventions

### Commit Signing

All commits MUST be GPG-signed. Never use `--no-gpg-sign`. All tags must be signed with `git tag -s`.

### Branch Naming

- `feature/` -- New features
- `bugfix/` -- Bug fixes
- `hotfix/` -- Urgent production fixes
- `test/` -- Test additions or improvements

### PR Conventions

- Target `main` branch
- Include a summary section and test plan
- Reference issue numbers where applicable
- All CI checks must pass before merge
