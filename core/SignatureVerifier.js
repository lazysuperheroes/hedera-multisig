const { PublicKey } = require('@hashgraph/sdk');
const crypto = require('crypto');
const { extractAllBodyBytes } = require('../shared/transaction-decoder');

/**
 * SignatureVerifier - Cryptographic verification of transaction signatures
 *
 * Critical security component - validates signatures mathematically before
 * executing multi-sig transactions. Never trust user input without verification.
 */
class SignatureVerifier {
  /**
   * Verify all signatures against frozen transaction
   *
   * @param {FrozenTransaction} frozenTx - Frozen transaction from TransactionFreezer
   * @param {Array<SignatureTuple>} signatures - Array of signature tuples
   * @param {Object} options - Verification options
   * @param {Array<string>} options.expectedPublicKeys - List of expected public keys (optional)
   * @param {number} options.threshold - Minimum required signatures (optional, for validation)
   * @returns {Promise<VerificationResult>} Verification results
   *
   * @typedef {Object} SignatureTuple
   * @property {string} publicKey - Public key (hex or DER format)
   * @property {string} signature - Signature (base64 or hex)
   *
   * @typedef {Object} VerificationResult
   * @property {boolean} valid - True if all signatures are valid
   * @property {number} validCount - Number of valid signatures
   * @property {number} totalCount - Total signatures provided
   * @property {Array<SignatureStatus>} details - Per-signature verification details
   * @property {Array<string>} errors - Any verification errors
   *
   * @typedef {Object} SignatureStatus
   * @property {string} publicKey - Public key
   * @property {boolean} valid - Signature is cryptographically valid
   * @property {string} error - Error message if invalid
   */
  static async verify(frozenTx, signatures, options = {}) {
    const result = {
      valid: false,
      validCount: 0,
      totalCount: signatures.length,
      details: [],
      errors: []
    };

    if (!frozenTx || !frozenTx.bytes) {
      result.errors.push('Invalid frozen transaction: missing bytes');
      return result;
    }

    if (!signatures || signatures.length === 0) {
      result.errors.push('No signatures provided');
      return result;
    }

    // Verify each signature
    for (const sigTuple of signatures) {
      const status = await this.verifySingle(frozenTx, sigTuple);
      result.details.push(status);

      if (status.valid) {
        result.validCount++;
      }
    }

    // Check if we have expected public keys (whitelist)
    if (options.expectedPublicKeys && options.expectedPublicKeys.length > 0) {
      const validKeys = result.details
        .filter(d => d.valid)
        .map(d => d.publicKey);

      const unexpectedKeys = validKeys.filter(
        key => !options.expectedPublicKeys.includes(key)
      );

      if (unexpectedKeys.length > 0) {
        result.errors.push(`Unexpected public keys: ${unexpectedKeys.join(', ')}`);
        result.valid = false;
        return result;
      }
    }

    // Check threshold if specified
    if (options.threshold) {
      const thresholdMet = this.checkThreshold(options.threshold, result.validCount);
      if (!thresholdMet) {
        result.errors.push(
          `Insufficient signatures: ${result.validCount}/${options.threshold} required`
        );
        result.valid = false;
        return result;
      }
    }

    // Overall validity: when threshold is specified, validity means threshold is met
    // When no threshold, all signatures must be valid
    if (options.threshold) {
      result.valid = result.validCount >= options.threshold && result.errors.length === 0;
    } else {
      result.valid = result.validCount === result.totalCount && result.errors.length === 0;
    }

    return result;
  }

