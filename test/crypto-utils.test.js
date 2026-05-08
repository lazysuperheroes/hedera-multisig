/**
 * shared/crypto-utils tests (Phase F7).
 *
 * Pure-function tests for timing-safe comparison, ID generation, and
 * key sanitization. Quick coverage win: every function in the module.
 */

const { expect } = require('chai');
const {
  timingSafeCompare,
  generateSessionId,
  generateParticipantId,
  sanitizePublicKey,
  toRawPublicKeyHex,
} = require('../shared/crypto-utils');

describe('shared/crypto-utils (Phase F7)', function() {

  describe('timingSafeCompare', function() {
    it('true on equal strings', function() {
      expect(timingSafeCompare('TESTPIN1', 'TESTPIN1')).to.be.true;
    });

    it('false on different strings of same length', function() {
      expect(timingSafeCompare('TESTPIN1', 'TESTPIN2')).to.be.false;
    });

    it('false on different lengths (without leaking length via timing)', function() {
      expect(timingSafeCompare('short', 'longer string')).to.be.false;
    });

    it('false when first arg is null/undefined/empty', function() {
      expect(timingSafeCompare(null, 'x')).to.be.false;
      expect(timingSafeCompare(undefined, 'x')).to.be.false;
      expect(timingSafeCompare('', 'x')).to.be.false;
    });

    it('false when second arg is null/undefined/empty', function() {
      expect(timingSafeCompare('x', null)).to.be.false;
      expect(timingSafeCompare('x', undefined)).to.be.false;
      expect(timingSafeCompare('x', '')).to.be.false;
    });

    it('handles unicode strings', function() {
      expect(timingSafeCompare('héllo', 'héllo')).to.be.true;
      expect(timingSafeCompare('héllo', 'hello')).to.be.false;
    });
  });

  describe('generateSessionId', function() {
    it('returns 32-character hex string', function() {
      const id = generateSessionId();
      expect(id).to.be.a('string');
      expect(id).to.have.length(32);
      expect(id).to.match(/^[0-9a-f]{32}$/);
    });

    it('generates unique IDs', function() {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateSessionId());
      }
      expect(ids.size).to.equal(100); // All unique
    });
  });

  describe('generateParticipantId', function() {
    it('returns 16-character hex string', function() {
      const id = generateParticipantId();
      expect(id).to.have.length(16);
      expect(id).to.match(/^[0-9a-f]{16}$/);
    });

    it('generates unique IDs', function() {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateParticipantId());
      }
      expect(ids.size).to.equal(100);
    });
  });

  describe('sanitizePublicKey', function() {
    it('returns "***" for null', function() {
      expect(sanitizePublicKey(null)).to.equal('***');
    });

    it('returns "***" for undefined', function() {
      expect(sanitizePublicKey(undefined)).to.equal('***');
    });

    it('returns "***" for short keys (<12 chars)', function() {
      expect(sanitizePublicKey('short')).to.equal('***');
      expect(sanitizePublicKey('eleven char')).to.equal('***'); // 11 chars
    });

    it('returns first 6 + "..." + last 4 for valid keys', function() {
      const key = '302a300506032b65700321001234567890abcdef1234567890abcdef';
      const result = sanitizePublicKey(key);
      expect(result).to.equal('302a30...cdef');
      expect(result.length).to.equal(13); // 6 + "..." + 4
    });

    it('handles minimum-length valid key (12 chars exactly)', function() {
      const key = '123456789abc';
      const result = sanitizePublicKey(key);
      expect(result).to.equal('123456...9abc');
    });
  });

  describe('toRawPublicKeyHex', function() {
    const RAW = '6483e83472c00ff3f3c41be120b738d589c8512840863f96d07fc6e704674017';
    const ED25519_DER = '302a300506032b657003210' + '0' + RAW;

    it('returns "" for empty/non-string input', function() {
      expect(toRawPublicKeyHex('')).to.equal('');
      expect(toRawPublicKeyHex(null)).to.equal('');
      expect(toRawPublicKeyHex(undefined)).to.equal('');
      expect(toRawPublicKeyHex(123)).to.equal('');
    });

    it('returns raw hex unchanged (lowercased)', function() {
      expect(toRawPublicKeyHex(RAW)).to.equal(RAW);
      expect(toRawPublicKeyHex(RAW.toUpperCase())).to.equal(RAW);
    });

    it('strips 0x prefix', function() {
      expect(toRawPublicKeyHex('0x' + RAW)).to.equal(RAW);
      expect(toRawPublicKeyHex('0X' + RAW)).to.equal(RAW);
    });

    it('strips ed25519 DER prefix', function() {
      expect(toRawPublicKeyHex(ED25519_DER)).to.equal(RAW);
    });

    it('strips ed25519 DER plus 0x prefix', function() {
      expect(toRawPublicKeyHex('0x' + ED25519_DER)).to.equal(RAW);
    });

    it('strips ECDSA secp256k1 DER prefix (33-byte compressed key)', function() {
      const compressed = '02' + 'a'.repeat(64); // 33 bytes = 66 hex chars
      const ecdsaDer = '302d300706052b8104000a032200' + compressed;
      expect(toRawPublicKeyHex(ecdsaDer)).to.equal(compressed);
    });

    it('canonicalizes the same key to the same raw form regardless of producer', function() {
      // The CLI writes DER, HashPack/WalletConnect emits raw — both
      // must canonicalize identically for AUTH eligibility to pass.
      expect(toRawPublicKeyHex(ED25519_DER)).to.equal(toRawPublicKeyHex(RAW));
    });

    it('trims whitespace', function() {
      expect(toRawPublicKeyHex('  ' + RAW + '\n')).to.equal(RAW);
    });
  });
});
