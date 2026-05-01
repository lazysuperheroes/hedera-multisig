/**
 * PolicyEngine + built-in rules tests (Phase F7).
 *
 * Each rule + the engine's compose-and-evaluate are covered with a pair
 * of allow/deny cases plus the edge cases the rules' source comments hint
 * at (no transfers, missing tx type, midnight-wrapping window, restart-resets).
 *
 * These are unit tests with no Hedera dependencies — instantiate, evaluate,
 * assert. Each `RateLimitRule` / `TimeWindowRule` test instantiates a fresh
 * rule to avoid in-memory state leaking between cases.
 */

const { expect } = require('chai');
const {
  PolicyEngine,
  MaxAmountRule,
  AllowedRecipientsRule,
  AllowedTransactionTypesRule,
  TimeWindowRule,
  RateLimitRule,
  createTreasuryAgentPolicy,
  createApprovalBotPolicy,
} = require('../client/PolicyEngine');

describe('PolicyEngine (Phase F7)', function() {

  describe('PolicyEngine compose + AND-logic', function() {
    it('approves when no rules registered', async function() {
      const policy = new PolicyEngine();
      const result = await policy.evaluate({}, {});
      expect(result.approved).to.be.true;
    });

    it('addRule is chainable + validates rule shape', function() {
      const policy = new PolicyEngine();
      const rule = { evaluate: async () => ({ approved: true }) };
      const returned = policy.addRule(rule);
      expect(returned).to.equal(policy);

      expect(() => policy.addRule(null)).to.throw(/evaluate/);
      expect(() => policy.addRule({})).to.throw(/evaluate/);
    });

    it('rejects when any rule rejects, listing all failures', async function() {
      const policy = new PolicyEngine()
        .addRule({ evaluate: async () => ({ approved: false, reason: 'rule-A failed' }) })
        .addRule({ evaluate: async () => ({ approved: true }) })
        .addRule({ evaluate: async () => ({ approved: false, reason: 'rule-C failed' }) });
      const result = await policy.evaluate({}, {});
      expect(result.approved).to.be.false;
      expect(result.failedRules).to.have.lengthOf(2);
      expect(result.reason).to.include('rule-A failed');
      expect(result.reason).to.include('rule-C failed');
    });

    it('treats a rule that throws as a failure (not a crash)', async function() {
      const policy = new PolicyEngine()
        .addRule({ evaluate: async () => { throw new Error('boom'); } });
      const result = await policy.evaluate({}, {});
      expect(result.approved).to.be.false;
      expect(result.reason).to.match(/boom/);
    });
  });

  describe('MaxAmountRule', function() {
    it('approves when no transfers (e.g. token associate)', async function() {
      const rule = new MaxAmountRule(100);
      const r = await rule.evaluate({});
      expect(r.approved).to.be.true;
    });

    it('approves when largest transfer is under the limit', async function() {
      const rule = new MaxAmountRule(100); // 100 HBAR
      const r = await rule.evaluate({
        transfers: [
          { accountId: '0.0.1', amount: '-9999999999' },   // ~99.99 HBAR
          { accountId: '0.0.2', amount: '9999999999' },
        ],
      });
      expect(r.approved).to.be.true;
    });

    it('rejects when any transfer exceeds the limit', async function() {
      const rule = new MaxAmountRule(50);
      const r = await rule.evaluate({
        transfers: [
          { accountId: '0.0.1', amount: '-10000000000' }, // 100 HBAR
          { accountId: '0.0.2', amount: '10000000000' },
        ],
      });
      expect(r.approved).to.be.false;
      expect(r.reason).to.match(/exceeds limit/);
    });
  });

  describe('AllowedRecipientsRule', function() {
    it('approves when all recipients are whitelisted', async function() {
      const rule = new AllowedRecipientsRule(['0.0.999']);
      const r = await rule.evaluate({
        transfers: [
          { accountId: '0.0.1', amount: '-100' }, // sender
          { accountId: '0.0.999', amount: '100' }, // recipient
        ],
      });
      expect(r.approved).to.be.true;
    });

    it('rejects when any recipient is not whitelisted', async function() {
      const rule = new AllowedRecipientsRule(['0.0.999']);
      const r = await rule.evaluate({
        transfers: [
          { accountId: '0.0.1', amount: '-100' },
          { accountId: '0.0.666', amount: '100' }, // not allowed
        ],
      });
      expect(r.approved).to.be.false;
      expect(r.reason).to.include('0.0.666');
    });

    it('does not check senders (negative amounts)', async function() {
      const rule = new AllowedRecipientsRule(['0.0.999']);
      const r = await rule.evaluate({
        transfers: [
          { accountId: '0.0.UNKNOWN_SENDER', amount: '-100' },
          { accountId: '0.0.999', amount: '100' },
        ],
      });
      expect(r.approved).to.be.true;
    });
  });

  describe('AllowedTransactionTypesRule', function() {
    it('approves allowed type', async function() {
      const rule = new AllowedTransactionTypesRule(['TransferTransaction']);
      const r = await rule.evaluate({ type: 'TransferTransaction' });
      expect(r.approved).to.be.true;
    });

    it('rejects disallowed type', async function() {
      const rule = new AllowedTransactionTypesRule(['TransferTransaction']);
      const r = await rule.evaluate({ type: 'ContractExecuteTransaction' });
      expect(r.approved).to.be.false;
      expect(r.reason).to.include('ContractExecuteTransaction');
    });

    it('rejects when type is missing entirely', async function() {
      const rule = new AllowedTransactionTypesRule(['TransferTransaction']);
      const r = await rule.evaluate({});
      expect(r.approved).to.be.false;
      expect(r.reason).to.match(/Unknown transaction type/);
    });

    it('also reads transactionType field (legacy decoder shape)', async function() {
      const rule = new AllowedTransactionTypesRule(['TransferTransaction']);
      const r = await rule.evaluate({ transactionType: 'TransferTransaction' });
      expect(r.approved).to.be.true;
    });
  });

  describe('TimeWindowRule', function() {
    it('approves when current hour is inside a non-wrapping window', async function() {
      const hour = new Date().getUTCHours();
      // Window covering current hour
      const rule = new TimeWindowRule(Math.max(0, hour), Math.min(23, hour + 1));
      const r = await rule.evaluate();
      expect(r.approved).to.be.true;
    });

    it('rejects when current hour is outside the window', async function() {
      const hour = new Date().getUTCHours();
      // Window that intentionally excludes current hour
      const startHour = (hour + 2) % 24;
      const endHour = (hour + 4) % 24;
      const rule = new TimeWindowRule(startHour, endHour);
      const r = await rule.evaluate();
      expect(r.approved).to.be.false;
      expect(r.reason).to.match(/outside allowed window/);
    });

    it('handles a midnight-wrapping window (e.g. 22:00 → 06:00)', async function() {
      // Pick a wrapping window that should always include the current hour
      const hour = new Date().getUTCHours();
      // Window: 1h before now → 1h after now, wrapping if needed
      const startHour = (hour - 1 + 24) % 24;
      const endHour = (hour + 1) % 24;
      const rule = new TimeWindowRule(startHour, endHour);
      const r = await rule.evaluate();
      expect(r.approved).to.be.true;
    });
  });

  describe('RateLimitRule', function() {
    it('approves the first call (under limit)', async function() {
      const rule = new RateLimitRule(5);
      const r = await rule.evaluate();
      expect(r.approved).to.be.true;
    });

    it('rejects the (N+1)th call after N approvals in the same hour', async function() {
      const rule = new RateLimitRule(3);
      await rule.evaluate(); // 1
      await rule.evaluate(); // 2
      await rule.evaluate(); // 3
      const r = await rule.evaluate(); // 4 — over the limit
      expect(r.approved).to.be.false;
      expect(r.reason).to.match(/Rate limit exceeded/);
    });

    it('forgets approvals older than 1 hour', async function() {
      const rule = new RateLimitRule(2);
      // Inject two stale timestamps from > 1h ago
      rule.approvalTimestamps = [Date.now() - 3700000, Date.now() - 3700000];
      const r = await rule.evaluate(); // Should garbage-collect those, then approve
      expect(r.approved).to.be.true;
      // After GC + this approval, only the new timestamp remains
      expect(rule.approvalTimestamps).to.have.lengthOf(1);
    });

    it('state resets on fresh instance (documented "restart" caveat)', async function() {
      const rule1 = new RateLimitRule(1);
      await rule1.evaluate();
      const r1 = await rule1.evaluate();
      expect(r1.approved).to.be.false;

      // Fresh instance — fresh state
      const rule2 = new RateLimitRule(1);
      const r2 = await rule2.evaluate();
      expect(r2.approved).to.be.true;
    });
  });

  describe('Policy presets', function() {
    it('createTreasuryAgentPolicy composes max + recipients + types', async function() {
      const policy = createTreasuryAgentPolicy({
        maxHbar: 100,
        allowedRecipients: ['0.0.999'],
        allowedTypes: ['TransferTransaction'],
      });
      const ok = await policy.evaluate({
        type: 'TransferTransaction',
        transfers: [
          { accountId: '0.0.1', amount: '-9000000000' },     // 90 HBAR
          { accountId: '0.0.999', amount: '9000000000' },
        ],
      }, {});
      expect(ok.approved).to.be.true;

      const denyByAmount = await policy.evaluate({
        type: 'TransferTransaction',
        transfers: [
          { accountId: '0.0.1', amount: '-50000000000' },    // 500 HBAR > 100
          { accountId: '0.0.999', amount: '50000000000' },
        ],
      }, {});
      expect(denyByAmount.approved).to.be.false;

      const denyByRecipient = await policy.evaluate({
        type: 'TransferTransaction',
        transfers: [
          { accountId: '0.0.1', amount: '-9000000000' },
          { accountId: '0.0.666', amount: '9000000000' },    // not in allowed
        ],
      }, {});
      expect(denyByRecipient.approved).to.be.false;

      const denyByType = await policy.evaluate({
        type: 'ContractExecuteTransaction',
        transfers: [],
      }, {});
      expect(denyByType.approved).to.be.false;
    });

    it('createApprovalBotPolicy composes types + window + rate limit', async function() {
      const hour = new Date().getUTCHours();
      const policy = createApprovalBotPolicy({
        allowedTypes: ['TransferTransaction'],
        startHour: (hour - 1 + 24) % 24,
        endHour: (hour + 1) % 24,
        maxPerHour: 10,
      });
      const ok = await policy.evaluate({
        type: 'TransferTransaction',
        transfers: [{ accountId: '0.0.1', amount: '-1' }],
      }, {});
      expect(ok.approved).to.be.true;
    });
  });
});
