const KeyProvider = require('./KeyProvider');

/**
 * EnvKeyProvider - Load private keys from environment variables
 *
 * Security Level: 🔓 MEDIUM
 *
 * Loads keys from environment variables (e.g., MULTISIG_KEY_1, MULTISIG_KEY_2).
 * More convenient than interactive prompts but less secure than encrypted files.
 *
 * SECURITY WARNINGS:
 * - Keys are stored in plaintext in .env file
 * - .env file MUST be in .gitignore
 * - File permissions should be restricted (chmod 600)
 * - Never commit .env to version control
 * - Not recommended for high-value accounts
 *
 * Usage:
 *   // .env file:
 *   MULTISIG_KEY_1=302e020100300506032b657004220420...
 *   MULTISIG_KEY_2=302e020100300506032b657004220420...
 *
 *   // Code:
 *   const provider = new EnvKeyProvider({ prefix: 'MULTISIG_KEY' });
 *   const keys = await provider.getKeys();
 */
class EnvKeyProvider extends KeyProvider {
  /**
   * Create an EnvKeyProvider
   *
   * @param {Object} options - Configuration options
   * @param {string} options.prefix - Environment variable prefix (default: 'MULTISIG_KEY')
   * @param {number} options.maxKeys - Maximum number of keys to load (default: 10)
   * @param {Array<string>} options.varNames - Explicit variable names (overrides prefix)
   */
  constructor(options = {}) {
    super();
    this.prefix = options.prefix || 'MULTISIG_KEY';
    this.maxKeys = options.maxKeys || 10;
    this.varNames = options.varNames || null;
  }

  /**
   * Get private keys from environment variables
   *
   * @returns {Promise<Array<PrivateKey>>} Array of PrivateKey objects
   * @throws {Error} If no keys found or keys are invalid
   */
  async getKeys() {
    // Check environment security
    const securityCheck = KeyProvider.checkEnvironmentSecurity();
    if (!securityCheck.secure) {
      console.warn('⚠️  Security warnings:');
      securityCheck.warnings.forEach(w => console.warn(`   - ${w}`));
      console.warn('');
    }

    // Load keys from environment
    const keyStrings = this._loadKeysFromEnv();

    if (keyStrings.length === 0) {
      throw new Error(
        `No keys found in environment variables.\n` +
        `Expected variables: ${this._getExpectedVarNames().join(', ')}\n` +
        `Make sure your .env file is loaded and contains multi-sig keys.`
      );
    }

    // Validate and parse keys
    const validation = KeyProvider.validateKeys(keyStrings);

    if (!validation.valid) {
      throw new Error(
        `Invalid keys in environment variables:\n${validation.errors.join('\n')}`
      );
    }

    console.log(`✅ Loaded ${validation.keys.length} key(s) from environment variables`);
    return validation.keys;
  }

  /**
   * Get provider name
   *
   * @returns {string} Provider name
   */
  getName() {
    return 'Environment Variables (.env)';
  }

  /**
   * Get security level
   *
   * @returns {string} Security level
   */
  getSecurityLevel() {
    return 'medium';
  }

  /**
   * Load keys from environment variables
   * @private
   */
  _loadKeysFromEnv() {
    const keys = [];

    if (this.varNames) {
      // Use explicit variable names
      for (const varName of this.varNames) {
        const value = process.env[varName];
        if (value) {
          keys.push(value);
        }
      }
    } else {
      // Use prefix with numeric suffixes (_1, _2, _3, ...)
      for (let i = 1; i <= this.maxKeys; i++) {
        const varName = `${this.prefix}_${i}`;
        const value = process.env[varName];

        if (value) {
          keys.push(value);
        } else if (i === 1) {
          // If first key is missing, also check without suffix
          const fallbackVar = this.prefix;
          const fallbackValue = process.env[fallbackVar];
          if (fallbackValue) {
            keys.push(fallbackValue);
          }
        }
      }
    }

    return keys;
  }

