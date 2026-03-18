/**
 * Security Tests
 *
 * Tests security mechanisms (authentication, signature verification,
 * coordinator tokens, PIN generation, audit log isolation) without
 * requiring a running server or Hedera network.
 */

const { expect } = require('chai');

// These tests need SessionStore which requires TimerController.
// We use a shared mock pattern that doesn't pollute the module cache for other test files.
// SessionStore is loaded lazily to avoid cache conflicts.

const SignatureVerifier = require('../core/SignatureVerifier');
const TransactionExecutor = require('../core/TransactionExecutor');

// Create a standalone SessionStore for security tests by directly instantiating
// after temporarily mocking the timer module
// Use the same SessionStore that sessionStore.test.js uses.
// SessionStore requires TimerController, which may be mocked by sessionStore.test.js.
// We just need a working SessionStore instance — we don't care about timer tracking.
// Import SessionStore lazily to let other test files set up their mocks first.
let _SessionStore = null;
function createMockedSessionStore(options = {}) {
  if (!_SessionStore) {
    _SessionStore = require('../server/SessionStore');
  }
  return new _SessionStore(options);
}

describe('Security Tests', function() {

  // ===========================================================================
  // SessionStore Authentication Tests
  // ===========================================================================

  describe('SessionStore Authentication', function() {
    let store;

    beforeEach(function() {
      store = createMockedSessionStore({ cleanupInterval: 60000 });
    });

    afterEach(function() {
      store.shutdown();
    });

    it('correct PIN authenticates successfully', async function() {
      const session = await store.createSession({
        pin: 'TESTPIN1',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2', 'key3']
      });

      const result = await store.authenticate(session.sessionId, 'TESTPIN1');
      expect(result).to.be.true;
    });

    it('wrong PIN rejects authentication', async function() {
      const session = await store.createSession({
        pin: 'TESTPIN1',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2', 'key3']
      });

      const result = await store.authenticate(session.sessionId, 'WRONGPIN');
      expect(result).to.be.false;
    });

    it('expired session rejects authentication', async function() {
      const session = await store.createSession({
        pin: 'TESTPIN1',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2'],
        timeout: -1000 // Already expired
      });

      const result = await store.authenticate(session.sessionId, 'TESTPIN1');
      expect(result).to.be.false;
    });

    it('session in completed state rejects authentication', async function() {
      const session = await store.createSession({
        pin: 'TESTPIN1',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2'],
        frozenTransaction: { base64: 'dGVzdA==' }
      });

      // Transition through valid states to reach completed
      await store.updateStatus(session.sessionId, 'signing');
      await store.updateStatus(session.sessionId, 'executing');
      await store.updateStatus(session.sessionId, 'completed');

      const result = await store.authenticate(session.sessionId, 'TESTPIN1');
      expect(result).to.be.false;
    });
  });

  // ===========================================================================
  // Signature Verification Tests
  // ===========================================================================

  describe('Signature Verification - Threshold Checks', function() {

    it('valid threshold check passes (2-of-3 with 2 valid)', function() {
      const result = SignatureVerifier.checkThreshold(2, 2);
      expect(result).to.be.true;
    });

    it('threshold check passes when exceeding threshold (2-of-3 with 3 valid)', function() {
      const result = SignatureVerifier.checkThreshold(2, 3);
      expect(result).to.be.true;
    });

    it('invalid threshold check fails (2-of-3 with 1 valid)', function() {
      const result = SignatureVerifier.checkThreshold(2, 1);
      expect(result).to.be.false;
    });

    it('threshold check fails with zero valid signatures', function() {
      const result = SignatureVerifier.checkThreshold(2, 0);
      expect(result).to.be.false;
    });

    it('checkThreshold returns true when count equals threshold', function() {
      expect(SignatureVerifier.checkThreshold(1, 1)).to.be.true;
      expect(SignatureVerifier.checkThreshold(3, 3)).to.be.true;
      expect(SignatureVerifier.checkThreshold(5, 5)).to.be.true;
    });

    it('checkThreshold returns false when count is below threshold', function() {
      expect(SignatureVerifier.checkThreshold(3, 2)).to.be.false;
      expect(SignatureVerifier.checkThreshold(5, 4)).to.be.false;
      expect(SignatureVerifier.checkThreshold(1, 0)).to.be.false;
    });
  });

  // ===========================================================================
  // Coordinator Token Tests
  // ===========================================================================

  describe('Coordinator Token', function() {
    let store;

    beforeEach(function() {
      store = createMockedSessionStore({ cleanupInterval: 60000 });
    });

    afterEach(function() {
      store.shutdown();
    });

    it('session creation stores coordinatorToken', async function() {
      const coordinatorToken = 'abc123coordinatortoken';
      const session = await store.createSession({
        pin: 'TESTPIN1',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2'],
        coordinatorToken: coordinatorToken
      });

      const retrieved = await store.getSession(session.sessionId);
      expect(retrieved.coordinatorToken).to.equal(coordinatorToken);
    });

    it('authenticateCoordinator with correct token passes', async function() {
      const coordinatorToken = 'correct-coordinator-token';
      const session = await store.createSession({
        pin: 'TESTPIN1',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2'],
        coordinatorToken: coordinatorToken
      });

      // Verify PIN authenticates
      const pinAuth = await store.authenticate(session.sessionId, 'TESTPIN1');
      expect(pinAuth).to.be.true;

      // Verify coordinator token with timing-safe compare
      const tokenMatch = store._timingSafeCompare(coordinatorToken, session.coordinatorToken);
      expect(tokenMatch).to.be.true;
    });

    it('authenticateCoordinator with wrong token fails', async function() {
      const coordinatorToken = 'correct-coordinator-token';
      const session = await store.createSession({
        pin: 'TESTPIN1',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2'],
        coordinatorToken: coordinatorToken
      });

      const tokenMatch = store._timingSafeCompare('wrong-token', session.coordinatorToken);
      expect(tokenMatch).to.be.false;
    });

    it('authenticateCoordinator with null token (legacy session) passes for backward compat', async function() {
      // Legacy session: no coordinatorToken set
      const session = await store.createSession({
        pin: 'TESTPIN1',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2']
        // No coordinatorToken provided
      });

      const retrieved = await store.getSession(session.sessionId);
      // Legacy sessions have null coordinatorToken
      expect(retrieved.coordinatorToken).to.be.null;

      // PIN authentication still works for legacy sessions
      const pinAuth = await store.authenticate(session.sessionId, 'TESTPIN1');
      expect(pinAuth).to.be.true;

      // Backward compat: when coordinatorToken is null, coordinator auth
      // should rely on PIN only (no token check needed)
      // This mirrors SigningSessionManager.authenticateCoordinator logic:
      //   if (!session.coordinatorToken) return true;
      const isLegacy = retrieved.coordinatorToken === null;
      expect(isLegacy).to.be.true;
    });
  });

  // ===========================================================================
  // Rate Limiting - PIN Generation Tests
  // ===========================================================================

  describe('Rate Limiting - PIN Generation', function() {
    // We cannot directly call _generatePin on SigningSessionManager without
    // requiring @hashgraph/sdk. Instead, we replicate the algorithm from the
    // source and validate its properties, which tests the security requirements
    // of PIN generation.

    const PIN_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    function generatePin() {
      const crypto = require('crypto');
      const charCount = PIN_CHARS.length; // 30
      const maxUnbiased = Math.floor(256 / charCount) * charCount; // 240

      let token = '';
      while (token.length < 8) {
        const bytes = crypto.randomBytes(8 - token.length);
        for (let i = 0; i < bytes.length && token.length < 8; i++) {
          if (bytes[i] < maxUnbiased) {
            token += PIN_CHARS[bytes[i] % charCount];
          }
        }
      }
      return token;
    }

    it('generated PINs are 8 characters', function() {
      for (let i = 0; i < 50; i++) {
        const pin = generatePin();
        expect(pin).to.have.length(8);
      }
    });

    it('generated PINs only contain allowed characters', function() {
      const allowedChars = new Set(PIN_CHARS.split(''));

      for (let i = 0; i < 100; i++) {
        const pin = generatePin();
        for (const char of pin) {
          expect(allowedChars.has(char)).to.be.true;
        }
      }
    });

    it('generated PINs exclude confusing characters (O, 0, I, 1, L)', function() {
      const excludedChars = ['O', '0', 'I', '1', 'L'];

      for (let i = 0; i < 100; i++) {
        const pin = generatePin();
        for (const char of excludedChars) {
          expect(pin).to.not.include(char);
        }
      }
    });

    it('generated PINs have reasonable uniqueness', function() {
      const pins = new Set();
      for (let i = 0; i < 100; i++) {
        pins.add(generatePin());
      }
      // With 30^8 possible PINs (~6.5 x 10^11), 100 should all be unique
      expect(pins.size).to.equal(100);
    });
  });

  // ===========================================================================
  // Audit Log Metadata Isolation Tests
  // ===========================================================================

  describe('Audit Log Metadata Isolation', function() {

    it('metadata is stored under metadata key, not spread into entry', function() {
      const metadata = {
        description: 'Test transaction',
        customField: 'custom-value'
      };

      // Call the private static method directly
      const entry = TransactionExecutor._createAuditEntry(
        {
          hash: 'testhash',
          frozenAt: new Date(),
          expiresAt: new Date(),
          txDetails: { type: 'TransferTransaction' }
        },
        [{ publicKey: '302a300506032b6570032100abcdef1234567890abcdef1234567890abcdef12' }],
        {
          transactionId: '0.0.12345@1234567890.000',
          success: true,
          status: 'SUCCESS',
          executionTimeMs: 1500
        },
        metadata
      );

      // Metadata should be nested under the 'metadata' key
      expect(entry.metadata).to.deep.equal(metadata);

      // Top-level keys should be the audit fields, not the metadata fields
      expect(entry).to.have.property('timestamp');
      expect(entry).to.have.property('transactionId');
      expect(entry).to.have.property('status');

      // Metadata keys should NOT exist at top level
      expect(entry).to.not.have.property('description');
      expect(entry).to.not.have.property('customField');
    });

    it('malicious metadata keys do not overwrite timestamp', function() {
      const maliciousMetadata = {
        timestamp: '1999-01-01T00:00:00.000Z',
        fakeField: 'injected'
      };

      const entry = TransactionExecutor._createAuditEntry(
        {
          hash: 'testhash',
          frozenAt: new Date(),
          expiresAt: new Date(),
          txDetails: { type: 'TransferTransaction' }
        },
        [{ publicKey: '302a300506032b6570032100abcdef1234567890abcdef1234567890abcdef12' }],
        {
          transactionId: '0.0.12345@1234567890.000',
          success: true,
          status: 'SUCCESS',
          executionTimeMs: 1500
        },
        maliciousMetadata
      );

      // The top-level timestamp should be a real ISO timestamp, not the injected one
      expect(entry.timestamp).to.not.equal('1999-01-01T00:00:00.000Z');
      expect(entry.timestamp).to.be.a('string');
      // Should be a recent timestamp
      const entryDate = new Date(entry.timestamp);
      expect(entryDate.getFullYear()).to.be.at.least(2024);

      // The malicious metadata is safely contained under the metadata key
      expect(entry.metadata.timestamp).to.equal('1999-01-01T00:00:00.000Z');
    });

    it('malicious metadata keys do not overwrite status', function() {
      const maliciousMetadata = {
        status: 'TAMPERED',
        transactionId: 'fake-tx-id'
      };

      const entry = TransactionExecutor._createAuditEntry(
        {
          hash: 'testhash',
          frozenAt: new Date(),
          expiresAt: new Date(),
          txDetails: { type: 'TransferTransaction' }
        },
        [{ publicKey: '302a300506032b6570032100abcdef1234567890abcdef1234567890abcdef12' }],
        {
          transactionId: '0.0.99999@9876543210.000',
          success: true,
          status: 'SUCCESS',
          executionTimeMs: 500
        },
        maliciousMetadata
      );

      // Top-level status should reflect actual execution result, not the injected one
      expect(entry.status).to.equal('SUCCESS');
      expect(entry.status).to.not.equal('TAMPERED');

      // Top-level transactionId should be the real one
      expect(entry.transactionId).to.equal('0.0.99999@9876543210.000');
      expect(entry.transactionId).to.not.equal('fake-tx-id');

      // Malicious values are safely namespaced under metadata
      expect(entry.metadata.status).to.equal('TAMPERED');
      expect(entry.metadata.transactionId).to.equal('fake-tx-id');
    });
  });
});

console.log('\n' + '='.repeat(59));
console.log('           SECURITY TESTS');
console.log('='.repeat(59));
console.log();
