/**
 * Mirror Node Client Tests
 */

import {
  formatTransactionIdForMirrorNode,
  formatTransactionIdForHashScan,
  getHashScanTransactionUrl,
  getCachedAccountData,
  clearAccountCache
} from '../mirror-node';

describe('Mirror Node Client', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearAccountCache();
  });

  describe('formatTransactionIdForMirrorNode', () => {
    it('converts @ format to hyphen format', () => {
      const input = '0.0.2076@1764452239.277675395';
      const expected = '0.0.2076-1764452239-277675395';
      expect(formatTransactionIdForMirrorNode(input)).toBe(expected);
    });

    it('returns already formatted IDs unchanged', () => {
      const input = '0.0.2076-1764452239-277675395';
      expect(formatTransactionIdForMirrorNode(input)).toBe(input);
    });

    it('handles different account IDs', () => {
      const input = '0.0.123456@1234567890.123456789';
      const expected = '0.0.123456-1234567890-123456789';
      expect(formatTransactionIdForMirrorNode(input)).toBe(expected);
    });
  });

  describe('formatTransactionIdForHashScan', () => {
    it('is an alias for formatTransactionIdForMirrorNode', () => {
      const input = '0.0.2076@1764452239.277675395';
      expect(formatTransactionIdForHashScan(input)).toBe(
        formatTransactionIdForMirrorNode(input)
      );
    });
  });

  describe('getHashScanTransactionUrl', () => {
    const txId = '0.0.2076@1764452239.277675395';
    const formattedId = '0.0.2076-1764452239-277675395';

    it('generates testnet URL by default', () => {
      const url = getHashScanTransactionUrl(txId);
      expect(url).toBe(`https://hashscan.io/testnet/transactionsById/${formattedId}`);
    });

    it('generates testnet URL when specified', () => {
      const url = getHashScanTransactionUrl(txId, 'testnet');
      expect(url).toBe(`https://hashscan.io/testnet/transactionsById/${formattedId}`);
    });

    it('generates mainnet URL when specified', () => {
      const url = getHashScanTransactionUrl(txId, 'mainnet');
      expect(url).toBe(`https://hashscan.io/mainnet/transactionsById/${formattedId}`);
    });
  });

  describe('Cache Operations', () => {
    it('returns null for non-existent cache entries', () => {
      expect(getCachedAccountData('0.0.12345')).toBeNull();
    });

    it('clearAccountCache clears all entries', () => {
      // Note: We can't easily test adding entries without mocking fetch
      // This just verifies the function doesn't throw
      expect(() => clearAccountCache()).not.toThrow();
    });

    it('clearAccountCache with ID clears specific entry', () => {
      expect(() => clearAccountCache('0.0.12345')).not.toThrow();
    });
  });
});
