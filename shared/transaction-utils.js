/**
 * Shared Transaction Utilities
 *
 * Common transaction handling functions used by WebSocketServer,
 * SigningSessionManager, and other modules.
 */

/**
 * Normalize frozen transaction to standard format.
 * Ensures consistent format: { bytes: Buffer, base64: string, transaction?: Transaction }
 *
 * Handles four input formats:
 * 1. Plain base64 string
 * 2. Object with base64 property
 * 3. Object with bytes property only
 * 4. Object with transaction property (SDK Transaction object)
 *
 * @param {string|Object} frozenTransaction - Frozen transaction in various formats
 * @returns {{ bytes: Buffer, base64: string, transaction?: Object }|null} Normalized format or null
 */
function normalizeFrozenTransaction(frozenTransaction) {
  if (!frozenTransaction) {
    return null;
  }

  let bytes;
  let base64;
  let transaction;

  // Format 1: Plain base64 string
  if (typeof frozenTransaction === 'string') {
    base64 = frozenTransaction;
    bytes = Buffer.from(base64, 'base64');
  }
  // Format 2: Object with base64 property
  else if (frozenTransaction.base64) {
    base64 = frozenTransaction.base64;
    bytes = frozenTransaction.bytes
      ? Buffer.from(frozenTransaction.bytes)
      : Buffer.from(base64, 'base64');
    transaction = frozenTransaction.transaction || undefined;
  }
  // Format 3: Object with bytes property only
  else if (frozenTransaction.bytes) {
    bytes = Buffer.from(frozenTransaction.bytes);
    base64 = bytes.toString('base64');
    transaction = frozenTransaction.transaction || undefined;
  }
  // Format 4: Object with transaction.toBytes()
  else if (frozenTransaction.transaction && typeof frozenTransaction.transaction.toBytes === 'function') {
    transaction = frozenTransaction.transaction;
    bytes = Buffer.from(transaction.toBytes());
    base64 = bytes.toString('base64');
  }
  else {
    return null;
  }

  const result = { bytes, base64 };
  if (transaction) {
    result.transaction = transaction;
  }
  return result;
}

module.exports = {
  normalizeFrozenTransaction,
};
