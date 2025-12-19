/**
 * Help Text
 *
 * Provides contextual help and guidance for multi-signature operations.
 * Displays workflow-specific instructions and best practices.
 */

const chalk = require('chalk');

class HelpText {
  /**
   * Display overview of multi-signature system
   */
  static overview() {
    console.log('\n' + chalk.bold.cyan('═'.repeat(80)));
    console.log(chalk.bold.cyan('  Hedera Multi-Signature System'));
    console.log(chalk.bold.cyan('═'.repeat(80)) + '\n');

    console.log(chalk.white('This library enables secure multi-party transaction signing with:'));
    console.log(chalk.gray('  • Support for Ed25519 and ECDSA secp256k1 keys'));
    console.log(chalk.gray('  • Offline and interactive workflow modes'));
    console.log(chalk.gray('  • 110-second transaction timeout protection'));
    console.log(chalk.gray('  • Encrypted key storage with AES-256-GCM'));
    console.log(chalk.gray('  • Comprehensive audit logging\n'));

    console.log(chalk.yellow('Common Use Cases:'));
    console.log('  1. Treasury management with 2-of-3 or 3-of-5 multi-sig');
    console.log('  2. Admin operations requiring multiple approvals');
    console.log('  3. High-security transactions with air-gapped signing');
    console.log('  4. Organizational governance with role-based signing\n');

    console.log(chalk.cyan('For detailed guides, see:'));
    console.log('  docs/MULTISIG_USER_GUIDE.md');
    console.log('  docs/MULTISIG_DEVELOPER_GUIDE.md\n');
  }

  /**
   * Display workflow selection help
   */
  static workflowSelection() {
    console.log('\n' + chalk.bold('Choose Your Workflow:\n'));

    console.log(chalk.green.bold('Interactive Mode') + chalk.gray(' (Recommended for real-time coordination)'));
    console.log('  Best for: Teams available simultaneously with good connectivity');
    console.log('  Features: Live countdown timer, real-time signature collection');
    console.log('  Requires: All signers ready within 110 seconds');
    console.log(chalk.cyan('  Command: ') + '--workflow=interactive\n');

    console.log(chalk.yellow.bold('Offline Mode') + chalk.gray(' (Recommended for air-gapped security)'));
    console.log('  Best for: High-security scenarios, distributed teams, air-gapped systems');
    console.log('  Features: Manual coordination, no time pressure, maximum security');
    console.log('  Process: Freeze → Export → Collect signatures → Execute');
    console.log(chalk.cyan('  Command: ') + '--workflow=offline\n');

    console.log(chalk.gray('Tip: Use offline mode when:'));
    console.log(chalk.gray('  • Signers are in different time zones'));
    console.log(chalk.gray('  • Using hardware wallets or air-gapped machines'));
    console.log(chalk.gray('  • Maximum security is required'));
    console.log(chalk.gray('  • Network connectivity is unreliable\n'));
  }

  /**
   * Display interactive workflow help
   */
  static interactiveWorkflow() {
    console.log('\n' + chalk.bold.green('Interactive Workflow Guide\n'));

    console.log(chalk.white('This workflow coordinates real-time signature collection:\n'));

    console.log(chalk.bold('Step 1: ') + 'Transaction Creation');
    console.log('  • Create and freeze the transaction');
    console.log('  • 110-second countdown begins automatically');
    console.log('  • Transaction details displayed for review\n');

    console.log(chalk.bold('Step 2: ') + 'Signature Collection');
    console.log('  • Each signer is prompted in sequence');
    console.log('  • Live timer shows remaining time');
    console.log('  • Signatures verified immediately\n');

    console.log(chalk.bold('Step 3: ') + 'Execution');
    console.log('  • Once threshold is met, transaction executes');
    console.log('  • Audit log records all signatures');
    console.log('  • Receipt displayed on success\n');

    console.log(chalk.yellow('Requirements:'));
    console.log('  ✓ All signers available simultaneously');
    console.log('  ✓ Stable network connection for all parties');
    console.log('  ✓ Keys accessible (prompt, env, or encrypted file)');
    console.log('  ✓ Complete signing within 110 seconds\n');
  }

