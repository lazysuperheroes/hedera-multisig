/**
 * SessionStore Unit Tests
 *
 * Tests for session lifecycle, storage, and cleanup.
 */

const { expect } = require('chai');

// Force-load the real TimerController before mocking (bypass any existing mock)
const timerModulePath = require.resolve('../shared/TimerController');
delete require.cache[timerModulePath];
const realTimerModule = { id: timerModulePath, filename: timerModulePath, loaded: true, exports: require(timerModulePath) };

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
  clearAll: function() {
    this.timers.clear();
  },
  clearByPrefix: function(prefix) {
    for (const [id, timer] of this.timers) {
      if (timer.name && timer.name.startsWith(prefix)) {
        this.timers.delete(id);
      }
    }
  },
  getStats: function() {
    let timeouts = 0, intervals = 0;
    for (const timer of this.timers.values()) {
      if (timer.type === 'timeout') timeouts++;
      else intervals++;
    }
    return { timeouts, intervals, total: this.timers.size };
  },
  getActiveTimers: function() {
    return Array.from(this.timers.values());
  },
  reset: function() {
    this.timers.clear();
    this.nextId = 1;
  }
};

// Mock TimerController class that creates instances with the same API
class MockTimerController {
  constructor() {
    this.timers = new Map();
    this.nextId = 1;
  }
  setTimeout(cb, delay, name) { const id = this.nextId++; this.timers.set(id, { cb, delay, name, type: 'timeout' }); return id; }
  setInterval(cb, interval, name) { const id = this.nextId++; this.timers.set(id, { cb, interval, name, type: 'interval' }); return id; }
  clear(id) { return this.timers.delete(id); }
  clearAll() { this.timers.clear(); }
  clearByPrefix(prefix) { for (const [id, t] of this.timers) { if (t.name?.startsWith(prefix)) this.timers.delete(id); } }
  getStats() { let to = 0, iv = 0; for (const t of this.timers.values()) { if (t.type === 'timeout') to++; else iv++; } return { timeouts: to, intervals: iv, total: this.timers.size }; }
  getActiveTimers() { return Array.from(this.timers.values()); }
  reset() { this.timers.clear(); this.nextId = 1; }
}

// Replace the timerController module
require.cache[timerModulePath] = {
  id: timerModulePath,
  filename: timerModulePath,
  loaded: true,
  exports: { timerController: mockTimers, TimerController: MockTimerController }
};

const SessionStore = require('../server/SessionStore');

