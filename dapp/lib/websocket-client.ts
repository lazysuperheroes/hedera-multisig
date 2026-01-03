/**
 * BrowserSigningClient
 *
 * Browser-compatible WebSocket client for participants to connect to signing sessions.
 * Port of client/SigningClient.js for use in web browsers.
 *
 * Key differences from Node.js version:
 * - Uses browser WebSocket API instead of 'ws' package
 * - No readline-sync (handled by React components)
 * - Uses browser-compatible Buffer polyfill
 */

import type {
  SigningClientStatus,
  SigningClientEvents,
  EventName,
  EventHandler,
  SessionInfo,
  TransactionDetails,
  ServerMessage,
} from '../types/protocol';

export interface BrowserSigningClientOptions {
  verbose?: boolean;
  autoReview?: boolean;
  label?: string | null;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectInterval?: number; // milliseconds
}

export class BrowserSigningClient {
  private options: Required<BrowserSigningClientOptions>;
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private participantId: string | null = null;
  private status: SigningClientStatus = 'disconnected';
  private sessionInfo: SessionInfo | null = null;
  private eventHandlers: Partial<SigningClientEvents> = {};

  // Connection promise resolvers
  private connectResolve: ((value: any) => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;

  // Auto-reconnect state
  private connectionParams: {
    serverUrl: string;
    sessionId: string;
    pin: string;
    publicKey?: string;
  } | null = null;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private isReconnecting = false;
  private intentionalDisconnect = false;

  constructor(options: BrowserSigningClientOptions = {}) {
    this.options = {
      verbose: options.verbose !== false,
      autoReview: options.autoReview !== false,
      label: options.label || null,
      autoReconnect: options.autoReconnect !== false, // default true
      maxReconnectAttempts: options.maxReconnectAttempts || 5,
      reconnectInterval: options.reconnectInterval || 3000, // 3 seconds
    };
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Connect to signing session
   *
   * @param serverUrl - WebSocket server URL
   * @param sessionId - Session identifier
   * @param pin - PIN code
   * @param publicKey - Optional public key for early eligibility validation
   * @returns Promise with connection result
   */
  async connect(
    serverUrl: string,
    sessionId: string,
    pin: string,
    publicKey?: string
  ): Promise<{ success: boolean; participantId: string; sessionInfo: SessionInfo }> {
    return new Promise((resolve, reject) => {
      try {
        // Store connection params for potential reconnection
        this.connectionParams = { serverUrl, sessionId, pin, publicKey };
        this.sessionId = sessionId;
        this.connectResolve = resolve;
        this.connectReject = reject;
        this.intentionalDisconnect = false;

        // Reset reconnection state on new connection
        if (!this.isReconnecting) {
          this.reconnectAttempts = 0;
        }

        // Connect to WebSocket server
        this.ws = new WebSocket(serverUrl);

        this.ws.onopen = () => {
          // Reset reconnection state on successful connection
          this.reconnectAttempts = 0;
          this.isReconnecting = false;

          // Authenticate (with optional public key for early eligibility validation)
          this.send({
            type: 'AUTH',
            payload: {
              sessionId,
              pin,
              role: 'participant',
              label: this.options.label || undefined,
              publicKey: publicKey || undefined, // Optional: Validates eligibility during AUTH
            },
          });
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          this.log(`WebSocket error: ${error}`, 'error');
          if (!this.isReconnecting) {
            reject(new Error('WebSocket connection failed'));
          }
        };

        this.ws.onclose = () => {
          this.status = 'disconnected';
          this.log('Disconnected from session', 'info');
          this.emit('disconnected');

          // Attempt auto-reconnect if enabled and not intentionally disconnected
          if (this.options.autoReconnect && !this.intentionalDisconnect && this.connectionParams) {
            this.attemptReconnect();
          }
        };
      } catch (error) {
        reject(error as Error);
      }
    });
  }

  /**
   * Attempt to reconnect to the session
   * @private
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.log(`Max reconnection attempts (${this.options.maxReconnectAttempts}) reached`, 'error');
      this.emit('error', { message: 'Connection lost. Max reconnection attempts reached.' });
      return;
    }

    this.reconnectAttempts++;
    this.isReconnecting = true;

    this.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.options.maxReconnectAttempts})...`, 'info');

    // Emit reconnecting event for UI feedback
    this.emit('error', {
      message: `Reconnecting... (attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})`,
      code: 'RECONNECTING',
    });

    // Clear any existing reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(() => {
      if (this.connectionParams) {
        const { serverUrl, sessionId, pin, publicKey } = this.connectionParams;
        this.connect(serverUrl, sessionId, pin, publicKey).catch((err) => {
          this.log(`Reconnection failed: ${err.message}`, 'error');
        });
      }
    }, this.options.reconnectInterval);
  }

  /**
   * Cancel any pending reconnection
   */
  cancelReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
  }

  /**
   * Check if client is currently reconnecting
   */
  isReconnectingNow(): boolean {
    return this.isReconnecting;
  }

  /**
   * Get current reconnection attempts count
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * Set participant as ready (after wallet connection)
   *
   * @param publicKey - Public key from connected wallet
   */
  setReady(publicKey: string): void {
    this.send({
      type: 'PARTICIPANT_READY',
      payload: {
        publicKey,
      },
    });

    this.status = 'ready';
    this.log(`Marked as ready with public key: ${publicKey}`, 'success');
    this.emit('ready', { publicKey });
  }

  /**
   * Submit signature for transaction
   * Note: This is called AFTER wallet has signed the transaction
   *
   * @param publicKey - Public key that signed
   * @param signature - Signature bytes (base64 encoded) - single string or array for multi-node transactions
   */
  submitSignature(publicKey: string, signature: string | string[]): void {
    this.send({
      type: 'SIGNATURE_SUBMIT',
      payload: {
        publicKey,
        signature,
      },
    });

    this.status = 'signed';
    const sigCount = Array.isArray(signature) ? signature.length : 1;
    this.log(`Signature submitted (${sigCount} node signatures)`, 'success');
    this.emit('signed', { publicKey });
  }

  /**
   * Reject transaction
   *
   * @param reason - Rejection reason
   */
  rejectTransaction(reason: string): void {
    this.status = 'rejected';

    this.send({
      type: 'TRANSACTION_REJECTED',
      payload: {
        reason,
      },
    });

    this.log(`Transaction rejected: ${reason}`, 'warning');
    this.emit('rejected', { reason });
  }

  /**
   * Disconnect from session
   */
  disconnect(): void {
    // Mark as intentional disconnect to prevent auto-reconnect
    this.intentionalDisconnect = true;
    this.cancelReconnect();

    if (this.ws) {
      this.ws.close();
    }

    this.status = 'disconnected';
    this.connectionParams = null;
  }

  /**
   * Register event handler
   *
   * @param event - Event name
   * @param handler - Event handler function
   */
  on<T extends EventName>(event: T, handler: EventHandler<T>): void {
    this.eventHandlers[event] = handler as any;
  }

  /**
   * Remove event handler
   *
   * @param event - Event name
   */
  off<T extends EventName>(event: T): void {
    delete this.eventHandlers[event];
  }

  /**
   * Get current status
   */
  getStatus(): SigningClientStatus {
    return this.status;
  }

  /**
   * Get session info
   */
  getSessionInfo(): SessionInfo | null {
    return this.sessionInfo;
  }

  /**
   * Get participant ID
   */
  getParticipantId(): string | null {
    return this.participantId;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Send message to server
   * @private
   */
  private send(message: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Handle incoming WebSocket message
   * @private
   */
  private handleMessage(data: string): void {
    try {
      const message: ServerMessage = JSON.parse(data);

      switch (message.type) {
        case 'AUTH_SUCCESS':
          this.handleAuthSuccess(message.payload);
          break;

        case 'AUTH_FAILED':
          this.log(`Authentication failed: ${message.payload.message}`, 'error');
          if (this.connectReject) {
            this.connectReject(new Error(message.payload.message));
          }
          break;

        case 'TRANSACTION_RECEIVED':
          this.onTransactionReceived(message.payload);
          break;

        case 'SIGNATURE_ACCEPTED':
          this.log('Signature accepted by server', 'success');
          this.emit('signatureAccepted', message.payload);
          break;

        case 'SIGNATURE_REJECTED':
          this.log(`Signature rejected: ${message.payload.message}`, 'error');
          this.emit('signatureRejected', message.payload);
          break;

        case 'THRESHOLD_MET':
          this.log('🎉 Signature threshold met! Transaction ready for execution.', 'success');
          this.emit('thresholdMet', message.payload);
          break;

        case 'TRANSACTION_EXECUTED':
          this.log(`✅ Transaction executed successfully!`, 'success');
          this.log(`   Transaction ID: ${message.payload.transactionId}`, 'info');
          this.emit('transactionExecuted', message.payload);
          this.status = 'completed';
          break;

        case 'TRANSACTION_EXPIRED':
          this.log(`⏱️  Transaction expired!`, 'warning');
          this.emit('transactionExpired', message.payload);
          this.status = 'ready'; // Reset to ready for new transaction
          break;

        case 'PARTICIPANT_CONNECTED':
          this.log(`Participant connected: ${message.payload.participantId}`, 'info');
          this.emit('participantConnected', message.payload);
          break;

        case 'PARTICIPANT_READY':
          this.log(`Participant ready: ${message.payload.participantId}`, 'info');
          this.emit('participantReady', message.payload);
          break;

        case 'PARTICIPANT_DISCONNECTED':
          this.log(`Participant disconnected: ${message.payload.participantId}`, 'info');
          this.emit('participantDisconnected', message.payload);
          break;

        case 'SESSION_EXPIRED':
          this.log('⚠️  Session expired', 'warning');
          this.emit('sessionExpired');
          this.disconnect();
          break;

        case 'ERROR':
          this.log(`Server error: ${message.payload.message}`, 'error');
          this.emit('error', message.payload);
          break;

        case 'PONG':
          // Heartbeat response
          break;

        default:
          this.log(`Unknown message type: ${(message as any).type}`, 'warning');
      }
    } catch (error) {
      this.log(`Error handling message: ${(error as Error).message}`, 'error');
    }
  }

  /**
   * Handle successful authentication
   * @private
   */
  private handleAuthSuccess(payload: {
    participantId: string;
    sessionInfo: SessionInfo;
  }): void {
    this.participantId = payload.participantId;
    this.sessionInfo = payload.sessionInfo;
    this.status = 'connected';

    this.log('✅ Connected to session successfully!', 'success');
    this.log(`   Session ID: ${this.sessionInfo.sessionId}`, 'info');
    this.log(`   Participant ID: ${this.participantId}`, 'info');
    this.log(`   Session Status: ${this.sessionInfo.status}`, 'info');
    this.log(`   Threshold: ${this.sessionInfo.threshold} signatures required`, 'info');

    this.emit('connected', {
      participantId: this.participantId,
      sessionInfo: this.sessionInfo,
    });

    // Check if transaction already received
    if (
      this.sessionInfo.status === 'transaction-received' &&
      this.sessionInfo.txDetails
    ) {
      this.log(
        '\n⚠️  Transaction already in session - will be delivered after setReady()',
        'warning'
      );
    }

    if (this.connectResolve) {
      this.connectResolve({
        success: true,
        participantId: this.participantId,
        sessionInfo: this.sessionInfo,
      });
    }
  }

  /**
   * Handle transaction received
   * @private
   */
  private onTransactionReceived(payload: {
    frozenTransaction: string | { base64: string; bytes?: Uint8Array };
    txDetails: TransactionDetails;
    metadata?: Record<string, any>;
    contractInterface?: any;
  }): void {
    this.status = 'reviewing';

    this.log('\n📋 Transaction received for review', 'info');
    this.log(`   Type: ${payload.txDetails.type}`, 'info');
    this.log(`   Checksum: ${payload.txDetails.checksum}`, 'info');

    // Normalize frozenTransaction to always be { base64: string } format
    // Server may send either a plain base64 string or an object
    const normalizedPayload = {
      ...payload,
      frozenTransaction: typeof payload.frozenTransaction === 'string'
        ? { base64: payload.frozenTransaction }
        : payload.frozenTransaction,
    };

    this.emit('transactionReceived', normalizedPayload);
  }

  /**
   * Emit event to registered handlers
   * @private
   */
  private emit<T extends EventName>(event: T, ...args: Parameters<EventHandler<T>>): void {
    const handler = this.eventHandlers[event];
    if (handler) {
      (handler as any)(...args);
    }
  }

  /**
   * Log message (if verbose mode enabled)
   * @private
   */
  private log(
    message: string,
    level: 'info' | 'success' | 'warning' | 'error' = 'info'
  ): void {
    if (!this.options.verbose) return;

    const styles = {
      info: 'color: #666',
      success: 'color: #22c55e',
      warning: 'color: #f59e0b',
      error: 'color: #ef4444',
    };

    console.log(`%c${message}`, styles[level]);
  }
}

export default BrowserSigningClient;
