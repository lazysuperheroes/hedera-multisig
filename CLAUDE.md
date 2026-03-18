# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See `SKILLS.md` for comprehensive AI agent onboarding guide with common tasks, patterns, and how-tos.

## Project Overview

Hedera MultiSig is a production-grade multi-signature transaction management library for Hedera blockchain. It provides M-of-N threshold signing with five workflow modes: Interactive (real-time), Offline (air-gapped), Networked (WebSocket-based), Scheduled (async via ScheduleCreate), and Flora (on-chain via HCS-16, architectural prep complete).

Three target use cases: **treasury management**, **agent-to-agent signing**, and **scheduled transactions**.

## Build, Test, and Run Commands

```bash
# Run all tests (120s timeout required for Hedera network operations)
npm test

# Run specific test suites
npm run test:unit          # Key providers, WebSocket, session store, security, connection-string
npm run test:workflows     # Workflow integration tests
npm run test:networked     # Networked workflow tests

# Coverage report
npm run test:coverage

# Run a single test file
npx mocha test/offline.test.js --timeout 120000

# Run specific test by name
npx mocha test/workflows.test.js --grep "Interactive" --timeout 120000

# Generate documentation
npm run docs

# Start multi-sig server (prefer Commander.js CLI over standalone scripts)
npx hedera-multisig server -t 2 -k "key1,key2,key3" --port 3001

# Join as signing client
npx hedera-multisig participant --connect hmsc:eyJz...

# Start dApp (separate terminal)
cd dapp && npm run dev
```

## Architecture

```
├── core/           # Transaction freezer, decoder (deprecated), signature collection/verification
├── server/         # WebSocket server, SigningSessionManager (async), SessionStore (memory + Redis)
├── client/         # SigningClient, AgentSigningClient, PolicyEngine (5 rules + 2 presets)
├── cli/            # Commander.js CLI: server, participant, sign, offline, schedule, transfer, token, session
├── workflows/      # WorkflowOrchestrator, InteractiveWorkflow, OfflineWorkflow, ScheduledWorkflow
├── keyManagement/  # KeyProvider (sign() + canExposeKeys()), Prompt, EncryptedFile, Env
├── shared/         # protocol, errors, crypto-utils, transaction-decoder (20+ types), CoordinationTransport,
│                   # mirror-node-client, transaction-utils, connection-string, logger, TimerController
├── ui/             # ProgressIndicator, ErrorFormatter, TransactionDisplay, HelpText
├── dapp/           # Next.js WalletConnect dApp: landing (/), join (/join), create (/create), session (/session/[id])
├── scripts/        # Account management utilities (generate-keys, create-account, etc.)
├── examples/       # Usage examples (transfer-hbar, transfer-token, smart-contract)
├── types/          # TypeScript declarations (index.d.ts)
└── docs/           # ROADMAP, AGENT_INTEGRATION, HOL_INTEGRATION_ANALYSIS, DEVELOPMENT_PLAN_v2
```

### Key Components

- **TransactionFreezer** (`core/`): Freezes Hedera SDK transactions for offline signing
- **TransactionDecoder** (`shared/transaction-decoder/`): Decodes frozen bytes to readable format (20+ types, ABI decoding)
- **SignatureCollector** (`core/`): Collects signatures from key providers (structured logger)
- **SignatureVerifier** (`core/`): Cryptographic verification with threshold support
- **TransactionExecutor** (`core/`): Executes with audit logging (structured logger)
- **ScheduledWorkflow** (`workflows/`): Async signing via Hedera ScheduleCreate/ScheduleSign
- **WebSocketServer** (`server/`): TLS/WSS, rate limiting (per-IP + per-session), origin validation
- **SigningSessionManager** (`server/`): Async API, coordinator tokens, reconnection tokens, agent API keys, scheduled mode
- **AgentSigningClient** (`client/`): Headless agent with policy-based auto-signing, transport-agnostic
- **PolicyEngine** (`client/`): MaxAmountRule, AllowedRecipientsRule, AllowedTransactionTypesRule, TimeWindowRule, RateLimitRule
- **KeyProvider** (`keyManagement/`): Abstract interface with `sign()` method — supports opaque signers (HSM, MPC)
- **CoordinationTransport** (`shared/`): Abstract transport (WebSocket adapter + Flora stub for future HCS-16)
- **MirrorNodeClient** (`shared/`): Exchange rates, token info, account info, schedule queries

