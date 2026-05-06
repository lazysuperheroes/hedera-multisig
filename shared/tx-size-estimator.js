/**
 * Tx-size estimator for multi-sig transactions.
 *
 * Hedera caps individual transactions at 6 KB. Multi-sig + multi-node
 * freeze multiplies the per-node SignedTransaction (with bodyBytes +
 * sigMap) — a 5-of-9 multi-sig with subset 6 is already ~4 KB; pushing
 * to 9 nodes would exceed the cap. Surfacing this proactively in the
 * UI avoids "tx silently rejected at submit because it was too big".
 *
 * Constants below are conservative estimates from observed protobuf
 * encodings of typical transactions. Actual size is always available
 * post-freeze via `actualTxSize(frozen.toBytes())`.
 */

const HEDERA_TX_SIZE_CAP_BYTES = 6144;

// Per-signature pair in a sigMap:
//   - 32 bytes pubKeyPrefix (full ED25519 raw key)
//   -  6 bytes protobuf framing (field tags, length prefixes)
//   - 64 bytes ed25519 signature
const SIG_PAIR_BYTES = 102;

// SignedTransaction protobuf wrapper (length-delimited message overhead)
const SIGNED_TRANSACTION_WRAPPER_BYTES = 10;

// TransactionList per-entry overhead (Transaction message wrapping the
// signedTransactionBytes field)
const LIST_ENTRY_OVERHEAD_BYTES = 8;

// Baseline `bodyBytes` size by transaction type — measured against
// minimal real frozen txs. These cover transactionID (~30B) +
// nodeAccountID (~10B) + transactionFee + validDuration + the
// type-specific data block.
const BODY_BYTES_BY_TYPE = {
  'hbar-transfer': 150,
  'token-transfer': 180,
  'nft-transfer': 200,
  'token-association': 140,
  'contract-call': 200, // base; calldata adds on top
  'schedule-create': 250, // wraps an inner tx — caller should add inner size
  'schedule-sign': 130,
  'account-update': 200,
  'token-create': 280,
  'token-mint': 160,
  'token-burn': 160,
};

const STATUS_THRESHOLDS = {
  greenMaxFraction: 0.7,  //   <70% of cap
  amberMaxFraction: 0.9,  // 70-90%
  // >90% is red
};

/**
 * Estimate the size of a frozen multi-sig transaction.
 *
 * @param {Object} input
 * @param {number} input.subsetSize - Number of nodes the freeze targets
 * @param {number} input.signerCount - Number of signatures that will be attached
 * @param {string} [input.txType='hbar-transfer'] - One of BODY_BYTES_BY_TYPE keys
 * @param {number} [input.calldataBytes=0] - Extra body bytes (e.g. contract call calldata)
 * @param {number} [input.memoBytes=0] - Memo length (encoded UTF-8 byte count)
 * @returns {{
 *   estimated: number, perNode: number, bodyBytes: number,
 *   sigMapBytes: number, cap: number, headroom: number, percent: number,
 *   status: 'green'|'amber'|'red', exceedsCap: boolean
 * }}
 */
function estimateTxSize(input) {
  const subsetSize = Math.max(1, input.subsetSize | 0);
  const signerCount = Math.max(0, input.signerCount | 0);
  const txType = input.txType || 'hbar-transfer';
  const calldataBytes = Math.max(0, input.calldataBytes | 0);
  const memoBytes = Math.max(0, input.memoBytes | 0);

  const baseBody = BODY_BYTES_BY_TYPE[txType] ?? 150;
  const bodyBytes = baseBody + calldataBytes + memoBytes;
  const sigMapBytes = signerCount * SIG_PAIR_BYTES;
  const perNode = bodyBytes + sigMapBytes + SIGNED_TRANSACTION_WRAPPER_BYTES;
  const estimated =
    subsetSize * perNode + subsetSize * LIST_ENTRY_OVERHEAD_BYTES;

  const cap = HEDERA_TX_SIZE_CAP_BYTES;
  const percent = estimated / cap;
  const headroom = cap - estimated;

  let status;
  if (percent < STATUS_THRESHOLDS.greenMaxFraction) status = 'green';
  else if (percent < STATUS_THRESHOLDS.amberMaxFraction) status = 'amber';
  else status = 'red';

  return {
    estimated,
    perNode,
    bodyBytes,
    sigMapBytes,
    cap,
    headroom,
    percent,
    status,
    exceedsCap: estimated > cap,
  };
}

/**
 * Given a freshly frozen transaction's serialized bytes (Buffer,
 * Uint8Array, or base64 string), return the actual size in bytes.
 * Use this in the SessionMonitor / audit trail rather than the
 * estimator once the freeze has happened — it's exact.
 */
function actualTxSize(bytesOrBase64) {
  if (Buffer.isBuffer(bytesOrBase64)) return bytesOrBase64.length;
  if (bytesOrBase64 instanceof Uint8Array) return bytesOrBase64.length;
  if (typeof bytesOrBase64 === 'string') {
    return Buffer.from(bytesOrBase64, 'base64').length;
  }
  return null;
}

module.exports = {
  estimateTxSize,
  actualTxSize,
  HEDERA_TX_SIZE_CAP_BYTES,
  SIG_PAIR_BYTES,
  SIGNED_TRANSACTION_WRAPPER_BYTES,
  LIST_ENTRY_OVERHEAD_BYTES,
  BODY_BYTES_BY_TYPE,
};
