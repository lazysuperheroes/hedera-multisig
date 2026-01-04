/**
 * Shared Utilities
 *
 * Common utilities shared between CLI and browser dApp.
 *
 * @module shared
 */

const connectionString = require('./connection-string');

module.exports = {
  // Connection string utilities
  generateConnectionString: connectionString.generateConnectionString,
  parseConnectionString: connectionString.parseConnectionString,
  isValidConnectionString: connectionString.isValidConnectionString,
};
