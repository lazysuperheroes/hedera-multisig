/**
 * SigningClient
 *
 * Client for participants to connect to signing sessions.
 * Implements pre-session workflow: connect → load keys → wait → review → sign.
 */

const WebSocket = require('ws');
const readlineSync = require('readline-sync');
const { PrivateKey, Transaction } = require('@hashgraph/sdk');
const TransactionReviewer = require('./TransactionReviewer');

class SigningClient {
  constructor(options = {}) {
    this.options = {
      verbose: options.verbose !== false,
      autoReview: options.autoReview !== false, // Show transaction for review
      label: options.label || null,
      ...options
    };

    this.ws = null;
    this.sessionId = null;
    this.participantId = null;
    this.status = 'disconnected'; // disconnected, connected, ready, reviewing, signing, signed, rejected
    this.privateKey = null; // Loaded in memory, NEVER transmitted
    this.sessionInfo = null;
    this.eventHandlers = {};
  }

  /**
   * Connect to signing session
   *
   * @param {string} serverUrl - WebSocket server URL
   * @param {string} sessionId - Session identifier
   * @param {string} pin - PIN code
   * @returns {Promise<Object>} Connection result
   */
  async connect(serverUrl, sessionId, pin) {
    return new Promise((resolve, reject) => {
      try {
        this.sessionId = sessionId;

        // Connect to WebSocket server
        this.ws = new WebSocket(serverUrl);

        this.ws.on('open', () => {
          // Authenticate
          this.ws.send(JSON.stringify({
            type: 'AUTH',
            payload: {
              sessionId,
              pin,
              role: 'participant',
              label: this.options.label
            }
          }));
        });

        this.ws.on('message', (data) => {
          this._handleMessage(data, resolve, reject);
        });

        this.ws.on('error', (error) => {
          this._log(`WebSocket error: ${error.message}`, 'error');
          reject(error);
        });

        this.ws.on('close', () => {
          this.status = 'disconnected';
          this._log('Disconnected from session', 'info');
          this._emit('disconnected');
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Load private key into memory (NEVER transmitted over network)
   *
   * @param {string|PrivateKey} privateKey - Private key (hex string or PrivateKey instance)
   */
  loadKeys(privateKey) {
    try {
      if (typeof privateKey === 'string') {
        this.privateKey = PrivateKey.fromString(privateKey);
      } else {
        this.privateKey = privateKey;
      }

      this._log(`Private key loaded (Public Key: ${this.privateKey.publicKey.toString()})`, 'success');

      return {
        success: true,
        publicKey: this.privateKey.publicKey.toString()
      };

    } catch (error) {
      this._log(`Failed to load private key: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Mark participant as ready (keys loaded, waiting for transaction)
   */
  setReady() {
    if (!this.privateKey) {
      throw new Error('Cannot set ready - no private key loaded');
    }

    if (this.status !== 'connected') {
      throw new Error(`Cannot set ready - status is ${this.status}`);
    }

    this.status = 'ready';

    // Notify server
    this.ws.send(JSON.stringify({
      type: 'PARTICIPANT_READY',
      payload: {
        publicKey: this.privateKey.publicKey.toString()
      }
    }));

    this._log('Marked as READY - waiting for transaction injection', 'success');
    this._emit('ready');

    return { success: true };
  }

  /**
   * Handle transaction received from coordinator
   * @private
   */
  async _onTransactionReceived(payload) {
    try {
      this.status = 'reviewing';
      this._log('\n🔔 Transaction received for review!', 'info');

      const { frozenTransaction, txDetails, metadata, contractInterface } = payload;

      // Decode transaction from bytes
      const decodedTx = TransactionReviewer.decode(
        frozenTransaction.base64,
        contractInterface
      );

      // Display transaction for approval
      const display = TransactionReviewer.displayForApproval(decodedTx, {
        metadata,
        contractInterface
      });

      console.log(display);

      // Prompt user for approval
      const approved = await this.promptUserApproval();

      if (approved) {
        await this.signTransaction(frozenTransaction);
      } else {
        await this.rejectTransaction('User rejected after review');
      }

    } catch (error) {
      this._log(`Error processing transaction: ${error.message}`, 'error');
      await this.rejectTransaction(`Error during review: ${error.message}`);
    }
  }

  /**
   * Prompt user for manual approval
   *
   * @returns {Promise<boolean>} True if approved, false if rejected
   */
  async promptUserApproval() {
    console.log('\n');
    console.log('═'.repeat(64));
    console.log('Do you approve this transaction?');
    console.log('Type "YES" (all caps) to approve, anything else to reject.');
    console.log('═'.repeat(64));

    const response = readlineSync.question('\nYour decision: ');

    return response === 'YES';
  }

  /**
   * Sign transaction with loaded private key
   *
   * @param {Object} frozenTransaction - Frozen transaction data
   */
  async signTransaction(frozenTransaction) {
    try {
      if (!this.privateKey) {
        throw new Error('No private key loaded');
      }

      this.status = 'signing';
      this._log('\n✍️  Signing transaction...', 'info');

      // Reconstruct transaction from bytes
      const txBytes = Buffer.from(frozenTransaction.base64, 'base64');
      const transaction = Transaction.fromBytes(txBytes);

      // Sign with private key (locally, never transmitted)
      const signature = this.privateKey.signTransaction(transaction);
      const signatureBytes = Buffer.from(signature).toString('base64');

      // Submit signature to server (NOT the private key!)
      this.ws.send(JSON.stringify({
        type: 'SIGNATURE_SUBMIT',
        payload: {
          publicKey: this.privateKey.publicKey.toString(),
          signature: signatureBytes
        }
      }));

      this.status = 'signed';
      this._log('✅ Transaction signed and signature submitted', 'success');
      this._emit('signed', {
        publicKey: this.privateKey.publicKey.toString()
      });

    } catch (error) {
      this._log(`Failed to sign transaction: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Reject transaction
   *
   * @param {string} reason - Rejection reason
   */
  async rejectTransaction(reason) {
    this.status = 'rejected';

    this.ws.send(JSON.stringify({
      type: 'TRANSACTION_REJECTED',
      payload: {
        reason
      }
    }));

    this._log(`❌ Transaction rejected: ${reason}`, 'warning');
    this._emit('rejected', { reason });
  }

  /**
   * Disconnect from session
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
    }

    this.status = 'disconnected';
    this.privateKey = null; // Clear private key from memory
  }

  /**
   * Register event handler
   *
   * @param {string} event - Event name
   * @param {Function} handler - Event handler function
   */
  on(event, handler) {
    this.eventHandlers[event] = handler;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Handle incoming WebSocket message
   * @private
   */
  _handleMessage(data, connectResolve, connectReject) {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'AUTH_SUCCESS':
          this._handleAuthSuccess(message.payload, connectResolve);
          break;

        case 'AUTH_FAILED':
          this._log(`Authentication failed: ${message.payload.message}`, 'error');
          connectReject(new Error(message.payload.message));
          break;

        case 'TRANSACTION_RECEIVED':
          this._onTransactionReceived(message.payload);
          break;

        case 'SIGNATURE_ACCEPTED':
          this._log('Signature accepted by server', 'success');
          this._emit('signatureAccepted', message.payload);
          break;

        case 'SIGNATURE_REJECTED':
          this._log(`Signature rejected: ${message.payload.message}`, 'error');
          this._emit('signatureRejected', message.payload);
          break;

        case 'THRESHOLD_MET':
          this._log('🎉 Signature threshold met! Transaction ready for execution.', 'success');
          this._emit('thresholdMet', message.payload);
          break;

        case 'TRANSACTION_EXECUTED':
          this._log(`✅ Transaction executed successfully!`, 'success');
          this._log(`   Transaction ID: ${message.payload.transactionId}`, 'info');
          this._emit('transactionExecuted', message.payload);
          break;

        case 'PARTICIPANT_CONNECTED':
          this._log(`Participant connected: ${message.payload.participantId}`, 'info');
          this._emit('participantConnected', message.payload);
          break;

        case 'PARTICIPANT_READY':
          this._log(`Participant ready: ${message.payload.participantId}`, 'info');
          this._emit('participantReady', message.payload);
          break;

        case 'PARTICIPANT_DISCONNECTED':
          this._log(`Participant disconnected: ${message.payload.participantId}`, 'info');
          this._emit('participantDisconnected', message.payload);
          break;

        case 'SESSION_EXPIRED':
          this._log('⚠️  Session expired', 'warning');
          this._emit('sessionExpired', message.payload);
          this.disconnect();
          break;

        case 'ERROR':
          this._log(`Server error: ${message.payload.message}`, 'error');
          this._emit('error', message.payload);
          break;

        case 'PONG':
          // Heartbeat response
          break;

        default:
          this._log(`Unknown message type: ${message.type}`, 'warning');
      }

    } catch (error) {
      this._log(`Error handling message: ${error.message}`, 'error');
    }
  }

  /**
   * Handle successful authentication
   * @private
   */
  _handleAuthSuccess(payload, resolve) {
    this.participantId = payload.participantId;
    this.sessionInfo = payload.sessionInfo;
    this.status = 'connected';

    this._log('✅ Connected to session successfully!', 'success');
    this._log(`   Session ID: ${this.sessionInfo.sessionId}`, 'info');
    this._log(`   Participant ID: ${this.participantId}`, 'info');
    this._log(`   Session Status: ${this.sessionInfo.status}`, 'info');
    this._log(`   Threshold: ${this.sessionInfo.threshold} signatures required`, 'info');

    this._emit('connected', {
      participantId: this.participantId,
      sessionInfo: this.sessionInfo
    });

    // Check if transaction already received
    if (this.sessionInfo.status === 'transaction-received' && this.sessionInfo.txDetails) {
      this._log('\n⚠️  Transaction already in session - will be delivered after setReady()', 'warning');
    }

    resolve({
      success: true,
      participantId: this.participantId,
      sessionInfo: this.sessionInfo
    });
  }

  /**
   * Emit event to registered handlers
   * @private
   */
  _emit(event, data = {}) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event](data);
    }
  }

  /**
   * Log message with formatting
   * @private
   */
  _log(message, level = 'info') {
    if (!this.options.verbose) {
      return;
    }

    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[${timestamp}] [CLIENT]`;

    switch (level) {
      case 'success':
        console.log(`${prefix} ✅ ${message}`);
        break;
      case 'error':
        console.error(`${prefix} ❌ ${message}`);
        break;
      case 'warning':
        console.warn(`${prefix} ⚠️  ${message}`);
        break;
      default:
        console.log(`${prefix} ${message}`);
    }
  }
}

module.exports = SigningClient;
