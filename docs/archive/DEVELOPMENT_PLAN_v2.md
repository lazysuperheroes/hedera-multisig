# Hedera MultiSig v2.0 Development Plan

> **Definitive execution plan. Updated after critical review on 2026-03-18.**
>
> This plan was built from a 9-agent deep review (architect, security, CLI-master, debt-hunter,
> backend/Hedera, refactorer, QA, code-critic, product), then tightened by cross-referencing
> every agent finding against the plan to close gaps.

## How to Use This Plan

- **Work phases sequentially.** Phase 0 must complete before Phase 1 begins.
- **Within each phase**, tasks are ordered by dependency. Follow the order unless noted as independent.
- **Each task has acceptance criteria.** A task is done when ALL criteria are met.
- **Effort estimates**: S = < 1 hour, M = 1-4 hours, L = 4-8 hours, XL = 1-2 days
- **Release after each phase.** Don't wait until v2.0 to ship.
- **Breaking changes are flagged** with [BREAKING] -- these need migration notes.

---

## Release Milestones

| Version | Phase | Content |
|---------|-------|---------|
| v1.3.0 | Phase 0 | Critical bug fixes + CI fixes |
| v1.4.0 | Phase 1a | Protocol, decoder consolidation, shared infra |
| v1.5.0 | Phase 1b | Key provider, errors, client, tests, cleanup |
| v1.6.0 | Phase 2 | Treasury management CLI |
| v2.0.0 | Phase 3 | Agent signing SDK |
| v2.1.0 | Phase 4 | Scheduled transactions |
| v2.2.0 | Phase 5 | Coordinator panel |

---

## PHASE 0: Critical Bug Fixes → v1.3.0

**Goal**: Fix bugs that cause incorrect behavior, data corruption, or security bypass.
**Scope**: Only bugs and CI. No features, no refactoring beyond what the fix requires.

### 0A. Correctness Bugs (ordered by severity)

**BUG-01**: Race condition on concurrent signature submissions [Effort: M]
- File: `server/SigningSessionManager.js` — `submitSignature()` method
- Problem: Two concurrent WebSocket messages can both pass the duplicate check before either writes, allowing double signatures and potentially double-execution of a financial transaction.
- Fix: Add a per-session promise chain or mutex. Serialize all calls to `submitSignature` for the same `sessionId`.
- Acceptance: Two simultaneous `SIGNATURE_SUBMIT` messages for the same session produce exactly one signature entry and at most one execution.
- Dependency: None

**BUG-02**: Workflow classes instantiate static-only classes [Effort: S]
- Files: `workflows/InteractiveWorkflow.js:38-40`, `workflows/OfflineWorkflow.js:39-41`
- Problem: `new SignatureCollector()`, `new SignatureVerifier()`, `new TransactionExecutor()` — all three classes have only static methods. Calling instance methods (`this.collector.collectSignature()`) throws TypeError.
- Fix: Replace `this.collector.collectSignature(...)` with `SignatureCollector.collectInteractive(...)` and equivalent for the other two classes. Remove the `new` instantiations.
- Acceptance: `InteractiveWorkflow.run()` and `OfflineWorkflow.run()` execute without TypeError. Add a smoke test for each.

**BUG-03**: `throw` inside `setInterval` in SignatureCollector [Effort: S]
- File: `core/SignatureCollector.js:90`
- Problem: `throw new Error('Timeout!')` inside a setInterval callback doesn't propagate to the caller. It either crashes the process with an unhandled exception or silently vanishes.
- Fix: Set a flag `expired = true` and check it in the collection loop. Clear the interval. Reject the enclosing Promise.
- Acceptance: When the signing timeout is reached, the calling code receives the error (not the process). Write a test with a short timeout.

**BUG-04**: Redis SessionStore sync/async mismatch [BREAKING] [Effort: L]
- Files: `server/SessionStore.js`, `server/stores/RedisSessionStore.js`, `server/SigningSessionManager.js`
- Problem: `SessionStore` methods are synchronous. `RedisSessionStore` methods are async. `SigningSessionManager` calls them synchronously (`this.store.getSession()` returns a Promise when using Redis, not a session object). Redis store is completely non-functional.
- Fix: Make all `SessionStore` methods `async`. Update `SigningSessionManager` to `await` every store call. This is a large change touching most methods in both files.
- Acceptance: Full signing flow works with `RedisSessionStore` (test with ioredis-mock). All existing in-memory tests still pass.
- Note: This is the hardest task in Phase 0. Consider doing it last so other bug fixes don't conflict.

**BUG-05**: TransactionDecoder Map vs Array for hbarTransfers [Effort: S]
- File: `core/TransactionDecoder.js:174`
- Problem: Iterates `_hbarTransfers` with `.forEach((amount, accountId) => ...)` (Map API). The Hedera SDK now uses an Array of Transfer objects. HBAR transfer display silently shows nothing.
- Fix: Iterate as array: `for (const transfer of hbarTransfers) { const { accountId, amount } = transfer; ... }`. Match the pattern in `shared/transaction-decoder/index.js:243`.
- Acceptance: HBAR transfers display correctly in `core/TransactionDecoder.display()`. Test with a real frozen TransferTransaction.

**BUG-06**: Missing `TransactionId.generate()` in offline freeze [Effort: S]
- File: `cli/commands/offline.js:98-111`
- Also: `examples/smart-contract-multisig.js` (ContractCreate at line 201, ContractExecute at line 250)
- Problem: Calls `freezeWith(client)` without first calling `TransactionId.generate(operatorId)`. The project's own CLAUDE.md says this is required for multi-sig hash stability.
- Fix: Add `transaction.setTransactionId(TransactionId.generate(operatorId))` before `freezeWith()` in both files.
- Acceptance: Transaction hashes are consistent when the same transaction is frozen on different machines.

