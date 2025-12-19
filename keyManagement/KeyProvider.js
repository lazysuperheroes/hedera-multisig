const { PrivateKey } = require('@hashgraph/sdk');

/**
 * KeyProvider - Abstract base class for multi-sig key management
 *
 * Defines the interface for pluggable key sources. Implementations provide
 * different security/convenience tradeoffs:
 *
 * Security Tiers:
 * 1. 🔒 PromptKeyProvider (highest) - Interactive prompts, keys never stored
 * 2. 🔐 EncryptedFileProvider (high) - AES-256-GCM encrypted files with passphrase
 * 3. 🔓 EnvKeyProvider (medium) - Environment variables (validated, documented risks)
 *
 * Usage:
 *   const provider = new PromptKeyProvider();
 *   const keys = await provider.getKeys();
 */
class KeyProvider {
  /**
   * Get private keys from the key source
   *
   * @returns {Promise<Array<PrivateKey>>} Array of Hedera PrivateKey objects
   * @throws {Error} If keys cannot be retrieved or are invalid
   */
  async getKeys() {
    throw new Error('KeyProvider.getKeys() must be implemented by subclass');
  }

  /**
   * Get a human-readable name for this key provider
   *
   * Used in logging and user prompts to identify the key source
   *
   * @returns {string} Provider name (e.g., "Interactive Prompt", ".env file")
   */
  getName() {
    throw new Error('KeyProvider.getName() must be implemented by subclass');
  }

  /**
   * Get security level of this key provider
   *
   * @returns {string} Security level: 'high', 'medium', or 'low'
   */
  getSecurityLevel() {
    return 'unknown';
  }

  /**
   * Validate a private key string
   *
   * Checks if a string is a valid Hedera private key format
   *
   * @param {string} keyString - Private key string to validate
   * @returns {boolean} True if valid
   */
  static isValidPrivateKey(keyString) {
    if (!keyString || typeof keyString !== 'string') {
      return false;
    }

    const trimmed = keyString.trim();

    // Try DER format first
    try {
      PrivateKey.fromStringDer(trimmed);
      return true;
    } catch (e1) {
      // Try Ed25519 raw format
      try {
        PrivateKey.fromStringED25519(trimmed);
        return true;
      } catch (e2) {
        // Try ECDSA raw format
        try {
          PrivateKey.fromStringECDSA(trimmed);
          return true;
        } catch (e3) {
          return false;
        }
      }
    }
  }

  /**
   * Parse a private key string into a PrivateKey object
   *
   * @param {string} keyString - Private key string
   * @returns {PrivateKey} Parsed PrivateKey object
   * @throws {Error} If key is invalid
   */
  static parsePrivateKey(keyString) {
    const trimmed = keyString.trim();

    // Try different parsing methods
    // Try DER format first (most common)
    try {
      return PrivateKey.fromStringDer(trimmed);
    } catch (e1) {
      // Try Ed25519 raw format
      try {
        return PrivateKey.fromStringED25519(trimmed);
      } catch (e2) {
        // Try ECDSA raw format
        try {
          return PrivateKey.fromStringECDSA(trimmed);
        } catch (e3) {
          throw new Error(`Invalid private key format: ${e1.message}`);
        }
      }
    }
  }

  /**
   * Validate an array of private key strings
   *
   * @param {Array<string>} keyStrings - Array of private key strings
   * @returns {Object} Validation result
   *
   * @typedef {Object} KeyValidationResult
   * @property {boolean} valid - True if all keys are valid
   * @property {Array<PrivateKey>} keys - Parsed PrivateKey objects
   * @property {Array<string>} errors - Validation errors
   */
  static validateKeys(keyStrings) {
    const result = {
      valid: true,
      keys: [],
      errors: []
    };

    if (!Array.isArray(keyStrings)) {
      result.valid = false;
      result.errors.push('Keys must be provided as an array');
      return result;
    }

    if (keyStrings.length === 0) {
      result.valid = false;
      result.errors.push('At least one key must be provided');
      return result;
    }

    for (let i = 0; i < keyStrings.length; i++) {
      try {
        const key = this.parsePrivateKey(keyStrings[i]);
        result.keys.push(key);
      } catch (error) {
        result.valid = false;
        result.errors.push(`Key ${i + 1}: ${error.message}`);
      }
    }

    return result;
  }

  /**
   * Sanitize a public key for logging (show first 6 + last 4 chars)
   *
   * @param {string} publicKey - Public key string
   * @returns {string} Sanitized public key
   */
  static sanitizePublicKey(publicKey) {
    if (!publicKey || publicKey.length < 12) {
      return '***';
    }
    return publicKey.substring(0, 6) + '...' + publicKey.substring(publicKey.length - 4);
  }

  /**
   * Sanitize a private key for error messages (never show full key)
   *
   * @param {string} privateKey - Private key string
   * @returns {string} Sanitized representation
   */
  static sanitizePrivateKey(privateKey) {
    if (!privateKey) {
      return '***';
    }
    return `***${privateKey.substring(privateKey.length - 4)}`;
  }

  /**
   * Check if running in a secure environment
   *
   * Warns if keys are being used in potentially insecure contexts
   *
   * @returns {Object} Security check result
   */
  static checkEnvironmentSecurity() {
    const warnings = [];

    // Check if running in CI environment
    if (process.env.CI === 'true') {
      warnings.push('Running in CI environment - ensure secrets are properly protected');
    }

    // Check if running with debug logging enabled
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      warnings.push('Debug mode enabled - keys may be logged');
    }

    // Check if running as root (Unix-like systems)
    if (process.getuid && process.getuid() === 0) {
      warnings.push('Running as root user - consider using a dedicated user');
    }

    return {
      secure: warnings.length === 0,
      warnings
    };
  }

  /**
   * Helper to validate key count matches expected threshold configuration
   *
   * @param {number} keyCount - Number of keys available
   * @param {number} threshold - Required signatures
   * @param {number} totalSigners - Total number of signers (optional)
   */
  static validateKeyCountForThreshold(keyCount, threshold, totalSigners = null) {
    if (keyCount < 1) {
      throw new Error('At least one key must be provided');
    }

    if (threshold < 1) {
      throw new Error('Threshold must be at least 1');
    }

    if (keyCount < threshold) {
      throw new Error(
        `Insufficient keys: have ${keyCount}, need ${threshold} for threshold`
      );
    }

    if (totalSigners && keyCount > totalSigners) {
      throw new Error(
        `Too many keys: have ${keyCount}, maximum ${totalSigners} signers configured`
      );
    }
  }
}

module.exports = KeyProvider;
