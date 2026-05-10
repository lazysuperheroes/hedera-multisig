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

### Node freeze selection

- **Default: single-node freeze (`subsetSize=1`)**. The historical reason was a wallet-side bug we attributed to HashPack/Kabila re-freezing `ContractExecuteTransaction`. **The actual root cause was upstream:** `@hashgraph/hedera-wallet-connect`'s `DAppSigner.signTransaction` calls `transactionToTransactionBody(transaction, nodeAccountId)` to rebuild a fresh `TransactionBody` from the parsed `Transaction` object, sends THAT to the wallet for signing, then reattaches the signature to the *original* preserved `signedTx.bodyBytes`. For HBAR / token transfers the rebuild produces byte-identical output (verify works); for `ContractExecuteTransaction` it diverges (default-value handling, proto field-ordering) — the wallet's signature is over content the dApp never sees, so verify fails. Both HashPack and Kabila exhibit identical failure profiles. **Fixed in v2.2.0** by bypassing `DAppSigner.signTransaction` entirely (`dapp/lib/walletconnect.ts`): we call `signer.request({method: HederaJsonRpcMethod.SignTransaction, params: {signerAccountId, transactionBody: base64(originalBodyBytes)}})` directly with our verbatim bodyBytes. Wallet signers now work for all tx types. Upstream issue: [hashgraph/hedera-wallet-connect#694](https://github.com/hashgraph/hedera-wallet-connect/issues/694).
- **Why we still default to single-node:** the WalletConnect `SignTransaction` RPC method signs **one** body per wallet popup. Multi-node freeze with N bodies would either need N popups (poor UX) or fall back to body[0]-only signing, which the server already supports via its trim-to-body[0] fallback at execute time. Single-node sidesteps the multi-popup problem.
- **Bump `subsetSize` for CLI-only ceremonies**: pass `subsetSize: 6` (or higher) to `selectNodeAccountIds(client, options)` when you control all signers and they're all CLI/SDK-based. Resilient to per-node downtime; comfortably under Hedera's 6 KB tx-size cap.
- Multi-sig transactions get frozen against the chosen nodes via `setNodeAccountIds([...])`. Each `SignedTransaction` body has a distinct `nodeAccountID`, so signers produce **one ED25519 signature per body** and pass the array to `transaction.addSignature(publicKey, sigBytesArray)`. The server tolerates "single-sig submission against multi-node freeze" by trimming to body[0] at execute time (see `SigningSessionManager._executeTransactionLocked`) — that fallback rescues wallet signers when they only deliver body[0]'s signature.
- Use `selectNodeAccountIds(client, options)` from `shared/node-selection.js` (Node) or `dapp/lib/node-selection.ts` (browser). Strategies: `'subset'` (default), `'all'`, `'specific'`.
- The 6 KB cap matters: a 5-of-9 multi-sig × 30-node freeze is ~22 KB and won't submit. Use `shared/tx-size-estimator.js` (Node) / `dapp/lib/tx-size-estimator.ts` (browser) to predict size before freezing; the dApp's `TxSizeEstimateBar` surfaces green/amber/red status pre-injection.
- Wire protocol: `signatures: string[]` (canonical, base64-per-body). Legacy single-sig `signature: string` is accepted by promoting to a 1-element array. `SignatureCollector` outputs `publicKey:sig0,sig1,...,sigN` for offline workflows.

### Git Signing
- ALWAYS use GPG-signed commits — Never use `--no-gpg-sign`
- ALWAYS use signed tags — Use `git tag -s` for releases

### Versioning
- Bump `dapp/package.json` `version` (semver patch) for any non-trivial dApp change so users can see what they're running. The footer renders `v<version>` from `process.env.NEXT_PUBLIC_DAPP_VERSION` (set in `dapp/next.config.ts`); the `VersionConsoleBanner` component logs version + build time on first paint.
- Bump root `package.json` `version` for any non-trivial CLI / server / shared-protocol change. The CLI participant prints version + per-file build hashes on startup (`cli/commands/participant.js`).

## Protocol

WebSocket message types, session states, error codes, and roles are defined in `shared/protocol.js`. Import constants from there — no hardcoded string literals.

Three roles: `coordinator` (session creator), `participant` (human signer), `agent` (automated signer).

Session states: `waiting` → `transaction-received` → `signing` → `executing` → `completed`

## Design Context

Brand and aesthetic direction for any UI work in this repo (primarily
`dapp/`) is captured in [`.impeccable.md`](.impeccable.md). **Read it before
making visual changes** — it covers brand-family context (LSH umbrella),
users, brand personality, anti-references, and design principles.

Quick summary:
- Hosted on the lazysuperheroes domain; ships under the **Lazy Superheroes
  (LSH)** umbrella with sister product `lazylotto-agent`. Footer attribution
  + logo required; LAZY Gold `#e5a800` is reserved for that attribution and
  never appears in functional UI.
- Two switchable themes — *treasury* (calm/precise/trustworthy,
  Stripe-Mercury-Linear feel; default) and *dev* (sharp/technical/confident,
  Vercel-Railway-Resend feel; punk-terminal register).
- Strongest no: the AI-generated 2024-2025 look (cyan-on-dark, glassmorphism,
  identical card grids, gradient hero text, Inter everywhere). Tinted
  neutrals only — never pure `#fff` or `#000`.
- Shared LSH semantics: blue `#3b82f6` for primary action, `#16a34a`/`#f59e0b`/
  `#0ea5e9`/`#dc2626` for success/warning/info/destructive (sacred — never
  decorative).

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
