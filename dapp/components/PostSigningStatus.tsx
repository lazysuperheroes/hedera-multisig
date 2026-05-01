/**
 * PostSigningStatus Component
 *
 * Displays transaction status after user has signed.
 * Polls mirror node to check if transaction has been executed.
 *
 * Features:
 * - Shows transaction ID with HashScan link
 * - Expandable transaction details
 * - Auto-polls mirror node for execution result
 * - 125-second timeout handling
 * - "Clear / Ready for Next" button
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import {
  fetchTransactionStatus,
  getHashScanTransactionUrl,
  TransactionStatus,
} from '../lib/mirror-node';
import { CopyButton } from './CopyButton';

export interface PostSigningStatusProps {
  transactionId: string;
  transactionDetails?: {
    type: string;
    transfers?: Array<{ accountId: string; amount: string }>;
    tokenIds?: string[];
    contractId?: string;
    functionName?: string;
    memo?: string;
    maxTransactionFee?: string;
  } | null;
  network?: 'testnet' | 'mainnet';
  onClear: () => void;
  /** Phase B13: distinguish "threshold not met" from "not found" on timeout */
  signaturesCollected?: number;
  signaturesRequired?: number;
}

/**
 * Phase B13: map common Hedera result codes to plain-English explanation +
 * a recovery action a non-technical participant can act on.
 */
function explainResultCode(code: string): { headline: string; explanation: string; recovery: string } {
  switch (code) {
    case 'INSUFFICIENT_PAYER_BALANCE':
      return {
        headline: 'Payer account is out of HBAR',
        explanation: 'The account paying the network fee did not have enough HBAR to cover it.',
        recovery: 'Top up the payer account (or operator account) and ask the coordinator to retry the transaction.',
      };
    case 'INSUFFICIENT_ACCOUNT_BALANCE':
      return {
        headline: 'Source account is out of HBAR',
        explanation: 'The account being debited did not have enough HBAR to cover the transfer.',
        recovery: 'Top up the source account and have the coordinator create a new session.',
      };
    case 'INVALID_SIGNATURE':
      return {
        headline: 'Signature did not match the threshold key',
        explanation: 'One or more collected signatures did not match a key in the eligible-keys set. The transaction never executed.',
        recovery: 'The coordinator should verify the eligible-keys list matches the threshold key on-chain, then start a new session.',
      };
    case 'CONTRACT_REVERT_EXECUTED':
      return {
        headline: 'The smart contract rejected the call',
        explanation: 'Network fees were paid, but the contract reverted (it actively refused the operation). This usually means a precondition wasn\'t met — wrong arguments, paused state, or insufficient allowance.',
        recovery: 'Check the contract\'s preconditions. If you\'re unsure, ask the contract\'s deployer or read the source.',
      };
    case 'INVALID_SCHEDULE_ID':
      return {
        headline: 'Schedule ID not found',
        explanation: 'The scheduled transaction was deleted, expired, or never existed.',
        recovery: 'The coordinator should create a new schedule.',
      };
    case 'SCHEDULE_ALREADY_EXECUTED':
      return {
        headline: 'Schedule already executed',
        explanation: 'Another signer\'s signature met the threshold first; the network executed the transaction. Your signature was not needed.',
        recovery: 'No action needed — the transaction succeeded. Check HashScan for the result.',
      };
    case 'SCHEDULE_EXPIRED':
      return {
        headline: 'Scheduled transaction expired',
        explanation: 'The schedule\'s expiration time passed before threshold was met.',
        recovery: 'Coordinator needs to create a new schedule — consider a longer expiration window (up to ~62 days).',
      };
    case 'TRANSACTION_EXPIRED':
      return {
        headline: 'Transaction expired before all signatures arrived',
        explanation: 'Hedera transactions are valid for 120 seconds after freezing. Not enough signers signed in time.',
        recovery: 'Coordinator should create a new session with all signers ready, or use scheduled transactions for async signing.',
      };
    case 'INVALID_ACCOUNT_ID':
    case 'ACCOUNT_DELETED':
      return {
        headline: 'Account ID is invalid or deleted',
        explanation: 'One of the accounts referenced in the transaction does not exist on this network.',
        recovery: 'Verify all account IDs and the network (mainnet vs testnet).',
      };
    default:
      return {
        headline: 'Transaction failed',
        explanation: `The Hedera network rejected the transaction with code ${code}. This may be a contract-specific error or an unexpected network condition.`,
        recovery: 'Check the HashScan link for full details. The coordinator may need to create a new session.',
      };
  }
}

