/**
 * SessionStore
 *
 * In-memory storage for active signing sessions.
 * Handles session lifecycle, expiration, and cleanup.
 */

const crypto = require('crypto');
const { timerController } = require('../shared/TimerController');
const { timingSafeCompare, generateSessionId, generateParticipantId, sanitizePublicKey } = require('../shared/crypto-utils');
const { isValidTransition, ACTIVE_SESSION_STATES, AUTH_VALID_STATES } = require('../shared/protocol');

class SessionStore {
  constructor(options = {}) {
    this.sessions = new Map();
    this.defaultTimeout = options.defaultTimeout || 1800000; // 30 minutes
    this.cleanupInterval = options.cleanupInterval || 60000; // 1 minute
    this.maxSessions = options.maxSessions || 100; // SEC-13: prevent memory exhaustion
    this.cleanupTimerId = null;

    // Start automatic cleanup
    this._startCleanup();
  }

  /**
   * Create a new session
   *
   * @param {Object} sessionData - Session configuration
   * @returns {Object} Created session
   */
  async createSession(sessionData) {
    // Enforce maximum session count to prevent memory exhaustion (SEC-13)
    if (this.maxSessions && this.sessions.size >= this.maxSessions) {
      throw new Error(`Maximum session limit (${this.maxSessions}) reached. Please wait for existing sessions to expire.`);
    }

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

      // Session metadata.
      //
      // `expiresAt` carries the unbounded sentinel: `null` means "no
      // automatic expiry" (set when the CLI is run with `--timeout 0`).
      // The cleanup loop and `getSession` both skip null-expiry
      // sessions; only an explicit `cancelSession` or process exit
      // will end them. The historical default — 30 minutes — was too
      // short for treasury-team coordination and was the reason the
      // banner displayed an arbitrary timeout that the user kept
      // observing wasn't enforced.
      createdAt: now,
      expiresAt: this._computeExpiresAt(sessionData.timeout, now),
      status: sessionData.frozenTransaction ? 'transaction-received' : 'waiting', // waiting, transaction-received, signing, executing, completed, expired, cancelled

      // Participant tracking
      participants: new Map(), // participantId -> participant data
      signatures: new Map(), // publicKey -> signature data

      // Session mode (realtime or scheduled)
      mode: sessionData.mode || 'realtime',

      // Coordinator info
      coordinatorClient: null, // WebSocket connection
      coordinatorToken: sessionData.coordinatorToken || null, // Separate auth for coordinator role
      agentApiKey: sessionData.agentApiKey || null, // API key for agent authentication

      // Reconnection tokens (participantId -> token)
      reconnectionTokens: new Map(),

      // Statistics
      stats: {
        participantsConnected: 0,
        participantsReady: 0,
        participantsExpected: sessionData.expectedParticipants || sessionData.eligiblePublicKeys?.length || 0,
        signaturesCollected: 0,
        signaturesRequired: sessionData.threshold,
        agentsConnected: 0
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
  async getSession(sessionId) {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check if expired. `expiresAt === null` means the session was
    // created unbounded (`--timeout 0`) and never auto-expires.
    if (session.expiresAt !== null && session.expiresAt < Date.now()) {
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
  async authenticate(sessionId, pin) {
    const session = await this.getSession(sessionId);

    if (!session) {
      return false;
    }

    // Allow authentication for active session states
    const validStates = AUTH_VALID_STATES;
    if (!validStates.includes(session.status)) {
      return false;
    }

    // Use timing-safe comparison to prevent timing attacks
    return this._timingSafeCompare(session.pin, pin);
  }

  /**
   * Update session status
   *
   * @param {string} sessionId - Session identifier
   * @param {string} status - New status
   */
  async updateStatus(sessionId, status) {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Validate state transition (warn but don't block for backward compat)
      if (!isValidTransition(session.status, status)) {
        // Map legacy 'active' status to 'signing' for backward compatibility
        if (status === 'active') {
          status = 'signing';
        } else {
          console.warn(`Warning: Invalid state transition ${session.status} → ${status} for session ${sessionId}`);
        }
      }
      session.status = status;
    }
  }

  /**
   * Persist a reconnection-token entry for a participant.
   * Mirrors the RedisSessionStore method of the same name so callers (notably
   * SigningSessionManager.generateReconnectionToken) are store-agnostic.
   *
   * @param {string} sessionId - Session identifier
   * @param {string} participantId - Participant identifier
   * @param {Object} tokenEntry - { token, publicKey, createdAt }
   */
  async setReconnectionToken(sessionId, participantId, tokenEntry) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (!session.reconnectionTokens) session.reconnectionTokens = new Map();
    session.reconnectionTokens.set(participantId, tokenEntry);
  }

  /**
   * Rejoin an existing participant by public key (identity preservation on reconnect).
   * If a participant with this public key already exists, returns their existing participantId.
   *
   * @param {string} sessionId - Session identifier
   * @param {string} publicKey - Public key to match
   * @returns {string|null} Existing participantId, or null if not found
   */
  async rejoinParticipant(sessionId, publicKey) {
    const session = this.sessions.get(sessionId);
    if (!session || !publicKey) return null;

    for (const [participantId, participant] of session.participants) {
      if (participant.publicKey === publicKey && participant.status === 'disconnected') {
        participant.status = 'connected';
        participant.connectedAt = Date.now();
        return participantId;
      }
    }
    return null;
  }

  /**
   * Add participant to session
   *
   * @param {string} sessionId - Session identifier
   * @param {Object} participant - Participant data
   * @returns {string} Participant ID
   */
  async addParticipant(sessionId, participant) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const participantId = this._generateParticipantId();

    const isAgent = participant.isAgent || false;

    const participantData = {
      participantId,
      connectedAt: Date.now(),
      status: 'connected', // connected, ready, reviewing, signing, signed, rejected, disconnected
      keysLoaded: false, // Track if keys are loaded in memory
      publicKey: null, // Will be known after signature
      label: participant.label || null,
      websocket: participant.websocket || null,
      isAgent // Track agent participants separately from regular participants
    };

    session.participants.set(participantId, participantData);
    session.stats.participantsConnected++;

    // Track agent connections separately in stats
    if (isAgent) {
      session.stats.agentsConnected = (session.stats.agentsConnected || 0) + 1;
    }

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
  async addSignature(sessionId, participantId, signature) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const participant = session.participants.get(participantId);
    if (!participant) {
      throw new Error('Participant not found');
    }

    // Store signature. Canonical shape is `signatures: string[]`
    // (one base64 sig per SignedTransaction body — multi-node freeze).
    // We always persist both: `signatures` (canonical, used by the
    // executor's addSignature(pk, array)) and `signature: string`
    // (legacy single-sig consumers that expect signatures[0]).
    const sigList = Array.isArray(signature.signatures) && signature.signatures.length > 0
      ? signature.signatures
      : (typeof signature.signature === 'string' && signature.signature.length > 0
          ? [signature.signature]
          : null);

    if (!sigList) {
      throw new Error('addSignature: no signature(s) supplied');
    }

    session.signatures.set(signature.publicKey, {
      publicKey: signature.publicKey,
      signatures: sigList,
      signature: sigList[0],
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
   * Clear all per-transaction state from a session — signatures, the
   * collected-count stat, and any participant statuses that are
   * tx-specific ('signed' / 'rejected'). Leaves session-level state
   * (PIN, eligible keys, threshold, reconnection tokens) untouched.
   *
   * Called when the coordinator injects a new transaction on top of a
   * previously-completed (or expired/rejected) one in the same session.
   * Without this, `session.signatures` carries the prior ceremony's
   * entries and the next signing attempt fails with "this public key
   * has already signed".
   *
   * @param {string} sessionId
   * @returns {Promise<Array<{participantId: string, status: string}>>}
   *   List of participants whose status was reset, so the caller can
   *   broadcast `PARTICIPANT_STATUS_UPDATE` to keep dApp / CLI views
   *   in sync. Empty array if nothing changed (or session missing).
   */
  async clearTransactionState(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    if (session.signatures && typeof session.signatures.clear === 'function') {
      session.signatures.clear();
    }
    if (session.stats) {
      session.stats.signaturesCollected = 0;
    }

    // Per-participant: walk the participant Map and reset any status
    // that carried meaning for the previous tx. 'signed' → back to
    // 'ready' (key is still loaded; they just haven't re-signed yet).
    // 'rejected' → also back to 'ready' so they can choose to sign
    // the new tx. 'connected' / 'disconnected' / 'ready' are
    // session-level and stay.
    const changed = [];
    if (session.participants && typeof session.participants.forEach === 'function') {
      for (const [participantId, participant] of session.participants) {
        if (participant.status === 'signed' || participant.status === 'rejected') {
          // Drop the public key recorded when they signed — they may
          // re-sign with a different key for the next ceremony, and
          // the next addSignature will re-bind it.
          participant.publicKey = null;
          const newStatus = participant.keysLoaded ? 'ready' : 'connected';
          participant.status = newStatus;
          changed.push({ participantId, status: newStatus });
        }
      }
    }
    return changed;
  }

  /**
   * Remove participant from session
   *
   * @param {string} sessionId - Session identifier
   * @param {string} participantId - Participant identifier
   */
  async removeParticipant(sessionId, participantId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const participant = session.participants.get(participantId);
    if (!participant) return;

    // Decrement ready count if participant was ready or had been ready before signing
    const wasReady = participant.status === 'ready' || participant.status === 'signed';
    if (wasReady && session.stats.participantsReady > 0) {
      session.stats.participantsReady--;
    }

    // Preserve any participant in a terminal-but-still-meaningful state so
    // their participantId remains valid for reconnection-token re-auth.
    // 'signed' must stay (so the threshold check still counts them); 'rejected'
    // must stay so a participant who declined ONE transaction can come back
    // and sign the NEXT one without the server losing their slot. Anything
    // else (e.g. 'connected', 'ready' that abandoned mid-session) gets
    // pruned to keep the connected count honest.
    const preservedStates = new Set(['signed', 'rejected']);
    if (!preservedStates.has(participant.status)) {
      session.participants.delete(participantId);
      session.stats.participantsConnected--;
    } else {
      participant.previousStatus = participant.status;
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
  async isThresholdMet(sessionId) {
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
  async getSignatures(sessionId) {
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
  async getStats(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.stats : null;
  }

  /**
   * List all active sessions
   *
   * @returns {Array} Array of session summaries
   */
  async listActiveSessions() {
    const active = [];

    const activeStatuses = ACTIVE_SESSION_STATES;
    for (const [sessionId, session] of this.sessions) {
      if (activeStatuses.includes(session.status)) {
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
  async setParticipantReady(sessionId, participantId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const participant = session.participants.get(participantId);
    if (!participant) {
      throw new Error('Participant not found');
    }

    // Guard against double-counting if already ready
    if (participant.status !== 'ready') {
      session.stats.participantsReady++;
    }

    participant.keysLoaded = true;
    participant.status = 'ready';
    participant.readyAt = Date.now();
  }

  /**
   * Check if all expected participants are ready
   *
   * @param {string} sessionId - Session identifier
   * @returns {boolean} True if all expected participants are ready
   */
  async areAllParticipantsReady(sessionId) {
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
  async getReadyParticipants(sessionId) {
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
  async injectTransaction(sessionId, frozenTransaction, txDetails) {
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
   * Resolve `expiresAt` for a new session.
   *
   *   - `timeout === null` → unbounded (returns `null`); cleanup and
   *     the read-side expiry check both skip null-expiry sessions.
   *   - `timeout` set (number, ms) → `now + timeout`.
   *   - `timeout` undefined → fall back to the store's `defaultTimeout`,
   *     which itself may be `null` for unbounded.
   *
   * @private
   */
  _computeExpiresAt(timeout, now) {
    const effective = timeout !== undefined ? timeout : this.defaultTimeout;
    if (effective === null || effective === 0) return null;
    return now + effective;
  }

  /**
   * Timing-safe string comparison (delegates to shared/crypto-utils)
   * @param {string} a - First string
   * @param {string} b - Second string
   * @returns {boolean} True if strings are equal
   */
  _timingSafeCompare(a, b) {
    return timingSafeCompare(a, b);
  }

  /**
   * Generate unique session ID (delegates to shared/crypto-utils)
   * @private
   */
  _generateSessionId() {
    return generateSessionId();
  }

  /**
   * Generate unique participant ID (delegates to shared/crypto-utils)
   * @private
   */
  _generateParticipantId() {
    return generateParticipantId();
  }

  /**
   * Start automatic cleanup of expired sessions
   * @private
   */
  _startCleanup() {
    this.cleanupTimerId = timerController.setInterval(() => {
      this._cleanupExpiredSessions();
    }, this.cleanupInterval, 'session-cleanup');
  }

  /**
   * Clean up expired sessions.
   *
   * Skips sessions with `expiresAt === null` — those are explicitly
   * unbounded (`--timeout 0`) and live until the process exits.
   *
   * For sessions that DO expire, this is also where the messaging
   * promise gets fulfilled: when the cleanup notices a newly-expired
   * session, we broadcast SESSION_EXPIRED to **every** participant
   * (not just the coordinator) and close their sockets. Without this,
   * the "Session Timeout: 30 minutes" banner was a half-truth — the
   * session-store object expired but participant CLIs stayed open
   * indefinitely on TCP heartbeats, and operators saw "users still
   * connected" overnight when the banner had implied otherwise.
   *
   * @private
   */
  _cleanupExpiredSessions() {
    const now = Date.now();

    for (const [sessionId, session] of this.sessions) {
      // Unbounded sessions skip the entire expiry/teardown path.
      if (session.expiresAt === null) continue;

      if (session.expiresAt < now && session.status !== 'completed') {
        const justExpired = session.status !== 'expired';
        session.status = 'expired';

        // First-time expiry: notify coordinator AND every participant,
        // then close their sockets so the visible state matches the
        // banner's claim. Subsequent cleanup ticks (between expiry and
        // the +5-minute deletion below) skip this block — `justExpired`
        // is false the second time around.
        if (justExpired) {
          const expiredMsg = JSON.stringify({
            type: 'SESSION_EXPIRED',
            payload: { sessionId },
          });

          if (session.coordinatorClient) {
            try { session.coordinatorClient.send(expiredMsg); } catch { /* ignore */ }
            try { session.coordinatorClient.close(); } catch { /* ignore */ }
          }

          if (session.participants && typeof session.participants.forEach === 'function') {
            for (const participant of session.participants.values()) {
              const ws = participant && participant.websocket;
              if (!ws) continue;
              try { ws.send(expiredMsg); } catch { /* ignore — socket may already be dead */ }
              try { ws.close(); } catch { /* ignore */ }
            }
          }
        }

        // Delete after 5 minutes (gives reconnecting clients a window
        // to learn the session is gone before its participantId table
        // disappears entirely).
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
    if (this.cleanupTimerId) {
      timerController.clear(this.cleanupTimerId);
      this.cleanupTimerId = null;
    }
  }
}

module.exports = SessionStore;