**BUG-07**: `listActiveSessions()` and `setParticipantReady()` counter bugs [Effort: S]
- File: `server/SessionStore.js`
- Problems (3 bugs, all in the same file, fix together):
  1. Line 301: `listActiveSessions()` filters on `'active'` status that never exists. Fix: filter `['waiting', 'transaction-received', 'signing']`.
  2. Line 335: `setParticipantReady()` increments `participantsReady` unconditionally. If called twice for the same participant, the counter is wrong. Fix: guard with `if (participant.status !== 'ready')`.
  3. Lines 224-239: `removeParticipant()` only decrements the ready counter if status is `'ready'`, but a participant who went `ready → signed → disconnect` was counted as ready and never decremented. Fix: use a `Set` of ready participant IDs instead of an integer counter, or check `status === 'ready' || status === 'signed'`.
- Acceptance: `participantsReady` count is always accurate. `listActiveSessions()` returns sessions in waiting/transaction-received/signing states.
- Note: Apply the same fixes to `RedisSessionStore.js` for the counter bugs.

**BUG-08**: RedisSessionStore uses raw `setInterval` [Effort: S]
- File: `server/stores/RedisSessionStore.js:657`
- Problem: Uses raw `setInterval` instead of `timerController.setInterval()`. The interval leaks on shutdown.
- Fix: Use `timerController.setInterval()` like `SessionStore.js` does.
- Acceptance: After `timerController.clearAll()`, no Redis cleanup intervals remain.

**BUG-09**: SignatureVerifier threshold vs all-valid logic conflict [Effort: S]
- File: `core/SignatureVerifier.js:78-96`
- Problem: In a 2-of-3 scenario with 2 valid + 1 invalid signatures, threshold passes (2 >= 2) but `result.valid` is set to `false` at line 96 because `validCount (2) !== totalCount (3)`. The two checks contradict.
- Fix: When threshold is specified, set `result.valid = result.validCount >= threshold`. When no threshold, keep `result.valid = result.validCount === result.totalCount`.
- Acceptance: In 2-of-3 with 2 valid signatures, `result.valid === true` and `result.thresholdMet === true`.

**BUG-10**: `require` inside for loop in TransactionExecutor [Effort: S]
- File: `core/TransactionExecutor.js:66`
- Problem: `const { PublicKey } = require('@hashgraph/sdk')` is inside a `for` loop. No runtime impact (Node caches require) but inconsistent with the top-of-file imports on line 1.
- Fix: Move `PublicKey` to the top-level require on line 1.
- Acceptance: Import is at top of file. Tests still pass.

### 0B. Security Fixes

**SEC-05**: Coordinator authorization [BREAKING] [Effort: M]
- File: `server/WebSocketServer.js:524-576`
- Problem: Any authenticated client can claim `role: 'coordinator'` during AUTH. There is no verification that the connecting client is the session creator.
- Fix: Generate a separate `coordinatorToken` at session creation time (returned only to the creator). The AUTH message for coordinator role must include this token. Participants never receive it.
- Acceptance: A participant who knows only the session PIN cannot claim coordinator role. The coordinator must present the separate token.
- Migration: Existing connection strings don't include coordinator tokens. The coordinator CLI must be updated to store and present the token.

**SEC-06**: Reject signatures when no frozen transaction stored [Effort: S]
- File: `server/SigningSessionManager.js:310-323`
- Problem: When `session.frozenTransaction` is null (pre-session mode), signatures are accepted without cryptographic verification. An attacker can fill signature slots with garbage.
- Fix: Return an error from `submitSignature()` if `session.frozenTransaction` is null.
- Acceptance: `SIGNATURE_SUBMIT` before `TRANSACTION_INJECT` returns `SIGNATURE_REJECTED` with message "No transaction to sign".

**SEC-07**: Audit log metadata spread [Effort: S]
- File: `core/TransactionExecutor.js:184`
- Problem: `...metadata` spread at end of audit entry can overwrite `timestamp`, `transactionId`, `status`, `signers`.
- Fix: Place metadata in a nested key: `metadata: metadata` instead of `...metadata`.
- Acceptance: Passing `{ timestamp: 'fake' }` as metadata does NOT overwrite the actual timestamp in the audit log.

**SEC-08**: Audit log path traversal [Effort: S]
- File: `core/TransactionExecutor.js:205-225`
- Problem: `options.auditLogPath` is used without validation. Could write to arbitrary file system locations.
- Fix: Validate that the resolved path is within an allowed directory (process.cwd() or a configured base).
- Acceptance: `auditLogPath: '../../etc/something'` is rejected.

**SEC-09**: Stop storing PIN in localStorage [Effort: M]
- File: `dapp/hooks/useSessionRecovery.ts:64-75`
- Problem: PIN stored in plain text in localStorage. Any XSS or browser extension can extract it.
- Fix: After successful AUTH, server issues a short-lived session reconnection token in `AUTH_SUCCESS`. Client stores only this token (not the PIN). Reconnection uses the token instead of replaying the PIN.
- Acceptance: After page load, `localStorage` does not contain the PIN. Reconnection still works using the session token.
- Dependency: Requires server-side change (new `reconnectionToken` in AUTH_SUCCESS) + client-side change.

**SEC-10**: PIN generation modulo bias [Effort: S]
- File: `server/SigningSessionManager.js:717`
- Also: `keyManagement/EncryptedFileProvider.js:398-408` (same pattern for passphrase generation)
- Problem: `chars[bytes[i] % chars.length]` where `chars.length = 30` and bytes range 0-255. Characters at indices 0-15 have ~12% higher probability than 16-29.
- Fix: Use rejection sampling. Discard bytes >= 240 (largest multiple of 30 <= 256) and redraw.
- Acceptance: PIN character distribution is uniform across the charset.

### 0C. CI Fixes

**CI-01**: Fix CI branch triggers [Effort: S]
- File: `.github/workflows/test.yml:5`
- Fix: Add `bugfix/**` to `on.push.branches` and `on.pull_request.branches`.
- Acceptance: Pushing to `bugfix/e2e-testing-fixes` triggers CI.

