/**
 * SigningSessionManager
 *
 * Manages multi-signature signing sessions.
 * Handles session creation, public key extraction, and coordination.
 */

const crypto = require('crypto');
const SessionStore = require('./SessionStore');
const {
  TransactionDecoder: SharedDecoder,
  getTransactionTypeName
} = require('../shared/transaction-decoder');
const SignatureVerifier = require('../core/SignatureVerifier');
const { normalizePublicKey, isKeyEligible } = require('./utils/keyUtils');
const { PublicKey, Transaction } = require('@hashgraph/sdk');
const { createLogger } = require('../shared/logger');

class SigningSessionManager {
  constructor(client, options = {}) {
    this.client = client;
    this.options = {
      defaultTimeout: options.defaultTimeout || 1800000, // 30 minutes
      autoExecute: options.autoExecute || false,
      auditLogPath: options.auditLogPath || null,
      verbose: options.verbose !== false,
      ...options
    };

    // Create logger instance
    this.log = createLogger('SessionManager');

    // Use provided store or create default in-memory store
    this.store = options.store || new SessionStore({
      defaultTimeout: this.options.defaultTimeout
    });

    this.eventHandlers = new Map(); // sessionId -> event handlers
    this._signatureLocks = new Map(); // sessionId -> Promise chain for serializing signature submissions
  }

  /**
   * Create a new signing session
   *
   * @param {Transaction|null} transaction - Hedera transaction (frozen) or null for pre-session
   * @param {Object} config - Session configuration
   * @returns {Object} Session information
   */
  async createSession(transaction, config = {}) {
    try {
      // Generate PIN if not provided
      const pin = config.pin || this._generatePin();

      // Generate coordinator token (separate from participant PIN)
      const coordinatorToken = this._generateCoordinatorToken();

      // Generate agent API key for programmatic access
      const agentApiKey = crypto.randomBytes(16).toString('hex');

      // Phase F2: ceremony-session timeout for `mode === 'scheduled'` is now
      // configurable via the constructor's `scheduledDefaultTimeout` option
      // (wired up to the server CLI's `--session-timeout` flag). Default
      // remains 24h for backward compat. Set to e.g. 30 days to match a
      // 30-day on-chain Schedule expiration so the dApp ceremony session
      // doesn't expire while the schedule is still collecting signatures.
      const scheduledDefaultTimeout = this.options.scheduledDefaultTimeout || 86400000; // 24h fallback
      const effectiveTimeout = config.timeout ||
        (config.mode === 'scheduled' ? scheduledDefaultTimeout : this.options.defaultTimeout);

      // Pre-session mode (no transaction yet)
      if (!transaction) {
        // Must provide eligiblePublicKeys and threshold for pre-session
        if (!config.eligiblePublicKeys || config.eligiblePublicKeys.length === 0) {
          throw new Error('eligiblePublicKeys required when creating pre-session (no transaction)');
        }

        if (!config.threshold) {
          throw new Error('threshold required when creating pre-session (no transaction)');
        }

        const session = await this.store.createSession({
          pin,
          coordinatorToken,
          agentApiKey,
          frozenTransaction: null,
          txDetails: null,
          threshold: config.threshold,
          eligiblePublicKeys: config.eligiblePublicKeys,
          expectedParticipants: config.expectedParticipants || config.eligiblePublicKeys.length,
          timeout: effectiveTimeout,
          mode: config.mode || 'realtime'
        });

        // Initialize event handlers for this session
        this._initializeEventHandlers(session.sessionId, config);

        this.log.info('Pre-session created', {
          sessionId: session.sessionId,
          threshold: config.threshold,
          eligibleKeys: config.eligiblePublicKeys.length,
          expectedParticipants: session.stats.participantsExpected,
          expiresAt: session.expiresAt
        });

        if (this.options.verbose) {
          console.log('\n✅ Pre-session created successfully (waiting for transaction)');
          console.log(`   Session ID: ${session.sessionId}`);
          console.log(`   PIN: ${pin}`);
          console.log(`   Threshold: ${config.threshold} of ${config.eligiblePublicKeys.length} signatures required`);
          console.log(`   Expected Participants: ${session.stats.participantsExpected}`);
          console.log(`   Expires: ${new Date(session.expiresAt).toLocaleString()}\n`);
        }

        return {
          sessionId: session.sessionId,
          pin,
          coordinatorToken,
          agentApiKey,
          threshold: config.threshold,
          eligiblePublicKeys: config.eligiblePublicKeys,
          expectedParticipants: session.stats.participantsExpected,
          status: 'waiting',
          createdAt: session.createdAt,
          expiresAt: session.expiresAt
        };
      }

      // Standard mode (with transaction)
      // Validate frozen transaction
      if (!transaction._isFrozen) {
        throw new Error('Transaction must be frozen before creating session');
      }

      // Decode transaction details (canonical shared decoder — 20+ TX types)
      const txDetails = SharedDecoder.extractTransactionDetails(
        transaction,
        getTransactionTypeName(transaction),
        config.contractInterface
      );

      // Extract eligible public keys from transaction
      const eligiblePublicKeys = await this._extractEligiblePublicKeys(
        transaction,
        config.eligiblePublicKeys
      );

      if (eligiblePublicKeys.length === 0) {
        throw new Error('No eligible public keys found for this transaction');
      }

      // Determine threshold
      const threshold = config.threshold || Math.ceil(eligiblePublicKeys.length / 2);

      if (threshold > eligiblePublicKeys.length) {
        throw new Error(
          `Threshold (${threshold}) cannot exceed number of eligible keys (${eligiblePublicKeys.length})`
        );
      }

      // Serialize frozen transaction
      const frozenTxBytes = transaction.toBytes();
      const frozenTxBase64 = Buffer.from(frozenTxBytes).toString('base64');

      // Create session in store
      const session = await this.store.createSession({
        pin,
        coordinatorToken,
        agentApiKey,
        frozenTransaction: {
          bytes: frozenTxBytes,
          base64: frozenTxBase64,
          transaction: transaction // Keep reference for execution
        },
        txDetails,
        threshold,
        eligiblePublicKeys,
        expectedParticipants: config.expectedParticipants || eligiblePublicKeys.length,
        timeout: effectiveTimeout,
        mode: config.mode || 'realtime'
      });

      // Initialize event handlers for this session
      this._initializeEventHandlers(session.sessionId, config);

      if (this.options.verbose) {
        console.log('\n✅ Signing session created successfully');
        console.log(`   Session ID: ${session.sessionId}`);
        console.log(`   PIN: ${pin}`);
        console.log(`   Threshold: ${threshold} of ${eligiblePublicKeys.length} signatures required`);
        console.log(`   Eligible Keys: ${eligiblePublicKeys.length}`);
        console.log(`   Expires: ${new Date(session.expiresAt).toLocaleString()}\n`);
      }

      return {
        sessionId: session.sessionId,
        pin,
        coordinatorToken,
        agentApiKey,
        threshold,
        eligiblePublicKeys,
        txDetails,
        status: 'transaction-received',
        createdAt: session.createdAt,
        expiresAt: session.expiresAt
      };

    } catch (error) {
      if (this.options.verbose) {
        console.error(`\n❌ Failed to create session: ${error.message}\n`);
      }
      throw error;
    }
  }

