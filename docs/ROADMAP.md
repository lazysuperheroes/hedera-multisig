# Roadmap & Future Considerations

> **Development roadmap for Hedera MultiSig**
>
> This document tracks planned features, architectural decisions, and future considerations.

## Current Status (v1.2.x)

**Released**: January 2026

The project has completed a comprehensive 9-agent review and implemented all P0, P1, and P2 priorities:

- **Security**: TLS/WSS, signature verification, timing-safe PIN, 8-char alphanumeric tokens
- **CLI**: Commander.js migration, unified entry point, shell completions
- **Testing**: 79+ unit tests, Playwright E2E in CI
- **Documentation**: CONTRIBUTING.md, API docs, TypeScript declarations
- **Deployment**: npm published, Vercel production (mainnet + testnet)

## Planned Improvements

### P3: Offline Signing Workflow Enhancements

**Status**: Complete

Improved the existing offline/air-gapped signing workflow with better CLI tooling and documentation.

| Task | Description | Status |
|------|-------------|--------|
| `offline freeze` CLI | Freeze TX and output copy-paste friendly base64 + checksum | Done |
| `offline decode` CLI | Decode and display TX details for verification | Done |
| `offline execute` CLI | Collect signature tuples and execute | Done |
| Documentation | Unified OFFLINE_SIGNING_GUIDE.md | Done |
| Unit Tests | 37 tests for offline commands | Done |
| Shell Completions | Bash, Zsh, Fish, PowerShell | Done |

**Achieved**: Offline signing is now a first-class CLI workflow with:
- `hedera-multisig offline freeze` - Freeze transaction, output base64 + checksum
- `hedera-multisig offline decode` - Decode and verify transaction details
- `hedera-multisig offline execute` - Execute with collected signatures
- `--raw` flag for scripting, `--json` for structured output
- Comprehensive checksum verification

### P4: Developer Experience

| Task | Description | Priority |
|------|-------------|----------|
| Video walkthroughs | Screencasts for common workflows | Medium |
| Interactive tutorials | Step-by-step guided setup | Low |
| SDK examples | More language examples (Python, Go stubs) | Low |

---

## Future Considerations

### Scheduled Transaction Support

**Status**: Not Started | **Priority**: Medium

Hedera supports [scheduled transactions](https://docs.hedera.com/hedera/sdks-and-apis/sdks/schedule-transaction) that can have longer validity windows (days/weeks instead of 120 seconds).

**Benefits**:
- Remove 120-second signing pressure
- Enable true async multi-sig collection
- Prerequisite for hybrid air-gap bridge

**Implementation Notes**:
- Use `ScheduleCreateTransaction` to create scheduled TX
- Signers submit `ScheduleSignTransaction` at their convenience
- Transaction executes when threshold is met or at scheduled time

### Hybrid Air-Gap Bridge

**Status**: Deferred | **Blocked By**: Scheduled Transaction Support

#### What It Would Do

Allow mixed online/offline signing in the same session:
- Most signers use convenient dApp (WalletConnect)
- One signer uses air-gapped device (cold storage)
- Bridge operator mediates QR/file transfer

#### Why It's Deferred

**The 120-Second Problem**

Hedera transactions have a 120-second validity window after freezing. In a hybrid session:

1. Transaction is frozen (clock starts)
2. Online signers sign via WebSocket (~10-30 seconds)
3. Offline signer must:
   - Receive QR/file export (~5-10 seconds)
   - Transfer to air-gapped device (~10-20 seconds)
   - Review and sign (~20-30 seconds)
   - Transfer signature back (~10-20 seconds)
   - Submit to session (~5 seconds)

**Total offline time**: 50-85 seconds minimum

This leaves almost no margin for error and creates a stressful, error-prone UX.

#### 8-Agent Analysis (January 2026)

An 8-agent deep review (architect, frontend, backend, security, api-designer, cli-master, product, code-critic) analyzed the hybrid bridge proposal:

**Consensus**:
- Feature is technically feasible but UX is problematic
- 120-second window creates unacceptable time pressure
- Code complexity increase not justified for narrow use case
- **Recommendation**: Defer until scheduled transactions enable relaxed timing

**Proposed Architecture** (for future reference):
```
REST Endpoints:
  GET  /api/session/:id/export    → Export frozen TX for offline signing
  POST /api/session/:id/signature → Inject signature from offline device

WebSocket Messages:
  EXPORT_REQUEST     → Coordinator requests export
  INJECT_SIGNATURE   → Bridge operator submits offline signature

New States:
  awaiting_offline_signature → Waiting for air-gap signer
```

**Security Considerations**:
- Coordinator-only access for export/inject
- Checksum verification for tamper detection
- Timing-safe signature validation
- Rate limiting on signature injection

#### Future Path

When scheduled transactions are implemented:

1. Coordinator creates scheduled transaction (24hr+ window)
2. Online signers submit signatures via WebSocket
3. Offline signer has hours/days to:
   - Receive export at leisure
   - Sign on air-gapped device
   - Return signature without time pressure
4. Transaction executes when threshold met

**This is the right way to do hybrid signing.**

---

## Backlog (Future Consideration)

| ID | Feature | Notes |
|----|---------|-------|
| BACKLOG-01 | Multi-language SDK | Python, Go bindings |
| BACKLOG-02 | PWA Support | Offline-capable dApp |
| BACKLOG-03 | Transaction Templates | Common transaction presets |
| BACKLOG-04 | Webhook Notifications | External system integration |
| BACKLOG-05 | Video Walkthroughs | Educational content |
| BACKLOG-06 | Hybrid Air-Gap Bridge | Blocked by scheduled TX |
| BACKLOG-07 | Scheduled Transactions | Prerequisite for BACKLOG-06 |

## Explicitly Not Planned

The following are intentionally out of scope:

| Feature | Reason |
|---------|--------|
| Role-based access control (RBAC) | Public key access control is sufficient |
| Native mobile app | WalletConnect provides mobile access |
| Centralized SQL database | Decentralized by design |
| Global audit logging | Local logs only, privacy-first |
| Custodial key management | Keys never leave user devices |

---

## Architecture Principles

These principles guide feature decisions:

1. **Security First**: Private keys never transmitted; signature-agnostic server
2. **Decentralized**: No central database; local logs; user-controlled
3. **Hedera Native**: Leverage SDK patterns; respect network constraints
4. **Developer Experience**: Clear APIs; good defaults; comprehensive docs
5. **Minimal Complexity**: Add features only when clearly needed

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup and architecture overview.

Feature requests and discussions welcome via [GitHub Issues](https://github.com/example/hedera-multisig/issues).

---

*Last updated: January 2026*
