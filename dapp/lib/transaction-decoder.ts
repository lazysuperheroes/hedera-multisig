/**
 * Transaction Decoder
 *
 * Browser-compatible port of client/TransactionReviewer.js
 * Decodes frozen transactions, validates metadata, and generates checksums.
 *
 * Security-critical: Provides cryptographically verified transaction data
 * separate from unverified coordinator-provided metadata.
 */

import {
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
  AccountId,
  Hbar,
} from '@hashgraph/sdk';
import { ethers } from 'ethers';

/**
 * Get the human-readable transaction type name
 * Uses instanceof checks to avoid minification issues with constructor.name
 */
function getTransactionTypeName(transaction: Transaction): string {
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

  // Fallback - try constructor.name (may be minified)
  const constructorName = transaction.constructor.name;
  if (constructorName && constructorName.length > 1) {
    return constructorName;
  }

  return 'UnknownTransaction';
}

export interface DecodedTransaction {
  type: string;
  checksum: string;
  bytes: Uint8Array;
  details: TransactionDetails;
}

export interface TransactionDetails {
  type: string;
  transactionId?: string;
  nodeAccountIds?: string[];
  maxTransactionFee?: string;
  transactionMemo?: string;

  // Timing - for countdown timer
  validStartTimestamp?: number; // Unix timestamp in seconds
  transactionValidDuration?: number; // Duration in seconds (default 120)
  expiresAt?: number; // Unix timestamp when transaction expires

  // Transfer-specific
  transfers?: Array<{ accountId: string; amount: string }>;
  tokenTransfers?: Array<{
    tokenId: string;
    transfers: Array<{ accountId: string; amount: string }>;
  }>;
  nftTransfers?: Array<{
    tokenId: string;
    transfers: Array<{ senderAccountId: string; receiverAccountId: string; serialNumber: number }>;
  }>;

  // Token-specific
  tokenIds?: string[];
  accountId?: string;

  // Contract-specific
  contractId?: string;
  gas?: number;
  functionName?: string;
  functionParams?: any;
  amount?: string;
  selectorVerified?: boolean; // true if function selector was cryptographically verified
}

export interface MetadataValidation {
  valid: boolean;
  warnings: string[];
  mismatches: Record<string, { metadata: any; actual: any }>;
}

export interface ExtractedAmount {
  accountId: string;
  amount: string;
  tokenId?: string;
  type: 'hbar' | 'token' | 'nft';
}

/**
 * Transaction Decoder Class
 *
 * Provides cryptographically verified transaction decoding and metadata validation.
 */
export class TransactionDecoder {
  /**
   * Decode frozen transaction from base64
   *
   * @param frozenTransactionBase64 - Frozen transaction as base64 string
   * @param contractInterface - Optional ABI for contract function decoding
   * @returns Decoded transaction with checksum
   */
  static async decode(
    frozenTransactionBase64: string,
    contractInterface?: ethers.Interface
  ): Promise<DecodedTransaction> {
    try {
      // Decode from base64
      const txBytes = Buffer.from(frozenTransactionBase64, 'base64');

      // Parse transaction
      const transaction = Transaction.fromBytes(txBytes);

      // Generate checksum (SHA256)
      const checksum = await this.generateChecksum(txBytes);

      // Get transaction type name (handles minification)
      const typeName = getTransactionTypeName(transaction);

      // Extract transaction details
      const details = this.extractTransactionDetails(transaction, typeName, contractInterface);

      return {
        type: typeName,
        checksum: checksum,
        bytes: txBytes,
        details: details,
      };
    } catch (error) {
      console.error('Failed to decode transaction:', error);
      throw new Error(`Transaction decoding failed: ${(error as Error).message}`);
    }
  }

  /**
   * Generate SHA256 checksum of transaction bytes
   *
   * Uses Web Crypto API for browser compatibility.
   *
   * @param txBytes - Transaction bytes
   * @returns Hex-encoded checksum
   */
  static async generateChecksum(txBytes: Uint8Array): Promise<string> {
    try {
      // Use Web Crypto API (browser-compatible)
      // Convert to ArrayBuffer if needed for type compatibility
      const buffer = txBytes.buffer.slice(txBytes.byteOffset, txBytes.byteOffset + txBytes.byteLength) as ArrayBuffer;
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

      return hashHex;
    } catch (error) {
      console.error('Failed to generate checksum:', error);
      throw error;
    }
  }