**CI-02**: Run workflow tests in CI [Effort: S]
- File: `.github/workflows/test.yml`
- Fix: Add `npm run test:workflows` to the test job.
- Acceptance: Workflow tests appear in CI output.

**CI-03**: Make security audit blocking [Effort: S]
- File: `.github/workflows/test.yml`
- Fix: Remove `continue-on-error: true` from security-audit job. Allow moderate issues but fail on high/critical.
- Acceptance: A high-severity npm audit finding fails CI.

**CI-04**: Add dApp tests to CI [Effort: S]
- File: `.github/workflows/test.yml`
- Fix: Add step `cd dapp && npx jest --ci` to the test job.
- Acceptance: dApp Jest tests run in CI.

**CI-05**: Run npm audit fix [Effort: S]
- Problem: `serialize-javascript <= 7.0.2` has a high-severity RCE (GHSA-5c6j-r48x-rmvq) via mocha.
- Fix: Update mocha or add an npm override/resolution for serialize-javascript.
- Acceptance: `npm audit` reports no high-severity issues.

### 0D. Trivial Fixes (bundle with Phase 0 commit)

These are one-line or trivial changes that should be done during Phase 0 but don't warrant separate tasks:

- [ ] Fix `var` to `let` in `server/WebSocketServer.js:494`
- [ ] Fix GitHub footer link in `dapp/app/page.tsx:67` — change `hashgraph/hedera-multisig` to `lazysuperheroes/hedera-multisig`
- [ ] Move `node-fetch` from dependencies to devDependencies in `package.json` (only used in examples, not main library)
- [ ] Move `require('@hashgraph/sdk').PublicKey` to top of `core/TransactionExecutor.js` (BUG-10 above)
- [ ] Remove `test/keyTypeDetection.js` (debugging script, not a test)
- [ ] Add `.multisig-session.json` to `.gitignore`
- [ ] Add `AGENT_ANALYSIS.MD` to `.npmignore`
- [ ] Remove hardcoded `$0.10/HBAR` gas estimate from `core/TransactionDecoder.js:89,152` — show HBAR cost only, not USD

**Phase 0 total: ~17 substantive tasks + 8 trivial fixes. Estimated effort: 3-5 days.**

---

## PHASE 1a: Protocol & Decoder Consolidation → v1.4.0

**Goal**: Establish shared infrastructure and consolidate the transaction decoder.
**Prerequisite**: Phase 0 complete (especially BUG-04 async store, since protocol changes touch session management).

### Protocol & Shared Infrastructure

**ARCH-01**: Create shared protocol definition [Effort: M]
- Create `shared/protocol.js` with:
  - `MESSAGE_TYPES` — all client→server and server→client message type constants (AUTH, AUTH_SUCCESS, SIGNATURE_SUBMIT, TRANSACTION_RECEIVED, INJECTION_FAILED, EXECUTION_FAILED, etc.)
  - `SESSION_STATES` — valid states and transitions
  - `PARTICIPANT_STATES` — connected, ready, signed, disconnected
  - `ERROR_CODES` — SIGNATURE_INVALID, SESSION_NOT_FOUND, AUTH_FAILED, etc.
  - `validateStateTransition(current, next)` — returns boolean
- Update `server/WebSocketServer.js`, `client/SigningClient.js`, `dapp/types/protocol.ts` to import from this source.
- Acceptance: All message type strings come from `shared/protocol.js`. `STATUS_UPDATE` and `EXECUTE_TRANSACTION` (currently undocumented) are included. dApp types are generated from or validated against the shared definition.

**ARCH-02**: Extract shared utilities [Effort: S]
- Create `shared/crypto-utils.js`: `timingSafeCompare()`, `generateSessionId()`, `generateParticipantId()`
- Create `shared/transaction-utils.js`: `normalizeFrozenTransaction()`
- Create `shared/key-utils.js`: `sanitizePublicKey()` (single implementation, consistent truncation)
- Update all call sites in `SessionStore`, `RedisSessionStore`, `WebSocketServer`, `SigningSessionManager`, `KeyProvider`, `KeyValidator`, `TransactionExecutor`.
- Acceptance: No duplicate implementations remain. `grep -r "timingSafeCompare\|_timingSafeCompare\|sanitizePublicKey\|_sanitizePublicKey\|_normalizeFrozenTransaction\|_generateSessionId\|_generateParticipantId" server/ core/ keyManagement/` returns only imports.

**ARCH-03**: Expand `shared/index.js` barrel export [Effort: S]
- Currently only exports connection-string utilities.
- Add exports for: logger, TimerController, transaction-decoder, protocol, crypto-utils, transaction-utils.
- Acceptance: `const { Logger, TimerController, TransactionDecoder, MESSAGE_TYPES } = require('./shared')` works.

### Transaction Decoder Consolidation

**DECODE-01**: Deprecate `core/TransactionDecoder.js` [Effort: M]
- Problem: Core decoder supports 5 types, shared decoder supports 22+. Core uses wrong Map iteration for hbarTransfers (already fixed in BUG-05 but the whole decoder is redundant).
- Move `display()` and `_displayCompact()` to `ui/TransactionDisplay.js`.
- Update all imports in `server/SigningSessionManager.js`, `workflows/`, `client/TransactionReviewer.js` to use `shared/transaction-decoder`.
- Keep `core/TransactionDecoder.js` as a thin wrapper that delegates to shared, for backward compatibility. Mark as deprecated in JSDoc.
- Acceptance: No code path uses the core decoder's own `_decode*` methods. All decoding goes through shared.