// Polling stages
// Hedera transactions have a 120-second validity window after freezing.
// Mirror node needs ~5 seconds to reflect consensus. Total: 125 seconds.
const STILL_CHECKING_MS = 60 * 1000;  // Show reassurance message after 60s
const POLLING_TIMEOUT_MS = 125 * 1000; // Hard boundary: 120s validity + 5s mirror lag
// Poll interval (3 seconds)
const POLL_INTERVAL_MS = 3000;

export function PostSigningStatus({
  transactionId,
  transactionDetails,
  network = 'testnet',
  onClear,
  signaturesCollected,
  signaturesRequired,
}: PostSigningStatusProps) {
  const [status, setStatus] = useState<'polling' | 'still-checking' | 'success' | 'error' | 'timeout'>('polling');
  const [txStatus, setTxStatus] = useState<TransactionStatus | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTimeRef = useRef(Date.now());
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const hashScanUrl = getHashScanTransactionUrl(transactionId, network);

  // Poll mirror node for transaction status
  useEffect(() => {
    // Skip polling if transaction ID is unknown or invalid
    if (!transactionId || transactionId === 'Unknown') {
      setStatus('timeout');
      return;
    }

    const pollStatus = async () => {
      const elapsed = Date.now() - startTimeRef.current;

      // Check for timeout
      if (elapsed >= POLLING_TIMEOUT_MS) {
        setStatus('timeout');
        if (pollIntervalRef.current) {
          clearTimeout(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        return;
      }

      // Transition to "still checking" after 30s
      if (elapsed >= STILL_CHECKING_MS) {
        setStatus((prev) => prev === 'polling' ? 'still-checking' : prev);
      }

      try {
        const result = await fetchTransactionStatus(transactionId, network);
        setTxStatus(result);

        if (result.found) {
          // Transaction found - check result
          if (result.result === 'SUCCESS') {
            setStatus('success');
          } else {
            setStatus('error');
          }
          // Stop polling
          if (pollIntervalRef.current) {
            clearTimeout(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      } catch (error) {
        console.error('Error polling transaction status:', error);
        // Continue polling on error
      }
    };

    // Start polling. Phase C9: jitter avoids N-signer thundering herd on the
    // public mirror node (without it, every signer in a ceremony hits the
    // same 3s tick for up to 125s).
    pollStatus(); // Initial poll
    const jitter = () => POLL_INTERVAL_MS + Math.floor(Math.random() * 500);
    const scheduleNext = () => {
      pollIntervalRef.current = setTimeout(async () => {
        await pollStatus();
        if (pollIntervalRef.current !== null) scheduleNext();
      }, jitter()) as unknown as NodeJS.Timeout;
    };
    scheduleNext();

    // Track elapsed time for UI
    elapsedIntervalRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => {
      if (pollIntervalRef.current) {
        clearTimeout(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    };
  }, [transactionId, network]);

  return (
    <div className="space-y-4">
      {/* Status Header */}
      <div
        className={`border-2 rounded-lg p-6 ${
          status === 'success'
            ? 'bg-green-50 dark:bg-green-950/30 border-green-500 dark:border-green-700'
            : status === 'error'
            ? 'bg-red-50 dark:bg-red-950/30 border-red-500 dark:border-red-700'
            : status === 'timeout'
            ? 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-500 dark:border-yellow-700'
            : 'bg-blue-50 dark:bg-blue-950/30 border-blue-500 dark:border-blue-700'
        }`}
      >
        {/* Status Icon */}
        <div className="flex items-center justify-center mb-4">
          {status === 'success' && (
            <div className="text-green-600 dark:text-green-400">
              <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          {status === 'error' && (
            <div className="text-red-600 dark:text-red-400">
              <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          )}
          {status === 'timeout' && (
            <div className="text-yellow-600 dark:text-yellow-400">
              <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          )}
          {(status === 'polling' || status === 'still-checking') && (
            <div className="animate-pulse text-blue-600 dark:text-blue-400">
              <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
          )}
        </div>

        {/* Status Message */}
        <div className="text-center">
          {status === 'success' && (
            <>
              <h2 className="text-xl font-bold text-green-800 dark:text-green-200 mb-2">Transaction Successful!</h2>
              <p className="text-green-700 dark:text-green-300 mb-3">
                Transaction {transactionId} <span className="font-bold">SUCCESS</span>
              </p>
              {/* Phase C1: intent-vs-actual diff. Compare the transfers we
                  signed against what the mirror node reports the network
                  actually executed. The payer account legitimately differs
                  by the fee amount; everything else should match exactly. */}
              {transactionDetails?.transfers && txStatus?.transfers && (
                <IntentVsActualDiff
                  expected={transactionDetails.transfers}
                  actual={txStatus.transfers}
                  chargedFee={txStatus.chargedFee}
                />
              )}
            </>
          )}
          {status === 'error' && (() => {
            const explanation = explainResultCode(txStatus?.result || 'UNKNOWN');
            return (
              <>
                <h2 className="text-xl font-bold text-red-800 dark:text-red-200 mb-2">{explanation.headline}</h2>
                <p className="text-red-700 dark:text-red-300 mb-3">
                  {explanation.explanation}
                </p>
                <p className="text-sm text-red-700 dark:text-red-300 mb-3">
                  <strong>What to do:</strong> {explanation.recovery}
                </p>
                <p className="text-xs text-red-600/80 dark:text-red-400/80 font-mono">
                  Code: {txStatus?.result || 'UNKNOWN'}
                </p>
              </>
            );
          })()}
          {status === 'timeout' && (() => {
            // Phase B13: distinguish "threshold not met" from generic "not found".
            // If we know how many signatures were collected vs required, prefer the precise message.
            const thresholdNotMet =
              typeof signaturesCollected === 'number' &&
              typeof signaturesRequired === 'number' &&
              signaturesCollected < signaturesRequired;

            if (thresholdNotMet) {
              return (
                <>
                  <h2 className="text-xl font-bold text-yellow-800 dark:text-yellow-200 mb-2">
                    Only {signaturesCollected} of {signaturesRequired} signatures arrived
                  </h2>
                  <p className="text-yellow-700 dark:text-yellow-300 mb-2">
                    The signing threshold was not met within the {Math.floor(POLLING_TIMEOUT_MS / 1000)}-second window. The transaction was never submitted to the network.
                  </p>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    <strong>What to do:</strong> Coordinate with the missing signers and have the coordinator create a new session — or switch to <a href="https://docs.hedera.com/hedera/core-concepts/scheduled-transaction" className="underline" target="_blank" rel="noopener noreferrer">scheduled transactions</a> if signers can&apos;t be online together.
                  </p>
                </>
              );
            }

            return (
              <>
                <h2 className="text-xl font-bold text-yellow-800 dark:text-yellow-200 mb-2">Transaction Not Found</h2>
                <p className="text-yellow-700 dark:text-yellow-300 mb-2">
                  The transaction wasn&apos;t found on the network after {Math.floor(POLLING_TIMEOUT_MS / 1000)} seconds.
                </p>
                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                  This usually means the signing threshold wasn&apos;t met (so the transaction never executed) or the network is briefly behind. Check HashScan below to confirm.
                </p>
              </>
            );
          })()}
          {status === 'polling' && (
            <>
              <h2 className="text-xl font-bold text-blue-800 dark:text-blue-200 mb-2">Signature Submitted!</h2>
              <p className="text-blue-700 dark:text-blue-300 mb-2">
                Checking if the transaction went through... (<span className="tabular-nums">{elapsedSeconds}s</span>)
              </p>
              <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2 mt-3">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min((elapsedSeconds / 125) * 100, 100)}%` }}
                />
              </div>
            </>
          )}
          {status === 'still-checking' && (
            <>
              <h2 className="text-xl font-bold text-blue-800 dark:text-blue-200 mb-2">Still Checking...</h2>
              <p className="text-blue-700 dark:text-blue-300 mb-2">
                The transaction hasn&apos;t appeared on the network yet. This can happen if other signers haven&apos;t signed yet, or if the network is busy. (<span className="tabular-nums">{elapsedSeconds}s</span>)
              </p>
              <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2 mt-3">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min((elapsedSeconds / 125) * 100, 100)}%` }}
                />
              </div>
            </>
          )}
        </div>

        {/* Transaction ID Link */}
        <div className="mt-4 text-center">
          <a
            href={hashScanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium ${
              status === 'success'
                ? 'bg-green-600 text-white hover:bg-green-700'
                : status === 'error'
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            View on HashScan
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>

      {/* Transaction Details (Expandable) */}
      <div className="bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 rounded-lg">
        <details>
          <summary className="cursor-pointer p-4 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Transaction Details
          </summary>
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-3 text-sm">
            {/* Transaction ID */}
            <div className="flex gap-2 items-start">
              <span className="text-gray-500 dark:text-gray-400 w-32 flex-shrink-0">Transaction ID:</span>
              <span className="font-mono text-gray-800 dark:text-gray-200 break-all">{transactionId}</span>
              <CopyButton text={transactionId} label="Transaction ID" size="sm" />
            </div>

            {/* Type */}
            {transactionDetails?.type && (
              <div className="flex gap-2">
                <span className="text-gray-500 dark:text-gray-400 w-32">Type:</span>
                <span className="text-gray-800 dark:text-gray-200">{transactionDetails.type}</span>
              </div>
            )}

            {/* Transfers */}
            {transactionDetails?.transfers && transactionDetails.transfers.length > 0 && (
              <div className="flex gap-2">
                <span className="text-gray-500 dark:text-gray-400 w-32">Transfers:</span>
                <div className="text-gray-800 dark:text-gray-200">
                  {transactionDetails.transfers.map((t, i) => (
                    <div key={i} className="font-mono text-xs">
                      {t.accountId}: {t.amount}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Token IDs */}
            {transactionDetails?.tokenIds && transactionDetails.tokenIds.length > 0 && (
              <div className="flex gap-2">
                <span className="text-gray-500 dark:text-gray-400 w-32">Tokens:</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">
                  {transactionDetails.tokenIds.join(', ')}
                </span>
              </div>
            )}

            {/* Contract */}
            {transactionDetails?.contractId && (
              <div className="flex gap-2">
                <span className="text-gray-500 dark:text-gray-400 w-32">Contract:</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">{transactionDetails.contractId}</span>
              </div>
            )}

            {/* Function */}
            {transactionDetails?.functionName && (
              <div className="flex gap-2">
                <span className="text-gray-500 dark:text-gray-400 w-32">Function:</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">{transactionDetails.functionName}()</span>
              </div>
            )}

            {/* Max Fee */}
            {transactionDetails?.maxTransactionFee && (
              <div className="flex gap-2">
                <span className="text-gray-500 dark:text-gray-400 w-32">Max Fee:</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">{transactionDetails.maxTransactionFee}</span>
              </div>
            )}

            {/* Memo */}
            {transactionDetails?.memo && (
              <div className="flex gap-2">
                <span className="text-gray-500 dark:text-gray-400 w-32">Memo:</span>
                <span className="text-gray-800 dark:text-gray-200">{transactionDetails.memo}</span>
              </div>
            )}

            {/* Mirror Node Result (if available) */}
            {txStatus?.found && (
              <>
                <div className="border-t border-gray-200 dark:border-gray-700 my-2 pt-2">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Network Result</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-gray-500 dark:text-gray-400 w-32">Result:</span>
                  <span className={`font-bold ${txStatus.result === 'SUCCESS' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {txStatus.result}
                  </span>
                </div>
                {txStatus.chargedFee !== null && (
                  <div className="flex gap-2">
                    <span className="text-gray-500 dark:text-gray-400 w-32">Fee Charged:</span>
                    <span className="font-mono text-gray-800 dark:text-gray-200">{(txStatus.chargedFee / 100000000).toFixed(8)} HBAR</span>
                  </div>
                )}
                {txStatus.consensusTimestamp && (
                  <div className="flex gap-2">
                    <span className="text-gray-500 dark:text-gray-400 w-32">Consensus:</span>
                    <span className="font-mono text-gray-800 dark:text-gray-200">{txStatus.consensusTimestamp}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </details>
      </div>

      {/* Clear Button */}
      <div className="text-center">
        <button
          onClick={onClear}
          className="px-6 py-3 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 transition-colors"
        >
          Ready for Next Transaction
        </button>
      </div>
    </div>
  );
}

/**
 * Phase F5: humanize raw tinybars for the IntentVsActualDiff table.
 * Tinybars are precise but unreadable; HBAR is the user's mental model.
 * Returns "100 tℏ (~0.000001 ℏ)" for non-zero values, or "0 tℏ" for zero.
 */
function formatTinybarsWithHbar(tinybars: number | null): string {
  if (tinybars === null) return '—';
  if (tinybars === 0) return '0 tℏ';
  const hbar = tinybars / 100_000_000;
  // Show enough fractional digits to capture small amounts; trim trailing zeros
  const hbarStr = hbar.toFixed(8).replace(/\.?0+$/, '');
  const tinybarStr = tinybars.toLocaleString();
  return `${tinybarStr} tℏ (~${hbarStr} ℏ)`;
}

/**
 * Phase C1: render expected vs actual transfers side by side. The payer
 * account legitimately differs by the network fee — that case is highlighted
 * as expected, not as a discrepancy.
 */
function IntentVsActualDiff({
  expected,
  actual,
  chargedFee,
}: {
  expected: Array<{ accountId: string; amount: string }>;
  actual: Array<{ account: string; amount: number }>;
  chargedFee: number | null;
}) {
  // Index actual transfers by account
  const actualByAccount = new Map<string, number>();
  for (const t of actual) {
    actualByAccount.set(t.account, (actualByAccount.get(t.account) || 0) + t.amount);
  }

  // Phase F3: shared decoder now emits raw tinybars (string) — direct parse,
  // no regex extraction needed.
  const rows = expected.map((e) => {
    const expectedTinybars = parseInt(String(e.amount), 10) || 0;
    const actualTinybars = actualByAccount.get(e.accountId);
    if (actualTinybars === undefined) {
      return { account: e.accountId, expected: expectedTinybars, actual: null, status: 'missing' as const };
    }
    if (actualTinybars === expectedTinybars) {
      return { account: e.accountId, expected: expectedTinybars, actual: actualTinybars, status: 'match' as const };
    }
    // Off by exactly the network fee → expected (payer paid the fee)
    const delta = actualTinybars - expectedTinybars;
    if (chargedFee && Math.abs(delta + chargedFee) < 100) {
      return { account: e.accountId, expected: expectedTinybars, actual: actualTinybars, status: 'fee-only' as const, delta };
    }
    return { account: e.accountId, expected: expectedTinybars, actual: actualTinybars, status: 'diff' as const, delta };
  });

  const anyDiscrepancy = rows.some((r) => r.status === 'missing' || r.status === 'diff');

  return (
    <div className="mt-4 rounded-lg border border-green-200 dark:border-green-800 bg-white dark:bg-gray-800 p-4 text-left">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Verified on Mirror Node</h3>
        {anyDiscrepancy ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-800">
            Discrepancy
          </span>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800">
            Matches signed intent
          </span>
        )}
      </div>
      {/* Phase F5: overflow-x-auto wrapper — table has 4 cols of variable
          width, narrow viewports need horizontal scroll instead of wrap */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[480px]">
          <thead>
            <tr className="text-gray-500 dark:text-gray-400">
              <th className="text-left py-1">Account</th>
              <th className="text-right py-1">Signed</th>
              <th className="text-right py-1">Actual</th>
              <th className="text-left py-1 pl-4">Note</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((r) => (
              <tr key={r.account} className="border-t border-gray-100 dark:border-gray-700">
                <td className="py-1">{r.account}</td>
                <td className="text-right tabular-nums whitespace-nowrap">{formatTinybarsWithHbar(r.expected)}</td>
                <td className="text-right tabular-nums whitespace-nowrap">{formatTinybarsWithHbar(r.actual)}</td>
                <td className="pl-4 font-sans">
                  {r.status === 'match' && (
                    <span className="text-green-700 dark:text-green-400">exact match</span>
                  )}
                  {r.status === 'fee-only' && (
                    <span className="text-gray-600 dark:text-gray-400">
                      fee deducted ({formatTinybarsWithHbar(chargedFee || 0)})
                    </span>
                  )}
                  {r.status === 'missing' && (
                    <span className="text-yellow-700 dark:text-yellow-400">expected but not in mirror</span>
                  )}
                  {r.status === 'diff' && (
                    <span className="text-yellow-700 dark:text-yellow-400">
                      differs by {formatTinybarsWithHbar(r.delta ?? 0)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        Tinybars are the engineering precision (1 ℏ = 100 000 000 tℏ); HBAR equivalents in parentheses. Anything other than &quot;exact match&quot; or &quot;fee deducted&quot; warrants investigation.
      </p>
    </div>
  );
}

export default PostSigningStatus;
