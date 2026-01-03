/**
 * RedisSessionStore
 *
 * Redis-backed storage for active signing sessions.
 * Provides persistence across server restarts and horizontal scaling.
 *
 * Falls back to in-memory storage if Redis is unavailable.
 */

const crypto = require('crypto');
const { createLogger } = require('../../shared/logger');

class RedisSessionStore {
  constructor(options = {}) {
    this.log = createLogger('RedisSessionStore');
    this.defaultTimeout = options.defaultTimeout || 1800000; // 30 minutes
    this.cleanupInterval = options.cleanupInterval || 60000; // 1 minute
    this.keyPrefix = options.keyPrefix || 'multisig:session:';

    // Redis client (lazy initialized)
    this.redis = null;
    this.redisConnected = false;

    // In-memory fallback
    this.sessions = new Map();

    // WebSocket connections must be stored in memory (can't serialize)
    this.websockets = new Map(); // participantId -> ws
    this.coordinatorWebsockets = new Map(); // sessionId -> ws

    // Redis configuration
    this.redisConfig = {
      host: options.redisHost || process.env.REDIS_HOST || 'localhost',
      port: options.redisPort || process.env.REDIS_PORT || 6379,
      password: options.redisPassword || process.env.REDIS_PASSWORD || undefined,
      db: options.redisDb || 0,
      keyPrefix: this.keyPrefix,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true
    };

    // Start cleanup timer
    this._startCleanup();
  }

  /**
   * Initialize Redis connection
   *
   * @returns {Promise<boolean>} True if connected
   */
  async connect() {
    try {
      // Dynamically import ioredis (optional dependency)
      const Redis = require('ioredis');

      this.redis = new Redis({
        ...this.redisConfig,
        lazyConnect: true
      });

      // Set up event handlers
      this.redis.on('connect', () => {
        this.log.info('Redis connected', { host: this.redisConfig.host, port: this.redisConfig.port });
        this.redisConnected = true;
      });

      this.redis.on('error', (err) => {
        this.log.warn('Redis error, using in-memory fallback', { error: err.message });
        this.redisConnected = false;
      });

      this.redis.on('close', () => {
        this.log.info('Redis connection closed');
        this.redisConnected = false;
      });

      // Attempt connection
      await this.redis.connect();
      this.redisConnected = true;

      this.log.info('Redis session store initialized');
      return true;

    } catch (error) {
      this.log.warn('Redis unavailable, using in-memory fallback', { error: error.message });
      this.redisConnected = false;
      return false;
    }
  }

  /**
   * Check if using Redis or in-memory fallback
   *
   * @returns {boolean} True if Redis is connected
   */
  isRedisConnected() {
    return this.redisConnected && this.redis?.status === 'ready';
  }

  /**
   * Create a new session
   *
   * @param {Object} sessionData - Session configuration
   * @returns {Promise<Object>} Created session
   */
  async createSession(sessionData) {
    const sessionId = this._generateSessionId();
    const now = Date.now();

    const session = {
      sessionId,
      pin: sessionData.pin,
      frozenTransaction: sessionData.frozenTransaction || null,
      txDetails: sessionData.txDetails || null,
      threshold: sessionData.threshold,
      eligiblePublicKeys: sessionData.eligiblePublicKeys || [],
      expectedParticipants: sessionData.expectedParticipants || sessionData.eligiblePublicKeys?.length || 0,

      // Session metadata
      createdAt: now,
      expiresAt: now + (sessionData.timeout || this.defaultTimeout),
      status: sessionData.frozenTransaction ? 'transaction-received' : 'waiting',

      // Participant tracking (serializable format)
      participants: {}, // participantId -> participant data
      signatures: {}, // publicKey -> signature data

      // Statistics
      stats: {
        participantsConnected: 0,
        participantsReady: 0,
        participantsExpected: sessionData.expectedParticipants || sessionData.eligiblePublicKeys?.length || 0,
        signaturesCollected: 0,
        signaturesRequired: sessionData.threshold
      }
    };

    await this._saveSession(session);
    return this._toExternalFormat(session);
  }

