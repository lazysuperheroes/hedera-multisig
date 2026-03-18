/**
 * Shared Utilities
 *
 * Common utilities shared between server, CLI, and browser dApp.
 *
 * @module shared
 */

const connectionString = require('./connection-string');
const protocol = require('./protocol');
const cryptoUtils = require('./crypto-utils');
const transactionUtils = require('./transaction-utils');
const errors = require('./errors');
const { createLogger } = require('./logger');
const { TimerController, timerController } = require('./TimerController');
const {
  CoordinationTransport,
  WebSocketTransport,
  FloraTransport,
  createTransport,
  TRANSPORT_TYPES,
} = require('./CoordinationTransport');

module.exports = {
  // Connection string utilities
  generateConnectionString: connectionString.generateConnectionString,
  parseConnectionString: connectionString.parseConnectionString,
  isValidConnectionString: connectionString.isValidConnectionString,

  // Protocol definitions
  ...protocol,

  // Crypto utilities
  ...cryptoUtils,

  // Transaction utilities
  ...transactionUtils,

  // Error classes
  ...errors,

  // Logger
  createLogger,

  // Timer management
  TimerController,
  timerController,

  // Coordination transport abstraction
  CoordinationTransport,
  WebSocketTransport,
  FloraTransport,
  createTransport,
  TRANSPORT_TYPES,
};
