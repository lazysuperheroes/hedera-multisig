const readlineSync = require('readline-sync');
const TransactionFreezer = require('./TransactionFreezer');
const TransactionDecoder = require('./TransactionDecoder');
const SignatureVerifier = require('./SignatureVerifier');
const log = require('../shared/logger').createLogger('SignatureCollector');

/**
 * SignatureCollector - Collect signatures from multiple signers
 *
 * Supports two workflows:
 * 1. Offline/Air-gapped: Share transaction bytes via secure channels (Signal, email)
 *    and manually collect signatures. Ideal for air-gapped signing machines.
 *
 * 2. Interactive/Real-time: All signers available now, collect signatures live
 *    with countdown timer. Must complete within 110-second window.
 *
 * ALWAYS displays decoded transaction details before collecting signatures
 * to give users full transparency about what they're signing.
 */
class SignatureCollector {
  /**
   * Collect signatures in interactive mode (real-time)
   *
   * All signers must be available now. Live countdown timer shows time remaining.
   * Must complete within 110-second window.
   *
   * @param {FrozenTransaction} frozenTx - Frozen transaction from TransactionFreezer
   * @param {number} requiredSignatures - Number of signatures needed
   * @param {Object} options - Collection options
   * @param {number} options.timeout - Override timeout in seconds (default: 100s)
   * @param {Array<PrivateKey>} options.localKeys - Keys to sign with automatically
   * @param {boolean} options.verbose - Show detailed transaction info (default: false)
   * @returns {Promise<Array<SignatureTuple>>} Collected signatures
   */
  static async collectInteractive(frozenTx, requiredSignatures, options = {}) {
    const timeout = options.timeout || 100;
    const localKeys = options.localKeys || [];
    const verbose = options.verbose || false;

    log.info('MULTI-SIGNATURE COLLECTION (Real-Time Mode)');

    // Display transaction details
    if (frozenTx.txDetails) {
      TransactionDecoder.display(frozenTx.txDetails, { verbose });
    }

    // Display transaction bytes and checksum
    log.info('TRANSACTION BYTES (for signing):');
    log.info(frozenTx.base64);
    log.info('Checksum: %s', SignatureVerifier.generateChecksum(frozenTx));
    log.info('Time Limit: %ds, Required Signatures: %d', timeout, requiredSignatures);

    const signatures = [];

    // Sign with local keys if provided
    if (localKeys.length > 0) {
      log.info('Signing with %d local key(s)...', localKeys.length);

      for (const privateKey of localKeys) {
        const signature = this._signWithPrivateKey(frozenTx, privateKey);
        signatures.push(signature);
        log.info('Local signature %d/%d', signatures.length, requiredSignatures);
      }
    }

    // Collect remaining signatures if needed
    const remaining = requiredSignatures - signatures.length;

    if (remaining > 0) {
      log.info('Collecting %d additional signature(s)...', remaining);

      // Start countdown timer
      const startTime = Date.now();
      let countdownInterval = null;

      let expired = false;

      try {
        countdownInterval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const timeLeft = timeout - elapsed;

          if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
            expired = true;
            log.warn('TIMEOUT: Transaction validity window expired.');
          }

          // Warning at 20 seconds
          if (timeLeft === 20) {
            log.warn('WARNING: Only 20 seconds remaining!');
          }
        }, 1000);

        // Collect signatures
        for (let i = 0; i < remaining; i++) {
          if (expired) {
            throw new Error('Timeout! Transaction validity window expired.');
          }

          const timeLeft = timeout - Math.floor((Date.now() - startTime) / 1000);
          log.info('Remaining: %ds', timeLeft);

          const sigTuple = this._promptForSignature(i + localKeys.length + 1, requiredSignatures);
          signatures.push(sigTuple);

          log.info('Signature %d/%d received', signatures.length, requiredSignatures);
        }

