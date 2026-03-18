# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hedera MultiSig is a production-grade multi-signature transaction management library for Hedera blockchain. It provides M-of-N threshold signing with five workflow modes: Interactive (real-time), Offline (air-gapped), Networked (WebSocket-based), Scheduled (async via ScheduleCreate), and Flora (on-chain via HCS-16, architectural prep complete).

See `SKILLS.md` for comprehensive AI agent onboarding guide.

## Build, Test, and Run Commands

```bash
# Run all tests (120s timeout required for Hedera network operations)
npm test

# Run specific test suites
npm run test:unit          # Key management, WebSocket, session store
npm run test:workflows     # Workflow integration tests
npm run test:networked     # Networked workflow tests

# Run a single test file
npx mocha test/workflows.test.js --timeout 120000

# Run specific test by name
npx mocha test/workflows.test.js --grep "Interactive" --timeout 120000

# Debug mode
DEBUG=* npx mocha test/workflows.test.js --timeout 120000

# Generate documentation
npm run docs

# Start multi-sig server
npm run multisig-server -- -t 2 -k "key1,key2,key3" --port 3001

# Join as signing client
npm run multisig-client -- --server ws://localhost:3001 --session SESSION_ID --pin PIN
```

## Architecture

```
├── core/           # Transaction freezer, decoder, signature collection/verification
├── server/         # WebSocket server, SigningSessionManager, SessionStore (Redis/memory)
├── client/         # SigningClient, AgentSigningClient, PolicyEngine
├── cli/            # Commander.js CLI (server, participant, sign, offline, schedule, transfer, token, session)
├── workflows/      # WorkflowOrchestrator, InteractiveWorkflow, OfflineWorkflow, ScheduledWorkflow
├── keyManagement/  # KeyProvider (sign() + canExposeKeys()), Prompt, EncryptedFile, Env
├── shared/         # protocol, errors, crypto-utils, transaction-decoder, CoordinationTransport, mirror-node-client, logger, TimerController
├── ui/             # ProgressIndicator, ErrorFormatter, TransactionDisplay
├── dapp/           # Next.js WalletConnect browser dApp
├── scripts/        # Account management utilities (generate-keys, create-account, etc.)
└── examples/       # Usage examples (transfer-hbar, transfer-token)
```

### Key Components

- **TransactionFreezer** (`core/`): Freezes Hedera SDK transactions for offline signing
- **TransactionDecoder** (`core/`): Decodes frozen transaction bytes to readable format (20+ types)
- **SignatureCollector** (`core/`): Collects signatures from multiple key providers
- **WorkflowOrchestrator** (`workflows/`): Coordinates signing workflows
- **ScheduledWorkflow** (`workflows/`): Async signing via Hedera ScheduleCreate/ScheduleSign
- **WebSocketServer** (`server/`): TLS/WSS server with tunnel support (ngrok/localtunnel)
- **SigningSessionManager** (`server/`): Session lifecycle and state machine (async API)
- **AgentSigningClient** (`client/`): Headless agent with policy-based auto-signing
- **PolicyEngine** (`client/`): Composable rules for automated transaction approval
- **KeyProvider** (`keyManagement/`): Abstract interface with `sign()` method (3 security tiers)
- **CoordinationTransport** (`shared/`): Abstract transport layer (WebSocket + Flora stub)

### Security Model

- Private keys NEVER transmitted - only frozen transactions and signatures flow over network
- Server validates format/eligibility but doesn't access private keys
- VERIFIED vs UNVERIFIED data separation in UI (cryptographic data vs coordinator metadata)
- Mixed sessions supported - CLI and Web (WalletConnect) participants can join same session

## Critical Constraints

### 120-Second Transaction Validity
Hedera transactions must be signed within 120 seconds of being frozen. The Pre-Session Workflow addresses this:
1. Participants connect and load keys BEFORE transaction (can take hours)
2. Transaction frozen and injected into active session
3. Signing must complete within 120 seconds after injection

### Code Patterns

- Use `TransactionId.generate(operatorId)` BEFORE `freezeWith()` for multi-sig hash stability
- Use `instanceof` checks for transaction type detection (not `constructor.name` - breaks in minification)
- Distinguish between **old key** (authority to modify) vs **operator key** (fee payment)
- No deprecated `.setNodeAccountIds()` calls (Hedera mesh broadcasting)

### Git Signing
- ALWAYS use GPG-signed commits - Never use `--no-gpg-sign`
- ALWAYS use signed tags - Use `git tag -s` for releases

## Development Methodology

### Fix Protocol (from Fix Master agent)
1. **Problem Isolation** - Understand exact failure mode
2. **Code Analysis** - Read surrounding code, search for existing solutions
3. **Surgical Implementation** - Make targeted changes using existing patterns
4. **Manual Validation** - Test manually before writing automated tests
5. **Targeted Testing** - Create focused tests only after proven functionality

### Anti-Patterns to Avoid
- Creating placeholder files or "TODO" implementations
- Writing tests before basic functionality is proven
- Duplicating functions without searching codebase first
- Making broad architectural changes for specific bugs

## Environment Variables

```bash
OPERATOR_ID      # Hedera account ID (e.g., 0.0.12345)
OPERATOR_KEY     # Hedera private key
ENVIRONMENT      # Network: TEST, MAIN, or PREVIEW
NGROK_AUTH_TOKEN # For remote tunneling (optional)
```

## Key Dependencies

- `@hashgraph/sdk` - Hedera SDK for transaction handling
- `ws` - WebSocket server
- `commander` - CLI framework
- `ethers` - EVM compatibility for ECDSA key support
- `ngrok` / `localtunnel` - Remote access tunneling
- `ioredis` - Optional Redis session persistence
