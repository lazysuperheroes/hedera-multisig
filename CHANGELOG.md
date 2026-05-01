# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-05-01

A security-led stabilization release that closes three CRITICALs found
in the v2.0 review, exposes the HIP-423 long-window scheduled-transaction
unlock through the CLI, lands a richer dApp injection UX, ships two
end-to-end walkthroughs (HBAR + smart-contract), and tightens the
release supply chain.

**Read first:**
- [`SECURITY.md`](SECURITY.md) — disclosure policy + threat model + supported versions
- [`docs/V2.1.0_PLAN.md`](docs/V2.1.0_PLAN.md) — full task ledger this release executed against
- [`docs/THRESHOLD_GUIDE.md`](docs/THRESHOLD_GUIDE.md) — new conceptual guide on M-of-N choice and nested key-list boundaries
- [`examples/walkthrough-hbar/`](examples/walkthrough-hbar/) and [`examples/walkthrough-contract/`](examples/walkthrough-contract/) — runnable walkthroughs

### Breaking changes

These are intentional security and modernization choices. Migration is
straightforward — see notes inline.

- **`engines.node` raised from `>=16.0.0` to `>=20.0.0`.** Node 18 EOL'd
  on 2025-04-30; CI now runs against 20/22/24. **Migrate:** upgrade your
  Node runtime; the library still works on 18 in practice but is no
  longer tested or supported there.
- **`allowedOrigins` default changed from `null` (allow-any) to `null`
  meaning "deny browser origins" unless explicitly listed.** The
  `WebSocketServer` constructor now treats `null`/missing as a deny
  signal for browser-origin connections; CLI/agent connections (no
  `Origin` header) are unaffected. **Migrate:** for production browser
  access, pass `--allowed-origins https://your.dapp.example` (or set
  `allowedOrigins: [...]` programmatically). For development only,
  pass `--unsafe-any-origin`. **Tunnel mode (`--tunnel`) without an
  explicit allow-list now refuses to start** — unsafe by default.
- **`TransactionDecoder` (the legacy `core/TransactionDecoder.js` class)
  removed from package exports.** Decoding logic moved fully into
  `shared/transaction-decoder/` (the canonical, 20-type implementation).
  `core/TransactionDecoder` is now a thin terminal-display utility used
  internally by `SignatureCollector`. **Migrate:**
  ```js
  // Before:
  const { TransactionDecoder } = require('@lazysuperheroes/hedera-multisig');
  // After:
  const { SharedTransactionDecoder } = require('@lazysuperheroes/hedera-multisig');
  const { TransactionDecoder, getTransactionTypeName } = SharedTransactionDecoder;
  const details = TransactionDecoder.extractTransactionDetails(tx, getTransactionTypeName(tx), abi);
  ```
- **`executeTransaction` failure now transitions to a new terminal
  `execution-failed` state.** Previously rolled back to `'active'`,
  which combined with the post-AUTH role gap (now closed) allowed any
  authenticated participant to re-trigger after a transient failure.
  **Migrate:** code that handled the old `'active'` rollback should
  detect `'execution-failed'` and create a new session instead of
  retrying.

### Security

Three CRITICAL findings from the multi-agent v2.0 review are closed.

- **CRITICAL #1 — Coordinator role enforcement post-AUTH.** Pre-fix,
  any authenticated participant could send `TRANSACTION_INJECT` or
  `EXECUTE_TRANSACTION` and the WebSocket router dispatched without a
  role check. Phase 0's coordinator-token gate covered AUTH only, not
  message routing. Now: every privileged message verifies
  `isCoordinator` and emits `NOT_COORDINATOR` on rejection, with a
  `WARN`-level audit log line. Regression test:
  `test/coordinator-authorization.test.js` (3 cases). (`server/WebSocketServer.js`)
