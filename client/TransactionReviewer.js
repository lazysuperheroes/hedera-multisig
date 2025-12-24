/**
 * TransactionReviewer
 *
 * Client-side transaction review and validation.
 * Provides metadata validation and visual transaction approval interface.
 */

const crypto = require('crypto');
const { ethers } = require('ethers');
const TransactionDecoder = require('../core/TransactionDecoder');

class TransactionReviewer {
  /**
   * Decode frozen transaction with optional ABI support
   *
   * @param {string} frozenTxBase64 - Base64 encoded frozen transaction
   * @param {Object} contractInterface - Optional Solidity contract ABI
   * @returns {Object} Decoded transaction details
   */
  static decode(frozenTxBase64, contractInterface = null) {
    try {
      const frozenTxBytes = Buffer.from(frozenTxBase64, 'base64');

      // Use existing TransactionDecoder for basic decoding
      const txDetails = TransactionDecoder.decode(frozenTxBytes, contractInterface);

      // Add checksum for verification
      txDetails.checksum = this.generateChecksum(frozenTxBytes);

      return txDetails;
    } catch (error) {
      throw new Error(`Failed to decode transaction: ${error.message}`);
    }
  }

  /**
   * Validate coordinator-provided metadata against actual transaction bytes
   *
   * @param {Object} txDetails - Decoded transaction details (from bytes)
   * @param {Object} metadata - Coordinator-provided metadata
   * @returns {Object} Validation result with warnings
   */
  static validateMetadata(txDetails, metadata) {
    const validation = {
      valid: true,
      warnings: [],
      errors: [],
      matches: {}
    };

    if (!metadata) {
      return validation;
    }

    // Extract actual amounts from transaction
    const actualAmounts = this.extractAmounts(txDetails);
    const actualAccounts = this.extractAccounts(txDetails);

    // Validate amount if provided
    if (metadata.amount && metadata.amount.value) {
      const metadataAmount = metadata.amount.value.toString();
      const foundMatch = actualAmounts.some(amt => amt.toString() === metadataAmount);

      if (!foundMatch) {
        validation.warnings.push({
          field: 'amount',
          message: `Metadata amount (${metadataAmount}) not found in transaction`,
          severity: 'high'
        });
      } else {
        validation.matches.amount = true;
      }
    }

    // Validate recipient if provided
    if (metadata.recipient && metadata.recipient.address) {
      const metadataRecipient = metadata.recipient.address.toLowerCase();
      const foundMatch = actualAccounts.some(
        acc => acc.toLowerCase() === metadataRecipient
      );

      if (!foundMatch) {
        validation.warnings.push({
          field: 'recipient',
          message: `Metadata recipient (${metadataRecipient}) not found in transaction`,
          severity: 'high'
        });
      } else {
        validation.matches.recipient = true;
      }
    }

    // Check for suspicious description flags
    if (metadata.description && metadata.description.flagged) {
      validation.warnings.push({
        field: 'description',
        message: metadata.description.warning,
        severity: 'medium'
      });
    }

    // Overall validation result
    validation.valid = validation.errors.length === 0;

    return validation;
  }

  /**
   * Display transaction for user approval with clear visual distinction
   *
   * @param {Object} txDetails - Decoded transaction details
   * @param {Object} options - Display options
   * @returns {string} Formatted transaction display
   */
  static displayForApproval(txDetails, options = {}) {
    const { metadata, contractInterface } = options;
    let output = '';

    // Header
    output += '\n╔════════════════════════════════════════════════════════════════╗\n';
    output += '║           TRANSACTION REVIEW - MANUAL APPROVAL REQUIRED        ║\n';
    output += '╚════════════════════════════════════════════════════════════════╝\n\n';

    // VERIFIED SECTION - From cryptographic transaction bytes
    output += '✅ VERIFIED TRANSACTION DATA (from cryptographic bytes):\n';
    output += '─'.repeat(64) + '\n';
    output += `Transaction Type: ${txDetails.type}\n`;
    output += `Transaction ID:   ${txDetails.transactionId || 'N/A'}\n`;
    output += `Checksum:         ${txDetails.checksum}\n`;

    // Display amounts
    const amounts = this.extractAmounts(txDetails);
    if (amounts.length > 0) {
      output += `\nAmounts:\n`;
      amounts.forEach((amt, idx) => {
        output += `  ${idx + 1}. ${amt} HBAR\n`;
      });
    }

    // Display accounts
    const accounts = this.extractAccounts(txDetails);
    if (accounts.length > 0) {
      output += `\nAccounts Involved:\n`;
      accounts.forEach((acc, idx) => {
        output += `  ${idx + 1}. ${acc}\n`;
      });
    }

    // Display smart contract data if present
    if (txDetails.contractCall && contractInterface) {
      output += `\n📝 Smart Contract Call:\n`;
      output += `Contract ID: ${txDetails.contractCall.contractId}\n`;
      output += `Function:    ${txDetails.contractCall.functionName || 'Unknown'}\n`;

      if (txDetails.contractCall.decodedParams) {
        output += `\nParameters:\n`;
        Object.entries(txDetails.contractCall.decodedParams).forEach(([key, value]) => {
          output += `  ${key}: ${value}\n`;
        });
      }
    }

    // Raw transaction details
    if (txDetails.memo) {
      output += `\nMemo: ${txDetails.memo}\n`;
    }

    output += '\n' + '─'.repeat(64) + '\n\n';

    // UNVERIFIED SECTION - Coordinator-provided metadata
    if (metadata) {
      output += '⚠️  UNVERIFIED METADATA (coordinator-provided - advisory only):\n';
      output += '─'.repeat(64) + '\n';
      output += '⚠️  WARNING: This information is NOT cryptographically verified.\n';
      output += '⚠️  Make your decision based on VERIFIED data above only.\n';
      output += '─'.repeat(64) + '\n';

      if (metadata.description) {
        output += `\nDescription: ${metadata.description.text || metadata.description}\n`;
        if (metadata.description.flagged) {
          output += `⚠️  ${metadata.description.warning}\n`;
        }
      }

      if (metadata.amount) {
        output += `\nAmount (unverified): ${metadata.amount.value}\n`;
        output += `⚠️  ${metadata.amount.warning}\n`;
      }

      if (metadata.recipient) {
        output += `\nRecipient (unverified): ${metadata.recipient.address}\n`;
        output += `⚠️  ${metadata.recipient.warning}\n`;
      }

      // Validation results
      const validation = this.validateMetadata(txDetails, metadata);
      if (validation.warnings.length > 0) {
        output += `\n🚨 METADATA VALIDATION WARNINGS:\n`;
        validation.warnings.forEach((warning, idx) => {
          output += `  ${idx + 1}. [${warning.severity.toUpperCase()}] ${warning.field}: ${warning.message}\n`;
        });
      }

      output += '\n' + '─'.repeat(64) + '\n\n';
    }

    // Footer
    output += '═'.repeat(64) + '\n';
    output += 'IMPORTANT: Review the VERIFIED data carefully.\n';
    output += 'Only approve if you understand and agree with this transaction.\n';
    output += '═'.repeat(64) + '\n';

    return output;
  }

