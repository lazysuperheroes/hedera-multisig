/**
 * Crypto Abstraction Layer
 *
 * Provides async SHA-256 hashing that works in both Node.js and browser environments.
 * Uses Web Crypto API in browser, Node.js crypto module in Node.
 */

/**
 * Generate SHA-256 hash of data
 *
 * @param {Uint8Array|Buffer} data - Data to hash
 * @returns {Promise<string>} Hex-encoded hash
 */
async function sha256(data) {
  // Check if we're in a browser environment with Web Crypto API
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    // Browser: Use Web Crypto API
    const buffer = data instanceof ArrayBuffer
      ? data
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return bufferToHex(new Uint8Array(hashBuffer));
  } else {
    // Node.js: Use crypto module
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

/**
 * Generate truncated checksum (first 16 hex chars of SHA-256)
 *
 * @param {Uint8Array|Buffer} data - Data to hash
 * @returns {Promise<string>} 16-character hex checksum
 */
async function generateChecksum(data) {
  const hash = await sha256(data);
  return hash.substring(0, 16);
}

/**
 * Convert Uint8Array to hex string
 *
 * @param {Uint8Array} buffer - Buffer to convert
 * @returns {string} Hex string
 */
function bufferToHex(buffer) {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 *
 * @param {string} hex - Hex string
 * @returns {Uint8Array} Buffer
 */
function hexToBuffer(hex) {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

module.exports = {
  sha256,
  generateChecksum,
  bufferToHex,
  hexToBuffer
};