  /**
   * Get session by ID
   *
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object|null>} Session or null if not found
   */
  async getSession(sessionId) {
    const session = await this._loadSession(sessionId);

    if (!session) {
      return null;
    }

    // Check if expired
    if (session.expiresAt < Date.now()) {
      session.status = 'expired';
      await this._saveSession(session);
    }

    return this._toExternalFormat(session);
  }

  /**
   * Authenticate session with PIN
   *
   * @param {string} sessionId - Session identifier
   * @param {string} pin - PIN code
   * @returns {Promise<boolean>} True if authenticated
   */
  async authenticate(sessionId, pin) {
    const session = await this._loadSession(sessionId);

    if (!session) {
      return false;
    }

    const validStates = ['waiting', 'transaction-received', 'signing'];
    if (!validStates.includes(session.status)) {
      return false;
    }

    return session.pin === pin;
  }

  /**
   * Update session status
   *
   * @param {string} sessionId - Session identifier
   * @param {string} status - New status
   */
  async updateStatus(sessionId, status) {
    const session = await this._loadSession(sessionId);
    if (session) {
      session.status = status;
      await this._saveSession(session);
    }
  }

  /**
   * Add participant to session
   *
   * @param {string} sessionId - Session identifier
   * @param {Object} participant - Participant data
   * @returns {Promise<string>} Participant ID
   */
  async addParticipant(sessionId, participant) {
    const session = await this._loadSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const participantId = this._generateParticipantId();

    const participantData = {
      participantId,
      connectedAt: Date.now(),
      status: 'connected',
      keysLoaded: false,
      publicKey: null,
      label: participant.label || null
    };

    session.participants[participantId] = participantData;
    session.stats.participantsConnected++;

    // Store WebSocket in memory
    if (participant.websocket) {
      this.websockets.set(participantId, participant.websocket);
    }

    await this._saveSession(session);
    return participantId;
  }

  /**
   * Update participant status
   *
   * @param {string} sessionId - Session identifier
   * @param {string} participantId - Participant identifier
   * @param {string} status - New status
   */
  async updateParticipantStatus(sessionId, participantId, status) {
    const session = await this._loadSession(sessionId);
    if (!session) {
      return;
    }

    const participant = session.participants[participantId];
    if (participant) {
      participant.status = status;
      participant.lastUpdate = Date.now();
      await this._saveSession(session);
    }
  }

  /**
   * Add signature to session
   *
   * @param {string} sessionId - Session identifier
   * @param {string} participantId - Participant identifier
   * @param {Object} signature - Signature data
   */
  async addSignature(sessionId, participantId, signature) {
    const session = await this._loadSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const participant = session.participants[participantId];
    if (!participant) {
      throw new Error('Participant not found');
    }

    // Store signature
    session.signatures[signature.publicKey] = {
      publicKey: signature.publicKey,
      signature: signature.signature,
      participantId,
      timestamp: Date.now()
    };

    // Update participant
    participant.publicKey = signature.publicKey;
    participant.status = 'signed';

    // Update stats
    session.stats.signaturesCollected = Object.keys(session.signatures).length;

    await this._saveSession(session);
  }

  /**
   * Remove participant from session
   *
   * @param {string} sessionId - Session identifier
   * @param {string} participantId - Participant identifier
   */
  async removeParticipant(sessionId, participantId) {
    const session = await this._loadSession(sessionId);
    if (!session) {
      return;
    }

    const participant = session.participants[participantId];
    if (participant && participant.status !== 'signed') {
      if (participant.status === 'ready' && session.stats.participantsReady > 0) {
        session.stats.participantsReady--;
      }
      delete session.participants[participantId];
      session.stats.participantsConnected--;
    } else if (participant) {
      if (participant.status === 'ready' && session.stats.participantsReady > 0) {
        session.stats.participantsReady--;
      }
      participant.status = 'disconnected';
    }

    // Remove WebSocket from memory
    this.websockets.delete(participantId);

    await this._saveSession(session);
  }

