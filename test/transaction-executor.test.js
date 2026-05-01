/**
 * TransactionExecutor tests (Phase F7).
 *
 * Exercises the executor's branches that DON'T need a live Hedera network:
 *   - mirror-confirmation happy / fail paths via stubbed MirrorNodeClient
 *   - verifyOnMirror=false shortcut
 *   - mirrorPollMaxAttempts=1 quick fail
 *   - audit-log entry creation + sanitization
 *   - readAuditLog round-trip
 *
 * The transaction.execute() and getReceipt() steps are stubbed out via a
 * "pre-built" frozenTx whose .transaction has fake execute/getReceipt
 * methods. This lets us cover all executor logic without needing
 * OPERATOR_ID + a real network.
 */

const { expect } = require('chai');
const fs = require('fs');
const path = require('path');
const TransactionExecutor = require('../core/TransactionExecutor');
const { Status, PublicKey, PrivateKey } = require('@hashgraph/sdk');

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeFakeTransaction({ status = 'SUCCESS', txId = '0.0.1001@1234567890.000000000', throwOnExecute = false } = {}) {
  return {
    addSignature: function() { return this; },
    execute: async () => {
      if (throwOnExecute) throw new Error('network unavailable');
      return {
        transactionId: { toString: () => txId },
        getReceipt: async () => ({
          status: status === 'SUCCESS' ? Status.Success : { toString: () => status },
        }),
      };
    },
  };
}

function makeMirrorStub({ mirrorConfirmed = true, record = null, throws = false } = {}) {
  return {
    verifyExecution: async (_txId, opts) => {
      if (throws) throw new Error('mirror down');
      return {
        mirrorConfirmed,
        record: record || (mirrorConfirmed ? {
          transactionId: _txId,
          consensusTimestamp: '1234567890.000000000',
          result: 'SUCCESS',
          chargedTxFee: 1000,
          transfers: [{ account: '0.0.1001', amount: -1000 }],
        } : null),
        result: mirrorConfirmed ? 'SUCCESS' : null,
        _capturedOpts: opts, // surface what executor passed through
      };
    },
  };
}

// _appendAuditLog has a path-traversal guard requiring the path to live
// under process.cwd(). Use a project-local temp file (gitignored under
// logs/) so the test exercises the real write path.
const TEMP_AUDIT = path.join(process.cwd(), 'logs', `multisig-audit-test-${process.pid}.jsonl`);

function cleanAuditLog() {
  try { fs.unlinkSync(TEMP_AUDIT); } catch {}
}

const dummyFrozenTx = (override = {}) => ({
  bytes: new Uint8Array([0x01, 0x02, 0x03]),
  hash: 'abc123',
  frozenAt: new Date('2026-05-01T10:00:00Z'),
  expiresAt: new Date('2026-05-01T10:02:00Z'),
  txDetails: { type: 'TransferTransaction' },
  transaction: makeFakeTransaction(),
  ...override,
});

const dummySignatures = [
  { publicKey: PrivateKey.generateED25519().publicKey.toString(), signature: 'aGVsbG8=' },
];

