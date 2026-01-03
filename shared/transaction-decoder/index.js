/**
 * Shared Transaction Decoder
 *
 * Universal transaction decoder that works in both Node.js and browser environments.
 * Provides cryptographically verified transaction decoding and metadata validation.
 *
 * Based on dapp/lib/transaction-decoder.ts with full transaction type support.
 */

const {
  Transaction,
  TransferTransaction,
  TokenAssociateTransaction,
  TokenDissociateTransaction,
  AccountCreateTransaction,
  AccountUpdateTransaction,
  AccountDeleteTransaction,
  ContractCreateTransaction,
  ContractExecuteTransaction,
  ContractDeleteTransaction,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenBurnTransaction,
  TokenUpdateTransaction,
  TokenDeleteTransaction,
  TopicCreateTransaction,
  TopicUpdateTransaction,
  TopicDeleteTransaction,
  TopicMessageSubmitTransaction,
  FileCreateTransaction,
  FileUpdateTransaction,
  FileDeleteTransaction,
  FileAppendTransaction,
  ScheduleCreateTransaction,
  ScheduleSignTransaction,
  ScheduleDeleteTransaction,
} = require('@hashgraph/sdk');

const { ethers } = require('ethers');
const { sha256, generateChecksum, bufferToHex } = require('./crypto');

/**
 * @typedef {Object} DecodedTransaction
 * @property {string} type - Transaction type name
 * @property {string} checksum - SHA-256 checksum (full hash)
 * @property {string} shortChecksum - Truncated checksum (16 chars)
 * @property {Uint8Array} bytes - Raw transaction bytes
 * @property {TransactionDetails} details - Extracted transaction details
 */

/**
 * @typedef {Object} TransactionDetails
 * @property {string} type - Transaction type
 * @property {string} [transactionId] - Transaction ID
 * @property {string[]} [nodeAccountIds] - Node account IDs
 * @property {string} [maxTransactionFee] - Max fee
 * @property {string} [transactionMemo] - Memo
 * @property {number} [validStartTimestamp] - Unix timestamp in seconds
 * @property {number} [transactionValidDuration] - Duration in seconds
 * @property {number} [expiresAt] - Unix timestamp when transaction expires
 * @property {Array<{accountId: string, amount: string}>} [transfers] - HBAR transfers
 * @property {Array<{tokenId: string, transfers: Array<{accountId: string, amount: string}>}>} [tokenTransfers] - Token transfers
 * @property {Array<{tokenId: string, transfers: Array<{senderAccountId: string, receiverAccountId: string, serialNumber: number}>}>} [nftTransfers] - NFT transfers
 * @property {string[]} [tokenIds] - Token IDs (for associate/dissociate)
 * @property {string} [accountId] - Account ID
 * @property {string} [contractId] - Contract ID
 * @property {number} [gas] - Gas limit
 * @property {string} [functionName] - Contract function name
 * @property {Object} [functionParams] - Decoded function parameters
 * @property {string} [amount] - Payable amount
 * @property {boolean} [selectorVerified] - Whether function selector was cryptographically verified
 */

/**
 * Get transaction type name using instanceof checks (minification-safe)
 *
 * @param {Transaction} transaction - Hedera transaction
 * @returns {string} Transaction type name
 */
