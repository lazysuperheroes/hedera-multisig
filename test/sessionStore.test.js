/**
 * SessionStore Unit Tests
 *
 * Tests for session lifecycle, storage, and cleanup.
 */

const { expect } = require('chai');

// Mock TimerController before requiring SessionStore
const mockTimers = {
  timers: new Map(),
  nextId: 1,
  setInterval: function(cb, interval, name) {
    const id = this.nextId++;
    this.timers.set(id, { cb, interval, name, type: 'interval' });
    return id;
  },
  setTimeout: function(cb, delay, name) {
    const id = this.nextId++;
    this.timers.set(id, { cb, delay, name, type: 'timeout' });
    return id;
  },
  clear: function(id) {
    return this.timers.delete(id);
  },
  reset: function() {
    this.timers.clear();
    this.nextId = 1;
  }
};

// Replace the timerController module
require.cache[require.resolve('../shared/TimerController')] = {
  exports: { timerController: mockTimers, TimerController: class {} }
};

const SessionStore = require('../server/SessionStore');

describe('SessionStore', function() {
  let store;

  beforeEach(function() {
    mockTimers.reset();
    store = new SessionStore({ cleanupInterval: 60000 });
  });

  afterEach(function() {
    store.shutdown();
  });

  describe('Session Creation', function() {
    it('creates session with unique ID', function() {
      const session = store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2', 'key3']
      });

      expect(session.sessionId).to.be.a('string');
      expect(session.sessionId).to.have.length(32); // 16 bytes hex
    });

    it('creates session with provided PIN', function() {
      const session = store.createSession({
        pin: 'TESTPIN1',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2']
      });

      expect(session.pin).to.equal('TESTPIN1');
    });

    it('creates session with correct threshold', function() {
      const session = store.createSession({
        pin: 'ABC12345',
        threshold: 3,
        eligiblePublicKeys: ['key1', 'key2', 'key3', 'key4']
      });

      expect(session.threshold).to.equal(3);
      expect(session.stats.signaturesRequired).to.equal(3);
    });

    it('creates pre-session (no transaction) with waiting status', function() {
      const session = store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2']
      });

      expect(session.status).to.equal('waiting');
      expect(session.frozenTransaction).to.be.null;
    });

    it('creates session with transaction in transaction-received status', function() {
      const session = store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2'],
        frozenTransaction: { base64: 'dGVzdA==' }
      });

      expect(session.status).to.equal('transaction-received');
    });

    it('sets correct expiration time', function() {
      const timeout = 300000; // 5 minutes
      const before = Date.now();

      const session = store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1'],
        timeout
      });

      const after = Date.now();
      expect(session.expiresAt).to.be.at.least(before + timeout);
      expect(session.expiresAt).to.be.at.most(after + timeout);
    });
  });

  describe('Session Retrieval', function() {
    it('retrieves existing session', function() {
      const created = store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2']
      });

      const retrieved = store.getSession(created.sessionId);
      expect(retrieved.sessionId).to.equal(created.sessionId);
    });

    it('returns null for non-existent session', function() {
      const session = store.getSession('non-existent-id');
      expect(session).to.be.null;
    });

    it('marks session as expired when past expiration time', function() {
      // Create session with 0 timeout (expires immediately)
      const session = store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1'],
        timeout: -1000 // Already expired
      });

      const retrieved = store.getSession(session.sessionId);
      expect(retrieved.status).to.equal('expired');
    });
  });

  describe('Authentication', function() {
    it('authenticates with correct PIN', function() {
      const session = store.createSession({
        pin: 'CORRECT1',
        threshold: 2,
        eligiblePublicKeys: ['key1']
      });

      const result = store.authenticate(session.sessionId, 'CORRECT1');
      expect(result).to.be.true;
    });

    it('rejects incorrect PIN', function() {
      const session = store.createSession({
        pin: 'CORRECT1',
        threshold: 2,
        eligiblePublicKeys: ['key1']
      });

      const result = store.authenticate(session.sessionId, 'WRONGPIN');
      expect(result).to.be.false;
    });

    it('rejects authentication for non-existent session', function() {
      const result = store.authenticate('bad-id', 'anypin');
      expect(result).to.be.false;
    });
  });

  describe('Participant Management', function() {
    let session;

    beforeEach(function() {
      session = store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2'],
        expectedParticipants: 2
      });
    });

    it('adds participant with unique ID', function() {
      const participantId = store.addParticipant(session.sessionId, {
        label: 'Signer 1'
      });

      expect(participantId).to.be.a('string');
      expect(participantId).to.have.length(16); // 8 bytes hex
    });

    it('increments connected count when participant joins', function() {
      expect(session.stats.participantsConnected).to.equal(0);

      store.addParticipant(session.sessionId, { label: 'Signer 1' });
      expect(session.stats.participantsConnected).to.equal(1);

      store.addParticipant(session.sessionId, { label: 'Signer 2' });
      expect(session.stats.participantsConnected).to.equal(2);
    });

    it('sets participant as ready', function() {
      const participantId = store.addParticipant(session.sessionId, {});

      expect(session.stats.participantsReady).to.equal(0);

      store.setParticipantReady(session.sessionId, participantId);

      expect(session.stats.participantsReady).to.equal(1);
    });

    it('checks if all participants are ready', function() {
      const p1 = store.addParticipant(session.sessionId, {});
      const p2 = store.addParticipant(session.sessionId, {});

      expect(store.areAllParticipantsReady(session.sessionId)).to.be.false;

      store.setParticipantReady(session.sessionId, p1);
      store.setParticipantReady(session.sessionId, p2);

      expect(store.areAllParticipantsReady(session.sessionId)).to.be.true;
    });

    it('removes participant and decrements count', function() {
      const participantId = store.addParticipant(session.sessionId, {});
      expect(session.stats.participantsConnected).to.equal(1);

      store.removeParticipant(session.sessionId, participantId);
      expect(session.stats.participantsConnected).to.equal(0);
    });

    it('updates participant status', function() {
      const participantId = store.addParticipant(session.sessionId, {});
      const participant = session.participants.get(participantId);

      expect(participant.status).to.equal('connected');

      store.updateParticipantStatus(session.sessionId, participantId, 'reviewing');
      expect(participant.status).to.equal('reviewing');
    });
  });

  describe('Signature Management', function() {
    let session;
    let participantId;

    beforeEach(function() {
      session = store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2', 'key3']
      });
      participantId = store.addParticipant(session.sessionId, {});
    });

    it('adds signature to session', function() {
      store.addSignature(session.sessionId, participantId, {
        publicKey: 'key1',
        signature: 'sig1'
      });

      expect(session.signatures.size).to.equal(1);
      expect(session.stats.signaturesCollected).to.equal(1);
    });

    it('detects threshold met', function() {
      store.addSignature(session.sessionId, participantId, {
        publicKey: 'key1',
        signature: 'sig1'
      });

      expect(store.isThresholdMet(session.sessionId)).to.be.false;

      const p2 = store.addParticipant(session.sessionId, {});
      store.addSignature(session.sessionId, p2, {
        publicKey: 'key2',
        signature: 'sig2'
      });

      expect(store.isThresholdMet(session.sessionId)).to.be.true;
    });

    it('retrieves all signatures', function() {
      store.addSignature(session.sessionId, participantId, {
        publicKey: 'key1',
        signature: 'sig1'
      });

      const signatures = store.getSignatures(session.sessionId);
      expect(signatures).to.have.length(1);
      expect(signatures[0].publicKey).to.equal('key1');
    });
  });

  describe('Transaction Injection', function() {
    it('injects transaction into waiting session', function() {
      const session = store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2']
      });

      expect(session.status).to.equal('waiting');

      store.injectTransaction(
        session.sessionId,
        { base64: 'dGVzdA==' },
        { type: 'TransferTransaction' }
      );

      expect(session.status).to.equal('transaction-received');
      expect(session.frozenTransaction.base64).to.equal('dGVzdA==');
      expect(session.txDetails.type).to.equal('TransferTransaction');
    });

    it('throws error when injecting into non-waiting session', function() {
      const session = store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1'],
        frozenTransaction: { base64: 'existing' }
      });

      expect(() => {
        store.injectTransaction(session.sessionId, { base64: 'new' }, {});
      }).to.throw(/Cannot inject transaction/);
    });
  });

  describe('Session Status', function() {
    it('updates session status', function() {
      const session = store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1']
      });

      expect(session.status).to.equal('waiting');

      store.updateStatus(session.sessionId, 'signing');
      expect(session.status).to.equal('signing');

      store.updateStatus(session.sessionId, 'completed');
      expect(session.status).to.equal('completed');
    });
  });

  describe('Session Deletion', function() {
    it('deletes session', function() {
      const session = store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1']
      });

      expect(store.getSession(session.sessionId)).to.not.be.null;

      store.deleteSession(session.sessionId);
      expect(store.getSession(session.sessionId)).to.be.null;
    });
  });

  describe('Cleanup', function() {
    it('starts cleanup timer on construction', function() {
      expect(mockTimers.timers.size).to.be.at.least(1);

      // Find the cleanup timer
      let hasCleanupTimer = false;
      for (const timer of mockTimers.timers.values()) {
        if (timer.name === 'session-cleanup') {
          hasCleanupTimer = true;
          break;
        }
      }
      expect(hasCleanupTimer).to.be.true;
    });

    it('clears timer on shutdown', function() {
      const initialCount = mockTimers.timers.size;
      store.shutdown();
      expect(mockTimers.timers.size).to.be.lessThan(initialCount);
    });
  });
});

console.log('\n╔═══════════════════════════════════════════════════════════╗');
console.log('║           SESSION STORE UNIT TESTS                        ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');
