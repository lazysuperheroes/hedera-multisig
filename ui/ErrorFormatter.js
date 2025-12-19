/**
 * Error Formatter
 *
 * Converts technical errors into user-friendly messages with actionable suggestions.
 * Provides context-aware error handling for multi-signature workflows.
 */

const chalk = require('chalk');

class ErrorFormatter {
  /**
   * Format an error with user-friendly message and recovery suggestions
   * @param {Error|string} error - The error to format
   * @param {Object} context - Additional context about the error
   * @returns {string} Formatted error message
   */
  static format(error, context = {}) {
    const errorMessage = error.message || error.toString();
    const errorType = this.categorizeError(errorMessage);

    let formatted = '\n' + chalk.red.bold('━'.repeat(80)) + '\n';
    formatted += chalk.red.bold('  ERROR: ') + chalk.white.bold(errorType.title) + '\n';
    formatted += chalk.red.bold('━'.repeat(80)) + '\n\n';

    // Technical details
    formatted += chalk.gray('Technical Details:\n');
    formatted += chalk.gray('  ' + errorMessage) + '\n\n';

    // User-friendly explanation
    formatted += chalk.yellow('What happened:\n');
    formatted += '  ' + errorType.explanation + '\n\n';

    // Recovery suggestions
    if (errorType.suggestions.length > 0) {
      formatted += chalk.cyan('How to fix:\n');
      errorType.suggestions.forEach((suggestion, index) => {
        formatted += chalk.cyan(`  ${index + 1}. `) + suggestion + '\n';
      });
      formatted += '\n';
    }

    // Context information if available
    if (Object.keys(context).length > 0) {
      formatted += chalk.gray('Context:\n');
      for (const [key, value] of Object.entries(context)) {
        formatted += chalk.gray(`  ${key}: ${value}\n`);
      }
      formatted += '\n';
    }

    formatted += chalk.red.bold('━'.repeat(80)) + '\n';

    return formatted;
  }

