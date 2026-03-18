/**
 * CoordinationTransport
 *
 * Abstract interface for multi-signature coordination transports.
 * Decouples session coordination logic from the underlying communication
 * mechanism, enabling pluggable transports (WebSocket, HCS/Flora, etc.).
 *
 * The transport layer is responsible for message delivery between participants
 * and coordinators within signing sessions. It does NOT handle session state,
 * signature verification, or transaction logic -- those remain in
 * SigningSessionManager, which is already transport-agnostic.
 *
 * Architecture:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │                   SigningSessionManager                  │
 *   │        (session state, signatures, thresholds)           │
 *   └─────────────────────┬────────────────────────────────────┘
 *                         │ calls
 *   ┌─────────────────────▼────────────────────────────────────┐
 *   │               CoordinationTransport (interface)          │
 *   │   broadcast() | sendTo() | sendToCoordinator()           │
 *   │   onMessage() | onConnect() | onDisconnect()             │
 *   │   start() | stop() | getType()                           │
 *   └──────┬───────────────────────┬───────────────────────────┘
 *          │                       │
 *   ┌──────▼──────┐        ┌──────▼──────┐
 *   │  WebSocket  │        │    Flora    │
 *   │  Transport  │        │  Transport  │
 *   │ (delegates  │        │  (HCS-10   │
 *   │  to existing│        │   topics)  │
 *   │  WS server) │        │            │
 *   └─────────────┘        └────────────┘
 *
 * @module shared/CoordinationTransport
 */

const { createLogger } = require('./logger');

// ============================================================================
// Transport Type Constants
// ============================================================================

/**
 * Known transport type identifiers.
 * Use these constants instead of string literals.
 */
const TRANSPORT_TYPES = {
  WEBSOCKET: 'websocket',
  FLORA: 'flora',
};

// ============================================================================
// CoordinationTransport (Abstract Base Class)
// ============================================================================

/**
 * Abstract base class defining the coordination transport interface.
 *
 * All transport implementations must extend this class and implement
 * every method. Calling an unimplemented method throws an error to
 * surface the gap immediately during development.
 *
 * Message format: Messages are plain JavaScript objects. The transport
 * serializes/deserializes them as needed for the underlying medium
 * (JSON over WebSocket, serialized to HCS topic messages, etc.).
 *
 * Participant addressing: Participants are identified by participantId
 * (string), assigned during authentication. Sessions are identified by
 * sessionId (string). The transport must maintain the mapping between
 * these logical identifiers and the underlying connections/subscriptions.
 */
class CoordinationTransport {
  constructor(options = {}) {
    if (new.target === CoordinationTransport) {
      throw new Error(
        'CoordinationTransport is abstract and cannot be instantiated directly. ' +
        'Use WebSocketTransport, FloraTransport, or a custom implementation.'
      );
    }
    this.options = options;
    this.log = createLogger(this.constructor.name);

    // Handler registries
    this._messageHandlers = [];
    this._connectHandlers = [];
    this._disconnectHandlers = [];
  }

  /**
   * Broadcast a message to all participants in a session.
   *
   * Delivers the message to every connected participant AND the coordinator
   * for the given session, optionally excluding one participant (typically
   * the sender to avoid echo).
   *
   * @param {string} sessionId - Target session identifier
   * @param {Object} message - Message object to broadcast (will be serialized by transport)
   * @param {string} [excludeParticipantId] - Participant to exclude from broadcast
   * @returns {Promise<void>}
   */
  async broadcast(sessionId, message, excludeParticipantId) {
    throw new Error(`${this.constructor.name} must implement broadcast()`);
  }

  /**
   * Send a message to a specific participant.
   *
   * Delivers a targeted message to exactly one participant, identified by
   * their participantId. Used for direct responses like SIGNATURE_ACCEPTED,
   * SIGNATURE_REJECTED, and ERROR messages.
   *
   * @param {string} participantId - Target participant identifier
   * @param {Object} message - Message object to send
   * @returns {Promise<void>}
   */
  async sendTo(participantId, message) {
    throw new Error(`${this.constructor.name} must implement sendTo()`);
  }

