/**
 * SessionStore
 *
 * In-memory storage for active signing sessions.
 * Handles session lifecycle, expiration, and cleanup.
 */

const crypto = require('crypto');

class SessionStore {
  constructor(options = {}) {
    this.sessions = new Map();
    this.defaultTimeout = options.defaultTimeout || 1800000; // 30 minutes
    this.cleanupInterval = options.cleanupInterval || 60000; // 1 minute

    // Start automatic cleanup
    this._startCleanup();
  }

  /**
   * Create a new session
   *
   * @param {Object} sessionData - Session configuration
   * @returns {Object} Created session
   */
  createSession(sessionData) {
    const sessionId = this._generateSessionId();
    const now = Date.now();

    const session = {
      sessionId,
      pin: sessionData.pin,
      frozenTransaction: sessionData.frozenTransaction || null, // Optional - can be injected later
      txDetails: sessionData.txDetails || null,
      threshold: sessionData.threshold,
      eligiblePublicKeys: sessionData.eligiblePublicKeys || [],
      expectedParticipants: sessionData.expectedParticipants || sessionData.eligiblePublicKeys?.length || 0,

      // Session metadata
      createdAt: now,
      expiresAt: now + (sessionData.timeout || this.defaultTimeout),
      status: sessionData.frozenTransaction ? 'transaction-received' : 'waiting', // waiting, transaction-received, signing, executing, completed, expired, cancelled

      // Participant tracking
      participants: new Map(), // participantId -> participant data
      signatures: new Map(), // publicKey -> signature data

      // Coordinator info
      coordinatorClient: null, // WebSocket connection

      // Statistics
      stats: {
        participantsConnected: 0,
        participantsReady: 0,
        participantsExpected: sessionData.expectedParticipants || sessionData.eligiblePublicKeys?.length || 0,
        signaturesCollected: 0,
        signaturesRequired: sessionData.threshold
      }
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get session by ID
   *
   * @param {string} sessionId - Session identifier
   * @returns {Object|null} Session or null if not found
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check if expired
    if (session.expiresAt < Date.now()) {
      session.status = 'expired';
      return session;
    }

    return session;
  }

  /**
   * Authenticate session with PIN
   *
   * @param {string} sessionId - Session identifier
   * @param {string} pin - PIN code
   * @returns {boolean} True if authenticated
   */
  authenticate(sessionId, pin) {
    const session = this.getSession(sessionId);

    if (!session) {
      return false;
    }

    // Allow authentication for waiting, transaction-received, and signing states
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
  updateStatus(sessionId, status) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
    }
  }

  /**
   * Add participant to session
   *
   * @param {string} sessionId - Session identifier
   * @param {Object} participant - Participant data
   * @returns {string} Participant ID
   */
  addParticipant(sessionId, participant) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const participantId = this._generateParticipantId();

    const participantData = {
      participantId,
      connectedAt: Date.now(),
      status: 'connected', // connected, ready, reviewing, signing, signed, rejected, disconnected
      keysLoaded: false, // Track if keys are loaded in memory
      publicKey: null, // Will be known after signature
      label: participant.label || null,
      websocket: participant.websocket || null
    };

    session.participants.set(participantId, participantData);
    session.stats.participantsConnected++;

    return participantId;
  }

  /**
   * Update participant status
   *
   * @param {string} sessionId - Session identifier
   * @param {string} participantId - Participant identifier
   * @param {string} status - New status
   */
  updateParticipantStatus(sessionId, participantId, status) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const participant = session.participants.get(participantId);
    if (participant) {
      participant.status = status;
      participant.lastUpdate = Date.now();
    }
  }

  /**
   * Add signature to session
   *
   * @param {string} sessionId - Session identifier
   * @param {string} participantId - Participant identifier
   * @param {Object} signature - Signature data
   */
  addSignature(sessionId, participantId, signature) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const participant = session.participants.get(participantId);
    if (!participant) {
      throw new Error('Participant not found');
    }

    // Store signature
    session.signatures.set(signature.publicKey, {
      publicKey: signature.publicKey,
      signature: signature.signature,
      participantId,
      timestamp: Date.now()
    });

    // Update participant
    participant.publicKey = signature.publicKey;
    participant.status = 'signed';

    // Update stats
    session.stats.signaturesCollected = session.signatures.size;
  }

  /**
   * Remove participant from session
   *
   * @param {string} sessionId - Session identifier
   * @param {string} participantId - Participant identifier
   */
  removeParticipant(sessionId, participantId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const participant = session.participants.get(participantId);
    if (participant && participant.status !== 'signed') {
      session.participants.delete(participantId);
      session.stats.participantsConnected--;
    } else if (participant) {
      // Mark as disconnected but keep if signed
      participant.status = 'disconnected';
      participant.websocket = null;
    }
  }

  /**
   * Check if threshold is met
   *
   * @param {string} sessionId - Session identifier
   * @returns {boolean} True if threshold met
   */
  isThresholdMet(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    return session.signatures.size >= session.threshold;
  }

  /**
   * Get all signatures for session
   *
   * @param {string} sessionId - Session identifier
   * @returns {Array} Array of signature objects
   */
  getSignatures(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return [];
    }

    return Array.from(session.signatures.values());
  }

  /**
   * Delete session
   *
   * @param {string} sessionId - Session identifier
   */
  deleteSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  /**
   * Get session statistics
   *
   * @param {string} sessionId - Session identifier
   * @returns {Object|null} Session stats or null
   */
  getStats(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.stats : null;
  }

  /**
   * List all active sessions
   *
   * @returns {Array} Array of session summaries
   */
  listActiveSessions() {
    const active = [];

    for (const [sessionId, session] of this.sessions) {
      if (session.status === 'active') {
        active.push({
          sessionId,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          stats: session.stats
        });
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
  setParticipantReady(sessionId, participantId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const participant = session.participants.get(participantId);
    if (!participant) {
      throw new Error('Participant not found');
    }

    participant.keysLoaded = true;
    participant.status = 'ready';
    participant.readyAt = Date.now();

    session.stats.participantsReady++;
  }

  /**
   * Check if all expected participants are ready
   *
   * @param {string} sessionId - Session identifier
   * @returns {boolean} True if all expected participants are ready
   */
  areAllParticipantsReady(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    return session.stats.participantsReady >= session.stats.participantsExpected;
  }

  /**
   * Get list of ready participants
   *
   * @param {string} sessionId - Session identifier
   * @returns {Array} Array of ready participant IDs
   */
  getReadyParticipants(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return [];
    }

    const readyParticipants = [];
    for (const [participantId, participant] of session.participants) {
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
  injectTransaction(sessionId, frozenTransaction, txDetails) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Can only inject into waiting sessions
    if (session.status !== 'waiting') {
      throw new Error(`Cannot inject transaction - session status is ${session.status}`);
    }

    // Inject transaction
    session.frozenTransaction = frozenTransaction;
    session.txDetails = txDetails;
    session.status = 'transaction-received';
    session.transactionReceivedAt = Date.now();

    return session;
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
  _cleanupExpiredSessions() {
    const now = Date.now();

    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt < now && session.status !== 'completed') {
        session.status = 'expired';

        // Notify coordinator if connected
        if (session.coordinatorClient) {
          try {
            session.coordinatorClient.send(JSON.stringify({
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
        }
      }
    }
  }

  /**
   * Stop cleanup timer
   */
  shutdown() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

module.exports = SessionStore;
