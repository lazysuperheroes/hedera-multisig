/**
 * TransactionReviewer
 *
 * Client-side transaction review and validation.
 * Provides metadata validation and visual transaction approval interface.
 *
 * Uses shared transaction decoder for core functionality.
 */

const { ethers } = require('ethers');
const {
  TransactionDecoder: SharedDecoder,
  generateChecksum
} = require('../shared/transaction-decoder');

class TransactionReviewer {
  /**
   * Decode frozen transaction with optional ABI support
   *
   * @param {string} frozenTxBase64 - Base64 encoded frozen transaction
   * @param {Object} contractInterface - Optional Solidity contract ABI (ethers.Interface or ABI array)
   * @returns {Promise<Object>} Decoded transaction details
   */
  static async decode(frozenTxBase64, contractInterface = null) {
    try {
      // Convert ABI array to ethers.Interface if needed
      let iface = contractInterface;
      if (contractInterface && !contractInterface.parseTransaction) {
        iface = new ethers.Interface(contractInterface);
      }

      // Use shared decoder
      const decoded = await SharedDecoder.decode(frozenTxBase64, iface);

      // Return in expected format for backwards compatibility
      return {
        ...decoded.details,
        checksum: decoded.shortChecksum,
        fullChecksum: decoded.checksum,
        bytes: decoded.bytes
      };
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
    // Use shared decoder's validation
    const sharedValidation = SharedDecoder.validateMetadata(txDetails, metadata || {});

    // Convert to legacy format for backwards compatibility
    const validation = {
      valid: sharedValidation.valid,
      warnings: sharedValidation.warnings.map(w => ({
        field: 'general',
        message: w,
        severity: w.includes('MISMATCH') ? 'high' : 'medium'
      })),
      errors: [],
      matches: {}
    };

    // Mark matches based on no mismatches
    if (!sharedValidation.mismatches.amounts) {
      validation.matches.amount = true;
    }
    if (!sharedValidation.mismatches.accounts) {
      validation.matches.recipient = true;
    }

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
   * @returns {Array} Array of amounts
   */
  static extractAmounts(txDetails) {
    return SharedDecoder.extractAmounts(txDetails);
  }

  /**
   * Extract accounts from transaction details
   *
   * @param {Object} txDetails - Decoded transaction details
   * @returns {Array} Array of account IDs
   */
  static extractAccounts(txDetails) {
    return SharedDecoder.extractAccounts(txDetails);
  }

  /**
   * Generate checksum for transaction verification
   *
   * @param {Buffer|Uint8Array} txBytes - Transaction bytes
   * @returns {Promise<string>} SHA256 checksum (truncated to 16 chars)
   */
  static async generateChecksum(txBytes) {
    return generateChecksum(txBytes);
  }

  /**
   * Decode Solidity function call using ABI
   *
   * @param {string|Uint8Array} functionData - Hex-encoded function call data or bytes
   * @param {Object} contractInterface - Solidity contract ABI or ethers.Interface
   * @returns {Object} Decoded function call
   */
  static decodeSolidityFunction(functionData, contractInterface) {
    try {
      if (!contractInterface || !functionData) {
        return null;
      }

      // Convert to ethers.Interface if needed
      const iface = contractInterface.parseTransaction
        ? contractInterface
        : new ethers.Interface(contractInterface);

      // Ensure functionData is a hex string
      let dataHex = functionData;
      if (functionData instanceof Uint8Array || Buffer.isBuffer(functionData)) {
        dataHex = '0x' + Buffer.from(functionData).toString('hex');
      } else if (!functionData.startsWith('0x')) {
        dataHex = '0x' + functionData;
      }

      const decoded = iface.parseTransaction({ data: dataHex });

      if (!decoded) {
        return null;
      }

      return {
        functionName: decoded.name,
        signature: decoded.signature,
        selector: decoded.selector,
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

      // Format BigInt values (ethers v6 uses native BigInt)
      if (typeof value === 'bigint') {
        value = value.toString();
      }

      formatted[name] = value;
    });

    return formatted;
  }
}

module.exports = TransactionReviewer;
