/**
 * server/utils/keyUtils tests.
 *
 * The DER-vs-raw canonicalization is the load-bearing invariant: the
 * CLI registers eligible keys in SubjectPublicKeyInfo DER form, but
 * browser wallets (HashPack via WalletConnect, etc.) emit the raw
 * 32-byte key over AUTH. Without canonicalization the eligibility
 * check rejects the same key as two different values.
 */

const { expect } = require('chai');
const { isKeyEligible, findMatchingKey, normalizePublicKey } = require('../server/utils/keyUtils');

const ALICE_RAW = '6483e83472c00ff3f3c41be120b738d589c8512840863f96d07fc6e704674017';
const ALICE_DER = '302a300506032b657003210' + '0' + ALICE_RAW;
const BOB_RAW = 'f1ad3978cd761f57a37e1d47c93abd25e6a7e32449f40bd1e4017339cfdc54f0';
const BOB_DER = '302a300506032b657003210' + '0' + BOB_RAW;
const CAROL_RAW = '68c43b71d1a794de1ac7a0cb897c7cde5ffc70614a40d03fcdb442946c6c522e';
const CAROL_DER = '302a300506032b657003210' + '0' + CAROL_RAW;

describe('server/utils/keyUtils', function() {

  describe('isKeyEligible (DER-vs-raw canonicalization)', function() {
    const eligibleDer = [ALICE_DER, BOB_DER, CAROL_DER];

    it('matches raw key against DER-encoded eligible list', function() {
      // Regression: this is exactly the scenario the dApp hits — CLI
      // registered DER keys, HashPack delivered raw.
      expect(isKeyEligible(ALICE_RAW, eligibleDer)).to.be.true;
      expect(isKeyEligible(BOB_RAW, eligibleDer)).to.be.true;
      expect(isKeyEligible(CAROL_RAW, eligibleDer)).to.be.true;
    });

    it('matches DER key against DER-encoded eligible list', function() {
      expect(isKeyEligible(ALICE_DER, eligibleDer)).to.be.true;
    });

    it('matches DER key against raw eligible list', function() {
      // Inverse: if some other producer registers raw and the
      // participant supplies DER, the comparison still works.
      expect(isKeyEligible(ALICE_DER, [ALICE_RAW, BOB_RAW, CAROL_RAW])).to.be.true;
    });

    it('handles 0x prefix on either side', function() {
      expect(isKeyEligible('0x' + ALICE_RAW, eligibleDer)).to.be.true;
      expect(isKeyEligible(ALICE_RAW, ['0x' + ALICE_DER])).to.be.true;
    });

    it('case-insensitive', function() {
      expect(isKeyEligible(ALICE_RAW.toUpperCase(), eligibleDer)).to.be.true;
    });

    it('returns false for unknown keys', function() {
      const unknown = '0'.repeat(64);
      expect(isKeyEligible(unknown, eligibleDer)).to.be.false;
    });

    it('returns false for empty inputs', function() {
      expect(isKeyEligible('', eligibleDer)).to.be.false;
      expect(isKeyEligible(ALICE_RAW, [])).to.be.false;
      expect(isKeyEligible(ALICE_RAW, null)).to.be.false;
      expect(isKeyEligible(null, eligibleDer)).to.be.false;
    });
  });

  describe('findMatchingKey', function() {
    it('returns the eligible entry in its original (DER) form', function() {
      // Useful for callers that need to map the participant's
      // submitted (raw) key back to the canonical DER form they
      // stored at session creation.
      const eligible = [ALICE_DER, BOB_DER, CAROL_DER];
      expect(findMatchingKey(ALICE_RAW, eligible)).to.equal(ALICE_DER);
    });

    it('returns null on no match', function() {
      const eligible = [ALICE_DER, BOB_DER];
      expect(findMatchingKey(CAROL_RAW, eligible)).to.equal(null);
    });
  });

  describe('normalizePublicKey (legacy display normalizer)', function() {
    it('adds 0x prefix when absent', function() {
      expect(normalizePublicKey(ALICE_RAW)).to.equal('0x' + ALICE_RAW);
    });

    it('passes through when already prefixed', function() {
      expect(normalizePublicKey('0x' + ALICE_RAW)).to.equal('0x' + ALICE_RAW);
    });

    it('returns falsy unchanged', function() {
      expect(normalizePublicKey('')).to.equal('');
      expect(normalizePublicKey(null)).to.equal(null);
    });
  });
});