**DECODE-02**: Add missing transaction type decoders [Effort: L]
- Add detail extraction methods to `shared/transaction-decoder/index.js` for:
  - `TokenCreateTransaction` — name, symbol, decimals, initial supply, treasury account, keys
  - `TokenMintTransaction` — token ID, amount/metadata
  - `TokenBurnTransaction` — token ID, amount/serial numbers
  - `TokenUpdateTransaction` — token ID, changed fields
  - `TokenDeleteTransaction` — token ID
  - `TokenFreezeTransaction` / `TokenUnfreezeTransaction` — token ID, account
  - `AccountDeleteTransaction` — account ID, transfer account
  - `ContractDeleteTransaction` — contract ID, transfer account
  - `AccountAllowanceApproveTransaction` — owner, spender, amounts
  - `AccountAllowanceDeleteTransaction` — owner, removed allowances
  - `ScheduleCreateTransaction` — inner transaction (recursive decode), payer, expiration
  - `ScheduleSignTransaction` — schedule ID
- Mirror changes to `dapp/lib/transaction-decoder.ts` (browser decoder).
- Acceptance: `TransactionDecoder.decode(frozenTx)` returns detailed fields for all types above. Each type has at least one unit test.

**DECODE-03**: Token metadata enrichment [Effort: M]
- Problem: Fungible token amounts display as raw integers (e.g., "1000000" instead of "1.000000 USDC").
- Create `shared/mirror-node-client.js` — lightweight Node.js client for Hedera mirror node (token info, account info). The dApp already has `dapp/lib/mirror-node.ts` for the browser.
- Add optional `enrichWithTokenMetadata(txDetails, network)` function to the shared decoder.
- Acceptance: When network is available, token transfers show `"1.000000 USDC"` not `"1000000"`. When offline, raw amounts shown with a note.

**DECODE-04**: Make ABI serializable in WebSocket messages [Effort: S]
- File: `server/WebSocketServer.js:789-796`
- Problem: `contractInterface` (an ethers.Interface object) does not survive `JSON.stringify()`. Signers of smart contract transactions cannot decode calldata.
- Fix: Transmit ABI as JSON array in a new `abi` field. Recipients reconstruct the Interface on their end.
- Acceptance: A CLI participant receiving a `ContractExecuteTransaction` via WebSocket can decode the function name and parameters from the transmitted ABI.
- Note: This is architectural (protocol change) so it belongs in Phase 1, not Phase 2.

### Security Hardening (moved from Phase 0 — these are improvements, not bug fixes)

**SEC-11**: Per-session rate limiting [Effort: S]
- File: `server/WebSocketServer.js`
- Fix: After N failed AUTH attempts against a specific session (e.g., 20 total from all IPs), temporarily lock the session.
- Acceptance: 21st failed attempt from any IP returns "session locked" error.

**SEC-12**: WebSocket origin validation [Effort: S]
- File: `server/WebSocketServer.js:98-103`
- Fix: Add `verifyClient` callback to validate the `origin` header for browser connections. Allow configurable allowed origins.
- Acceptance: A WebSocket connection from an unauthorized origin is rejected.

**SEC-13**: Maximum session count [Effort: S]
- File: `server/SessionStore.js`
- Fix: Add configurable `maxSessions` (default: 100). Reject `createSession` when limit reached.
- Acceptance: Session creation beyond the limit returns an error.

**Phase 1a total: ~10 tasks. Estimated effort: 5-8 days.**

---

## PHASE 1b: Client, Errors, Tests, Cleanup → v1.5.0

**Goal**: Fix client reliability, establish error patterns, improve test quality, clean up stale code.
**Prerequisite**: Phase 1a complete (shared protocol and decoder needed by clients and tests).

### Key Provider Abstraction

**KEY-01**: Add `sign()` method to KeyProvider [Effort: M]
- File: `keyManagement/KeyProvider.js`
- Add `async sign(transactionBytes)` — returns `{ publicKey, signature }`.
- Add `canExposeKeys()` — returns `true` for existing providers, `false` for future HSM/agent providers.
- Update existing providers (EnvKeyProvider, PromptKeyProvider, EncryptedFileProvider) to implement `sign()` using their internal key.
- Acceptance: All existing tests pass. A provider that implements only `sign()` (not `getKeys()`) can participate in signing.

**KEY-02**: Update workflows to use `sign()` path [Effort: M]
- Files: `workflows/InteractiveWorkflow.js`, `workflows/OfflineWorkflow.js`, `core/SignatureCollector.js`
- When `canExposeKeys()` is false, use `sign()` instead of `getKeys()`.
- Acceptance: A mock KeyProvider with `canExposeKeys() = false` and `sign()` implementation successfully signs a transaction.

### Error Handling

**ERR-01**: Define error class hierarchy [Effort: M]
- Create `shared/errors.js` with:
  - `MultiSigError extends Error` — base class with `code` property
  - `TransactionExpiredError`, `InvalidSignatureError`, `InsufficientSignaturesError`, `SessionNotFoundError`, `AuthenticationError`, `RateLimitError`
- Update throw sites across `server/`, `core/`, `client/` to use typed errors.
- Update `ui/ErrorFormatter.js` to check `error.code` before falling back to string matching.
- Acceptance: Callers can `catch (e) { if (e instanceof InvalidSignatureError) ... }`.

**ERR-02**: Add error codes to WebSocket messages [Effort: S]
- Requires: ARCH-01 (error codes defined in protocol)
- Update all error responses (`AUTH_FAILED`, `SIGNATURE_REJECTED`, `INJECTION_FAILED`, `EXECUTION_FAILED`) to include a `code` field from the protocol error codes.
- Acceptance: Every error WebSocket message includes a machine-readable `code` field.

### Client Improvements

**CLIENT-01**: Node.js SigningClient reconnection [Effort: M]
- File: `client/SigningClient.js`
- Problem: Zero reconnection logic. Browser client has full reconnection support.
- Fix: Port the reconnection pattern from `dapp/lib/websocket-client.ts` — store `connectionParams`, on `close` event, attempt reconnect with backoff up to `maxReconnectAttempts`.
- Acceptance: A CLI participant whose connection drops during the pre-session phase automatically reconnects.