  /**
   * Extract transaction details from parsed transaction
   *
   * @param transaction - Parsed Hedera transaction
   * @param typeName - Transaction type name (from getTransactionTypeName)
   * @param contractInterface - Optional ABI for contract decoding
   * @returns Transaction details object
   */
  static extractTransactionDetails(
    transaction: Transaction,
    typeName: string,
    contractInterface?: ethers.Interface
  ): TransactionDetails {
    // Extract valid start time from transaction ID
    // Format: "0.0.2076@1764452239.277675395" -> 1764452239 seconds
    const txId = transaction.transactionId;
    let validStartTimestamp: number | undefined;
    let transactionValidDuration = 120; // Default 120 seconds
    let expiresAt: number | undefined;

    if (txId) {
      const txIdStr = txId.toString();
      const match = txIdStr.match(/@(\d+)\./);
      if (match) {
        validStartTimestamp = parseInt(match[1], 10);
      }

      // Try to get the actual valid duration from the transaction
      const duration = (transaction as any).transactionValidDuration;
      if (duration) {
        // Duration could be a Duration object with seconds property or a number
        transactionValidDuration = typeof duration === 'number'
          ? duration
          : (duration.seconds || duration._seconds || 120);
      }

      if (validStartTimestamp) {
        expiresAt = validStartTimestamp + transactionValidDuration;
      }
    }

    const details: TransactionDetails = {
      type: typeName,
      transactionId: transaction.transactionId?.toString(),
      nodeAccountIds: transaction.nodeAccountIds?.map((id) => id.toString()) || [],
      maxTransactionFee: transaction.maxTransactionFee?.toString() || '0',
      transactionMemo: (transaction as any).transactionMemo || '',
      validStartTimestamp,
      transactionValidDuration,
      expiresAt,
    };

    // Decode based on transaction type using instanceof for reliability
    if (transaction instanceof TransferTransaction) {
      this.decodeTransferTransaction(transaction, details);
    } else if (transaction instanceof TokenAssociateTransaction) {
      this.decodeTokenAssociateTransaction(transaction, details);
    } else if (transaction instanceof ContractExecuteTransaction) {
      this.decodeContractExecuteTransaction(transaction as any, details, contractInterface);
    } else {
      // Generic transaction - extract what we can
      console.log(`Generic transaction type: ${typeName}`);
    }

    return details;
  }

  /**
   * Decode TransferTransaction
   */
  static decodeTransferTransaction(tx: TransferTransaction, details: TransactionDetails): void {
    // Hbar transfers - _hbarTransfers is an ARRAY of Transfer objects, not a Map!
    const hbarTransfers = (tx as any)._hbarTransfers;
    if (hbarTransfers && Array.isArray(hbarTransfers) && hbarTransfers.length > 0) {
      details.transfers = [];
      for (const transfer of hbarTransfers) {
        details.transfers.push({
          accountId: transfer.accountId.toString(),
          amount: transfer.amount.toString(), // Hbar object stringifies to "X ℏ" format
        });
      }
    }

    // Token transfers - _tokenTransfers is an array of TokenTransfer objects
    const tokenTransfers = (tx as any)._tokenTransfers;
    if (tokenTransfers && Array.isArray(tokenTransfers) && tokenTransfers.length > 0) {
      details.tokenTransfers = [];
      // Group by token ID
      const byToken = new Map<string, Array<{ accountId: string; amount: string }>>();
      for (const transfer of tokenTransfers) {
        const tokenId = transfer.tokenId.toString();
        if (!byToken.has(tokenId)) {
          byToken.set(tokenId, []);
        }
        byToken.get(tokenId)!.push({
          accountId: transfer.accountId.toString(),
          amount: transfer.amount.toString(),
        });
      }
      for (const [tokenId, transfers] of byToken) {
        details.tokenTransfers.push({ tokenId, transfers });
      }
    }

    // NFT transfers - _nftTransfers is an array of TokenNftTransfer objects
    const nftTransfers = (tx as any)._nftTransfers;
    if (nftTransfers && Array.isArray(nftTransfers) && nftTransfers.length > 0) {
      details.nftTransfers = [];
      // Group by token ID
      const byToken = new Map<string, Array<{ senderAccountId: string; receiverAccountId: string; serialNumber: number }>>();
      for (const transfer of nftTransfers) {
        const tokenId = transfer.tokenId.toString();
        if (!byToken.has(tokenId)) {
          byToken.set(tokenId, []);
        }
        byToken.get(tokenId)!.push({
          senderAccountId: transfer.sender.toString(),
          receiverAccountId: transfer.receiver.toString(),
          serialNumber: typeof transfer.serial?.toNumber === 'function' ? transfer.serial.toNumber() : Number(transfer.serial),
        });
      }
      for (const [tokenId, transfers] of byToken) {
        details.nftTransfers.push({ tokenId, transfers });
      }
    }
  }