- **CRITICAL #2 — `protobufjs` arbitrary-code-execution CVE
  (GHSA-xq3m-2v4x-88gg).** `@hashgraph/sdk` was pulling vulnerable
  versions (7.5.4 and 8.0.0). `npm audit` had been *lowered* to
  `--audit-level=critical` to suppress the warning. Fixed via
  version-keyed `overrides` in `package.json` (force 7.5.6 / 8.0.3 in
  the vulnerable ranges only); CI restored to `--audit-level=high`
  with `--omit=dev`. (`package.json`, `.github/workflows/test.yml`)
- **CRITICAL #3 — Reconnection token now bound to public key.**
  Pre-fix, a stale reconnection token could rejoin after the
  coordinator narrowed the eligible-keys set, because the eligibility
  check only ran on initial AUTH. Now: `generateReconnectionToken`
  records the participant's normalized public key alongside the
  token; `authenticateWithReconnectionToken` re-validates on use,
  returning `KEY_NO_LONGER_ELIGIBLE` if it isn't. Tolerates the legacy
  string-shaped tokens for in-flight upgrades. Regression test:
  `test/reconnection-token.test.js` (5 cases). (`server/SigningSessionManager.js`)

Plus 8 HIGH-severity hardening fixes:

- **PIN no longer included in shareable links by default.** The dApp
  `/create` page added a "Include PIN in link" opt-in checkbox with an
  explicit "less secure" warning. Default-off; participants type the
  PIN themselves.
- **PIN handoff migrated from `localStorage` to `sessionStorage`.** The
  legacy `'hedera-multisig-session-info'` key (lifetime: forever)
  replaced by `'hedera-multisig-pending-join'` (lifetime: tab close).
  Legacy key auto-purged on read. The session page reads the handoff
  PIN, AUTHs to get a reconnection token, and immediately deletes the
  per-tab key.
- **Per-IP rate limit raised 5 → 12.** A 7-signer ceremony behind a
  single corporate NAT shared one source IP and tripped the previous
  limit during normal use; per-session limit (20) remains the primary
  brute-force gate. (`server/WebSocketServer.js`)
- **`executeTransaction` runs under the per-session signature mutex,**
  preventing race conditions between coordinator-triggered
  `EXECUTE_TRANSACTION` and auto-execute on threshold-met. Failed
  execution → terminal `execution-failed` state.
- **Mirror-node confirmation in `TransactionExecutor.execute()`.**
  Receipt success no longer ends the workflow — the executor now polls
  the mirror node (with retry/backoff: 1s/2s/4s) and returns
  `mirrorConfirmed: boolean` + `mirrorRecord` so callers can verify
  the network actually externalized the transaction. The dApp's
  PostSigningStatus shows a side-by-side intent-vs-actual diff
  (signed transfers vs mirror-reported transfers, fee-only delta
  flagged as expected, anything else as a discrepancy).
- **TransactionReview surfaces `selectorVerified`** — the keccak256
  selector check in the dApp's `decodeSolidityFunction` was already
  computed but discarded by the UI. Now: green "ABI Verified ✓" badge
  when the selector matches, red "Selector Mismatch" when it doesn't,
  yellow "No ABI — Unverifiable" when ABI is absent (with raw
  selector hex + 4byte.directory link as fallback). Decoded function
  parameters render inline as a name/value table. Closes the largest
  smart-contract-signing UX gap from the v2.0 review.
- **Coordinator-token leak sweep** confirmed: not in localStorage,
  not in URLs, not in connection strings, not in server logs.
  Remaining surface (stdout print on session creation) gated behind
  the new `--quiet-secrets` flag.
- **`SECURITY.md`** added — disclosure address, audit posture, scope,
  trust boundaries.

### Added

#### Scheduled transactions (HIP-423 unlock — headline feature)