**CLIENT-02**: Clock offset broadcast [Effort: S]
- File: `server/WebSocketServer.js` — `TRANSACTION_RECEIVED` broadcast
- Add `serverTimestamp: Date.now()` to the message payload. Clients compute `clockOffset = serverTimestamp - localTimestamp` and adjust the countdown display.
- Acceptance: A client with 5-second clock skew still shows an accurate countdown.

**CLIENT-03**: Participant identity preservation on reconnect [Effort: S]
- File: `server/SessionStore.js`
- Add `rejoinParticipant(sessionId, publicKey)` — if a participant with this public key already exists, reuse their `participantId` instead of creating a new one.
- Acceptance: A participant who disconnects and reconnects has the same `participantId`. Their previous signature (if submitted) is preserved.

### dApp Fixes

**DAPP-01**: Fix `useTransactionReview.refresh` no-op [Effort: S]
- File: `dapp/hooks/useTransactionReview.ts:100-105`
- Problem: `refresh` sets `loading: true` but doesn't trigger re-execution of the decode `useEffect`. The component enters a permanent loading state.
- Fix: Add a `refreshCounter` state variable. Include it in the `useEffect` dependency array. `refresh` increments it.
- Acceptance: Calling `refresh()` triggers a re-decode and returns to non-loading state.

**DAPP-02**: Reduce useWallet polling from 1s to 5s [Effort: S]
- File: `dapp/hooks/useWallet.ts:92-94, 103-138`
- Problem: Two `setInterval` calls at 1000ms each. Unnecessary CPU/battery drain.
- Fix: Increase intervals to 5000ms. Add `document.visibilityState` check to pause when tab is not visible.
- Acceptance: Polling occurs at 5s intervals. Pauses when tab is backgrounded.

### Stale Code Cleanup

**CLEAN-01**: Fix stale file path references [Effort: S]
- 16 occurrences of `node lib/multiSig/cli/` across core/, workflows/, ui/, cli/, keyManagement/.
- Replace with correct paths (`npx hedera-multisig` or `node cli/`).
- Acceptance: `grep -r "lib/multiSig" .` returns no results (excluding node_modules).

**CLEAN-02**: Rewrite TypeScript declarations [Effort: L]
- File: `types/index.d.ts`
- Problem: Declarations don't match actual API. `TransactionFreezer` declared with constructor but is all-static. `SignatureCollector` declared with instance methods that don't exist. `OfflineWorkflow` declared with `export()/import()` but actual methods are `freezeAndExport()/collectSignatures()`.
- Fix: Rewrite to match the actual public API of each class. Test with `tsc --noEmit` against a test consumer file.
- Acceptance: A TypeScript consumer can import and call the actual API without type errors.

**CLEAN-03**: Lazy-require ethers [Effort: S]
- Files: `shared/transaction-decoder/index.js:39`, `client/TransactionReviewer.js:10`
- Move `require('ethers')` inside the methods that use it (`decodeSolidityFunction`, contract-related display).
- Acceptance: `require('hedera-multisig')` does not load ethers. `require('ethers')` only called when `contractInterface` is passed.

**CLEAN-04**: Deprecate standalone CLI files [Effort: S]
- Files: `cli/server.js`, `cli/participant.js`, `cli/sign.js`
- These duplicate the Commander.js commands in `cli/commands/`. Add deprecation warnings that point to `hedera-multisig server`, `hedera-multisig participant`, `hedera-multisig sign`.
- Update `package.json` scripts to point to the Commander.js entry point.
- Acceptance: `npm run multisig-server` uses the Commander.js command (possibly via the deprecated wrapper with a warning).

**CLEAN-05**: Deprecate `--key` flag on participant command [Effort: S]
- File: `cli/commands/participant.js:19`
- Problem: `--key <key>` accepts a raw private key as a CLI argument. Private keys are visible in process lists (`ps aux`), shell history, and logs.
- Fix: Add a deprecation warning. Document `--key-file` as the correct approach. For agent workflows, recommend env var or stdin.
- Acceptance: Using `--key` prints a deprecation warning directing users to `--key-file`.

**CLEAN-06**: Remove unused `node-fetch` from main dependencies [Effort: S]
- Only used in `examples/` (not main library).
- Move to devDependencies or remove entirely (examples can document it as a prerequisite).
- Acceptance: `node-fetch` not in `dependencies` in `package.json`.

### Test Infrastructure

**TEST-08**: Refactor tests to test actual source code [Effort: M]
- Files: `test/offline.test.js`, `test/websocket.test.js`
- Problem: These tests reimplement the logic they should be testing. `parseSignatureTuple`, `validateTransferOptions`, `validateContractOptions`, `validateMessage`, `normalizeFrozenTransaction` are all re-coded inline instead of imported from source.
- Fix: Import the actual functions from `cli/commands/offline.js` and `server/WebSocketServer.js`. If functions are not exported, refactor to export them.
- Acceptance: Every function tested is the actual production function, not a reimplementation.

**TEST-09**: Add unit tests for zero-coverage critical modules [Effort: L]
- Add tests for:
  - `core/TransactionExecutor` — signature attachment, audit log writing, error handling
  - `shared/transaction-decoder` — decode each supported transaction type, ABI decoding, checksum verification
  - `shared/connection-string.js` — generate, parse, round-trip, malformed input
  - `client/TransactionReviewer` — VERIFIED/UNVERIFIED display, urgency detection
- Acceptance: Each module has at least 5 meaningful tests. Coverage reporting shows > 50% line coverage for each.

**TEST-10**: Add security tests [Effort: M]
- Test scenarios:
  - Unauthenticated client sends SIGNATURE_SUBMIT → rejected
  - Wrong PIN → AUTH_FAILED
  - Signature from ineligible key → SIGNATURE_REJECTED
  - Signature submitted before transaction injection → rejected (SEC-06)
  - Rate limiting triggers after threshold → blocked
- Acceptance: All scenarios pass. These run in CI.

