/**
 * AgentSigningClient
 *
 * Headless signing client for automated agents (AI agents, bots, policy engines).
 * Connects to a signing session, inspects transactions, applies policy rules,
 * and signs automatically if conditions are met.
 *
 * No readline prompts, no console UI — all communication via events and callbacks.
 *
 * Usage:
 *   const agent = new AgentSigningClient({
 *     approvalPolicy: async (txDetails, metadata) => {
 *       // Custom logic to decide whether to sign
 *       return { approved: true };
 *     }
 *   });
 *   await agent.connect(serverUrl, sessionId, pin, privateKey);
 */

const WebSocket = require('ws');
const { PrivateKey, Transaction } = require('@hashgraph/sdk');
const { TransactionDecoder, getTransactionTypeName } = require('../shared/transaction-decoder');

class AgentSigningClient {
  /**
   * @param {Object} options
   * @param {Function} options.approvalPolicy - async (txDetails, metadata) => { approved: boolean, reason?: string }
   * @param {string} [options.label] - Agent label for session identification
   * @param {number} [options.maxReconnectAttempts] - Max reconnection attempts (default: 10)
   * @param {number} [options.reconnectInterval] - Reconnection interval in ms (default: 5000)
   * @param {boolean} [options.autoReady] - Automatically signal ready after connect (default: true)
   */
  constructor(options = {}) {
    if (!options.approvalPolicy || typeof options.approvalPolicy !== 'function') {
      throw new Error('AgentSigningClient requires an approvalPolicy function');
    }

    this.approvalPolicy = options.approvalPolicy;
    this.label = options.label || 'agent';
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.autoReady = options.autoReady !== false;

    this.ws = null;
    this.sessionId = null;
    this.participantId = null;
    this.privateKey = null;
    this.status = 'disconnected';
    this.sessionInfo = null;
    this.eventHandlers = {};

    // Reconnection state
    this.connectionParams = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.intentionalDisconnect = false;
  }