- **`schedule create` CLI gains `--expiration-time`, `--wait-for-expiry`,
  `--admin-key` flags.** Pre-2.1 the CLI only accepted `--memo` and
  `--payer`, so every schedule used the network's legacy default
  (~30 minutes). HIP-423 enables expiration windows up to ~62 days on
  mainnet/testnet (`scheduling.maxExpirationFutureSeconds = 5,356,800`);
  the CLI now exposes the full range. Format: ISO-8601 (`2026-06-30T12:00:00Z`)
  or human-readable duration suffixes (`30d`, `2h`, `60s`, `8w`).
  Parser is in `cli/utils/timeParser.js` with 21 unit tests; horizon
  enforcement rejects values beyond ~62 days. (`cli/commands/schedule.js`,
  `workflows/ScheduledWorkflow.js`)
- **Stale "30 minute" docs scrubbed** across ROADMAP, BLOG_POST,
  TREASURY_GUIDE, COORDINATOR_GUIDE, dApp landing, `cli/commands/schedule.js`,
  `workflows/ScheduledWorkflow.js`. Replaced with "hours, days, or up
  to ~62 days (HIP-423)" framing.

#### Smart-contract signing UX

- **TransactionReview ABI badges + parameter rendering** (see Security
  section).
- **`/create` ABI editor** — coordinator pastes a contract ABI JSON,
  the dApp parses it via `ethers.Interface`, presents a function
  dropdown, renders typed inputs per argument, and auto-encodes the
  calldata. Falls back to raw-hex paste when no ABI provided.
  (`dapp/components/create/TransactionFields.tsx`)
- **Three injection paths** for multi-sig ceremonies:
  1. **Build from form** in dApp (the existing path, now polished).
  2. **Paste frozen base64** in dApp `/create` — tabbed UI; no wallet
     required; for transactions assembled outside the dApp.
     (`dapp/hooks/useTransactionInjection.ts`)
  3. **CLI `inject` subcommand** — `npx hedera-multisig inject
     --connect ... --base64 ... --coordinator-token ...`. Reads JSON
     output of walkthrough prep scripts directly via `--base64-file`.
     For automation pipelines and fully-CLI-driven workflows.
     (`cli/commands/inject.js`)

#### Failure UX

- **Hedera result codes mapped to plain-English explanations + recovery
  actions.** `INSUFFICIENT_PAYER_BALANCE`, `INVALID_SIGNATURE`,
  `CONTRACT_REVERT_EXECUTED`, `INVALID_SCHEDULE_ID`,
  `SCHEDULE_ALREADY_EXECUTED`, `SCHEDULE_EXPIRED`, `TRANSACTION_EXPIRED`,
  `INVALID_ACCOUNT_ID`, `ACCOUNT_DELETED` — 9 codes with headline,
  explanation, and "what to do" recovery step in `PostSigningStatus.tsx`.
- **Threshold-not-met distinguished from generic "Transaction Not Found"**
  using `signaturesCollected/Required` props. Previously both surfaced
  the same yellow timeout message.
- **Mirror retry + exponential backoff** (1s / 2s / 4s) on 5xx + network
  errors + timeouts. Never retries 4xx or JSON parse failures.
  (`shared/mirror-node-client.js`)

#### Observability + operations

- **`/healthz` and `/version` HTTP endpoints** on the WebSocket server.
  `/healthz` returns JSON `{status, uptimeSec, version, sessionCount, secure}`;
  `/version` returns the package version. (`server/WebSocketServer.js`)
- **`--quiet-secrets` server CLI flag** suppresses PIN, coordinator
  token, agent API key, connection string, and QR code from stdout —
  useful when stdout is captured by Vector/Datadog/centralized logs.
  Operator reads secrets from `.multisig-session.json` instead.
- **Audit-log `WARN` lines on every auth-rejection path:** invalid
  credentials, missing credentials, public-key-not-eligible,
  per-session rate limit, reconnection rejected, browser-origin
  rejection, non-coordinator inject/execute attempts.
- **`/learn` route in dApp** with GitHub-linked walkthrough cards and
  prerequisites checklist. Nav link added on every non-landing page.
