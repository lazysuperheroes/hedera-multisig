/**
 * Diagnostic helper for body-bytes mismatch between coordinator and
 * wallet-returned SignedTransaction.
 *
 * Originally written to debug what we believed was a wallet "re-freeze"
 * bug for `ContractExecuteTransaction`. The actual root cause turned
 * out to be in `@hashgraph/hedera-wallet-connect`'s
 * `DAppSigner.signTransaction`, which rebuilt the TransactionBody from
 * the parsed Transaction before sending to the wallet (see
 * `dapp/lib/walletconnect.ts` for the bypass + fix).
 *
 * Kept around because it remains useful: any future signature-mismatch
 * regression (new SDK bug, new wallet quirk, our own freeze logic
 * changing) will surface here as a field-level proto diff. Cheap to
 * leave, hard to recreate from scratch when needed.
 *
 * Localhost-gated — production users don't pay the @hashgraph/proto
 * decode cost on every signing failure. Bypass with
 * NEXT_PUBLIC_DEBUG_TX=1 if you want it active in a deployed test.
 *
 * The output is structured for grep + visual scanning, e.g.:
 *
 *   [diag] body[0] mismatch (coord 245B / wallet 245B)
 *   [diag]   transactionFee:    coord=200000000 wallet=300000000   ← CHANGED
 *   [diag]   contractCall.gas:  coord=0         wallet=80000       ← CHANGED
 */

const isDevHost = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (process.env.NEXT_PUBLIC_DEBUG_TX === '1') return true;
  const h = window.location.hostname;
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h.endsWith('.local')
  );
};

const toHex = (bytes: Uint8Array | undefined): string => {
  if (!bytes) return '<empty>';
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
};

const firstDiffOffset = (a: Uint8Array, b: Uint8Array): number => {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : len;
};

interface BodyDecoded {
  transactionFee?: bigint | number | null;
  transactionValidDuration?: { seconds?: bigint | number | null } | null;
  memo?: string | null;
  transactionID?: {
    accountID?: { shardNum?: bigint | number; realmNum?: bigint | number; accountNum?: bigint | number };
    transactionValidStart?: { seconds?: bigint | number; nanos?: bigint | number };
  } | null;
  nodeAccountID?: { shardNum?: bigint | number; realmNum?: bigint | number; accountNum?: bigint | number } | null;
  contractCall?: {
    contractID?: { shardNum?: bigint | number; realmNum?: bigint | number; contractNum?: bigint | number };
    gas?: bigint | number | null;
    amount?: bigint | number | null;
    functionParameters?: Uint8Array | null;
  } | null;
  cryptoTransfer?: unknown;
  // Other oneof transaction-data fields would go here as we encounter
  // them; for now we focus on contract-call (the failure case) and
  // crypto-transfer (the working baseline).
}

/**
 * Format a Hedera ID-shaped object (account/contract/etc.) as
 * `0.0.X` — protobuf renders these as nested objects with shardNum,
 * realmNum, accountNum/contractNum.
 */
const formatId = (
  obj: { shardNum?: bigint | number; realmNum?: bigint | number; accountNum?: bigint | number; contractNum?: bigint | number } | null | undefined,
  numKey: 'accountNum' | 'contractNum' = 'accountNum',
): string => {
  if (!obj) return '<null>';
  const shard = obj.shardNum?.toString() ?? '0';
  const realm = obj.realmNum?.toString() ?? '0';
  const num = obj[numKey]?.toString() ?? '?';
  return `${shard}.${realm}.${num}`;
};

const formatTimestamp = (
  ts: { seconds?: bigint | number; nanos?: bigint | number } | null | undefined,
): string => {
  if (!ts) return '<null>';
  return `${ts.seconds?.toString() ?? '?'}.${ts.nanos?.toString() ?? '?'}`;
};

/**
 * Decode a serialized TransactionBody and pull out the fields we
 * care about for diff purposes. Returns null if decode fails.
 */
async function decodeBody(bodyBytes: Uint8Array | undefined): Promise<BodyDecoded | null> {
  if (!bodyBytes || bodyBytes.length === 0) return null;
  try {
    const protoMod = await import('@hashgraph/proto');
    // The proto module's surface is awkwardly typed; we access via any
    // here because the schema is well-known but the type definitions
    // lag the runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = protoMod as any;
    const decoded = proto.proto?.TransactionBody?.decode?.(bodyBytes)
      ?? proto.TransactionBody?.decode?.(bodyBytes)
      ?? proto.default?.proto?.TransactionBody?.decode?.(bodyBytes);
    if (!decoded) return null;
    return decoded as BodyDecoded;
  } catch (err) {
    console.warn('[diag] TransactionBody decode failed:', (err as Error).message);
    return null;
  }
}

/**
 * Compare two decoded bodies field by field. Emits one log line per
 * field; the changed lines are tagged with ← CHANGED so they're
 * visually scannable in a busy console.
 */