  /**
   * Connect to a signing session and start the agent loop.
   *
   * @param {string} serverUrl - WebSocket server URL
   * @param {string} sessionId - Session ID
   * @param {string} pin - Session PIN
   * @param {string|PrivateKey} privateKey - Private key for signing
   * @returns {Promise<{ participantId: string, sessionInfo: Object }>}
   */
  async connect(serverUrl, sessionId, pin, privateKey) {
    // Parse private key
    if (typeof privateKey === 'string') {
      this.privateKey = PrivateKey.fromString(privateKey);
    } else {
      this.privateKey = privateKey;
    }

    this.sessionId = sessionId;
    this.connectionParams = { serverUrl, sessionId, pin };
    this.intentionalDisconnect = false;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(serverUrl);

        this.ws.on('open', () => {
          this.reconnectAttempts = 0;

          const authPayload = { sessionId, role: 'participant', label: this.label };

          if (this.connectionParams.reconnectionToken) {
            authPayload.reconnectionToken = this.connectionParams.reconnectionToken;
          } else {
            authPayload.pin = pin;
          }

          this.ws.send(JSON.stringify({ type: 'AUTH', payload: authPayload }));
        });

        this.ws.on('message', (data) => {
          this._handleMessage(data, resolve, reject);
        });

        this.ws.on('error', (error) => {
          this._emit('error', { message: error.message });
          if (this.status === 'disconnected') {
            reject(error);
          }
        });

        this.ws.on('close', () => {
          this.status = 'disconnected';
          this._emit('disconnected');

          if (!this.intentionalDisconnect && this.connectionParams) {
            this._attemptReconnect();
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the session.
   */
  disconnect() {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.status = 'disconnected';
    this.connectionParams = null;
  }

  /**
   * Register event handler.
   * Events: connected, ready, transactionReceived, approved, rejected,
   *         signed, signatureAccepted, thresholdMet, transactionExecuted,
   *         error, disconnected, reconnectFailed
   */
  on(event, handler) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
    return this;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  _handleMessage(data, connectResolve, connectReject) {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'AUTH_SUCCESS':
          this._onAuthSuccess(message.payload, connectResolve);
          break;

        case 'AUTH_FAILED':
          this._emit('error', { message: message.payload.message, code: message.payload.code });
          if (connectReject) connectReject(new Error(message.payload.message));
          break;

        case 'TRANSACTION_RECEIVED':
          this._onTransactionReceived(message.payload);
          break;

        case 'SIGNATURE_ACCEPTED':
          this._emit('signatureAccepted', message.payload);
          break;

        case 'SIGNATURE_REJECTED':
          this._emit('error', { message: message.payload.message, code: message.payload.code });
          break;

        case 'THRESHOLD_MET':
          this._emit('thresholdMet', message.payload);
          break;

        case 'TRANSACTION_EXECUTED':
          this.status = 'completed';
          this._emit('transactionExecuted', message.payload);
          break;

        case 'TRANSACTION_EXPIRED':
          this._emit('transactionExpired', message.payload);
          break;

        case 'SESSION_EXPIRED':
          this.disconnect();
          this._emit('sessionExpired');
          break;

        case 'PONG':
          break;

        default:
          // Ignore unknown messages
          break;
      }
    } catch (error) {
      this._emit('error', { message: `Message handling error: ${error.message}` });
    }
  }

  _onAuthSuccess(payload, resolve) {
    this.participantId = payload.participantId;
    this.sessionInfo = payload.sessionInfo;
    this.status = 'connected';

    if (payload.reconnectionToken && this.connectionParams) {
      this.connectionParams.reconnectionToken = payload.reconnectionToken;
      delete this.connectionParams.pin;
    }

    this._emit('connected', { participantId: this.participantId, sessionInfo: this.sessionInfo });

    if (resolve) {
      resolve({ participantId: this.participantId, sessionInfo: this.sessionInfo });
    }

    // Auto-ready if configured
    if (this.autoReady) {
      this._setReady();
    }
  }

  _setReady() {
    if (!this.privateKey) return;

    this.ws.send(JSON.stringify({
      type: 'PARTICIPANT_READY',
      payload: { publicKey: this.privateKey.publicKey.toString() }
    }));

    this.status = 'ready';
    this._emit('ready');
  }

  async _onTransactionReceived(payload) {
    try {
      const { frozenTransaction, txDetails, metadata, abi } = payload;

      // Reconstruct ABI if provided
      let contractInterface = null;
      if (abi) {
        try {
          const { Interface } = require('ethers');
          contractInterface = new Interface(abi);
        } catch (e) {
          // ABI reconstruction failed — proceed without
        }
      }

      // Decode the transaction for policy evaluation
      let decodedDetails = txDetails || {};
      if (frozenTransaction && frozenTransaction.base64) {
        try {
          const decoded = await TransactionDecoder.decode(frozenTransaction.base64, contractInterface);
          decodedDetails = { ...decodedDetails, ...decoded.details };
        } catch (e) {
          // Decode failed — use whatever txDetails we have
        }
      }

      this._emit('transactionReceived', { txDetails: decodedDetails, metadata });

      // Apply approval policy
      const decision = await this.approvalPolicy(decodedDetails, metadata);

      if (decision.approved) {
        this._emit('approved', { txDetails: decodedDetails, reason: decision.reason });
        await this._signAndSubmit(frozenTransaction);
      } else {
        this._emit('rejected', { txDetails: decodedDetails, reason: decision.reason || 'Policy rejected' });
        this.ws.send(JSON.stringify({
          type: 'TRANSACTION_REJECTED',
          payload: { reason: decision.reason || 'Agent policy rejected this transaction' }
        }));
      }
    } catch (error) {
      this._emit('error', { message: `Transaction processing error: ${error.message}` });
    }
  }

  async _signAndSubmit(frozenTransaction) {
    try {
      // Get transaction bytes
      let txBytes;
      if (frozenTransaction.base64) {
        txBytes = Buffer.from(frozenTransaction.base64, 'base64');
      } else if (frozenTransaction.bytes) {
        txBytes = Buffer.from(frozenTransaction.bytes);
      } else if (typeof frozenTransaction === 'string') {
        txBytes = Buffer.from(frozenTransaction, 'base64');
      } else {
        throw new Error('Cannot extract transaction bytes');
      }

      // Sign
      this.status = 'signing';
      const signatureBytes = this.privateKey.sign(txBytes);
      const publicKey = this.privateKey.publicKey.toString();
      const signatureBase64 = Buffer.from(signatureBytes).toString('base64');

      // Submit
      this.ws.send(JSON.stringify({
        type: 'SIGNATURE_SUBMIT',
        payload: { publicKey, signature: signatureBase64 }
      }));

      this.status = 'signed';
      this._emit('signed', { publicKey, signature: signatureBase64 });
    } catch (error) {
      this._emit('error', { message: `Signing error: ${error.message}` });
    }
  }

  _attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this._emit('reconnectFailed');
      return;
    }

    this.reconnectAttempts++;
    this._emit('error', {
      message: `Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`,
      code: 'RECONNECTING'
    });

    this.reconnectTimer = setTimeout(() => {
      if (this.connectionParams) {
        const { serverUrl, sessionId, pin } = this.connectionParams;
        this.connect(serverUrl, sessionId, pin || '', this.privateKey).catch(() => {});
      }
    }, this.reconnectInterval);
  }

  _emit(event, data) {
    const handlers = this.eventHandlers[event];
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (e) {
          // Don't let handler errors crash the agent
        }
      }
    }
  }
}

module.exports = AgentSigningClient;