function getTransactionTypeName(transaction) {
  // Transfer types
  if (transaction instanceof TransferTransaction) return 'TransferTransaction';

  // Token types
  if (transaction instanceof TokenAssociateTransaction) return 'TokenAssociateTransaction';
  if (transaction instanceof TokenDissociateTransaction) return 'TokenDissociateTransaction';
  if (transaction instanceof TokenCreateTransaction) return 'TokenCreateTransaction';
  if (transaction instanceof TokenMintTransaction) return 'TokenMintTransaction';
  if (transaction instanceof TokenBurnTransaction) return 'TokenBurnTransaction';
  if (transaction instanceof TokenUpdateTransaction) return 'TokenUpdateTransaction';
  if (transaction instanceof TokenDeleteTransaction) return 'TokenDeleteTransaction';

  // Account types
  if (transaction instanceof AccountCreateTransaction) return 'AccountCreateTransaction';
  if (transaction instanceof AccountUpdateTransaction) return 'AccountUpdateTransaction';
  if (transaction instanceof AccountDeleteTransaction) return 'AccountDeleteTransaction';

  // Contract types
  if (transaction instanceof ContractCreateTransaction) return 'ContractCreateTransaction';
  if (transaction instanceof ContractExecuteTransaction) return 'ContractExecuteTransaction';
  if (transaction instanceof ContractDeleteTransaction) return 'ContractDeleteTransaction';

  // Topic types
  if (transaction instanceof TopicCreateTransaction) return 'TopicCreateTransaction';
  if (transaction instanceof TopicUpdateTransaction) return 'TopicUpdateTransaction';
  if (transaction instanceof TopicDeleteTransaction) return 'TopicDeleteTransaction';
  if (transaction instanceof TopicMessageSubmitTransaction) return 'TopicMessageSubmitTransaction';

  // File types
  if (transaction instanceof FileCreateTransaction) return 'FileCreateTransaction';
  if (transaction instanceof FileUpdateTransaction) return 'FileUpdateTransaction';
  if (transaction instanceof FileDeleteTransaction) return 'FileDeleteTransaction';
  if (transaction instanceof FileAppendTransaction) return 'FileAppendTransaction';

  // Schedule types
  if (transaction instanceof ScheduleCreateTransaction) return 'ScheduleCreateTransaction';
  if (transaction instanceof ScheduleSignTransaction) return 'ScheduleSignTransaction';
  if (transaction instanceof ScheduleDeleteTransaction) return 'ScheduleDeleteTransaction';

  // Fallback - try constructor.name
  const constructorName = transaction.constructor.name;
  if (constructorName && constructorName.length > 1) {
    return constructorName;
  }

  return 'UnknownTransaction';
}

/**
 * Transaction Decoder Class
 */
class TransactionDecoder {
  /**
   * Decode frozen transaction from base64
   *
   * @param {string} frozenTransactionBase64 - Frozen transaction as base64 string
   * @param {ethers.Interface} [contractInterface] - Optional ABI for contract function decoding
   * @returns {Promise<DecodedTransaction>} Decoded transaction with checksum
   */
  static async decode(frozenTransactionBase64, contractInterface = null) {
    try {
      // Decode from base64
      const txBytes = Buffer.from(frozenTransactionBase64, 'base64');

      // Parse transaction
      const transaction = Transaction.fromBytes(txBytes);

      // Generate checksums
      const fullChecksum = await sha256(txBytes);
      const shortChecksum = await generateChecksum(txBytes);

      // Get transaction type name
      const typeName = getTransactionTypeName(transaction);

      // Extract transaction details
      const details = this.extractTransactionDetails(transaction, typeName, contractInterface);

      return {
        type: typeName,
        checksum: fullChecksum,
        shortChecksum: shortChecksum,
        bytes: txBytes,
        details: details,
      };
    } catch (error) {
      throw new Error(`Transaction decoding failed: ${error.message}`);
    }
  }

