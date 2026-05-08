/**
 * Hedera Mirror Node Client
 *
 * Fetches account information from the Hedera mirror node API
 * Includes caching to avoid hammering the API
 */

import { Hbar, HbarUnit } from '@hashgraph/sdk';
import { emitConsoleLog } from './console-log';

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
 * Lightweight `MirrorHealthClient` (the shape `orderByHealth` needs).
 *
 * Two endpoints are wrapped:
 *   - `GET /api/v1/network/nodes` — paginated address book, used to
 *     filter freeze candidates to nodes with stake>0 + service_endpoints.
 *   - `GET /api/v1/transactions?node=…&timestamp=gte:…` — recent-activity
 *     check, the closest thing Hedera exposes to a node liveness ping.
 *
 * Used at freeze time so when a wallet signer (HashPack) only signs
 * body[0] and the executor downgrades to single-node submission, that
 * body targets a node currently accepting transactions instead of
 * always landing on `nodeAccountIds[0]` regardless of state.
 */
export function createMirrorHealthClient(network: 'testnet' | 'mainnet' = 'testnet') {
  const base = getMirrorNodeUrl(network);
  return {
    async getNetworkNodes() {
      const nodes: Array<{
        node_account_id?: string;
        nodeAccountId?: string;
        stake?: number | string;
        service_endpoints?: unknown[];
        decline_reward?: boolean;
      }> = [];
      let path: string | null = '/network/nodes?limit=100';
      while (path !== null) {
        const url: string = `${base}${path}`;
        const response: Response = await fetch(url);
        if (!response.ok) throw new Error(`mirror /network/nodes ${response.status}`);
        const json: { nodes?: unknown[]; links?: { next?: string | null } } = await response.json();
        if (Array.isArray(json.nodes)) nodes.push(...(json.nodes as typeof nodes));
        const next: string | null | undefined = json?.links?.next;
        // Mirror returns relative paths like `/api/v1/network/nodes?...` —
        // strip the `/api/v1` prefix because we already have it in `base`.
        path = typeof next === 'string' && next.length > 0
          ? next.replace(/^\/api\/v1/, '')
          : null;
      }
      return nodes;
    },
    async getNodeRecentActivity(nodeAccountId: string, options: { windowSeconds?: number } = {}) {
      const windowSeconds = options.windowSeconds || 60;
      const sinceUnix = Math.floor(Date.now() / 1000) - windowSeconds;
      const url = `${base}/transactions?node=${encodeURIComponent(nodeAccountId)}` +
        `&limit=1&order=desc&timestamp=gte:${sinceUnix}`;
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const json = await response.json();
        return Array.isArray(json.transactions) && json.transactions.length > 0;
      } catch {
        return null;
      }
    },
  };
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
    emitConsoleLog({ level: 'debug', source: 'mirror', message: `cache hit`, data: { accountId } });
    return cached;
  }

  // Fetch from mirror node
  const url = `${getMirrorNodeUrl(network)}/accounts/${accountId}`;
  emitConsoleLog({ level: 'info', source: 'mirror', message: `GET /accounts/${accountId}` });

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

    emitConsoleLog({
      level: 'success',
      source: 'mirror',
      message: `cached ${accountId}`,
      data: { balance: balanceFormatted, evm: data.evm_address },
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

// ---------------------------------------------------------------------------
// Account balance (HBAR + tokens)
// ---------------------------------------------------------------------------

export interface AccountBalance {
  hbarBalance: string; // formatted like "123.45 ℏ"
  tokens: Array<{ tokenId: string; balance: string; decimals?: number }>;
}

/**
 * Fetch account balance (HBAR + token balances) from the mirror node.
 *
 * @param accountId - Account ID in 0.0.XXXX format
 * @param network   - Network to query (testnet or mainnet)
 * @returns Balance info or null if the account was not found
 */
export async function fetchAccountBalance(
  accountId: string,
  network: string
): Promise<AccountBalance | null> {
  const net = (network === 'mainnet' ? 'mainnet' : 'testnet') as 'testnet' | 'mainnet';
  const baseUrl = getMirrorNodeUrl(net);

  try {
    // Phase C14: parallelize the two requests — they're independent, and
    // the previous sequential version doubled latency on slow networks.
    const [accountRes, tokensRes] = await Promise.all([
      fetch(`${baseUrl}/accounts/${accountId}`),
      fetch(`${baseUrl}/accounts/${accountId}/tokens`).catch(() => null),
    ]);

    if (!accountRes.ok) {
      if (accountRes.status === 404) return null;
      throw new Error(`Mirror node returned ${accountRes.status}`);
    }
    const accountData: MirrorNodeAccountResponse = await accountRes.json();

    const balanceTinybar = accountData.balance?.balance ?? 0;
    const hbar = new Hbar(balanceTinybar, HbarUnit.Tinybar);
    const hbarFormatted = `${Number(hbar.to(HbarUnit.Hbar)).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} \u210F`; // ℏ

    const tokens: AccountBalance['tokens'] = [];
    if (tokensRes && tokensRes.ok) {
      try {
        const tokensData = await tokensRes.json();
        if (Array.isArray(tokensData.tokens)) {
          for (const t of tokensData.tokens) {
            tokens.push({
              tokenId: t.token_id,
              balance: String(t.balance ?? 0),
              decimals: t.decimals ?? undefined,
            });
          }
        }
      } catch {
        // Token parse failure is non-fatal — HBAR balance still surfaces
        console.warn(`Could not parse tokens for ${accountId}`);
      }
    }

    return { hbarBalance: hbarFormatted, tokens };
  } catch (error) {
    console.error(`Failed to fetch balance for ${accountId}:`, error);
    return null;
  }
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
