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

// Known Hedera SubjectPublicKeyInfo (DER) prefixes. The CLI emits keys
// in DER form (`302a300506032b6570032100…` for ed25519,
// `302d300706052b8104000a032200…` for ECDSA secp256k1), but wallet
// integrations like HashPack/WalletConnect expose the raw key bytes
// over the wire. Without canonicalization the eligibility check on
// AUTH would treat the same key as two different values and reject
// the participant.
const ED25519_DER_PREFIX = '302a300506032b6570032100';
const ECDSA_SECP256K1_DER_PREFIX = '302d300706052b8104000a032200';

/**
 * Canonicalize a Hedera public key to lowercase raw hex.
 *
 *   - Strips a leading `0x` if present.
 *   - Lowercases.
 *   - If the result starts with a known Hedera DER prefix (ed25519 or
 *     ECDSA secp256k1), strips that too.
 *
 * Use this whenever you need to compare two public-key strings for
 * equality across producers — the CLI emits DER, browser wallets emit
 * raw, and both must match.
 *
 * @param {string} key - Public key in any of the supported encodings.
 * @returns {string} Lowercase raw-hex public key, or '' if input is empty.
 */
function toRawPublicKeyHex(key) {
  if (!key || typeof key !== 'string') return '';
  let hex = key.trim().toLowerCase();
  if (hex.startsWith('0x')) hex = hex.slice(2);
  if (hex.startsWith(ED25519_DER_PREFIX)) {
    hex = hex.slice(ED25519_DER_PREFIX.length);
  } else if (hex.startsWith(ECDSA_SECP256K1_DER_PREFIX)) {
    hex = hex.slice(ECDSA_SECP256K1_DER_PREFIX.length);
  }
  return hex;
}

module.exports = {
  timingSafeCompare,
  generateSessionId,
  generateParticipantId,
  sanitizePublicKey,
  toRawPublicKeyHex,
};
