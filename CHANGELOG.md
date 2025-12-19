# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

### Future Enhancements
- Hardware wallet integration (Ledger, Trezor)
- Mobile app signing support
- Batch multi-sig operations
- Scheduled multi-sig transactions
- Web UI for signature coordination
- TypeScript definitions

---

[1.0.0]: https://github.com/lazysuperheroes/hedera-multisig/releases/tag/v1.0.0