  /**
   * Verify a single signature
   *
   * @param {FrozenTransaction} frozenTx - Frozen transaction
   * @param {SignatureTuple} sigTuple - Signature tuple (publicKey + signature)
   * @returns {Promise<SignatureStatus>} Verification status
   */
  static async verifySingle(frozenTx, sigTuple) {
    const status = {
      publicKey: sigTuple.publicKey,
      valid: false,
      error: null
    };

    try {
      // Parse public key
      let publicKey;
      try {
        publicKey = PublicKey.fromString(sigTuple.publicKey);
      } catch (error) {
        status.error = `Invalid public key format: ${error.message}`;
        return status;
      }

      // Multi-node freeze: each SignedTransaction body has a distinct
      // nodeAccountID, so we expect one signature per body — passed as
      // `signatures: string[]`. Legacy single-sig (`signature: string`)
      // is accepted by promoting it to a 1-element array; in that case
      // we verify against the matching first body.
      let inputSigs;
      if (Array.isArray(sigTuple.signatures) && sigTuple.signatures.length > 0) {
        inputSigs = sigTuple.signatures;
      } else if (typeof sigTuple.signature === 'string' && sigTuple.signature.length > 0) {
        inputSigs = [sigTuple.signature];
      } else {
        status.error = 'No signature(s) provided in tuple';
        return status;
      }

      let bodies;
      try {
        bodies = extractAllBodyBytes(frozenTx.bytes);
      } catch (extractErr) {
        status.error = `Could not extract bodyBytes for verification: ${extractErr.message}`;
        return status;
      }

      // Tolerate single-sig submission against multi-node freeze (older
      // signers): only verify the first pair, but flag the mismatch so
      // executor can decide whether to reject.
      const pairCount = Math.min(inputSigs.length, bodies.length);
      if (pairCount === 0) {
        status.error = 'Empty signatures and/or empty signable body list';
        return status;
      }

      let allValid = true;
      let firstError = null;
      for (let i = 0; i < pairCount; i++) {
        const sigStr = inputSigs[i];
        let signatureBytes;
        try {
          signatureBytes = sigStr.startsWith('0x')
            ? Buffer.from(sigStr.slice(2), 'hex')
            : Buffer.from(sigStr, 'base64');
        } catch (error) {
          allValid = false;
          firstError = `Signature[${i}] invalid format: ${error.message}`;
          break;
        }

        const isValid = publicKey.verify(bodies[i], signatureBytes);
        if (!isValid) {
          allValid = false;
          firstError = `Signature[${i}] does not match bodyBytes[${i}]`;
          break;
        }
      }

      if (allValid && inputSigs.length !== bodies.length) {
        // Partial verification — first pair valid but caller passed
        // fewer sigs than bodies. Surface as soft error so the executor
        // sees it but legacy single-sig flows still pass cryptographic
        // verification against bodyBytes[0].
        status.partial = true;
        status.expectedCount = bodies.length;
        status.providedCount = inputSigs.length;
      }

      if (allValid) {
        status.valid = true;
      } else {
        status.error = firstError || 'Signature verification failed';
      }
    } catch (error) {
      status.error = `Verification failed: ${error.message}`;
    }

    return status;
  }

  /**
   * Check if threshold is met
   *
   * @param {number} threshold - Required number of signatures
   * @param {number} providedCount - Number of valid signatures provided
   * @returns {boolean} True if threshold is met
   */
  static checkThreshold(threshold, providedCount) {
    return providedCount >= threshold;
  }

  /**
   * Validate signature tuple format
   *
   * Multi-node form: "publicKey:sig0,sig1,...,sigN" — one base64 sig
   * per SignedTransaction body. Legacy single-sig form
   * "publicKey:sig" round-trips as a 1-element array.
   *
   * @param {string} input - Signature tuple string
   * @returns {{publicKey: string, signature: string, signatures: string[]}|null}
   */
  static parseSignatureTuple(input) {
    if (!input || typeof input !== 'string') {
      return null;
    }

    // Public key uses ':' inside DER-prefix, so split on the LAST colon.
    // Format invariant: everything before the last ':' is the public key,
    // everything after is the signature(s).
    const colonIndex = input.lastIndexOf(':');
    if (colonIndex === -1) {
      return null;
    }

    const publicKey = input.substring(0, colonIndex);
    const sigField = input.substring(colonIndex + 1);

    if (!publicKey || !sigField) {
      return null;
    }

    // Public key should be hex (64 chars) or DER format (starts with 302a or 302e)
    const isValidPubKey = /^[0-9a-fA-F]{64}$/.test(publicKey) ||
                          /^302[ae][0-9a-fA-F]+$/.test(publicKey);

    if (!isValidPubKey) {
      return null;
    }

    const signatures = sigField.split(',').map((s) => s.trim()).filter(Boolean);
    if (signatures.length === 0) {
      return null;
    }

    // Each signature must be base64 or hex
    const sigRegex = /^([A-Za-z0-9+/]+=*|(0x)?[0-9a-fA-F]+)$/;
    for (const s of signatures) {
      if (!sigRegex.test(s)) return null;
    }

    return {
      publicKey,
      signature: signatures[0], // legacy single-sig consumers
      signatures
    };
  }

