/**
 * RedisSessionStore Field Parity Tests (Phase A8, BACKEND H3)
 *
 * Verifies that Redis-backed sessions persist coordinatorToken, agentApiKey,
 * reconnectionTokens, and mode through the JSON serialization round-trip.
 * Pre-A8, all four were silently dropped on save, regressing Redis-backed
 * deployments to non-functional auth and legacy-mode behavior.
 *
 * Uses an injected in-memory Map-backed Redis stub that performs the same
 * JSON.stringify/parse cycle as a real Redis SETEX/GET.
 */

const { expect } = require('chai');
const RedisSessionStore = require('../server/stores/RedisSessionStore');

class FakeRedis {
  constructor() {
    this.data = new Map();
    this.status = 'ready';
  }
  async setex(key, _ttl, value) {
    this.data.set(key, value);
    return 'OK';
  }
  async get(key) {
    return this.data.get(key) || null;
  }
  async exists(key) {
    return this.data.has(key) ? 1 : 0;
  }
  async del(key) {
    return this.data.delete(key) ? 1 : 0;
  }
  async keys() {
    return [...this.data.keys()];
  }
  on() {}
  quit() {}
  disconnect() {}
}

function attachFakeRedis(store) {
  store.redis = new FakeRedis();
  store.redisConnected = true;
}

describe('RedisSessionStore Field Parity (Phase A8)', function() {
  this.timeout(5000);

  let store;

  beforeEach(function() {
    store = new RedisSessionStore({
      defaultTimeout: 60000,
      cleanupInterval: 60000
    });
    attachFakeRedis(store);
  });

  afterEach(function() {
    if (store && store.cleanupTimerId !== null) {
      const { timerController } = require('../shared/TimerController');
      timerController.clear(store.cleanupTimerId);
    }
  });

  it('persists coordinatorToken across save/load round-trip', async function() {
    const session = await store.createSession({
      pin: 'TESTPIN1',
      threshold: 2,
      eligiblePublicKeys: ['key1', 'key2', 'key3'],
      coordinatorToken: 'coord-token-abc123',
      timeout: 60000
    });

    const loaded = await store.getSession(session.sessionId);
    expect(loaded).to.exist;
    expect(loaded.coordinatorToken).to.equal('coord-token-abc123');
  });

  it('persists agentApiKey across save/load round-trip', async function() {
    const session = await store.createSession({
      pin: 'TESTPIN1',
      threshold: 2,
      eligiblePublicKeys: ['key1', 'key2', 'key3'],
      agentApiKey: 'agent-api-key-xyz',
      timeout: 60000
    });

    const loaded = await store.getSession(session.sessionId);
    expect(loaded.agentApiKey).to.equal('agent-api-key-xyz');
  });

  it('persists mode (scheduled) across save/load round-trip', async function() {
    const session = await store.createSession({
      pin: 'TESTPIN1',
      threshold: 2,
      eligiblePublicKeys: ['key1', 'key2', 'key3'],
      mode: 'scheduled',
      timeout: 60000
    });

    const loaded = await store.getSession(session.sessionId);
    expect(loaded.mode).to.equal('scheduled');
  });

  it('defaults mode to "realtime" when not provided', async function() {
    const session = await store.createSession({
      pin: 'TESTPIN1',
      threshold: 2,
      eligiblePublicKeys: ['key1', 'key2', 'key3'],
      timeout: 60000
    });

    const loaded = await store.getSession(session.sessionId);
    expect(loaded.mode).to.equal('realtime');
  });

  it('persists reconnectionTokens via setReconnectionToken across round-trip', async function() {
    const session = await store.createSession({
      pin: 'TESTPIN1',
      threshold: 2,
      eligiblePublicKeys: ['key1', 'key2', 'key3'],
      timeout: 60000
    });

    const tokenEntry = {
      token: 'reconnection-token-1',
      publicKey: '0xkey1',
      createdAt: Date.now()
    };
    await store.setReconnectionToken(session.sessionId, 'participant-001', tokenEntry);

    const loaded = await store.getSession(session.sessionId);
    expect(loaded.reconnectionTokens).to.be.instanceOf(Map);
    expect(loaded.reconnectionTokens.size).to.equal(1);
    expect(loaded.reconnectionTokens.get('participant-001')).to.deep.equal(tokenEntry);
  });

  it('persists all four fields together (real-world scenario)', async function() {
    const session = await store.createSession({
      pin: 'TESTPIN1',
      threshold: 2,
      eligiblePublicKeys: ['key1', 'key2', 'key3'],
      coordinatorToken: 'coord-token',
      agentApiKey: 'agent-key',
      mode: 'scheduled',
      timeout: 86400000
    });

    await store.setReconnectionToken(session.sessionId, 'p1', {
      token: 'tok-1',
      publicKey: '0xkey1',
      createdAt: Date.now()
    });

    const loaded = await store.getSession(session.sessionId);
    expect(loaded.coordinatorToken).to.equal('coord-token');
    expect(loaded.agentApiKey).to.equal('agent-key');
    expect(loaded.mode).to.equal('scheduled');
    expect(loaded.reconnectionTokens.get('p1').token).to.equal('tok-1');
    expect(loaded.reconnectionTokens.get('p1').publicKey).to.equal('0xkey1');
  });

  it('initializes reconnectionTokens as empty Map for new session', async function() {
    const session = await store.createSession({
      pin: 'TESTPIN1',
      threshold: 2,
      eligiblePublicKeys: ['key1', 'key2', 'key3'],
      timeout: 60000
    });

    const loaded = await store.getSession(session.sessionId);
    expect(loaded.reconnectionTokens).to.be.instanceOf(Map);
    expect(loaded.reconnectionTokens.size).to.equal(0);
  });

  it('handles missing fields with sensible defaults', async function() {
    const session = await store.createSession({
      pin: 'TESTPIN1',
      threshold: 2,
      eligiblePublicKeys: ['key1', 'key2', 'key3'],
      timeout: 60000
    });

    const loaded = await store.getSession(session.sessionId);
    expect(loaded.coordinatorToken).to.be.null;
    expect(loaded.agentApiKey).to.be.null;
    expect(loaded.mode).to.equal('realtime');
  });
});
