/**
 * Hedera Mirror Node Client
 *
 * Fetches account information from the Hedera mirror node API
 * Includes caching to avoid hammering the API
 */

import { Hbar, HbarUnit } from '@hashgraph/sdk';

interface MirrorNodeAccountResponse {
  account: string;
  balance: {
    balance: number;
    timestamp: string;
  };
  key: {
    _type: string;
    key: string;
  };
  evm_address: string;
  // ... other fields we don't need
}

interface CachedAccountData {
  accountId: string;
  publicKey: string;
  publicKeyType: string; // e.g., "ED25519", "ECDSA_SECP256K1"
  evmAddress: string;
  balance: string; // Formatted as "1.23 ℏ"
  balanceTinybar: number;
  timestamp: number;
}

// Cache: accountId -> account data
const accountCache = new Map<string, CachedAccountData>();

// Cache TTL: 5 minutes (balance can change, but we don't need to refresh too often)
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Get mirror node base URL based on network
 */
function getMirrorNodeUrl(network: 'testnet' | 'mainnet' = 'testnet'): string {
  if (network === 'mainnet') {
    return 'https://mainnet-public.mirrornode.hedera.com/api/v1';
  }
  return 'https://testnet.mirrornode.hedera.com/api/v1';
}

/**
 * Fetch account data from mirror node with caching
 *
 * @param accountId - Account ID in 0.0.XXXX format
 * @param network - Network to query (testnet or mainnet)
 * @returns Account data including public key and balance
 */
