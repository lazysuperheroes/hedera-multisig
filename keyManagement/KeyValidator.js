const { PrivateKey, PublicKey } = require('@hashgraph/sdk');

/**
 * KeyValidator - Comprehensive validation for Hedera keys
 *
 * Validates private keys, public keys, and key file formats.
 * Ensures keys are in correct format before use to prevent errors.
 */
class KeyValidator {
  /**
   * Validate a private key string
   *
   * @param {string} keyString - Private key to validate
   * @returns {ValidationResult} Validation result
   *
   * @typedef {Object} ValidationResult
   * @property {boolean} valid - True if valid
   * @property {string} format - Key format detected (e.g., 'DER', 'raw_hex')
   * @property {string} type - Key type (e.g., 'ED25519')
   * @property {Array<string>} errors - Validation errors
   * @property {Array<string>} warnings - Validation warnings
   */
  static validatePrivateKey(keyString) {
    const result = {
      valid: false,
      format: null,
      type: null,
      errors: [],
      warnings: []
    };

    // Check basic requirements
    if (!keyString || typeof keyString !== 'string') {
      result.errors.push('Key must be a non-empty string');
      return result;
    }

    const trimmed = keyString.trim();

    if (trimmed.length === 0) {
      result.errors.push('Key string is empty');
      return result;
    }

    // Check for common mistakes
    if (trimmed.includes(' ')) {
      result.warnings.push('Key contains spaces - will be removed');
    }

    if (trimmed.includes('\n') || trimmed.includes('\r')) {
      result.warnings.push('Key contains newlines - will be removed');
    }

    // Try to parse with Hedera SDK (try different formats)
    let privateKey = null;
    let parseMethod = null;

    // Try DER format first (most common)
    try {
      privateKey = PrivateKey.fromStringDer(trimmed);
      parseMethod = 'DER';
    } catch (e) {
      // Try Ed25519 raw format
      try {
        privateKey = PrivateKey.fromStringED25519(trimmed);
        parseMethod = 'ED25519_RAW';
      } catch (e2) {
        // Try ECDSA raw format
        try {
          privateKey = PrivateKey.fromStringECDSA(trimmed);
          parseMethod = 'ECDSA_RAW';
        } catch (e3) {
          // All parsing methods failed
          result.valid = false;
          result.errors.push(`Invalid key format: ${e.message}`);
        }
      }
    }

    if (privateKey) {
      result.valid = true;

      // Determine algorithm based on parse method that succeeded
      if (parseMethod === 'DER') {
        // For DER, check the DER bytes to determine type
        if (trimmed.startsWith('302e')) {
          result.type = 'ED25519';
        } else if (trimmed.startsWith('3030')) {
          result.type = 'ECDSA_SECP256K1';
        } else {
          result.type = 'UNKNOWN';
        }
        result.format = 'DER';
      } else if (parseMethod === 'ED25519_RAW') {
        result.type = 'ED25519';
        result.format = 'raw_hex_ed25519';
      } else if (parseMethod === 'ECDSA_RAW') {
        result.type = 'ECDSA_SECP256K1';
        result.format = 'raw_hex_ecdsa';
      } else {
        result.type = 'unknown';
        result.format = 'unknown';
      }

      // Verify the key is not all zeros (common test key mistake)
      if (trimmed.match(/^0+$/)) {
        result.warnings.push('Key is all zeros - likely a placeholder, not secure');
      }
    }

    // Provide helpful suggestions if parsing failed
    if (!result.valid && trimmed.length < 64) {
      result.errors.push('Key too short - Hedera private keys should be DER encoded or raw hex');
    }

    return result;
  }