  /**
   * Send a message to the coordinator of a session.
   *
   * The coordinator is the entity that created the session and manages
   * the signing workflow. Used for coordinator-specific notifications
   * like INJECTION_FAILED, EXECUTION_FAILED, and TRANSACTION_EXPIRED.
   *
   * @param {string} sessionId - Session whose coordinator should receive the message
   * @param {Object} message - Message object to send
   * @returns {Promise<void>}
   */
  async sendToCoordinator(sessionId, message) {
    throw new Error(`${this.constructor.name} must implement sendToCoordinator()`);
  }

  /**
   * Register a handler for incoming messages.
   *
   * Multiple handlers can be registered. They are invoked in registration
   * order when a message arrives. The transport is responsible for parsing
   * the raw message and extracting the sessionId and participantId from
   * the connection context (not from the message body, to prevent spoofing).
   *
   * @param {Function} handler - Callback: handler(sessionId, participantId, message)
   *   - sessionId {string} - Session the message belongs to
   *   - participantId {string|null} - Sender's participant ID (null for coordinator)
   *   - message {Object} - Parsed message object
   */
  onMessage(handler) {
    if (typeof handler !== 'function') {
      throw new Error('onMessage handler must be a function');
    }
    this._messageHandlers.push(handler);
  }

  /**
   * Register a handler for participant connections.
   *
   * Called when a participant or coordinator successfully authenticates
   * and joins a session. The metadata object contains connection details
   * relevant to the transport (e.g., IP address for WebSocket, topic ID
   * for Flora).
   *
   * @param {Function} handler - Callback: handler(sessionId, participantId, metadata)
   *   - sessionId {string} - Session joined
   *   - participantId {string|null} - Participant ID (null for coordinator)
   *   - metadata {Object} - Transport-specific connection metadata
   *     - metadata.role {string} - 'coordinator', 'participant', or 'agent'
   *     - metadata.label {string|null} - Human-readable participant label
   *     - metadata.isAgent {boolean} - Whether this is an automated agent
   */
  onConnect(handler) {
    if (typeof handler !== 'function') {
      throw new Error('onConnect handler must be a function');
    }
    this._connectHandlers.push(handler);
  }

  /**
   * Register a handler for participant disconnections.
   *
   * Called when a participant's connection is lost or intentionally closed.
   * For persistent transports (like Flora/HCS), this may be triggered by
   * an explicit disconnect message rather than a TCP-level event.
   *
   * @param {Function} handler - Callback: handler(sessionId, participantId)
   *   - sessionId {string} - Session the participant left
   *   - participantId {string} - Disconnected participant's ID
   */
  onDisconnect(handler) {
    if (typeof handler !== 'function') {
      throw new Error('onDisconnect handler must be a function');
    }
    this._disconnectHandlers.push(handler);
  }

  /**
   * Start the transport.
   *
   * Performs any initialization needed to begin accepting connections
   * and delivering messages. For WebSocket, this starts the HTTP/WS server.
   * For Flora, this would subscribe to the coordination HCS topic.
   *
   * @param {Object} [options] - Transport-specific start options
   *   For WebSocket: { port, host, tls, tunnel }
   *   For Flora: { topicId, operatorId, operatorKey, network }
   * @returns {Promise<Object>} Transport-specific start result
   *   For WebSocket: { host, port, url, publicUrl, isSecure }
   *   For Flora: { topicId, network }
   */
  async start(options) {
    throw new Error(`${this.constructor.name} must implement start()`);
  }

  /**
   * Stop the transport.
   *
   * Gracefully shuts down all connections and releases resources.
   * Must be safe to call multiple times (idempotent).
   *
   * @returns {Promise<void>}
   */
  async stop() {
    throw new Error(`${this.constructor.name} must implement stop()`);
  }

  /**
   * Get the transport type identifier.
   *
   * Returns a string constant identifying this transport implementation.
   * Used for logging, diagnostics, and transport-specific branching in
   * code that needs to know the underlying mechanism.
   *
   * @returns {string} Transport type (e.g., 'websocket', 'flora')
   */
  getType() {
    throw new Error(`${this.constructor.name} must implement getType()`);
  }

  // ============================================================================
  // Protected Helper Methods (for subclass use)
  // ============================================================================

  /**
   * Invoke all registered message handlers.
   * Subclasses call this when a message is received from the underlying transport.
   *
   * @protected
   * @param {string} sessionId
   * @param {string|null} participantId
   * @param {Object} message
   */
  _emitMessage(sessionId, participantId, message) {
    for (const handler of this._messageHandlers) {
      try {
        handler(sessionId, participantId, message);
      } catch (err) {
        this.log.error('Message handler error', { error: err.message, sessionId, participantId });
      }
    }
  }

