/**
 * Validates whether the resolved fee payer's account is actually controlled
 * by the session's signing pool. Surfaces a clear status the FeePayerCallout
 * and the page-level Build button can both consume.
 */

import { useEffect, useRef, useState } from 'react';
import {
  parseAccountKey,
  checkCoverage,
  type MirrorAccountKey,
} from '../lib/account-keys';
import {
  resolveFeePayer,
  isValidAccountId,
  type TransactionType,
} from '../lib/fee-payer';

export type CoverageStatus =
  | 'idle'        // no account to validate yet
  | 'loading'     // mirror-node fetch in flight
  | 'covered'     // session signers control the account
  | 'uncovered'   // they don't — submission would fail
  | 'error';      // mirror-node down / unparseable response

export interface CoverageState {
  status: CoverageStatus;
  message: string;
  accountId: string | null;
}

interface UseFeePayerCoverageArgs {
  txType: TransactionType;
  txFields: Record<string, string>;
  walletAccountId: string | null;
  sessionEligibleKeys: string[];
  sessionThreshold: number;
  network: 'testnet' | 'mainnet';
  enabled?: boolean;
}

function mirrorBase(network: 'testnet' | 'mainnet'): string {
  return network === 'mainnet'
    ? 'https://mainnet-public.mirrornode.hedera.com/api/v1'
    : 'https://testnet.mirrornode.hedera.com/api/v1';
}

export function useFeePayerCoverage({
  txType,
  txFields,
  walletAccountId,
  sessionEligibleKeys,
  sessionThreshold,
  network,
  enabled = true,
}: UseFeePayerCoverageArgs): CoverageState {
  const [state, setState] = useState<CoverageState>({
    status: 'idle',
    message: '',
    accountId: null,
  });

  // Cancel guard: only the latest in-flight request gets to set state.
  const reqIdRef = useRef(0);

  const resolved = resolveFeePayer(txType, txFields, walletAccountId);
  const accountId = resolved.accountId;

  // Stable string representation so the effect doesn't re-fire on
  // referentially-new-but-equal arrays.
  const sessionKeysFingerprint = sessionEligibleKeys.join(',');

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', message: '', accountId: null });
      return;
    }
    if (!accountId) {
      setState({ status: 'idle', message: '', accountId: null });
      return;
    }
    if (!isValidAccountId(accountId)) {
      // Don't bother mirror-node with malformed IDs — let the form's other
      // validators handle that. Stay idle.
      setState({ status: 'idle', message: '', accountId });
      return;
    }
    if (sessionEligibleKeys.length === 0 || sessionThreshold <= 0) {
      // No session metadata available yet — coverage is undefined.
      setState({ status: 'idle', message: '', accountId });
      return;
    }

    const myReqId = ++reqIdRef.current;
    setState({
      status: 'loading',
      message: 'Verifying coverage…',
      accountId,
    });

    (async () => {
      try {
        const url = `${mirrorBase(network)}/accounts/${accountId}`;
        const res = await fetch(url);
        if (myReqId !== reqIdRef.current) return;

        if (!res.ok) {
          if (res.status === 404) {
            setState({
              status: 'error',
              message: `Account ${accountId} not found on the ${network} mirror node.`,
              accountId,
            });
            return;
          }
          throw new Error(`Mirror node returned ${res.status}`);
        }

        const data = (await res.json()) as { key?: MirrorAccountKey };
        if (myReqId !== reqIdRef.current) return;

        const descriptor = parseAccountKey(data.key);
        const result = checkCoverage(
          descriptor,
          sessionEligibleKeys,
          sessionThreshold
        );

        setState({
          status: result.covers ? 'covered' : 'uncovered',
          message: result.reason,
          accountId,
        });
      } catch (err) {
        if (myReqId !== reqIdRef.current) return;
        setState({
          status: 'error',
          message: `Couldn't verify coverage: ${(err as Error).message}`,
          accountId,
        });
      }
    })();
    // sessionEligibleKeys is intentionally tracked via fingerprint to avoid
    // re-firing on referential churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, sessionKeysFingerprint, sessionThreshold, network, enabled]);

  return state;
}
