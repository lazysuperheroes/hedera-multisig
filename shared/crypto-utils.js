/**
 * Shared Cryptographic Utilities
 *
 * Common crypto functions used by SessionStore, RedisSessionStore,
 * and other modules. Single source of truth to prevent duplication.
 */

const crypto = require('crypto');

/**
 * Timing-safe string comparison to prevent timing attacks.
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings are equal
 */
function timingSafeCompare(a, b) {
  if (!a || !b) {
    return false;
  }

  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  if (bufA.length !== bufB.length) {
    // Compare against a dummy to maintain constant time, then return false
    const dummy = Buffer.alloc(bufA.length, 0);
    crypto.timingSafeEqual(bufA, dummy);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generate a cryptographically random session ID (16 bytes, hex-encoded).
 *
 * @returns {string} 32-character hex string
 */
function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate a cryptographically random participant ID (8 bytes, hex-encoded).
 *
 * @returns {string} 16-character hex string
 */
function generateParticipantId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Sanitize a public key for display/logging (first 6 + last 4 chars).
 *
 * @param {string} publicKey - Full public key string
 * @returns {string} Sanitized key like "302a30...ab12"
 */
function sanitizePublicKey(publicKey) {
  if (!publicKey || publicKey.length < 12) {
    return '***';
  }
  return publicKey.substring(0, 6) + '...' + publicKey.substring(publicKey.length - 4);
}

module.exports = {
  timingSafeCompare,
  generateSessionId,
  generateParticipantId,
  sanitizePublicKey,
};
