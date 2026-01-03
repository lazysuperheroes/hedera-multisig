/**
 * SigningSessionManager
 *
 * Manages multi-signature signing sessions.
 * Handles session creation, public key extraction, and coordination.
 */

const crypto = require('crypto');
const SessionStore = require('./SessionStore');
const TransactionDecoder = require('../core/TransactionDecoder');
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

      // Pre-session mode (no transaction yet)
      if (!transaction) {
        // Must provide eligiblePublicKeys and threshold for pre-session
        if (!config.eligiblePublicKeys || config.eligiblePublicKeys.length === 0) {
          throw new Error('eligiblePublicKeys required when creating pre-session (no transaction)');
        }

        if (!config.threshold) {
          throw new Error('threshold required when creating pre-session (no transaction)');
        }

        const session = this.store.createSession({
          pin,
          frozenTransaction: null,
          txDetails: null,
          threshold: config.threshold,
          eligiblePublicKeys: config.eligiblePublicKeys,
          expectedParticipants: config.expectedParticipants || config.eligiblePublicKeys.length,
          timeout: config.timeout || this.options.defaultTimeout
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

      // Decode transaction details
      const txDetails = TransactionDecoder.decode(transaction, config.contractInterface);

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
      const session = this.store.createSession({
        pin,
        frozenTransaction: {
          bytes: frozenTxBytes,
          base64: frozenTxBase64,
          transaction: transaction // Keep reference for execution
        },
        txDetails,
        threshold,
        eligiblePublicKeys,
        expectedParticipants: config.expectedParticipants || eligiblePublicKeys.length,
        timeout: config.timeout || this.options.defaultTimeout
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
  getSessionInfo(sessionId) {
    const session = this.store.getSession(sessionId);

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
  authenticate(sessionId, pin) {
    return this.store.authenticate(sessionId, pin);
  }

  /**
   * Add participant to session
   *
   * @param {string} sessionId - Session identifier
   * @param {Object} participantData - Participant information
   * @returns {Object} Participant info
   */
  addParticipant(sessionId, participantData) {
    const participantId = this.store.addParticipant(sessionId, participantData);

    // Emit event
    const handlers = this.eventHandlers.get(sessionId);
    if (handlers && handlers.onParticipantConnected) {
      handlers.onParticipantConnected({
        sessionId,
        participantId,
        stats: this.store.getStats(sessionId)
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
  updateParticipantStatus(sessionId, participantId, status) {
    this.store.updateParticipantStatus(sessionId, participantId, status);

    // Emit event
    const handlers = this.eventHandlers.get(sessionId);
    if (handlers && handlers.onStatusUpdate) {
      const session = this.store.getSession(sessionId);
      const participant = session?.participants.get(participantId);

      handlers.onStatusUpdate({
        sessionId,
        participantId,
        status,
        participant,
        stats: this.store.getStats(sessionId)
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
    try {
      const session = this.store.getSession(sessionId);

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
        this.store.updateStatus(sessionId, 'signing');
      }

      // Validate signature format
      if (!signature.publicKey || !signature.signature) {
        throw new Error('Invalid signature format: missing publicKey or signature');
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
      this.store.addSignature(sessionId, participantId, signature);

      // Emit signature received event
      const handlers = this.eventHandlers.get(sessionId);
      if (handlers && handlers.onSignatureReceived) {
        handlers.onSignatureReceived({
          sessionId,
          participantId,
          publicKey: signature.publicKey,
          stats: this.store.getStats(sessionId)
        });
      }

      // Check if threshold is met
      const thresholdMet = this.store.isThresholdMet(sessionId);

      if (thresholdMet) {
        if (handlers && handlers.onThresholdMet) {
          handlers.onThresholdMet({
            sessionId,
            stats: this.store.getStats(sessionId),
            signatures: this.store.getSignatures(sessionId)
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
    }
  }

  /**
   * Execute transaction with collected signatures
   *
   * @param {string} sessionId - Session identifier
   * @returns {Object} Execution result
   */
  async executeTransaction(sessionId) {
    try {
      const session = this.store.getSession(sessionId);

      if (!session) {
        throw new Error('Session not found');
      }

      if (!this.store.isThresholdMet(sessionId)) {
        throw new Error('Threshold not met, cannot execute transaction');
      }

      if (session.status === 'completed') {
        throw new Error('Transaction already executed');
      }

      // Update session status
      this.store.updateStatus(sessionId, 'executing');

      // Get signatures
      const signatures = this.store.getSignatures(sessionId);

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
      this.store.updateStatus(sessionId, 'completed');

      const result = {
        success: true,
        transactionId: txResponse.transactionId.toString(),
        receipt: receipt,
        status: receipt.status.toString()
      };

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
      this.store.updateStatus(sessionId, 'active'); // Revert to active on error

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
  cancelSession(sessionId) {
    this.store.updateStatus(sessionId, 'cancelled');
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
  removeParticipant(sessionId, participantId) {
    this.store.removeParticipant(sessionId, participantId);

    const handlers = this.eventHandlers.get(sessionId);
    if (handlers && handlers.onParticipantDisconnected) {
      handlers.onParticipantDisconnected({
        sessionId,
        participantId,
        stats: this.store.getStats(sessionId)
      });
    }
  }

  /**
   * List all active sessions
   *
   * @returns {Array} Array of session summaries
   */
  listActiveSessions() {
    return this.store.listActiveSessions();
  }

  /**
   * Mark participant as ready (keys loaded in memory)
   *
   * @param {string} sessionId - Session identifier
   * @param {string} participantId - Participant identifier
   */
  setParticipantReady(sessionId, participantId) {
    this.store.setParticipantReady(sessionId, participantId);

    // Emit event
    const handlers = this.eventHandlers.get(sessionId);
    if (handlers && handlers.onParticipantReady) {
      const session = this.store.getSession(sessionId);

      handlers.onParticipantReady({
        sessionId,
        participantId,
        stats: this.store.getStats(sessionId),
        allReady: this.store.areAllParticipantsReady(sessionId)
      });
    }

    if (this.options.verbose) {
      const stats = this.store.getStats(sessionId);
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
      const session = this.store.getSession(sessionId);

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

      // Decode transaction details
      const txDetails = TransactionDecoder.decode(transaction, options.contractInterface);

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
      this.store.injectTransaction(sessionId, frozenTransaction, fullTxDetails);

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
    const bytes = crypto.randomBytes(8);
    let token = '';
    for (let i = 0; i < 8; i++) {
      token += chars[bytes[i] % chars.length];
    }
    return token;
  }

  /**
   * Extract transaction bytes from frozen transaction (handles multiple formats)
   * @private
   * @param {string|Object} frozenTransaction - Frozen transaction in various formats
   * @returns {Buffer|null} Transaction bytes or null if cannot extract
   */
  _getFrozenTransactionBytes(frozenTransaction) {
    try {
      // Handle different frozen transaction formats
      if (!frozenTransaction) {
        return null;
      }

      let base64Data;

      // Format 1: Plain base64 string
      if (typeof frozenTransaction === 'string') {
        base64Data = frozenTransaction;
      }
      // Format 2: Object with base64 property
      else if (frozenTransaction.base64) {
        base64Data = frozenTransaction.base64;
      }
      // Format 3: Object with bytes property (already Buffer/Uint8Array)
      else if (frozenTransaction.bytes) {
        return Buffer.from(frozenTransaction.bytes);
      }
      // Format 4: Object with transaction property containing bytes
      else if (frozenTransaction.transaction && frozenTransaction.transaction.bytes) {
        return Buffer.from(frozenTransaction.transaction.bytes);
      }
      else {
        return null;
      }

      // Decode base64 to bytes
      return Buffer.from(base64Data, 'base64');
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