  /**
   * Extract transaction details from parsed transaction
   *
   * @param {Transaction} transaction - Parsed Hedera transaction
   * @param {string} typeName - Transaction type name
   * @param {ethers.Interface} [contractInterface] - Optional ABI for contract decoding
   * @returns {TransactionDetails} Transaction details object
   */
  static extractTransactionDetails(transaction, typeName, contractInterface = null) {
    // Extract valid start time from transaction ID
    const txId = transaction.transactionId;
    let validStartTimestamp;
    let transactionValidDuration = 120; // Default 120 seconds
    let expiresAt;

    if (txId) {
      const txIdStr = txId.toString();
      const match = txIdStr.match(/@(\d+)\./);
      if (match) {
        validStartTimestamp = parseInt(match[1], 10);
      }

      // Try to get the actual valid duration
      const duration = transaction.transactionValidDuration;
      if (duration) {
        transactionValidDuration = typeof duration === 'number'
          ? duration
          : (duration.seconds || duration._seconds || 120);
      }

      if (validStartTimestamp) {
        expiresAt = validStartTimestamp + transactionValidDuration;
      }
    }

    const details = {
      type: typeName,
      transactionId: transaction.transactionId?.toString(),
      nodeAccountIds: transaction.nodeAccountIds?.map((id) => id.toString()) || [],
      maxTransactionFee: transaction.maxTransactionFee?.toString() || '0',
      transactionMemo: transaction.transactionMemo || '',
      validStartTimestamp,
      transactionValidDuration,
      expiresAt,
    };

    // Decode based on transaction type using instanceof
    if (transaction instanceof TransferTransaction) {
      this._decodeTransferTransaction(transaction, details);
    } else if (transaction instanceof TokenAssociateTransaction) {
      this._decodeTokenAssociateTransaction(transaction, details);
    } else if (transaction instanceof TokenDissociateTransaction) {
      this._decodeTokenDissociateTransaction(transaction, details);
    } else if (transaction instanceof ContractExecuteTransaction) {
      this._decodeContractExecuteTransaction(transaction, details, contractInterface);
    } else if (transaction instanceof ContractCreateTransaction) {
      this._decodeContractCreateTransaction(transaction, details);
    } else if (transaction instanceof AccountCreateTransaction) {
      this._decodeAccountCreateTransaction(transaction, details);
    } else if (transaction instanceof AccountUpdateTransaction) {
      this._decodeAccountUpdateTransaction(transaction, details);
    }
    // Add more transaction types as needed

    return details;
  }

  /**
   * Decode TransferTransaction
   * @private
   */
  static _decodeTransferTransaction(tx, details) {
    // Hbar transfers - _hbarTransfers is an array of Transfer objects
    const hbarTransfers = tx._hbarTransfers;
    if (hbarTransfers && Array.isArray(hbarTransfers) && hbarTransfers.length > 0) {
      details.transfers = [];
      for (const transfer of hbarTransfers) {
        details.transfers.push({
          accountId: transfer.accountId.toString(),
          amount: transfer.amount.toString(),
        });
      }
    }

    // Token transfers
    const tokenTransfers = tx._tokenTransfers;
    if (tokenTransfers && Array.isArray(tokenTransfers) && tokenTransfers.length > 0) {
      details.tokenTransfers = [];
      const byToken = new Map();
      for (const transfer of tokenTransfers) {
        const tokenId = transfer.tokenId.toString();
        if (!byToken.has(tokenId)) {
          byToken.set(tokenId, []);
        }
        byToken.get(tokenId).push({
          accountId: transfer.accountId.toString(),
          amount: transfer.amount.toString(),
        });
      }
      for (const [tokenId, transfers] of byToken) {
        details.tokenTransfers.push({ tokenId, transfers });
      }
    }

    // NFT transfers
    const nftTransfers = tx._nftTransfers;
    if (nftTransfers && Array.isArray(nftTransfers) && nftTransfers.length > 0) {
      details.nftTransfers = [];
      const byToken = new Map();
      for (const transfer of nftTransfers) {
        const tokenId = transfer.tokenId.toString();
        if (!byToken.has(tokenId)) {
          byToken.set(tokenId, []);
        }
        byToken.get(tokenId).push({
          senderAccountId: transfer.sender.toString(),
          receiverAccountId: transfer.receiver.toString(),
          serialNumber: typeof transfer.serial?.toNumber === 'function'
            ? transfer.serial.toNumber()
            : Number(transfer.serial),
        });
      }
      for (const [tokenId, transfers] of byToken) {
        details.nftTransfers.push({ tokenId, transfers });
      }
    }
  }

  /**
   * Decode TokenAssociateTransaction
   * @private
   */
  static _decodeTokenAssociateTransaction(tx, details) {
    details.accountId = tx._accountId?.toString();
    details.tokenIds = tx._tokenIds?.map((id) => id.toString()) || [];
  }