  /**
   * Get session information
   *
   * @param {string} sessionId - Session identifier
   * @returns {Object|null} Session info or null
   */
  async getSessionInfo(sessionId) {
    const session = await this.store.getSession(sessionId);

    if (!session) {
      return null;
    }

    return {
      sessionId: session.sessionId,
      status: session.status,
      threshold: session.threshold,
      eligiblePublicKeys: session.eligiblePublicKeys,
      txDetails: session.txDetails,
      participants: this._formatParticipants(session),
      signatures: this._formatSignatures(session),
      stats: session.stats,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt
    };
  }

  /**
   * Authenticate participant with PIN
   *
   * @param {string} sessionId - Session identifier
   * @param {string} pin - PIN code
   * @returns {boolean} True if authenticated
   */
  async authenticate(sessionId, pin) {
    return await this.store.authenticate(sessionId, pin);
  }

  /**
   * Authenticate as coordinator (requires coordinatorToken)
   *
   * @param {string} sessionId - Session identifier
   * @param {string} pin - Session PIN
   * @param {string} coordinatorToken - Coordinator-specific token
   * @returns {boolean} True if authenticated as coordinator
   */
  async authenticateCoordinator(sessionId, pin, coordinatorToken) {
    // First verify PIN
    if (!await this.store.authenticate(sessionId, pin)) {
      return false;
    }

    // Then verify coordinator token
    const session = await this.store.getSession(sessionId);
    if (!session || !session.coordinatorToken) {
      // Legacy session without coordinator token - allow PIN-only for backward compatibility
      return true;
    }

    return this.store._timingSafeCompare(coordinatorToken, session.coordinatorToken);
  }

  /**
   * Authenticate as agent using API key (alternative to PIN for programmatic access)
   *
   * @param {string} sessionId - Session identifier
   * @param {string} apiKey - Agent API key
   * @returns {boolean} True if authenticated as agent
   */
  async authenticateAgent(sessionId, apiKey) {
    if (!apiKey) {
      return false;
    }

    const session = await this.store.getSession(sessionId);
    if (!session || !session.agentApiKey) {
      return false;
    }

    return this.store._timingSafeCompare(apiKey, session.agentApiKey);
  }