  /**
   * Check if threshold is met
   *
   * @param {string} sessionId - Session identifier
   * @returns {Promise<boolean>} True if threshold met
   */
  async isThresholdMet(sessionId) {
    const session = await this._loadSession(sessionId);
    if (!session) {
      return false;
    }

    return Object.keys(session.signatures).length >= session.threshold;
  }

  /**
   * Get all signatures for session
   *
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Array>} Array of signature objects
   */
  async getSignatures(sessionId) {
    const session = await this._loadSession(sessionId);
    if (!session) {
      return [];
    }

    return Object.values(session.signatures);
  }

  /**
   * Delete session
   *
   * @param {string} sessionId - Session identifier
   */
  async deleteSession(sessionId) {
    if (this.isRedisConnected()) {
      await this.redis.del(sessionId);
    }
    this.sessions.delete(sessionId);

    // Clean up coordinator WebSocket
    this.coordinatorWebsockets.delete(sessionId);
  }

  /**
   * Get session statistics
   *
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object|null>} Session stats or null
   */
  async getStats(sessionId) {
    const session = await this._loadSession(sessionId);
    return session ? session.stats : null;
  }

  /**
   * List all active sessions
   *
   * @returns {Promise<Array>} Array of session summaries
   */
  async listActiveSessions() {
    const active = [];

    if (this.isRedisConnected()) {
      // Get all session keys from Redis
      const keys = await this.redis.keys('*');
      for (const key of keys) {
        const session = await this._loadSession(key.replace(this.keyPrefix, ''));
        if (session && session.status !== 'expired' && session.status !== 'completed') {
          active.push({
            sessionId: session.sessionId,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            stats: session.stats
          });
        }
      }
    } else {
      // In-memory fallback
      for (const [sessionId, session] of this.sessions) {
        if (session.status !== 'expired' && session.status !== 'completed') {
          active.push({
            sessionId,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            stats: session.stats
          });
        }
      }
    }

    return active;
  }

  /**
   * Mark participant as ready (keys loaded)
   *
   * @param {string} sessionId - Session identifier
   * @param {string} participantId - Participant identifier
   */
  async setParticipantReady(sessionId, participantId) {
    const session = await this._loadSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const participant = session.participants[participantId];
    if (!participant) {
      throw new Error('Participant not found');
    }

    participant.keysLoaded = true;
    participant.status = 'ready';
    participant.readyAt = Date.now();

    session.stats.participantsReady++;

    await this._saveSession(session);
  }

  /**
   * Check if all expected participants are ready
   *
   * @param {string} sessionId - Session identifier
   * @returns {Promise<boolean>} True if all expected participants are ready
   */
  async areAllParticipantsReady(sessionId) {
    const session = await this._loadSession(sessionId);
    if (!session) {
      return false;
    }

    return session.stats.participantsReady >= session.stats.participantsExpected;
  }

  /**
   * Get list of ready participants
   *
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Array>} Array of ready participant IDs
   */
  async getReadyParticipants(sessionId) {
    const session = await this._loadSession(sessionId);
    if (!session) {
      return [];
    }

    const readyParticipants = [];
    for (const [participantId, participant] of Object.entries(session.participants)) {
      if (participant.keysLoaded && participant.status === 'ready') {
        readyParticipants.push(participantId);
      }
    }

    return readyParticipants;
  }

  /**
   * Inject transaction into waiting session
   *
   * @param {string} sessionId - Session identifier
   * @param {string} frozenTransaction - Serialized frozen transaction
   * @param {Object} txDetails - Transaction details
   */
  async injectTransaction(sessionId, frozenTransaction, txDetails) {
    const session = await this._loadSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'waiting') {
      throw new Error(`Cannot inject transaction - session status is ${session.status}`);
    }

