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

Hedera's `ScheduleCreateTransaction` / `ScheduleSignTransaction` (HIP-423) enables async signing over hours, days, or up to ~62 days instead of the 120-second real-time window. This unlocks cross-timezone treasury management, relaxed offline signing, and long-window async approvals.

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
- ~~**Scheduled-transaction injection on `/create`**~~ — ✅ shipped May 2026 (dApp `2.1.25` / CLI `2.1.15`). See *Scheduled-Transaction Coordinator UI* under Future Considerations for the implementation summary; walkthrough at [`examples/walkthrough-scheduled/`](../examples/walkthrough-scheduled/).

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

### Reconsider the Redis session store

**Status**: Deferred | **Rationale**: Maintenance burden vs concrete demand

`RedisSessionStore` (server/stores/) was built for two scenarios:

1. Coordinator restart mid-ceremony without losing session state.
2. Horizontal scaling — multiple coordinator processes sharing
   session state behind a load balancer.

Neither is a load-bearing requirement for the project's three target
use cases (treasury, agent-to-agent, scheduled txs):

- Sessions are short. Coordinator restart mid-ceremony is uncommon.
- The PIN-fallback in 2.1.7 means participants can rejoin cleanly
  even when the server lost their reconnection-token mapping.
- Single-coordinator deployments (your laptop, a VPS, fly.io) are
  the realistic shape for the foreseeable future.

The store also conflicts philosophically with the "no central trusted
intermediary" framing: Redis sees session metadata (eligible keys,
signatures during the window, transaction bodies), introducing a
third-party trust surface that operators may not want.

**Watch list** — revisit when any of these are true:

- Real users ask for it (not "we should support enterprise
  deployments" — actual integrators with real horizontal-scaling
  needs).
- Coordinator-restart-during-ceremony becomes a common failure
  mode (e.g., users running on PaaS platforms that restart
  containers frequently).

**If we decide to remove it** the deletion is contained: drop
`server/stores/RedisSessionStore.js`, `test/redis-session-store.test.js`,
the `--redis` / `--redis-*` CLI flags, the `ioredis` `optionalDependency`,
and the README "A note on --redis" section. The in-memory `SessionStore`
already implements the full async interface that the manager expects;
no other code changes are needed.

For now: keep the code, document it as "you almost certainly don't
need this" (in README + this entry), and don't invest more in it
without a real ask.

### Revisit the single-node freeze default

**Status**: Deferred | **Blocked By**: Wallet behavior change

`DEFAULT_SUBSET_SIZE` was bumped from 6 down to 1 in 2.1.10 because
HashPack via WalletConnect re-freezes `ContractExecuteTransaction`
internally before signing — applying its own gas / fee / timestamp
adjustments — and its signatures end up valid against ITS frozen bytes
rather than the coordinator's stored bytes. Multi-node freeze + wallet
signer = "0 signatures verified" with no recovery path.

The single-node default sidesteps this entirely (one body, no drift
window) but loses multi-node submission resilience: if the picked node
is busy or unhealthy at submit time, the SDK doesn't have siblings to
retry against. We mitigate via `orderByHealth` (mirror-node-backed
node ranking on freeze; see `shared/node-selection.js`), but it's a
real downside compared to the multi-node ideal.

**Watch list**:

- HashPack's WalletConnect adapter starts signing
  `ContractExecuteTransaction` verbatim (preserving the coordinator's
  bytes), or
- A new browser wallet ships with verbatim signing across all tx types
  and gains meaningful adoption, or
- A WalletConnect spec change forces wallets to preserve signable
  body bytes.

When any of those land, revisit this default. The `selectNodeAccountIds`
API already supports per-call `subsetSize` overrides so the change is
contained to changing the constant + walkthrough script defaults +
docs.

**Files that would need touching** (audit at change time):

- `shared/node-selection.js` and `dapp/lib/node-selection.ts` — the
  `DEFAULT_SUBSET_SIZE` constant.
- `examples/walkthrough-contract/07-prepare-multisig-increment.js`
  and `08-prepare-multisig-withdraw.js` — currently call out "single-
  node by default for wallet compat" in their comments.
- `examples/walkthrough-contract/README.md` — Step 7a's call-out box.
- Root `README.md` — the "Node freeze defaults" section.
- `CLAUDE.md` — the "Node freeze selection" section.

### Hybrid Air-Gap Bridge

**Status**: Deferred | **Blocked By**: Phase 4 (Scheduled Transactions)

Allow mixed online/offline signing in the same session. Deferred because the 120-second transaction validity window makes the hybrid UX unacceptably stressful. Once scheduled transactions enable hours/days signing windows, the hybrid bridge becomes practical.