  /**
   * Validate multiple signature tuples
   *
   * @param {Array<string>} inputs - Array of signature tuple strings
   * @returns {Object} Validation result with parsed tuples and errors
   */
  static parseMultipleSignatureTuples(inputs) {
    const result = {
      valid: [],
      invalid: [],
      errors: []
    };

    for (let i = 0; i < inputs.length; i++) {
      const parsed = this.parseSignatureTuple(inputs[i]);
      if (parsed) {
        result.valid.push(parsed);
      } else {
        result.invalid.push(inputs[i]);
        result.errors.push(`Signature ${i + 1} has invalid format: ${inputs[i]}`);
      }
    }

    return result;
  }

  /**
   * Generate a checksum for transaction bytes
   *
   * Useful for users to verify they're signing the correct transaction
   * (prevents copy-paste errors)
   *
   * @param {FrozenTransaction|Uint8Array} input - Frozen transaction or bytes
   * @returns {string} SHA-256 checksum (first 8 chars for display)
   */
  static generateChecksum(input) {
    const bytes = input.bytes ? input.bytes : input;
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    return hash.substring(0, 16); // First 16 chars for readability
  }

  /**
   * Verify checksum matches transaction bytes
   *
   * @param {FrozenTransaction|Uint8Array} input - Frozen transaction or bytes
   * @param {string} expectedChecksum - Expected checksum
   * @returns {boolean} True if checksum matches
   */
  static verifyChecksum(input, expectedChecksum) {
    const actualChecksum = this.generateChecksum(input);
    return actualChecksum === expectedChecksum;
  }

  /**
   * Extract public key from a Hedera PrivateKey
   *
   * Utility for getting the public key string from a PrivateKey object
   *
   * @param {PrivateKey} privateKey - Hedera SDK PrivateKey
   * @returns {string} Public key string
   */
  static getPublicKeyString(privateKey) {
    return privateKey.publicKey.toString();
  }

  /**
   * Format verification result for display
   *
   * @param {VerificationResult} result - Verification result
   * @returns {string} Formatted result
   */
  static formatResult(result) {
    let output = '\n';
    output += '═══════════════════════════════════════\n';
    output += '   SIGNATURE VERIFICATION RESULTS\n';
    output += '═══════════════════════════════════════\n\n';

    output += `Status: ${result.valid ? '✅ VALID' : '❌ INVALID'}\n`;
    output += `Valid Signatures: ${result.validCount}/${result.totalCount}\n`;

    if (result.errors.length > 0) {
      output += '\nErrors:\n';
      result.errors.forEach(err => {
        output += `  ❌ ${err}\n`;
      });
    }

    if (result.details.length > 0) {
      output += '\nSignature Details:\n';
      result.details.forEach((detail, i) => {
        const status = detail.valid ? '✅' : '❌';
        const pubKeyShort = detail.publicKey.substring(0, 10) + '...' +
                           detail.publicKey.substring(detail.publicKey.length - 4);
        output += `  ${i + 1}. ${status} ${pubKeyShort}`;
        if (detail.error) {
          output += ` - ${detail.error}`;
        }
        output += '\n';
      });
    }

    output += '\n';
    return output;
  }
}

module.exports = SignatureVerifier;