  /**
   * Decode TokenDissociateTransaction
   * @private
   */
  static _decodeTokenDissociateTransaction(tx, details) {
    details.accountId = tx._accountId?.toString();
    details.tokenIds = tx._tokenIds?.map((id) => id.toString()) || [];
  }

  /**
   * Decode ContractExecuteTransaction
   * @private
   */
  static _decodeContractExecuteTransaction(tx, details, contractInterface) {
    details.contractId = tx._contractId?.toString();
    details.gas = tx._gas?.toNumber();
    details.amount = tx._payableAmount?.toString() || '0';

    // Decode function call if ABI provided
    if (contractInterface && tx._functionParameters) {
      try {
        const decoded = this.decodeSolidityFunction(tx._functionParameters, contractInterface);
        details.functionName = decoded.name;
        details.functionParams = decoded.params;
        details.selectorVerified = decoded.selectorVerified;
      } catch (error) {
        console.error('Failed to decode contract function:', error.message);
        details.functionName = 'Unknown';
        details.selectorVerified = false;
        // Re-throw if selector mismatch (security-critical)
        if (error.message.includes('FUNCTION SELECTOR MISMATCH')) {
          throw error;
        }
      }
    }
  }

  /**
   * Decode ContractCreateTransaction
   * @private
   */
  static _decodeContractCreateTransaction(tx, details) {
    details.gas = tx._gas?.toNumber();
    details.amount = tx._initialBalance?.toString() || '0';
    if (tx._bytecode) {
      details.bytecodeSize = tx._bytecode.length;
    }
  }

  /**
   * Decode AccountCreateTransaction
   * @private
   */
  static _decodeAccountCreateTransaction(tx, details) {
    details.amount = tx._initialBalance?.toString() || '0';
    if (tx._key) {
      details.hasKey = true;
    }
  }

  /**
   * Decode AccountUpdateTransaction
   * @private
   */
  static _decodeAccountUpdateTransaction(tx, details) {
    details.accountId = tx._accountId?.toString();
    if (tx._key) {
      details.hasKey = true;
    }
  }

  /**
   * Decode Solidity function call using ABI with selector verification
   *
   * @param {Uint8Array} functionData - Function parameters bytes
   * @param {ethers.Interface} contractInterface - Contract ABI
   * @returns {{name: string, params: Object, selectorVerified: boolean}}
   * @throws {Error} If function selector doesn't match ABI
   */
  static decodeSolidityFunction(functionData, contractInterface) {
    // Convert to hex string
    const dataHex = '0x' + bufferToHex(functionData);

    // Extract actual function selector (first 4 bytes)
    const actualSelector = dataHex.slice(0, 10);

    // Decode function call
    const decoded = contractInterface.parseTransaction({ data: dataHex });

    if (!decoded) {
      throw new Error('Could not decode function call');
    }

    // SECURITY: Verify function selector matches ABI
    const expectedSelector = decoded.selector;

    if (actualSelector.toLowerCase() !== expectedSelector.toLowerCase()) {
      throw new Error(
        `FUNCTION SELECTOR MISMATCH!\n` +
        `ABI claims function: ${decoded.name}(${decoded.fragment.inputs.map(i => i.type).join(',')})\n` +
        `Expected selector: ${expectedSelector}\n` +
        `Actual selector: ${actualSelector}\n\n` +
        `The ABI does not match the actual contract function being called.\n` +
        `DO NOT SIGN THIS TRANSACTION - The function name may be fraudulent.`
      );
    }

    // Extract parameter values
    const params = {};
    decoded.fragment.inputs.forEach((input, index) => {
      let value = decoded.args[index];
      // Format BigInt values
      if (typeof value === 'bigint') {
        value = value.toString();
      }
      params[input.name || `param${index}`] = value;
    });

    return {
      name: decoded.name,
      params: params,
      selectorVerified: true,
    };
  }