function diffDecodedBodies(coord: BodyDecoded, wallet: BodyDecoded, prefix: string): void {
  const lines: Array<{ key: string; coord: string; wallet: string; changed: boolean }> = [];
  const push = (key: string, c: string, w: string) =>
    lines.push({ key, coord: c, wallet: w, changed: c !== w });

  push(
    'transactionFee',
    coord.transactionFee?.toString() ?? '<null>',
    wallet.transactionFee?.toString() ?? '<null>',
  );
  push(
    'transactionValidDuration.seconds',
    coord.transactionValidDuration?.seconds?.toString() ?? '<null>',
    wallet.transactionValidDuration?.seconds?.toString() ?? '<null>',
  );
  push('memo', JSON.stringify(coord.memo ?? null), JSON.stringify(wallet.memo ?? null));
  push(
    'transactionID.accountID',
    formatId(coord.transactionID?.accountID),
    formatId(wallet.transactionID?.accountID),
  );
  push(
    'transactionID.validStart',
    formatTimestamp(coord.transactionID?.transactionValidStart),
    formatTimestamp(wallet.transactionID?.transactionValidStart),
  );
  push(
    'nodeAccountID',
    formatId(coord.nodeAccountID),
    formatId(wallet.nodeAccountID),
  );

  // Contract-call fields — the most common failure mode (HashPack /
  // Kabila adjust gas/fee on contract executes).
  if (coord.contractCall || wallet.contractCall) {
    push(
      'contractCall.contractID',
      formatId(coord.contractCall?.contractID, 'contractNum'),
      formatId(wallet.contractCall?.contractID, 'contractNum'),
    );
    push(
      'contractCall.gas',
      coord.contractCall?.gas?.toString() ?? '<null>',
      wallet.contractCall?.gas?.toString() ?? '<null>',
    );
    push(
      'contractCall.amount',
      coord.contractCall?.amount?.toString() ?? '<null>',
      wallet.contractCall?.amount?.toString() ?? '<null>',
    );
    const coordParams = coord.contractCall?.functionParameters;
    const walletParams = wallet.contractCall?.functionParameters;
    push(
      'contractCall.functionParameters',
      coordParams ? `${coordParams.length}B / ${toHex(coordParams).slice(0, 20)}…` : '<null>',
      walletParams ? `${walletParams.length}B / ${toHex(walletParams).slice(0, 20)}…` : '<null>',
    );
  }

  // Render. Pad keys for alignment.
  const maxKey = Math.max(...lines.map((l) => l.key.length));
  for (const line of lines) {
    const tag = line.changed ? '  ← CHANGED' : '';
    console.log(
      `${prefix}  ${line.key.padEnd(maxKey)}  coord=${line.coord}  wallet=${line.wallet}${tag}`,
    );
  }
}

export interface BodyMismatchDiagnosticInput {
  coordBodies: Array<{ bodyBytes?: Uint8Array }>;
  walletBodies: Array<{ bodyBytes?: Uint8Array }>;
  /**
   * Optional already-built map of coord-body-hex → originalIndex from
   * the verification path; if absent we recompute it. Pass it in to
   * keep behaviour identical to the verifier.
   */
  coordIndexByBodyHex?: Map<string, number>;
}

/**
 * Main entry. Call from the verification-failure path with the same
 * (originalSignedList, signedTxList) pair the verifier is working
 * against. Logs a per-body diff to the console.
 *
 * Safe to call on every failure — does nothing in production builds
 * unless NEXT_PUBLIC_DEBUG_TX=1 is set.
 */
export async function diagnoseBodyMismatch({
  coordBodies,
  walletBodies,
}: BodyMismatchDiagnosticInput): Promise<void> {
  if (!isDevHost()) return;

  console.log(
    '%c[diag] wallet/coord body-bytes mismatch — running protobuf diff',
    'color: #f59e0b; font-weight: bold;',
  );
  console.log(
    `[diag]   coord bodies: ${coordBodies.length}, wallet bodies: ${walletBodies.length}`,
  );

  const pairCount = Math.max(coordBodies.length, walletBodies.length);
  for (let i = 0; i < pairCount; i++) {
    const coordBody = coordBodies[i]?.bodyBytes;
    const walletBody = walletBodies[i]?.bodyBytes;

    if (!coordBody && walletBody) {
      console.log(`[diag] body[${i}] coord=<missing> wallet=${walletBody.length}B`);
      continue;
    }
    if (coordBody && !walletBody) {
      console.log(`[diag] body[${i}] coord=${coordBody.length}B wallet=<missing>`);
      continue;
    }
    if (!coordBody || !walletBody) continue;

    if (coordBody.length === walletBody.length) {
      const diffOffset = firstDiffOffset(coordBody, walletBody);
      if (diffOffset === -1) {
        console.log(`[diag] body[${i}] identical bytes (${coordBody.length}B) — sig-only mismatch`);
        continue;
      }
      console.log(
        `[diag] body[${i}] same length (${coordBody.length}B) but diverge at byte ${diffOffset}`,
      );
    } else {
      console.log(
        `[diag] body[${i}] length differs (coord ${coordBody.length}B / wallet ${walletBody.length}B)`,
      );
    }

    const [coordDecoded, walletDecoded] = await Promise.all([
      decodeBody(coordBody),
      decodeBody(walletBody),
    ]);

    if (!coordDecoded || !walletDecoded) {
      console.log(`[diag] body[${i}] decode failed — falling back to raw hex:`);
      console.log(`[diag]   coord  hex: ${toHex(coordBody)}`);
      console.log(`[diag]   wallet hex: ${toHex(walletBody)}`);
      continue;
    }

    diffDecodedBodies(coordDecoded, walletDecoded, `[diag] body[${i}]`);
  }

  console.log(
    '%c[diag] field diff complete. Lines tagged "← CHANGED" are the wallet-side adjustments.',
    'color: #f59e0b;',
  );
}