  /**
   * Generate reconnection token for a participant
   *
   * Binds the token to the participant's public key (when available) so that
   * subsequent reconnection-token AUTH can re-validate eligibility against the
   * current eligible-keys set. Without this binding, a stale token would
   * bypass eligibility changes made after token issuance.
   *
   * @param {string} sessionId - Session identifier
   * @param {string} participantId - Participant identifier
   * @param {string} [publicKey] - Public key the participant authenticated with (optional)
   * @returns {string} Reconnection token
   */
  async generateReconnectionToken(sessionId, participantId, publicKey = null) {
    const token = crypto.randomBytes(16).toString('hex');
    const normalizedKey = publicKey ? normalizePublicKey(publicKey) : null;
    const entry = {
      token,
      publicKey: normalizedKey,
      createdAt: Date.now()
    };
    // Use the store's write-through method so Redis-backed sessions persist.
    // (The in-memory store's getSession() returns the live object, so direct
    // Map mutation worked there; Redis returns a copy on every read, so the
    // mutation was lost. Routing through setReconnectionToken fixes both.)
    if (typeof this.store.setReconnectionToken === 'function') {
      await this.store.setReconnectionToken(sessionId, participantId, entry);
    } else {
      const session = await this.store.getSession(sessionId);
      if (session) {
        session.reconnectionTokens.set(participantId, entry);
      }
    }
    return token;
  }

  /**
   * Authenticate with reconnection token (alternative to PIN for returning participants).
   *
   * If the token was originally issued with a bound public key, the key is
   * re-validated against the current eligible-keys set. This closes the gap
   * where a coordinator rotated the eligible set mid-session and a stale
   * reconnection token could otherwise rejoin.
   *
   * @param {string} sessionId - Session identifier
   * @param {string} reconnectionToken - Previously issued reconnection token
   * @returns {{ valid: boolean, participantId?: string, publicKey?: string|null, reason?: string }}
   */
  async authenticateWithReconnectionToken(sessionId, reconnectionToken) {
    const session = await this.store.getSession(sessionId);
    if (!session) {
      return { valid: false };
    }

    for (const [participantId, entry] of session.reconnectionTokens) {
      // Tolerate the legacy shape (string token) as well as the new {token, publicKey} shape
      const storedToken = typeof entry === 'string' ? entry : entry.token;
      const storedPublicKey = typeof entry === 'string' ? null : entry.publicKey;

      if (this.store._timingSafeCompare(reconnectionToken, storedToken)) {
        if (storedPublicKey && session.eligiblePublicKeys && session.eligiblePublicKeys.length > 0) {
          const stillEligible = isKeyEligible(storedPublicKey, session.eligiblePublicKeys);
          if (!stillEligible) {
            return { valid: false, reason: 'KEY_NO_LONGER_ELIGIBLE' };
          }
        }
        return { valid: true, participantId, publicKey: storedPublicKey };
      }
    }

    return { valid: false };
  }

  /**
   * Add participant to session
   *
   * @param {string} sessionId - Session identifier
   * @param {Object} participantData - Participant information
   * @returns {Object} Participant info
   */
  async addParticipant(sessionId, participantData) {
    const participantId = await this.store.addParticipant(sessionId, participantData);

    // Emit event
    const handlers = this.eventHandlers.get(sessionId);
    if (handlers && handlers.onParticipantConnected) {
      handlers.onParticipantConnected({
        sessionId,
        participantId,
        stats: await this.store.getStats(sessionId)
      });
    }

    return { participantId };
  }

  /**
   * Update participant status
   *
   * @param {string} sessionId - Session identifier
   * @param {string} participantId - Participant identifier
   * @param {string} status - New status
   */
  async updateParticipantStatus(sessionId, participantId, status) {
    await this.store.updateParticipantStatus(sessionId, participantId, status);

    // Emit event
    const handlers = this.eventHandlers.get(sessionId);
    if (handlers && handlers.onStatusUpdate) {
      const session = await this.store.getSession(sessionId);
      const participant = session?.participants.get(participantId);

      handlers.onStatusUpdate({
        sessionId,
        participantId,
        status,
        participant,
        stats: await this.store.getStats(sessionId)
      });
    }
  }

