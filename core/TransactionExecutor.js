const { Transaction, TransactionReceipt, Status, PublicKey } = require('@hashgraph/sdk');
const fs = require('fs');
const path = require('path');
const log = require('../shared/logger').createLogger('TransactionExecutor');

/**
 * TransactionExecutor - Execute multi-sig transactions with audit logging
 *
 * Takes a frozen transaction with collected signatures, adds them to the
 * transaction, executes on Hedera network, and logs to audit trail.
 *
 * Audit Trail Security:
 * - Append-only JSONL format (tamper-resistant)
 * - Logs transaction hash, signers (sanitized), outcome
 * - Never logs private keys or full signatures
 * - Stored in logs/multisig-audit.jsonl
 */
class TransactionExecutor {
  /**
   * Execute a multi-sig transaction
   *
   * @param {FrozenTransaction} frozenTx - Frozen transaction with signatures
   * @param {Array<SignatureTuple>} signatures - Collected signatures
   * @param {Client} client - Hedera client
   * @param {Object} options - Execution options
   * @param {boolean} options.skipAuditLog - Skip audit logging (default: false)
   * @param {string} options.auditLogPath - Custom audit log path
   * @param {Object} options.metadata - Additional metadata for audit log
   * @returns {Promise<ExecutionResult>} Execution result with receipt
   *
   * @typedef {Object} ExecutionResult
   * @property {boolean} success - True if transaction succeeded
   * @property {TransactionReceipt} receipt - Transaction receipt
   * @property {string} transactionId - Transaction ID
   * @property {number} executionTimeMs - Execution time in milliseconds
   * @property {string} status - Transaction status
   * @property {Object} auditLog - Audit log entry (if enabled)
   * @property {string} error - Error message (if failed)
   */
  static async execute(frozenTx, signatures, client, options = {}) {
    const startTime = Date.now();
    const result = {
      success: false,
      receipt: null,
      transactionId: null,
      executionTimeMs: 0,
      status: null,
      auditLog: null,
      error: null
    };

    try {
      log.info('Executing multi-sig transaction...');

      // Reconstruct transaction from bytes
      let transaction;
      if (frozenTx.transaction) {
        // Use existing transaction object
        transaction = frozenTx.transaction;
      } else {
        // Reconstruct from bytes
        transaction = Transaction.fromBytes(frozenTx.bytes);
      }

      // Add all signatures to the transaction
      for (const sigTuple of signatures) {
        const publicKey = PublicKey.fromString(sigTuple.publicKey);

        // Parse signature (support both base64 and hex)
        let signatureBytes;
        if (sigTuple.signature.startsWith('0x')) {
          signatureBytes = Buffer.from(sigTuple.signature.slice(2), 'hex');
        } else {
          signatureBytes = Buffer.from(sigTuple.signature, 'base64');
        }

        transaction.addSignature(publicKey, signatureBytes);
      }

      log.info('Added %d signature(s) to transaction', signatures.length);

      // Execute the transaction
      log.info('Submitting to Hedera network...');

      const txResponse = await transaction.execute(client);
      result.transactionId = txResponse.transactionId.toString();

      log.info('Transaction ID: %s', result.transactionId);
      log.info('Waiting for consensus...');

      // Get receipt
      const receipt = await txResponse.getReceipt(client);
      result.receipt = receipt;
      result.status = receipt.status.toString();

      // Check if successful
      result.success = receipt.status === Status.Success;

      const executionTime = Date.now() - startTime;
      result.executionTimeMs = executionTime;

      if (result.success) {
        log.info('Transaction succeeded', { status: result.status, executionTimeMs: executionTime });
      } else {
        log.error('Transaction failed', { status: result.status });
        result.error = `Transaction failed with status: ${result.status}`;
      }

      // Create audit log entry
      if (!options.skipAuditLog) {
        const auditEntry = this._createAuditEntry(
          frozenTx,
          signatures,
          result,
          options.metadata
        );
        result.auditLog = auditEntry;

        // Write to audit log
        this._appendAuditLog(auditEntry, options.auditLogPath);
      }

    } catch (error) {
      result.success = false;
      result.error = error.message;
      result.executionTimeMs = Date.now() - startTime;

      log.error('Execution failed: %s', error.message);

      // Log failure to audit trail
      if (!options.skipAuditLog) {
        const auditEntry = this._createAuditEntry(
          frozenTx,
          signatures,
          result,
          options.metadata
        );
        result.auditLog = auditEntry;
        this._appendAuditLog(auditEntry, options.auditLogPath);
      }

      throw error;
    }

    return result;
  }

  /**
   * Create an audit log entry
   * @private
   */
  static _createAuditEntry(frozenTx, signatures, result, metadata = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      transactionId: result.transactionId,
      status: result.success ? 'SUCCESS' : 'FAILURE',
      executionTimeMs: result.executionTimeMs,

      // Transaction details
      txHash: frozenTx.hash,
      frozenAt: frozenTx.frozenAt.toISOString(),
      expiresAt: frozenTx.expiresAt.toISOString(),

      // Transaction info (if available)
      contract: frozenTx.txDetails?.contract || null,
      function: frozenTx.txDetails?.function || null,
      txType: frozenTx.txDetails?.type || null,

      // Signature info (sanitized)
      threshold: signatures.length,
      signers: signatures.map(s => ({
        publicKey: this._sanitizePublicKey(s.publicKey),
        signedAt: new Date().toISOString()
      })),

      // Result
      receiptStatus: result.status,
      error: result.error || null,

      // Metadata (namespaced to prevent overwriting critical fields)
      metadata: metadata || {}
    };

