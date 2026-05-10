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
const { TransactionDecoder: SharedDecoder, getTransactionTypeName } = require('../shared/transaction-decoder');

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

    // Rate limiting for AUTH attempts (prevents PIN brute force and griefing).
    //
    // maxAttempts=12: a 7-signer ceremony where every participant fat-fingers the
    // PIN twice = 14 attempts; behind a single corporate NAT all participants share
    // one source IP, so the previous limit of 5 self-DoS'd legitimate office teams.
    // Per-session limit (sessionRateLimit) is the primary brute-force gate; per-IP
    // is a softer griefing mitigation.
    this.authAttempts = new Map(); // IP -> { count, resetTime, blocked }
    this.authRateLimit = options.authRateLimit || {
      maxAttempts: 12,     // Max failed attempts per IP (was 5; bumped for corporate-NAT scenario)
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

    // Allowed origins for WebSocket connections (SEC-12 + Phase B3 hardening).
    //
    // - `allowedOrigins: ['https://multisig.example.com']` (recommended for production)
    // - `unsafeAnyOrigin: true` — allow any origin (explicit dev-mode opt-in only)
    // - `allowedOrigins` unset and `unsafeAnyOrigin` unset → CLI/agent connections
    //   (no Origin header) accepted; browser connections rejected. This is the safe
    //   default for self-hosted CLI ceremonies and prevents drive-by browser
    //   connections to a coordinator's local server.
    //
    // Tunnel mode (--tunnel) without an explicit allowlist is rejected at start
    // time below — public URL + permissive origins is the highest-risk combo.
    this.unsafeAnyOrigin = options.unsafeAnyOrigin === true;
    this.allowedOrigins = Array.isArray(options.allowedOrigins) ? options.allowedOrigins : null;

    // Heartbeat configuration for detecting dead connections
    this.heartbeatConfig = {
      interval: options.heartbeatInterval || 30000,  // Ping every 30 seconds
      timeout: options.heartbeatTimeout || 10000     // Wait 10 seconds for pong
    };
    this.heartbeatTimerId = null;

    // Phase C7: server start time for uptime reporting via /healthz
    this.startedAt = Date.now();

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

        // Phase C7: HTTP endpoints for operators monitoring tunnels and self-hosted
        // deployments. /healthz returns JSON; /version returns the package version.
        // The default response (any other path) keeps the existing plain-text banner
        // so existing health-check infrastructure that just looks for HTTP 200 still
        // works.
        const pkg = (() => {
          try { return require('../package.json'); } catch { return { version: 'unknown' }; }
        })();
        const requestHandler = (req, res) => {
          const url = (req.url || '/').split('?')[0];
          if (url === '/healthz' || url === '/health') {
            const sessionCount = this.sessionManager?.store?.sessions?.size ?? null;
            const body = {
              status: 'ok',
              uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
              version: pkg.version,
              sessionCount,
              secure: !!this.isSecure,
            };
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store'
            });
            res.end(JSON.stringify(body));
            return;
          }
          if (url === '/version') {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store'
            });
            res.end(JSON.stringify({ version: pkg.version, name: pkg.name || '@lazysuperheroes/hedera-multisig' }));
            return;
          }
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

        // Create WebSocket server with origin validation (SEC-12 + Phase B3).
        //
        // Tunnel mode without an explicit allowlist is unsafe (public URL +
        // permissive origins) — fail fast with a clear error.
        const tunnelEnabled = !!(this.options.tunnel && this.options.tunnel.enabled);
        if (tunnelEnabled && !this.unsafeAnyOrigin && (!this.allowedOrigins || this.allowedOrigins.length === 0)) {
          return reject(new Error(
            'Tunnel mode requires an explicit --allowed-origins list ' +
            '(or --unsafe-any-origin for development only). ' +
            'A public tunnel URL with permissive origins lets any web page connect to your coordinator.'
          ));
        }

        const wsOptions = { server: this.server };
        wsOptions.verifyClient = (info) => {
          const origin = info.origin || info.req.headers.origin;
          if (!origin) return true; // Non-browser clients (CLI, agents) — no Origin header
          if (this.unsafeAnyOrigin) return true; // Explicit dev opt-in
          if (Array.isArray(this.allowedOrigins) && this.allowedOrigins.length > 0) {
            if (this.allowedOrigins.includes(origin)) return true;
            // Match failed. The two most common causes are trailing
            // slashes ('http://localhost:3000/' vs 'http://localhost:3000')
            // and missing port ('http://localhost' when the browser sent
            // 'http://localhost:3000' because Next.js dev server is on
            // port 3000). Log both sides so the operator can see exactly
            // what the browser sent vs what we accept — no more silent
            // connection drops.
            this.log.warn(
              'Rejected browser connection: origin not in allow-list',
              {
                received: origin,
                allowed: this.allowedOrigins,
                hint:
                  'Origin headers never have trailing slashes and always include the port (unless the scheme default — 80 for http, 443 for https). Browser sends scheme://host:port verbatim. For Next.js dev on port 3000: --allowed-origins "http://localhost:3000,http://127.0.0.1:3000".',
              }
            );
            return false;
          }
          // Default deny for browser-origin connections without an explicit allowlist.
          this.log.warn('Rejected browser connection: no allowedOrigins configured', { origin });
          return false;
        };
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

          // Start tunnel if enabled.
          //
          // Soft-fallback semantics: when the user explicitly chose a
          // provider (`--tunnel-provider ngrok` / `localtunnel`), a
          // tunnel failure is fatal — the user clearly wanted a
          // public URL, and silently downgrading to local-only would
          // hand them a connection string that says `ws://localhost`
          // which only works when the participant is on the same
          // machine. Better to fail loudly here so the operator can
          // fix the underlying issue (usually missing
          // NGROK_AUTH_TOKEN).
          //
          // For the default `auto` provider, keep the soft-fallback —
          // someone running quick local CLI tests without a hosted
          // dApp shouldn't be forced to set up ngrok.
          if (this.options.tunnel && this.options.tunnel.enabled) {
            const provider = this.options.tunnel.provider || 'auto';
            const isExplicitProvider = provider !== 'auto';
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
              if (isExplicitProvider) {
                // Stop the WSS we just bound; the CLI will see this
                // rejection and exit with the underlying message.
                try { await new Promise((resolve) => this.server.close(resolve)); } catch { /* ignore */ }
                try { this.wss.close(); } catch { /* ignore */ }
                const err = new Error(
                  `Tunnel failed (--tunnel-provider ${provider}): ${error.message}\n` +
                  `   Three ways forward:\n` +
                  `     1. Run the tunnel yourself in another terminal:\n` +
                  `          ngrok http 3001          # or whatever port you used\n` +
                  `        then pass its printed wss URL via --tunnel-url:\n` +
                  `          --tunnel-url wss://abc123.ngrok-free.app\n` +
                  `     2. Try the alternate provider: --tunnel-provider localtunnel\n` +
                  `     3. Skip tunnels entirely: --no-tunnel (only works when the\n` +
                  `        signers are on the same machine as the coordinator).`
                );
                err.code = 'TUNNEL_REQUIRED';
                reject(err);
                return;
              }
              if (this.options.verbose) {
                console.log(chalk.yellow('⚠️  Tunnel failed:'), error.message);
                console.log(chalk.yellow('   Continuing with local-only access (--tunnel-provider auto soft-fallback)\n'));
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
            if (!isCoordinator) {
              this.log.warn('Non-coordinator attempted TRANSACTION_INJECT', { sessionId, participantId });
              ws.send(JSON.stringify({
                type: 'ERROR',
                payload: {
                  message: 'Only the coordinator can inject transactions',
                  code: ERROR_CODES.NOT_COORDINATOR
                }
              }));
              break;
            }
            await this._handleTransactionInject(sessionId, message);
            break;

          case 'SCHEDULE_ANNOUNCE':
            // HIP-423 scheduled tx: the coordinator already submitted
            // the ScheduleCreateTransaction to the network and got a
            // scheduleId back. They're announcing it to the session so
            // participants know what to sign. The server doesn't broker
            // the schedule itself; it just distributes the announcement.
            if (!isCoordinator) {
              this.log.warn('Non-coordinator attempted SCHEDULE_ANNOUNCE', { sessionId, participantId });
              ws.send(JSON.stringify({
                type: 'ERROR',
                payload: {
                  message: 'Only the coordinator can announce a schedule',
                  code: ERROR_CODES.NOT_COORDINATOR
                }
              }));
              break;
            }
            await this._handleScheduleAnnounce(sessionId, message);
            break;

          case 'TRANSACTION_REJECTED':
            await this._handleTransactionRejected(sessionId, participantId, message);
            break;

          case 'EXECUTE_TRANSACTION':
            if (!isCoordinator) {
              this.log.warn('Non-coordinator attempted EXECUTE_TRANSACTION', { sessionId, participantId });
              ws.send(JSON.stringify({
                type: 'ERROR',
                payload: {
                  message: 'Only the coordinator can trigger execution',
                  code: ERROR_CODES.NOT_COORDINATOR
                }
              }));
              break;
            }
            await this._handleExecuteTransaction(sessionId, message);
            break;

          case 'RESET_TRANSACTION':
            if (!isCoordinator) {
              this.log.warn('Non-coordinator attempted RESET_TRANSACTION', { sessionId, participantId });
              ws.send(JSON.stringify({
                type: 'ERROR',
                payload: {
                  message: 'Only the coordinator can reset the transaction',
                  code: ERROR_CODES.NOT_COORDINATOR
                }
              }));
              break;
            }
            await this._handleResetTransaction(sessionId, ws);
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
    const { sessionId, pin, role, label, publicKey, coordinatorToken, reconnectionToken, apiKey } = message.payload;
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
          this.log.warn('AUTH rejected: per-session rate limit exceeded', { sessionId, clientIp });
          ws.send(JSON.stringify({
            type: 'AUTH_FAILED',
            payload: { message: 'Too many failed authentication attempts for this session', code: ERROR_CODES.AUTH_RATE_LIMITED, rateLimited: true }
          }));
          return;
        }
      }
    }

    // Validate required fields (PIN, reconnection token, or agent API key required)
    if (!sessionId || (!pin && !reconnectionToken && !apiKey)) {
      this._recordFailedAuth(clientIp, rateLimitAttempts, sessionId);
      this.log.warn('AUTH rejected: missing credentials', { sessionId, clientIp });
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
      if (!result.valid && result.reason === 'KEY_NO_LONGER_ELIGIBLE') {
        this._recordFailedAuth(clientIp, rateLimitAttempts, sessionId);
        this.log.warn('Reconnection rejected: bound public key no longer eligible', { sessionId, clientIp });
        ws.send(JSON.stringify({
          type: 'AUTH_FAILED',
          payload: {
            message: 'Your key is no longer eligible to sign in this session. Re-authenticate with the PIN.',
            code: ERROR_CODES.AUTH_KEY_NOT_ELIGIBLE,
            publicKeyRejected: true
          }
        }));
        return;
      }
      // Stale-token fallback: if the reconnection token didn't match
      // (server restarted, session reset between ceremonies, browser
      // cached an obsolete token from a prior coordinator) BUT the
      // client also supplied a valid PIN, treat this as a fresh join
      // rather than a hard rejection. Without this, users who go back
      // to /join with the same connection string after a previous
      // ceremony see "invalid credentials" even though their PIN is
      // still good — because the dApp's hook prefers the cached
      // reconnectionToken at AUTH time.
      if (!authenticated && pin && !isCoordinator && !isAgent) {
        authenticated = await this.sessionManager.authenticate(sessionId, pin);
        // Don't set reconnectedParticipantId — the existing
        // participant entry is now orphaned; treat the connection as
        // a fresh participant so a new reconnection token gets minted.
        if (authenticated) {
          reconnectedParticipantId = null;
          this.log.info('Stale reconnection token; falling back to PIN auth', { sessionId, clientIp });
        }
      }
    } else if (isCoordinator) {
      // Coordinator must provide coordinatorToken alongside PIN
      authenticated = await this.sessionManager.authenticateCoordinator(sessionId, pin, coordinatorToken);
    } else if (isAgent && apiKey) {
      // Agent authentication via API key (alternative to PIN)
      authenticated = await this.sessionManager.authenticateAgent(sessionId, apiKey);
    } else {
      // Standard participant auth with PIN
      authenticated = await this.sessionManager.authenticate(sessionId, pin);
    }

    if (!authenticated) {
      this._recordFailedAuth(clientIp, rateLimitAttempts, sessionId);
      this.log.warn('AUTH rejected: invalid credentials', {
        sessionId, clientIp, role: isCoordinator ? 'coordinator' : isAgent ? 'agent' : 'participant'
      });
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
          this.log.warn('AUTH rejected: public key not eligible', {
            sessionId, clientIp, publicKeyPrefix: publicKey.slice(0, 20) + '...'
          });
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

      // Generate reconnection token so client can reconnect without PIN.
      // Bind the token to the participant's public key (when supplied at AUTH)
      // so eligibility is re-checked on reconnect — a stale token can't rejoin
      // after the coordinator rotates the eligible-keys set.
      const newReconnectionToken = await this.sessionManager.generateReconnectionToken(
        sessionId,
        participantId,
        publicKey || null
      );

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
            stats: sessionInfo.stats,
            // Snapshot of who's already connected at the moment this
            // participant authenticates. Critical for late joiners:
            // PARTICIPANT_CONNECTED broadcasts only fire for FUTURE
            // arrivals, so without this snapshot a participant who
            // joins after others would never see them in the row list,
            // even though `stats.participantsConnected` would correctly
            // count them. Previously we built sessionInfo by hand-
            // picking fields and accidentally dropped this — the dApp
            // hook tries to seed `state.participants` from it.
            participants: sessionInfo.participants,
            // HIP-423 scheduled-mode context. Realtime sessions land
            // with mode='realtime' + the schedule fields all null. A
            // late joiner to a scheduled session needs these to render
            // the long-window UI immediately, without waiting for a
            // SCHEDULE_CREATED broadcast that already fired.
            mode: sessionInfo.mode || 'realtime',
            scheduleId: sessionInfo.scheduleId || null,
            scheduleExpirationTime: sessionInfo.scheduleExpirationTime || null,
            scheduleMemo: sessionInfo.scheduleMemo || null,
            schedulePayerAccountId: sessionInfo.schedulePayerAccountId || null,
            scheduleAdminKey: sessionInfo.scheduleAdminKey || null,
            innerTxDetails: sessionInfo.innerTxDetails || null,
            innerTxBase64: sessionInfo.innerTxBase64 || null,
            expiresAt: sessionInfo.expiresAt
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
      const { publicKey, signature, signatures } = message.payload;

      // Multi-node freeze (canonical Hedera multi-sig pattern): one
      // base64 signature per SignedTransaction body, indexed by node
      // target. Wire-canonical field is `signatures: string[]`. Legacy
      // single-sig (`signature: string`) is promoted to a 1-element
      // array — verifier and executor handle the size mismatch.
      let sigList;
      if (Array.isArray(signatures) && signatures.length > 0) {
        sigList = signatures;
      } else if (typeof signature === 'string' && signature.length > 0) {
        sigList = [signature];
      } else {
        throw new Error(
          'No signature(s) in payload — expected `signatures: string[]` ' +
          '(canonical) or `signature: string` (legacy)'
        );
      }

      this.log.debug('Signature submitted', {
        sessionId, participantId,
        publicKeyPreview: '...' + publicKey.slice(-8),
        signatureCount: sigList.length
      });

      const result = await this.sessionManager.submitSignature(
        sessionId,
        participantId,
        { publicKey, signatures: sigList, signature: sigList[0] }
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

        // Auto-submit to Hedera the moment threshold is reached. Without
        // this, the server sits idle waiting for an explicit
        // EXECUTE_TRANSACTION message — which the dApp does not send —
        // and the fully-signed transaction silently expires after 120s.
        // There's no meaningful "review before submit" step at this
        // point: every eligible participant has already approved,
        // signatures are cryptographically valid, and the only next
        // sensible action is submission. Going through
        // _handleExecuteTransaction reuses the existing broadcast logic
        // so participants and coordinator both get TRANSACTION_EXECUTED
        // (or EXECUTION_FAILED) with the resulting tx ID + mirror status.
        await this._handleExecuteTransaction(sessionId, { payload: {} });
      }

    } catch (error) {
      // Tell the failing participant directly (existing behavior).
      this.sendToParticipant(participantId, {
        type: 'SIGNATURE_REJECTED',
        payload: { message: error.message, code: error.code || ERROR_CODES.SIGNATURE_INVALID }
      });
      // Also surface to the coordinator so the dApp monitor can show
      // *which* participant's signature was rejected and *why* — without
      // this notification, a sig-rejection cascade is invisible on the
      // coordinator side until the 120s window expires.
      this.sendToCoordinator(sessionId, {
        type: 'SIGNATURE_REJECTED',
        payload: {
          participantId,
          message: error.message,
          code: error.code || ERROR_CODES.SIGNATURE_INVALID
        }
      });
      // And echo to the server log so a verbose-mode operator sees it
      // alongside the SIGNATURE_SUBMIT line.
      if (this.options.verbose) {
        console.log(chalk.red(
          `\n❌ Signature rejected from participant ${participantId}: ${error.message}\n`
        ));
      }
    }
  }

  /**
   * Handle participant ready notification
   * @private
   */
  async _handleParticipantReady(sessionId, participantId, message) {
    try {
      // Forward the public key from the dApp's PARTICIPANT_READY payload
      // through to the store so it persists on the participant, AND
      // include it in the broadcast so other clients (the coordinator's
      // /create view, other participants on /session/[id]) can render
      // the eligibility-checked key against the "Ready" badge instead
      // of "Waiting for public key...".
      const readyPublicKey = message && message.payload ? message.payload.publicKey : undefined;

      // Mark participant as ready
      await this.sessionManager.setParticipantReady(sessionId, participantId, readyPublicKey);

      // Broadcast to session
      const readyStats = await this.sessionManager.store.getStats(sessionId);
      await this.broadcastToSession(sessionId, {
        type: 'PARTICIPANT_READY',
        payload: {
          participantId,
          publicKey: readyPublicKey || null,
          stats: readyStats,
          allReady: await this.sessionManager.store.areAllParticipantsReady(sessionId)
        }
      });

      // Late-joiner catch-up: if the coordinator already injected a
      // transaction before this participant connected, the original
      // TRANSACTION_RECEIVED broadcast went out before they were on the
      // socket. The participant's SigningClient explicitly waits for this
      // message before prompting the user — without it, they sit at
      // "waiting for transaction injection" forever even though the tx is
      // already in the session. Send them their own copy now.
      //
      // Use `session.frozenTransaction` as the inFlight indicator (not
      // `session.txDetails`) because the dApp's TRANSACTION_INJECT path
      // sends only the frozen bytes — txDetails ends up undefined while
      // the frozen tx and serializable ABI ARE persisted. The participant
      // SigningClient decodes the frozen bytes locally, so missing
      // txDetails is non-fatal; the ABI restores verified contract-call
      // display.
      const session = await this.sessionManager.store.getSession(sessionId);
      const inFlight =
        session &&
        (session.status === 'transaction-received' || session.status === 'signing') &&
        session.frozenTransaction;

      if (inFlight) {
        this.sendToParticipant(participantId, {
          type: 'TRANSACTION_RECEIVED',
          payload: {
            frozenTransaction: session.frozenTransaction,
            txDetails: session.txDetails || null,
            metadata: session.txDetails?.metadata || null,
            abi: session.serializableAbi || null,
            serverTimestamp: Date.now()
          }
        });
        if (this.options.verbose) {
          console.log(chalk.cyan(`   → Sent in-flight transaction to late-joining participant ${participantId}`));
        }
      }

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
      const { frozenTransaction, metadata, contractInterface, abi } = message.payload;
      let { txDetails } = message.payload;

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

      // The dApp's TRANSACTION_INJECT only sends `frozenTransaction` — no
      // pre-decoded txDetails. Without txDetails the server can't set up
      // the 120-second expiration timer (it depends on
      // validStartTimestamp), late-joiners get an empty review payload,
      // and participants see degraded transaction info. Decode here as a
      // fallback so the same code path works regardless of injection source.
      if (!txDetails) {
        try {
          const { Transaction } = require('@hashgraph/sdk');
          const decoded = await SharedDecoder.decode(normalizedTx.base64);
          txDetails = decoded.details;
          // SharedDecoder returns { details, type, checksum, ... } — we
          // store the details and let downstream consumers (review, timer
          // calculation) use them as if the dApp had pre-decoded.
          // Transaction object isn't used here but the require keeps the
          // SDK warm-loaded for the executor path.
          if (Transaction && this.options.verbose) {
            console.log(chalk.gray(`   [decoder] inferred txDetails for ${decoded.type || 'unknown type'}`));
          }
        } catch (decodeErr) {
          if (this.options.verbose) {
            console.log(chalk.yellow(
              `   [decoder] could not decode incoming tx: ${decodeErr.message} — proceeding without txDetails`
            ));
          }
        }
      }

      // Store in session via SessionStore.
      //
      // Bail early if the session can't be found — silently
      // broadcasting TRANSACTION_RECEIVED to a phantom session is its
      // own bug, and falling through to the post-block use of
      // `changedStatuses` would have masked the real cause behind a
      // generic ReferenceError ("changedStatuses is not defined") in
      // the coordinator's INJECTION_FAILED toast.
      const session = await this.sessionManager.store.getSession(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found — cannot inject transaction`);
      }

      // Clear stale per-transaction state from any previous ceremony
      // in this session (signatures Map, signaturesCollected stat,
      // participant statuses still marked 'signed' / 'rejected').
      // Without this, a coordinator who clicks "Build another
      // transaction" after a successful ceremony hits two bugs:
      //   1. Signing the new tx fails — the server's `submitSignature`
      //      sees the previous public-key entry in `signatures` and
      //      rejects with "this public key has already signed".
      //   2. The dApp's session monitor flashes stale "alice/bob ✓
      //      signed" pills against the new tx — confusing during the
      //      120s validity window when seconds matter.
      //
      // `clearTransactionState` returns the participants whose status
      // it changed; we broadcast `PARTICIPANT_STATUS_UPDATE` for each
      // below so connected dApp / CLI views update their pills
      // without having to invent a "guess server reset participants"
      // code path on the client. Declared at function scope so the
      // post-block broadcast (formerly an out-of-scope reference) can
      // see it.
      let changedStatuses = [];
      if (typeof this.sessionManager.store.clearTransactionState === 'function') {
        changedStatuses = await this.sessionManager.store.clearTransactionState(sessionId) || [];
      }

      // Clear any existing expiration timeout via TimerController
      if (session.expirationTimerId) {
        timerController.clear(session.expirationTimerId);
      }

      session.frozenTransaction = normalizedTx;
      session.txDetails = txDetails;
      // Persist the JSON-serializable ABI so late-joining participants
      // can reconstruct verified contract-call display. The original
      // ethers Interface object can't be serialized.
      session.serializableAbi = serializableAbi || null;
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

      // Sync any participant statuses we just reset (signed/rejected →
      // ready/connected) BEFORE broadcasting the new TRANSACTION_RECEIVED.
      // Doing it in this order means a dApp client that listens to
      // PARTICIPANT_STATUS_UPDATE has already cleared the stale pills
      // by the time the new tx arrives — no flash, no race.
      if (changedStatuses.length > 0) {
        const refreshedStats = await this.sessionManager.store.getStats(sessionId);
        for (const { participantId: pid, status } of changedStatuses) {
          await this.broadcastToSession(sessionId, {
            type: 'PARTICIPANT_STATUS_UPDATE',
            payload: {
              participantId: pid,
              status,
              stats: refreshedStats,
            },
          });
        }
      }

      // Broadcast to all participants (use serializableAbi instead of contractInterface)
      // Include server timestamp so clients can compute clock offset for accurate countdown.
      // IMPORTANT: forward the *normalized* { bytes, base64 } form, not the raw
      // payload field. The dApp's TRANSACTION_INJECT sends `frozenTransaction`
      // as a base64 string — if we broadcast it as-is, participants doing
      // `frozenTransaction.base64` get `undefined`, decoding throws, and the
      // auto-reject catch in SigningClient._onTransactionReceived fires a
      // spurious TRANSACTION_REJECTED for every connected participant.
      await this.broadcastToSession(sessionId, {
        type: 'TRANSACTION_RECEIVED',
        payload: {
          frozenTransaction: normalizedTx,
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
        session.serializableAbi = null;
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
   * Handle coordinator-initiated transaction reset.
   *
   * Allows the coordinator to abandon an in-flight transaction (e.g. a
   * participant CLI crashed mid-signing, or the coordinator changed their
   * mind) without tearing down the whole session. Mirrors the logic in
   * `_handleTransactionExpired`: clear the frozen tx + collected signatures
   * and reset the session status to `waiting`, ready for a new injection.
   *
   * Only valid while the transaction is still in flight — after `executing`
   * we'd be racing the network, and after a terminal state (`completed`,
   * `execution-failed`) the operator should investigate before retrying.
   * @private
   */
  async _handleResetTransaction(sessionId, ws) {
    const session = await this.sessionManager.store.getSession(sessionId);
    if (!session) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        payload: { message: 'Session not found' }
      }));
      return;
    }

    // States from which a coordinator-initiated reset is meaningful
    // OR idempotent (already at the post-reset state).
    //
    // - 'transaction-received' / 'signing': in-flight, normal reset.
    // - 'transaction-expired': natural expiry path, normal reset.
    // - 'waiting': the session has already auto-reset (expiration timer
    //   in `_handleTransactionExpired` flips status to 'waiting' after
    //   clearing the tx). The dApp's local SessionMonitor still shows
    //   'expired' and renders the reset button, so the click arrives
    //   here. Treat as a no-op success — tell the dApp the reset
    //   succeeded so it routes back to the build step.
    //
    // Hard-blocked states ('completed', 'execution-failed', etc.) still
    // reject — the operator should investigate before retrying.
    const resetableStates = new Set([
      'transaction-received',
      'signing',
      'transaction-expired',
      'waiting',
    ]);
    if (!resetableStates.has(session.status)) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        payload: {
          message: `Cannot reset transaction from status '${session.status}'. Reset is only allowed while a transaction is in flight, expired, or already at 'waiting'.`
        }
      }));
      return;
    }

    const wasAlreadyWaiting = session.status === 'waiting';

    // Clear any lingering tx state. This is a no-op if the session is
    // already at 'waiting' (auto-reset already happened), but it's safe
    // and idempotent — defensive-clear in case any field was missed.
    session.frozenTransaction = null;
    session.txDetails = null;
    session.serializableAbi = null;
    session.transactionExpiresAt = null;
    if (session.signatures && typeof session.signatures.clear === 'function') {
      session.signatures.clear();
    }
    if (session.stats) {
      session.stats.signaturesCollected = 0;
    }

    if (!wasAlreadyWaiting) {
      await this.sessionManager.store.updateStatus(sessionId, 'waiting');
    }

    if (this.options.verbose) {
      if (wasAlreadyWaiting) {
        console.log(chalk.gray(
          `\n🔄  Coordinator reset acknowledged for session ${sessionId} (already at 'waiting').\n`
        ));
      } else {
        console.log(chalk.yellow(`\n🔄  Coordinator reset transaction for session ${sessionId}`));
        console.log(chalk.gray(`   Session is back to 'waiting' — ready for a new injection.\n`));
      }
    }

    // Always broadcast TRANSACTION_RESET so the dApp's SessionMonitor
    // can navigate back to the build step regardless of whether the
    // reset was a no-op acknowledgment or an actual state transition.
    await this.broadcastToSession(sessionId, {
      type: 'TRANSACTION_RESET',
      payload: {
        sessionId,
        message: wasAlreadyWaiting
          ? 'Session was already at waiting — ready for a new injection.'
          : 'Coordinator reset the transaction. Session is ready for a new injection.'
      }
    });
  }

  /**
   * Handle a coordinator announcing a HIP-423 schedule they just
   * created on the network.
   *
   * The coordinator's wallet (or CLI operator) submitted the
   * ScheduleCreateTransaction to Hedera, paid the fee, got back a
   * scheduleId. They send us this announcement so we can:
   *   1. Stamp the session as scheduled-mode (`mode: 'scheduled'`),
   *      which the manager already supports for timeout extensions.
   *   2. Persist the scheduleId on the session for late joiners.
   *   3. Broadcast SCHEDULE_CREATED to every participant — they look
   *      up the schedule on mirror node, decode the inner tx, and
   *      submit their own ScheduleSignTransaction at their leisure.
   *
   * Distinct from TRANSACTION_INJECT: there's no signature collection
   * over the WebSocket. Mirror node tracks "schedule has N signatures,
   * executed yes/no". The WS session is just a coordination channel
   * for the announcement + status pings.
   *
   * @private
   */
  async _handleScheduleAnnounce(sessionId, message) {
    try {
      const {
        scheduleId,
        innerTxDetails,    // pre-decoded inner-tx fields for the review screen
        innerTxBase64,     // raw scheduled-transaction body bytes (for clients that want to re-decode)
        expirationTime,    // seconds-since-epoch when the schedule expires
        scheduleMemo,
        payerAccountId,
        adminKey,
      } = message.payload || {};

      if (!scheduleId || typeof scheduleId !== 'string') {
        throw new Error('SCHEDULE_ANNOUNCE requires a `scheduleId` string');
      }

      const session = await this.sessionManager.store.getSession(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found — cannot announce schedule`);
      }

      // Promote to scheduled mode + stash scheduleId on session.
      // SigningSessionManager already special-cases mode='scheduled'
      // for timeout extension; the rest is store-level state we
      // reuse on broadcast and reconnect.
      session.mode = 'scheduled';
      session.scheduleId = scheduleId;
      session.scheduleAnnouncedAt = Date.now();
      session.scheduleExpirationTime = expirationTime || null;
      session.scheduleMemo = scheduleMemo || null;
      session.schedulePayerAccountId = payerAccountId || null;
      session.scheduleAdminKey = adminKey || null;
      session.innerTxDetails = innerTxDetails || null;
      session.innerTxBase64 = innerTxBase64 || null;

      this.log.info('Schedule announced', {
        sessionId,
        scheduleId,
        expirationTime: expirationTime || null,
      });
      if (this.options.verbose) {
        const expiresIn = expirationTime
          ? `${Math.round((expirationTime * 1000 - Date.now()) / 3_600_000)}h`
          : 'unspecified';
        console.log(chalk.cyan(
          `\n📅 Schedule announced: ${scheduleId} (expires in ~${expiresIn})\n` +
          `   Participants will sign via ScheduleSignTransaction at their convenience.\n`
        ));
      }

      await this.broadcastToSession(sessionId, {
        type: 'SCHEDULE_CREATED',
        payload: {
          scheduleId,
          expirationTime: expirationTime || null,
          scheduleMemo: scheduleMemo || null,
          payerAccountId: payerAccountId || null,
          adminKey: adminKey || null,
          innerTxDetails: innerTxDetails || null,
          innerTxBase64: innerTxBase64 || null,
          announcedAt: session.scheduleAnnouncedAt,
        },
      });
    } catch (error) {
      this.sendToCoordinator(sessionId, {
        type: 'INJECTION_FAILED',
        payload: { message: error.message, code: error.code || ERROR_CODES.TRANSACTION_INJECTION_FAILED },
      });
    }
  }

  /**
   * Handle transaction rejection from participant
   * @private
   */
  async _handleTransactionRejected(sessionId, participantId, message) {
    const { reason } = message.payload;

    // Mark the rejector
    await this.sessionManager.updateParticipantStatus(sessionId, participantId, 'rejected');

    // A single rejection aborts the whole ceremony — the bytes won't
    // execute, so any signatures already collected from OTHER
    // participants are now useless for this tx. Reset the per-tx
    // state to match: drop the signatures Map, demote 'signed' /
    // 'rejected' participants back to 'ready' / 'connected', clear
    // the frozen tx, and put the session back to 'waiting' so the
    // coordinator can re-inject without operating on stale state.
    let changedStatuses = [];
    const session = await this.sessionManager.store.getSession(sessionId);
    if (session) {
      if (typeof this.sessionManager.store.clearTransactionState === 'function') {
        changedStatuses = await this.sessionManager.store.clearTransactionState(sessionId) || [];
      }
      if (session.expirationTimerId) {
        try { timerController.clear(session.expirationTimerId); } catch { /* ignore */ }
        session.expirationTimerId = null;
      }
      session.frozenTransaction = null;
      session.txDetails = null;
      session.serializableAbi = null;
      session.transactionExpiresAt = null;
      session.transactionReceivedAt = null;
      session.status = 'waiting';
    }

    const rejectedStats = await this.sessionManager.store.getStats(sessionId);

    // Push fresh per-participant statuses BEFORE the rejection
    // broadcast so the dApp's row pills clear in the same render
    // pass as the rejection toast — no flash of "signed" against a
    // tx that's already been canceled.
    if (changedStatuses.length > 0) {
      for (const { participantId: pid, status } of changedStatuses) {
        await this.broadcastToSession(sessionId, {
          type: 'PARTICIPANT_STATUS_UPDATE',
          payload: {
            participantId: pid,
            status,
            stats: rejectedStats,
          },
        });
      }
    }

    await this.broadcastToSession(sessionId, {
      type: 'TRANSACTION_REJECTED',
      payload: {
        participantId,
        reason,
        stats: rejectedStats,
      }
    });

    if (this.options.verbose) {
      console.log(chalk.yellow(
        `\n⚠️  Participant ${participantId} rejected transaction: ${reason}\n` +
        `   Session reset to 'waiting' — coordinator can re-inject.\n`
      ));
    }
  }

  /**
   * Handle transaction execution request
   * @private
   */
  async _handleExecuteTransaction(sessionId, message) {
    if (this.options.verbose) {
      console.log(chalk.cyan(`\n→ Executing transaction for session ${sessionId}...`));
    }
    try {
      const result = await this.sessionManager.executeTransaction(sessionId);

      if (this.options.verbose) {
        console.log(chalk.green(
          `✅ Execute returned: ` +
          `txId=${result?.transactionId || 'unknown'} ` +
          `status=${result?.status || 'unknown'} ` +
          `mirrorConfirmed=${!!result?.mirrorConfirmed}`
        ));
      }

      // Broadcast to session
      await this.broadcastToSession(sessionId, {
        type: 'TRANSACTION_EXECUTED',
        payload: result
      });

    } catch (error) {
      // Surface the full error on the server console — previously this
      // catch silently sent EXECUTION_FAILED to the coordinator only,
      // making a backend execute throw invisible if the coordinator's
      // socket had already closed or never paid attention. With this
      // log every operator running `--verbose` (default) sees the
      // failure with stack.
      const stack = error && error.stack ? `\n${error.stack}` : '';
      console.error(chalk.red(
        `\n❌ Execute failed for session ${sessionId}: ${error.message}${stack}\n`
      ));
      this.log.error('Transaction execution failed', {
        sessionId,
        error: error.message,
        code: error.code
      });

      // Broadcast (not just sendToCoordinator) so participants also
      // learn the network rejected. Without this, CLI participants
      // sit idle until the 120s window expires even though the tx
      // already failed on-chain.
      await this.broadcastToSession(sessionId, {
        type: 'EXECUTION_FAILED',
        payload: {
          sessionId,
          message: error.message,
          code: error.code || ERROR_CODES.TRANSACTION_EXECUTION_FAILED
        }
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
   * Start an ngrok tunnel using the official @ngrok/ngrok SDK.
   *
   * Background: this used to depend on the unmaintained `ngrok` npm
   * wrapper (5.0.0-beta.2, last published 2022). That wrapper drove
   * a bundled v3 binary via its REST API, which has since drifted —
   * every POST to /api/tunnels with a fresh UUID name returned
   * "tunnel <uuid> already exists", surfaced as the generic
   * "invalid tunnel configuration". On top of that, the wrapper
   * required users to run `ngrok config add-authtoken <token>` once
   * separately from setting NGROK_AUTH_TOKEN, because the bundled
   * binary's config file was distinct from the wrapper's options.
   *
   * The official @ngrok/ngrok SDK (napi-rs binding to libngrok-rs):
   *   - takes the authtoken as a function argument (no separate config step),
   *   - returns a Listener with .url() and .close(),
   *   - exposes structured error info (err.code, err.errorCode like
   *     ERR_NGROK_105/107/108/4018), so we can surface specific guidance.
   *
   * @private
   */
  async _startNgrokTunnel(port) {
    const ngrok = require('@ngrok/ngrok');

    const authtoken = this.options.tunnel.authToken || process.env.NGROK_AUTH_TOKEN;
    const subdomain = this.options.tunnel.subdomain;

    if (!authtoken) {
      throw new Error(
        'NGROK_AUTH_TOKEN environment variable is not set. ngrok requires ' +
        'an auth token (free at https://dashboard.ngrok.com/get-started/your-authtoken). ' +
        'Either export NGROK_AUTH_TOKEN=<your-token> in your shell or put it in ' +
        '.env at the repo root, or pass --tunnel-provider localtunnel to skip ' +
        'ngrok, or pass --no-tunnel for local-only access.'
      );
    }

    const ngrokOptions = {
      addr: port,
      authtoken,
    };
    if (subdomain) {
      ngrokOptions.subdomain = subdomain;
    }

    let listener;
    try {
      listener = await ngrok.forward(ngrokOptions);
    } catch (error) {
      throw this._explainNgrokError(error);
    }

    const url = listener.url();
    if (!url) {
      // Defensive: forward() resolving without a URL would be an SDK bug,
      // but better to fail with something readable than NPE later.
      try { await listener.close(); } catch { /* ignore */ }
      throw new Error('ngrok forward() returned a listener with no URL');
    }

    this.tunnel = listener;
    this.tunnelType = 'ngrok';
    return url.replace('https://', 'wss://').replace('http://', 'ws://');
  }

  /**
   * Translate an @ngrok/ngrok error into actionable guidance.
   *
   * The SDK throws a JS Error decorated with `code` (a coarse category,
   * e.g. `'GenericFailure'`) and `errorCode` (the canonical ngrok
   * code, e.g. `'ERR_NGROK_107'`). We pattern-match on `errorCode`
   * to add a "what to do next" sentence; everything else falls through
   * with the SDK's own message, which is usually already informative
   * (it cites the dashboard URL, names the offending value, etc.).
   *
   * @private
   */
  _explainNgrokError(error) {
    const errorCode = error.errorCode || '';
    const baseMessage = error.message || String(error);

    // Known codes — each one's hint addresses the most common cause.
    const hints = {
      ERR_NGROK_105:
        'The authtoken you supplied is malformed. Double-check NGROK_AUTH_TOKEN ' +
        'in your environment / .env — copy it fresh from ' +
        'https://dashboard.ngrok.com/get-started/your-authtoken.',
      ERR_NGROK_107:
        'ngrok rejected your authtoken. Common causes: the token was rotated, ' +
        'the team account it belonged to revoked your access, or the credential ' +
        'was explicitly revoked. Get a fresh token at ' +
        'https://dashboard.ngrok.com/get-started/your-authtoken and update ' +
        'NGROK_AUTH_TOKEN.',
      ERR_NGROK_108:
        'Your ngrok account is rate-limited or out of quota. Check ' +
        'https://dashboard.ngrok.com for active sessions, or wait and retry.',
      ERR_NGROK_4018:
        'Your ngrok account already has the maximum number of simultaneous ' +
        'tunnels open (one on the free tier). Kill any other ngrok sessions ' +
        '(check https://dashboard.ngrok.com/agents) and retry.',
    };

    const hint = hints[errorCode];
    const prefix = errorCode ? `ngrok failed (${errorCode})` : 'ngrok failed';
    const tail = hint ? `\n\n${hint}` : '';
    const wrapped = new Error(`${prefix}: ${baseMessage}${tail}`);
    wrapped.code = error.code;
    wrapped.errorCode = errorCode;
    return wrapped;
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
        // this.tunnel is the @ngrok/ngrok Listener instance.
        // `.close()` shuts down this specific tunnel; the SDK's
        // background session is reused process-wide, so we don't
        // try to kill it (no equivalent of the old wrapper's .kill()).
        if (this.tunnel && typeof this.tunnel.close === 'function') {
          await this.tunnel.close();
        }
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