  /**
   * Display offline workflow help
   */
  static offlineWorkflow() {
    console.log('\n' + chalk.bold.yellow('Offline Workflow Guide\n'));

    console.log(chalk.white('This workflow enables manual coordination without time pressure:\n'));

    console.log(chalk.bold('Phase 1: ') + chalk.cyan('Initiator - Create & Freeze'));
    console.log('  1. Create transaction with required parameters');
    console.log('  2. Freeze transaction (locks parameters, starts 110s timer)');
    console.log('  3. Export transaction bytes to file');
    console.log('  4. Share file with signers via secure channel\n');

    console.log(chalk.bold('Phase 2: ') + chalk.cyan('Signers - Sign Offline'));
    console.log('  1. Receive frozen transaction file');
    console.log('  2. Review transaction details carefully');
    console.log('  3. Sign using: node lib/multiSig/cli/sign.js <transaction-file>');
    console.log('  4. Return signature to initiator\n');

    console.log(chalk.bold('Phase 3: ') + chalk.cyan('Initiator - Collect & Execute'));
    console.log('  1. Collect signatures from all signers');
    console.log('  2. Verify signatures match the transaction');
    console.log('  3. Execute once threshold is met');
    console.log('  4. Confirm receipt and record in audit log\n');

    console.log(chalk.yellow('Security Best Practices:'));
    console.log('  ✓ Verify transaction details before signing');
    console.log('  ✓ Use encrypted channels to share files');
    console.log('  ✓ Never share private keys, only signatures');
    console.log('  ✓ Validate signature authenticity before execution');
    console.log('  ✓ Maintain audit trail of all operations\n');
  }

  /**
   * Display key management help
   */
  static keyManagement() {
    console.log('\n' + chalk.bold.magenta('Key Management Guide\n'));

    console.log(chalk.white('The library supports three key security tiers:\n'));

    console.log(chalk.green('Tier 1: Prompt Key Provider') + chalk.gray(' (Highest Security)'));
    console.log('  Security: Private key entered interactively, never stored');
    console.log('  Use Case: Air-gapped signing, maximum security operations');
    console.log('  Setup: No configuration needed');
    console.log(chalk.cyan('  Usage: ') + 'Key prompted at signing time\n');

    console.log(chalk.yellow('Tier 2: Encrypted File Provider') + chalk.gray(' (Balanced)'));
    console.log('  Security: AES-256-GCM encrypted, password-protected');
    console.log('  Use Case: Regular operations, repeated signing');
    console.log('  Setup: node lib/multiSig/cli/createKeyFile.js');
    console.log(chalk.cyan('  Usage: ') + 'new EncryptedFileProvider("path/to/keyfile.enc")\n');

    console.log(chalk.red('Tier 3: Environment Variable Provider') + chalk.gray(' (Convenience)'));
    console.log('  Security: Plain text in .env file (use only for testing)');
    console.log('  Use Case: Development, testing, CI/CD pipelines');
    console.log('  Setup: Add PRIVATE_KEY to .env file');
    console.log(chalk.cyan('  Usage: ') + 'new EnvKeyProvider()\n');

    console.log(chalk.yellow('Key Management Tools:'));
    console.log('  • Create encrypted key: node lib/multiSig/cli/createKeyFile.js');
    console.log('  • Test key file: node lib/multiSig/cli/testKeyFile.js <file>');
    console.log('  • Security audit: node lib/multiSig/cli/securityAudit.js\n');

    console.log(chalk.red.bold('NEVER:'));
    console.log(chalk.red('  ✗ Commit private keys to git'));
    console.log(chalk.red('  ✗ Share unencrypted private keys'));
    console.log(chalk.red('  ✗ Use production keys in testnet'));
    console.log(chalk.red('  ✗ Store keys in plain text on production systems\n'));
  }

