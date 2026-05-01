/**
 * Reconnection Token Eligibility Tests (Phase A6, CRITICAL #3)
 *
 * Verifies that reconnection tokens bound to a public key re-validate
 * eligibility on use. Pre-fix, a stale token holder could rejoin a session
 * after the coordinator narrowed the eligible-keys set.
 */

const { expect } = require('chai');
const SigningSessionManager = require('../server/SigningSessionManager');

describe('Reconnection Token Eligibility (Phase A6)', function() {
  this.timeout(5000);

  let sessionManager;

  beforeEach(function() {
    sessionManager = new SigningSessionManager(null, {
      defaultTimeout: 60000,
      verbose: false
    });
  });

  afterEach(function() {
    if (sessionManager) sessionManager.shutdown();
  });

  async function createTestSession(eligibleKeys = ['key1', 'key2', 'key3']) {
    return sessionManager.createSession(null, {
      threshold: 2,
      eligiblePublicKeys: eligibleKeys,
      expectedParticipants: 3,
      timeout: 60000,
      pin: 'TESTPIN1'
    });
  }

  it('reconnection token bound to a still-eligible key allows reconnect', async function() {
    const session = await createTestSession();
    const { participantId } = await sessionManager.addParticipant(session.sessionId, { label: 'p1' });
    const token = await sessionManager.generateReconnectionToken(session.sessionId, participantId, 'key1');

    const result = await sessionManager.authenticateWithReconnectionToken(session.sessionId, token);
    expect(result.valid).to.be.true;
    expect(result.participantId).to.equal(participantId);
    expect(result.publicKey).to.equal('0xkey1');
  });

  it('rejects reconnection when the bound key was removed from the eligible set', async function() {
    const session = await createTestSession();
    const { participantId } = await sessionManager.addParticipant(session.sessionId, { label: 'p1' });
    const token = await sessionManager.generateReconnectionToken(session.sessionId, participantId, 'key1');

    // Simulate coordinator narrowing the eligible set after token issuance
    const storedSession = await sessionManager.store.getSession(session.sessionId);
    storedSession.eligiblePublicKeys = ['0xkey2', '0xkey3'];

    const result = await sessionManager.authenticateWithReconnectionToken(session.sessionId, token);
    expect(result.valid).to.be.false;
    expect(result.reason).to.equal('KEY_NO_LONGER_ELIGIBLE');
  });

  it('reconnection token without a bound key (PIN-only AUTH) still works', async function() {
    // PIN-only sessions never had eligibility binding; reconnection preserves that.
    // This documents intentional behavior — the fix does not retroactively
    // require public-key binding for participants who never supplied one.
    const session = await createTestSession();
    const { participantId } = await sessionManager.addParticipant(session.sessionId, { label: 'p1' });
    const token = await sessionManager.generateReconnectionToken(session.sessionId, participantId, null);

    const result = await sessionManager.authenticateWithReconnectionToken(session.sessionId, token);
    expect(result.valid).to.be.true;
    expect(result.publicKey).to.be.null;
  });

  it('rejects an unknown reconnection token', async function() {
    const session = await createTestSession();
    await sessionManager.addParticipant(session.sessionId, { label: 'p1' });

    const result = await sessionManager.authenticateWithReconnectionToken(
      session.sessionId,
      'nonexistent-token'
    );
    expect(result.valid).to.be.false;
  });

  it('tolerates legacy string-shaped reconnection tokens (backward compat during upgrade)', async function() {
    // Pre-A6 sessions stored tokens as plain strings. If a process is upgraded
    // mid-flight (rare — but Redis-persisted sessions could carry forward),
    // string tokens should still authenticate without throwing.
    const session = await createTestSession();
    const { participantId } = await sessionManager.addParticipant(session.sessionId, { label: 'p1' });

    const storedSession = await sessionManager.store.getSession(session.sessionId);
    storedSession.reconnectionTokens.set(participantId, 'legacy-string-token');

    const result = await sessionManager.authenticateWithReconnectionToken(
      session.sessionId,
      'legacy-string-token'
    );
    expect(result.valid).to.be.true;
    expect(result.participantId).to.equal(participantId);
    expect(result.publicKey).to.be.null;
  });
});