**TEST-11**: Convert legacy test files to Mocha [Effort: S]
- Files: `test/keyProviders.test.js`, `test/multiKeyType.test.js`
- Problem: Use custom `assert()` and `process.exit()` instead of Mocha `describe`/`it`/`expect`.
- Acceptance: Both files use Mocha patterns. Can be run with `--grep`.

**TEST-12**: Add test coverage reporting [Effort: S]
- Integrate `c8` with Mocha. Add `npm run test:coverage` script.
- Set initial minimum thresholds (e.g., 40% line coverage) and enforce in CI.
- Acceptance: `npm run test:coverage` produces a coverage report. CI fails if thresholds are not met.

### Logging

**LOG-01**: Migrate console.log in core modules [Effort: M]
- Migrate `console.log` calls in `core/SignatureCollector.js`, `core/TransactionExecutor.js`, and `core/TransactionDecoder.js` to the structured logger.
- Add `silent` mode to `shared/logger.js` for library consumers.
- Acceptance: `require('hedera-multisig')` produces no console output unless logging is explicitly enabled.
- Note: Don't migrate all ~100 calls at once. Start with core/ (most important for library consumers). Server/ and workflows/ can be done later.

**Phase 1b total: ~20 tasks. Estimated effort: 8-12 days.**

---

## PHASE 2: Treasury Management CLI → v1.6.0

**Goal**: Complete CLI coverage for all Hedera transaction types needed by treasury teams.
**Prerequisite**: Phase 1a (DECODE-02 new type decoders, DECODE-04 ABI serialization).

### Core CLI Improvements

**CLI-11**: Add `--connect <connection-string>` to participant [Effort: S]
- Parse `hmsc:` connection strings using existing `shared/connection-string.js:parseConnectionString()`.
- Accept either `--connect hmsc:...` OR `--url/--session/--pin` (but not both).
- Acceptance: `hedera-multisig participant --connect hmsc:eyJz...` works.

**CLI-12**: Non-interactive `sign` command [Effort: M]
- Add flags: `--base64 <tx>`, `--key-file <path>`, `--passphrase <value>` (for encrypted keys), `--json`, `--no-confirm`.
- Accept transaction bytes from stdin when `!process.stdin.isTTY`.
- Output signature tuple (`publicKey:signatureBase64`) to stdout.
- Acceptance: `echo "<base64>" | hedera-multisig sign --key-file keys.enc --passphrase secret --json` produces JSON with signature tuple. Exit code 0 on success.

**CLI-13**: TTY detection and NO_COLOR [Effort: S]
- Check `process.stdout.isTTY` before using chalk colors.
- Check `process.stdin.isTTY` for stdin piping.
- Respect `NO_COLOR` env var (disable chalk entirely).
- Acceptance: `hedera-multisig offline decode --base64 ... | cat` produces no ANSI escape codes.

**CLI-14**: Stdin pipe for `offline decode` [Effort: S]
- When `!process.stdin.isTTY` and no `--base64`/`--file`, read from stdin.
- Acceptance: `hedera-multisig offline freeze ... --raw | hedera-multisig offline decode` works.

### Transaction Type Expansion

**CLI-15**: Expand `offline freeze` [Effort: L]
- Add `--type` values: `token-transfer`, `nft-transfer`, `token-associate`, `token-dissociate`, `account-update`, `contract-create`, `token-create`, `token-mint`, `token-burn`.
- Each type has appropriate flags (e.g., `--token`, `--serial`, `--account`, `--key`, `--bytecode`).
- All call `TransactionId.generate(operatorId)` before `freezeWith()`.
- Acceptance: Each new type can be frozen, decoded, and verified. At least one test per type.
- Dependency: DECODE-02 (decoders for these types must exist first).

**CLI-16**: Add `transfer` subcommand group [Effort: M]
- `hedera-multisig transfer hbar --from <id> --to <id> --amount <hbar> [--json]`
- `hedera-multisig transfer token --token <id> --from <id> --to <id> --amount <n> [--json]`
- `hedera-multisig transfer nft --token <id> --serial <n> --from <id> --to <id> [--json]`
- These create a session, freeze the TX, inject it, and wait for signatures (convenience wrappers over the server + offline freeze flow).
- Acceptance: `hedera-multisig transfer hbar --from 0.0.X --to 0.0.Y --amount 10 --json` outputs session connection info.

**CLI-17**: Add `token` subcommand group [Effort: S]
- `hedera-multisig token associate --account <id> --tokens <id1,id2,...> [--json]`
- `hedera-multisig token dissociate --account <id> --tokens <id1,id2,...> [--json]`
- Acceptance: Token association works end-to-end via CLI.

### Smart Contract Support

**CLI-18**: ABI support in CLI [Effort: M]
- Add `--abi <file>` to `offline freeze -t contract-execute` — reads ABI JSON file, encodes calldata from `--function <name> --args <csv>`.
- Add `--abi <file>` to `offline decode` — decodes calldata to human-readable parameters.
- Add `contract encode` subcommand — `hedera-multisig contract encode --abi <file> --function <name> --args <csv>` → outputs hex calldata.
- Acceptance: A smart contract call can be fully constructed, frozen, decoded, and verified using only CLI tools.

### Session Management

**CLI-19**: `keys create` non-interactive mode [Effort: S]
- Add flags: `--key <hex>`, `--passphrase <value>`, `--output <path>`, `--description <text>`.
- Acceptance: `hedera-multisig keys create --key abc123... --passphrase secret --output keys.enc --json` works without prompts.

**CLI-20**: Promote scripts to CLI subcommands [Effort: L]
- Migrate to Commander.js commands:
  - `hedera-multisig keys generate` (from `scripts/generate-keys.js`)
  - `hedera-multisig account create` (from `scripts/create-multisig-account.js`)
  - `hedera-multisig account setup-multisig` (from `scripts/setup-multisig-account.js`)
  - `hedera-multisig account update-keys` (from `scripts/update-multisig-keys.js`)
  - `hedera-multisig account revert` (from `scripts/revert-to-single-sig.js`)