- **Hosted-vs-self-host disambiguation** — README, GETTING_STARTED,
  and dApp landing all explicitly state "we host the UI, you host the
  coordinator." Removes the largest documentation gap from the v2.0
  review.
- **Tunnel trust-model section** in `docs/COORDINATOR_GUIDE.md` —
  what the tunnel provider can see, three alternatives (own TLS cert /
  LAN-only / offline workflow), origin allowlist requirement.

#### Walkthroughs (the big new artifact)

- **`examples/walkthrough-hbar/`** — 30-minute end-to-end with
  precheck, key generation, threshold-account creation,
  mirror-confirmation. Exit point for treasury teams that only need
  HBAR/FT signing.
- **`examples/walkthrough-contract/`** — teaches every contract path:
  - Deploy as single-sig EOA (`ContractCreateFlow`)
  - Interact as EOA, fund the contract
  - Convert EOA to 2-of-3 multi-sig via `AccountUpdateTransaction`
    (with the dual-signature rule explained)
  - Negative test proving single-sig is dead (`exit 0` = expected outcome)
  - Multi-sig `increment()` ceremony
  - Multi-sig `withdraw()` ceremony
  - Alternate path doc: `ALT-deploy-as-multisig.md` covering
    deploy-directly-via-ceremony with HIP-423 scheduled support
- **`docs/THRESHOLD_GUIDE.md`** — new conceptual guide covering M-of-N
  choice (security/availability/operational-cost tradeoff, common
  mistakes, decision recipes) and **nested key-list semantics** with
  three worked examples (department-level, CEO-or-officers,
  hot-spend-with-cold-recovery). Explicit support matrix: Hedera
  consensus supports nesting natively, this library is flat-only;
  v2.2 candidate to add tree-aware coordination.
- **TESTING.md updated** with Scenarios 11 and 12 covering the two
  walkthroughs as scripted manual dry runs.

#### Tests

- 130+ new test cases across 5 new test files:
  `coordinator-authorization.test.js`, `reconnection-token.test.js`,
  `redis-session-store.test.js`, `timeParser.test.js`,
  `decoder-fixtures.test.js`. 7 decoder fixture JSON snapshots in
  `test/fixtures/decoder/` that the dApp's TS decoder tests can
  compare against.
- **Coverage gate** in CI at the realistic floor (lines 45 / functions
  35 / branches 55 — actual is 50/39/60). Catches regressions; raising
  to 70/70 is tracked as v2.2 work.

#### Type declarations

- `MirrorTransactionRecord` interface, `mirrorConfirmed` /
  `mirrorRecord` on `ExecutionResult`, full `ScheduledWorkflow` class
  with HIP-423 options, `execution-failed` in `SessionStatus` union.
  (`types/index.d.ts`)

### Fixed

- **`RedisSessionStore` field parity.** The Redis-backed session store
  silently dropped `coordinatorToken`, `agentApiKey`, `reconnectionTokens`,
  and `mode` on save — anyone running with `--redis` regressed to
  non-functional auth and legacy realtime mode on every reload. Fixed
  + new `setReconnectionToken` write-through method on both stores
  (the in-memory store mutated the live object; Redis returns a copy
  on each read). (`server/stores/RedisSessionStore.js`,
  `server/SessionStore.js`)
- **`core/TransactionDecoder.js` deprecated decoder removed from 5
  production callers** (`SigningSessionManager` ×2, `InteractiveWorkflow`,
  `OfflineWorkflow`, `cli/commands/offline.js`, `TransactionFreezer.js`).
  Decoder file reduced to a ~125-line display-only utility consuming
  the canonical shared-decoder shape.
- **Per-session signature mutex test pollution** in `sessionStore.test.js`
  — earlier test files that load `SigningSessionManager` cached
  `SessionStore` with the real `TimerController`, breaking
  `sessionStore.test.js`'s mock injection. Fixed by also flushing the
  `SessionStore` cache before re-requiring.
