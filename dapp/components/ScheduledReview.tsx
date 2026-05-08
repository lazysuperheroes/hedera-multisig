/**
 * ScheduledReview — review screen for HIP-423 scheduled transactions.
 *
 * Distinct from TransactionReview (realtime) in three ways:
 *   1. Time pressure — TransactionReview countdowns 120s; this displays
 *      "expires in N days" with no urgency cues.
 *   2. What gets signed — TransactionReview signs frozen-tx bodyBytes
 *      and submits via WS. This builds a ScheduleSignTransaction
 *      against the scheduleId and submits directly to the network.
 *   3. Verification — TransactionReview decodes the frozen tx and
 *      shows a green "Verified" panel. This renders the inner-tx
 *      details the coordinator pre-decoded server-side, plus a link
 *      to the schedule's mirror-node entry for the user to verify
 *      against on-chain reality.
 *
 * Crisp by design: the display is "what am I signing, when does it
 * expire, who pays the fee, does the memo match what the coordinator
 * said in chat" — no audit-trail clutter from the realtime path.
 */

'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { CopyButton } from './CopyButton';
import { formatRelativeFuture } from '../lib/timeParser';
import { fetchScheduleInfo, type ScheduleStatus } from '../lib/mirror-node';

export interface ScheduledReviewProps {
  scheduleId: string;
  /** Seconds since epoch. */
  expirationTime: number | null;
  scheduleMemo: string | null;
  payerAccountId: string | null;
  adminKey: string | null;
  innerTxDetails: Record<string, unknown> | null;
  network: 'testnet' | 'mainnet';
  onApprove: () => void;
  /** Pass a string reason to match the realtime TransactionReview signature. */
  onReject: (reason: string) => void;
  disabled?: boolean;
}

