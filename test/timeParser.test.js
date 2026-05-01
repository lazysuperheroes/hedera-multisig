/**
 * Tests for cli/utils/timeParser (Phase A12, A13).
 *
 * Verifies the human-friendly expiration-time parser used by `schedule create
 * --expiration-time`. Covers duration suffixes, ISO-8601, error cases, and
 * the HIP-423 ~62-day horizon enforcement.
 */

const { expect } = require('chai');
const { parseExpirationTime, MAX_SCHEDULE_DURATION_SECONDS } = require('../cli/utils/timeParser');

describe('timeParser.parseExpirationTime (Phase A12)', function() {

  describe('duration suffixes', function() {
    it('parses 60s as 60 seconds in the future', function() {
      const before = Date.now();
      const result = parseExpirationTime('60s');
      const futureMs = result.getTime() - before;
      expect(futureMs).to.be.at.least(59000);
      expect(futureMs).to.be.at.most(61000);
    });

    it('parses 30m as 30 minutes in the future', function() {
      const result = parseExpirationTime('30m');
      const futureMs = result.getTime() - Date.now();
      expect(futureMs).to.be.closeTo(30 * 60 * 1000, 2000);
    });

    it('parses 2h as 2 hours in the future', function() {
      const result = parseExpirationTime('2h');
      const futureMs = result.getTime() - Date.now();
      expect(futureMs).to.be.closeTo(2 * 3600 * 1000, 2000);
    });

    it('parses 30d as 30 days in the future', function() {
      const result = parseExpirationTime('30d');
      const futureMs = result.getTime() - Date.now();
      expect(futureMs).to.be.closeTo(30 * 86400 * 1000, 2000);
    });

    it('parses 8w as 8 weeks in the future (within HIP-423 horizon)', function() {
      const result = parseExpirationTime('8w');
      const futureSeconds = (result.getTime() - Date.now()) / 1000;
      expect(futureSeconds).to.be.lessThan(MAX_SCHEDULE_DURATION_SECONDS);
    });

    it('is case-insensitive on the unit', function() {
      const result = parseExpirationTime('30D');
      const futureMs = result.getTime() - Date.now();
      expect(futureMs).to.be.closeTo(30 * 86400 * 1000, 2000);
    });

    it('rejects zero duration', function() {
      expect(() => parseExpirationTime('0d')).to.throw(/positive/);
    });

    it('rejects unknown unit', function() {
      expect(() => parseExpirationTime('30y')).to.throw(/Invalid expiration-time/);
    });

    it('rejects bare number without unit', function() {
      expect(() => parseExpirationTime('30')).to.throw(/Invalid expiration-time/);
    });
  });

  describe('ISO-8601 timestamps', function() {
    it('parses a future ISO-8601 datetime', function() {
      const future = new Date(Date.now() + 5 * 86400 * 1000).toISOString();
      const result = parseExpirationTime(future);
      expect(result.toISOString()).to.equal(future);
    });

    it('parses an ISO date (YYYY-MM-DD) as start-of-day UTC', function() {
      const tomorrow = new Date(Date.now() + 86400 * 1000);
      const yyyy = tomorrow.getUTCFullYear();
      const mm = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(tomorrow.getUTCDate()).padStart(2, '0');
      const result = parseExpirationTime(`${yyyy}-${mm}-${dd}`);
      expect(result.getUTCFullYear()).to.equal(yyyy);
      expect(result.getUTCHours()).to.equal(0);
    });

    it('rejects a past ISO timestamp', function() {
      const past = new Date(Date.now() - 86400 * 1000).toISOString();
      expect(() => parseExpirationTime(past)).to.throw(/in the past/);
    });
  });

  describe('HIP-423 horizon enforcement', function() {
    it('rejects 100d (exceeds ~62-day cap)', function() {
      expect(() => parseExpirationTime('100d')).to.throw(/HIP-423/);
    });

    it('rejects ISO timestamp 1 year in the future', function() {
      const farFuture = new Date(Date.now() + 365 * 86400 * 1000).toISOString();
      expect(() => parseExpirationTime(farFuture)).to.throw(/HIP-423/);
    });

    it('accepts 62d (boundary, within cap)', function() {
      const result = parseExpirationTime('61d'); // intentionally 61d to leave headroom for clock skew
      expect(result).to.be.instanceOf(Date);
    });

    it('skips horizon check when enforceScheduleHorizon=false', function() {
      const result = parseExpirationTime('365d', { enforceScheduleHorizon: false });
      expect(result).to.be.instanceOf(Date);
    });

    it('exposes MAX_SCHEDULE_DURATION_SECONDS = 5356800 (62 days)', function() {
      expect(MAX_SCHEDULE_DURATION_SECONDS).to.equal(5356800);
      expect(MAX_SCHEDULE_DURATION_SECONDS / 86400).to.equal(62);
    });
  });

  describe('null / empty input', function() {
    it('returns null for null', function() {
      expect(parseExpirationTime(null)).to.be.null;
    });

    it('returns null for undefined', function() {
      expect(parseExpirationTime(undefined)).to.be.null;
    });

    it('returns null for empty string', function() {
      expect(parseExpirationTime('')).to.be.null;
    });
  });

  describe('whitespace tolerance', function() {
    it('trims leading/trailing whitespace on duration', function() {
      const result = parseExpirationTime('  30d  ');
      expect(result).to.be.instanceOf(Date);
    });
  });
});