  /**
   * Extract amounts from transaction details
   *
   * @param {Object} txDetails - Decoded transaction details
   * @returns {Array} Array of amounts (in HBAR or tokens)
   */
  static extractAmounts(txDetails) {
    const amounts = [];

    // Check for transfer amounts
    if (txDetails.transfers && Array.isArray(txDetails.transfers)) {
      txDetails.transfers.forEach(transfer => {
        if (transfer.amount) {
          amounts.push(Math.abs(transfer.amount));
        }
      });
    }

    // Check for token transfers
    if (txDetails.tokenTransfers && Array.isArray(txDetails.tokenTransfers)) {
      txDetails.tokenTransfers.forEach(transfer => {
        if (transfer.amount) {
          amounts.push(Math.abs(transfer.amount));
        }
      });
    }

    // Check for contract call value
    if (txDetails.contractCall && txDetails.contractCall.gas) {
      // Gas is paid in HBAR
      amounts.push(txDetails.contractCall.gas);
    }

    return amounts;
  }

  /**
   * Extract accounts from transaction details
   *
   * @param {Object} txDetails - Decoded transaction details
   * @returns {Array} Array of account IDs
   */
  static extractAccounts(txDetails) {
    const accounts = new Set();

    // Add payer account
    if (txDetails.transactionId) {
      const parts = txDetails.transactionId.split('@');
      if (parts[0]) {
        accounts.add(parts[0]);
      }
    }

    // Add transfer accounts
    if (txDetails.transfers && Array.isArray(txDetails.transfers)) {
      txDetails.transfers.forEach(transfer => {
        if (transfer.accountId) {
          accounts.add(transfer.accountId);
        }
      });
    }

    // Add token transfer accounts
    if (txDetails.tokenTransfers && Array.isArray(txDetails.tokenTransfers)) {
      txDetails.tokenTransfers.forEach(transfer => {
        if (transfer.accountId) {
          accounts.add(transfer.accountId);
        }
      });
    }

    // Add contract ID
    if (txDetails.contractCall && txDetails.contractCall.contractId) {
      accounts.add(txDetails.contractCall.contractId);
    }

    return Array.from(accounts);
  }

  /**
   * Generate checksum for transaction verification
   *
   * @param {Buffer} txBytes - Transaction bytes
   * @returns {string} SHA256 checksum
   */
  static generateChecksum(txBytes) {
    const hash = crypto.createHash('sha256');
    hash.update(txBytes);
    return hash.digest('hex').substring(0, 16);
  }

  /**
   * Decode Solidity function call using ABI
   *
   * @param {string} functionData - Hex-encoded function call data
   * @param {Object} contractInterface - Solidity contract ABI
   * @returns {Object} Decoded function call
   */
  static decodeSolidityFunction(functionData, contractInterface) {
    try {
      if (!contractInterface || !functionData) {
        return null;
      }

      const iface = new ethers.utils.Interface(contractInterface);
      const decoded = iface.parseTransaction({ data: functionData });

      return {
        functionName: decoded.name,
        signature: decoded.signature,
        args: decoded.args,
        decodedParams: this._formatSolidityParams(decoded.args, decoded.fragment.inputs)
      };
    } catch (error) {
      console.error('Failed to decode Solidity function:', error.message);
      return null;
    }
  }

  /**
   * Format Solidity parameters for display
   * @private
   */
  static _formatSolidityParams(args, inputs) {
    const formatted = {};

    inputs.forEach((input, idx) => {
      const name = input.name || `param${idx}`;
      let value = args[idx];

      // Format BigNumber values
      if (ethers.BigNumber.isBigNumber(value)) {
        value = value.toString();
      }

      formatted[name] = value;
    });

    return formatted;
  }
}

module.exports = TransactionReviewer;