    session.frozenTransaction = frozenTransaction;
    session.txDetails = txDetails;
    session.status = 'transaction-received';
    session.transactionReceivedAt = Date.now();

    await this._saveSession(session);
    return this._toExternalFormat(session);
  }

  /**
   * Get WebSocket for participant
   *
   * @param {string} participantId - Participant identifier
   * @returns {WebSocket|null} WebSocket connection or null
   */
  getParticipantWebSocket(participantId) {
    return this.websockets.get(participantId) || null;
  }

  /**
   * Set coordinator WebSocket
   *
   * @param {string} sessionId - Session identifier
   * @param {WebSocket} ws - WebSocket connection
   */
  setCoordinatorWebSocket(sessionId, ws) {
    this.coordinatorWebsockets.set(sessionId, ws);
  }

  /**
   * Get coordinator WebSocket
   *
   * @param {string} sessionId - Session identifier
   * @returns {WebSocket|null} WebSocket connection or null
   */
  getCoordinatorWebSocket(sessionId) {
    return this.coordinatorWebsockets.get(sessionId) || null;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Save session to storage
   * @private
   */
  async _saveSession(session) {
    const ttl = Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000) + 300); // +5min buffer

    if (this.isRedisConnected()) {
      try {
        await this.redis.setex(session.sessionId, ttl, JSON.stringify(session));
      } catch (error) {
        this.log.warn('Redis save failed, using in-memory', { error: error.message });
        this.sessions.set(session.sessionId, session);
      }
    } else {
      this.sessions.set(session.sessionId, session);
    }
  }

  /**
   * Load session from storage
   * @private
   */
  async _loadSession(sessionId) {
    if (this.isRedisConnected()) {
      try {
        const data = await this.redis.get(sessionId);
        if (data) {
          return JSON.parse(data);
        }
      } catch (error) {
        this.log.warn('Redis load failed, checking in-memory', { error: error.message });
      }
    }

    return this.sessions.get(sessionId) || null;
  }

  /**
   * Convert internal format to external format (with Maps)
   * @private
   */
  _toExternalFormat(session) {
    if (!session) return null;

    // Convert objects back to Maps for compatibility with existing code
    const external = {
      ...session,
      participants: new Map(Object.entries(session.participants || {})),
      signatures: new Map(Object.entries(session.signatures || {}))
    };

    // Attach WebSockets from memory
    for (const [participantId, participant] of external.participants) {
      participant.websocket = this.websockets.get(participantId) || null;
    }

    external.coordinatorClient = this.coordinatorWebsockets.get(session.sessionId) || null;

    return external;
  }

  /**
   * Generate unique session ID
   * @private
   */
  _generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate unique participant ID
   * @private
   */
  _generateParticipantId() {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Start automatic cleanup of expired sessions
   * @private
   */
  _startCleanup() {
    this.cleanupTimer = setInterval(() => {
      this._cleanupExpiredSessions();
    }, this.cleanupInterval);
  }

  /**
   * Clean up expired sessions
   * @private
   */
  async _cleanupExpiredSessions() {
    const now = Date.now();

    // In-memory cleanup
    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt < now && session.status !== 'completed') {
        session.status = 'expired';

        // Notify coordinator if connected
        const coordinatorWs = this.coordinatorWebsockets.get(sessionId);
        if (coordinatorWs) {
          try {
            coordinatorWs.send(JSON.stringify({
              type: 'SESSION_EXPIRED',
              payload: { sessionId }
            }));
          } catch (error) {
            // Ignore send errors
          }
        }

        // Delete after 5 minutes
        if (session.expiresAt + 300000 < now) {
          this.sessions.delete(sessionId);
          this.coordinatorWebsockets.delete(sessionId);
        }
      }
    }

    // Redis cleanup is handled by TTL
  }

  /**
   * Stop cleanup timer and close Redis connection
   */
  async shutdown() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }

    this.log.info('Redis session store shutdown complete');
  }
}

module.exports = RedisSessionStore;