  /**
   * Submit signature from participant
   *
   * @param {string} sessionId - Session identifier
   * @param {string} participantId - Participant identifier
   * @param {Object} signature - Signature data
   * @returns {Object} Submission result
   */
  async submitSignature(sessionId, participantId, signature) {
    // Serialize signature submissions per session to prevent race conditions
    // that could cause double-execution of financial transactions
    const prevLock = this._signatureLocks.get(sessionId) || Promise.resolve();
    let releaseLock;
    const lockPromise = new Promise(resolve => { releaseLock = resolve; });
    this._signatureLocks.set(sessionId, prevLock.then(() => lockPromise));

    try {
      await prevLock; // Wait for any previous submission to complete
    } catch (e) {
      // Previous submission failed, that's ok, proceed with this one
    }

    try {
      const session = await this.store.getSession(sessionId);

      if (!session) {
        throw new Error('Session not found');
      }

      // Allow signatures in transaction-received, signing, or active states
      const validStates = ['transaction-received', 'signing', 'active'];
      if (!validStates.includes(session.status)) {
        throw new Error(`Session is ${session.status}, cannot accept signatures`);
      }

      // Update to signing status if this is the first signature
      if (session.status === 'transaction-received' && session.signatures.size === 0) {
        await this.store.updateStatus(sessionId, 'signing');
      }

      // Validate signature format
      if (!signature.publicKey || !signature.signature) {
        throw new Error('Invalid signature format: missing publicKey or signature');
      }

      // Reject signatures if no frozen transaction is stored (prevents accepting
      // unverifiable signatures in pre-session mode)
      if (!session.frozenTransaction) {
        throw new Error('No transaction to sign - transaction must be injected before signatures can be submitted');
      }

      // Check transaction validity window (120-second Hedera constraint)
      // Scheduled sessions skip this check since they operate asynchronously
      if (session.mode !== 'scheduled' && session.transactionReceivedAt) {
        const elapsed = Date.now() - session.transactionReceivedAt;
        if (elapsed > 120000) {
          throw new Error('Transaction validity window (120 seconds) has expired. Please inject a new transaction.');
        }
      }

      // Check if public key is eligible
      if (!isKeyEligible(signature.publicKey, session.eligiblePublicKeys)) {
        throw new Error('Public key is not eligible to sign this transaction');
      }

      // Check if this public key already signed
      if (session.signatures.has(signature.publicKey)) {
        throw new Error('This public key has already signed');
      }

      // Verify signature cryptographically against the frozen transaction
      if (session.frozenTransaction) {
        const frozenTxBytes = this._getFrozenTransactionBytes(session.frozenTransaction);
        if (frozenTxBytes) {
          const verifyResult = await SignatureVerifier.verifySingle(
            { bytes: frozenTxBytes },
            { publicKey: signature.publicKey, signature: signature.signature }
          );

          if (!verifyResult.valid) {
            throw new Error(`Invalid signature: ${verifyResult.error || 'signature verification failed'}`);
          }
        }
      }

      // Add signature to session
      await this.store.addSignature(sessionId, participantId, signature);

      // Emit signature received event
      const handlers = this.eventHandlers.get(sessionId);
      if (handlers && handlers.onSignatureReceived) {
        handlers.onSignatureReceived({
          sessionId,
          participantId,
          publicKey: signature.publicKey,
          stats: await this.store.getStats(sessionId)
        });
      }

      // Check if threshold is met
      const thresholdMet = await this.store.isThresholdMet(sessionId);

      if (thresholdMet) {
        if (handlers && handlers.onThresholdMet) {
          handlers.onThresholdMet({
            sessionId,
            stats: await this.store.getStats(sessionId),
            signatures: await this.store.getSignatures(sessionId)
          });
        }

        // Auto-execute if configured
        if (this.options.autoExecute) {
          await this.executeTransaction(sessionId);
        }
      }

      return {
        success: true,
        thresholdMet,
        signaturesCollected: session.signatures.size,
        signaturesRequired: session.threshold
      };

    } catch (error) {
      const handlers = this.eventHandlers.get(sessionId);
      if (handlers && handlers.onError) {
        handlers.onError({ sessionId, participantId, error: error.message });
      }

      throw error;
    } finally {
      // Release the per-session signature lock
      releaseLock();
    }
  }

  /**
   * Execute transaction with collected signatures
   *
   * @param {string} sessionId - Session identifier
   * @returns {Object} Execution result
   */
  async executeTransaction(sessionId) {
    // Phase B5: serialize execution under the same per-session lock as
    // signature submission. Without this, a coordinator-triggered EXECUTE
    // racing with auto-execute on threshold-met could double-fire (the
    // status='completed' check has read-modify-write window). The lock also
    // prevents concurrent executes from a re-trigger after a transient failure.
    const prevLock = this._signatureLocks.get(sessionId) || Promise.resolve();
    const lockPromise = prevLock.then(() => this._executeTransactionLocked(sessionId));
    this._signatureLocks.set(sessionId, lockPromise.catch(() => {}));
    return lockPromise;
  }