  /**
   * Categorize error and provide helpful information
   * @param {string} errorMessage - The error message to categorize
   * @returns {Object} Error category with title, explanation, and suggestions
   */
  static categorizeError(errorMessage) {
    const msg = errorMessage.toLowerCase();

    // Transaction expiry errors
    if (msg.includes('expired') || msg.includes('timeout')) {
      return {
        title: 'Transaction Expired',
        explanation: 'The transaction was not signed by all required parties within the 110-second window.',
        suggestions: [
          'Use offline workflow mode for multi-signature transactions that require coordination',
          'Ensure all signers are ready before creating the transaction',
          'Check network connectivity for all participants',
          'Consider using the batch signing mode for multiple transactions'
        ]
      };
    }

    // Signature verification errors
    if (msg.includes('signature') && (msg.includes('invalid') || msg.includes('mismatch'))) {
      return {
        title: 'Invalid Signature',
        explanation: 'One or more signatures could not be verified against the transaction.',
        suggestions: [
          'Verify that the correct private key was used for signing',
          'Check that the transaction bytes were not modified after freezing',
          'Ensure the signer\'s public key matches the account on the transaction',
          'Confirm the key type (Ed25519 vs ECDSA) matches the account requirements'
        ]
      };
    }

    // Key format errors
    if (msg.includes('key') && (msg.includes('format') || msg.includes('parse') || msg.includes('invalid'))) {
      return {
        title: 'Invalid Key Format',
        explanation: 'The private key could not be parsed or is in an incorrect format.',
        suggestions: [
          'Ensure the key is in DER-encoded hex format (starts with 302e for Ed25519, 3030 for ECDSA)',
          'Check for extra whitespace or newlines in the key string',
          'Verify the key was exported correctly from Hedera',
          'Use the KeyValidator utility to test key format: node lib/multiSig/cli/testKeyFile.js'
        ]
      };
    }

    // Encryption/decryption errors
    if (msg.includes('decrypt') || msg.includes('cipher')) {
      return {
        title: 'Decryption Failed',
        explanation: 'Unable to decrypt the encrypted key file. The password may be incorrect.',
        suggestions: [
          'Verify the password is correct (passwords are case-sensitive)',
          'Check that the key file has not been corrupted or modified',
          'Ensure the key file was created with the same encryption version',
          'Try creating a new encrypted key file if the issue persists'
        ]
      };
    }

    // Network/connectivity errors
    if (msg.includes('network') || msg.includes('connection') || msg.includes('econnrefused')) {
      return {
        title: 'Network Connection Error',
        explanation: 'Unable to connect to the Hedera network.',
        suggestions: [
          'Check your internet connection',
          'Verify the ENVIRONMENT setting in .env (testnet, mainnet, preview)',
          'Ensure Hedera network is not experiencing downtime',
          'Check firewall settings that may block connections'
        ]
      };
    }

    // Insufficient signatures
    if (msg.includes('insufficient') && msg.includes('signature')) {
      return {
        title: 'Insufficient Signatures',
        explanation: 'The transaction does not have enough signatures to meet the threshold requirement.',
        suggestions: [
          'Collect all required signatures before attempting execution',
          'Verify the signature threshold configuration is correct',
          'Check that all signers have provided valid signatures',
          'Use the signature status display to track collection progress'
        ]
      };
    }

    // File not found errors
    if (msg.includes('enoent') || msg.includes('file not found')) {
      return {
        title: 'File Not Found',
        explanation: 'A required file could not be found at the specified path.',
        suggestions: [
          'Verify the file path is correct and the file exists',
          'Check file permissions',
          'Ensure you\'re running the command from the correct directory',
          'For encrypted key files, verify the file was created successfully'
        ]
      };
    }

    // Insufficient balance
    if (msg.includes('insufficient') && (msg.includes('balance') || msg.includes('funds'))) {
      return {
        title: 'Insufficient Account Balance',
        explanation: 'The account does not have enough HBAR to pay transaction fees.',
        suggestions: [
          'Add HBAR to the account',
          'Check the account balance before attempting transactions',
          'Verify the transaction fee estimate',
          'Ensure the account is funded on the correct network (testnet vs mainnet)'
        ]
      };
    }

    // Account not found
    if (msg.includes('account') && msg.includes('not found')) {
      return {
        title: 'Account Not Found',
        explanation: 'The specified Hedera account ID could not be found on the network.',
        suggestions: [
          'Verify the account ID format (0.0.xxxxx)',
          'Check that the account exists on the current network',
          'Ensure you\'re connected to the correct network (testnet vs mainnet)',
          'Confirm the account has not been deleted'
        ]
      };
    }

    // Permission denied
    if (msg.includes('permission') || msg.includes('unauthorized') || msg.includes('forbidden')) {
      return {
        title: 'Permission Denied',
        explanation: 'The operation requires permissions that the current account does not have.',
        suggestions: [
          'Verify you\'re using an admin account for admin operations',
          'Check the account has the required roles on the contract',
          'Ensure the multi-signature threshold includes authorized signers',
          'Review contract access control settings'
        ]
      };
    }

    // Generic/Unknown error
    return {
      title: 'Unexpected Error',
      explanation: 'An unexpected error occurred during the operation.',
      suggestions: [
        'Review the technical details above for more information',
        'Check the audit log for additional context',
        'Ensure all prerequisites are met for the operation',
        'Contact support if the issue persists with the error details'
      ]
    };
  }

  /**
   * Format a warning message
   * @param {string} message - Warning message
   * @returns {string} Formatted warning
   */
  static warning(message) {
    return chalk.yellow('⚠ WARNING: ') + message;
  }

  /**
   * Format a validation error
   * @param {string} field - Field that failed validation
   * @param {string} issue - Description of the issue
   * @param {string} expected - Expected value or format
   * @returns {string} Formatted validation error
   */
  static validationError(field, issue, expected = null) {
    let message = chalk.red('✗ Validation Error: ') + chalk.bold(field) + '\n';
    message += '  Issue: ' + issue + '\n';
    if (expected) {
      message += '  Expected: ' + chalk.cyan(expected) + '\n';
    }
    return message;
  }

  /**
   * Format multiple validation errors
   * @param {Array<Object>} errors - Array of validation errors
   * @returns {string} Formatted validation errors
   */
  static validationErrors(errors) {
    let message = '\n' + chalk.red.bold('Validation Errors:\n');
    errors.forEach((err, index) => {
      message += chalk.red(`  ${index + 1}. `) + chalk.bold(err.field) + ': ' + err.issue + '\n';
      if (err.expected) {
        message += '     Expected: ' + chalk.cyan(err.expected) + '\n';
      }
    });
    return message;
  }
}

module.exports = ErrorFormatter;