See the [January 2026 8-agent analysis](#) for detailed architectural proposal.

### Scheduled-Transaction Coordinator UI

**Status**: ✅ Shipped (May 2026, dApp `2.1.25` / CLI `2.1.15`) | **Tracked from**: May 2026 walkthrough run

The dApp's `/create` page now supports HIP-423 scheduled transactions end-to-end. Each side of the protocol — coordinator, browser participant, CLI participant — has a dedicated scheduled-mode flow built around a single `SCHEDULE_CREATED` protocol seam.

**What shipped:**

- **`/create`**: A "Schedule this transaction" disclosure (collapsed by default — secondary affordance, not overwhelming) below the freeze-strategy panel. Expiration picker defaults to `24h`, validates up to ~62d (HIP-423). Optional schedule memo + advanced sub-disclosure for payer override / admin key. (`dapp/components/create/ScheduleOptions.tsx`)
- **Submission**: When the toggle is on, `useTransactionInjection.ts` builds the inner tx unfrozen, wraps it in `ScheduleCreateTransaction`, signs via the wallet, executes against the network directly, then sends `SCHEDULE_ANNOUNCE` to the WS server with the resulting `scheduleId`. Server stamps mode + scheduled context onto the session and broadcasts `SCHEDULE_CREATED` to all participants.
- **`/session/[id]` (browser participant)**: New `ScheduledReview` component replaces `TransactionReview` for scheduled-mode sessions. Long-window framing ("expires in ~23h") instead of 120s countdown. Live mirror-node lookup of `getScheduleInfo` confirms the schedule exists on-chain and shows signature progress. Approve button submits `ScheduleSignTransaction` from the wallet; reject broadcasts to the session without touching the chain.
- **CLI participant**: `client/SigningClient.js` emits `scheduleCreated` events; `cli/commands/participant.js` prompts the participant inline (or auto-approves with `--yes`), then submits `ScheduleSignTransaction` via `ScheduledWorkflow.signSchedule`. Late joiners get the same review flow via AUTH_SUCCESS sessionInfo carrying `scheduleId` + inner-tx context. No more "join via dApp → drop to CLI to call schedule sign" hand-off.
- **Walkthrough**: [`examples/walkthrough-scheduled/`](../examples/walkthrough-scheduled/) — async 24h-window HBAR transfer, hybrid HashPack + CLI signers, mirror-node verification. Sibling to `walkthrough-dapp` with shared keys / threshold account.

**Protocol additions:**

- `SCHEDULE_ANNOUNCE` (client → server, coordinator-only) and `SCHEDULE_CREATED` (server → all participants) added to `shared/protocol.js`. `getSessionInfo()` returns `mode: 'scheduled' | 'realtime'` plus all scheduled context for late joiners.
- Architectural decision: server is signaling channel only. Mirror node is source of truth for schedule status. Server does NOT broker `ScheduleSign` submissions — each signer hits the network independently. Confirmed by tests (`test/schedule-announce.test.js`).

### Real Sponsorship + Nested Threshold Keys

**Status**: Deferred | **Tracked from**: May 2026 dApp `/create` review

Two related capabilities that both require multi-account signature collection inside a single ceremony:

1. **Real sponsorship (sender ≠ fee payer).** A coordinator nominates a different account to pay the network fee from the sender. Both accounts must sign. The dApp's *Override* affordance on the **Fee payer** callout is the seam: today it conflates sender and payer (the override account becomes both). True sponsorship needs the ceremony to gather signatures for two distinct keysets and bind them to one frozen transaction.
2. **Coverage validation for nested keylists.** Hedera supports keylists-within-keylists / threshold-within-threshold structures. The current Path 2 coverage check (`dapp/lib/account-keys.ts` `parseAccountKey`) flags these as `kind: 'nested'` and refuses to validate, blocking the Build button conservatively. Recursively walking the protobuf and computing coverage against the session's flat keyset is straightforward; doing it under the same UI without overwhelming the coordinator is the harder problem.

**Why deferred**: Both require the ceremony / `SigningSessionManager` to collect signatures across multiple eligible-key sets within one session, which is a real architectural change. Path 2 (single-account coverage validation, May 2026) is the safe shipping point until there's user demand for either capability.

**Architectural seam**: The `feePayerOverride` field on `txFields` and the `ResolvedFeePayer.source = 'override'` discriminator already exist. Extending the session protocol to carry `eligiblePublicKeysFor: { [accountId]: string[] }` (instead of a single global list) is the cleanest path; the FeePayerCallout copy and override panel can be re-used.

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