- **`useWallet` no longer initializes on the landing page.** The
  WalletConnect SDK chunk + two 5s polling intervals were starting on
  `/` even though the page didn't need them. NavBar now renders a
  minimal landing-page variant when `usePathname() === '/'`.
  (`dapp/components/NavBar.tsx`)
- **`fetchAccountBalance` parallelism** — the two mirror-node requests
  (`/accounts/{id}` + `/accounts/{id}/tokens`) now fire concurrently
  via `Promise.all`. (`dapp/lib/mirror-node.ts`)
- **Polling jitter** added to `PostSigningStatus` (random 0–500ms) to
  prevent N-signer thundering herd on the public mirror node.
- **History page** now explicitly states data is browser-local —
  prevents the "where did my history go?" surprise on a different
  device.
- **First-time-user hints** on `/join` (wallet requirement) and
  `/session/[id]` wallet-connect step ("What's about to happen?"
  expandable with 4-step flow).
- **Tunnel/hosted detection banner** on `/join` — pattern-match host
  on `ngrok.io|loca.lt|trycloudflare.com|localhost` to surface trust
  level (yellow for tunnel, neutral for localhost, neutral-blue for
  custom).
- **Metadata function-name cross-check** now warns when the ABI
  decoded a function but the coordinator omitted `metadata.functionName`
  (closes a silent-pass bypass).
- **`PolicyEngine` known-limitations documented** in
  `AGENT_INTEGRATION.md` — `RateLimitRule` resets on agent restart;
  `TimeWindowRule` trusts local clock.

### Infrastructure

- **Release workflow** (`.github/workflows/release.yml`) with
  `npm publish --provenance` from OIDC. Triggered on tag push
  (`v*.*.*`) or manual dispatch. Includes signed-tag verification +
  package-version-matches-tag check + production audit gate.
- **Dependabot config** (`.github/dependabot.yml`) — weekly grouped
  npm updates for root + dapp/ + GitHub Actions, with semantic groups
  (hedera, ethers, tooling, next, walletconnect, tailwind).