  /**
   * Extract all amounts from transaction details
   *
   * @param {TransactionDetails} txDetails - Transaction details
   * @returns {Array<{accountId: string, amount: string, tokenId?: string, type: string}>}
   */
  static extractAmounts(txDetails) {
    const amounts = [];

    // Hbar transfers
    if (txDetails.transfers) {
      txDetails.transfers.forEach((transfer) => {
        amounts.push({
          accountId: transfer.accountId,
          amount: transfer.amount,
          type: 'hbar',
        });
      });
    }

    // Token transfers
    if (txDetails.tokenTransfers) {
      txDetails.tokenTransfers.forEach((tokenTransfer) => {
        tokenTransfer.transfers.forEach((transfer) => {
          amounts.push({
            accountId: transfer.accountId,
            amount: transfer.amount,
            tokenId: tokenTransfer.tokenId,
            type: 'token',
          });
        });
      });
    }

    // NFT transfers
    if (txDetails.nftTransfers) {
      txDetails.nftTransfers.forEach((nftTransfer) => {
        nftTransfer.transfers.forEach((transfer) => {
          amounts.push({
            accountId: transfer.senderAccountId,
            amount: `-1 NFT (serial: ${transfer.serialNumber})`,
            tokenId: nftTransfer.tokenId,
            type: 'nft',
          });
          amounts.push({
            accountId: transfer.receiverAccountId,
            amount: `+1 NFT (serial: ${transfer.serialNumber})`,
            tokenId: nftTransfer.tokenId,
            type: 'nft',
          });
        });
      });
    }

    // Contract payable amount
    if (txDetails.amount && txDetails.amount !== '0') {
      amounts.push({
        accountId: txDetails.contractId || 'contract',
        amount: txDetails.amount,
        type: 'hbar',
      });
    }

    return amounts;
  }

  /**
   * Extract all account IDs from transaction details
   *
   * @param {TransactionDetails} txDetails - Transaction details
   * @returns {string[]} Unique account IDs
   */
  static extractAccounts(txDetails) {
    const accounts = new Set();

    // From transfers
    if (txDetails.transfers) {
      txDetails.transfers.forEach((t) => accounts.add(t.accountId));
    }

    // From token transfers
    if (txDetails.tokenTransfers) {
      txDetails.tokenTransfers.forEach((tt) => {
        tt.transfers.forEach((t) => accounts.add(t.accountId));
      });
    }

    // From NFT transfers
    if (txDetails.nftTransfers) {
      txDetails.nftTransfers.forEach((nft) => {
        nft.transfers.forEach((t) => {
          accounts.add(t.senderAccountId);
          accounts.add(t.receiverAccountId);
        });
      });
    }

    // From token associate/dissociate
    if (txDetails.accountId) {
      accounts.add(txDetails.accountId);
    }

    // From contract
    if (txDetails.contractId) {
      accounts.add(txDetails.contractId);
    }

    return Array.from(accounts);
  }

