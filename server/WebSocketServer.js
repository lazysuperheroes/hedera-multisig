/**
 * WebSocketServer
 *
 * Handles WebSocket connections for real-time multi-signature coordination.
 * Manages client connections, authentication, and message routing.
 */

const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const fs = require('fs');
const chalk = require('chalk');
const { normalizePublicKey, isKeyEligible } = require('./utils/keyUtils');
const { createLogger } = require('../shared/logger');
const { timerController } = require('../shared/TimerController');
const { ERROR_CODES } = require('../shared/protocol');

class MultiSigWebSocketServer {
  constructor(sessionManager, options = {}) {
    this.sessionManager = sessionManager;
    this.options = {
      port: options.port || 3000,
      host: options.host || 'localhost',
      verbose: options.verbose !== false,
      ...options
    };

    // Create logger instance for this server
    this.log = createLogger('WebSocketServer');

    this.server = null;
    this.wss = null;
    this.clients = new Map(); // participantId -> ws connection
    this.coordinatorClients = new Map(); // sessionId -> coordinator ws
    this.tunnel = null; // Tunnel instance (ngrok or localtunnel)
    this.tunnelType = null; // 'ngrok' or 'localtunnel'
    this.isSecure = false; // Whether TLS is enabled

    // TLS/SSL configuration
    // Options:
    //   tls.enabled: true to enable TLS
    //   tls.cert: Path to certificate file or PEM string
    //   tls.key: Path to private key file or PEM string
    //   tls.ca: (optional) Path to CA certificate file or PEM string
    //   tls.passphrase: (optional) Passphrase for private key
    this.tlsOptions = options.tls || null;

    // Rate limiting for AUTH attempts (prevents PIN brute force and griefing)
    this.authAttempts = new Map(); // IP -> { count, resetTime, blocked }
    this.authRateLimit = options.authRateLimit || {
      maxAttempts: 5,      // Max failed attempts per IP
      windowMs: 60000,     // 1 minute window
      blockDurationMs: 300000  // 5 minute block after too many failures
    };

    // Per-session rate limiting (SEC-11: prevents distributed brute force against a single session)
    this.sessionAuthAttempts = new Map(); // sessionId -> { count, resetTime }
    this.sessionRateLimit = options.sessionRateLimit || {
      maxAttempts: 20,     // Max failed attempts per session from all IPs
      windowMs: 300000     // 5 minute window
    };

    // Maximum concurrent sessions to prevent memory exhaustion (SEC-13)
    this.maxSessions = options.maxSessions || 100;

    // Allowed origins for WebSocket connections (SEC-12)
    this.allowedOrigins = options.allowedOrigins || null; // null = allow all (dev mode)

    // Heartbeat configuration for detecting dead connections
    this.heartbeatConfig = {
      interval: options.heartbeatInterval || 30000,  // Ping every 30 seconds
      timeout: options.heartbeatTimeout || 10000     // Wait 10 seconds for pong
    };
    this.heartbeatTimerId = null;

    // Cleanup expired rate limit entries every 10 minutes (using TimerController)
    this.rateLimitCleanupTimerId = timerController.setInterval(() => {
      const now = Date.now();
      for (const [ip, data] of this.authAttempts.entries()) {
        if (data.resetTime < now) {
          this.authAttempts.delete(ip);
        }
      }
    }, 600000, 'rate-limit-cleanup');
  }

