const KeyProvider = require('./KeyProvider');
const readlineSync = require('readline-sync');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * EncryptedFileProvider - Load private keys from AES-256-GCM encrypted files
 *
 * Security Level: 🔐 HIGH
 *
 * Stores private keys in encrypted files protected by a passphrase.
 * Uses AES-256-GCM encryption with PBKDF2 key derivation.
 *
 * SECURITY FEATURES:
 * - AES-256-GCM authenticated encryption
 * - PBKDF2 key derivation (100,000 iterations)
 * - Random salt per file
 * - Random IV per encryption
 * - Authentication tag prevents tampering
 *
 * SECURITY BENEFITS:
 * - Keys encrypted at rest
 * - Passphrase required to decrypt
 * - Protects against file theft
 * - Suitable for team key management
 *
 * TRADEOFFS:
 * - Requires passphrase entry
 * - File must be securely backed up
 * - Passphrase strength critical
 *
 * Usage:
 *   const provider = new EncryptedFileProvider('path/to/keys.encrypted');
 *   const keys = await provider.getKeys();  // Prompts for passphrase
 */
class EncryptedFileProvider extends KeyProvider {
  /**
   * Encryption algorithm configuration
   */
  static ALGORITHM = 'aes-256-gcm';
  static KEY_LENGTH = 32;  // 256 bits
  static IV_LENGTH = 16;   // 128 bits
  static SALT_LENGTH = 32; // 256 bits
  static TAG_LENGTH = 16;  // 128 bits
  static PBKDF2_ITERATIONS = 100000;
  static PBKDF2_DIGEST = 'sha256';

  /**
   * File format version
   */
  static FILE_VERSION = '1.0';

  /**
   * Create an EncryptedFileProvider
   *
   * @param {string} filePath - Path to encrypted key file
   * @param {Object} options - Configuration options
   * @param {string} options.passphrase - Passphrase (if not provided, will prompt)
   * @param {boolean} options.promptIfMissing - Prompt for passphrase if not provided (default: true)
   */
  constructor(filePath, options = {}) {
    super();
    this.filePath = filePath;
    this.passphrase = options.passphrase || null;
    this.promptIfMissing = options.promptIfMissing !== false;
  }

  /**
   * Get private keys from encrypted file
   *
   * @returns {Promise<Array<PrivateKey>>} Array of PrivateKey objects
   * @throws {Error} If file doesn't exist, passphrase incorrect, or decryption fails
   */
  async getKeys() {
    // Check file exists
    if (!fs.existsSync(this.filePath)) {
      throw new Error(
        `Encrypted key file not found: ${this.filePath}\n` +
        `Use 'node lib/multiSig/cli/createKeyFile.js' to create one.`
      );
    }

    // Get passphrase if not provided
    if (!this.passphrase && this.promptIfMissing) {
      console.log('\n🔐 Encrypted Key File\n');
      console.log(`File: ${this.filePath}\n`);

      this.passphrase = readlineSync.question('Passphrase: ', {
        hideEchoBack: true,
        mask: ''
      });

      console.log('');
    }

    if (!this.passphrase) {
      throw new Error('Passphrase required to decrypt key file');
    }

    // Read and decrypt file
    try {
      const encryptedData = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));

      // Validate file format
      this._validateEncryptedFile(encryptedData);

      // Decrypt keys
      const keyStrings = this._decryptKeys(encryptedData, this.passphrase);

      // Validate and parse keys
      const validation = KeyProvider.validateKeys(keyStrings);

      if (!validation.valid) {
        throw new Error(
          `Decrypted keys are invalid:\n${validation.errors.join('\n')}`
        );
      }

      console.log(`✅ Loaded ${validation.keys.length} key(s) from encrypted file\n`);