  /**
   * Invoke all registered connect handlers.
   * Subclasses call this when a participant connects and authenticates.
   *
   * @protected
   * @param {string} sessionId
   * @param {string|null} participantId
   * @param {Object} metadata
   */
  _emitConnect(sessionId, participantId, metadata) {
    for (const handler of this._connectHandlers) {
      try {
        handler(sessionId, participantId, metadata);
      } catch (err) {
        this.log.error('Connect handler error', { error: err.message, sessionId, participantId });
      }
    }
  }

  /**
   * Invoke all registered disconnect handlers.
   * Subclasses call this when a participant disconnects.
   *
   * @protected
   * @param {string} sessionId
   * @param {string} participantId
   */
  _emitDisconnect(sessionId, participantId) {
    for (const handler of this._disconnectHandlers) {
      try {
        handler(sessionId, participantId);
      } catch (err) {
        this.log.error('Disconnect handler error', { error: err.message, sessionId, participantId });
      }
    }
  }
}

// ============================================================================
// WebSocketTransport
// ============================================================================

/**
 * WebSocket-based coordination transport.
 *
 * Thin adapter that delegates to the existing MultiSigWebSocketServer.
 * This does NOT rewrite or replace the WebSocket server -- it wraps it
 * so that higher-level code can program against the CoordinationTransport
 * interface without knowing the transport is WebSocket.
 *
 * The existing MultiSigWebSocketServer continues to handle:
 * - HTTP/HTTPS server lifecycle
 * - WebSocket connection management and heartbeats
 * - Rate limiting and authentication
 * - Tunnel setup (ngrok/localtunnel)
 * - Message routing via its own clients/coordinatorClients maps
 *
 * This adapter simply exposes those capabilities through the
 * CoordinationTransport interface methods.
 */
class WebSocketTransport extends CoordinationTransport {
  /**
   * @param {Object} options
   * @param {Object} options.wsServer - Existing MultiSigWebSocketServer instance.
   *   If not provided, one will be created when start() is called.
   * @param {Object} [options.sessionManager] - SigningSessionManager instance.
   *   Required if wsServer is not provided (used to construct one).
   * @param {Object} [options.serverOptions] - Options to pass to MultiSigWebSocketServer
   *   constructor when creating a new instance. Ignored if wsServer is provided.
   */
  constructor(options = {}) {
    super(options);
    this._wsServer = options.wsServer || null;
    this._sessionManager = options.sessionManager || null;
    this._serverOptions = options.serverOptions || {};
    this._started = false;
  }

  /**
   * Get the underlying MultiSigWebSocketServer instance.
   * Useful for code that needs direct access during migration.
   *
   * @returns {Object|null} The MultiSigWebSocketServer instance, or null if not initialized
   */
  get wsServer() {
    return this._wsServer;
  }

  /** @inheritdoc */
  async broadcast(sessionId, message, excludeParticipantId) {
    if (!this._wsServer) {
      throw new Error('WebSocketTransport not started -- call start() first');
    }
    await this._wsServer.broadcastToSession(sessionId, message, excludeParticipantId);
  }

  /** @inheritdoc */
  async sendTo(participantId, message) {
    if (!this._wsServer) {
      throw new Error('WebSocketTransport not started -- call start() first');
    }
    this._wsServer.sendToParticipant(participantId, message);
  }

  /** @inheritdoc */
  async sendToCoordinator(sessionId, message) {
    if (!this._wsServer) {
      throw new Error('WebSocketTransport not started -- call start() first');
    }
    this._wsServer.sendToCoordinator(sessionId, message);
  }

  /** @inheritdoc */
  async start(options = {}) {
    if (this._started) {
      this.log.warn('WebSocketTransport already started');
      return { already: true };
    }

    // If no wsServer was injected, create one
    if (!this._wsServer) {
      if (!this._sessionManager) {
        throw new Error(
          'WebSocketTransport requires either a wsServer instance or a sessionManager ' +
          'to create one. Pass { wsServer } or { sessionManager } in constructor options.'
        );
      }

      // Lazy require to avoid circular dependency at module load time
      const MultiSigWebSocketServer = require('../server/WebSocketServer');
      const mergedOptions = { ...this._serverOptions, ...options };
      this._wsServer = new MultiSigWebSocketServer(this._sessionManager, mergedOptions);
    }

    const result = await this._wsServer.start();
    this._started = true;

    this.log.info('WebSocketTransport started', {
      host: result.host,
      port: result.port,
      secure: result.isSecure
    });

    return result;
  }

