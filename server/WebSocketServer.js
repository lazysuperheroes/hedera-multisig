/**
 * WebSocketServer
 *
 * Handles WebSocket connections for real-time multi-signature coordination.
 * Manages client connections, authentication, and message routing.
 */

const WebSocket = require('ws');
const http = require('http');
const chalk = require('chalk');

/**
 * Normalize a public key to ensure consistent 0x prefix
 */
function normalizePublicKey(key) {
  if (!key) return key;
  const trimmed = key.trim();
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

/**
 * Check if a public key is in the eligible list (handles 0x prefix variations)
 */
function isKeyEligible(key, eligibleKeys) {
  if (!key || !eligibleKeys || eligibleKeys.length === 0) return false;
  const normalizedKey = normalizePublicKey(key);
  return eligibleKeys.some(eligible => normalizePublicKey(eligible) === normalizedKey);
}

class MultiSigWebSocketServer {
  constructor(sessionManager, options = {}) {
    this.sessionManager = sessionManager;
    this.options = {
      port: options.port || 3000,
      host: options.host || 'localhost',
      verbose: options.verbose !== false,
      ...options
    };

    this.server = null;
    this.wss = null;
    this.clients = new Map(); // participantId -> ws connection
    this.coordinatorClients = new Map(); // sessionId -> coordinator ws
    this.tunnel = null; // Tunnel instance (ngrok or localtunnel)
    this.tunnelType = null; // 'ngrok' or 'localtunnel'

    // Rate limiting for AUTH attempts (prevents PIN brute force and griefing)
    this.authAttempts = new Map(); // IP -> { count, resetTime, blocked }
    this.authRateLimit = options.authRateLimit || {
      maxAttempts: 5,      // Max failed attempts
      windowMs: 60000,     // 1 minute window
      blockDurationMs: 300000  // 5 minute block after too many failures
    };

    // Cleanup expired rate limit entries every 10 minutes
    this.rateLimitCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [ip, data] of this.authAttempts.entries()) {
        if (data.resetTime < now) {
          this.authAttempts.delete(ip);
        }
      }
    }, 600000);
  }

  /**
   * Start WebSocket server
   *
   * @returns {Promise<Object>} Server information
   */
  async start() {
    return new Promise((resolve, reject) => {
      try {
        // Create HTTP server
        this.server = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Hedera MultiSig Server\n');
        });

        // Create WebSocket server
        this.wss = new WebSocket.Server({ server: this.server });

        // Handle connections
        this.wss.on('connection', (ws, req) => {
          this._handleConnection(ws, req);
        });

        // Start listening
        this.server.listen(this.options.port, this.options.host, async () => {
          const address = this.server.address();

          // Convert IPv6 addresses to user-friendly format
          let displayHost = address.address;
          if (displayHost === '::1' || displayHost === '::') {
            // IPv6 localhost → use 'localhost' for clarity
            displayHost = 'localhost';
          } else if (displayHost === '0.0.0.0') {
            // All interfaces → show as localhost for local connections
            displayHost = 'localhost';
          }

          const url = `ws://${displayHost}:${address.port}`;

          if (this.options.verbose) {
            console.log(chalk.bold.green('\n✅ WebSocket Server Started'));
            console.log(chalk.cyan('─'.repeat(50)));
            console.log(chalk.white('Host: ') + chalk.yellow(displayHost));
            console.log(chalk.white('Port: ') + chalk.yellow(address.port));
            console.log(chalk.white('Local URL: ') + chalk.yellow(url));
            console.log(chalk.cyan('─'.repeat(50)) + '\n');
          }

          const result = {
            host: displayHost,
            port: address.port,
            url,
            publicUrl: null
          };

          // Start tunnel if enabled
          if (this.options.tunnel && this.options.tunnel.enabled) {
            try {
              const publicUrl = await this._startTunnel(address.port);
              result.publicUrl = publicUrl;

              if (this.options.verbose) {
                console.log(chalk.bold.green('✅ Tunnel Established'));
                console.log(chalk.cyan('─'.repeat(50)));
                console.log(chalk.white('Public URL: ') + chalk.yellow(publicUrl));
                console.log(chalk.white('Tunnel Type: ') + chalk.yellow(this.tunnelType));
                console.log(chalk.cyan('─'.repeat(50)) + '\n');
              }
            } catch (error) {
              if (this.options.verbose) {
                console.log(chalk.yellow('⚠️  Tunnel failed:'), error.message);
                console.log(chalk.yellow('   Continuing with local-only access\n'));
              }
            }
          }

          resolve(result);
        });

        this.server.on('error', (error) => {
          reject(error);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop WebSocket server
   */
  async stop() {
    // Stop tunnel first
    await this._stopTunnel();

    // Clear rate limit cleanup interval
    if (this.rateLimitCleanupInterval) {
      clearInterval(this.rateLimitCleanupInterval);
    }

    return new Promise((resolve) => {
      if (this.wss) {
        // Close all client connections
        this.wss.clients.forEach((ws) => {
          ws.close();
        });

        this.wss.close(() => {
          if (this.options.verbose) {
            console.log(chalk.yellow('\n⚠️  WebSocket Server Stopped\n'));
          }
        });
      }

      if (this.server) {
        this.server.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Broadcast message to all participants in a session
   *
   * @param {string} sessionId - Session identifier
   * @param {Object} message - Message to broadcast
   * @param {string} excludeParticipantId - Optional participant to exclude
   */
  broadcastToSession(sessionId, message, excludeParticipantId = null) {
    const sessionInfo = this.sessionManager.getSessionInfo(sessionId);

    if (!sessionInfo) {
      return;
    }

    // Send to all participants
    for (const participant of sessionInfo.participants) {
      if (participant.participantId !== excludeParticipantId) {
        const ws = this.clients.get(participant.participantId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      }
    }

    // Send to coordinator if connected
    const coordinatorWs = this.coordinatorClients.get(sessionId);
    if (coordinatorWs && coordinatorWs.readyState === WebSocket.OPEN) {
      coordinatorWs.send(JSON.stringify(message));
    }
  }

  /**
   * Send message to coordinator
   *
   * @param {string} sessionId - Session identifier
   * @param {Object} message - Message to send
   */
  sendToCoordinator(sessionId, message) {
    const coordinatorWs = this.coordinatorClients.get(sessionId);
    if (coordinatorWs && coordinatorWs.readyState === WebSocket.OPEN) {
      coordinatorWs.send(JSON.stringify(message));
    }
  }

  /**
   * Send message to specific participant
   *
   * @param {string} participantId - Participant identifier
   * @param {Object} message - Message to send
   */
  sendToParticipant(participantId, message) {
    const ws = this.clients.get(participantId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Handle new WebSocket connection
   * @private
   */
  _handleConnection(ws, req) {
    let participantId = null;
    let sessionId = null;
    let isCoordinator = false;

    if (this.options.verbose) {
      // Format IP address for display (convert IPv6 localhost to friendly format)
      let displayAddress = req.socket.remoteAddress;
      if (displayAddress === '::1' || displayAddress === '::ffff:127.0.0.1') {
        displayAddress = 'localhost';
      } else if (displayAddress?.startsWith('::ffff:')) {
        // Strip IPv6-mapped IPv4 prefix
        displayAddress = displayAddress.replace('::ffff:', '');
      }
      console.log(chalk.cyan(`\n📡 New connection from ${displayAddress}`));
    }

    // Handle messages from client
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (this.options.verbose) {
          console.log(chalk.gray(`📨 Received: ${message.type}`));
        }

        switch (message.type) {
          case 'AUTH':
            await this._handleAuth(ws, req, message, (sid, pid, isCoord) => {
              sessionId = sid;
              participantId = pid;
              isCoordinator = isCoord;
            });
            break;

          case 'PARTICIPANT_READY':
            this._handleParticipantReady(sessionId, participantId, message);
            break;

          case 'STATUS_UPDATE':
            this._handleStatusUpdate(sessionId, participantId, message);
            break;

          case 'SIGNATURE_SUBMIT':
            await this._handleSignatureSubmit(sessionId, participantId, message);
            break;

          case 'TRANSACTION_INJECT':
            await this._handleTransactionInject(sessionId, message);
            break;

          case 'TRANSACTION_REJECTED':
            this._handleTransactionRejected(sessionId, participantId, message);
            break;

          case 'EXECUTE_TRANSACTION':
            await this._handleExecuteTransaction(sessionId, message);
            break;

          case 'PING':
            ws.send(JSON.stringify({ type: 'PONG' }));
            break;

          default:
            ws.send(JSON.stringify({
              type: 'ERROR',
              payload: { message: `Unknown message type: ${message.type}` }
            }));
        }

      } catch (error) {
        console.error(chalk.red(`\n❌ Error handling message: ${error.message}\n`));
        ws.send(JSON.stringify({
          type: 'ERROR',
          payload: { message: error.message }
        }));
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      if (participantId) {
        this.clients.delete(participantId);
        this.sessionManager.removeParticipant(sessionId, participantId);

        if (this.options.verbose) {
          console.log(chalk.yellow(`\n📴 Participant ${participantId} disconnected\n`));
        }

        // Notify others
        this.broadcastToSession(sessionId, {
          type: 'PARTICIPANT_DISCONNECTED',
          payload: {
            participantId,
            stats: this.sessionManager.store.getStats(sessionId)
          }
        });
      }

      if (isCoordinator && sessionId) {
        this.coordinatorClients.delete(sessionId);

        if (this.options.verbose) {
          console.log(chalk.yellow(`\n📴 Coordinator disconnected from session ${sessionId}\n`));
        }
      }
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(chalk.red(`\n❌ WebSocket error: ${error.message}\n`));
    });
  }

  /**
   * Check rate limit for AUTH attempts
   * @private
   */
  _checkRateLimit(clientIp) {
    const now = Date.now();
    const attempts = this.authAttempts.get(clientIp) || {
      count: 0,
      resetTime: now + this.authRateLimit.windowMs,
      blocked: false,
      blockUntil: null
    };

    // Check if currently blocked
    if (attempts.blocked && attempts.blockUntil > now) {
      const remainingSeconds = Math.ceil((attempts.blockUntil - now) / 1000);
      throw new Error(
        `Too many authentication attempts. Please try again in ${remainingSeconds} seconds.`
      );
    }

    // Reset if window expired
    if (attempts.resetTime < now) {
      attempts.count = 0;
      attempts.resetTime = now + this.authRateLimit.windowMs;
      attempts.blocked = false;
      attempts.blockUntil = null;
    }

    return attempts;
  }

  /**
   * Record failed AUTH attempt
   * @private
   */
  _recordFailedAuth(clientIp, attempts) {
    const now = Date.now();
    attempts.count++;

    // Block if exceeded max attempts
    if (attempts.count >= this.authRateLimit.maxAttempts) {
      attempts.blocked = true;
      attempts.blockUntil = now + this.authRateLimit.blockDurationMs;

      if (this.options.verbose) {
        console.log(chalk.yellow(
          `⚠️  Client ${clientIp} blocked for ${this.authRateLimit.blockDurationMs / 1000}s (too many failed AUTH attempts)`
        ));
      }
    }

    this.authAttempts.set(clientIp, attempts);
  }

  /**
   * Record successful AUTH attempt
   * @private
   */
  _recordSuccessfulAuth(clientIp) {
    // Clear rate limit on successful auth
    this.authAttempts.delete(clientIp);
  }

  /**
   * Handle authentication
   * Enhanced with rate limiting and optional public key validation
   * @private
   */
  async _handleAuth(ws, req, message, callback) {
    const { sessionId, pin, role, label, publicKey } = message.payload;
    const clientIp = req.socket.remoteAddress;

    // Check rate limit
    try {
      var rateLimitAttempts = this._checkRateLimit(clientIp);
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'AUTH_FAILED',
        payload: { message: error.message, rateLimited: true }
      }));
      return;
    }

    // Validate required fields
    if (!sessionId || !pin) {
      this._recordFailedAuth(clientIp, rateLimitAttempts);
      ws.send(JSON.stringify({
        type: 'AUTH_FAILED',
        payload: { message: 'Missing sessionId or pin' }
      }));
      return;
    }

    // Authenticate with session manager
    const authenticated = this.sessionManager.authenticate(sessionId, pin);

    if (!authenticated) {
      this._recordFailedAuth(clientIp, rateLimitAttempts);
      ws.send(JSON.stringify({
        type: 'AUTH_FAILED',
        payload: { message: 'Invalid session ID or PIN' }
      }));
      return;
    }

    const isCoordinator = role === 'coordinator';

    // Enhanced validation for participants: Check public key eligibility if provided
    if (!isCoordinator && publicKey) {
      const sessionInfo = this.sessionManager.getSessionInfo(sessionId);

      if (sessionInfo && sessionInfo.eligiblePublicKeys) {
        const isEligible = isKeyEligible(publicKey, sessionInfo.eligiblePublicKeys);

        if (!isEligible) {
          this._recordFailedAuth(clientIp, rateLimitAttempts);
          ws.send(JSON.stringify({
            type: 'AUTH_FAILED',
            payload: {
              message: 'Public key is not eligible to sign this transaction. Please verify you are using the correct key.',
              publicKeyRejected: true
            }
          }));

          if (this.options.verbose) {
            console.log(chalk.yellow(
              `⚠️  Participant rejected: Public key not eligible (${publicKey.slice(0, 20)}...)`
            ));
          }

          return;
        }
      }
    }

    // Authentication successful - clear rate limit
    this._recordSuccessfulAuth(clientIp);

    if (isCoordinator) {
      // Register coordinator
      this.coordinatorClients.set(sessionId, ws);
      callback(sessionId, null, true);

      const sessionInfo = this.sessionManager.getSessionInfo(sessionId);

      ws.send(JSON.stringify({
        type: 'AUTH_SUCCESS',
        payload: {
          role: 'coordinator',
          sessionInfo
        }
      }));

      if (this.options.verbose) {
        console.log(chalk.green(`✅ Coordinator authenticated for session ${sessionId}`));
      }

    } else {
      // Register participant
      const { participantId } = this.sessionManager.addParticipant(sessionId, {
        label,
        websocket: ws
      });

      this.clients.set(participantId, ws);
      callback(sessionId, participantId, false);

      const sessionInfo = this.sessionManager.getSessionInfo(sessionId);

      // Send session info to participant
      ws.send(JSON.stringify({
        type: 'AUTH_SUCCESS',
        payload: {
          role: 'participant',
          participantId,
          sessionInfo: {
            sessionId: sessionInfo.sessionId,
            status: sessionInfo.status,
            frozenTransaction: sessionInfo.txDetails?.frozenTransaction || sessionInfo.txDetails,
            txDetails: sessionInfo.txDetails,
            threshold: sessionInfo.threshold,
            eligiblePublicKeys: sessionInfo.eligiblePublicKeys,
            expectedParticipants: sessionInfo.stats.participantsExpected,
            stats: sessionInfo.stats
          }
        }
      }));

      if (this.options.verbose) {
        console.log(chalk.green(`✅ Participant ${participantId} authenticated (${label || 'anonymous'})`));
      }

      // Notify coordinator and other participants
      this.broadcastToSession(sessionId, {
        type: 'PARTICIPANT_CONNECTED',
        payload: {
          participantId,
          label,
          stats: this.sessionManager.store.getStats(sessionId)
        }
      }, participantId);
    }
  }

  /**
   * Handle status update from participant
   * @private
   */
  _handleStatusUpdate(sessionId, participantId, message) {
    const { status } = message.payload;

    this.sessionManager.updateParticipantStatus(sessionId, participantId, status);

    // Broadcast to session
    this.broadcastToSession(sessionId, {
      type: 'PARTICIPANT_STATUS_UPDATE',
      payload: {
        participantId,
        status,
        stats: this.sessionManager.store.getStats(sessionId)
      }
    });
  }

  /**
   * Handle signature submission
   * @private
   */
  async _handleSignatureSubmit(sessionId, participantId, message) {
    try {
      const { publicKey, signature } = message.payload;

      const result = await this.sessionManager.submitSignature(
        sessionId,
        participantId,
        { publicKey, signature }
      );

      // Confirm to participant
      this.sendToParticipant(participantId, {
        type: 'SIGNATURE_ACCEPTED',
        payload: result
      });

      // Broadcast to session
      this.broadcastToSession(sessionId, {
        type: 'SIGNATURE_RECEIVED',
        payload: {
          participantId,
          publicKeyPreview: '...' + publicKey.slice(-8),
          stats: this.sessionManager.store.getStats(sessionId),
          thresholdMet: result.thresholdMet
        }
      });

      if (result.thresholdMet) {
        this.broadcastToSession(sessionId, {
          type: 'THRESHOLD_MET',
          payload: {
            signaturesCollected: result.signaturesCollected,
            signaturesRequired: result.signaturesRequired
          }
        });
      }

    } catch (error) {
      this.sendToParticipant(participantId, {
        type: 'SIGNATURE_REJECTED',
        payload: { message: error.message }
      });
    }
  }

  /**
   * Handle participant ready notification
   * @private
   */
  _handleParticipantReady(sessionId, participantId, message) {
    try {
      // Mark participant as ready
      this.sessionManager.setParticipantReady(sessionId, participantId);

      // Broadcast to session
      this.broadcastToSession(sessionId, {
        type: 'PARTICIPANT_READY',
        payload: {
          participantId,
          stats: this.sessionManager.store.getStats(sessionId),
          allReady: this.sessionManager.store.areAllParticipantsReady(sessionId)
        }
      });

    } catch (error) {
      this.sendToParticipant(participantId, {
        type: 'ERROR',
        payload: { message: error.message }
      });
    }
  }

  /**
   * Handle transaction injection request (from coordinator)
   * @private
   */
  async _handleTransactionInject(sessionId, message) {
    try {
      const { frozenTransaction, txDetails, metadata, contractInterface } = message.payload;

      // Transaction should be passed as bytes from coordinator
      // Reconstruct from bytes (coordinator already has Transaction object)
      // For now, we expect the coordinator to serialize and send txDetails

      // Store in session via SessionStore
      const session = this.sessionManager.store.getSession(sessionId);
      if (session) {
        // Clear any existing expiration timeout
        if (session.expirationTimeout) {
          clearTimeout(session.expirationTimeout);
        }

        session.frozenTransaction = frozenTransaction;
        session.txDetails = txDetails;
        session.status = 'transaction-received';
        session.transactionReceivedAt = Date.now();

        // Calculate expiration time from txDetails
        // txDetails should contain validStartTimestamp and transactionValidDuration
        // IMPORTANT: Store transaction expiration separately from session expiration
        if (txDetails && txDetails.validStartTimestamp) {
          const validDuration = txDetails.transactionValidDuration || 120;
          const txExpiresAt = txDetails.validStartTimestamp + validDuration;
          session.transactionExpiresAt = txExpiresAt; // Separate from session.expiresAt

          // Set up expiration timeout
          const now = Math.floor(Date.now() / 1000);
          const timeUntilExpiry = (txExpiresAt - now) * 1000;

          if (timeUntilExpiry > 0) {
            session.expirationTimeout = setTimeout(() => {
              this._handleTransactionExpired(sessionId);
            }, timeUntilExpiry);

            if (this.options.verbose) {
              console.log(chalk.yellow(`⏱️  Transaction expires in ${Math.round(timeUntilExpiry / 1000)}s`));
            }
          } else {
            // Already expired
            this._handleTransactionExpired(sessionId);
            return;
          }
        }
      }

      // Broadcast to all participants
      this.broadcastToSession(sessionId, {
        type: 'TRANSACTION_RECEIVED',
        payload: {
          frozenTransaction,
          txDetails,
          metadata,
          contractInterface
        }
      });

      if (this.options.verbose) {
        console.log(chalk.green(`\n✅ Transaction injected and broadcast to session ${sessionId}\n`));
      }

    } catch (error) {
      this.sendToCoordinator(sessionId, {
        type: 'INJECTION_FAILED',
        payload: { message: error.message }
      });
    }
  }

  /**
   * Handle transaction expiration
   * @private
   */
  _handleTransactionExpired(sessionId) {
    const session = this.sessionManager.store.getSession(sessionId);

    if (session && session.status !== 'completed') {
      // Transaction expired, but session is still valid
      // Reset to 'waiting' so a new transaction can be injected
      const wasExpired = session.status === 'transaction-expired';

      if (!wasExpired) {
        session.status = 'transaction-expired';

        if (this.options.verbose) {
          console.log(chalk.red(`\n⏱️  Transaction expired for session ${sessionId}\n`));
          console.log(chalk.yellow(`   Session remains active - can inject new transaction\n`));
        }

        // Broadcast to all participants
        this.broadcastToSession(sessionId, {
          type: 'TRANSACTION_EXPIRED',
          payload: {
            sessionId,
            message: 'Transaction has expired and can no longer be signed'
          }
        });

        // Notify coordinator
        this.sendToCoordinator(sessionId, {
          type: 'TRANSACTION_EXPIRED',
          payload: {
            sessionId,
            message: 'Transaction has expired'
          }
        });

        // Clear the transaction from session but keep session alive
        session.frozenTransaction = null;
        session.txDetails = null;
        session.transactionExpiresAt = null;

        // Clear any collected signatures (they're for the expired transaction)
        session.signatures.clear();
        session.stats.signaturesCollected = 0;

        // Reset to waiting so a new transaction can be injected
        session.status = 'waiting';
      }
    }
  }

  /**
   * Handle transaction rejection from participant
   * @private
   */
  _handleTransactionRejected(sessionId, participantId, message) {
    const { reason } = message.payload;

    // Update participant status
    this.sessionManager.updateParticipantStatus(sessionId, participantId, 'rejected');

    // Broadcast rejection to session
    this.broadcastToSession(sessionId, {
      type: 'TRANSACTION_REJECTED',
      payload: {
        participantId,
        reason,
        stats: this.sessionManager.store.getStats(sessionId)
      }
    });

    if (this.options.verbose) {
      console.log(chalk.yellow(`\n⚠️  Participant ${participantId} rejected transaction: ${reason}\n`));
    }
  }

  /**
   * Handle transaction execution request
   * @private
   */
  async _handleExecuteTransaction(sessionId, message) {
    try {
      const result = await this.sessionManager.executeTransaction(sessionId);

      // Broadcast to session
      this.broadcastToSession(sessionId, {
        type: 'TRANSACTION_EXECUTED',
        payload: result
      });

    } catch (error) {
      this.sendToCoordinator(sessionId, {
        type: 'EXECUTION_FAILED',
        payload: { message: error.message }
      });
    }
  }

  /**
   * Start tunnel (ngrok or localtunnel)
   * @private
   */
  async _startTunnel(port) {
    const provider = this.options.tunnel.provider || 'auto';

    if (provider === 'auto') {
      // Try ngrok first, fallback to localtunnel
      try {
        return await this._startNgrokTunnel(port);
      } catch (error) {
        if (this.options.verbose) {
          console.log(chalk.yellow('  ngrok unavailable, trying localtunnel...'));
        }
        return await this._startLocaltunnel(port);
      }
    } else if (provider === 'ngrok') {
      return await this._startNgrokTunnel(port);
    } else if (provider === 'localtunnel') {
      return await this._startLocaltunnel(port);
    } else {
      throw new Error(`Unknown tunnel provider: ${provider}`);
    }
  }

  /**
   * Start ngrok tunnel
   * @private
   */
  async _startNgrokTunnel(port) {
    const ngrok = require('ngrok');

    const authtoken = this.options.tunnel.authToken || process.env.NGROK_AUTH_TOKEN;
    const subdomain = this.options.tunnel.subdomain;

    const ngrokOptions = {
      addr: port,
      proto: 'http'
    };

    if (authtoken) {
      ngrokOptions.authtoken = authtoken;
    }

    if (subdomain) {
      ngrokOptions.subdomain = subdomain;
    }

    try {
      const url = await ngrok.connect(ngrokOptions);
      this.tunnel = ngrok;
      this.tunnelType = 'ngrok';

      // Convert http to ws
      const wsUrl = url.replace('https://', 'wss://').replace('http://', 'ws://');
      return wsUrl;
    } catch (error) {
      throw new Error(`ngrok failed: ${error.message}`);
    }
  }

  /**
   * Start localtunnel
   * @private
   */
  async _startLocaltunnel(port) {
    const localtunnel = require('localtunnel');

    const subdomain = this.options.tunnel.subdomain;

    const ltOptions = {
      port: port
    };

    if (subdomain) {
      ltOptions.subdomain = subdomain;
    }

    try {
      const tunnel = await localtunnel(ltOptions);
      this.tunnel = tunnel;
      this.tunnelType = 'localtunnel';

      tunnel.on('error', (err) => {
        if (this.options.verbose) {
          console.error(chalk.red('Tunnel error:'), err.message);
        }
      });

      tunnel.on('close', () => {
        if (this.options.verbose) {
          console.log(chalk.yellow('Tunnel closed'));
        }
      });

      // Convert http to ws
      const wsUrl = tunnel.url.replace('https://', 'wss://').replace('http://', 'ws://');
      return wsUrl;
    } catch (error) {
      throw new Error(`localtunnel failed: ${error.message}`);
    }
  }

  /**
   * Stop tunnel
   * @private
   */
  async _stopTunnel() {
    if (!this.tunnel) {
      return;
    }

    try {
      if (this.tunnelType === 'ngrok') {
        const ngrok = require('ngrok');
        await ngrok.disconnect();
        await ngrok.kill();
      } else if (this.tunnelType === 'localtunnel') {
        this.tunnel.close();
      }

      if (this.options.verbose) {
        console.log(chalk.yellow('✅ Tunnel closed'));
      }
    } catch (error) {
      if (this.options.verbose) {
        console.error(chalk.red('Error closing tunnel:'), error.message);
      }
    }

    this.tunnel = null;
    this.tunnelType = null;
  }
}

module.exports = MultiSigWebSocketServer;