  /**
   * Validate coordinator-provided metadata against actual transaction
   *
   * @param {TransactionDetails} txDetails - Verified transaction details
   * @param {Object} metadata - Coordinator-provided metadata
   * @returns {{valid: boolean, warnings: string[], mismatches: Object}}
   */
  static validateMetadata(txDetails, metadata) {
    const warnings = [];
    const mismatches = {};

    if (!metadata || Object.keys(metadata).length === 0) {
      return { valid: true, warnings: [], mismatches: {} };
    }

    // Check for urgency language (social engineering indicator)
    const urgencyPatterns = [
      /urgent/i, /immediately/i, /asap/i, /hurry/i,
      /quickly/i, /now/i, /emergency/i
    ];

    const metadataText = JSON.stringify(metadata).toLowerCase();
    urgencyPatterns.forEach((pattern) => {
      if (pattern.test(metadataText)) {
        warnings.push(`URGENCY LANGUAGE DETECTED: "${pattern.source}" - Be cautious of social engineering`);
      }
    });

    // Validate amounts if provided
    if (metadata.amount) {
      const actualAmounts = this.extractAmounts(txDetails);
      let claimedValue = null;

      if (typeof metadata.amount === 'object' && metadata.amount.value) {
        claimedValue = metadata.amount.value.toString().replace(/[^\d.-]/g, '');
      } else if (typeof metadata.amount === 'string') {
        claimedValue = metadata.amount.replace(/[^\d.-]/g, '');
      }

      if (claimedValue && actualAmounts.length > 0) {
        const claimedNum = Math.abs(parseFloat(claimedValue));
        const foundMatch = actualAmounts.some((a) => {
          const actualNum = Math.abs(parseFloat(a.amount.replace(/[^\d.-]/g, '')));
          return Math.abs(actualNum - claimedNum) < 0.0001;
        });

        if (!foundMatch) {
          mismatches.amounts = {
            metadata: metadata.amount,
            actual: actualAmounts.map((a) => a.amount),
          };
          warnings.push(`AMOUNT MISMATCH: Metadata claims "${claimedValue}", but no matching amount found`);
        }
      }
    }

    // Validate transaction type if provided
    const typeAliases = {
      TransferTransaction: ['HBAR Transfer', 'Transfer', 'Crypto Transfer', 'Token Transfer'],
      TokenAssociateTransaction: ['Token Associate', 'Token Association'],
      TokenDissociateTransaction: ['Token Dissociate', 'Token Dissociation'],
      ContractExecuteTransaction: ['Contract Call', 'Contract Execute', 'Smart Contract Call'],
      ContractCreateTransaction: ['Contract Deploy', 'Contract Create', 'Smart Contract Deploy'],
      AccountCreateTransaction: ['Account Create', 'Create Account'],
      AccountUpdateTransaction: ['Account Update', 'Update Account'],
    };

    if (metadata.type && metadata.type !== txDetails.type) {
      const aliases = typeAliases[txDetails.type] || [];
      const isValidAlias = aliases.some(
        (alias) => alias.toLowerCase() === metadata.type.toLowerCase()
      );

      if (!isValidAlias) {
        mismatches.type = {
          metadata: metadata.type,
          actual: txDetails.type,
        };
        warnings.push(`TYPE MISMATCH: Metadata claims "${metadata.type}", but transaction is "${txDetails.type}"`);
      }
    }

    // Validate function name if provided
    if (metadata.functionName && txDetails.functionName) {
      if (metadata.functionName !== txDetails.functionName) {
        mismatches.functionName = {
          metadata: metadata.functionName,
          actual: txDetails.functionName,
        };
        warnings.push(`FUNCTION MISMATCH: Metadata claims "${metadata.functionName}", but transaction calls "${txDetails.functionName}"`);
      }
    }

    // General warning about metadata trust
    if (Object.keys(metadata).length > 0) {
      warnings.push('METADATA IS UNVERIFIED: Always verify transaction details in the VERIFIED section');
    }

    return {
      valid: Object.keys(mismatches).length === 0,
      warnings: warnings,
      mismatches: mismatches,
    };
  }

  /**
   * Format amount for display
   *
   * @param {string} amount - Amount in tinybars or smallest unit
   * @param {string} [type='hbar'] - Amount type
   * @returns {string} Formatted amount
   */
  static formatAmount(amount, type = 'hbar') {
    if (type === 'nft') {
      return amount;
    }

    try {
      const amountBigInt = BigInt(amount);

      if (type === 'hbar') {
        const hbar = Number(amountBigInt) / 100_000_000;
        return `${hbar >= 0 ? '+' : ''}${hbar.toFixed(8)} HBAR`;
      } else {
        return `${amountBigInt >= 0 ? '+' : ''}${amountBigInt.toString()} tokens`;
      }
    } catch (error) {
      return amount;
    }
  }
}

// Export both the class and helper functions
module.exports = {
  TransactionDecoder,
  getTransactionTypeName,
  sha256,
  generateChecksum,
  bufferToHex
};