  /**
   * Start WebSocket server
   *
   * @returns {Promise<Object>} Server information
   */
  async start() {
    return new Promise((resolve, reject) => {
      try {
        // Check if TLS is enabled
        this.isSecure = this.tlsOptions && this.tlsOptions.enabled;

        const requestHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end(`Hedera MultiSig Server${this.isSecure ? ' (Secure)' : ''}\n`);
        };

        if (this.isSecure) {
          // Load TLS certificates
          const tlsCreds = this._loadTlsCredentials();
          this.server = https.createServer(tlsCreds, requestHandler);
        } else {
          // Create HTTP server (non-secure)
          this.server = http.createServer(requestHandler);
        }

        // Create WebSocket server with optional origin validation (SEC-12)
        const wsOptions = { server: this.server };
        if (this.allowedOrigins) {
          wsOptions.verifyClient = (info) => {
            const origin = info.origin || info.req.headers.origin;
            if (!origin) return true; // Allow non-browser clients (CLI, agents)
            return this.allowedOrigins.includes(origin);
          };
        }
        this.wss = new WebSocket.Server(wsOptions);

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

          const protocol = this.isSecure ? 'wss' : 'ws';
          const url = `${protocol}://${displayHost}:${address.port}`;

          // Structured logging
          this.log.info('Server started', { host: displayHost, port: address.port, secure: this.isSecure, url });

          if (this.options.verbose) {
            console.log(chalk.bold.green('\n✅ WebSocket Server Started'));
            console.log(chalk.cyan('─'.repeat(50)));
            console.log(chalk.white('Host: ') + chalk.yellow(displayHost));
            console.log(chalk.white('Port: ') + chalk.yellow(address.port));
            console.log(chalk.white('Secure: ') + (this.isSecure
              ? chalk.green('Yes (TLS/WSS)')
              : chalk.yellow('No (WS)')));
            console.log(chalk.white('Local URL: ') + chalk.yellow(url));
            console.log(chalk.cyan('─'.repeat(50)) + '\n');
          }

          const result = {
            host: displayHost,
            port: address.port,
            url,
            publicUrl: null,
            isSecure: this.isSecure
          };

          // Start heartbeat for connection health monitoring
          this._startHeartbeat();

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

    // Stop heartbeat
    this._stopHeartbeat();

    // Clear rate limit cleanup interval via TimerController
    if (this.rateLimitCleanupTimerId) {
      timerController.clear(this.rateLimitCleanupTimerId);
      this.rateLimitCleanupTimerId = null;
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
  async broadcastToSession(sessionId, message, excludeParticipantId = null) {
    const sessionInfo = await this.sessionManager.getSessionInfo(sessionId);

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

    // Initialize heartbeat tracking
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

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
        // PERF-04: Validate message before parsing
        const validationError = this._validateRawMessage(data);
        if (validationError) {
          ws.send(JSON.stringify({
            type: 'ERROR',
            payload: { message: validationError }
          }));
          return;
        }

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
            await this._handleParticipantReady(sessionId, participantId, message);
            break;

          case 'STATUS_UPDATE':
            await this._handleStatusUpdate(sessionId, participantId, message);
            break;

          case 'SIGNATURE_SUBMIT':
            await this._handleSignatureSubmit(sessionId, participantId, message);
            break;

          case 'TRANSACTION_INJECT':
            await this._handleTransactionInject(sessionId, message);
            break;

          case 'TRANSACTION_REJECTED':
            await this._handleTransactionRejected(sessionId, participantId, message);
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
        this.log.error('Error handling message', { error: error.message, sessionId, participantId });
        console.error(chalk.red(`\n❌ Error handling message: ${error.message}\n`));
        ws.send(JSON.stringify({
          type: 'ERROR',
          payload: { message: error.message }
        }));
      }
    });

    // Handle disconnection
    ws.on('close', async () => {
      if (participantId) {
        this.clients.delete(participantId);
        await this.sessionManager.removeParticipant(sessionId, participantId);

        if (this.options.verbose) {
          console.log(chalk.yellow(`\n📴 Participant ${participantId} disconnected\n`));
        }

        // Notify others
        const disconnectStats = await this.sessionManager.store.getStats(sessionId);
        await this.broadcastToSession(sessionId, {
          type: 'PARTICIPANT_DISCONNECTED',
          payload: {
            participantId,
            stats: disconnectStats
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
  _recordFailedAuth(clientIp, attempts, sessionId = null) {
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

    // Track per-session failures (SEC-11)
    if (sessionId) {
      const sessionAttempts = this.sessionAuthAttempts.get(sessionId) || {
        count: 0,
        resetTime: now + this.sessionRateLimit.windowMs
      };
      sessionAttempts.count++;
      this.sessionAuthAttempts.set(sessionId, sessionAttempts);
    }
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
    const { sessionId, pin, role, label, publicKey, coordinatorToken, reconnectionToken } = message.payload;
    const clientIp = req.socket.remoteAddress;

    // Check rate limit
    let rateLimitAttempts;
    try {
      rateLimitAttempts = this._checkRateLimit(clientIp);
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'AUTH_FAILED',
        payload: { message: error.message, code: ERROR_CODES.AUTH_RATE_LIMITED, rateLimited: true }
      }));
      return;
    }

    // Check per-session rate limiting (SEC-11)
    if (sessionId && !reconnectionToken) {
      const sessionAttempts = this.sessionAuthAttempts.get(sessionId);
      if (sessionAttempts) {
        if (sessionAttempts.resetTime < Date.now()) {
          this.sessionAuthAttempts.delete(sessionId);
        } else if (sessionAttempts.count >= this.sessionRateLimit.maxAttempts) {
          ws.send(JSON.stringify({
            type: 'AUTH_FAILED',
            payload: { message: 'Too many failed authentication attempts for this session', code: ERROR_CODES.AUTH_RATE_LIMITED, rateLimited: true }
          }));
          return;
        }
      }
    }

    // Validate required fields (PIN or reconnection token required)
    if (!sessionId || (!pin && !reconnectionToken)) {
      this._recordFailedAuth(clientIp, rateLimitAttempts, sessionId);
      ws.send(JSON.stringify({
        type: 'AUTH_FAILED',
        payload: { message: 'Missing sessionId or authentication credentials', code: ERROR_CODES.AUTH_INVALID_CREDENTIALS }
      }));
      return;
    }

    const isCoordinator = role === 'coordinator';
    const isAgent = role === 'agent';
    let authenticated = false;
    let reconnectedParticipantId = null;

    if (reconnectionToken) {
      // Authenticate with reconnection token (returning participant)
      const result = await this.sessionManager.authenticateWithReconnectionToken(sessionId, reconnectionToken);
      authenticated = result.valid;
      reconnectedParticipantId = result.participantId;
    } else if (isCoordinator) {
      // Coordinator must provide coordinatorToken alongside PIN
      authenticated = await this.sessionManager.authenticateCoordinator(sessionId, pin, coordinatorToken);
    } else {
      // Standard participant auth with PIN
      authenticated = await this.sessionManager.authenticate(sessionId, pin);
    }

    if (!authenticated) {
      this._recordFailedAuth(clientIp, rateLimitAttempts, sessionId);
      ws.send(JSON.stringify({
        type: 'AUTH_FAILED',
        payload: {
          message: isCoordinator ? 'Invalid credentials or coordinator token' : 'Invalid session ID or PIN',
          code: isCoordinator ? ERROR_CODES.AUTH_COORDINATOR_TOKEN_INVALID : ERROR_CODES.AUTH_INVALID_CREDENTIALS
        }
      }));
      return;
    }

    // Enhanced validation for participants: Check public key eligibility if provided
    if (!isCoordinator && !isAgent && publicKey) {
      const sessionInfo = await this.sessionManager.getSessionInfo(sessionId);

      if (sessionInfo && sessionInfo.eligiblePublicKeys) {
        const isEligible = isKeyEligible(publicKey, sessionInfo.eligiblePublicKeys);

        if (!isEligible) {
          this._recordFailedAuth(clientIp, rateLimitAttempts, sessionId);
          ws.send(JSON.stringify({
            type: 'AUTH_FAILED',
            payload: {
              message: 'Public key is not eligible to sign this transaction. Please verify you are using the correct key.',
              code: ERROR_CODES.AUTH_KEY_NOT_ELIGIBLE,
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

      const sessionInfo = await this.sessionManager.getSessionInfo(sessionId);

      ws.send(JSON.stringify({
        type: 'AUTH_SUCCESS',
        payload: {
          role: 'coordinator',
          sessionInfo
        }
      }));

      this.log.info('Coordinator authenticated', { sessionId, clientIp });

      this.log.info('Coordinator authenticated', { sessionId, clientIp });
      if (this.options.verbose) {
        console.log(chalk.green(`✅ Coordinator authenticated for session ${sessionId}`));
      }

    } else {
      // Register participant or agent (or reconnect existing)
      let participantId;
      if (reconnectedParticipantId) {
        // Reconnecting participant - reuse existing ID
        participantId = reconnectedParticipantId;
        this.log.info('Participant reconnected', { sessionId, participantId, clientIp });
      } else {
        const result = await this.sessionManager.addParticipant(sessionId, {
          label,
          websocket: ws,
          isAgent
        });
        participantId = result.participantId;
      }

      this.clients.set(participantId, ws);
      callback(sessionId, participantId, false);

      // Generate reconnection token so client can reconnect without PIN
      const newReconnectionToken = await this.sessionManager.generateReconnectionToken(sessionId, participantId);

      const sessionInfo = await this.sessionManager.getSessionInfo(sessionId);

      const assignedRole = isAgent ? 'agent' : 'participant';

      // Send session info to participant (includes reconnectionToken, never includes PIN)
      ws.send(JSON.stringify({
        type: 'AUTH_SUCCESS',
        payload: {
          role: assignedRole,
          participantId,
          reconnectionToken: newReconnectionToken,
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

      this.log.info(`${isAgent ? 'Agent' : 'Participant'} authenticated`, { sessionId, participantId, label: label || 'anonymous', role: assignedRole, clientIp });
      if (this.options.verbose) {
        console.log(chalk.green(`✅ ${isAgent ? 'Agent' : 'Participant'} ${participantId} authenticated (${label || 'anonymous'})`));
      }

      // Notify coordinator and other participants
      const connectStats = await this.sessionManager.store.getStats(sessionId);
      await this.broadcastToSession(sessionId, {
        type: 'PARTICIPANT_CONNECTED',
        payload: {
          participantId,
          label,
          isAgent,
          stats: connectStats
        }
      }, participantId);
    }
  }

  /**
   * Handle status update from participant
   * @private
   */
  async _handleStatusUpdate(sessionId, participantId, message) {
    const { status } = message.payload;

    await this.sessionManager.updateParticipantStatus(sessionId, participantId, status);

    // Broadcast to session
    const statusStats = await this.sessionManager.store.getStats(sessionId);
    await this.broadcastToSession(sessionId, {
      type: 'PARTICIPANT_STATUS_UPDATE',
      payload: {
        participantId,
        status,
        stats: statusStats
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

      this.log.debug('Signature submitted', { sessionId, participantId, publicKeyPreview: '...' + publicKey.slice(-8) });

      const result = await this.sessionManager.submitSignature(
        sessionId,
        participantId,
        { publicKey, signature }
      );

      this.log.info('Signature accepted', {
        sessionId,
        participantId,
        signaturesCollected: result.signaturesCollected,
        signaturesRequired: result.signaturesRequired,
        thresholdMet: result.thresholdMet
      });

      // Confirm to participant
      this.sendToParticipant(participantId, {
        type: 'SIGNATURE_ACCEPTED',
        payload: result
      });

      // Broadcast to session
      const sigStats = await this.sessionManager.store.getStats(sessionId);
      await this.broadcastToSession(sessionId, {
        type: 'SIGNATURE_RECEIVED',
        payload: {
          participantId,
          publicKeyPreview: '...' + publicKey.slice(-8),
          stats: sigStats,
          thresholdMet: result.thresholdMet
        }
      });

      if (result.thresholdMet) {
        await this.broadcastToSession(sessionId, {
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
        payload: { message: error.message, code: error.code || ERROR_CODES.SIGNATURE_INVALID }
      });
    }
  }

  /**
   * Handle participant ready notification
   * @private
   */
  async _handleParticipantReady(sessionId, participantId, message) {
    try {
      // Mark participant as ready
      await this.sessionManager.setParticipantReady(sessionId, participantId);

      // Broadcast to session
      const readyStats = await this.sessionManager.store.getStats(sessionId);
      await this.broadcastToSession(sessionId, {
        type: 'PARTICIPANT_READY',
        payload: {
          participantId,
          stats: readyStats,
          allReady: await this.sessionManager.store.areAllParticipantsReady(sessionId)
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
      const { frozenTransaction, txDetails, metadata, contractInterface, abi } = message.payload;

      // Ensure ABI is JSON-serializable for transmission to participants.
      // ethers.js Interface objects do not survive JSON.stringify, so we extract
      // the ABI array for wire transmission. Recipients reconstruct the Interface.
      let serializableAbi = abi || null;
      if (!serializableAbi && contractInterface) {
        // Try to extract ABI fragments from ethers Interface object
        try {
          if (contractInterface.fragments) {
            serializableAbi = contractInterface.fragments.map(f =>
              typeof f.format === 'function' ? f.format('json') : JSON.stringify(f)
            );
          } else if (Array.isArray(contractInterface)) {
            serializableAbi = contractInterface;
          }
        } catch (e) {
          // Interface extraction failed — send without ABI
        }
      }

      // Normalize frozen transaction format at ingestion (PERF-03)
      const normalizedTx = this._normalizeFrozenTransaction(frozenTransaction);
      if (!normalizedTx) {
        throw new Error('Invalid frozen transaction format');
      }

      // Store in session via SessionStore
      const session = await this.sessionManager.store.getSession(sessionId);
      if (session) {
        // Clear any existing expiration timeout via TimerController
        if (session.expirationTimerId) {
          timerController.clear(session.expirationTimerId);
        }

        session.frozenTransaction = normalizedTx;
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
            session.expirationTimerId = timerController.setTimeout(async () => {
              await this._handleTransactionExpired(sessionId);
            }, timeUntilExpiry, `tx-expiry-${sessionId}`);

            if (this.options.verbose) {
              console.log(chalk.yellow(`⏱️  Transaction expires in ${Math.round(timeUntilExpiry / 1000)}s`));
            }
          } else {
            // Already expired
            await this._handleTransactionExpired(sessionId);
            return;
          }
        }
      }

      // Broadcast to all participants (use serializableAbi instead of contractInterface)
      // Include server timestamp so clients can compute clock offset for accurate countdown
      await this.broadcastToSession(sessionId, {
        type: 'TRANSACTION_RECEIVED',
        payload: {
          frozenTransaction,
          txDetails,
          metadata,
          abi: serializableAbi,
          serverTimestamp: Date.now()
        }
      });

      if (this.options.verbose) {
        console.log(chalk.green(`\n✅ Transaction injected and broadcast to session ${sessionId}\n`));
      }

    } catch (error) {
      this.sendToCoordinator(sessionId, {
        type: 'INJECTION_FAILED',
        payload: { message: error.message, code: error.code || ERROR_CODES.TRANSACTION_INJECTION_FAILED }
      });
    }
  }

  /**
   * Handle transaction expiration
   * @private
   */
  async _handleTransactionExpired(sessionId) {
    const session = await this.sessionManager.store.getSession(sessionId);

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
        await this.broadcastToSession(sessionId, {
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
  async _handleTransactionRejected(sessionId, participantId, message) {
    const { reason } = message.payload;

    // Update participant status
    await this.sessionManager.updateParticipantStatus(sessionId, participantId, 'rejected');

    // Broadcast rejection to session
    const rejectedStats = await this.sessionManager.store.getStats(sessionId);
    await this.broadcastToSession(sessionId, {
      type: 'TRANSACTION_REJECTED',
      payload: {
        participantId,
        reason,
        stats: rejectedStats
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
      await this.broadcastToSession(sessionId, {
        type: 'TRANSACTION_EXECUTED',
        payload: result
      });

    } catch (error) {
      this.sendToCoordinator(sessionId, {
        type: 'EXECUTION_FAILED',
        payload: { message: error.message, code: error.code || ERROR_CODES.TRANSACTION_EXECUTION_FAILED }
      });
    }
  }

  /**
   * Validate raw WebSocket message before JSON parsing (PERF-04)
   * @private
   * @param {Buffer} data - Raw message data
   * @returns {string|null} Error message or null if valid
   */
  _validateRawMessage(data) {
    // Check size limits
    const MAX_MESSAGE_SIZE = 5 * 1024 * 1024; // 5MB max (transactions can be large)
    const size = data.length;

    if (size > MAX_MESSAGE_SIZE) {
      this.log.warn('Message rejected: too large', { size, max: MAX_MESSAGE_SIZE });
      return `Message too large: ${size} bytes (max: ${MAX_MESSAGE_SIZE})`;
    }

    if (size === 0) {
      return 'Empty message received';
    }

    // Quick structure validation (avoid full parse for malformed data)
    const str = data.toString('utf8', 0, Math.min(100, size));
    const trimmed = str.trim();

    if (!trimmed.startsWith('{')) {
      return 'Invalid message format: expected JSON object';
    }

    // Check for type field presence (quick heuristic check)
    if (!str.includes('"type"')) {
      return 'Invalid message format: missing "type" field';
    }

    return null; // Valid
  }

  /**
   * Normalize frozen transaction to standard format (PERF-03)
   * Ensures consistent format: { bytes: Buffer, base64: string }
   * @private
   */
  _normalizeFrozenTransaction(frozenTransaction) {
    if (!frozenTransaction) {
      return null;
    }

    let bytes;
    let base64;

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
    }
    // Format 3: Object with bytes property only
    else if (frozenTransaction.bytes) {
      bytes = Buffer.from(frozenTransaction.bytes);
      base64 = bytes.toString('base64');
    }
    else {
      return null;
    }

    return { bytes, base64 };
  }

  /**
   * Start heartbeat ping/pong cycle for connection health monitoring
   * @private
   */
  _startHeartbeat() {
    if (this.heartbeatTimerId) {
      return; // Already running
    }

    this.heartbeatTimerId = timerController.setInterval(() => {
      this._sendHeartbeats();
    }, this.heartbeatConfig.interval, 'ws-heartbeat');

    this.log.debug('Heartbeat started', {
      interval: this.heartbeatConfig.interval,
      timeout: this.heartbeatConfig.timeout
    });
  }

  /**
   * Stop heartbeat cycle
   * @private
   */
  _stopHeartbeat() {
    if (this.heartbeatTimerId) {
      timerController.clear(this.heartbeatTimerId);
      this.heartbeatTimerId = null;
    }
  }

  /**
   * Send ping to all connected clients and check for dead connections
   * @private
   */
  _sendHeartbeats() {
    if (!this.wss) {
      return;
    }

    const now = Date.now();

    this.wss.clients.forEach((ws) => {
      // Check if client missed last heartbeat (didn't respond to ping)
      if (ws.isAlive === false) {
        this.log.warn('Client failed heartbeat, terminating', {
          readyState: ws.readyState
        });
        return ws.terminate();
      }

      // Mark as pending response and send ping
      ws.isAlive = false;
      ws.ping();
    });
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
   * Load TLS credentials from files or PEM strings
   * @private
   * @returns {Object} TLS credentials for https.createServer
   */
  _loadTlsCredentials() {
    if (!this.tlsOptions) {
      throw new Error('TLS options not configured');
    }

    const { cert, key, ca, passphrase } = this.tlsOptions;

    if (!cert || !key) {
      throw new Error('TLS requires both cert and key options');
    }

    const credentials = {};

    // Load certificate (file path or PEM string)
    if (cert.includes('-----BEGIN')) {
      credentials.cert = cert;
    } else {
      credentials.cert = fs.readFileSync(cert);
    }

    // Load private key (file path or PEM string)
    if (key.includes('-----BEGIN')) {
      credentials.key = key;
    } else {
      credentials.key = fs.readFileSync(key);
    }

    // Load CA certificate if provided (file path or PEM string)
    if (ca) {
      if (ca.includes('-----BEGIN')) {
        credentials.ca = ca;
      } else {
        credentials.ca = fs.readFileSync(ca);
      }
    }

    // Add passphrase if provided
    if (passphrase) {
      credentials.passphrase = passphrase;
    }

    return credentials;
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
