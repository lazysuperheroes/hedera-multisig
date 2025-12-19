const { PublicKey } = require('@hashgraph/sdk');
const crypto = require('crypto');

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

    // Overall validity: all signatures must be valid
    result.valid = result.validCount === result.totalCount && result.errors.length === 0;

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

      // Parse signature (support both base64 and hex)
      let signatureBytes;
      try {
        if (sigTuple.signature.startsWith('0x')) {
          // Hex format
          signatureBytes = Buffer.from(sigTuple.signature.slice(2), 'hex');
        } else {
          // Base64 format
          signatureBytes = Buffer.from(sigTuple.signature, 'base64');
        }
      } catch (error) {
        status.error = `Invalid signature format: ${error.message}`;
        return status;
      }

      // Verify signature cryptographically
      const isValid = publicKey.verify(frozenTx.bytes, signatureBytes);

      if (isValid) {
        status.valid = true;
      } else {
        status.error = 'Signature does not match transaction bytes';
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
   * @param {string} input - Signature tuple string (format: "publicKey:signature")
   * @returns {SignatureTuple|null} Parsed tuple or null if invalid
   */
  static parseSignatureTuple(input) {
    if (!input || typeof input !== 'string') {
      return null;
    }

    const parts = input.split(':');
    if (parts.length !== 2) {
      return null;
    }

    const [publicKey, signature] = parts;

    // Basic validation
    if (!publicKey || !signature) {
      return null;
    }

    // Public key should be hex (64 chars) or DER format (starts with 302a or 302e)
    const isValidPubKey = /^[0-9a-fA-F]{64}$/.test(publicKey) ||
                          /^302[ae][0-9a-fA-F]+$/.test(publicKey);

    if (!isValidPubKey) {
      return null;
    }

    // Signature should be base64 or hex
    const isValidSig = /^[A-Za-z0-9+/]+=*$/.test(signature) || // base64
                       /^(0x)?[0-9a-fA-F]+$/.test(signature);  // hex

    if (!isValidSig) {
      return null;
    }

    return { publicKey, signature };
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