        clearInterval(countdownInterval);
      } catch (error) {
        if (countdownInterval) clearInterval(countdownInterval);
        throw error;
      }
    }

    log.info('All signatures collected!');
    return signatures;
  }

  /**
   * Collect signatures in offline mode (manual coordination)
   *
   * Share transaction bytes via secure channels (Signal, email, USB drive).
   * Signers sign on their own machines (possibly air-gapped) and send back signatures.
   * No time pressure - can take hours/days if needed.
   *
   * @param {FrozenTransaction} frozenTx - Frozen transaction from TransactionFreezer
   * @param {number} requiredSignatures - Number of signatures needed
   * @param {Object} options - Collection options
   * @param {Array<PrivateKey>} options.localKeys - Keys to sign with automatically
   * @param {boolean} options.verbose - Show detailed transaction info (default: false)
   * @returns {Promise<Array<SignatureTuple>>} Collected signatures
   */
  static async collectOffline(frozenTx, requiredSignatures, options = {}) {
    const localKeys = options.localKeys || [];
    const verbose = options.verbose || false;

    log.info('MULTI-SIGNATURE COLLECTION (Offline Mode)');

    // Display transaction details
    if (frozenTx.txDetails) {
      TransactionDecoder.display(frozenTx.txDetails, { verbose });
    }

    // Display transaction bytes for sharing
    log.info('TRANSACTION BYTES (share with signers):');
    log.info(frozenTx.base64);
    log.info('Checksum: %s', SignatureVerifier.generateChecksum(frozenTx));
    log.info('Frozen at: %s', frozenTx.frozenAt.toISOString());
    log.info('Expires at: %s', frozenTx.expiresAt.toISOString());
    log.info('Time remaining: %s', TransactionFreezer.formatTimeRemaining(frozenTx));

    log.info('SHARE WITH SIGNERS: 1) Send transaction bytes via secure channel 2) Include checksum 3) Signers use: hedera-multisig sign 4) Collect signature tuples');

    const signatures = [];

    // Sign with local keys if provided
    if (localKeys.length > 0) {
      log.info('Signing with %d local key(s)...', localKeys.length);

      for (const privateKey of localKeys) {
        const signature = this._signWithPrivateKey(frozenTx, privateKey);
        signatures.push(signature);
        log.info('Local signature %d/%d', signatures.length, requiredSignatures);
      }
    }

    // Collect remaining signatures if needed
    const remaining = requiredSignatures - signatures.length;

    if (remaining > 0) {
      log.info('Waiting for %d signature(s) from other signers...', remaining);

      const proceed = readlineSync.keyInYN('Have you collected all signatures? ');
      if (!proceed) {
        throw new Error('Signature collection cancelled by user');
      }

      const count = readlineSync.questionInt(`How many signatures did you collect? (need ${remaining}): `);

      if (count < remaining) {
        throw new Error(`Insufficient signatures: collected ${count}, need ${remaining}`);
      }

      // Collect signature tuples
      for (let i = 0; i < count; i++) {
        const sigTuple = this._promptForSignature(i + localKeys.length + 1, requiredSignatures);
        signatures.push(sigTuple);
        log.info('Signature %d/%d received', signatures.length, requiredSignatures);
      }
    }

    // Verify transaction hasn't expired
    try {
      TransactionFreezer.validateNotExpired(frozenTx);
    } catch (error) {
      log.error('Transaction has expired! You must restart the multi-sig process with a fresh transaction.');
      throw error;
    }

    log.info('All signatures collected!');
    return signatures;
  }

  /**
   * Sign transaction with a private key (internal use)
   * @private
   */
  static _signWithPrivateKey(frozenTx, privateKey) {
    const signature = privateKey.sign(frozenTx.bytes);
    const publicKey = privateKey.publicKey.toString();
    const signatureBase64 = Buffer.from(signature).toString('base64');

    return {
      publicKey,
      signature: signatureBase64
    };
  }

  /**
   * Prompt user for a signature tuple
   * @private
   */
  static _promptForSignature(current, total) {
    const prompt = `📝 Signature ${current}/${total} (format: publicKey:signature): `;
    const input = readlineSync.question(prompt);

    // Parse signature tuple
    const parsed = SignatureVerifier.parseSignatureTuple(input);

    if (!parsed) {
      log.error('Invalid signature format! Expected: publicKey:signatureBase64 (Example: 302a300506032b6570...e92d:AQIDBA...xyz)');
      throw new Error('Invalid signature format');
    }

    return parsed;
  }

  /**
   * Validate signature tuple input format
   *
   * @param {string} input - Signature tuple string (format: "publicKey:signature")
   * @returns {SignatureTuple|null} Parsed tuple or null if invalid
   */
  static validateSignatureTuple(input) {
    return SignatureVerifier.parseSignatureTuple(input);
  }

  /**
   * Generate signatures from multiple private keys
   *
   * Utility for testing or when all keys are available locally
   *
   * @param {FrozenTransaction} frozenTx - Frozen transaction
   * @param {Array<PrivateKey>} privateKeys - Array of PrivateKey objects
   * @returns {Array<SignatureTuple>} Generated signatures
   */
  static generateSignatures(frozenTx, privateKeys) {
    const signatures = [];

    for (const privateKey of privateKeys) {
      const signature = this._signWithPrivateKey(frozenTx, privateKey);
      signatures.push(signature);
    }

    return signatures;
  }

  /**
   * Display instructions for offline signers
   *
   * @param {FrozenTransaction} frozenTx - Frozen transaction
   */
  static displayOfflineSignerInstructions(frozenTx) {
    log.info('INSTRUCTIONS FOR OFFLINE SIGNERS');
    log.info('Transaction bytes: %s', frozenTx.base64);
    log.info('Checksum: %s', SignatureVerifier.generateChecksum(frozenTx));
    log.info('Steps: 1) Save transaction bytes 2) Verify checksum 3) Run: hedera-multisig sign 4) Paste bytes, verify, enter key, copy output 5) Send signature back via secure channel');
    log.info('Transaction frozen at: %s, expires at: %s, time remaining: %s',
      frozenTx.frozenAt.toISOString(),
      frozenTx.expiresAt.toISOString(),
      TransactionFreezer.formatTimeRemaining(frozenTx)
    );
  }

  /**
   * Display signature collection progress
   *
   * @param {number} collected - Number of signatures collected
   * @param {number} required - Number of signatures required
   * @param {FrozenTransaction} frozenTx - Frozen transaction (for time tracking)
   */
  static displayProgress(collected, required, frozenTx) {
    const percentage = Math.floor((collected / required) * 100);
    const timeRemaining = TransactionFreezer.formatTimeRemaining(frozenTx);

    log.info('SIGNATURE COLLECTION PROGRESS: Collected %d/%d (%d%%), Time Remaining: %s',
      collected, required, percentage, timeRemaining
    );
  }
}

module.exports = SignatureCollector;