- **CI Node matrix** updated: Node 18 dropped (EOL'd 2025-04-30); Node
  24 added; matrix is now `[20.x, 22.x, 24.x]`.
- **dApp ESLint step** in CI's `build-check` job.

---

## [1.1.0] - 2025-12-24

### Added

#### 🌐 WalletConnect Browser dApp (Major Feature)

**Complete browser-based signing portal enabling hardware wallet and mobile wallet support**

- **Next.js Application** (`dapp/`): Production-ready React application with TypeScript and Tailwind CSS
  - Browser-compatible WebSocket client (native WebSocket API)
  - WalletConnect integration using `@hashgraph/hedera-wallet-connect`
  - Mobile-responsive UI with professional UX
  - Zero server changes required (signature-agnostic architecture)

- **Transaction Review Component**: Security-critical transaction display
  - GREEN "VERIFIED" section: Cryptographically verified data from transaction bytes
  - YELLOW "UNVERIFIED" section: Coordinator-provided metadata with warnings
  - SHA-256 checksum validation using Web Crypto API
  - Transaction decoder with support for all Hedera transaction types
  - Smart contract ABI decoding with ethers.js
  - Metadata validation with social engineering detection

- **Signing Flow**: Complete 10-state state machine
  - Wallet connection (HashPack, Blade)
  - Session authentication via WebSocket
  - Transaction review with VERIFIED/UNVERIFIED separation
  - Signature creation in wallet (keys never leave wallet)
  - Signature submission to coordinator
  - Progress tracking with threshold display
  - Transaction execution confirmation

- **UI/UX Enhancements**:
  - Toast notification system (success, error, info, warning)
  - Custom CSS animations (fade-in, slide-up, pulse, shimmer)
  - Loading states and skeleton screens
  - Smooth transitions with cubic-bezier easing
  - Improved accessibility with focus styles
  - HashScan links for all account IDs, contract IDs, and token IDs

#### 🔐 Hardware Wallet Support

- **Ledger Integration**: Sign multi-sig transactions with Ledger hardware wallets
  - Via HashPack browser extension
  - Private keys never leave Ledger device
  - Transaction details displayed on Ledger screen for verification
  - Seamless integration with web signing flow

#### 🔧 Smart Contract Integration

- **Solidity/ABI Support**: Complete documentation and implementation
  - ABI provided by coordinator in metadata
  - Function name and parameter decoding with ethers.js
  - VERIFIED function parameters (decoded from transaction bytes)
  - UNVERIFIED ABI metadata with warnings
  - Comprehensive smart contract integration guide

#### 📖 Documentation

- **WalletConnect User Guide** (`docs/WALLETCONNECT.md`): 900+ line comprehensive guide
  - What is WalletConnect and why use it
  - Supported wallets (HashPack, Blade) with comparison table
  - Hardware wallet setup instructions (Ledger)
  - Security model (VERIFIED vs UNVERIFIED)
  - Mixed sessions (CLI + Web participants)
  - FAQ and troubleshooting

- **Smart Contract Integration Guide** (`docs/SMART_CONTRACT_INTEGRATION.md`): Complete ABI integration documentation
  - ABI flow through the system
  - Coordinator: How to inject contract transactions with ABIs
  - Participant: How contract calls are reviewed
  - Security considerations for malicious ABIs
  - Complete examples

- **Security Architecture** (`docs/SECURITY_ARCHITECTURE.md`): Comprehensive security analysis
  - Security principles and goals
  - Complete data flow analysis
  - Private key security (CLI, Web, Hardware)
  - Transaction verification (two-layer system)
  - Attack vectors and mitigations
  - Security checklist for all roles

- **Deployment Guides**:
  - `dapp/DEPLOYMENT.md`: Complete Vercel deployment guide (600+ lines)
  - `dapp/VERCEL_TWO_DEPLOYMENTS.md`: Testnet + Production deployment strategy
  - `dapp/INTEGRATION_TESTING.md`: End-to-end testing guide with 4 scenarios
  - `dapp/QUICKSTART.md`: 5-minute quick start guide

- **Updated Guides**:
  - Main `README.md`: Added Web-Based Signing section with features, quick start, and examples
  - `SETUP_GUIDE.md`: Added Web-Based Signing workflow with mixed session examples

#### 🧪 Testing Infrastructure

- **Test Server Script** (`scripts/start-test-server.js`): Interactive test server for development
  - Guided setup for eligible keys
  - Auto-generates session credentials
  - Supports both tunnel and local-only modes
  - Test transaction injection on demand

- **Testing Documentation**:
  - Complete testing scenarios (Basic, Mixed, Hardware Wallet, Error Handling)
  - Testing checklists (20+ test cases)
  - Troubleshooting guide for common issues
  - Test results template

#### 🚀 Deployment Configuration

- **Vercel Configuration** (`dapp/vercel.json`): Production deployment ready
  - Environment variable configuration
  - Next.js framework presets
  - Build and output directory settings

### Changed

- **README.md**: Added Web-Based Signing section as major feature
- **SETUP_GUIDE.md**: Expanded workflows comparison with Web-Based Signing
- **package.json**:
  - Version bumped to 1.1.0
  - Added keywords: walletconnect, hardware-wallet, browser-dapp, web3
  - Updated description to mention WalletConnect dApp
- **dapp/package.json**: Version set to 1.0.0 (initial release)

### Enhanced

- **Session Recovery from localStorage**: Survive page refresh without losing connection
  - Auto-saves session state (server URL, session ID, PIN, participant ID)
  - 30-minute session expiry with automatic cleanup
  - Resume prompt on page reload
  - Backward compatible with legacy storage

- **Function Selector Verification for Smart Contracts** 🔒 **Security Critical**
  - Cryptographically verifies ABI function name matches transaction bytes
  - Compares actual function selector (first 4 bytes) with expected selector from ABI
  - Prevents malicious/fake ABIs from misleading participants
  - Automatic rejection of selector mismatches with detailed error messages

- **Rate Limiting on WebSocket AUTH** 🔒 **Security Hardening**
  - Prevents PIN brute force attacks (5 attempts per minute)
  - 5-minute block after exceeding max attempts
  - IP-based rate limiting with automatic cleanup
  - Enhanced AUTH with optional public key validation (prevents griefing)

- **QR Code for Mobile Session Joining** 📱
  - Generate QR codes containing session credentials
  - Scan QR code to auto-fill join form
  - Copy credentials button for easy sharing
  - Mobile-optimized UI

- **Transaction Review**: Now includes clickable HashScan links for:
  - Account IDs (view account on HashScan)
  - Contract IDs (view contract on HashScan)
  - Token IDs (view token on HashScan)
  - Network-aware (testnet vs mainnet)

- **Smart Contract Display**: Improved contract execution UI
  - Enhanced function parameter display
  - Function selector verification status indicator
  - Warning when ABI not provided
  - Better formatting for function names and parameters

### Technical Details

**New Dependencies** (dapp only):
- `ethers@^6.16.0` - Smart contract ABI decoding
- `@hashgraph/proto@^2.25.0` - WalletConnect library compatibility
- `@hashgraph/hedera-wallet-connect@^1.5.1` - Official Hedera WalletConnect integration
- `@walletconnect/modal@^2.7.0` - WalletConnect modal UI
- `zustand@^4.5.7` - Lightweight state management
- `qrcode.react@^4.1.0` - QR code generation for mobile joining

**Files Created**: 30+ new files
- 6 React components
- 4 custom hooks
- 4 core libraries
- 1 test server script
- 6 comprehensive documentation guides
- TypeScript type definitions

**Code Metrics**:
- ~4,000 lines of production code
- ~3,000 lines of documentation
- 10+ successful production builds verified
- Zero TypeScript compilation errors

### Security

- **No Private Key Transmission**: Keys never leave user's machine/wallet
- **Transaction Integrity**: SHA-256 checksum verification prevents tampering
- **VERIFIED vs UNVERIFIED**: Clear visual separation prevents social engineering
- **Function Selector Verification**: Cryptographically proves ABI matches transaction (prevents fake function names)
- **Rate Limiting**: Prevents PIN brute force attacks (5 attempts/min, 5-min block)
- **Public Key Validation**: Optional AUTH-time eligibility check prevents griefing
- **End-to-End Encryption**: WalletConnect uses E2E encryption (AES-256)
- **WSS Support**: Production deployments use WebSocket Secure (TLS)
- **Zero Server Changes**: Signature-agnostic architecture maintains security model
- **Session Recovery**: Secure localStorage with 30-minute expiry

### Compatibility

- **Mixed Sessions**: CLI and Web participants work seamlessly together
- **Protocol Compatibility**: 100% compatible with existing WebSocket protocol
- **Backward Compatible**: No breaking changes to existing CLI tools or library
- **Browser Support**: Works on all modern browsers (Chrome, Firefox, Safari, Brave)
- **Mobile Support**: Responsive design works on phones and tablets

### Deployment

- **Vercel Ready**: One-command deployment to Vercel
- **Two-Environment Strategy**: Separate testnet and production deployments
- **Environment Variables**: Secure configuration via Vercel dashboard
- **Custom Domains**: Support for custom domain configuration
- **Multi-Platform**: Works on Vercel, Netlify, AWS Amplify, self-hosted

### Breaking Changes

**None** - This is a purely additive release. All existing functionality remains unchanged.

---

## [1.0.0] - 2025-12-19

### Added

#### Core Features
- **M-of-N Threshold Signatures**: Support for 2-of-3, 3-of-5, and custom threshold configurations
- **Two Workflow Modes**:
  - Interactive workflow: Real-time coordination with <110s timeout
  - Offline workflow: Asynchronous air-gapped signing
- **Mixed Key Type Support**: Automatic detection and handling of Ed25519 and ECDSA secp256k1 keys
- **Three Security Tiers**:
  - Prompt-based key provider (highest security)
  - Encrypted file provider (AES-256-GCM + PBKDF2)
  - Environment variable provider (development convenience)

#### Components
- **WorkflowOrchestrator**: High-level API for multi-sig operations
- **InteractiveWorkflow**: Real-time signature collection (<110s)
- **OfflineWorkflow**: Asynchronous signature collection for air-gapped signing
- **TransactionManager**: Transaction lifecycle management
- **SignatureCollector**: M-of-N signature collection with validation
- **AuditLogger**: Comprehensive operation logging with JSONL format
- **UI Components**: Progress indicators, error formatting, transaction display

#### Key Management
- **KeyValidator**: Ed25519 and ECDSA key type detection
- **PromptKeyProvider**: Interactive key input with hideEchoBack
- **EncryptedFileProvider**: AES-256-GCM encryption with PBKDF2 (100,000 iterations)
- **EnvKeyProvider**: Environment variable key loading

#### CLI Tools
- **sign.js**: Standalone signing tool for air-gapped machines
- **createKeyFile.js**: Interactive CLI wizard for creating encrypted key files
- **testKeyFile.js**: Key file validation tool
- **securityAudit.js**: Automated security scanning

#### Testing
- **236 comprehensive tests** covering:
  - 28 key provider tests
  - 35 mixed key type tests
  - 67 workflow tests
  - 68 integration tests
  - 38 backward compatibility tests

#### Documentation
- Comprehensive user guide (MULTISIG_USER_GUIDE.md)
- Developer guide with architecture documentation (MULTISIG_DEVELOPER_GUIDE.md)
- Security analysis and threat model (MULTISIG_SECURITY.md)
- Edge cases and error recovery patterns (MULTISIG_EDGE_CASES.md)
- Production readiness checklist (MULTISIG_PRODUCTION_READINESS.md)
- Security audit review (MULTISIG_SECURITY_AUDIT_REVIEW.md)

### Security
- Zero private keys in logs or error messages
- All password prompts use hideEchoBack: true
- Comprehensive input validation
- Audit trail with sanitized output
- Signature validation before execution
- 110-second timeout with 9-second buffer before Hedera's 119s limit

### Technical Details
- **Dependencies**: Only @hashgraph/sdk and readline-sync
- **Node Version**: Requires Node.js 16+
- **Package Size**: ~367KB (27 files)
- **Zero Vulnerabilities**: Passed security audit with 59 findings reviewed (all false positives)

### Production Ready
- ✅ All development phases complete
- ✅ 236 tests passing (100% success rate)
- ✅ Security audit passed
- ✅ Comprehensive documentation (111KB+)
- ✅ Production deployment guide included

---

## [Unreleased]

### Potential Future Enhancements

**Note**: Hardware wallet support, mobile signing, and Web UI are now complete in v1.1.0! 🎉

- Batch multi-sig operations (sign multiple transactions in one session)
- Scheduled multi-sig transactions (time-locked execution)
- Multi-chain support (extend beyond Hedera)
- Session recovery from localStorage (survive page refresh)
- QR code for mobile session joining
- Multi-account selection in WalletConnect
- Auto-fetch ABIs from Hedera Mirror Node (when supported)
- User-provided ABI upload for verification
- Function selector verification for smart contracts
- Rate limiting on WebSocket AUTH attempts
- Audit logging with tamper-evident storage
- TypeScript definitions for core library (dApp already TypeScript)

---

[1.1.0]: https://github.com/lazysuperheroes/hedera-multisig/releases/tag/v1.1.0
[1.0.0]: https://github.com/lazysuperheroes/hedera-multisig/releases/tag/v1.0.0