  /**
   * Decode TokenAssociateTransaction
   */
  static decodeTokenAssociateTransaction(tx: TokenAssociateTransaction, details: TransactionDetails): void {
    details.accountId = (tx as any)._accountId?.toString();
    details.tokenIds = (tx as any)._tokenIds?.map((id: any) => id.toString()) || [];
  }

  /**
   * Decode ContractExecuteTransaction
   */
  static decodeContractExecuteTransaction(
    tx: any,
    details: TransactionDetails,
    contractInterface?: ethers.Interface
  ): void {
    details.contractId = tx._contractId?.toString();
    details.gas = tx._gas?.toNumber();
    details.amount = tx._payableAmount?.toString() || '0';

    // Decode function call if ABI provided
    if (contractInterface && tx._functionParameters) {
      try {
        const functionData = tx._functionParameters;
        const decoded = this.decodeSolidityFunction(functionData, contractInterface);
        details.functionName = decoded.name;
        details.functionParams = decoded.params;
        details.selectorVerified = decoded.selectorVerified; // Capture selector verification status
      } catch (error) {
        console.error('Failed to decode contract function:', error);
        details.functionName = 'Unknown';
        details.selectorVerified = false; // Verification failed
        // Re-throw error if it's a selector mismatch (security-critical)
        if ((error as Error).message.includes('FUNCTION SELECTOR MISMATCH')) {
          throw error;
        }
      }
    }
  }

  /**
   * Decode ContractCallQuery
   */
  static decodeContractCallQuery(
    tx: any,
    details: TransactionDetails,
    contractInterface?: ethers.Interface
  ): void {
    details.contractId = tx._contractId?.toString();
    details.gas = tx._gas?.toNumber();

    // Decode function call if ABI provided
    if (contractInterface && tx._functionParameters) {
      try {
        const functionData = tx._functionParameters;
        const decoded = this.decodeSolidityFunction(functionData, contractInterface);
        details.functionName = decoded.name;
        details.functionParams = decoded.params;
      } catch (error) {
        console.error('Failed to decode contract function:', error);
        details.functionName = 'Unknown';
      }
    }
  }

