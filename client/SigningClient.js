/**
 * SigningClient
 *
 * Client for participants to connect to signing sessions.
 * Implements pre-session workflow: connect → load keys → wait → review → sign.
 */

const WebSocket = require('ws');
// NOTE: deliberately using Node's built-in `readline` (event-driven)
// instead of the npm `readline-sync` package. The synchronous variant
// blocks Node's event loop while the operator reads/types — during which
// WebSocket pongs aren't sent, so the server's heartbeat watchdog
// terminates the socket mid-review. The async readline keeps the loop
// running so heartbeats and incoming server messages continue flowing.
const readline = require('readline');
const { PrivateKey, Transaction } = require('@hashgraph/sdk');
const TransactionReviewer = require('./TransactionReviewer');
const { extractAllBodyBytes } = require('../shared/transaction-decoder');

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

    // Reconnection state
    this.connectionParams = null; // { serverUrl, sessionId, pin, reconnectionToken }
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
    this.reconnectInterval = options.reconnectInterval || 3000;
    this.reconnectTimer = null;
    this.intentionalDisconnect = false;
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
        this.connectionParams = { serverUrl, sessionId, pin };
        this.intentionalDisconnect = false;

        // Connect to WebSocket server
        this.ws = new WebSocket(serverUrl);

        this.ws.on('open', () => {
          // Authenticate (use reconnection token if available from previous session)
          const authPayload = {
            sessionId,
            role: 'participant',
            label: this.options.label
          };
          if (this.connectionParams?.reconnectionToken) {
            authPayload.reconnectionToken = this.connectionParams.reconnectionToken;
          } else {
            authPayload.pin = pin;
          }
          this.ws.send(JSON.stringify({
            type: 'AUTH',
            payload: authPayload
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

          // Attempt auto-reconnect if not intentionally disconnected
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

      const { frozenTransaction, txDetails, metadata, abi, contractInterface } = payload;

      // Reconstruct ethers Interface from ABI if provided (ABI is JSON-serializable,
      // contractInterface objects don't survive JSON.stringify over WebSocket)
      let resolvedInterface = contractInterface || null;
      if (abi && !resolvedInterface) {
        try {
          const { Interface } = require('ethers');
          resolvedInterface = new Interface(abi);
        } catch (e) {
          this._log(`Warning: Could not reconstruct contract interface from ABI: ${e.message}`, 'warning');
        }
      }

      // Decode transaction from bytes. NB: TransactionReviewer.decode is
      // async (delegates to SharedDecoder.decode which awaits sha256 for
      // the checksum). Without `await` here, `decodedTx` is the raw Promise
      // and displayForApproval renders garbage / `[object Promise]`.
      const decodedTx = await TransactionReviewer.decode(
        frozenTransaction.base64,
        resolvedInterface
      );

      // Display transaction for approval
      const display = TransactionReviewer.displayForApproval(decodedTx, {
        metadata,
        contractInterface: resolvedInterface
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
      // Log the stack so the operator can paste it for diagnosis. The
      // generic "Error during review: …" auto-reject was hiding things
      // like Buffer/JSON-shape mismatches and invalid-public-key errors.
      const stack = error && error.stack ? `\n${error.stack}` : '';
      this._log(`Error processing transaction: ${error.message}${stack}`, 'error');
      await this.rejectTransaction(`Error during review: ${error.message}`);
    }
  }

  /**
   * Prompt user for manual approval
   *
   * @returns {Promise<boolean>} True if approved, false if rejected
   */
  async promptUserApproval() {
    // Single-prompt safety: if a previous prompt is somehow still open
    // (e.g. a fresh TRANSACTION_RECEIVED arrived while the operator was
    // still reading the previous one — possible now that the event loop
    // isn't blocked), close it cleanly so it resolves to "not approved"
    // and we don't end up with two prompts racing for stdin.
    if (this._activePromptRl) {
      try { this._activePromptRl.close(); } catch { /* already closed */ }
      this._activePromptRl = null;
    }

    console.log('\n');
    console.log('═'.repeat(64));
    console.log('Do you approve this transaction?');
    console.log('Type "YES" (all caps) to approve, anything else to reject.');
    console.log('═'.repeat(64));

    return new Promise((resolve) => {
      let resolved = false;
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: !!process.stdout.isTTY,
      });
      this._activePromptRl = rl;

      const finish = (approved) => {
        if (resolved) return;
        resolved = true;
        if (this._activePromptRl === rl) {
          this._activePromptRl = null;
        }
        try { rl.close(); } catch { /* already closed */ }
        resolve(approved);
      };

      rl.question('\nYour decision: ', (answer) => {
        finish(answer === 'YES');
      });

      // Stream end / SIGINT / explicit close from elsewhere — treat as
      // "no decision = not approved" so the caller doesn't await forever.
      rl.on('close', () => finish(false));
    });
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

      // Multi-node freeze: each SignedTransaction in the list has a
      // distinct bodyBytes (differs in nodeAccountID). Hedera's SDK
      // requires one signature per body and refuses single-sig attach
      // with "Signature array must match the number of transactions".
      // We sign every body with this participant's private key and
      // submit the full array. Single-node freezes (e.g. some legacy
      // examples) yield a 1-element array transparently.
      const txBytes = Buffer.from(frozenTransaction.base64, 'base64');
      const bodies = extractAllBodyBytes(txBytes);
      const signaturesB64 = bodies.map((body) => {
        const sig = this.privateKey.sign(body);
        return Buffer.from(sig).toString('base64');
      });

      // Submit signatures to server (NOT the private key!).
      // `signature` is kept for backward compat with any pre-multi-sig
      // server build still in flight; canonical field is `signatures`.
      this.ws.send(JSON.stringify({
        type: 'SIGNATURE_SUBMIT',
        payload: {
          publicKey: this.privateKey.publicKey.toString(),
          signatures: signaturesB64,
          signature: signaturesB64[0]
        }
      }));

      this.status = 'signed';
      this._log('✅ Transaction signed and signature submitted', 'success');
      this._emit('signed', {
        publicKey: this.privateKey.publicKey.toString()
      });

    } catch (error) {
      // Surface the full stack so a sign failure during a multi-sig
      // ceremony produces something diagnosable instead of a vague
      // "Failed to sign transaction: …" line. The catch in
      // _onTransactionReceived was historically masking the real cause
      // (e.g. INVALID_PUBLIC_KEY mismatches between the eligible-keys
      // list and the participant's derived pubkey serialization).
      const stack = error && error.stack ? `\n${error.stack}` : '';
      this._log(`Failed to sign transaction: ${error.message}${stack}`, 'error');
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
          // Emit BEFORE the async review/sign flow so a CLI consumer can
          // print a per-transaction countdown, status banner, etc. The
          // _onTransactionReceived call still runs the prompt + sign.
          this._emit('transactionReceived', message.payload);
          this._onTransactionReceived(message.payload);
          break;

        case 'SIGNATURE_ACCEPTED':
          this._log('Signature accepted by server', 'success');
          this._emit('signatureAccepted', message.payload);
          break;

        case 'SIGNATURE_RECEIVED': {
          // Broadcast — informational notice that *some* participant's
          // signature landed on the server. Not necessarily ours; the
          // server already sent us SIGNATURE_ACCEPTED if it was. Surface
          // the running tally so an operator watching the CLI sees
          // progress as other participants sign.
          const stats = message.payload?.stats || {};
          const collected = stats.signaturesCollected;
          const required = stats.signaturesRequired;
          const isSelf = message.payload?.participantId === this.participantId;
          if (typeof collected === 'number' && typeof required === 'number') {
            const who = isSelf ? 'you' : `participant ${(message.payload?.participantId || '').slice(0, 8) || 'unknown'}`;
            this._log(
              `Signature received from ${who} — ${collected}/${required} collected`,
              'info'
            );
          }
          this._emit('signatureReceived', message.payload);
          break;
        }

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

        case 'TRANSACTION_REJECTED':
          // Another participant declined the in-flight tx. Don't change
          // status here — let the consumer decide how to react. We stay
          // on the WebSocket; threshold may or may not still be reachable.
          this._emit('transactionRejected', message.payload);
          break;

        case 'TRANSACTION_EXPIRED':
          // 120-second Hedera window elapsed before threshold was met.
          // Server auto-resets the session back to 'waiting' so a new tx
          // can be injected. Reset our local status so setReady-equivalent
          // future handling works cleanly without the operator having to
          // tear down the CLI.
          this._log('⏱️  Transaction expired before threshold was met', 'warning');
          if (this.status === 'reviewing' || this.status === 'signing' || this.status === 'rejected') {
            this.status = 'ready';
          }
          this._emit('transactionExpired', message.payload);
          break;

        case 'TRANSACTION_RESET':
          // Coordinator abandoned the in-flight transaction (clears the
          // server-side state without expiring naturally). Mirror the
          // logic of TRANSACTION_EXPIRED: drop the local 'reviewing' /
          // 'rejected' status and wait for the next injection.
          this._log('🔄  Coordinator reset the transaction', 'info');
          if (this.status === 'reviewing' || this.status === 'signing' || this.status === 'rejected') {
            this.status = 'ready';
          }
          this._emit('transactionReset', message.payload);
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
    this.reconnectAttempts = 0; // Reset on successful auth

    // Store reconnection token for future reconnects (replaces PIN)
    if (payload.reconnectionToken && this.connectionParams) {
      this.connectionParams.reconnectionToken = payload.reconnectionToken;
      delete this.connectionParams.pin;
    }

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

  /**
   * Attempt to reconnect to the session after disconnect.
   * @private
   */
  _attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this._log(`Max reconnection attempts (${this.maxReconnectAttempts}) reached`, 'error');
      this._emit('reconnectFailed');
      return;
    }

    this.reconnectAttempts++;
    this._log(`Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`, 'info');

    this.reconnectTimer = setTimeout(() => {
      if (this.connectionParams) {
        const { serverUrl, sessionId, pin } = this.connectionParams;
        this.connect(serverUrl, sessionId, pin || '').catch((err) => {
          this._log(`Reconnection failed: ${err.message}`, 'error');
        });
      }
    }, this.reconnectInterval);
  }

  /**
   * Disconnect from the session intentionally (no auto-reconnect).
   */
  disconnect() {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    // Close any in-flight YES/NO prompt so its Promise resolves (as
    // "not approved") rather than dangling forever after the WS goes
    // away. With the async readline, a Ctrl+C or programmatic disconnect
    // that doesn't tear down the prompt would leave the process
    // listening on stdin with no upstream connection.
    if (this._activePromptRl) {
      try { this._activePromptRl.close(); } catch { /* already closed */ }
      this._activePromptRl = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.status = 'disconnected';
    this.privateKey = null;
    this.connectionParams = null;
  }
}

module.exports = SigningClient;
