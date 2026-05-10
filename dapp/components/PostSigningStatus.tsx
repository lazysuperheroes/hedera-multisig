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
import { Icon } from './Icon';

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
  // Lazy-init: Date.now() must not run on every render per react-hooks/no-call-impure-render
  const [startTime] = useState(() => Date.now());
  const startTimeRef = useRef(startTime);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const hashScanUrl = getHashScanTransactionUrl(transactionId, network);

  // Poll mirror node for transaction status
  useEffect(() => {
    // Skip polling if transaction ID is unknown or invalid
    if (!transactionId || transactionId === 'Unknown') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- short-circuit when no tx to poll
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
      {/* Status Header — left-border callout matching the rest of the
          dApp's post-redesign discipline. Drops the heavy `border-2`
          card chrome; the soft bg + accent left-border carries the
          severity. */}
      <div
        className={`border-l-2 rounded-r-md pl-4 py-3 ${
          status === 'success'
            ? 'bg-success-soft border-success'
            : status === 'error'
            ? 'bg-destructive-soft border-destructive'
            : status === 'timeout'
            ? 'bg-warning-soft border-warning'
            : 'bg-info-soft border-info'
        }`}
      >
        {/* Status Icon */}
        <div className="flex items-center justify-center mb-4">
          {status === 'success' && (
            <Icon name="check_circle" size={48} fill={1} className="text-success" />
          )}
          {status === 'error' && (
            <Icon name="error" size={48} fill={1} className="text-destructive" />
          )}
          {status === 'timeout' && (
            <Icon name="schedule" size={48} className="text-warning" />
          )}
          {(status === 'polling' || status === 'still-checking') && (
            <Icon name="autorenew" size={48} className="text-info animate-spin" style={{ animationDuration: '2s' }} />
          )}
        </div>

        {/* Status Message */}
        <div className="text-center">
          {status === 'success' && (
            <>
              <h2 className="text-xl font-bold text-success-soft-fg mb-2">Transaction Successful!</h2>
              <p className="text-success-soft-fg mb-3">
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
                <h2 className="text-xl font-bold text-destructive-soft-fg mb-2">{explanation.headline}</h2>
                <p className="text-destructive-soft-fg mb-3">
                  {explanation.explanation}
                </p>
                <p className="text-sm text-destructive-soft-fg mb-3">
                  <strong>What to do:</strong> {explanation.recovery}
                </p>
                <p className="text-xs text-destructive/80 font-mono">
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
                  <h2 className="font-heading text-xl font-bold text-warning-soft-fg mb-2">
                    Only {signaturesCollected} of {signaturesRequired} signatures arrived
                  </h2>
                  <p className="text-warning-soft-fg mb-2">
                    The signing threshold was not met within the {Math.floor(POLLING_TIMEOUT_MS / 1000)}-second window. The transaction was never submitted to the network.
                  </p>
                  <p className="text-sm text-warning-soft-fg">
                    <strong>What to do:</strong> Coordinate with the missing signers and have the coordinator create a new session — or switch to <a href="https://docs.hedera.com/hedera/core-concepts/scheduled-transaction" className="underline" target="_blank" rel="noopener noreferrer">scheduled transactions</a> if signers can&apos;t be online together.
                  </p>
                </>
              );
            }

            return (
              <>
                <h2 className="font-heading text-xl font-bold text-warning-soft-fg mb-2">Transaction not found</h2>
                <p className="text-warning-soft-fg mb-2">
                  The transaction wasn&apos;t found on the network after {Math.floor(POLLING_TIMEOUT_MS / 1000)} seconds.
                </p>
                <p className="text-sm text-warning-soft-fg">
                  This usually means the signing threshold wasn&apos;t met (so the transaction never executed) or the network is briefly behind. Check HashScan below to confirm.
                </p>
              </>
            );
          })()}
          {status === 'polling' && (
            <>
              <h2 className="text-xl font-bold text-info-soft-fg mb-2">Signature Submitted!</h2>
              <p className="text-info-soft-fg mb-2">
                Checking if the transaction went through... (<span className="tabular-nums">{elapsedSeconds}s</span>)
              </p>
              <CheckingTxIdRow transactionId={transactionId} />
              <div className="w-full bg-info-soft rounded-full h-2 mt-3">
                <div
                  className="bg-accent h-2 rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min((elapsedSeconds / 125) * 100, 100)}%` }}
                />
              </div>
            </>
          )}
          {status === 'still-checking' && (
            <>
              <h2 className="text-xl font-bold text-info-soft-fg mb-2">Still Checking...</h2>
              <p className="text-info-soft-fg mb-2">
                The transaction hasn&apos;t appeared on the network yet. This can happen if other signers haven&apos;t signed yet, or if the network is busy. (<span className="tabular-nums">{elapsedSeconds}s</span>)
              </p>
              <CheckingTxIdRow transactionId={transactionId} />
              <div className="w-full bg-info-soft rounded-full h-2 mt-3">
                <div
                  className="bg-accent h-2 rounded-full transition-all duration-1000"
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
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
              status === 'success'
                ? 'bg-success text-success-fg hover:opacity-90'
                : status === 'error'
                ? 'bg-destructive text-destructive-fg hover:opacity-90'
                : 'bg-accent text-accent-fg hover:bg-accent-hover'
            }`}
          >
            View on HashScan
            <Icon name="open_in_new" size={14} />
          </a>
        </div>
      </div>

      {/* Transaction Details (expandable) — flat section, no card
          chrome. The previous bg-surface border-2 border-border-strong
          rounded-lg wrapper added card weight that didn't earn its
          place. */}
      <div className="border-t border-border pt-4">
        <details>
          <summary className="cursor-pointer text-xs uppercase tracking-wider font-medium text-foreground-muted hover:text-foreground transition-colors">
            <span className="treasury-label">Transaction details</span>
            <span className="console-label">tx.details</span>
          </summary>
          <div className="mt-4 space-y-3 text-sm">
            {/* Transaction ID */}
            <div className="flex gap-2 items-start">
              <span className="text-foreground-subtle w-32 flex-shrink-0">Transaction ID:</span>
              <span className="font-mono text-foreground break-all">{transactionId}</span>
              <CopyButton text={transactionId} label="Transaction ID" size="sm" />
            </div>

            {/* Type */}
            {transactionDetails?.type && (
              <div className="flex gap-2">
                <span className="text-foreground-subtle w-32">Type:</span>
                <span className="text-foreground">{transactionDetails.type}</span>
              </div>
            )}

            {/* Transfers */}
            {transactionDetails?.transfers && transactionDetails.transfers.length > 0 && (
              <div className="flex gap-2">
                <span className="text-foreground-subtle w-32">Transfers:</span>
                <div className="text-foreground">
                  {transactionDetails.transfers.map((t, i) => (
                    <div key={i} className="font-mono text-xs">
                      {t.accountId}: {formatTransferAmount(t.amount)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Token IDs */}
            {transactionDetails?.tokenIds && transactionDetails.tokenIds.length > 0 && (
              <div className="flex gap-2">
                <span className="text-foreground-subtle w-32">Tokens:</span>
                <span className="font-mono text-foreground">
                  {transactionDetails.tokenIds.join(', ')}
                </span>
              </div>
            )}

            {/* Contract */}
            {transactionDetails?.contractId && (
              <div className="flex gap-2">
                <span className="text-foreground-subtle w-32">Contract:</span>
                <span className="font-mono text-foreground">{transactionDetails.contractId}</span>
              </div>
            )}

            {/* Function */}
            {transactionDetails?.functionName && (
              <div className="flex gap-2">
                <span className="text-foreground-subtle w-32">Function:</span>
                <span className="font-mono text-foreground">{transactionDetails.functionName}()</span>
              </div>
            )}

            {/* Max Fee */}
            {transactionDetails?.maxTransactionFee && (
              <div className="flex gap-2">
                <span className="text-foreground-subtle w-32">Max Fee:</span>
                <span className="font-mono text-foreground">{transactionDetails.maxTransactionFee}</span>
              </div>
            )}

            {/* Memo */}
            {transactionDetails?.memo && (
              <div className="flex gap-2">
                <span className="text-foreground-subtle w-32">Memo:</span>
                <span className="text-foreground">{transactionDetails.memo}</span>
              </div>
            )}

            {/* Mirror Node Result (if available) */}
            {txStatus?.found && (
              <>
                <div className="border-t border-border my-2 pt-2">
                  <span className="text-xs font-semibold text-foreground-subtle uppercase">Network Result</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-foreground-subtle w-32">Result:</span>
                  <span className={`font-bold ${txStatus.result === 'SUCCESS' ? 'text-success' : 'text-destructive'}`}>
                    {txStatus.result}
                  </span>
                </div>
                {txStatus.chargedFee !== null && (
                  <div className="flex gap-2">
                    <span className="text-foreground-subtle w-32">Fee Charged:</span>
                    <span className="font-mono text-foreground">{(txStatus.chargedFee / 100000000).toFixed(8)} HBAR</span>
                  </div>
                )}
                {txStatus.consensusTimestamp && (
                  <div className="flex gap-2">
                    <span className="text-foreground-subtle w-32">Consensus:</span>
                    <span className="font-mono text-foreground">{txStatus.consensusTimestamp}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </details>
      </div>

      {/* Clear Button — ghost treatment, not a primary action. The
          user already saw the success/error state above; this is the
          "I'm done looking, ready for the next thing" affordance. */}
      <div className="text-center">
        <button
          onClick={onClear}
          className="cmd inline-flex items-center justify-center px-6 py-3 rounded-md text-base font-semibold text-foreground border border-border-strong hover:bg-surface-recessed transition-colors"
        >
          Ready for Next Transaction
        </button>
      </div>
    </div>
  );
}

/**
 * Format a HBAR transfer amount for the Transaction Details panel.
 *
 * Input is whatever the decoder hands us — typically a tinybar integer
 * as a string (e.g. "24000000" or "-24000000"), but tolerant of
 * already-formatted strings ("0.24 ℏ") to avoid double-formatting if
 * an upstream change sends them. Output: "+0.24 ℏ (24,000,000 tℏ)" or
 * "-0.24 ℏ (-24,000,000 tℏ)" — matches the user's mental model from
 * the verified Transfers panel above instead of leaving raw tinybars
 * that read like a bug.
 */
function formatTransferAmount(amount: string): string {
  if (amount == null || amount === '') return '—';
  const trimmed = String(amount).trim();
  // If the upstream already includes "ℏ" or non-numeric chars beyond
  // a leading sign, pass it through — already user-formatted.
  if (/[ℏH]/.test(trimmed)) return trimmed;
  const tinybars = Number(trimmed);
  if (!Number.isFinite(tinybars)) return trimmed;
  if (tinybars === 0) return '0 ℏ';
  const sign = tinybars < 0 ? '-' : '+';
  const abs = Math.abs(tinybars);
  const hbar = abs / 100_000_000;
  const hbarStr = hbar.toFixed(8).replace(/\.?0+$/, '');
  return `${sign}${hbarStr} ℏ (${sign}${abs.toLocaleString()} tℏ)`;
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
    <div className="mt-4 border-l-2 border-success bg-surface-recessed/50 pl-4 py-3 text-left">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-foreground-muted">Verified on Mirror Node</h3>
        {anyDiscrepancy ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-warning-soft text-warning-soft-fg">
            Discrepancy
          </span>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded-full bg-success-soft text-success-soft-fg">
            Matches signed intent
          </span>
        )}
      </div>
      {/* Phase F5: overflow-x-auto wrapper — table has 4 cols of variable
          width, narrow viewports need horizontal scroll instead of wrap */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[480px]">
          <thead>
            <tr className="text-foreground-subtle">
              <th className="text-left py-1">Account</th>
              <th className="text-right py-1">Signed</th>
              <th className="text-right py-1">Actual</th>
              <th className="text-left py-1 pl-4">Note</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((r) => (
              <tr key={r.account} className="border-t border-border">
                <td className="py-1">{r.account}</td>
                <td className="text-right tabular-nums whitespace-nowrap">{formatTinybarsWithHbar(r.expected)}</td>
                <td className="text-right tabular-nums whitespace-nowrap">{formatTinybarsWithHbar(r.actual)}</td>
                <td className="pl-4 font-sans">
                  {r.status === 'match' && (
                    <span className="text-success-soft-fg">exact match</span>
                  )}
                  {r.status === 'fee-only' && (
                    <span className="text-foreground-muted">
                      fee deducted ({formatTinybarsWithHbar(chargedFee || 0)})
                    </span>
                  )}
                  {r.status === 'missing' && (
                    <span className="text-warning-soft-fg">expected but not in mirror</span>
                  )}
                  {r.status === 'diff' && (
                    <span className="text-warning-soft-fg">
                      differs by {formatTinybarsWithHbar(r.delta ?? 0)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-foreground-subtle">
        Tinybars are the engineering precision (1 ℏ = 100 000 000 tℏ); HBAR equivalents in parentheses. Anything other than &quot;exact match&quot; or &quot;fee deducted&quot; warrants investigation.
      </p>
    </div>
  );
}

export default PostSigningStatus;

/**
 * Tiny inline tx-ID + copy-button row, rendered inside the
 * "Signature Submitted! Checking..." card so users can copy the tx ID
 * before HashScan loads, instead of having to expand "Transaction
 * Details" or click through to the explorer first.
 */
function CheckingTxIdRow({ transactionId }: { transactionId: string }) {
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <span className="text-info-soft-fg/80 shrink-0">Transaction ID:</span>
      <code className="font-mono text-info-soft-fg break-all">{transactionId}</code>
      <CopyButton text={transactionId} label="transaction ID" size="sm" />
    </div>
  );
}
