# Contributing to Hedera MultiSig

Thank you for your interest in contributing! This document provides guidelines and an architecture overview to help you get started.

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Project Structure](#project-structure)
- [Development Setup](#development-setup)
- [Testing](#testing)
- [Code Style](#code-style)
- [Security Considerations](#security-considerations)
- [Pull Request Process](#pull-request-process)

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/lazysuperheroes/hedera-multisig.git
cd hedera-multisig

# Install dependencies
npm install

# Run tests
npm test

# Run the dApp locally
cd dapp && npm install && npm run dev
```

---

## Architecture Overview

### Core Concept: Pre-Session Workflow

Hedera transactions have a **120-second validity window** from when they're frozen. Our architecture elegantly handles this constraint:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     PRE-SESSION WORKFLOW                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. PREPARATION PHASE (No time limit)                               │
│     ├─ Coordinator creates session with PIN                         │
│     ├─ Participants join via WebSocket                              │
│     ├─ Participants load keys (ready status)                        │
│     └─ All participants confirmed ready                             │
│                                                                     │
│  2. SIGNING PHASE (<120 seconds)                                    │
│     ├─ Coordinator freezes transaction (starts 120s clock)          │
│     ├─ Transaction broadcast to all participants                    │
│     ├─ Participants verify & sign in parallel                       │
│     ├─ Signatures collected                                         │
│     └─ Transaction executed                                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT ENVIRONMENTS                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────────┐ │
│  │   CLI       │    │   Node.js   │    │   Browser dApp          │ │
│  │   Tools     │    │   Client    │    │   (Next.js + WalletC.)  │ │
│  └──────┬──────┘    └──────┬──────┘    └───────────┬─────────────┘ │
│         │                  │                       │               │
│         │         WebSocket│              WebSocket│               │
│         │                  │                       │               │
└─────────┼──────────────────┼───────────────────────┼───────────────┘
          │                  │                       │
          │    ┌─────────────┴───────────────────────┘
          │    │
          ▼    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        SERVER LAYER                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    WebSocketServer                             │ │
│  │  ├─ Message routing & validation                               │ │
│  │  ├─ Signature verification (Ed25519/ECDSA)                     │ │
│  │  ├─ Keep-alive heartbeat                                       │ │
│  │  └─ TLS/WSS support                                            │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                              │                                      │
│                              ▼                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                    SessionStore                                │ │
│  │  ├─ In-memory (default)                                        │ │
│  │  └─ Redis (optional, for persistence)                          │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Security Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SECURITY LAYERS                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  TRANSPORT SECURITY                                                 │
│  └─ TLS/WSS encryption (optional but recommended)                   │
│                                                                     │
│  SESSION SECURITY                                                   │
│  ├─ 8-character alphanumeric PIN (~39 bits entropy)                 │
│  ├─ Timing-safe PIN comparison (crypto.timingSafeEqual)             │
│  └─ Automatic session expiration                                    │
│                                                                     │
│  SIGNATURE SECURITY                                                 │
│  ├─ Server-side signature verification before acceptance            │
│  ├─ Public key eligibility validation                               │
│  └─ Transaction hash verification                                   │
│                                                                     │
│  KEY MANAGEMENT                                                     │
│  ├─ Private keys NEVER transmitted over network                     │
│  ├─ Three security tiers: prompt, encrypted file, env vars          │
│  └─ Air-gap support for maximum security                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
hedera-multisig/
├── cli/                    # CLI tools (Commander.js)
│   ├── index.js           # Unified entry point (hedera-multisig)
│   ├── commands/          # Subcommand implementations
│   ├── init.js            # npx initialization wizard
│   └── utils/             # CLI utilities (exit codes, JSON output)
│
├── client/                 # Node.js WebSocket client
│   ├── SigningClient.js   # Main client for participants
│   └── TransactionReviewer.js  # Transaction display
│
├── server/                 # WebSocket server
│   ├── WebSocketServer.js # Main server with message routing
│   ├── SessionStore.js    # In-memory session storage
│   └── stores/
│       └── RedisSessionStore.js  # Redis persistence
│
├── dapp/                   # Next.js browser application
│   ├── app/               # Next.js app router pages
│   ├── components/        # React components
│   ├── lib/               # Browser utilities
│   │   ├── transaction-decoder.ts  # Browser TX decoder
│   │   └── websocket-client.ts     # Browser WS client
│   └── e2e/               # Playwright E2E tests
│
├── core/                   # Core transaction management
│   ├── TransactionFreezer.js   # Freeze transactions
│   └── TransactionExecutor.js  # Execute with signatures
│
├── keyManagement/          # Key providers & validators
│   ├── PromptKeyProvider.js    # Interactive prompt
│   ├── EncryptedFileProvider.js # Encrypted file storage
│   ├── EnvKeyProvider.js       # Environment variables
│   └── KeyValidator.js         # Key format validation
│
├── shared/                 # Shared utilities
│   ├── logger.js          # Structured logging
│   ├── TimerController.js # Centralized timer management
│   ├── connection-string.js    # Connection URL builder
│   └── transaction-decoder/    # Universal TX decoder
│       ├── index.js       # Node.js implementation
│       └── index.d.ts     # TypeScript declarations
│
├── workflows/              # Workflow orchestration
│   └── WorkflowOrchestrator.js
│
├── types/                  # TypeScript declarations
│   └── index.d.ts
│
├── completions/            # Shell completion scripts
│   ├── bash.sh
│   ├── zsh.sh
│   ├── fish.fish
│   └── powershell.ps1
│
├── scripts/                # Utility scripts
├── examples/               # Usage examples
├── test/                   # Test files
└── docs/                   # Documentation
```

### Key Modules

| Module | Purpose |
|--------|---------|
| `WebSocketServer` | Coordinates signing sessions, validates signatures |
| `SessionStore` | Manages session state, participant tracking |
| `SigningClient` | Node.js client for command-line participants |
| `TransactionDecoder` | Parses frozen transactions, extracts details |
| `KeyProvider` | Abstract interface for key sources |
| `TimerController` | Prevents timer leaks, enables clean shutdown |

---

## Development Setup

### Prerequisites

- Node.js >= 16.0.0
- npm >= 8.0.0
- Redis (optional, for persistence testing)

### Environment Variables

Create a `.env` file for testing:

```bash
HEDERA_NETWORK=testnet
HEDERA_OPERATOR_ID=0.0.xxxxx
HEDERA_OPERATOR_KEY=302e...
```

### Running the dApp

```bash
cd dapp
npm install
npm run dev
# Open http://localhost:3000
```

### Running the Server

```bash
# Development
npm run multisig-server -- --port 8080

# With TLS
npm run multisig-server -- --port 8443 --tls --cert server.crt --key server.key

# With Redis
npm run multisig-server -- --redis --redis-host localhost
```

---

## Testing

### Test Suites

```bash
# Run all tests
npm test

# Unit tests only
npm run test:unit

# Workflow integration tests
npm run test:workflows

# Networked workflow tests
npm run test:networked

# dApp unit tests
cd dapp && npm test

# dApp E2E tests (requires running server)
cd dapp && npm run test:e2e
```

### Test Coverage

| Area | Tests | Coverage |
|------|-------|----------|
| Key Providers | 28 | High |
| Session Store | 27 | High |
| WebSocket Logic | 24 | Medium |
| Workflows | 15+ | Medium |
| E2E (dApp) | Basic | Framework ready |

---

## Code Style

### General Guidelines

- Use CommonJS (`require`/`module.exports`) for Node.js modules
- Use ES Modules for the dApp (Next.js)
- Keep functions small and focused
- Add JSDoc comments for public APIs
- Use descriptive variable names

### Logging

Use the structured logger:

```javascript
const { createLogger } = require('./shared/logger');
const log = createLogger('ModuleName');

log.info('Operation completed', { sessionId, count: 5 });
log.error('Operation failed', { error: err.message });
```

### Error Handling

- Always handle promise rejections
- Use specific error types when possible
- Log errors with context
- Clean up resources in finally blocks

---

## Security Considerations

When contributing security-related code:

1. **Never log private keys** - Even in debug mode
2. **Use timing-safe comparisons** - For secrets (PINs, tokens)
3. **Validate all inputs** - Especially from WebSocket messages
4. **Verify signatures** - Before accepting
5. **Handle edge cases** - Null checks, type validation

### Security Review Checklist

- [ ] No secrets in logs
- [ ] Input validation present
- [ ] Error messages don't leak sensitive info
- [ ] Resources cleaned up on error
- [ ] Timing attacks considered

---

## Pull Request Process

### Before Submitting

1. **Run tests**: `npm test`
2. **Check linting**: `npm run lint` (if available)
3. **Test manually**: Run the server and dApp
4. **Update docs**: If you changed APIs

### PR Guidelines

- Keep PRs focused on a single change
- Write clear commit messages
- Reference any related issues
- Add tests for new functionality
- Update TypeScript declarations if needed

### Commit Message Format

```
type: short description

Longer description if needed.

Fixes #123
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

---

## Questions?

- Open an issue for bugs or feature requests
- Check existing issues before creating new ones
- Tag issues appropriately (bug, enhancement, question)

Thank you for contributing!
