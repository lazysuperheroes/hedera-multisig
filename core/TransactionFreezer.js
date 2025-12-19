const crypto = require('crypto');

/**
 * TransactionFreezer - Freezes Hedera transactions and tracks expiration
 *
 * Hedera transactions have a 120-second validity window, but this class uses
 * a 110-second cutoff to account for network latency and execution overhead.
 */
class TransactionFreezer {
  /**
   * Maximum safe transaction age in seconds (110s, not 119s for safety margin)
   */
  static MAX_SAFE_AGE_SECONDS = 110;

  /**
   * Freeze a transaction and capture metadata for tracking
   *
   * @param {Transaction} transaction - Hedera SDK transaction to freeze
   * @param {Client} client - Hedera client (used to freeze with nodes)
   * @param {Object} options - Optional configuration
   * @param {Interface} options.contractInterface - ethers.js Interface for decoding (optional)
   * @returns {Promise<FrozenTransaction>} Frozen transaction with metadata
   *
   * @typedef {Object} FrozenTransaction
   * @property {Uint8Array} bytes - Raw transaction bytes
   * @property {string} base64 - Base64-encoded transaction bytes
   * @property {string} hash - SHA-256 hash for verification
   * @property {Date} frozenAt - Timestamp when transaction was frozen
   * @property {Date} expiresAt - Timestamp when transaction becomes unsafe (110s cutoff)
   * @property {Transaction} transaction - Original transaction object
   * @property {Object} txDetails - Decoded transaction details (if contractInterface provided)
   */
  static async freeze(transaction, client, options = {}) {
    try {
      // Freeze the transaction with the client
      const frozenTx = await transaction.freezeWith(client);

      // Convert to bytes for signing
      const bytes = frozenTx.toBytes();
      const base64 = Buffer.from(bytes).toString('base64');

      // Generate SHA-256 hash for verification
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');

      // Capture timestamps
      const frozenAt = new Date();
      const expiresAt = new Date(frozenAt.getTime() + (this.MAX_SAFE_AGE_SECONDS * 1000));

      // Decode transaction details if interface provided
      let txDetails = null;
      if (options.contractInterface) {
        const TransactionDecoder = require('./TransactionDecoder');
        txDetails = TransactionDecoder.decode(transaction, options.contractInterface);
      }

      return {
        bytes,
        base64,
        hash,
        frozenAt,
        expiresAt,
        transaction: frozenTx,
        txDetails
      };
    } catch (error) {
      throw new Error(`Failed to freeze transaction: ${error.message}`);
    }
  }

  /**
   * Get time remaining before transaction expires
   *
   * @param {FrozenTransaction} frozenTx - Previously frozen transaction
   * @returns {number} Seconds remaining (negative if expired)
   */
  static getTimeRemaining(frozenTx) {
    const now = new Date();
    const remaining = Math.floor((frozenTx.expiresAt - now) / 1000);
    return remaining;
  }

  /**
   * Get elapsed time since transaction was frozen
   *
   * @param {FrozenTransaction} frozenTx - Previously frozen transaction
   * @returns {number} Seconds elapsed since freezing
   */
  static getTimeElapsed(frozenTx) {
    const now = new Date();
    const elapsed = Math.floor((now - frozenTx.frozenAt) / 1000);
    return elapsed;
  }

  /**
   * Validate that transaction has not expired
   *
   * @param {FrozenTransaction} frozenTx - Previously frozen transaction
   * @throws {Error} If transaction has exceeded the 110-second safe cutoff
   */
  static validateNotExpired(frozenTx) {
    const remaining = this.getTimeRemaining(frozenTx);

    if (remaining <= 0) {
      const elapsed = this.getTimeElapsed(frozenTx);
      throw new Error(
        `Transaction expired! ${elapsed}s elapsed (max ${this.MAX_SAFE_AGE_SECONDS}s). ` +
        `You must restart the multi-sig process with a fresh transaction.`
      );
    }
  }

  /**
   * Check if transaction is nearing expiration (< 20 seconds remaining)
   *
   * @param {FrozenTransaction} frozenTx - Previously frozen transaction
   * @returns {boolean} True if less than 20 seconds remaining
   */
  static isNearingExpiration(frozenTx) {
    const remaining = this.getTimeRemaining(frozenTx);
    return remaining > 0 && remaining < 20;
  }

  /**
   * Reconstruct a frozen transaction from base64-encoded bytes
   *
   * This allows signers to work with transaction bytes shared via
   * secure channels (Signal, email, etc.) without needing the original
   * transaction object.
   *
   * @param {string} base64 - Base64-encoded transaction bytes
   * @param {number} frozenAtTimestamp - Unix timestamp (ms) when tx was frozen
   * @returns {FrozenTransaction} Reconstructed frozen transaction
   */
  static fromBase64(base64, frozenAtTimestamp) {
    try {
      const bytes = Buffer.from(base64, 'base64');

      // Generate hash for verification
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');

      // Reconstruct timestamps
      const frozenAt = new Date(frozenAtTimestamp);
      const expiresAt = new Date(frozenAt.getTime() + (this.MAX_SAFE_AGE_SECONDS * 1000));

      // Note: We can't reconstruct the full Transaction object from bytes alone,
      // but for signing purposes we only need the bytes
      return {
        bytes,
        base64,
        hash,
        frozenAt,
        expiresAt,
        transaction: null, // Will be null for reconstructed transactions
        txDetails: null
      };
    } catch (error) {
      throw new Error(`Failed to reconstruct transaction from base64: ${error.message}`);
    }
  }

  /**
   * Verify transaction bytes match the expected hash
   *
   * Prevents copy-paste errors when sharing transaction bytes
   *
   * @param {FrozenTransaction|Uint8Array} input - Frozen transaction or raw bytes
   * @param {string} expectedHash - Expected SHA-256 hash
   * @returns {boolean} True if hash matches
   */
  static verifyHash(input, expectedHash) {
    const bytes = input.bytes ? input.bytes : input;
    const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
    return actualHash === expectedHash;
  }

  /**
   * Format time remaining as human-readable string
   *
   * @param {FrozenTransaction} frozenTx - Previously frozen transaction
   * @returns {string} Formatted time (e.g., "85s", "1m 25s", "EXPIRED")
   */
  static formatTimeRemaining(frozenTx) {
    const remaining = this.getTimeRemaining(frozenTx);

    if (remaining <= 0) {
      return 'EXPIRED';
    }

    if (remaining < 60) {
      return `${remaining}s`;
    }

    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    return `${minutes}m ${seconds}s`;
  }
}

module.exports = TransactionFreezer;