  async _executeTransactionLocked(sessionId) {
    try {
      const session = await this.store.getSession(sessionId);

      if (!session) {
        throw new Error('Session not found');
      }

      // Reject execute on terminal states. 'execution-failed' is intentionally
      // terminal — requires operator intervention before retry, otherwise any
      // authenticated client could re-trigger after a transient failure.
      if (session.status === 'completed') {
        throw new Error('Transaction already executed');
      }
      if (session.status === 'execution-failed') {
        throw new Error('Session is in execution-failed state and cannot be retried automatically. Cancel and create a new session.');
      }
      if (session.status === 'cancelled' || session.status === 'expired' || session.status === 'transaction-expired') {
        throw new Error(`Session is in terminal state '${session.status}' and cannot be executed.`);
      }

      if (!await this.store.isThresholdMet(sessionId)) {
        throw new Error('Threshold not met, cannot execute transaction');
      }

      // Update session status
      await this.store.updateStatus(sessionId, 'executing');

      // Get signatures
      const signatures = await this.store.getSignatures(sessionId);

      // Reconstruct transaction from stored data
      // frozenTransaction may be:
      // 1. An object with .transaction (original Transaction object)
      // 2. An object with .bytes (Uint8Array)
      // 3. An object with .base64 (base64 string)
      // 4. Just a base64 string
      let signedTx;
      const ft = session.frozenTransaction;

      if (ft && ft.transaction) {
        // Use existing Transaction object (from local coordinator)
        signedTx = ft.transaction;
      } else if (ft && ft.bytes) {
        // Reconstruct from bytes
        signedTx = Transaction.fromBytes(ft.bytes);
      } else if (ft && ft.base64) {
        // Reconstruct from base64 string
        const bytes = Buffer.from(ft.base64, 'base64');
        signedTx = Transaction.fromBytes(bytes);
      } else if (typeof ft === 'string') {
        // frozenTransaction is just a base64 string
        const bytes = Buffer.from(ft, 'base64');
        signedTx = Transaction.fromBytes(bytes);
      } else {
        throw new Error('Invalid frozen transaction format - cannot reconstruct transaction');
      }

      for (const sig of signatures) {
        const publicKey = PublicKey.fromString(sig.publicKey);

        // Handle both single signature (string) and multi-node signatures (array)
        if (Array.isArray(sig.signature)) {
          // Multi-node: array of signatures, one per node-specific transaction
          const signatureArray = sig.signature.map(s => Buffer.from(s, 'base64'));
          signedTx = signedTx.addSignature(publicKey, signatureArray);
        } else {
          // Single signature
          const signatureBytes = Buffer.from(sig.signature, 'base64');
          signedTx = signedTx.addSignature(publicKey, signatureBytes);
        }
      }

      // Execute transaction
      if (this.options.verbose) {
        console.log(`\n🚀 Executing transaction with ${signatures.length} signatures...`);
      }

      const txResponse = await signedTx.execute(this.client);
      const receipt = await txResponse.getReceipt(this.client);

      // Update session status
      await this.store.updateStatus(sessionId, 'completed');

      const result = {
        success: true,
        mirrorConfirmed: false,
        mirrorRecord: null,
        transactionId: txResponse.transactionId.toString(),
        receipt: receipt,
        status: receipt.status.toString()
      };

      // Phase B11: confirm on mirror node so callers get a real "executed and
      // externalized" guarantee rather than just receipt acceptance.
      if (this.options.verifyOnMirror !== false) {
        try {
          const network = this.options.network || process.env.HEDERA_NETWORK || 'testnet';
          const MirrorNodeClient = require('../shared/mirror-node-client');
          const mirror = this.options.mirrorClient || new MirrorNodeClient(network);
          const verification = await mirror.verifyExecution(result.transactionId, {
            maxAttempts: this.options.mirrorPollMaxAttempts,
            pollIntervalMs: this.options.mirrorPollIntervalMs,
          });
          result.mirrorConfirmed = verification.mirrorConfirmed;
          result.mirrorRecord = verification.record;
          if (verification.mirrorConfirmed) {
            this.log.info('Mirror confirmed transaction', {
              sessionId,
              transactionId: result.transactionId,
              consensusTimestamp: verification.record?.consensusTimestamp
            });
          } else {
            this.log.warn('Mirror node did not confirm transaction within polling window', {
              sessionId, transactionId: result.transactionId
            });
          }
        } catch (mirrorErr) {
          this.log.warn('Mirror verification failed (non-fatal)', {
            sessionId, error: mirrorErr.message
          });
        }
      }

      // Emit execution event
      const handlers = this.eventHandlers.get(sessionId);
      if (handlers && handlers.onTransactionExecuted) {
        handlers.onTransactionExecuted({
          sessionId,
          result
        });
      }

      if (this.options.verbose) {
        console.log(`✅ Transaction executed successfully!`);
        console.log(`   Transaction ID: ${result.transactionId}`);
        console.log(`   Status: ${result.status}\n`);
      }

      return result;

    } catch (error) {
      // Phase B5: transition to a TERMINAL execution-failed state instead of
      // reverting to 'active'. The previous behavior left the session executable
      // again, which combined with the post-AUTH role gap (Phase A1) could let
      // a malicious participant re-trigger after a transient failure. Operator
      // must cancel and create a new session to retry.
      try {
        const session = await this.store.getSession(sessionId);
        // Don't transition if we never made it to 'executing' (pre-flight check failure).
        // Those sessions stay in their prior state — the error is informational only.
        if (session && session.status === 'executing') {
          await this.store.updateStatus(sessionId, 'execution-failed');
        }
      } catch (transitionError) {
        this.log.error('Failed to transition session to execution-failed', {
          sessionId,
          original: error.message,
          transitionError: transitionError.message
        });
      }

      this.log.error('Transaction execution failed', {
        sessionId,
        error: error.message
      });

      const handlers = this.eventHandlers.get(sessionId);
      if (handlers && handlers.onError) {
        handlers.onError({ sessionId, error: error.message });
      }

      if (this.options.verbose) {
        console.error(`\n❌ Transaction execution failed: ${error.message}\n`);
      }

      throw error;
    }
  }

