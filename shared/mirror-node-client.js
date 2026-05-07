/**
 * Mirror Node Client
 *
 * Lightweight client for querying Hedera Mirror Node REST API.
 * Provides exchange rates, token info, account info, and schedule info.
 *
 * Uses native https module (no dependencies). Caches exchange rate for 5 minutes.
 */

const https = require('https');

const MIRROR_NODE_URLS = {
  mainnet: 'mainnet-public.mirrornode.hedera.com',
  testnet: 'testnet.mirrornode.hedera.com',
  previewnet: 'previewnet.mirrornode.hedera.com',
};

class MirrorNodeClient {
  /**
   * Create a MirrorNodeClient
   *
   * @param {string} network - Network name ('mainnet', 'testnet', or 'previewnet')
   */
  constructor(network = 'testnet') {
    const normalizedNetwork = network.toLowerCase();
    this.baseHost = MIRROR_NODE_URLS[normalizedNetwork];
    if (!this.baseHost) {
      throw new Error(`Unsupported network: ${network}. Use 'mainnet', 'testnet', or 'previewnet'.`);
    }
    this.network = normalizedNetwork;

    // Exchange rate cache (5-minute TTL)
    this._exchangeRateCache = null;
    this._exchangeRateCacheExpiry = 0;
    this._exchangeRateCacheTTL = 300000; // 5 minutes
  }