    return entry;
  }

  /**
   * Sanitize public key for logging (first 6 + last 4 chars)
   * @private
   */
  static _sanitizePublicKey(publicKey) {
    if (!publicKey || publicKey.length < 12) {
      return '***';
    }
    return publicKey.substring(0, 6) + '...' + publicKey.substring(publicKey.length - 4);
  }

  /**
   * Append entry to audit log (JSONL format)
   * @private
   */
  static _appendAuditLog(entry, customPath = null) {
    try {
      // Determine log path with path traversal protection
      const defaultPath = path.join(process.cwd(), 'logs', 'multisig-audit.jsonl');
      let logPath = customPath || defaultPath;

      // Validate custom path stays within allowed directory
      if (customPath) {
        const resolvedPath = path.resolve(customPath);
        const allowedBase = path.resolve(process.cwd());
        if (!resolvedPath.startsWith(allowedBase)) {
          log.warn('Audit log path outside project directory rejected: %s', customPath);
          logPath = defaultPath;
        }
      }

      // Ensure logs directory exists
      const logDir = path.dirname(logPath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      // Append entry as JSONL (one JSON object per line)
      const jsonLine = JSON.stringify(entry) + '\n';
      fs.appendFileSync(logPath, jsonLine, 'utf8');

      log.info('Audit log updated: %s', logPath);
    } catch (error) {
      log.warn('Failed to write audit log: %s', error.message);
      // Don't throw - audit log failure shouldn't break execution
    }
  }

  /**
   * Read audit log entries
   *
   * @param {Object} options - Read options
   * @param {string} options.logPath - Custom audit log path
   * @param {number} options.limit - Maximum entries to return (default: 100)
   * @param {string} options.filter - Filter by status ('SUCCESS', 'FAILURE')
   * @returns {Array<Object>} Audit log entries
   */
  static readAuditLog(options = {}) {
    const logPath = options.logPath || path.join(process.cwd(), 'logs', 'multisig-audit.jsonl');
    const limit = options.limit || 100;

    if (!fs.existsSync(logPath)) {
      return [];
    }

    try {
      const content = fs.readFileSync(logPath, 'utf8');
      const lines = content.trim().split('\n');

      let entries = lines
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line));

      // Apply filter if specified
      if (options.filter) {
        entries = entries.filter(e => e.status === options.filter);
      }

      // Apply limit (return most recent)
      if (entries.length > limit) {
        entries = entries.slice(-limit);
      }

      return entries;
    } catch (error) {
      log.error('Error reading audit log: %s', error.message);
      return [];
    }
  }

  /**
   * Display audit log summary
   *
   * @param {Object} options - Display options
   * @param {number} options.recentCount - Number of recent entries to show (default: 10)
   */
  static displayAuditSummary(options = {}) {
    const recentCount = options.recentCount || 10;
    const entries = this.readAuditLog({ limit: recentCount });

    if (entries.length === 0) {
      log.info('No audit log entries found');
      return;
    }

    const successCount = entries.filter(e => e.status === 'SUCCESS').length;
    const failureCount = entries.filter(e => e.status === 'FAILURE').length;

    log.info('Audit log summary', {
      totalEntries: entries.length,
      successes: successCount,
      failures: failureCount
    });

    entries.reverse().forEach((entry, i) => {
      const time = new Date(entry.timestamp).toLocaleString();
      const txId = entry.transactionId || 'N/A';
      const func = entry.function || entry.txType || 'Unknown';

      log.info('Transaction %d: %s at %s (ID: %s, Function: %s, Signers: %d%s)',
        i + 1, entry.status, time, txId, func, entry.threshold,
        entry.error ? `, Error: ${entry.error}` : ''
      );
    });
  }

  /**
   * Verify audit log integrity
   *
   * Checks that the audit log hasn't been tampered with by verifying
   * the append-only nature (entries should be in chronological order)
   *
   * @param {string} logPath - Path to audit log
   * @returns {Object} Integrity check result
   */
  static verifyAuditLogIntegrity(logPath = null) {
    const entries = this.readAuditLog({ logPath, limit: Infinity });

    const result = {
      valid: true,
      totalEntries: entries.length,
      warnings: [],
      errors: []
    };

    if (entries.length === 0) {
      result.warnings.push('No entries in audit log');
      return result;
    }

    // Check chronological order
    let lastTimestamp = null;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      if (!entry.timestamp) {
        result.valid = false;
        result.errors.push(`Entry ${i + 1}: Missing timestamp`);
        continue;
      }

      const currentTimestamp = new Date(entry.timestamp);

      if (lastTimestamp && currentTimestamp < lastTimestamp) {
        result.valid = false;
        result.errors.push(
          `Entry ${i + 1}: Out of chronological order ` +
          `(${currentTimestamp.toISOString()} < ${lastTimestamp.toISOString()})`
        );
      }

      lastTimestamp = currentTimestamp;
    }

    return result;
  }
}

module.exports = TransactionExecutor;
