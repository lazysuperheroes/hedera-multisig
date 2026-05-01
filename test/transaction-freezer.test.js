/**
 * TransactionFreezer tests (Phase F7).
 *
 * Covers static helpers that don't need a live Hedera client:
 * fromBase64, verifyHash, getTimeRemaining/Elapsed, formatTimeRemaining,
 * isNearingExpiration, validateNotExpired.
 */

const { expect } = require('chai');
const TransactionFreezer = require('../core/TransactionFreezer');

function makeFrozenTx(secondsAgo = 0) {
  const frozenAt = new Date(Date.now() - secondsAgo * 1000);
  const expiresAt = new Date(frozenAt.getTime() + TransactionFreezer.MAX_SAFE_AGE_SECONDS * 1000);
  return {
    bytes: Buffer.from('hello world', 'utf8'),
    base64: Buffer.from('hello world').toString('base64'),
    hash: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    frozenAt,
    expiresAt,
    transaction: null,
    txDetails: null,
  };
}

describe('TransactionFreezer (Phase F7)', function() {

  describe('Static constants', function() {
    it('MAX_SAFE_AGE_SECONDS is 110', function() {
      expect(TransactionFreezer.MAX_SAFE_AGE_SECONDS).to.equal(110);
    });
  });

  describe('getTimeRemaining + getTimeElapsed', function() {
    it('returns ~110s remaining for a fresh frozen tx', function() {
      const tx = makeFrozenTx(0);
      const remaining = TransactionFreezer.getTimeRemaining(tx);
      expect(remaining).to.be.at.least(108).and.at.most(110);
    });

    it('returns negative time for expired tx', function() {
      const tx = makeFrozenTx(120);
      expect(TransactionFreezer.getTimeRemaining(tx)).to.be.below(0);
    });

    it('getTimeElapsed reports seconds since frozen', function() {
      const tx = makeFrozenTx(45);
      const elapsed = TransactionFreezer.getTimeElapsed(tx);
      expect(elapsed).to.be.at.least(44).and.at.most(46);
    });
  });

  describe('isNearingExpiration', function() {
    it('false when fresh', function() {
      expect(TransactionFreezer.isNearingExpiration(makeFrozenTx(0))).to.be.false;
    });

    it('true when 100s elapsed (10s remaining)', function() {
      expect(TransactionFreezer.isNearingExpiration(makeFrozenTx(100))).to.be.true;
    });

    it('false when fully expired (gate is > 0)', function() {
      expect(TransactionFreezer.isNearingExpiration(makeFrozenTx(120))).to.be.false;
    });
  });

  describe('validateNotExpired', function() {
    it('does not throw for fresh tx', function() {
      expect(() => TransactionFreezer.validateNotExpired(makeFrozenTx(0))).to.not.throw();
    });

    it('throws with diagnostic for expired tx', function() {
      expect(() => TransactionFreezer.validateNotExpired(makeFrozenTx(120))).to.throw(/expired/i);
    });
  });

  describe('formatTimeRemaining', function() {
    it('returns "EXPIRED" for expired tx', function() {
      expect(TransactionFreezer.formatTimeRemaining(makeFrozenTx(120))).to.equal('EXPIRED');
    });

    it('returns Ns form when under 60s', function() {
      // ~30s remaining: 110 - 80 = 30
      const result = TransactionFreezer.formatTimeRemaining(makeFrozenTx(80));
      expect(result).to.match(/^\d+s$/);
    });

    it('returns "Mm Ss" form when 60s or more', function() {
      // Fresh tx ~110s remaining
      const result = TransactionFreezer.formatTimeRemaining(makeFrozenTx(0));
      expect(result).to.match(/^\d+m \d+s$/);
    });
  });

  describe('fromBase64 round-trip', function() {
    it('reconstructs bytes + hash from base64', function() {
      const original = Buffer.from('hello world');
      const base64 = original.toString('base64');
      const ts = Date.now();

      const reconstructed = TransactionFreezer.fromBase64(base64, ts);

      expect(reconstructed.bytes).to.deep.equal(original);
      expect(reconstructed.base64).to.equal(base64);
      expect(reconstructed.hash).to.match(/^[a-f0-9]{64}$/);
      expect(reconstructed.frozenAt.getTime()).to.equal(ts);
      expect(reconstructed.expiresAt.getTime()).to.equal(ts + 110_000);
      expect(reconstructed.transaction).to.be.null;
    });

    it('throws on garbage input that decoder rejects', function() {
      // Buffer.from accepts almost anything as base64; the throw happens
      // only on truly catastrophic input. We exercise the catch arm by
      // passing a non-string value, which will throw inside Buffer.from.
      expect(() => TransactionFreezer.fromBase64(null, Date.now())).to.throw(/reconstruct/);
    });
  });

  describe('verifyHash', function() {
    it('true when bytes match', function() {
      const tx = makeFrozenTx(0);
      const crypto = require('crypto');
      const expectedHash = crypto.createHash('sha256').update(tx.bytes).digest('hex');
      expect(TransactionFreezer.verifyHash(tx, expectedHash)).to.be.true;
    });

    it('false when bytes do not match', function() {
      const tx = makeFrozenTx(0);
      expect(TransactionFreezer.verifyHash(tx, 'deadbeef'.repeat(8))).to.be.false;
    });

    it('accepts raw Uint8Array as input', function() {
      const bytes = Buffer.from('hello world');
      const crypto = require('crypto');
      const expectedHash = crypto.createHash('sha256').update(bytes).digest('hex');
      expect(TransactionFreezer.verifyHash(bytes, expectedHash)).to.be.true;
    });
  });
});
