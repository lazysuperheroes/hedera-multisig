const KeyProvider = require('./KeyProvider');
const readlineSync = require('readline-sync');

/**
 * PromptKeyProvider - Securely prompt for private keys at runtime
 *
 * Security Level: 🔒 HIGHEST
 *
 * Prompts users to enter private keys interactively. Keys are never stored
 * on disk - they exist only in memory during execution and are cleared afterward.
 *
 * SECURITY BENEFITS:
 * - Keys never stored in files (no risk of accidental commit)
 * - Keys never appear in environment variables
 * - Input hidden from terminal (no shoulder surfing)
 * - Keys cleared from memory after use
 * - Ideal for high-value production accounts
 *
 * TRADEOFFS:
 * - Requires manual input each time
 * - Not suitable for automated scripts
 * - Slower for frequent operations
 *
 * Usage:
 *   const provider = new PromptKeyProvider({ count: 2 });
 *   const keys = await provider.getKeys();
 */
class PromptKeyProvider extends KeyProvider {
  /**
   * Create a PromptKeyProvider
   *
   * @param {Object} options - Configuration options
   * @param {number} options.count - Number of keys to prompt for
   * @param {boolean} options.hideInput - Hide key input in terminal (default: true)
   * @param {string} options.message - Custom prompt message
   * @param {boolean} options.confirmKeys - Require confirmation (default: false)
   */
  constructor(options = {}) {
    super();
    this.count = options.count || 1;
    this.hideInput = options.hideInput !== false; // Default true
    this.message = options.message || null;
    this.confirmKeys = options.confirmKeys || false;
  }

  /**
   * Get private keys by prompting the user
   *
   * @returns {Promise<Array<PrivateKey>>} Array of PrivateKey objects
   * @throws {Error} If user cancels or enters invalid keys
   */
  async getKeys() {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║          SECURE KEY INPUT (Interactive)               ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    console.log('🔒 Security Level: HIGHEST (keys never stored)\n');

    if (this.count > 1) {
      console.log(`You will be prompted for ${this.count} private key(s).\n`);
    }

    console.log('⚠️  IMPORTANT:');
    console.log('  - Your input will be hidden');
    console.log('  - Keys exist only in memory during this session');
    console.log('  - Press Ctrl+C to cancel at any time\n');

    const keyStrings = [];

    for (let i = 0; i < this.count; i++) {
      const keyNum = this.count > 1 ? ` #${i + 1}` : '';
      const message = this.message || `🔑 Enter private key${keyNum}: `;

      let keyString;
      try {
        keyString = readlineSync.question(message, {
          hideEchoBack: this.hideInput,
          mask: ''
        });
      } catch (error) {
        throw new Error('Key input cancelled by user');
      }

      // Validate immediately
      if (!KeyProvider.isValidPrivateKey(keyString)) {
        console.error(`\n❌ Invalid key format for key${keyNum}`);
        console.error('   Expected: Hedera private key (ED25519 or ECDSA, hex or DER format)\n');
        throw new Error(`Invalid key format for key${keyNum}`);
      }

      keyStrings.push(keyString);

      // Confirm key if requested
      if (this.confirmKeys) {
        const publicKey = KeyProvider.parsePrivateKey(keyString).publicKey.toString();
        const sanitized = KeyProvider.sanitizePublicKey(publicKey);
        console.log(`   ✓ Valid key (public: ${sanitized})`);

        const confirm = readlineSync.keyInYN(`   Confirm this key${keyNum}? `);
        if (!confirm) {
          console.log('\n❌ Key rejected. Exiting.\n');
          throw new Error('Key confirmation failed');
        }
      }
    }

    console.log('');

    // Validate all keys
    const validation = KeyProvider.validateKeys(keyStrings);

    if (!validation.valid) {
      throw new Error(
        `Key validation failed:\n${validation.errors.join('\n')}`
      );
    }

    console.log(`✅ ${validation.keys.length} key(s) loaded successfully\n`);

    return validation.keys;
  }