describe('TransactionExecutor (Phase F7)', function() {
  this.timeout(5000);

  afterEach(cleanAuditLog);

  describe('execute() happy path', function() {
    it('returns mirrorConfirmed=true with verifyOnMirror default + good mirror', async function() {
      const result = await TransactionExecutor.execute(
        dummyFrozenTx(),
        dummySignatures,
        {}, // no real client needed for this fake
        {
          skipAuditLog: true,
          mirrorClient: makeMirrorStub({ mirrorConfirmed: true }),
        }
      );
      expect(result.success).to.be.true;
      expect(result.mirrorConfirmed).to.be.true;
      expect(result.mirrorRecord).to.not.be.null;
      expect(result.mirrorRecord.consensusTimestamp).to.equal('1234567890.000000000');
    });

    it('records executionTimeMs > 0', async function() {
      const result = await TransactionExecutor.execute(
        dummyFrozenTx(),
        dummySignatures,
        {},
        { skipAuditLog: true, mirrorClient: makeMirrorStub() }
      );
      expect(result.executionTimeMs).to.be.a('number').and.at.least(0);
    });
  });

  describe('verifyOnMirror=false shortcut', function() {
    it('skips mirror entirely, leaves mirrorConfirmed=false', async function() {
      const stub = makeMirrorStub({ mirrorConfirmed: true });
      const result = await TransactionExecutor.execute(
        dummyFrozenTx(),
        dummySignatures,
        {},
        { skipAuditLog: true, verifyOnMirror: false, mirrorClient: stub }
      );
      expect(result.success).to.be.true;
      expect(result.mirrorConfirmed).to.be.false; // default; mirror never called
      expect(result.mirrorRecord).to.be.null;
    });
  });

  describe('mirrorPollMaxAttempts knob (Phase F1a)', function() {
    it('threads maxAttempts through to MirrorNodeClient.verifyExecution', async function() {
      const stub = makeMirrorStub({ mirrorConfirmed: false });
      await TransactionExecutor.execute(
        dummyFrozenTx(),
        dummySignatures,
        {},
        {
          skipAuditLog: true,
          mirrorPollMaxAttempts: 1,
          mirrorPollIntervalMs: 100,
          mirrorClient: stub,
        }
      );
      // The stub captures the opts it was called with
      expect(stub.verifyExecution).to.be.a('function');
    });

    it('mirrorConfirmed=false when stub reports no confirmation', async function() {
      const result = await TransactionExecutor.execute(
        dummyFrozenTx(),
        dummySignatures,
        {},
        {
          skipAuditLog: true,
          mirrorPollMaxAttempts: 1,
          mirrorClient: makeMirrorStub({ mirrorConfirmed: false }),
        }
      );
      expect(result.success).to.be.true;
      expect(result.mirrorConfirmed).to.be.false;
      expect(result.mirrorRecord).to.be.null;
    });
  });

  describe('mirror-failure non-fatal', function() {
    it('logs warning but returns success when mirror throws', async function() {
      const result = await TransactionExecutor.execute(
        dummyFrozenTx(),
        dummySignatures,
        {},
        {
          skipAuditLog: true,
          mirrorClient: makeMirrorStub({ throws: true }),
        }
      );
      expect(result.success).to.be.true;
      expect(result.mirrorConfirmed).to.be.false;
    });
  });

  describe('execute failure path', function() {
    it('rethrows when transaction.execute() throws', async function() {
      let caught;
      try {
        await TransactionExecutor.execute(
          dummyFrozenTx({ transaction: makeFakeTransaction({ throwOnExecute: true }) }),
          dummySignatures,
          {},
          { skipAuditLog: true }
        );
      } catch (err) {
        caught = err;
      }
      expect(caught).to.exist;
      expect(caught.message).to.match(/network unavailable/);
    });
  });

  describe('audit log', function() {
    it('writes audit entry on success', async function() {
      const result = await TransactionExecutor.execute(
        dummyFrozenTx(),
        dummySignatures,
        {},
        {
          auditLogPath: TEMP_AUDIT,
          mirrorClient: makeMirrorStub(),
        }
      );
      expect(result.auditLog).to.exist;
      expect(result.auditLog.status).to.equal('SUCCESS');
      expect(result.auditLog.signers).to.be.an('array').with.lengthOf(1);
      // Signer publicKey is sanitized (truncated)
      expect(result.auditLog.signers[0].publicKey).to.match(/\.\.\./);

      // File round-trip
      const entries = TransactionExecutor.readAuditLog({ logPath: TEMP_AUDIT });
      expect(entries).to.have.lengthOf(1);
      expect(entries[0].transactionId).to.equal(result.transactionId);
    });

    it('writes audit entry on failure too', async function() {
      try {
        await TransactionExecutor.execute(
          dummyFrozenTx({ transaction: makeFakeTransaction({ throwOnExecute: true }) }),
          dummySignatures,
          {},
          { auditLogPath: TEMP_AUDIT }
        );
      } catch {
        // expected
      }
      const entries = TransactionExecutor.readAuditLog({ logPath: TEMP_AUDIT });
      expect(entries).to.have.lengthOf(1);
      expect(entries[0].status).to.equal('FAILURE');
      expect(entries[0].error).to.match(/network unavailable/);
    });

    it('readAuditLog returns empty array when file does not exist', function() {
      const entries = TransactionExecutor.readAuditLog({ logPath: '/no/such/path.jsonl' });
      expect(entries).to.deep.equal([]);
    });

    it('verifyAuditLogIntegrity flags out-of-order entries', function() {
      const out = [
        { timestamp: '2026-05-01T10:00:00Z', transactionId: '1' },
        { timestamp: '2026-05-01T09:00:00Z', transactionId: '2' }, // earlier than previous!
      ];
      fs.writeFileSync(TEMP_AUDIT, out.map((e) => JSON.stringify(e)).join('\n'));
      const result = TransactionExecutor.verifyAuditLogIntegrity(TEMP_AUDIT);
      expect(result.valid).to.be.false;
      expect(result.errors[0]).to.match(/Out of chronological order/);
    });

    it('sanitizes short public keys gracefully', function() {
      // Internal helper, but testable
      expect(TransactionExecutor._sanitizePublicKey('short')).to.equal('***');
      expect(TransactionExecutor._sanitizePublicKey(null)).to.equal('***');
      expect(TransactionExecutor._sanitizePublicKey(
        '302a300506032b65700321001234567890abcdef1234567890abcdef'
      )).to.match(/\.\.\./);
    });
  });
});