describe('SessionStore', function() {
  let store;

  // Restore real TimerController module after all tests so other test files aren't affected
  after(function() {
    if (realTimerModule) {
      require.cache[timerModulePath] = realTimerModule;
    } else {
      delete require.cache[timerModulePath];
    }
  });

  beforeEach(function() {
    mockTimers.reset();
    store = new SessionStore({ cleanupInterval: 60000 });
  });

  afterEach(function() {
    store.shutdown();
  });

  describe('Session Creation', function() {
    it('creates session with unique ID', async function() {
      const session = await store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2', 'key3']
      });

      expect(session.sessionId).to.be.a('string');
      expect(session.sessionId).to.have.length(32); // 16 bytes hex
    });

    it('creates session with provided PIN', async function() {
      const session = await store.createSession({
        pin: 'TESTPIN1',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2']
      });

      expect(session.pin).to.equal('TESTPIN1');
    });

    it('creates session with correct threshold', async function() {
      const session = await store.createSession({
        pin: 'ABC12345',
        threshold: 3,
        eligiblePublicKeys: ['key1', 'key2', 'key3', 'key4']
      });

      expect(session.threshold).to.equal(3);
      expect(session.stats.signaturesRequired).to.equal(3);
    });

    it('creates pre-session (no transaction) with waiting status', async function() {
      const session = await store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2']
      });

      expect(session.status).to.equal('waiting');
      expect(session.frozenTransaction).to.be.null;
    });

    it('creates session with transaction in transaction-received status', async function() {
      const session = await store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2'],
        frozenTransaction: { base64: 'dGVzdA==' }
      });

      expect(session.status).to.equal('transaction-received');
    });

    it('sets correct expiration time', async function() {
      const timeout = 300000; // 5 minutes
      const before = Date.now();

      const session = await store.createSession({
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
    it('retrieves existing session', async function() {
      const created = await store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2']
      });

      const retrieved = await store.getSession(created.sessionId);
      expect(retrieved.sessionId).to.equal(created.sessionId);
    });

    it('returns null for non-existent session', async function() {
      const session = await store.getSession('non-existent-id');
      expect(session).to.be.null;
    });

    it('marks session as expired when past expiration time', async function() {
      // Create session with 0 timeout (expires immediately)
      const session = await store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1'],
        timeout: -1000 // Already expired
      });

      const retrieved = await store.getSession(session.sessionId);
      expect(retrieved.status).to.equal('expired');
    });
  });

  describe('Authentication', function() {
    it('authenticates with correct PIN', async function() {
      const session = await store.createSession({
        pin: 'CORRECT1',
        threshold: 2,
        eligiblePublicKeys: ['key1']
      });

      const result = await store.authenticate(session.sessionId, 'CORRECT1');
      expect(result).to.be.true;
    });

    it('rejects incorrect PIN', async function() {
      const session = await store.createSession({
        pin: 'CORRECT1',
        threshold: 2,
        eligiblePublicKeys: ['key1']
      });

      const result = await store.authenticate(session.sessionId, 'WRONGPIN');
      expect(result).to.be.false;
    });

    it('rejects authentication for non-existent session', async function() {
      const result = await store.authenticate('bad-id', 'anypin');
      expect(result).to.be.false;
    });
  });

  describe('Participant Management', function() {
    let session;

    beforeEach(async function() {
      session = await store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2'],
        expectedParticipants: 2
      });
    });

    it('adds participant with unique ID', async function() {
      const participantId = await store.addParticipant(session.sessionId, {
        label: 'Signer 1'
      });

      expect(participantId).to.be.a('string');
      expect(participantId).to.have.length(16); // 8 bytes hex
    });

    it('increments connected count when participant joins', async function() {
      expect(session.stats.participantsConnected).to.equal(0);

      await store.addParticipant(session.sessionId, { label: 'Signer 1' });
      expect(session.stats.participantsConnected).to.equal(1);

      await store.addParticipant(session.sessionId, { label: 'Signer 2' });
      expect(session.stats.participantsConnected).to.equal(2);
    });

    it('sets participant as ready', async function() {
      const participantId = await store.addParticipant(session.sessionId, {});

      expect(session.stats.participantsReady).to.equal(0);

      await store.setParticipantReady(session.sessionId, participantId);

      expect(session.stats.participantsReady).to.equal(1);
    });

    it('checks if all participants are ready', async function() {
      const p1 = await store.addParticipant(session.sessionId, {});
      const p2 = await store.addParticipant(session.sessionId, {});

      expect(await store.areAllParticipantsReady(session.sessionId)).to.be.false;

      await store.setParticipantReady(session.sessionId, p1);
      await store.setParticipantReady(session.sessionId, p2);

      expect(await store.areAllParticipantsReady(session.sessionId)).to.be.true;
    });

    it('removes participant and decrements count', async function() {
      const participantId = await store.addParticipant(session.sessionId, {});
      expect(session.stats.participantsConnected).to.equal(1);

      await store.removeParticipant(session.sessionId, participantId);
      expect(session.stats.participantsConnected).to.equal(0);
    });

    it('updates participant status', async function() {
      const participantId = await store.addParticipant(session.sessionId, {});
      const participant = session.participants.get(participantId);

      expect(participant.status).to.equal('connected');

      await store.updateParticipantStatus(session.sessionId, participantId, 'reviewing');
      expect(participant.status).to.equal('reviewing');
    });
  });

  describe('Signature Management', function() {
    let session;
    let participantId;

    beforeEach(async function() {
      session = await store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2', 'key3']
      });
      participantId = await store.addParticipant(session.sessionId, {});
    });

    it('adds signature to session', async function() {
      await store.addSignature(session.sessionId, participantId, {
        publicKey: 'key1',
        signature: 'sig1'
      });

      expect(session.signatures.size).to.equal(1);
      expect(session.stats.signaturesCollected).to.equal(1);
    });

    it('detects threshold met', async function() {
      await store.addSignature(session.sessionId, participantId, {
        publicKey: 'key1',
        signature: 'sig1'
      });

      expect(await store.isThresholdMet(session.sessionId)).to.be.false;

      const p2 = await store.addParticipant(session.sessionId, {});
      await store.addSignature(session.sessionId, p2, {
        publicKey: 'key2',
        signature: 'sig2'
      });

      expect(await store.isThresholdMet(session.sessionId)).to.be.true;
    });

    it('retrieves all signatures', async function() {
      await store.addSignature(session.sessionId, participantId, {
        publicKey: 'key1',
        signature: 'sig1'
      });

      const signatures = await store.getSignatures(session.sessionId);
      expect(signatures).to.have.length(1);
      expect(signatures[0].publicKey).to.equal('key1');
    });
  });

  describe('Transaction Injection', function() {
    it('injects transaction into waiting session', async function() {
      const session = await store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1', 'key2']
      });

      expect(session.status).to.equal('waiting');

      await store.injectTransaction(
        session.sessionId,
        { base64: 'dGVzdA==' },
        { type: 'TransferTransaction' }
      );

      expect(session.status).to.equal('transaction-received');
      expect(session.frozenTransaction.base64).to.equal('dGVzdA==');
      expect(session.txDetails.type).to.equal('TransferTransaction');
    });

    it('throws error when injecting into non-waiting session', async function() {
      const session = await store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1'],
        frozenTransaction: { base64: 'existing' }
      });

      try {
        await store.injectTransaction(session.sessionId, { base64: 'new' }, {});
        expect.fail('Expected injectTransaction to throw');
      } catch (err) {
        expect(err.message).to.match(/Cannot inject transaction/);
      }
    });
  });

  describe('Session Status', function() {
    it('updates session status', async function() {
      const session = await store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1']
      });

      expect(session.status).to.equal('waiting');

      await store.updateStatus(session.sessionId, 'signing');
      expect(session.status).to.equal('signing');

      await store.updateStatus(session.sessionId, 'completed');
      expect(session.status).to.equal('completed');
    });
  });

  describe('Session Deletion', function() {
    it('deletes session', async function() {
      const session = await store.createSession({
        pin: 'ABC12345',
        threshold: 2,
        eligiblePublicKeys: ['key1']
      });

      expect(await store.getSession(session.sessionId)).to.not.be.null;

      store.deleteSession(session.sessionId);
      expect(await store.getSession(session.sessionId)).to.be.null;
    });
  });

  describe('Cleanup', function() {
    it('starts cleanup timer on construction', function() {
      // Create a fresh store and verify it registered a cleanup timer
      mockTimers.reset();
      const freshStore = new SessionStore({ cleanupInterval: 60000 });
      expect(mockTimers.timers.size).to.be.at.least(1);

      let hasCleanupTimer = false;
      for (const timer of mockTimers.timers.values()) {
        if (timer.name === 'session-cleanup') {
          hasCleanupTimer = true;
          break;
        }
      }
      expect(hasCleanupTimer).to.be.true;
      freshStore.shutdown();
    });

    it('clears timer on shutdown', function() {
      mockTimers.reset();
      const freshStore = new SessionStore({ cleanupInterval: 60000 });
      const initialCount = mockTimers.timers.size;
      expect(initialCount).to.be.at.least(1);
      freshStore.shutdown();
      expect(mockTimers.timers.size).to.be.lessThan(initialCount);
    });
  });
});

console.log('\n╔═══════════════════════════════════════════════════════════╗');
console.log('║           SESSION STORE UNIT TESTS                        ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');