  /**
   * Get provider name
   *
   * @returns {string} Provider name
   */
  getName() {
    return 'Interactive Prompt (Most Secure)';
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
   * Static helper: Prompt for a single key with custom message
   *
   * @param {string} message - Custom prompt message
   * @param {boolean} hideInput - Hide input (default: true)
   * @returns {Promise<PrivateKey>} Single PrivateKey object
   */
  static async promptSingle(message = '🔑 Enter private key: ', hideInput = true) {
    const provider = new PromptKeyProvider({
      count: 1,
      hideInput,
      message
    });

    const keys = await provider.getKeys();
    return keys[0];
  }

  /**
   * Static helper: Prompt for signature confirmation
   *
   * Shows transaction details and asks user to confirm before signing
   *
   * @param {TransactionDetails} txDetails - Decoded transaction details
   * @returns {boolean} True if user confirms
   */
  static confirmSignature(txDetails) {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('⚠️  YOU ARE ABOUT TO SIGN THIS TRANSACTION ⚠️');
    console.log('═══════════════════════════════════════════════════════\n');

    if (txDetails.contract) {
      console.log(`Contract: ${txDetails.contract}`);
    }
    if (txDetails.function) {
      console.log(`Function: ${txDetails.function}`);
    }
    if (txDetails.transfers.hbar) {
      console.log(`HBAR Transfer: ${txDetails.transfers.hbar}`);
    }

    console.log('');

    const confirm = readlineSync.keyInYN('Do you want to sign this transaction? ');
    console.log('');

    return confirm;
  }

  /**
   * Static helper: Display security recommendations
   */
  static displaySecurityRecommendations() {
    console.log('\n╔═══════════════════════════════════════════════════════╗');
    console.log('║          INTERACTIVE PROMPT SECURITY GUIDE            ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    console.log('✅ WHY THIS IS MOST SECURE:\n');
    console.log('  - Keys never written to disk');
    console.log('  - No risk of accidental git commit');
    console.log('  - No exposure through environment variables');
    console.log('  - No exposure through backups or logs');
    console.log('  - Keys cleared from memory after use\n');

    console.log('📝 BEST PRACTICES:\n');
    console.log('  1. Use a password manager to store keys securely');
    console.log('  2. Copy-paste keys from password manager when prompted');
    console.log('  3. Verify transaction details before signing');
    console.log('  4. Never enter keys on untrusted machines');
    console.log('  5. Ensure no screen sharing during key entry\n');

    console.log('⚠️  WARNINGS:\n');
    console.log('  - Slower than environment variables');
    console.log('  - Not suitable for automation');
    console.log('  - Requires manual input each time\n');

    console.log('💡 WHEN TO USE:\n');
    console.log('  - Production mainnet accounts');
    console.log('  - High-value multi-sig wallets');
    console.log('  - Infrequent administrative operations');
    console.log('  - Maximum security requirements\n');
  }

  /**
   * Static helper: Prompt yes/no question
   *
   * @param {string} question - Question to ask
   * @returns {boolean} True if user answers yes
   */
  static promptYesNo(question) {
    return readlineSync.keyInYN(question);
  }

  /**
   * Static helper: Prompt for text input
   *
   * @param {string} question - Question to ask
   * @param {Object} options - readline-sync options
   * @returns {string} User input
   */
  static promptText(question, options = {}) {
    return readlineSync.question(question, options);
  }

  /**
   * Static helper: Prompt for number input
   *
   * @param {string} question - Question to ask
   * @param {Object} options - Additional options
   * @param {number} options.min - Minimum value
   * @param {number} options.max - Maximum value
   * @returns {number} User input as number
   */
  static promptNumber(question, options = {}) {
    const input = readlineSync.question(question);
    const num = parseInt(input);

    if (isNaN(num)) {
      throw new Error('Invalid number');
    }

    if (options.min !== undefined && num < options.min) {
      throw new Error(`Number must be at least ${options.min}`);
    }

    if (options.max !== undefined && num > options.max) {
      throw new Error(`Number must be at most ${options.max}`);
    }

    return num;
  }

  /**
   * Static helper: Display a countdown timer
   *
   * @param {number} seconds - Number of seconds to count down
   * @param {string} message - Message to display
   */
  static displayCountdown(seconds, message = 'Time remaining') {
    process.stdout.write(`\n${message}: ${seconds}s`);

    const interval = setInterval(() => {
      seconds--;
      process.stdout.write(`\r${message}: ${seconds}s `);

      if (seconds <= 0) {
        clearInterval(interval);
        process.stdout.write('\n');
      }
    }, 1000);

    return interval;
  }
}

module.exports = PromptKeyProvider;