### Security Model

- Private keys NEVER transmitted — only frozen transactions and signatures flow over network
- Server validates format/eligibility but doesn't access private keys
- VERIFIED vs UNVERIFIED data separation in UI (cryptographic data vs coordinator metadata)
- Coordinator tokens (separate from participant PINs) for elevated privileges
- Reconnection tokens replace PINs after initial auth (PIN never stored in localStorage)
- Timing-safe PIN comparison (`crypto.timingSafeEqual`)
- Per-session and per-IP rate limiting on authentication
- Mixed sessions — CLI, Web (WalletConnect), and agents can join same session

## Critical Constraints

### 120-Second Transaction Validity
Hedera transactions must be signed within 120 seconds of being frozen. The Pre-Session Workflow addresses this:
1. Participants connect and load keys BEFORE transaction (can take hours)
2. Transaction frozen and injected into active session
3. Signing must complete within 120 seconds after injection

Scheduled transactions (`ScheduledWorkflow`) bypass this constraint entirely.

### Code Patterns

- Use `TransactionId.generate(operatorId)` BEFORE `freezeWith()` for multi-sig hash stability
- Use `instanceof` checks for transaction type detection (not `constructor.name` — breaks in minification)
- All `SessionStore` methods are `async` (compatibility with Redis)
- All WebSocket error responses include `code` from `shared/protocol.js ERROR_CODES`
- Core classes (`SignatureCollector`, `SignatureVerifier`, `TransactionExecutor`) are **static-only** — never instantiate
- `KeyProvider.sign(txBytes)` is the preferred signing interface (works with opaque signers)
- Use `shared/crypto-utils.js` for `timingSafeCompare`, `sanitizePublicKey` — no duplicating

### Git Signing
- ALWAYS use GPG-signed commits — Never use `--no-gpg-sign`
- ALWAYS use signed tags — Use `git tag -s` for releases

## Protocol

WebSocket message types, session states, error codes, and roles are defined in `shared/protocol.js`. Import constants from there — no hardcoded string literals.

Three roles: `coordinator` (session creator), `participant` (human signer), `agent` (automated signer).

Session states: `waiting` → `transaction-received` → `signing` → `executing` → `completed`

## Environment Variables

```bash
OPERATOR_ID      # Hedera account ID (e.g., 0.0.12345)
OPERATOR_KEY     # Hedera private key
ENVIRONMENT      # Network: TEST, MAIN, or PREVIEW
HEDERA_NETWORK   # Alternative: testnet, mainnet
NGROK_AUTH_TOKEN  # For remote tunneling (optional)
```

dApp environment (in `dapp/.env.local`):
```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
NEXT_PUBLIC_DEFAULT_NETWORK=testnet
```

## Key Dependencies

- `@hashgraph/sdk` — Hedera SDK for transaction handling
- `ws` — WebSocket server
- `commander` — CLI framework
- `ethers` — EVM compatibility, ABI encoding/decoding (lazy-loaded)
- `ngrok` / `localtunnel` — Remote access tunneling
- `ioredis` — Optional Redis session persistence
- `c8` — Code coverage reporting

## Documentation

| Document | Purpose |
|----------|---------|
| `SKILLS.md` | AI agent onboarding (conventions, patterns, common tasks) |
| `docs/ROADMAP.md` | Development phases and status (Phases 0-5 complete, Phase 6 planned) |
| `docs/DEVELOPMENT_PLAN_v2.md` | Detailed 78-task execution plan with acceptance criteria |
| `docs/AGENT_INTEGRATION.md` | Agent Signing SDK guide (PolicyEngine, rules, events, examples) |
| `docs/HOL_INTEGRATION_ANALYSIS.md` | HCS-10/15/16/17/18/26 integration strategy |
| `docs/SECURITY_ARCHITECTURE.md` | Security model and threat analysis |
| `docs/OFFLINE_SIGNING_GUIDE.md` | Air-gapped signing workflow |
| `CONTRIBUTING.md` | Architecture diagrams, setup guide |