- All support `--json` output.
- Acceptance: Each promoted command works and has at least basic validation tests.

**CLI-21**: Add `session` subcommand group [Effort: M]
- `hedera-multisig session status --connect <hmsc:...> [--json]` — show session state, participants, signatures
- `hedera-multisig session inject --connect <hmsc:...> --type <type> [tx flags]` — create and inject a transaction into an active session
- `hedera-multisig session list [--json]` — list active sessions (Redis only)
- Acceptance: A coordinator can check session status and inject transactions from CLI.

**CLI-22**: Standardize JSON output [Effort: S]
- Add JSON output to: `sign`, `keys create`, `keys test`, `audit`.
- Standardize envelope: `{ success, version, timestamp, command, duration, exitCode, data, errors }`.
- Acceptance: Every CLI command supports `--json` and produces a consistent envelope.

**Phase 2 total: ~12 tasks. Estimated effort: 8-12 days.**

---

## PHASE 3: Agent Signing SDK → v2.0.0

**Goal**: Programmatic signing interface for automated agents.
**Prerequisite**: Phase 1b (KEY-01/02 sign method, CLIENT-01 reconnection, ERR-01 typed errors).

**AGENT-01**: Create `AgentSigningClient` [Effort: L]
- New file: `client/AgentSigningClient.js`
- Extends the protocol layer (connection, auth, message handling) from `SigningClient`.
- Constructor accepts `approvalPolicy: async (txDetails, metadata) => { approved: boolean, reason?: string }`.
- No readline, no console prompts. All communication via events and structured data.
- Auto-reconnection built in (from CLIENT-01).
- Acceptance: An agent client connects, receives a transaction, evaluates the policy, and signs or rejects — all without human intervention.

**AGENT-02**: Create `PolicyEngine` [Effort: M]
- New file: `client/PolicyEngine.js`
- Interface: `evaluate(txDetails, metadata) => { approved: boolean, reason: string }`
- Built-in rules: `MaxAmountRule(hbar)`, `AllowedRecipientsRule([accountIds])`, `AllowedTransactionTypesRule([types])`, `TimeWindowRule(startHour, endHour, timezone)`, `RateLimitRule(maxPerHour)`
- Rules compose with AND logic (all must pass). Custom rules implement the same interface.
- Acceptance: A policy with `MaxAmountRule(100)` rejects a 150 HBAR transfer and approves a 50 HBAR transfer. Rejection includes the rule name and reason.

**AGENT-03**: Create policy presets [Effort: S]
- `TreasuryAgent` — amount limits, approved recipients, allowed types (transfers only)
- `ApprovalBot` — type restrictions, time windows
- Acceptance: Presets are documented and usable out of the box.

**AGENT-04**: Agent role in protocol [Effort: S]
- Add `role: 'agent'` to AUTH message. Server tracks agents separately from human participants.
- Agents are not counted in `participantsExpected` (they are backup/automated signers).
- Acceptance: An agent connecting with `role: 'agent'` appears in session stats as an agent, not a participant.

**AGENT-05**: Agent authentication [Effort: M]
- Add `apiKey` authentication alongside PIN for agents.
- API keys are generated at session creation time (optional, separate from coordinator token and participant PIN).
- Acceptance: An agent authenticates with an API key. A human participant still uses the PIN.

**AGENT-06**: Document agent integration [Effort: S]
- Create `docs/AGENT_INTEGRATION.md`.
- SDK usage, policy examples, deployment patterns, security considerations.
- Acceptance: A developer can set up an automated signing agent by following the guide.

**Phase 3 total: 6 tasks. Estimated effort: 5-8 days.**

---

## PHASE 4: Scheduled Transactions → v2.1.0

**Goal**: Async signing via Hedera ScheduleCreate/ScheduleSign.
**Prerequisite**: Phase 1a (DECODE-02 schedule decoders), Phase 3 (agent SDK benefits from scheduled TX).

**SCHED-01**: Create `ScheduledWorkflow` [Effort: L]
- New file: `workflows/ScheduledWorkflow.js`
- Flow: Create inner TX → wrap in `ScheduleCreateTransaction` → submit → get scheduleId → share with signers → each signer submits `ScheduleSignTransaction` independently → monitor via mirror node.
- No WebSocket coordination required (each signer acts independently).
- Acceptance: A 2-of-3 scheduled transfer executes after 2 signers submit `ScheduleSignTransaction`.

**SCHED-02**: Scheduled session mode [Effort: L]
- Update `SigningSessionManager` to support `mode: 'scheduled'`.
- Tracks `scheduleId` instead of frozen transaction bytes.
- No 120-second constraint. Session can remain open for days.
- Acceptance: A session in scheduled mode does not expire after 120 seconds.

**SCHED-03**: Mirror node schedule status helper [Effort: M]
- Extend `shared/mirror-node-client.js` (from DECODE-03) with schedule queries.
- Query schedule status, collected signatures, remaining needed, execution status.
- Acceptance: `getScheduleInfo(scheduleId)` returns current signature count and execution status.

**SCHED-04**: `schedule` CLI subcommand [Effort: M]
- `hedera-multisig schedule create --inner-tx <base64> [--payer <id>] [--expiration <datetime>] [--json]`
- `hedera-multisig schedule sign --schedule-id <id> --key-file <path> [--json]`
- `hedera-multisig schedule status --schedule-id <id> [--json]`
- Acceptance: Full scheduled signing flow works from CLI.

**SCHED-05**: dApp UI for scheduled transactions [Effort: L]
- New page or section in session view.
- Shows: schedule ID, inner transaction details, signers who have signed, remaining needed, expiration.
- No countdown timer (or a much longer one showing days).
- Acceptance: A signer can view schedule status and sign a scheduled transaction from the dApp.

**Phase 4 total: 5 tasks. Estimated effort: 8-12 days.**

---

