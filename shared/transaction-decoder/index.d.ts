/**
 * Shared Transaction Decoder - TypeScript Declarations
 *
 * Universal transaction decoder for both Node.js and browser environments.
 */

import { Transaction } from '@hashgraph/sdk';
import { Interface } from 'ethers';

export interface DecodedTransaction {
  type: string;
  checksum: string;
  shortChecksum: string;
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
  validStartTimestamp?: number;
  transactionValidDuration?: number;
  expiresAt?: number;

  // Transfer-specific
  transfers?: Array<{ accountId: string; amount: string }>;
  tokenTransfers?: Array<{
    tokenId: string;
    transfers: Array<{ accountId: string; amount: string }>;
  }>;
  nftTransfers?: Array<{
    tokenId: string;
    transfers: Array<{
      senderAccountId: string;
      receiverAccountId: string;
      serialNumber: number;
    }>;
  }>;

  // Token-specific
  tokenIds?: string[];
  accountId?: string;

  // Contract-specific
  contractId?: string;
  gas?: number;
  functionName?: string;
  functionParams?: Record<string, unknown>;
  amount?: string;
  selectorVerified?: boolean;
  bytecodeSize?: number;
  hasKey?: boolean;
}

export interface MetadataValidation {
  valid: boolean;
  warnings: string[];
  mismatches: Record<string, { metadata: unknown; actual: unknown }>;
}

export interface ExtractedAmount {
  accountId: string;
  amount: string;
  tokenId?: string;
  type: 'hbar' | 'token' | 'nft';
}

export interface DecodedSolidityFunction {
  name: string;
  params: Record<string, unknown>;
  selectorVerified: boolean;
}

/**
 * Transaction Decoder Class
 */
export class TransactionDecoder {
  /**
   * Decode frozen transaction from base64
   */
  static decode(
    frozenTransactionBase64: string,
    contractInterface?: Interface
  ): Promise<DecodedTransaction>;

  /**
   * Extract transaction details from parsed transaction
   */
  static extractTransactionDetails(
    transaction: Transaction,
    typeName: string,
    contractInterface?: Interface
  ): TransactionDetails;

  /**
   * Decode Solidity function call using ABI with selector verification
   */
  static decodeSolidityFunction(
    functionData: Uint8Array,
    contractInterface: Interface
  ): DecodedSolidityFunction;

  /**
   * Extract all amounts from transaction details
   */
  static extractAmounts(txDetails: TransactionDetails): ExtractedAmount[];

  /**
   * Extract all account IDs from transaction details
   */
  static extractAccounts(txDetails: TransactionDetails): string[];

  /**
   * Validate coordinator-provided metadata against actual transaction
   */
  static validateMetadata(
    txDetails: TransactionDetails,
    metadata: Record<string, unknown>
  ): MetadataValidation;

  /**
   * Format amount for display
   */
  static formatAmount(
    amount: string,
    type?: 'hbar' | 'token' | 'nft'
  ): string;
}

/**
 * Get transaction type name using instanceof checks (minification-safe)
 */
export function getTransactionTypeName(transaction: Transaction): string;

/**
 * Generate SHA-256 hash of data
 */
export function sha256(data: Uint8Array | Buffer): Promise<string>;

/**
 * Generate truncated checksum (first 16 hex chars of SHA-256)
 */
export function generateChecksum(data: Uint8Array | Buffer): Promise<string>;

/**
 * Convert Uint8Array to hex string
 */
export function bufferToHex(buffer: Uint8Array): string;