  /** @inheritdoc */
  async stop() {
    if (!this._started || !this._wsServer) {
      return;
    }

    await this._wsServer.stop();
    this._started = false;

    this.log.info('WebSocketTransport stopped');
  }

  /** @inheritdoc */
  getType() {
    return TRANSPORT_TYPES.WEBSOCKET;
  }
}

// ============================================================================
// FloraTransport (Stub)
// ============================================================================

/**
 * Flora (HCS-10) coordination transport -- NOT YET IMPLEMENTED.
 *
 * When completed, this transport will enable fully decentralized multi-sig
 * coordination using Hedera Consensus Service (HCS) topics. Instead of a
 * central WebSocket server, all coordination messages flow through HCS
 * topics, providing:
 *
 * - No central server requirement (decentralized coordination)
 * - Immutable audit trail of all coordination messages on-chain
 * - Censorship-resistant message delivery
 * - Asynchronous signing across time zones (no real-time requirement)
 * - Built-in message ordering via HCS consensus timestamps
 *
 * HCS-10 Connection Protocol:
 *   Each participant registers an "inbound" HCS topic. The coordination
 *   session uses a shared "session topic" for broadcasts. Direct messages
 *   are sent to the recipient's inbound topic, encrypted with their
 *   public key.
 *
 * Message Flow:
 *   1. Coordinator creates a session topic on HCS
 *   2. Participants subscribe to the session topic
 *   3. Coordinator publishes frozen transaction to session topic
 *   4. Participants publish signatures to session topic
 *   5. Coordinator (or any participant) assembles and executes
 *
 * Security:
 *   - Messages are signed by the sender's Hedera account key
 *   - Direct messages are encrypted end-to-end
 *   - Session topics can be configured with submit-key restrictions
 *   - All messages have HCS consensus timestamps for ordering
 */
class FloraTransport extends CoordinationTransport {
  constructor(options = {}) {
    super(options);
  }

  /**
   * Broadcast a message to all session participants via HCS session topic.
   *
   * When implemented, this will:
   * 1. Serialize the message to a JSON string
   * 2. Submit it as an HCS message to the session's coordination topic
   * 3. All subscribers (participants + coordinator) receive it via mirror node
   *
   * The excludeParticipantId parameter is handled client-side: each subscriber
   * checks if the message sender is themselves and skips processing if so.
   *
   * @param {string} sessionId - Maps to an HCS topic ID
   * @param {Object} message - Message to publish to the session topic
   * @param {string} [excludeParticipantId] - Participant to exclude (handled client-side)
   * @returns {Promise<void>}
   * @throws {Error} Not yet implemented
   */
  async broadcast(sessionId, message, excludeParticipantId) {
    throw new Error(
      'FloraTransport.broadcast() is not yet implemented. ' +
      'Flora mode requires HCS-10 topic infrastructure. ' +
      'See: https://github.com/hashgraph-online/standards/blob/main/standards/hcs-10/README.md'
    );
  }

  /**
   * Send a direct message to a specific participant via their inbound HCS topic.
   *
   * When implemented, this will:
   * 1. Look up the participant's inbound topic ID from their HCS-10 profile
   * 2. Optionally encrypt the message with the participant's public key
   * 3. Submit the message to their inbound topic
   *
   * @param {string} participantId - Participant's Hedera account ID or topic-based address
   * @param {Object} message - Message to send
   * @returns {Promise<void>}
   * @throws {Error} Not yet implemented
   */
  async sendTo(participantId, message) {
    throw new Error(
      'FloraTransport.sendTo() is not yet implemented. ' +
      'Requires HCS-10 inbound topic lookup and direct messaging.'
    );
  }

