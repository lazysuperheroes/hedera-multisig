const readlineSync = require('readline-sync');
const TransactionFreezer = require('./TransactionFreezer');
const TransactionDecoder = require('./TransactionDecoder');
const SignatureVerifier = require('./SignatureVerifier');

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

    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║     MULTI-SIGNATURE COLLECTION (Real-Time Mode)       ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    // Display transaction details
    if (frozenTx.txDetails) {
      TransactionDecoder.display(frozenTx.txDetails, { verbose });
    }

    // Display transaction bytes and checksum
    console.log('TRANSACTION BYTES (for signing):');
    console.log(frozenTx.base64);
    console.log('');
    console.log(`Checksum: ${SignatureVerifier.generateChecksum(frozenTx)}`);
    console.log('');

    console.log(`⏱️  Time Limit: ${timeout}s`);
    console.log(`🔑  Required Signatures: ${requiredSignatures}\n`);

    const signatures = [];

    // Sign with local keys if provided
    if (localKeys.length > 0) {
      console.log(`🔐 Signing with ${localKeys.length} local key(s)...\n`);

      for (const privateKey of localKeys) {
        const signature = this._signWithPrivateKey(frozenTx, privateKey);
        signatures.push(signature);
        console.log(`✅ Local signature ${signatures.length}/${requiredSignatures}`);
      }

      console.log('');
    }

    // Collect remaining signatures if needed
    const remaining = requiredSignatures - signatures.length;

    if (remaining > 0) {
      console.log(`📝 Collecting ${remaining} additional signature(s)...\n`);

      // Start countdown timer
      const startTime = Date.now();
      let countdownInterval = null;

      try {
        countdownInterval = setInterval(() => {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const timeLeft = timeout - elapsed;

          if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            throw new Error('Timeout! Transaction validity window expired.');
          }

          // Warning at 20 seconds
          if (timeLeft === 20) {
            console.log('\n⚠️  WARNING: Only 20 seconds remaining!\n');
          }
        }, 1000);

        // Collect signatures
        for (let i = 0; i < remaining; i++) {
          const timeLeft = timeout - Math.floor((Date.now() - startTime) / 1000);
          console.log(`⏳ Remaining: ${timeLeft}s`);

          const sigTuple = this._promptForSignature(i + localKeys.length + 1, requiredSignatures);
          signatures.push(sigTuple);

          console.log(`✅ Signature ${signatures.length}/${requiredSignatures} received\n`);
        }

        clearInterval(countdownInterval);
      } catch (error) {
        if (countdownInterval) clearInterval(countdownInterval);
        throw error;
      }
    }

    console.log('✅ All signatures collected!\n');
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

    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║     MULTI-SIGNATURE COLLECTION (Offline Mode)         ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    // Display transaction details
    if (frozenTx.txDetails) {
      TransactionDecoder.display(frozenTx.txDetails, { verbose });
    }

    // Display transaction bytes for sharing
    console.log('TRANSACTION BYTES (share with signers):');
    console.log('─────────────────────────────────────────────────────────');
    console.log(frozenTx.base64);
    console.log('─────────────────────────────────────────────────────────');
    console.log('');
    console.log(`Checksum: ${SignatureVerifier.generateChecksum(frozenTx)}`);
    console.log('');
    console.log(`Frozen at: ${frozenTx.frozenAt.toISOString()}`);
    console.log(`Expires at: ${frozenTx.expiresAt.toISOString()}`);
    console.log(`Time remaining: ${TransactionFreezer.formatTimeRemaining(frozenTx)}\n`);

    console.log('📤 SHARE WITH SIGNERS:');
    console.log('  1. Send transaction bytes via secure channel (Signal, encrypted email)');
    console.log('  2. Include checksum for verification');
    console.log('  3. Signers use: node lib/multiSig/cli/sign.js');
    console.log('  4. Collect signature tuples (publicKey:signature)\n');

    const signatures = [];

    // Sign with local keys if provided
    if (localKeys.length > 0) {
      console.log(`🔐 Signing with ${localKeys.length} local key(s)...\n`);

      for (const privateKey of localKeys) {
        const signature = this._signWithPrivateKey(frozenTx, privateKey);
        signatures.push(signature);
        console.log(`✅ Local signature ${signatures.length}/${requiredSignatures}`);
      }

      console.log('');
    }

    // Collect remaining signatures if needed
    const remaining = requiredSignatures - signatures.length;

    if (remaining > 0) {
      console.log(`📝 Waiting for ${remaining} signature(s) from other signers...\n`);

      const proceed = readlineSync.keyInYN('Have you collected all signatures? ');
      if (!proceed) {
        throw new Error('Signature collection cancelled by user');
      }

      console.log('');

      const count = readlineSync.questionInt(`How many signatures did you collect? (need ${remaining}): `);

      if (count < remaining) {
        throw new Error(`Insufficient signatures: collected ${count}, need ${remaining}`);
      }

      console.log('');

      // Collect signature tuples
      for (let i = 0; i < count; i++) {
        const sigTuple = this._promptForSignature(i + localKeys.length + 1, requiredSignatures);
        signatures.push(sigTuple);
        console.log(`✅ Signature ${signatures.length}/${requiredSignatures} received\n`);
      }
    }

    // Verify transaction hasn't expired
    try {
      TransactionFreezer.validateNotExpired(frozenTx);
    } catch (error) {
      console.error('\n❌ ERROR: Transaction has expired!');
      console.error('   You must restart the multi-sig process with a fresh transaction.\n');
      throw error;
    }

    console.log('✅ All signatures collected!\n');
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
      console.error('\n❌ Invalid signature format!');
      console.error('   Expected: publicKey:signatureBase64');
      console.error('   Example: 302a300506032b6570...e92d:AQIDBA...xyz\n');
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
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║          INSTRUCTIONS FOR OFFLINE SIGNERS             ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    console.log('📋 STEPS FOR SIGNING:\n');

    console.log('1. Save these transaction bytes to a file or copy to clipboard:');
    console.log('   ─────────────────────────────────────────────────────');
    console.log(`   ${frozenTx.base64}`);
    console.log('   ─────────────────────────────────────────────────────\n');

    console.log('2. Verify the checksum matches:');
    console.log(`   Checksum: ${SignatureVerifier.generateChecksum(frozenTx)}\n`);

    console.log('3. On your signing machine, run:');
    console.log('   node lib/multiSig/cli/sign.js\n');

    console.log('4. When prompted:');
    console.log('   - Paste the transaction bytes');
    console.log('   - Verify the transaction details');
    console.log('   - Enter your private key');
    console.log('   - Copy the signature tuple output\n');

    console.log('5. Send the signature tuple back via secure channel\n');

    console.log('⏰ IMPORTANT:');
    console.log(`   - Transaction frozen at: ${frozenTx.frozenAt.toISOString()}`);
    console.log(`   - Transaction expires at: ${frozenTx.expiresAt.toISOString()}`);
    console.log(`   - Time remaining: ${TransactionFreezer.formatTimeRemaining(frozenTx)}`);
    console.log('   - All signatures must be collected before expiration\n');
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

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('SIGNATURE COLLECTION PROGRESS');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Collected: ${collected}/${required} (${percentage}%)`);
    console.log(`Time Remaining: ${timeRemaining}`);
    console.log('═══════════════════════════════════════════════════════\n');
  }
}

module.exports = SignatureCollector;
