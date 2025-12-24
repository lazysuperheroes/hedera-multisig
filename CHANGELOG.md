# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
