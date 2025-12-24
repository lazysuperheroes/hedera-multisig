/**
 * Server Module
 *
 * Provides real-time multi-signature coordination via WebSocket server.
 * Enables interactive signing sessions with remote participants.
 *
 * @module server
 */

const SessionStore = require('./SessionStore');
const SigningSessionManager = require('./SigningSessionManager');
const WebSocketServer = require('./WebSocketServer');

module.exports = {
  SessionStore,
  SigningSessionManager,
  WebSocketServer
};
