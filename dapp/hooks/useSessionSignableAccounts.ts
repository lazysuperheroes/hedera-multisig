/**
 * Discover the set of accounts the coordinator's session can strictly sign
 * for. Reverse-looks-up each session.eligibleKey on the mirror node, then
 * filters the result through `checkCoverage` so only accounts where every
 * session key is a valid signer survive.
 *
 * Used by TransactionFields (From / Caller / Account) and FeePayerCallout
 * (Override) to surface "Use 0.0.XXX" one-tap chips and native datalist
 * suggestions, replacing the "go consult walkthrough-state.json" step for
 * the dominant treasury case.
 */

import { useEffect, useRef, useState } from 'react';
import { PublicKey } from '@hashgraph/sdk';
import {
  parseAccountKey,
  checkCoverage,
  normalizePublicKey,
  type MirrorAccountKey,
} from '../lib/account-keys';

export interface SignableAccount {
  accountId: string;
  /** Brief description for the picker chip — "2-of-3 threshold" / "single key". */
  summary: string;
}

export type SuggestionsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SignableAccountsState {
  accounts: SignableAccount[];
  status: SuggestionsStatus;
  /** True if any per-key query was truncated by the limit cap. */
  truncated: boolean;
}

interface UseSessionSignableAccountsArgs {
  sessionEligibleKeys: string[];
  sessionThreshold: number;
  network: 'testnet' | 'mainnet';
  enabled?: boolean;
}

const PER_KEY_LIMIT = 100;

function mirrorBase(network: 'testnet' | 'mainnet'): string {
  return network === 'mainnet'
    ? 'https://mainnet-public.mirrornode.hedera.com/api/v1'
    : 'https://testnet.mirrornode.hedera.com/api/v1';
}

/** Convert a session key (whatever form the CLI accepted) to raw hex for mirror-node. */
function toRawHex(k: string): string | null {
  const cleaned = k.trim().replace(/^0x/i, '');
  try {
    return PublicKey.fromString(cleaned).toStringRaw().toLowerCase();
  } catch {
    return /^[0-9a-f]+$/i.test(cleaned) ? cleaned.toLowerCase() : null;
  }
}

interface MirrorAccountListEntry {
  account: string;
  key?: MirrorAccountKey;
}

interface MirrorAccountListResponse {
  accounts?: MirrorAccountListEntry[];
  links?: { next?: string | null };
}

export function useSessionSignableAccounts({
  sessionEligibleKeys,
  sessionThreshold,
  network,
  enabled = true,
}: UseSessionSignableAccountsArgs): SignableAccountsState {
  const [state, setState] = useState<SignableAccountsState>({
    accounts: [],
    status: 'idle',
    truncated: false,
  });

  const reqIdRef = useRef(0);
  const fingerprint = `${network}|${sessionThreshold}|${sessionEligibleKeys.join(',')}`;

  useEffect(() => {
    if (
      !enabled ||
      sessionEligibleKeys.length === 0 ||
      sessionThreshold <= 0
    ) {
      setState({ accounts: [], status: 'idle', truncated: false });
      return;
    }

    const myReqId = ++reqIdRef.current;
    setState({ accounts: [], status: 'loading', truncated: false });

    (async () => {
      try {
        const base = mirrorBase(network);
        const responses = await Promise.all(
          sessionEligibleKeys.map(async (k) => {
            const raw = toRawHex(k);
            if (!raw) {
              return { entries: [] as MirrorAccountListEntry[], truncated: false };
            }
            const url = `${base}/accounts?account.publickey=${raw}&limit=${PER_KEY_LIMIT}`;
            const res = await fetch(url);
            if (!res.ok) {
              throw new Error(`Mirror node returned ${res.status} for key reverse-lookup`);
            }
            const body = (await res.json()) as MirrorAccountListResponse;
            return {
              entries: body.accounts ?? [],
              truncated: !!body.links?.next,
            };
          })
        );
        if (myReqId !== reqIdRef.current) return;

        // Aggregate: a single accountId may show up in multiple per-key
        // responses. Keep one entry per account and run coverage once.
        const seen = new Map<string, MirrorAccountListEntry>();
        let truncated = false;
        for (const r of responses) {
          if (r.truncated) truncated = true;
          for (const entry of r.entries) {
            if (!seen.has(entry.account)) seen.set(entry.account, entry);
          }
        }

        const covered: SignableAccount[] = [];
        for (const entry of seen.values()) {
          const descriptor = parseAccountKey(entry.key);
          const result = checkCoverage(
            descriptor,
            sessionEligibleKeys.map(normalizePublicKey),
            sessionThreshold
          );
          if (!result.covers) continue;

          let summary: string;
          if (descriptor.kind === 'single') {
            summary = 'single key';
          } else if (descriptor.kind === 'threshold') {
            summary = `${descriptor.threshold}-of-${descriptor.publicKeys.length} threshold`;
          } else {
            summary = 'covered';
          }
          covered.push({ accountId: entry.account, summary });
        }

        // Stable ordering: ascending by Hedera account number for predictability.
        covered.sort((a, b) => {
          const an = parseInt(a.accountId.split('.').pop() || '0', 10);
          const bn = parseInt(b.accountId.split('.').pop() || '0', 10);
          return an - bn;
        });

        if (myReqId !== reqIdRef.current) return;
        setState({ accounts: covered, status: 'ready', truncated });
      } catch {
        if (myReqId !== reqIdRef.current) return;
        // Quiet failure: suggestions are a nicety, not a requirement.
        setState({ accounts: [], status: 'error', truncated: false });
      }
    })();
    // sessionEligibleKeys folded into fingerprint to avoid effect re-fires
    // on referentially-new-but-equal arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, enabled]);

  return state;
}