## PHASE 5: Coordinator Panel & Product Polish → v2.2.0

**Goal**: Transform from developer tool to end-user product.
**Prerequisite**: All prior phases.

**COORD-01**: Transaction builder UI — transfers [Effort: L]
- dApp form for: HBAR transfer, token transfer, NFT transfer.
- Select account, recipient, amount. Shows estimated fees.
- Creates, freezes, and injects the transaction into the session.
- Acceptance: A non-developer can create a transfer transaction from the browser.

**COORD-02**: Transaction builder UI — token operations [Effort: M]
- Forms for: token association, dissociation.
- Acceptance: Token association works end-to-end from the dApp.

**COORD-03**: Transaction builder UI — smart contracts [Effort: L]
- Upload ABI file, select function, fill in parameters.
- Shows decoded calldata for verification before submission.
- Acceptance: A ContractExecuteTransaction can be built and signed from the dApp.

**COORD-04**: Session creation from dApp [Effort: L]
- Currently sessions can only be created via CLI server command.
- Build a "Create Session" page: set threshold, add expected public keys, start session.
- Requires the dApp to either embed a WebSocket server (unlikely) or connect to a hosted server.
- Decision needed: hosted coordinator service vs. "bring your own server" with server URL input.
- Acceptance: A user can create a signing session from the browser.

**COORD-05**: Mirror node integration [Effort: M]
- Show account balances, token holdings in the dApp before creating transactions.
- Acceptance: Account balances display on the transaction builder page.

**COORD-06**: Transaction history [Effort: M]
- Local-only log viewer (consistent with decentralized architecture).
- Shows past signed transactions with HashScan links.
- Export as CSV for audit compliance.
- Acceptance: A user can see their last 50 signed transactions and export them.

**COORD-07**: Landing page and documentation [Effort: M]
- Replace dApp home page (`/`) with product explanation.
- Create role-based docs: "For Treasury Managers", "For Developers", "For Security Teams".
- Create video walkthrough of a 2-of-3 signing session.
- Acceptance: A non-developer visiting the site understands what the product does and how to start.

**Phase 5 total: 7 tasks. Estimated effort: 12-20 days.**

---

## EXPLICITLY DEFERRED

These items were flagged by agents but are deliberately deferred with reasoning:

| Item | Reason for Deferral |
|------|---------------------|
| **Message acknowledgment protocol** (Architect P1) | Significant protocol complexity. Current fire-and-forget works for the signing window. Revisit if lost signatures become a reported issue. |
| **Webhook endpoint for agent events** (Product) | Adding an HTTP server alongside WebSocket changes the architecture significantly. Agents can use WebSocket with auto-reconnect instead. Revisit in Phase 3 if needed. |
| **Protocol versioning** (Architect P2) | Add when we actually make a breaking protocol change. Until then, it's YAGNI. |
| **Unified configuration system** (Refactorer P2) | Current env vars + CLI args work. Config files add complexity. Revisit when users request it. |
| **`query` CLI subcommand** (CLI-Master P2) | Users can query via HashScan or mirror node directly. Not core to multi-sig. |
| **`--plain` output mode** (CLI-Master P2) | `--json` + `jq` covers this use case. |
| **KeyProvider vs KeyValidator ownership boundary** (Debt-Hunter) | Low impact. Address opportunistically when touching those files. |
| **Tunnel health monitoring** (Architect P2) | Ngrok/localtunnel are development tools. Production deployments use direct connections. |
| **readlineSync → async readline migration** (Refactorer P2) | Partially addressed by CLI-12 (non-interactive sign) and AGENT-01 (agent client). Full migration is large and low-value for remaining interactive CLI flows. |
| **Transaction type registry pattern** (Refactorer P1) | The current instanceof chain in the decoder works fine and is readable. The registry pattern adds abstraction overhead for marginal benefit. The real win is DECODE-02 (adding more types to the existing pattern). |
| **CJS → ESM migration** | Not warranted. See Refactorer assessment. |
| **One-click deploy button** | Nice-to-have but doesn't advance the three use cases. Add when adoption demands it. |
| **Transaction templates** | Useful but not blocking. Add after coordinator panel exists. |
| **Hybrid air-gap bridge** | Blocked by Phase 4 (scheduled transactions). |
| **Multi-language SDK** | Large effort, low near-term value. |

---

## RISK REGISTER

| Risk | Impact | Mitigation |
|------|--------|------------|
| BUG-04 (async store rewrite) is large and touches many files | Merge conflicts, regression risk | Do BUG-04 last in Phase 0. Run full test suite before and after. |
| SEC-05 (coordinator auth) is a breaking protocol change | Existing scripts/workflows break | Add migration period: accept both old (role-only) and new (role + token) for one version. Remove old path in next major. |
| Phase 1a DECODE-02 (13 new decoders) is tedious | Scope creep, burnout | Implement the 5 most common types first (TokenCreate, TokenMint, TokenBurn, Allowance, ScheduleCreate). Add the rest as needed. |
| Phase 5 COORD-04 (session creation from dApp) requires architecture decision | Blocks the coordinator panel | Decide early: hosted server vs. BYOS. Document decision in ROADMAP.md. |
| Test coverage thresholds may be too aggressive initially | CI failures slow development | Start with 40% line coverage. Increase incrementally. |

---

## TOTAL EFFORT ESTIMATE

| Phase | Tasks | Estimated Days |
|-------|-------|---------------|
| Phase 0 | 17 + 8 trivial | 3-5 |
| Phase 1a | 10 | 5-8 |
| Phase 1b | 20 | 8-12 |
| Phase 2 | 12 | 8-12 |
| Phase 3 | 6 | 5-8 |
| Phase 4 | 5 | 8-12 |
| Phase 5 | 7 | 12-20 |
| **Total** | **77 + 8** | **49-77 days** |

---

*Written 2026-03-18. Cross-referenced against all 9 agent reports.*
*This is the definitive execution plan. Update this file as tasks are completed.*