      return validation.keys;

    } catch (error) {
      if (error.message.includes('bad decrypt')) {
        throw new Error('Incorrect passphrase or corrupted file');
      }
      throw error;
    }
  }

  /**
   * Get provider name
   *
   * @returns {string} Provider name
   */
  getName() {
    return `Encrypted File (${path.basename(this.filePath)})`;
  }

  /**
   * Get security level
   *
   * @returns {string} Security level
   */
  getSecurityLevel() {
    return 'high';
  }

  /**
   * Validate encrypted file format
   * @private
   */
  _validateEncryptedFile(data) {
    if (!data.version) {
      throw new Error('Invalid encrypted file: missing version');
    }

    if (!data.algorithm || data.algorithm !== EncryptedFileProvider.ALGORITHM) {
      throw new Error(`Unsupported encryption algorithm: ${data.algorithm}`);
    }

    if (!data.kdf || data.kdf !== 'pbkdf2') {
      throw new Error(`Unsupported KDF: ${data.kdf}`);
    }

    if (!data.kdfParams || !data.kdfParams.salt || !data.kdfParams.iterations) {
      throw new Error('Invalid encrypted file: missing KDF parameters');
    }

    if (!data.iv || !data.authTag || !data.encrypted) {
      throw new Error('Invalid encrypted file: missing encryption data');
    }
  }

  /**
   * Decrypt keys from encrypted file
   * @private
   */
  _decryptKeys(encryptedData, passphrase) {
    // Derive key from passphrase
    const salt = Buffer.from(encryptedData.kdfParams.salt, 'hex');
    const key = crypto.pbkdf2Sync(
      passphrase,
      salt,
      encryptedData.kdfParams.iterations,
      EncryptedFileProvider.KEY_LENGTH,
      EncryptedFileProvider.PBKDF2_DIGEST
    );

    // Prepare decryption
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const authTag = Buffer.from(encryptedData.authTag, 'hex');
    const encrypted = Buffer.from(encryptedData.encrypted, 'hex');

    // Decrypt
    const decipher = crypto.createDecipheriv(
      EncryptedFileProvider.ALGORITHM,
      key,
      iv
    );

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    // Parse decrypted data
    const decryptedData = JSON.parse(decrypted.toString('utf8'));

    if (!Array.isArray(decryptedData.keys)) {
      throw new Error('Invalid encrypted file: keys must be an array');
    }

    return decryptedData.keys;
  }

  /**
   * Static helper: Create encrypted key file
   *
   * @param {Array<string>} keyStrings - Private keys to encrypt
   * @param {string} passphrase - Passphrase for encryption
   * @param {string} outputPath - Output file path
   * @param {Object} metadata - Optional metadata to include
   * @returns {Object} Encrypted file data
   */
  static createEncryptedFile(keyStrings, passphrase, outputPath, metadata = {}) {
    // Validate inputs
    if (!Array.isArray(keyStrings) || keyStrings.length === 0) {
      throw new Error('At least one key must be provided');
    }

    if (!passphrase || passphrase.length < 12) {
      throw new Error('Passphrase must be at least 12 characters');
    }

    // Validate keys
    const validation = KeyProvider.validateKeys(keyStrings);
    if (!validation.valid) {
      throw new Error(
        `Invalid keys provided:\n${validation.errors.join('\n')}`
      );
    }

    // Generate random salt and IV
    const salt = crypto.randomBytes(this.SALT_LENGTH);
    const iv = crypto.randomBytes(this.IV_LENGTH);

    // Derive encryption key from passphrase
    const key = crypto.pbkdf2Sync(
      passphrase,
      salt,
      this.PBKDF2_ITERATIONS,
      this.KEY_LENGTH,
      this.PBKDF2_DIGEST
    );

    // Prepare data to encrypt
    const dataToEncrypt = JSON.stringify({
      keys: keyStrings,
      metadata: {
        createdAt: new Date().toISOString(),
        keyCount: keyStrings.length,
        ...metadata
      }
    });

    // Encrypt
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);
    let encrypted = cipher.update(dataToEncrypt, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Create encrypted file structure
    const encryptedFile = {
      version: this.FILE_VERSION,
      algorithm: this.ALGORITHM,
      kdf: 'pbkdf2',
      kdfParams: {
        iterations: this.PBKDF2_ITERATIONS,
        salt: salt.toString('hex'),
        digest: this.PBKDF2_DIGEST
      },
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      encrypted: encrypted.toString('hex'),
      metadata: {
        created: new Date().toISOString(),
        keyCount: keyStrings.length,
        description: metadata.description || 'Multi-sig key file'
      }
    };

    // Write to file
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(
      outputPath,
      JSON.stringify(encryptedFile, null, 2),
      'utf8'
    );

    // Set restrictive file permissions (Unix-like systems)
    if (process.platform !== 'win32') {
      fs.chmodSync(outputPath, 0o600);
    }

    return encryptedFile;
  }

  /**
   * Static helper: Verify encrypted file can be decrypted
   *
   * @param {string} filePath - Path to encrypted file
   * @param {string} passphrase - Passphrase to test
   * @returns {boolean} True if passphrase is correct
   */
  static verifyPassphrase(filePath, passphrase) {
    try {
      const provider = new EncryptedFileProvider(filePath, { passphrase });
      // Try to get keys (this will fail if passphrase is wrong)
      const encryptedData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      provider._decryptKeys(encryptedData, passphrase);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Static helper: Get metadata from encrypted file without decrypting
   *
   * @param {string} filePath - Path to encrypted file
   * @returns {Object} File metadata
   */
  static getFileMetadata(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    return {
      version: data.version,
      algorithm: data.algorithm,
      kdf: data.kdf,
      iterations: data.kdfParams?.iterations,
      keyCount: data.metadata?.keyCount,
      created: data.metadata?.created,
      description: data.metadata?.description
    };
  }

  /**
   * Static helper: Display security recommendations
   */
  static displaySecurityRecommendations() {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║        ENCRYPTED FILE SECURITY GUIDE                  ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    console.log('✅ SECURITY FEATURES:\n');
    console.log('  - AES-256-GCM encryption (industry standard)');
    console.log('  - PBKDF2 key derivation (100,000 iterations)');
    console.log('  - Authentication tag prevents tampering');
    console.log('  - Random salt and IV per file\n');

    console.log('📝 BEST PRACTICES:\n');
    console.log('  1. Use a strong passphrase (minimum 12 characters)');
    console.log('  2. Include uppercase, lowercase, numbers, symbols');
    console.log('  3. Never share passphrase via insecure channels');
    console.log('  4. Store passphrase in password manager');
    console.log('  5. Keep encrypted file backed up securely');
    console.log('  6. Set restrictive file permissions (chmod 600)\n');

    console.log('⚠️  WARNINGS:\n');
    console.log('  - If you forget the passphrase, keys are UNRECOVERABLE');
    console.log('  - Passphrase strength is critical to security');
    console.log('  - Backup the encrypted file (losing it = losing keys)');
    console.log('  - Anyone with file + passphrase can access keys\n');

    console.log('💡 WHEN TO USE:\n');
    console.log('  - Team multi-sig key management');
    console.log('  - Frequent multi-sig operations');
    console.log('  - Balance of security and convenience');
    console.log('  - Automated processes with secure passphrase storage\n');
  }

  /**
   * Static helper: Generate strong passphrase
   *
   * @param {number} length - Passphrase length (default: 20)
   * @returns {string} Random passphrase
   */
  static generatePassphrase(length = 20) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
    const randomBytes = crypto.randomBytes(length);
    let passphrase = '';

    for (let i = 0; i < length; i++) {
      passphrase += chars[randomBytes[i] % chars.length];
    }

    return passphrase;
  }
}

module.exports = EncryptedFileProvider;