  /**
   * Decode Solidity function call using ABI
   *
   * SECURITY: Includes function selector verification to cryptographically
   * prove that the ABI function matches the actual transaction bytes.
   *
   * @param functionData - Function parameters bytes
   * @param contractInterface - Contract ABI (ethers Interface)
   * @returns Decoded function name and parameters
   * @throws Error if function selector doesn't match ABI
   */
  static decodeSolidityFunction(
    functionData: Uint8Array,
    contractInterface: ethers.Interface
  ): { name: string; params: any; selectorVerified: boolean } {
    try {
      // Convert Uint8Array to hex string for ethers
      const dataHex = '0x' + Array.from(functionData)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // Extract actual function selector (first 4 bytes)
      const actualSelector = dataHex.slice(0, 10); // '0x' + 8 hex chars = 4 bytes

      // Decode function call
      const decoded = contractInterface.parseTransaction({ data: dataHex });

      if (!decoded) {
        throw new Error('Could not decode function call');
      }

      // SECURITY: Verify function selector matches ABI
      // This cryptographically proves the ABI function name is correct
      const expectedSelector = decoded.selector;

      if (actualSelector.toLowerCase() !== expectedSelector.toLowerCase()) {
        throw new Error(
          `⚠️ FUNCTION SELECTOR MISMATCH!\n` +
          `ABI claims function: ${decoded.name}(${decoded.fragment.inputs.map(i => i.type).join(',')})\n` +
          `Expected selector: ${expectedSelector}\n` +
          `Actual selector: ${actualSelector}\n\n` +
          `This indicates the ABI does not match the actual contract function being called.\n` +
          `DO NOT SIGN THIS TRANSACTION - The function name may be fraudulent.`
        );
      }

      // Extract parameter values
      const params: any = {};
      decoded.fragment.inputs.forEach((input, index) => {
        params[input.name || `param${index}`] = decoded.args[index];
      });

      return {
        name: decoded.name,
        params: params,
        selectorVerified: true, // Selector verification passed
      };
    } catch (error) {
      console.error('Error decoding Solidity function:', error);
      throw error;
    }
  }

