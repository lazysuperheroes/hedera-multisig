/**
 * Browser-side tx-size estimator for multi-sig transactions.
 *
 * Mirror of `shared/tx-size-estimator.js` (Node CJS). Used by the
 * coordinator's create-tx UI to surface "you're about to exceed the
 * Hedera 6 KB cap" before the freeze, not after a confusing submit
 * error.
 *
 * Numbers are protobuf-conservative estimates; the actual size is
 * available post-freeze via `actualTxSize(bytes)` on the audit trail.
 */

export const HEDERA_TX_SIZE_CAP_BYTES = 6144;
export const SIG_PAIR_BYTES = 102; // 32 pubkey + 6 framing + 64 sig
export const SIGNED_TRANSACTION_WRAPPER_BYTES = 10;
export const LIST_ENTRY_OVERHEAD_BYTES = 8;

export const BODY_BYTES_BY_TYPE: Record<string, number> = {
  'hbar-transfer': 150,
  'token-transfer': 180,
  'nft-transfer': 200,
  'token-association': 140,
  'contract-call': 200,
  'schedule-create': 250,
  'schedule-sign': 130,
  'account-update': 200,
  'token-create': 280,
  'token-mint': 160,
  'token-burn': 160,
};

export type TxSizeStatus = 'green' | 'amber' | 'red';

export interface TxSizeEstimateInput {
  subsetSize: number;
  signerCount: number;
  txType?: string;
  calldataBytes?: number;
  memoBytes?: number;
}

export interface TxSizeEstimate {
  estimated: number;
  perNode: number;
  bodyBytes: number;
  sigMapBytes: number;
  cap: number;
  headroom: number;
  percent: number;
  status: TxSizeStatus;
  exceedsCap: boolean;
}

const STATUS_THRESHOLDS = {
  greenMaxFraction: 0.7,
  amberMaxFraction: 0.9,
};

export function estimateTxSize(input: TxSizeEstimateInput): TxSizeEstimate {
  const subsetSize = Math.max(1, Math.floor(input.subsetSize));
  const signerCount = Math.max(0, Math.floor(input.signerCount));
  const txType = input.txType || 'hbar-transfer';
  const calldataBytes = Math.max(0, Math.floor(input.calldataBytes ?? 0));
  const memoBytes = Math.max(0, Math.floor(input.memoBytes ?? 0));

  const baseBody = BODY_BYTES_BY_TYPE[txType] ?? 150;
  const bodyBytes = baseBody + calldataBytes + memoBytes;
  const sigMapBytes = signerCount * SIG_PAIR_BYTES;
  const perNode = bodyBytes + sigMapBytes + SIGNED_TRANSACTION_WRAPPER_BYTES;
  const estimated =
    subsetSize * perNode + subsetSize * LIST_ENTRY_OVERHEAD_BYTES;

  const cap = HEDERA_TX_SIZE_CAP_BYTES;
  const percent = estimated / cap;
  const headroom = cap - estimated;

  let status: TxSizeStatus;
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

export function actualTxSize(
  bytesOrBase64: Uint8Array | ArrayBuffer | string | null
): number | null {
  if (!bytesOrBase64) return null;
  if (bytesOrBase64 instanceof Uint8Array) return bytesOrBase64.length;
  if (bytesOrBase64 instanceof ArrayBuffer) return bytesOrBase64.byteLength;
  if (typeof bytesOrBase64 === 'string') {
    if (typeof Buffer !== 'undefined') return Buffer.from(bytesOrBase64, 'base64').length;
    // Browser fallback — rough byte length from base64 chars
    const padded = bytesOrBase64.replace(/=+$/, '');
    return Math.floor((padded.length * 3) / 4);
  }
  return null;
}