  /**
   * Validate a public key string
   *
   * @param {string} keyString - Public key to validate
   * @returns {ValidationResult} Validation result
   */
  static validatePublicKey(keyString) {
    const result = {
      valid: false,
      format: null,
      type: null,
      errors: [],
      warnings: []
    };

    if (!keyString || typeof keyString !== 'string') {
      result.errors.push('Key must be a non-empty string');
      return result;
    }

    const trimmed = keyString.trim();

    // Try to parse with Hedera SDK (try different formats)
    let publicKey = null;
    let parseMethod = null;

    // Try DER format first (most common)
    try {
      publicKey = PublicKey.fromStringDer(trimmed);
      parseMethod = 'DER';
    } catch (e) {
      // Try Ed25519 raw format
      try {
        publicKey = PublicKey.fromStringED25519(trimmed);
        parseMethod = 'ED25519_RAW';
      } catch (e2) {
        // Try ECDSA raw format
        try {
          publicKey = PublicKey.fromStringECDSA(trimmed);
          parseMethod = 'ECDSA_RAW';
        } catch (e3) {
          // All parsing methods failed
          result.valid = false;
          result.errors.push(`Invalid public key format: ${e.message}`);
        }
      }
    }

    if (publicKey) {
      result.valid = true;

      // Determine algorithm based on parse method that succeeded
      if (parseMethod === 'DER') {
        // For DER, check the DER bytes to determine type
        if (trimmed.startsWith('302a') || trimmed.startsWith('302e')) {
          result.type = 'ED25519';
        } else if (trimmed.startsWith('302d')) {
          result.type = 'ECDSA_SECP256K1';
        } else {
          result.type = 'UNKNOWN';
        }
        result.format = 'DER';
      } else if (parseMethod === 'ED25519_RAW') {
        result.type = 'ED25519';
        result.format = 'raw_hex_ed25519';
      } else if (parseMethod === 'ECDSA_RAW') {
        result.type = 'ECDSA_SECP256K1';
        result.format = 'raw_hex_ecdsa';
      } else {
        result.type = 'unknown';
        result.format = 'unknown';
      }
    }

    return result;
  }

  /**
   * Validate an array of private keys
   *
   * @param {Array<string>} keyStrings - Array of private key strings
   * @returns {BatchValidationResult} Validation result for all keys
   *
   * @typedef {Object} BatchValidationResult
   * @property {boolean} allValid - True if all keys are valid
   * @property {number} validCount - Number of valid keys
   * @property {number} totalCount - Total number of keys
   * @property {Array<ValidationResult>} results - Individual validation results
   * @property {Array<string>} errors - Aggregate errors
   */
  static validatePrivateKeys(keyStrings) {
    const batchResult = {
      allValid: true,
      validCount: 0,
      totalCount: keyStrings.length,
      results: [],
      errors: []
    };

    if (!Array.isArray(keyStrings)) {
      batchResult.allValid = false;
      batchResult.errors.push('Input must be an array of key strings');
      return batchResult;
    }

    if (keyStrings.length === 0) {
      batchResult.allValid = false;
      batchResult.errors.push('At least one key must be provided');
      return batchResult;
    }

    for (let i = 0; i < keyStrings.length; i++) {
      const result = this.validatePrivateKey(keyStrings[i]);
      batchResult.results.push(result);

      if (result.valid) {
        batchResult.validCount++;
      } else {
        batchResult.allValid = false;
        batchResult.errors.push(`Key ${i + 1}: ${result.errors.join(', ')}`);
      }
    }

    return batchResult;
  }

  /**
   * Validate signature tuple format
   *
   * @param {string} tuple - Signature tuple string (format: "publicKey:signature")
   * @returns {ValidationResult} Validation result
   */
  static validateSignatureTuple(tuple) {
    const result = {
      valid: false,
      format: 'signature_tuple',
      type: null,
      errors: [],
      warnings: []
    };

    if (!tuple || typeof tuple !== 'string') {
      result.errors.push('Signature tuple must be a non-empty string');
      return result;
    }

    const parts = tuple.split(':');

    if (parts.length !== 2) {
      result.errors.push('Signature tuple must be in format: publicKey:signature');
      result.errors.push('Example: 302a300506032b6570...e92d:AQIDBA...xyz');
      return result;
    }

    const [publicKey, signature] = parts;

    // Validate public key part
    const pubKeyValidation = this.validatePublicKey(publicKey);
    if (!pubKeyValidation.valid) {
      result.errors.push(`Invalid public key: ${pubKeyValidation.errors.join(', ')}`);
      return result;
    }

    // Validate signature part (base64 or hex)
    if (!signature || signature.length === 0) {
      result.errors.push('Signature part is empty');
      return result;
    }

    const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(signature);
    const isHex = /^(0x)?[0-9a-fA-F]+$/.test(signature);

    if (!isBase64 && !isHex) {
      result.errors.push('Signature must be base64 or hex format');
      return result;
    }

    // Check signature length is reasonable (both ED25519 and ECDSA signatures are 64 bytes)
    let signatureBytes;
    try {
      if (signature.startsWith('0x')) {
        signatureBytes = Buffer.from(signature.slice(2), 'hex');
      } else if (isHex) {
        signatureBytes = Buffer.from(signature, 'hex');
      } else {
        signatureBytes = Buffer.from(signature, 'base64');
      }

      if (signatureBytes.length !== 64) {
        result.warnings.push(
          `Signature is ${signatureBytes.length} bytes (expected 64 for ED25519/ECDSA)`
        );
      }
    } catch (error) {
      result.errors.push(`Invalid signature encoding: ${error.message}`);
      return result;
    }

    result.valid = true;
    result.type = 'signature_tuple';

    return result;
  }