  /**
   * Display troubleshooting help
   */
  static troubleshooting() {
    console.log('\n' + chalk.bold.red('Troubleshooting Common Issues\n'));

    console.log(chalk.yellow('Transaction Expired:'));
    console.log('  Problem: Transaction timed out before collecting all signatures');
    console.log('  Solution: Use offline workflow or ensure all signers are ready');
    console.log('  Prevention: Coordinate with signers before creating transaction\n');

    console.log(chalk.yellow('Invalid Signature:'));
    console.log('  Problem: Signature verification failed');
    console.log('  Solution: Verify correct private key was used for the account');
    console.log('  Check: Key type (Ed25519 vs ECDSA) matches account\n');

    console.log(chalk.yellow('Key Format Error:'));
    console.log('  Problem: Private key could not be parsed');
    console.log('  Solution: Ensure DER-encoded hex format (302e... or 3030...)');
    console.log('  Tool: Use KeyValidator or testKeyFile.js to verify\n');

    console.log(chalk.yellow('Decryption Failed:'));
    console.log('  Problem: Could not decrypt encrypted key file');
    console.log('  Solution: Verify password is correct (case-sensitive)');
    console.log('  Recovery: Create new encrypted key file if needed\n');

    console.log(chalk.yellow('Insufficient Signatures:'));
    console.log('  Problem: Not enough signatures to meet threshold');
    console.log('  Solution: Collect more valid signatures');
    console.log('  Check: Verify threshold configuration is correct\n');

    console.log(chalk.cyan('For more help:'));
    console.log('  • Run security audit: node lib/multiSig/cli/securityAudit.js');
    console.log('  • Check audit logs in: logs/audit.log');
    console.log('  • Review documentation in: docs/MULTISIG_*.md\n');
  }

  /**
   * Display quick reference card
   */
  static quickReference() {
    console.log('\n' + chalk.bold.cyan('Quick Reference Card\n'));

    console.log(chalk.white.bold('Common Commands:\n'));

    console.log(chalk.cyan('Create Encrypted Key File:'));
    console.log('  node lib/multiSig/cli/createKeyFile.js\n');

    console.log(chalk.cyan('Test Key File:'));
    console.log('  node lib/multiSig/cli/testKeyFile.js <keyfile>\n');

    console.log(chalk.cyan('Sign Transaction (Offline):'));
    console.log('  node lib/multiSig/cli/sign.js <transaction-file>\n');

    console.log(chalk.cyan('Security Audit:'));
    console.log('  node lib/multiSig/cli/securityAudit.js\n');

    console.log(chalk.cyan('Run Admin Script with Multi-sig:'));
    console.log('  node scripts/interactions/LazyLotto/admin/<script>.js --multisig\n');

    console.log(chalk.white.bold('Key Formats:\n'));

    console.log('  Ed25519 Private:   302e020100300506032b657004220420...');
    console.log('  ECDSA Private:     3030020100300706052b8104000a04220420...');
    console.log('  Ed25519 Public:    302a300506032b6570032100...');
    console.log('  ECDSA Public:      302d300706052b8104000a032200...\n');

    console.log(chalk.white.bold('Workflow Flags:\n'));

    console.log('  --workflow=interactive  ' + chalk.gray('Real-time coordination'));
    console.log('  --workflow=offline      ' + chalk.gray('Manual coordination'));
    console.log('  --multisig              ' + chalk.gray('Enable multi-signature mode'));
    console.log('  --threshold=N           ' + chalk.gray('Require N signatures\n'));
  }

  /**
   * Display a formatted tip
   * @param {string} message - Tip message
   */
  static tip(message) {
    console.log(chalk.cyan('💡 Tip: ') + message);
  }

  /**
   * Display a formatted note
   * @param {string} message - Note message
   */
  static note(message) {
    console.log(chalk.yellow('📝 Note: ') + message);
  }

  /**
   * Display a formatted security warning
   * @param {string} message - Security warning message
   */
  static securityWarning(message) {
    console.log(chalk.red.bold('🔒 SECURITY: ') + chalk.red(message));
  }
}

module.exports = HelpText;