  /**
   * Extract all amounts from transaction
   *
   * @param txDetails - Transaction details object
   * @returns Array of amounts with account IDs
   */
  static extractAmounts(txDetails: TransactionDetails): ExtractedAmount[] {
    const amounts: ExtractedAmount[] = [];

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
   * Extract all account IDs from transaction
   *
   * @param txDetails - Transaction details object
   * @returns Array of unique account IDs
   */
  static extractAccounts(txDetails: TransactionDetails): string[] {
    const accounts = new Set<string>();

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

    // From token associate
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
   * Compares metadata claims vs cryptographically verified transaction data.
   * Flags mismatches and suspicious patterns (urgency language, etc.).
   *
   * @param txDetails - Verified transaction details
   * @param metadata - Coordinator-provided metadata
   * @returns Validation result with warnings and mismatches
   */
  static validateMetadata(
    txDetails: TransactionDetails,
    metadata: Record<string, any>
  ): MetadataValidation {
    const warnings: string[] = [];
    const mismatches: Record<string, { metadata: any; actual: any }> = {};

    // Check for urgency language (social engineering indicator)
    const urgencyPatterns = [
      /urgent/i,
      /immediately/i,
      /asap/i,
      /hurry/i,
      /quickly/i,
      /now/i,
      /emergency/i,
    ];

    const metadataText = JSON.stringify(metadata).toLowerCase();
    urgencyPatterns.forEach((pattern) => {
      if (pattern.test(metadataText)) {
        warnings.push(`⚠️ URGENCY LANGUAGE DETECTED: "${pattern.source}" - Be cautious of social engineering`);
      }
    });

    // Validate amounts if provided
    // Note: A transfer has multiple accounting entries (debit + credit), so we validate
    // that the claimed amount exists somewhere in the transaction, not count matching
    if (metadata.amount) {
      const actualAmounts = this.extractAmounts(txDetails);

      // Extract the numeric value from metadata (e.g., "1 ℏ" -> 1, or { value: "1", unit: "HBAR" } -> 1)
      let claimedValue: string | null = null;
      if (typeof metadata.amount === 'object' && metadata.amount.value) {
        claimedValue = metadata.amount.value.toString().replace(/[^\d.-]/g, '');
      } else if (typeof metadata.amount === 'string') {
        claimedValue = metadata.amount.replace(/[^\d.-]/g, '');
      }

      if (claimedValue && actualAmounts.length > 0) {
        // Check if the claimed value exists in any of the actual amounts (absolute value)
        const claimedNum = Math.abs(parseFloat(claimedValue));
        const foundMatch = actualAmounts.some((a) => {
          const actualNum = Math.abs(parseFloat(a.amount.replace(/[^\d.-]/g, '')));
          return Math.abs(actualNum - claimedNum) < 0.0001; // Allow small float tolerance
        });

        if (!foundMatch) {
          mismatches.amounts = {
            metadata: metadata.amount,
            actual: actualAmounts.map((a) => a.amount),
          };
          warnings.push(
            `❌ AMOUNT MISMATCH: Metadata claims "${claimedValue}", ` +
            `but no matching amount found in transaction`
          );
        }
      }
    }

    // Validate accounts if provided
    if (metadata.accounts) {
      const actualAccounts = this.extractAccounts(txDetails);
      const metadataAccounts = Array.isArray(metadata.accounts)
        ? metadata.accounts
        : [metadata.accounts];

      // Check if all metadata accounts are in actual transaction
      const missingAccounts = metadataAccounts.filter(
        (acc: string) => !actualAccounts.includes(acc)
      );

      if (missingAccounts.length > 0) {
        mismatches.accounts = {
          metadata: metadataAccounts,
          actual: actualAccounts,
        };
        warnings.push(
          `❌ ACCOUNT MISMATCH: Metadata mentions accounts not in transaction: ${missingAccounts.join(', ')}`
        );
      }
    }

    // Validate transaction type if provided
    // Allow colloquial aliases (e.g., "HBAR Transfer" = "TransferTransaction")
    const typeAliases: Record<string, string[]> = {
      TransferTransaction: ['HBAR Transfer', 'Transfer', 'Crypto Transfer', 'Token Transfer'],
      TokenAssociateTransaction: ['Token Associate', 'Token Association'],
      TokenDissociateTransaction: ['Token Dissociate', 'Token Dissociation'],
      ContractExecuteTransaction: ['Contract Call', 'Contract Execute', 'Smart Contract Call'],
      ContractCreateTransaction: ['Contract Deploy', 'Contract Create', 'Smart Contract Deploy'],
      AccountCreateTransaction: ['Account Create', 'Create Account'],
      AccountUpdateTransaction: ['Account Update', 'Update Account'],
    };

    if (metadata.type && metadata.type !== txDetails.type) {
      // Check if metadata type is a valid alias
      const aliases = typeAliases[txDetails.type] || [];
      const isValidAlias = aliases.some(
        (alias) => alias.toLowerCase() === metadata.type.toLowerCase()
      );

      if (!isValidAlias) {
        mismatches.type = {
          metadata: metadata.type,
          actual: txDetails.type,
        };
        warnings.push(
          `❌ TYPE MISMATCH: Metadata claims "${metadata.type}", ` +
          `but transaction is "${txDetails.type}"`
        );
      }
    }

    // Validate function name if provided (contract calls)
    if (metadata.functionName && txDetails.functionName) {
      if (metadata.functionName !== txDetails.functionName) {
        mismatches.functionName = {
          metadata: metadata.functionName,
          actual: txDetails.functionName,
        };
        warnings.push(
          `❌ FUNCTION MISMATCH: Metadata claims "${metadata.functionName}", ` +
          `but transaction calls "${txDetails.functionName}"`
        );
      }
    }

    // General warning about metadata trust
    if (Object.keys(metadata).length > 0) {
      warnings.push(
        '⚠️ METADATA IS UNVERIFIED: Always verify transaction details in the "VERIFIED" section below'
      );
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
   * @param amount - Amount in tinybars or smallest unit
   * @param type - Amount type (hbar, token, nft)
   * @returns Formatted amount string
   */
  static formatAmount(amount: string, type: 'hbar' | 'token' | 'nft' = 'hbar'): string {
    if (type === 'nft') {
      return amount; // Already formatted
    }

    try {
      const amountBigInt = BigInt(amount);

      if (type === 'hbar') {
        // Convert tinybars to HBAR (1 HBAR = 100,000,000 tinybars)
        const hbar = Number(amountBigInt) / 100_000_000;
        return `${hbar >= 0 ? '+' : ''}${hbar.toFixed(8)} ℏ`;
      } else {
        // Token amount (usually has decimals, but we don't know decimals here)
        return `${amountBigInt >= 0 ? '+' : ''}${amountBigInt.toString()} tokens`;
      }
    } catch (error) {
      return amount;
    }
  }
}

export default TransactionDecoder;