  /**
   * Cancel session
   *
   * @param {string} sessionId - Session identifier
   */
  async cancelSession(sessionId) {
    await this.store.updateStatus(sessionId, 'cancelled');
    this.eventHandlers.delete(sessionId);

    if (this.options.verbose) {
      console.log(`\n⚠️  Session ${sessionId} cancelled\n`);
    }
  }

  /**
   * Remove participant
   *
   * @param {string} sessionId - Session identifier
   * @param {string} participantId - Participant identifier
   */
  async removeParticipant(sessionId, participantId) {
    await this.store.removeParticipant(sessionId, participantId);

    const handlers = this.eventHandlers.get(sessionId);
    if (handlers && handlers.onParticipantDisconnected) {
      handlers.onParticipantDisconnected({
        sessionId,
        participantId,
        stats: await this.store.getStats(sessionId)
      });
    }
  }

  /**
   * List all active sessions
   *
   * @returns {Array} Array of session summaries
   */
  async listActiveSessions() {
    return await this.store.listActiveSessions();
  }

  /**
   * Mark participant as ready (keys loaded in memory)
   *
   * @param {string} sessionId - Session identifier
   * @param {string} participantId - Participant identifier
   */
  async setParticipantReady(sessionId, participantId) {
    await this.store.setParticipantReady(sessionId, participantId);

    // Emit event
    const handlers = this.eventHandlers.get(sessionId);
    if (handlers && handlers.onParticipantReady) {
      const session = await this.store.getSession(sessionId);

      handlers.onParticipantReady({
        sessionId,
        participantId,
        stats: await this.store.getStats(sessionId),
        allReady: await this.store.areAllParticipantsReady(sessionId)
      });
    }

    if (this.options.verbose) {
      const stats = await this.store.getStats(sessionId);
      console.log(`\n✅ Participant ${participantId} is ready (${stats.participantsReady}/${stats.participantsExpected})\n`);
    }
  }

  /**
   * Inject transaction into waiting session
   *
   * @param {string} sessionId - Session identifier
   * @param {Transaction} transaction - Frozen Hedera transaction
   * @param {Object} options - Injection options
   * @returns {Object} Updated session info
   */
  async injectTransaction(sessionId, transaction, options = {}) {
    try {
      const session = await this.store.getSession(sessionId);

      if (!session) {
        throw new Error('Session not found');
      }

      if (session.status !== 'waiting') {
        throw new Error(`Cannot inject transaction - session status is ${session.status}`);
      }

      // Validate frozen transaction
      if (!transaction._isFrozen) {
        throw new Error('Transaction must be frozen before injection');
      }

      // Decode transaction details (canonical shared decoder)
      const txDetails = SharedDecoder.extractTransactionDetails(
        transaction,
        getTransactionTypeName(transaction),
        options.contractInterface
      );

      // Serialize frozen transaction
      const frozenTxBytes = transaction.toBytes();
      const frozenTxBase64 = Buffer.from(frozenTxBytes).toString('base64');

      const frozenTransaction = {
        bytes: frozenTxBytes,
        base64: frozenTxBase64,
        transaction: transaction // Keep reference for execution
      };

      // Sanitize metadata if provided
      const sanitizedMetadata = options.metadata
        ? this._sanitizeMetadata(options.metadata, sessionId)
        : null;

      // Build full txDetails with metadata
      const fullTxDetails = {
        ...txDetails,
        metadata: sanitizedMetadata,
        contractInterface: options.contractInterface || null
      };

      // Inject into session
      await this.store.injectTransaction(sessionId, frozenTransaction, fullTxDetails);

      // Emit event
      const handlers = this.eventHandlers.get(sessionId);
      if (handlers && handlers.onTransactionInjected) {
        handlers.onTransactionInjected({
          sessionId,
          txDetails: fullTxDetails,
          metadata: sanitizedMetadata
        });
      }

      if (this.options.verbose) {
        console.log(`\n✅ Transaction injected into session ${sessionId}`);
        console.log(`   Transaction Type: ${txDetails.type}`);
        console.log(`   Status: transaction-received\n`);
      }

      return {
        sessionId,
        status: 'transaction-received',
        txDetails: fullTxDetails
      };

    } catch (error) {
      if (this.options.verbose) {
        console.error(`\n❌ Failed to inject transaction: ${error.message}\n`);
      }
      throw error;
    }
  }

