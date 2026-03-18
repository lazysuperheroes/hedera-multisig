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
   * Fetch JSON from mirror node REST API
   *
   * @param {string} path - API path (e.g., '/api/v1/network/exchangerate')
   * @returns {Promise<Object>} Parsed JSON response
   * @private
   */
  _fetch(path) {
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
            reject(new Error(`Mirror node request failed: HTTP ${res.statusCode} for ${path}`));
            return;
          }

          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (err) {
            reject(new Error(`Failed to parse mirror node response for ${path}: ${err.message}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Mirror node connection error for ${path}: ${err.message}`));
      });

      // 15 second timeout
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error(`Mirror node request timed out for ${path}`));
      });

      req.end();
    });
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
}

module.exports = MirrorNodeClient;
