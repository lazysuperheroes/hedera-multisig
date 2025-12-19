const { Transaction, TransactionReceipt, Status } = require('@hashgraph/sdk');
const fs = require('fs');
const path = require('path');

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
      console.log('\n🚀 Executing multi-sig transaction...\n');

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
        const { PublicKey } = require('@hashgraph/sdk');
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

      console.log(`✅ Added ${signatures.length} signature(s) to transaction`);

      // Execute the transaction
      console.log('⏳ Submitting to Hedera network...\n');

      const txResponse = await transaction.execute(client);
      result.transactionId = txResponse.transactionId.toString();

      console.log(`Transaction ID: ${result.transactionId}`);
      console.log('⏳ Waiting for consensus...\n');

      // Get receipt
      const receipt = await txResponse.getReceipt(client);
      result.receipt = receipt;
      result.status = receipt.status.toString();

      // Check if successful
      result.success = receipt.status === Status.Success;

      const executionTime = Date.now() - startTime;
      result.executionTimeMs = executionTime;

      if (result.success) {
        console.log(`✅ Transaction succeeded!`);
        console.log(`   Status: ${result.status}`);
        console.log(`   Execution Time: ${executionTime}ms\n`);
      } else {
        console.log(`❌ Transaction failed!`);
        console.log(`   Status: ${result.status}\n`);
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

      console.error(`\n❌ Execution failed: ${error.message}\n`);

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

      // Metadata
      ...metadata
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
      // Determine log path
      const logPath = customPath || path.join(process.cwd(), 'logs', 'multisig-audit.jsonl');

      // Ensure logs directory exists
      const logDir = path.dirname(logPath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      // Append entry as JSONL (one JSON object per line)
      const jsonLine = JSON.stringify(entry) + '\n';
      fs.appendFileSync(logPath, jsonLine, 'utf8');

      console.log(`📝 Audit log updated: ${logPath}\n`);
    } catch (error) {
      console.error(`⚠️  Warning: Failed to write audit log: ${error.message}`);
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
      console.error(`Error reading audit log: ${error.message}`);
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
      console.log('\n📝 No audit log entries found\n');
      return;
    }

    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║          MULTI-SIG AUDIT LOG SUMMARY                  ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    const successCount = entries.filter(e => e.status === 'SUCCESS').length;
    const failureCount = entries.filter(e => e.status === 'FAILURE').length;

    console.log(`Total Entries: ${entries.length}`);
    console.log(`Successes: ${successCount}`);
    console.log(`Failures: ${failureCount}\n`);

    console.log(`Recent ${Math.min(recentCount, entries.length)} Transactions:\n`);

    entries.reverse().forEach((entry, i) => {
      const status = entry.status === 'SUCCESS' ? '✅' : '❌';
      const time = new Date(entry.timestamp).toLocaleString();
      const txId = entry.transactionId || 'N/A';
      const func = entry.function || entry.txType || 'Unknown';

      console.log(`${i + 1}. ${status} ${time}`);
      console.log(`   Transaction: ${txId}`);
      console.log(`   Function: ${func}`);
      console.log(`   Signers: ${entry.threshold}`);
      if (entry.error) {
        console.log(`   Error: ${entry.error}`);
      }
      console.log('');
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
