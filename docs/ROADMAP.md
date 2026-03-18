# Roadmap & Future Considerations

> **Development roadmap for Hedera MultiSig**
>
> This document tracks planned features, architectural decisions, and future considerations.

## Current Status (v2.0)

**Backend Complete**: March 2026

Following two comprehensive 9-agent reviews and a full implementation session, all backend phases (0-4) are complete plus Flora architectural prep (Phase 6):

- **Security**: 20+ bug fixes, coordinator tokens, reconnection tokens, PIN bias fix, rate limiting, origin validation
- **CLI**: 10 transaction types, connection strings, non-interactive sign, ABI support, transfer/token/session/schedule subcommands
- **Agent SDK**: AgentSigningClient, PolicyEngine (5 rules, 2 presets), API key auth, agent protocol role
- **Scheduled TX**: ScheduledWorkflow, scheduled session mode, schedule CLI
- **Architecture**: Shared protocol, error hierarchy, async SessionStore, CoordinationTransport abstraction
- **Testing**: 219 tests across 9 test files, c8 coverage tooling
- **Documentation**: SKILLS.md, AGENT_INTEGRATION.md, HOL_INTEGRATION_ANALYSIS.md, TypeScript declarations rewritten

**Next**: Phase 5 (Coordinator Panel & Product Polish — frontend dApp work)

---

## Target Use Cases

### 1. Treasury Management

Teams managing multi-sig treasuries need to move HBAR, fungible tokens, NFTs, do token associations, call smart contracts, and rotate keys -- all with multi-party signing and full transaction verification.

**Key requirement**: ABI data transmitted alongside smart contract transactions so all signers can independently decode and verify calldata before signing.

### 2. Agent-to-Agent Signing

Automated agents (AI agents, bots, policy engines) connect to signing sessions programmatically, inspect transaction details, apply policy rules (amount limits, approved recipients, time windows), and provide signatures if conditions are met.

**Key requirement**: Headless signing client with pluggable policy engine and machine-readable interfaces.

### 3. Scheduled Transactions

Hedera's `ScheduleCreateTransaction` / `ScheduleSignTransaction` enables async signing over hours/days instead of the 120-second real-time window. This unlocks cross-timezone treasury management and relaxed offline signing.

**Key requirement**: New workflow mode that wraps transactions in ScheduleCreate and tracks signatures on-chain.

---

## Development Phases

### Phase 0: Critical Bug Fixes

**Status**: Complete | **Released**: v1.3.0

Critical bugs discovered in the March 2026 review that must be fixed before any new feature work:

| ID | Issue | Severity |
|----|-------|----------|
| BUG-01 | Race condition on concurrent signature submissions (double-execution risk) | Critical |
| BUG-02 | Workflow classes instantiate static-only classes with `new` (broken run() path) | Critical |
| BUG-03 | `throw` inside `setInterval` doesn't propagate (timeout safety broken) | Critical |
| BUG-04 | Redis SessionStore sync/async API mismatch (Redis completely non-functional) | Critical |
| BUG-05 | TransactionDecoder Map vs Array bug (HBAR display silently broken) | Critical |
| SEC-05 | No coordinator authorization (any participant can claim coordinator role) | Critical |
| SEC-06 | Signatures accepted without verification in pre-session mode | High |

### Phase 1: Foundation Improvements

**Status**: Complete | **Released**: v1.4.0 / v1.5.0

Architectural cleanup that enables the three target use cases:

- **Shared protocol definition** -- single source of truth for WebSocket message types and session states
- **Transaction decoder consolidation** -- deprecate `core/TransactionDecoder`, expand shared decoder to cover all 22+ Hedera transaction types
- **Key provider `sign()` interface** -- enables agent, HSM, and MPC signing without raw key exposure
- **Error class hierarchy** -- typed errors for programmatic handling
- **Client reconnection** -- Node.js SigningClient reconnection for multi-geography reliability
- **Test infrastructure** -- coverage reporting, real source testing, security tests

### Phase 2: Treasury Management CLI

**Status**: Complete | **Released**: v1.6.0

Complete CLI coverage for all treasury operations:

- Expand `offline freeze` from 2 to 10 transaction types
- Add `--abi` support for smart contract calldata encoding/decoding
- Add `--connect <connection-string>` to participant command
- Make `sign` command non-interactive for scripting
- Promote standalone scripts to CLI subcommands (keys generate, account create, etc.)
- Add `transfer`, `token`, `contract`, and `session` subcommand groups

### Phase 3: Agent Signing SDK

**Status**: Complete | **Released**: v2.0.0

Programmatic signing interface for automated agents:

- `AgentSigningClient` with policy-based approval
- `PolicyEngine` interface with composable rules (amount limits, recipient allowlists, time windows)
- Agent-specific authentication (API keys, distinct from user PIN)
- Webhook endpoint for session events (threshold met, transaction expired)
- Policy presets (TreasuryAgent, ApprovalBot)

### Phase 4: Scheduled Transactions

**Status**: Complete | **Released**: v2.1.0

Async signing via Hedera's scheduled transaction feature:

- `ScheduledWorkflow` class -- wraps inner TX in ScheduleCreate, tracks ScheduleSign
- Scheduled session mode -- no 120-second constraint, tracks scheduleId
- Mirror node `ScheduleInfoQuery` for status monitoring
- `schedule` CLI subcommand group (create, sign, status)
- dApp UI for schedule status and remaining signatures

**Benefits**:
- Remove 120-second signing pressure for cross-timezone teams
- Enable true async multi-sig collection
- Prerequisite for hybrid air-gap bridge

### Phase 5: Coordinator Panel & Product Polish

**Status**: Planned | **Target**: v2.2.0

Transform from developer tool to end-user product:

- Transaction builder UI in dApp (form-based creation)
- Session creation from browser
- Transaction history/audit viewer
- Notification system (webhooks)
- Mirror node integration for account balances
- Landing page and role-based documentation
- Video walkthroughs
- One-click server deploy (Railway/Render/Fly.io)
- Transaction templates

### Phase 6: HOL Standards Integration (Flora)

**Status**: Architectural prep complete | **Target**: v3.0.0 (when HCS-16 stabilizes)

On-chain multi-sig coordination via HOL standards, adding a fifth coordination mode alongside Interactive, Offline, Networked, and Scheduled:

**Architectural Prep (Complete):**
- `CoordinationTransport` interface abstraction (`shared/CoordinationTransport.js`)
- `WebSocketTransport` adapter wrapping existing WebSocket server
- `FloraTransport` stub with documented Flora-specific behavior
- Transport factory: `createTransport('websocket' | 'flora', options)`
- Transport-agnostic AgentSigningClient design

**When HCS-16 stabilizes (planned Q3/Q4 2026):**
- `FloraWorkflow` — on-chain coordination via HCS topics
- `flora` CLI subcommand group (create, join, propose, sign, status)
- HCS-17 state hash verification
- HCS-18 Flora discovery protocol
- dApp Flora management page

**Relevant HOL Standards:**
| Standard | Role |
|----------|------|
| HCS-10 | Agent communication (discovery, connection channels) |
| HCS-15 | Petal accounts (multi-account identity with shared keys) |
| HCS-16 | Flora coordination (on-chain multi-sig groups) |
| HCS-17 | State hash verification (tamper-evident state proofs) |
| HCS-18 | Flora discovery (decentralized group formation) |
| HCS-26 | Agent skills registry (discoverable signing capabilities) |

See `docs/HOL_INTEGRATION_ANALYSIS.md` for full analysis and strategic rationale.

---

## Completed Improvements

### P3: Offline Signing Workflow

**Status**: Complete (v1.2.2)

| Task | Status |
|------|--------|
| `offline freeze` CLI -- Freeze TX, output base64 + checksum | Done |
| `offline decode` CLI -- Decode and display TX details | Done |
| `offline execute` CLI -- Collect signatures and execute | Done |
| Documentation -- OFFLINE_SIGNING_GUIDE.md | Done |
| 37 unit tests, shell completions, `--raw`/`--json` flags | Done |

### P0-P2: Security, CLI, Testing, Deployment

**Status**: Complete (v1.0.0 - v1.2.0)

All initial priorities completed across 20 sessions. See release history below.

---

## Future Considerations

### Hybrid Air-Gap Bridge

**Status**: Deferred | **Blocked By**: Phase 4 (Scheduled Transactions)

Allow mixed online/offline signing in the same session. Deferred because the 120-second transaction validity window makes the hybrid UX unacceptably stressful. Once scheduled transactions enable hours/days signing windows, the hybrid bridge becomes practical.

See the [January 2026 8-agent analysis](#) for detailed architectural proposal.

---

## Backlog

| ID | Feature | Notes |
|----|---------|-------|
| BACKLOG-01 | Multi-language SDK | Python, Go bindings |
| BACKLOG-02 | PWA Support | Offline-capable dApp |
| BACKLOG-03 | Hybrid Air-Gap Bridge | Blocked by scheduled TX (Phase 4) |
| BACKLOG-04 | Multi-chain support | EVM L2s, other networks |
| BACKLOG-05 | Governance module | On-chain proposal voting |
| BACKLOG-06 | Protocol versioning | Version negotiation in AUTH |
| BACKLOG-07 | Pluggable audit sink | File, database, external service |
| BACKLOG-08 | First-time user onboarding | Tooltip hints on the session page for new participants (e.g. "Your wallet will ask you to approve a signature"). Reduces confusion for users unfamiliar with multi-sig signing flows. |
| BACKLOG-09 | Dedicated documentation site | Deploy GETTING_STARTED.md, TREASURY_GUIDE.md, and COORDINATOR_GUIDE.md as a proper docs site. The footer "Docs" link currently points to the GitHub README. |
| BACKLOG-10 | Transaction builder preview | Show coordinators what the frozen transaction will look like before injecting. An expandable preview or confirmation step in the create page's build flow. Reduces injection anxiety. |

## Explicitly Not Planned

| Feature | Reason |
|---------|--------|
| Role-based access control (RBAC) | Public key access control is sufficient |
| Native mobile app | WalletConnect provides mobile access |
| Centralized SQL database | Decentralized by design |
| Custodial key management | Keys never leave user devices |

---

## Release History

| Version | Date | Highlights |
|---------|------|------------|
| v1.2.2 | 2026-01-04 | Offline signing CLI, CLAUDE.md, documentation |
| v1.2.1 | 2026-01-04 | dApp theming, dark mode, accessibility |
| v1.2.0 | 2026-01-04 | 9-agent review complete, Vercel deployed, timing-safe PIN |
| v1.1.0 | 2026-01-03 | P0/P1 security, CLI overhaul, TypeScript |
| v1.0.0 | 2026-01-02 | Initial release |

---

## Architecture Principles

1. **Security First**: Private keys never transmitted; signature-agnostic server
2. **Decentralized**: No central database; local logs; user-controlled
3. **Hedera Native**: Leverage SDK patterns; respect network constraints
4. **Developer Experience**: Clear APIs; good defaults; comprehensive docs
5. **Minimal Complexity**: Add features only when clearly needed

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup and architecture overview.

Feature requests and discussions welcome via [GitHub Issues](https://github.com/lazysuperheroes/hedera-multisig/issues).

---

*Last updated: March 2026 (9-agent deep review)*