  /**
   * Validate key count against threshold configuration
   *
   * @param {number} keyCount - Number of keys available
   * @param {number} threshold - Required signatures
   * @param {number} maxSigners - Maximum signers allowed (optional)
   * @returns {ValidationResult} Validation result
   */
  static validateThresholdConfig(keyCount, threshold, maxSigners = null) {
    const result = {
      valid: true,
      format: 'threshold_config',
      type: null,
      errors: [],
      warnings: []
    };

    if (!Number.isInteger(keyCount) || keyCount < 0) {
      result.valid = false;
      result.errors.push('Key count must be a non-negative integer');
    }

    if (!Number.isInteger(threshold) || threshold < 1) {
      result.valid = false;
      result.errors.push('Threshold must be a positive integer');
    }

    if (maxSigners !== null) {
      if (!Number.isInteger(maxSigners) || maxSigners < 1) {
        result.valid = false;
        result.errors.push('Max signers must be a positive integer');
      }

      if (keyCount > maxSigners) {
        result.valid = false;
        result.errors.push(
          `Too many keys provided: ${keyCount} keys, max ${maxSigners} signers`
        );
      }
    }

    if (keyCount < threshold) {
      result.valid = false;
      result.errors.push(
        `Insufficient keys: have ${keyCount}, need ${threshold} for threshold`
      );
    }

    if (threshold > keyCount) {
      result.warnings.push(
        `Threshold (${threshold}) exceeds available keys (${keyCount})`
      );
    }

    // Common multi-sig configurations
    if (keyCount === threshold) {
      result.warnings.push(
        `${threshold}-of-${keyCount} multi-sig (all signatures required)`
      );
    } else {
      result.warnings.push(
        `${threshold}-of-${keyCount} multi-sig (${keyCount - threshold} backup signers)`
      );
    }

    return result;
  }

  /**
   * Sanitize a private key for error messages
   * Never shows full key, only last 4 characters
   *
   * @param {string} privateKey - Private key to sanitize
   * @returns {string} Sanitized representation
   */
  static sanitizePrivateKey(privateKey) {
    if (!privateKey || privateKey.length < 4) {
      return '***';
    }
    return `***${privateKey.substring(privateKey.length - 4)}`;
  }

  /**
   * Sanitize a public key for logging
   * Shows first 6 and last 4 characters
   *
   * @param {string} publicKey - Public key to sanitize
   * @returns {string} Sanitized representation
   */
  static sanitizePublicKey(publicKey) {
    if (!publicKey || publicKey.length < 12) {
      return '***';
    }
    return publicKey.substring(0, 6) + '...' + publicKey.substring(publicKey.length - 4);
  }

  /**
   * Check if a string looks like a private key (dangerous!)
   * Used to prevent accidental logging of private keys
   *
   * @param {string} str - String to check
   * @returns {boolean} True if string looks like a private key
   */
  static looksLikePrivateKey(str) {
    if (!str || typeof str !== 'string') {
      return false;
    }

    // DER format private key
    if (str.startsWith('302e020100300506032b657004220420')) {
      return true;
    }

    // Raw hex private key (64 chars)
    if (str.length === 64 && /^[0-9a-fA-F]+$/.test(str)) {
      // Could be private key, but also could be other hex data
      // Return true to be safe
      return true;
    }

    return false;
  }

  /**
   * Display validation result in readable format
   *
   * @param {ValidationResult} result - Validation result to display
   */
  static displayValidationResult(result) {
    if (result.valid) {
      console.log('✅ Validation Passed');
      if (result.format) {
        console.log(`   Format: ${result.format}`);
      }
      if (result.type) {
        console.log(`   Type: ${result.type}`);
      }
    } else {
      console.log('❌ Validation Failed');
    }

    if (result.errors && result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach(err => console.log(`  ❌ ${err}`));
    }

    if (result.warnings && result.warnings.length > 0) {
      console.log('\nWarnings:');
      result.warnings.forEach(warn => console.log(`  ⚠️  ${warn}`));
    }

    console.log('');
  }
}

module.exports = KeyValidator;