  /**
   * Get expected variable names for error messages
   * @private
   */
  _getExpectedVarNames() {
    if (this.varNames) {
      return this.varNames;
    }

    const names = [`${this.prefix}_1`, `${this.prefix}_2`, `${this.prefix}_3`];
    return names;
  }

  /**
   * Static helper: Check if .env file exists
   *
   * @param {string} envPath - Path to .env file (default: .env)
   * @returns {boolean} True if file exists
   */
  static envFileExists(envPath = '.env') {
    const fs = require('fs');
    const path = require('path');
    const fullPath = path.resolve(process.cwd(), envPath);
    return fs.existsSync(fullPath);
  }

  /**
   * Static helper: Load .env file
   *
   * @param {string} envPath - Path to .env file (default: .env)
   */
  static loadEnvFile(envPath = '.env') {
    require('dotenv').config({ path: envPath });
  }

  /**
   * Static helper: Validate .env file security
   *
   * Checks file permissions and .gitignore status
   *
   * @param {string} envPath - Path to .env file (default: .env)
   * @returns {Object} Security check result
   */
  static validateEnvFileSecurity(envPath = '.env') {
    const fs = require('fs');
    const path = require('path');
    const warnings = [];

    const fullPath = path.resolve(process.cwd(), envPath);

    if (!fs.existsSync(fullPath)) {
      warnings.push(`.env file not found at ${fullPath}`);
      return { secure: false, warnings };
    }

    // Check file permissions (Unix-like systems only)
    if (process.platform !== 'win32') {
      try {
        const stats = fs.statSync(fullPath);
        const mode = stats.mode & parseInt('777', 8);

        // Warn if file is readable by group or others
        if ((mode & parseInt('077', 8)) !== 0) {
          warnings.push(
            `.env file has overly permissive permissions (${mode.toString(8)}). ` +
            `Run: chmod 600 ${envPath}`
          );
        }
      } catch (error) {
        warnings.push(`Could not check file permissions: ${error.message}`);
      }
    }

    // Check if .env is in .gitignore
    const gitignorePath = path.resolve(process.cwd(), '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, 'utf8');
      if (!gitignore.includes('.env')) {
        warnings.push(
          `.env file is NOT in .gitignore! Add it immediately to prevent ` +
          `accidentally committing private keys.`
        );
      }
    } else {
      warnings.push(
        `No .gitignore file found. Create one and add .env to prevent ` +
        `accidentally committing private keys.`
      );
    }

    return {
      secure: warnings.length === 0,
      warnings
    };
  }

  /**
   * Display security recommendations
   */
  static displaySecurityRecommendations() {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║     ENVIRONMENT VARIABLE SECURITY GUIDE               ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    console.log('✅ RECOMMENDED PRACTICES:\n');
    console.log('  1. Add .env to .gitignore (CRITICAL)');
    console.log('  2. Set file permissions: chmod 600 .env');
    console.log('  3. Never share .env file via email or chat');
    console.log('  4. Use separate keys for testnet and mainnet');
    console.log('  5. Rotate keys regularly\n');

    console.log('⚠️  SECURITY WARNINGS:\n');
    console.log('  - Keys stored in PLAINTEXT in .env file');
    console.log('  - Anyone with file access can read keys');
    console.log('  - Keys may appear in backups and logs');
    console.log('  - Not recommended for high-value accounts\n');

    console.log('🔐 HIGHER SECURITY OPTIONS:\n');
    console.log('  - Use PromptKeyProvider (interactive prompts)');
    console.log('  - Use EncryptedFileProvider (AES-256-GCM encrypted)');
    console.log('  - Use hardware wallets for production (future support)\n');

    console.log('📝 EXAMPLE .env FORMAT:\n');
    console.log('  MULTISIG_KEY_1=302e020100300506032b657004220420...');
    console.log('  MULTISIG_KEY_2=302e020100300506032b657004220420...');
    console.log('  MULTISIG_KEY_3=302e020100300506032b657004220420...\n');
  }
}

module.exports = EnvKeyProvider;