export async function fetchAccountData(
  accountId: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): Promise<CachedAccountData> {
  // Check cache first
  const cached = accountCache.get(accountId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log(`Using cached data for ${accountId}`);
    return cached;
  }

  // Fetch from mirror node
  const url = `${getMirrorNodeUrl(network)}/accounts/${accountId}`;
  console.log(`Fetching account data from mirror node: ${accountId}`);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Mirror node request failed: ${response.status} ${response.statusText}`);
    }

    const data: MirrorNodeAccountResponse = await response.json();

    // Extract public key and key type
    let publicKey = '';
    let publicKeyType = '';

    if (data.key && data.key.key) {
      publicKey = data.key.key;
      publicKeyType = data.key._type || 'Unknown';
    } else if (data.key && typeof data.key === 'string') {
      publicKey = data.key;
      publicKeyType = 'Unknown';
    }

    // Format balance (rounded to 1 decimal place)
    const balanceTinybar = data.balance?.balance || 0;
    const hbarAmount = new Hbar(balanceTinybar, HbarUnit.Tinybar);
    const balanceNumber = hbarAmount.to(HbarUnit.Hbar);
    const balanceFormatted = `${balanceNumber.toFixed(1)} ℏ`;

    const accountData: CachedAccountData = {
      accountId,
      publicKey,
      publicKeyType,
      evmAddress: data.evm_address || '',
      balance: balanceFormatted,
      balanceTinybar,
      timestamp: Date.now(),
    };

    // Cache the result
    accountCache.set(accountId, accountData);

    console.log(`Account data cached for ${accountId}:`, {
      publicKey: publicKey.substring(0, 20) + '...',
      balance: balanceFormatted,
      evmAddress: data.evm_address,
    });

    return accountData;
  } catch (error) {
    console.error(`Failed to fetch account data for ${accountId}:`, error);
    throw error;
  }
}

/**
 * Get cached account data without fetching
 *
 * @param accountId - Account ID in 0.0.XXXX format
 * @returns Cached account data or null if not in cache or expired
 */
export function getCachedAccountData(accountId: string): CachedAccountData | null {
  const cached = accountCache.get(accountId);
  if (!cached || Date.now() - cached.timestamp >= CACHE_TTL_MS) {
    return null;
  }
  return cached;
}

/**
 * Clear cache for specific account or all accounts
 *
 * @param accountId - Optional account ID to clear. If not provided, clears all cache.
 */
export function clearAccountCache(accountId?: string): void {
  if (accountId) {
    accountCache.delete(accountId);
    console.log(`Cleared cache for ${accountId}`);
  } else {
    accountCache.clear();
    console.log('Cleared all account cache');
  }
}

/**
 * Refresh account data in background
 *
 * @param accountId - Account ID to refresh
 * @param network - Network to query
 */
export function refreshAccountData(
  accountId: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): Promise<CachedAccountData> {
  // Force refresh by clearing cache first
  accountCache.delete(accountId);
  return fetchAccountData(accountId, network);
}

/**
 * Transaction status from mirror node
 */
export interface TransactionStatus {
  found: boolean;
  transactionId: string;
  result: string | null; // e.g., "SUCCESS", "INVALID_SIGNATURE", etc.
  consensusTimestamp: string | null;
  chargedFee: number | null;
  memo: string | null;
  name: string | null; // Transaction type
  transfers: Array<{
    account: string;
    amount: number;
  }> | null;
}

/**
 * Convert transaction ID format from Hedera format to mirror node format
 * Example: "0.0.2076@1764452239.277675395" -> "0.0.2076-1764452239-277675395"
 */
export function formatTransactionIdForMirrorNode(txId: string): string {
  // Handle both formats
  // Format 1: "0.0.2076@1764452239.277675395"
  // Format 2: "0.0.2076-1764452239-277675395" (already formatted)
  if (txId.includes('@')) {
    // Split by @ to get account and timestamp parts
    const [accountPart, timestampPart] = txId.split('@');
    // Replace the . in timestamp with -
    const formattedTimestamp = timestampPart.replace('.', '-');
    return `${accountPart}-${formattedTimestamp}`;
  }
  return txId;
}

/**
 * Convert transaction ID to HashScan URL format
 * Example: "0.0.2076@1764452239.277675395" -> "0.0.2076-1764452239-277675395"
 */
export function formatTransactionIdForHashScan(txId: string): string {
  return formatTransactionIdForMirrorNode(txId);
}

/**
 * Get HashScan URL for a transaction
 */
export function getHashScanTransactionUrl(
  txId: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): string {
  const formattedId = formatTransactionIdForHashScan(txId);
  const baseUrl = network === 'mainnet'
    ? 'https://hashscan.io/mainnet'
    : 'https://hashscan.io/testnet';
  return `${baseUrl}/transactionsById/${formattedId}`;
}

/**
 * Fetch transaction status from mirror node
 *
 * @param transactionId - Transaction ID in either format
 * @param network - Network to query (testnet or mainnet)
 * @returns Transaction status or null if not found
 */
export async function fetchTransactionStatus(
  transactionId: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): Promise<TransactionStatus> {
  const formattedId = formatTransactionIdForMirrorNode(transactionId);
  const url = `${getMirrorNodeUrl(network)}/transactions/${formattedId}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    // Check for "not found" response
    if (data._status?.messages?.[0]?.message === 'Not found') {
      return {
        found: false,
        transactionId,
        result: null,
        consensusTimestamp: null,
        chargedFee: null,
        memo: null,
        name: null,
        transfers: null,
      };
    }

    // Extract transaction data from first transaction in array
    const tx = data.transactions?.[0];
    if (!tx) {
      return {
        found: false,
        transactionId,
        result: null,
        consensusTimestamp: null,
        chargedFee: null,
        memo: null,
        name: null,
        transfers: null,
      };
    }

    return {
      found: true,
      transactionId,
      result: tx.result || null,
      consensusTimestamp: tx.consensus_timestamp || null,
      chargedFee: tx.charged_tx_fee || null,
      memo: tx.memo_base64 ? atob(tx.memo_base64) : null,
      name: tx.name || null,
      transfers: tx.transfers || null,
    };
  } catch (error) {
    console.error(`Failed to fetch transaction status for ${transactionId}:`, error);
    return {
      found: false,
      transactionId,
      result: null,
      consensusTimestamp: null,
      chargedFee: null,
      memo: null,
      name: null,
      transfers: null,
    };
  }
}
