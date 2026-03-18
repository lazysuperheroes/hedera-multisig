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
const { createLogger } = require('./logger');
const { TimerController, timerController } = require('./TimerController');

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

  // Logger
  createLogger,

  // Timer management
  TimerController,
  timerController,
};