  /**
   * Single-attempt fetch from mirror node REST API.
   *
   * Errors are tagged with `retryable: boolean` so the retry wrapper can
   * distinguish transient failures (network, 5xx, timeout) from terminal ones
   * (4xx client errors, JSON parse failures).
   *
   * @param {string} path - API path
   * @returns {Promise<Object>} Parsed JSON response
   * @private
   */
  _fetchOnce(path) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseHost,
        port: 443,
        path: path,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`Mirror node request failed: HTTP ${res.statusCode} for ${path}`);
            err.statusCode = res.statusCode;
            err.retryable = res.statusCode >= 500; // retry 5xx only — 4xx is a client problem
            reject(err);
            return;
          }

          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (parseErr) {
            const err = new Error(`Failed to parse mirror node response for ${path}: ${parseErr.message}`);
            err.retryable = false;
            reject(err);
          }
        });
      });

      req.on('error', (netErr) => {
        const err = new Error(`Mirror node connection error for ${path}: ${netErr.message}`);
        err.retryable = true;
        err.code = netErr.code;
        reject(err);
      });

      req.setTimeout(15000, () => {
        req.destroy();
        const err = new Error(`Mirror node request timed out for ${path}`);
        err.retryable = true;
        err.code = 'ETIMEDOUT';
        reject(err);
      });

      req.end();
    });
  }

  /**
   * Fetch with exponential backoff (Phase B14).
   *
   * Retries up to 3 times with 1s, 2s, 4s backoff on:
   * - Network errors (ECONNRESET, ETIMEDOUT, etc.)
   * - HTTP 5xx server errors
   * - Request timeouts
   *
   * Does NOT retry 4xx (client-side errors) or JSON parse failures.
   * This matters because Phase B11's verifyExecution path treats mirror
   * confirmation as correctness-critical — a single transient blip should
   * not turn a successful Hedera transaction into "unconfirmed".
   *
   * @param {string} path - API path
   * @param {Object} [options]
   * @param {number} [options.maxRetries=3]
   * @returns {Promise<Object>} Parsed JSON response
   * @private
   */
  async _fetch(path, options = {}) {
    const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 3;
    const backoffMs = [1000, 2000, 4000, 8000];
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._fetchOnce(path);
      } catch (err) {
        lastError = err;
        if (!err.retryable || attempt === maxRetries) {
          throw err;
        }
        const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)];
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  /**
   * Get current exchange rate from mirror node
   *
   * Returns the current HBAR-to-USD exchange rate. Results are cached for 5 minutes.
   *
   * @returns {Promise<{centEquivalent: number, hbarEquivalent: number, usdPerHbar: number}>}
   */
  async getExchangeRate() {
    const now = Date.now();

    // Return cached value if still valid
    if (this._exchangeRateCache && now < this._exchangeRateCacheExpiry) {
      return this._exchangeRateCache;
    }

    const response = await this._fetch('/api/v1/network/exchangerate');

    const currentRate = response.current_rate;
    if (!currentRate) {
      throw new Error('Exchange rate data not available from mirror node');
    }

    const result = {
      centEquivalent: currentRate.cent_equivalent,
      hbarEquivalent: currentRate.hbar_equivalent,
      usdPerHbar: currentRate.cent_equivalent / currentRate.hbar_equivalent / 100,
    };

    // Cache the result
    this._exchangeRateCache = result;
    this._exchangeRateCacheExpiry = now + this._exchangeRateCacheTTL;

    return result;
  }

  /**
   * Get token information from mirror node
   *
   * @param {string} tokenId - Token ID (e.g., '0.0.12345')
   * @returns {Promise<{name: string, symbol: string, decimals: number, totalSupply: string}>}
   */
  async getTokenInfo(tokenId) {
    const response = await this._fetch(`/api/v1/tokens/${tokenId}`);

    return {
      name: response.name || null,
      symbol: response.symbol || null,
      decimals: parseInt(response.decimals, 10) || 0,
      totalSupply: response.total_supply || '0',
    };
  }

  /**
   * Get account information from mirror node
   *
   * @param {string} accountId - Account ID (e.g., '0.0.12345')
   * @returns {Promise<{balance: string, tokens: Array<{token_id: string, balance: number}>}>}
   */
  async getAccountInfo(accountId) {
    const response = await this._fetch(`/api/v1/accounts/${accountId}`);

    return {
      balance: response.balance?.balance?.toString() || '0',
      tokens: (response.balance?.tokens || []).map(t => ({
        token_id: t.token_id,
        balance: t.balance,
      })),
    };
  }

  /**
   * Look up an executed transaction on the mirror node (Phase B11).
   *
   * Hedera SDK transaction IDs have the form `0.0.X@123456789.000000000`. The
   * mirror REST API expects them transformed to `0.0.X-123456789-000000000`.
   *
   * Mirror node has ~3–5 second eventual-consistency lag. Callers should
   * either accept a `null` result or poll via `verifyExecution`.
   *
   * @param {string} transactionId - SDK-format transaction ID
   * @returns {Promise<Object|null>} Transaction record, or null if not yet on mirror
   */
  async getTransaction(transactionId) {
    const mirrorId = String(transactionId).replace('@', '-').replace(/\.(?=\d+$)/, '-');
    try {
      const response = await this._fetch(`/api/v1/transactions/${mirrorId}`);
      const tx = Array.isArray(response.transactions) && response.transactions.length > 0
        ? response.transactions[0]
        : null;
      if (!tx) return null;
      return {
        transactionId: tx.transaction_id,
        consensusTimestamp: tx.consensus_timestamp,
        result: tx.result,
        chargedTxFee: tx.charged_tx_fee,
        memoBase64: tx.memo_base64,
        transfers: tx.transfers || [],
        tokenTransfers: tx.token_transfers || [],
        nftTransfers: tx.nft_transfers || [],
        scheduled: tx.scheduled || false,
        entityId: tx.entity_id || null,
        name: tx.name || null,
      };
    } catch (err) {
      // 404: not (yet) on mirror — caller decides whether to retry
      if (err.statusCode === 404) return null;
      throw err;
    }
  }

  /**
   * Confirm a transaction's mirror-node execution (Phase B11).
   *
   * Polls the mirror node up to `maxAttempts` times with `pollIntervalMs`
   * between attempts. Returns immediately on first hit. Tolerates the
   * ~3–5s mirror lag without turning successful TXs into "unconfirmed".
   *
   * @param {string} transactionId - SDK-format transaction ID
   * @param {Object} [options]
   * @param {number} [options.maxAttempts=8] - Poll at most this many times (~24s default)
   * @param {number} [options.pollIntervalMs=3000] - Delay between attempts
   * @returns {Promise<{mirrorConfirmed: boolean, record: Object|null, result: string|null}>}
   */
  async verifyExecution(transactionId, options = {}) {
    const maxAttempts = options.maxAttempts || 8;
    const pollIntervalMs = options.pollIntervalMs || 3000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const record = await this.getTransaction(transactionId);
      if (record) {
        return {
          mirrorConfirmed: true,
          record,
          result: record.result || null,
        };
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }

    return { mirrorConfirmed: false, record: null, result: null };
  }

  /**
   * Get schedule information from mirror node
   *
   * @param {string} scheduleId - Schedule ID (e.g., '0.0.12345')
   * @returns {Promise<Object>} Schedule details including creator, payer, executed status, etc.
   */
  async getScheduleInfo(scheduleId) {
    const response = await this._fetch(`/api/v1/schedules/${scheduleId}`);

    return {
      scheduleId: response.schedule_id || scheduleId,
      creatorAccountId: response.creator_account_id || null,
      payerAccountId: response.payer_account_id || null,
      adminKey: response.admin_key || null,
      scheduleMemo: response.memo || null,
      expirationTime: response.expiration_time || null,
      executedTimestamp: response.executed_timestamp || null,
      deletedTimestamp: response.deleted || false,
      signatures: response.signatures || [],
      transactionBody: response.transaction_body || null,
      waitForExpiry: response.wait_for_expiry || false,
    };
  }

  /**
   * Single-attempt POST to a mirror-node JSON endpoint.
   *
   * Mirrors `_fetchOnce` for the POST shape `/api/v1/contracts/call` uses
   * (HIP-584's free read-only contract execution). Errors are tagged
   * `retryable` for the same reasons as the GET path.
   *
   * @private
   */
  _postOnce(path, body) {
    return new Promise((resolve, reject) => {
      const payload = Buffer.from(JSON.stringify(body), 'utf8');
      const options = {
        hostname: this.baseHost,
        port: 443,
        path,
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`Mirror node POST failed: HTTP ${res.statusCode} for ${path} — ${data.slice(0, 200)}`);
            err.statusCode = res.statusCode;
            err.responseBody = data;
            // The mirror's contract-call endpoint can return 404 for a
            // contract that exists on consensus but hasn't propagated yet
            // (HIP-584 docs note this propagation delay). Treat 404 as
            // retryable so the wait/retry layer can absorb the lag.
            err.retryable = res.statusCode >= 500 || res.statusCode === 404;
            reject(err);
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (parseErr) {
            const err = new Error(`Failed to parse mirror node POST response for ${path}: ${parseErr.message}`);
            err.retryable = false;
            reject(err);
          }
        });
      });

      req.on('error', (netErr) => {
        const err = new Error(`Mirror node POST connection error for ${path}: ${netErr.message}`);
        err.retryable = true;
        err.code = netErr.code;
        reject(err);
      });

      req.setTimeout(15000, () => {
        req.destroy();
        const err = new Error(`Mirror node POST timed out for ${path}`);
        err.retryable = true;
        err.code = 'ETIMEDOUT';
        reject(err);
      });

      req.write(payload);
      req.end();
    });
  }

  async _post(path, body, options = {}) {
    const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 3;
    const backoffMs = [1000, 2000, 4000, 8000];
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._postOnce(path, body);
      } catch (err) {
        lastError = err;
        if (!err.retryable || attempt === maxRetries) throw err;
        const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)];
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  /**
   * Resolve a Hedera AccountId to an EVM-format address.
   *
   * Mirror lookup first — for ECDSA-keyed accounts the canonical EVM
   * address is derived from the public key (an EIP-55 / 20-byte
   * derivation, NOT long-zero), and the mirror node returns it in the
   * `evm_address` field of `/api/v1/accounts/{id}`. For ED25519-keyed
   * accounts the mirror returns `null` for that field, in which case
   * long-zero (account num packed into 20-byte hex) is the correct
   * representation.
   *
   * Long-zero is the unconditional fallback when the mirror lookup
   * fails entirely. **It is wrong for ECDSA accounts**, so callers
   * should ensure the mirror is reachable before running operations
   * where address correctness is load-bearing.
   *
   * @param {string|import('@hashgraph/sdk').AccountId} accountId
   * @returns {Promise<string>} 0x-prefixed 20-byte EVM address
   */
  async accountToEvmAddress(accountId) {
    const idStr = typeof accountId === 'string' ? accountId : accountId.toString();
    let mirrorEvm = null;
    try {
      const response = await this._fetch(`/api/v1/accounts/${idStr}`);
      mirrorEvm = response.evm_address || null;
    } catch {
      // mirror lookup failed; fall through to long-zero
    }
    if (mirrorEvm) {
      return mirrorEvm.startsWith('0x') ? mirrorEvm : '0x' + mirrorEvm;
    }
    const { AccountId } = require('@hashgraph/sdk');
    const acc = typeof accountId === 'string' ? AccountId.fromString(accountId) : accountId;
    return '0x' + acc.toSolidityAddress();
  }

  /**
   * Resolve a Hedera ContractId to an EVM-format address.
   *
   * Contracts don't have ECDSA-derived aliases the way externally-owned
   * accounts can — their canonical EVM address is the long-zero form
   * (contract num packed into 20-byte hex). No mirror lookup needed.
   *
   * @param {string|import('@hashgraph/sdk').ContractId} contractId
   * @returns {string} 0x-prefixed 20-byte EVM address
   */
  contractToEvmAddress(contractId) {
    const { ContractId } = require('@hashgraph/sdk');
    const c = typeof contractId === 'string' ? ContractId.fromString(contractId) : contractId;
    return '0x' + c.toSolidityAddress();
  }

  /**
   * Free read-only contract call via the mirror node (HIP-584).
   *
   * Use this for `view` / `pure` functions instead of `ContractCallQuery`
   * — it's gas-free, reads from the mirror's archived state, and doesn't
   * require an operator to pay a query fee. Mirror state lags consensus
   * by a few seconds; if you call this immediately after a state-changing
   * transaction, set `pollMs` / `maxAttempts` so the client absorbs the
   * propagation lag with backoff.
   *
   * Reference: https://docs.hedera.com/api-reference/contracts/invoke-a-smart-contract
   *
   * @param {Object} args
   * @param {string} args.to - Contract ID (`0.0.X`) or EVM address (`0x…`)
   * @param {string} args.data - ABI-encoded calldata, 0x-prefixed
   * @param {string} [args.from] - Caller address (required for some simulations)
   * @param {string|number} [args.block='latest'] - Block selector
   * @param {boolean} [args.estimate=false] - Gas estimation rather than read
   * @param {number} [args.value] - tinybars to send (state-change simulations)
   * @param {Object} [args.opts]
   * @param {number} [args.opts.pollMs=2500] - Delay between attempts
   * @param {number} [args.opts.maxAttempts=1] - 1 = single shot, raise to wait through mirror lag
   * @returns {Promise<{result: string}>} `{ result: "0x..." }` from the API
   */
  async callContract(args) {
    if (!args || !args.to || !args.data) {
      throw new Error('callContract requires { to, data } at minimum');
    }
    const body = {
      block: args.block || 'latest',
      data: args.data,
      to: args.to,
      ...(args.from ? { from: args.from } : {}),
      ...(args.value !== undefined ? { value: args.value } : {}),
      ...(args.estimate !== undefined ? { estimate: args.estimate } : { estimate: false }),
    };
    const opts = args.opts || {};
    const maxAttempts = Math.max(1, opts.maxAttempts || 1);
    const pollMs = opts.pollMs || 2500;

    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this._post('/api/v1/contracts/call', body, { maxRetries: 1 });
      } catch (err) {
        lastError = err;
        // Retry only when the contract is unreachable on the mirror yet
        // (404) or transient — if the call comes back with a deterministic
        // 4xx (bad calldata, contract revert), bail immediately.
        const transient = err.statusCode === 404 || err.retryable;
        if (!transient || attempt === maxAttempts - 1) throw err;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    }
    throw lastError;
  }
}

module.exports = MirrorNodeClient;
