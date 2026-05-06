/**
 * Parse Hedera mirror-node account key responses and check whether a
 * coordinator session's signing pool covers the account's signature
 * requirement.
 *
 * Path 2 (per RoadmapEntry "Fee-payer coverage validation"): if the resolved
 * fee payer is an account that the session signers don't actually control,
 * the network will reject the transaction with INVALID_SIGNATURE. Catch
 * that mismatch in the dApp before the coordinator wastes a 120s window.
 *
 * Limitations (deferred to Path 3 — real sponsorship + nested keylists):
 *   - Nested threshold keys / keylists-within-keylists are flagged but not
 *     recursively validated.
 *   - Single-input override conflates sender and payer; we cannot represent
 *     a sponsor account that differs from the From / Caller.
 */

import { Buffer } from 'buffer';
import { PublicKey } from '@hashgraph/sdk';
import { proto } from '@hashgraph/proto';

export type AccountKeyDescriptor =
  | { kind: 'single'; publicKey: string }
  | { kind: 'threshold'; threshold: number; publicKeys: string[] }
  | { kind: 'nested'; reason: string }
  | { kind: 'unknown'; reason: string };

export interface CoverageResult {
  covers: boolean;
  reason: string;
}

export interface MirrorAccountKey {
  _type?: string;
  key?: string;
}

/**
 * Canonicalize a public key string to raw hex (no 0x, lowercase, no DER
 * wrapping). Falls back to a strip-and-lowercase if SDK parsing rejects it.
 */
export function normalizePublicKey(k: string): string {
  const cleaned = k.trim().replace(/^0x/i, '');
  try {
    return PublicKey.fromString(cleaned).toStringRaw().toLowerCase();
  } catch {
    return cleaned.toLowerCase();
  }
}

interface ProtoKeyLike {
  ed25519?: Uint8Array;
  ECDSASecp256k1?: Uint8Array;
  thresholdKey?: { threshold?: number; keys?: { keys?: ProtoKeyLike[] } };
  keyList?: { keys?: ProtoKeyLike[] };
  contractID?: unknown;
  delegatableContractId?: unknown;
}

function extractLeafPublicKey(k: ProtoKeyLike): string | null {
  if (k.ed25519 && k.ed25519.length > 0) {
    return Buffer.from(k.ed25519).toString('hex').toLowerCase();
  }
  if (k.ECDSASecp256k1 && k.ECDSASecp256k1.length > 0) {
    return Buffer.from(k.ECDSASecp256k1).toString('hex').toLowerCase();
  }
  return null;
}

/**
 * Parse a mirror-node `key` field into a normalized descriptor.
 */
export function parseAccountKey(
  mirrorKey: MirrorAccountKey | null | undefined
): AccountKeyDescriptor {
  if (!mirrorKey || !mirrorKey.key) {
    return { kind: 'unknown', reason: 'Account has no key on file.' };
  }

  if (mirrorKey._type === 'ED25519' || mirrorKey._type === 'ECDSA_SECP256K1') {
    return { kind: 'single', publicKey: normalizePublicKey(mirrorKey.key) };
  }

  if (mirrorKey._type !== 'ProtobufEncoded') {
    return { kind: 'unknown', reason: `Unsupported key type: ${mirrorKey._type}` };
  }

  try {
    const bytes = Buffer.from(mirrorKey.key, 'hex');
    const decoded = proto.Key.decode(bytes) as ProtoKeyLike;

    // Top-level might already be a leaf (rare for ProtobufEncoded but possible)
    const topLeaf = extractLeafPublicKey(decoded);
    if (topLeaf) {
      return { kind: 'single', publicKey: topLeaf };
    }

    if (decoded.thresholdKey) {
      const threshold = decoded.thresholdKey.threshold ?? 0;
      const subKeys = decoded.thresholdKey.keys?.keys ?? [];
      const publicKeys: string[] = [];
      for (const sk of subKeys) {
        const raw = extractLeafPublicKey(sk);
        if (raw === null) {
          return {
            kind: 'nested',
            reason:
              'Account uses a nested keylist. Coverage validation for nested ' +
              'structures is not yet supported (tracked under "Real sponsorship + nested threshold keys").',
          };
        }
        publicKeys.push(raw);
      }
      return { kind: 'threshold', threshold, publicKeys };
    }

    if (decoded.keyList) {
      const subKeys = decoded.keyList.keys ?? [];
      const publicKeys: string[] = [];
      for (const sk of subKeys) {
        const raw = extractLeafPublicKey(sk);
        if (raw === null) {
          return {
            kind: 'nested',
            reason:
              'Account uses a nested keylist. Coverage validation for nested ' +
              'structures is not yet supported (tracked under "Real sponsorship + nested threshold keys").',
          };
        }
        publicKeys.push(raw);
      }
      // A bare KeyList with no threshold means N-of-N (all required).
      return { kind: 'threshold', threshold: publicKeys.length, publicKeys };
    }

    return {
      kind: 'unknown',
      reason: 'Unrecognized key structure (not ED25519, ECDSA, threshold, or keylist).',
    };
  } catch (err) {
    return {
      kind: 'unknown',
      reason: `Failed to decode account key: ${(err as Error).message}`,
    };
  }
}

/**
 * Check whether the session's signing pool can satisfy the account's
 * signature requirement.
 *
 * The session collects up to `sessionThreshold` signatures from accounts
 * holding keys in `sessionEligibleKeys`. The fee-payer account requires
 * at least `accountThreshold` signatures from keys in `account.publicKeys`.
 * Coverage holds iff every session key is valid for the account *and* the
 * session collects enough signatures to meet the account's threshold.
 */
export function checkCoverage(
  account: AccountKeyDescriptor,
  sessionEligibleKeys: string[],
  sessionThreshold: number
): CoverageResult {
  if (account.kind === 'unknown' || account.kind === 'nested') {
    return { covers: false, reason: account.reason };
  }

  const sessionKeys = sessionEligibleKeys.map(normalizePublicKey);
  const sessionSet = new Set(sessionKeys);
  const accountKeys =
    account.kind === 'single' ? [account.publicKey] : account.publicKeys;
  const accountSet = new Set(accountKeys);

  const sessionInAccount = [...sessionSet].filter((k) => accountSet.has(k));
  const accountThreshold = account.kind === 'single' ? 1 : account.threshold;

  if (sessionInAccount.length !== sessionSet.size) {
    const missing = sessionSet.size - sessionInAccount.length;
    return {
      covers: false,
      reason: `Session signers don't all hold keys on this account (${missing} of ${sessionSet.size} session ${
        missing === 1 ? 'key is' : 'keys are'
      } not on the account). Hedera will reject with INVALID_SIGNATURE.`,
    };
  }

  if (sessionThreshold < accountThreshold) {
    return {
      covers: false,
      reason: `Session collects ${sessionThreshold} signature(s); account requires ${accountThreshold}. The threshold can't be met.`,
    };
  }

  return {
    covers: true,
    reason:
      account.kind === 'single'
        ? 'Session signers cover this single-key account.'
        : `Session covers the ${accountThreshold}-of-${accountKeys.length} threshold key on this account.`,
  };
}