  /**
   * Shutdown session manager
   */
  shutdown() {
    this.store.shutdown();
    this.eventHandlers.clear();
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Extract eligible public keys from transaction
   * @private
   */
  async _extractEligiblePublicKeys(transaction, providedKeys = null) {
    // If keys are manually provided, use those
    if (providedKeys && Array.isArray(providedKeys) && providedKeys.length > 0) {
      return providedKeys;
    }

    try {
      // Option A: Extract from transaction signature map
      const signatureMap = transaction.getSignatures();
      const publicKeys = [];

      // Iterate through signature map to find required signers
      for (const [nodeAccountId, nodeSignatures] of signatureMap) {
        for (const [publicKey, signature] of nodeSignatures) {
          const pubKeyStr = publicKey.toString();
          if (!publicKeys.includes(pubKeyStr)) {
            publicKeys.push(pubKeyStr);
          }
        }
      }

      if (publicKeys.length > 0) {
        return publicKeys;
      }

      // Option B: If signature map is empty, try to extract from transaction body
      // This would require querying the account info for accounts involved
      // For now, throw error asking for manual specification
      throw new Error(
        'Could not automatically extract eligible public keys. ' +
        'Please provide them manually via config.eligiblePublicKeys'
      );

    } catch (error) {
      throw new Error(
        `Failed to extract eligible public keys: ${error.message}. ` +
        'Please provide them manually via config.eligiblePublicKeys'
      );
    }
  }

  /**
   * Generate random session token (8-character alphanumeric)
   * @private
   */
  _generatePin() {
    // Generate 8-character alphanumeric token (A-Z, 0-9, excluding confusing chars)
    // Uses uppercase + digits, excluding O/0, I/1, L for readability
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const charCount = chars.length; // 30
    const maxUnbiased = Math.floor(256 / charCount) * charCount; // 240 (largest multiple of 30 <= 256)

    let token = '';
    while (token.length < 8) {
      const bytes = crypto.randomBytes(8 - token.length);
      for (let i = 0; i < bytes.length && token.length < 8; i++) {
        // Rejection sampling: discard bytes >= maxUnbiased to eliminate modulo bias
        if (bytes[i] < maxUnbiased) {
          token += chars[bytes[i] % charCount];
        }
      }
    }
    return token;
  }

  /**
   * Generate coordinator token (16-byte hex, more entropy than PIN)
   * @private
   */
  _generateCoordinatorToken() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Normalize frozen transaction to standard format at ingestion
   * Ensures consistent format: { bytes: Buffer, base64: string, transaction?: Transaction }
   * @private
   * @param {string|Object} frozenTransaction - Frozen transaction in various formats
   * @returns {Object} Normalized format with bytes, base64, and optionally transaction
   */
  _normalizeFrozenTransaction(frozenTransaction) {
    if (!frozenTransaction) {
      return null;
    }

    let bytes;
    let base64;
    let transaction = null;

    // Format 1: Plain base64 string
    if (typeof frozenTransaction === 'string') {
      base64 = frozenTransaction;
      bytes = Buffer.from(base64, 'base64');
    }
    // Format 2: Object with base64 property
    else if (frozenTransaction.base64) {
      base64 = frozenTransaction.base64;
      bytes = frozenTransaction.bytes
        ? Buffer.from(frozenTransaction.bytes)
        : Buffer.from(base64, 'base64');
      transaction = frozenTransaction.transaction || null;
    }
    // Format 3: Object with bytes property only
    else if (frozenTransaction.bytes) {
      bytes = Buffer.from(frozenTransaction.bytes);
      base64 = bytes.toString('base64');
      transaction = frozenTransaction.transaction || null;
    }
    // Format 4: Object with transaction property containing bytes
    else if (frozenTransaction.transaction) {
      if (frozenTransaction.transaction.bytes) {
        bytes = Buffer.from(frozenTransaction.transaction.bytes);
        base64 = bytes.toString('base64');
      } else if (frozenTransaction.transaction.toBytes) {
        bytes = frozenTransaction.transaction.toBytes();
        base64 = Buffer.from(bytes).toString('base64');
      }
      transaction = frozenTransaction.transaction;
    }
    else {
      return null;
    }

    return { bytes, base64, transaction };
  }

  /**
   * Extract transaction bytes from frozen transaction (handles multiple formats)
   * @private
   * @param {string|Object} frozenTransaction - Frozen transaction in various formats
   * @returns {Buffer|null} Transaction bytes or null if cannot extract
   */
  _getFrozenTransactionBytes(frozenTransaction) {
    try {
      const normalized = this._normalizeFrozenTransaction(frozenTransaction);
      return normalized ? normalized.bytes : null;
    } catch (error) {
      console.error('Error extracting frozen transaction bytes:', error.message);
      return null;
    }
  }

  /**
   * Format participants for display
   * @private
   */
  _formatParticipants(session) {
    const participants = [];

    for (const [participantId, participant] of session.participants) {
      participants.push({
        participantId,
        status: participant.status,
        publicKey: participant.publicKey,
        label: participant.label,
        connectedAt: participant.connectedAt
      });
    }

    return participants;
  }

  /**
   * Format signatures for display
   * @private
   */
  _formatSignatures(session) {
    const signatures = [];

    for (const [publicKey, signature] of session.signatures) {
      signatures.push({
        publicKey,
        publicKeyPreview: this._formatPublicKeyPreview(publicKey),
        timestamp: signature.timestamp
      });
    }

    return signatures;
  }

  /**
   * Format public key preview (last 8 chars)
   * @private
   */
  _formatPublicKeyPreview(publicKey) {
    if (!publicKey || publicKey.length < 8) {
      return publicKey;
    }
    return '...' + publicKey.slice(-8);
  }

  /**
   * Initialize event handlers for a session
   * @private
   */
  _initializeEventHandlers(sessionId, config) {
    this.eventHandlers.set(sessionId, {
      onParticipantConnected: config.onParticipantConnected || (() => {}),
      onParticipantDisconnected: config.onParticipantDisconnected || (() => {}),
      onParticipantReady: config.onParticipantReady || (() => {}),
      onStatusUpdate: config.onStatusUpdate || (() => {}),
      onTransactionInjected: config.onTransactionInjected || (() => {}),
      onSignatureReceived: config.onSignatureReceived || (() => {}),
      onThresholdMet: config.onThresholdMet || (() => {}),
      onTransactionExecuted: config.onTransactionExecuted || (() => {}),
      onError: config.onError || (() => {})
    });
  }

  /**
   * Sanitize coordinator-provided metadata to prevent misleading information
   * @private
   */
  _sanitizeMetadata(metadata, sessionId) {
    const sanitized = {
      // Verified fields (provided by server)
      type: 'COORDINATOR_PROVIDED',
      timestamp: Date.now(),
      sessionId: sessionId,

      // Unverified fields (from coordinator - marked as advisory only)
      description: null,
      amount: null,
      recipient: null,
      customFields: {}
    };

    // Sanitize description (remove urgency language)
    if (metadata.description && typeof metadata.description === 'string') {
      let desc = metadata.description;

      // Flag suspicious patterns
      const suspiciousPatterns = [
        /urgent/i,
        /immediately/i,
        /asap/i,
        /hurry/i,
        /quickly/i,
        /emergency/i,
        /critical/i
      ];

      const hasSuspicious = suspiciousPatterns.some(pattern => pattern.test(desc));

      sanitized.description = {
        text: desc.substring(0, 500), // Limit length
        flagged: hasSuspicious,
        warning: hasSuspicious ? 'Contains urgency language - verify independently' : null
      };
    }

    // Sanitize amount (advisory only)
    if (metadata.amount) {
      sanitized.amount = {
        value: metadata.amount,
        warning: 'Amount is UNVERIFIED - validate against actual transaction bytes'
      };
    }

    // Sanitize recipient (advisory only)
    if (metadata.recipient) {
      sanitized.recipient = {
        address: metadata.recipient,
        warning: 'Recipient is UNVERIFIED - validate against actual transaction bytes'
      };
    }

    // Allow custom fields but mark them as unverified
    if (metadata.customFields && typeof metadata.customFields === 'object') {
      sanitized.customFields = {
        ...metadata.customFields,
        _warning: 'All custom fields are UNVERIFIED - for context only'
      };
    }

    return sanitized;
  }
}

module.exports = SigningSessionManager;