export function ScheduledReview({
  scheduleId,
  expirationTime,
  scheduleMemo,
  payerAccountId,
  adminKey,
  innerTxDetails,
  network,
  onApprove,
  onReject,
  disabled,
}: ScheduledReviewProps) {
  const [mirrorStatus, setMirrorStatus] = useState<ScheduleStatus | null>(null);
  const [mirrorError, setMirrorError] = useState<string | null>(null);

  // Verify the schedule exists on-chain and surface its status. Mirror
  // lag means the schedule may not appear for a few seconds after
  // creation; we poll a couple of times before giving up.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      const status = await fetchScheduleInfo(scheduleId, network);
      if (cancelled) return;
      if (status) {
        setMirrorStatus(status);
        setMirrorError(null);
      } else if (attempts < 6) {
        setTimeout(tick, 2_000);
      } else {
        setMirrorError('Mirror node hasn\'t indexed this schedule yet. Refresh in a minute.');
      }
    };
    tick();
    return () => { cancelled = true; };
  }, [scheduleId, network]);

  const expiresInLabel = expirationTime
    ? formatRelativeFuture(expirationTime * 1000)
    : 'unspecified';
  const expiresAtAbs = expirationTime
    ? new Date(expirationTime * 1000).toUTCString().replace(/:\d\d GMT/, ' GMT')
    : null;

  const hashScanUrl = `https://hashscan.io/${network}/schedule/${scheduleId}`;

  const innerType = (innerTxDetails?.type as string | undefined) || 'Transaction';
  const alreadySignedCount = mirrorStatus?.signatures?.length ?? null;
  const isExecuted = !!mirrorStatus?.executedTimestamp;
  const isDeleted = !!mirrorStatus?.deleted;

  return (
    <div className="space-y-4">
      {/* Mode banner — sets the mental model BEFORE the user sees
          fields. Async, on-chain, long-window. Different surface from
          the realtime "120s countdown" review. */}
      <div className="rounded-lg border-2 border-info bg-info-soft p-4">
        <div className="flex items-start gap-3">
          <Icon name="schedule" size={24} className="text-info-soft-fg flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-info-soft-fg">
              Scheduled transaction (HIP-423)
            </h2>
            <p className="mt-1 text-sm text-info-soft-fg/90">
              Async signing — no 120-second window. Once you sign, your
              signature goes on-chain via{' '}
              <code className="font-mono">ScheduleSignTransaction</code>.
              Hedera executes the inner transaction when threshold is
              met or when the schedule expires (whichever comes first).
            </p>
            <p className="mt-2 text-sm text-info-soft-fg">
              <strong>Expires:</strong> {expiresInLabel}
              {expiresAtAbs && (
                <span className="text-info-soft-fg/80"> ({expiresAtAbs})</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Inner transaction — what you're being asked to sign, in human
          terms. Pre-decoded by the coordinator server-side (so we
          don't need to reconstruct from `transaction_body` bytes
          here, though that's available on mirrorStatus.transactionBody
          for an independent check). */}
      <div className="rounded-lg border-2 border-border bg-surface p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">
          What you&apos;re signing
        </h3>
        <dl className="space-y-2 text-sm">
          <div className="flex gap-3">
            <dt className="w-32 flex-shrink-0 text-foreground-subtle">Type:</dt>
            <dd className="text-foreground font-mono">{innerType}</dd>
          </div>
          {/* Best-effort dump of pre-decoded fields. The decoder writes
              transaction-type-specific keys on innerTxDetails (transfers,
              tokenIds, contractId, etc.); we render the strings as-is. */}
          {innerTxDetails && Object.entries(innerTxDetails)
            .filter(([k]) => !['type', 'abiJson'].includes(k))
            .map(([key, value]) => (
              <div key={key} className="flex gap-3">
                <dt className="w-32 flex-shrink-0 text-foreground-subtle">
                  {humanizeFieldName(key)}:
                </dt>
                <dd className="text-foreground font-mono break-all">
                  {formatFieldValue(value)}
                </dd>
              </div>
            ))}
        </dl>
      </div>

      {/* Schedule metadata — coordinator's claims about the schedule.
          Memo + payer + admin. Render only the fields actually set. */}
      {(scheduleMemo || payerAccountId || adminKey) && (
        <div className="rounded-lg border border-border bg-surface-recessed p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-2">
            Schedule metadata
          </h3>
          <dl className="space-y-1.5 text-sm">
            {scheduleMemo && (
              <div className="flex gap-3">
                <dt className="w-32 flex-shrink-0 text-foreground-subtle">Memo:</dt>
                <dd className="text-foreground">{scheduleMemo}</dd>
              </div>
            )}
            {payerAccountId && (
              <div className="flex gap-3">
                <dt className="w-32 flex-shrink-0 text-foreground-subtle">Payer:</dt>
                <dd className="text-foreground font-mono">{payerAccountId}</dd>
              </div>
            )}
            {adminKey && (
              <div className="flex gap-3">
                <dt className="w-32 flex-shrink-0 text-foreground-subtle">Admin key:</dt>
                <dd className="text-foreground font-mono text-xs break-all">{adminKey}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* On-chain status — ground-truth signal that the schedule actually
          exists. Tells the user "yes, the coordinator really did create
          this; they're not bluffing." */}
      <div className="rounded-lg border border-border bg-surface-recessed p-4">
        <div className="flex items-start gap-3">
          <Icon
            name={isExecuted ? 'check_circle' : isDeleted ? 'cancel' : 'cloud_done'}
            size={20}
            className={
              isExecuted ? 'text-success' : isDeleted ? 'text-destructive' : 'text-info'
            }
          />
          <div className="flex-1 min-w-0 text-sm">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <span className="text-foreground-subtle">Schedule ID:</span>{' '}
                <code className="font-mono text-foreground">{scheduleId}</code>
              </div>
              <CopyButton text={scheduleId} label="schedule ID" size="sm" />
            </div>
            {mirrorStatus && (
              <p className="mt-1 text-xs text-foreground-muted">
                {isExecuted
                  ? `Already executed at ${mirrorStatus.executedTimestamp}.`
                  : isDeleted
                  ? 'Already deleted by admin.'
                  : `On-chain. ${alreadySignedCount ?? 0} signature(s) collected so far.`}
                <a
                  href={hashScanUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 underline hover:no-underline"
                >
                  View on HashScan ↗
                </a>
              </p>
            )}
            {!mirrorStatus && !mirrorError && (
              <p className="mt-1 text-xs text-foreground-muted">
                Looking up on mirror node…
              </p>
            )}
            {mirrorError && (
              <p className="mt-1 text-xs text-warning-soft-fg">{mirrorError}</p>
            )}
          </div>
        </div>
      </div>

      {/* Action — either sign now or reject. Disabled if the schedule
          has already executed or been deleted (signing it would just
          eat fees). */}
      <div className="flex flex-col gap-2 pt-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={disabled || isExecuted || isDeleted}
          className="
            w-full px-6 py-3 rounded-md text-base font-semibold
            bg-accent text-accent-fg hover:bg-accent-hover
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors
          "
        >
          {isExecuted
            ? 'Already executed'
            : isDeleted
            ? 'Schedule deleted'
            : 'Approve & sign on-chain'}
        </button>
        <button
          type="button"
          onClick={() => onReject('Rejected by participant — schedule will not gather threshold from this signer.')}
          disabled={disabled || isExecuted || isDeleted}
          className="
            w-full px-6 py-2 rounded-md text-sm font-medium
            border border-border bg-surface text-foreground-muted
            hover:bg-surface-recessed disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          "
        >
          Reject — broadcast to coordinator + other signers
        </button>
      </div>
    </div>
  );
}

function humanizeFieldName(k: string): string {
  return k
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/_/g, ' ')
    .trim();
}

function formatFieldValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
