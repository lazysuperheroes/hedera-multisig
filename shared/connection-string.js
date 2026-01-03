/**
 * Connection String Utilities
 *
 * Shared module for generating and parsing connection strings.
 * Used by both CLI server and browser dApp.
 *
 * Format: hmsc:base64(JSON) where JSON = {s: serverUrl, i: sessionId, p: pin}
 *
 * @module shared/connection-string
 */

/**
 * Generate a connection string for easy sharing
 *
 * @param {string} serverUrl - WebSocket server URL
 * @param {string} sessionId - Session identifier
 * @param {string} pin - Session PIN/token
 * @returns {string} Connection string in format hmsc:base64
 */
function generateConnectionString(serverUrl, sessionId, pin) {
  const data = { s: serverUrl, i: sessionId, p: pin };
  const base64 = Buffer.from(JSON.stringify(data)).toString('base64');
  return `hmsc:${base64}`;
}

/**
 * Parse a connection string back into components
 *
 * @param {string} connStr - Connection string (hmsc:base64 format)
 * @returns {Object|null} Parsed connection data or null if invalid
 * @property {string} serverUrl - WebSocket server URL
 * @property {string} sessionId - Session identifier
 * @property {string} [pin] - Session PIN/token (optional)
 */
function parseConnectionString(connStr) {
  try {
    // Check for hmsc: prefix
    if (!connStr || !connStr.startsWith('hmsc:')) {
      return null;
    }

    const base64 = connStr.slice(5); // Remove 'hmsc:' prefix
    const json = Buffer.from(base64, 'base64').toString('utf8');
    const data = JSON.parse(json);

    // Validate required fields
    if (!data.s || !data.i) {
      return null;
    }

    return {
      serverUrl: data.s,
      sessionId: data.i,
      pin: data.p || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Validate a connection string format
 *
 * @param {string} connStr - Connection string to validate
 * @returns {boolean} True if valid format
 */
function isValidConnectionString(connStr) {
  return parseConnectionString(connStr) !== null;
}

module.exports = {
  generateConnectionString,
  parseConnectionString,
  isValidConnectionString,
};