  /**
   * Send a message to the session coordinator via their inbound HCS topic.
   *
   * When implemented, this will:
   * 1. Look up the coordinator's inbound topic from the session metadata
   * 2. Submit the message to the coordinator's inbound topic
   * 3. Coordinator's mirror node subscription delivers the message
   *
   * @param {string} sessionId - Session whose coordinator should receive the message
   * @param {Object} message - Message to send
   * @returns {Promise<void>}
   * @throws {Error} Not yet implemented
   */
  async sendToCoordinator(sessionId, message) {
    throw new Error(
      'FloraTransport.sendToCoordinator() is not yet implemented. ' +
      'Requires coordinator inbound topic lookup from session metadata.'
    );
  }

  /**
   * Start the Flora transport by subscribing to coordination topics.
   *
   * When implemented, this will:
   * 1. Connect to Hedera mirror node for topic subscriptions
   * 2. Create or subscribe to the coordination session topic
   * 3. Register the participant's inbound topic for direct messages
   * 4. Begin polling/streaming for new HCS messages
   *
   * @param {Object} [options] - Flora-specific start options
   * @param {string} [options.topicId] - Existing session topic to subscribe to
   * @param {string} [options.operatorId] - Hedera account ID for submitting messages
   * @param {string} [options.operatorKey] - Hedera private key for signing submissions
   * @param {string} [options.network] - Hedera network ('testnet', 'mainnet', 'previewnet')
   * @param {string} [options.mirrorNodeUrl] - Custom mirror node URL
   * @returns {Promise<Object>} - { topicId, network }
   * @throws {Error} Not yet implemented
   */
  async start(options) {
    throw new Error(
      'FloraTransport.start() is not yet implemented. ' +
      'Requires Hedera SDK mirror node subscription setup.'
    );
  }

  /**
   * Stop the Flora transport.
   *
   * When implemented, this will:
   * 1. Unsubscribe from all HCS topic subscriptions
   * 2. Close mirror node connections
   * 3. Clean up any local state
   *
   * @returns {Promise<void>}
   * @throws {Error} Not yet implemented
   */
  async stop() {
    throw new Error(
      'FloraTransport.stop() is not yet implemented. ' +
      'Requires mirror node subscription teardown.'
    );
  }

  /** @inheritdoc */
  getType() {
    return TRANSPORT_TYPES.FLORA;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a coordination transport instance by type.
 *
 * Factory function that instantiates the appropriate transport implementation
 * based on the type string. This is the recommended way to create transports
 * in application code, as it allows the transport type to be configured
 * externally (e.g., via CLI flags, environment variables, or config files).
 *
 * @param {string} type - Transport type: 'websocket' or 'flora'
 * @param {Object} [options] - Transport-specific constructor options
 *
 *   For 'websocket':
 *     - wsServer {Object} - Existing MultiSigWebSocketServer instance
 *     - sessionManager {Object} - SigningSessionManager (if no wsServer provided)
 *     - serverOptions {Object} - Options for new WebSocket server creation
 *
 *   For 'flora':
 *     - topicId {string} - HCS session topic ID
 *     - operatorId {string} - Hedera operator account
 *     - operatorKey {string} - Hedera operator private key
 *     - network {string} - 'testnet', 'mainnet', 'previewnet'
 *
 * @returns {CoordinationTransport} Transport instance
 * @throws {Error} If the transport type is unknown
 *
 * @example
 * // Wrap an existing WebSocket server
 * const transport = createTransport('websocket', { wsServer: existingServer });
 *
 * @example
 * // Create a new WebSocket transport with session manager
 * const transport = createTransport('websocket', {
 *   sessionManager: mySessionManager,
 *   serverOptions: { port: 3001, host: 'localhost' }
 * });
 *
 * @example
 * // Create Flora transport (will throw until implemented)
 * const transport = createTransport('flora', {
 *   topicId: '0.0.12345',
 *   network: 'testnet'
 * });
 */
function createTransport(type, options = {}) {
  switch (type) {
    case TRANSPORT_TYPES.WEBSOCKET:
      return new WebSocketTransport(options);

    case TRANSPORT_TYPES.FLORA:
      return new FloraTransport(options);

    default:
      throw new Error(
        `Unknown transport type: "${type}". ` +
        `Supported types: ${Object.values(TRANSPORT_TYPES).join(', ')}`
      );
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  CoordinationTransport,
  WebSocketTransport,
  FloraTransport,
  createTransport,
  TRANSPORT_TYPES,
};
