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
 *      shows verified data inline. This renders the inner-tx details
 *      the coordinator pre-decoded server-side, plus a link to the
 *      schedule's mirror-node entry for the user to verify against
 *      on-chain reality.
 *
 * Composition follows the post-redesign discipline: flat sections
 * separated by `border-t`, no per-section card chrome, mode banner
 * as a left-border callout, eyebrow + key:value rows. Register-aware
 * via treasury-label/console-label swaps.
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
    <div className="space-y-6">

      {/* Mode banner — left-border callout, not a bordered card.
          Sets the mental model: async, on-chain, long-window. The
          left-border treatment matches /join's trust panels and
          /history's storage-locality callout. */}
      <div className="border-l-2 border-info bg-info-soft/30 pl-4 py-3 rounded-r-md">
        <div className="flex items-start gap-3">
          <Icon name="schedule" size={20} className="text-info-soft-fg flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-info-soft-fg">
              Scheduled transaction (HIP-423)
            </h2>
            <p className="console-hide mt-1 text-sm text-info-soft-fg/90 leading-relaxed">
              Async signing — no 120-second window. Once you sign, your
              signature goes on-chain via{' '}
              <code className="font-mono">ScheduleSignTransaction</code>.
              Hedera executes the inner transaction when threshold is
              met or when the schedule expires.
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

      {/* Header — eyebrow + title. Flat, no card. */}
      <header>
        <div className="text-xs uppercase tracking-wider font-medium text-foreground-muted mb-2">
          <span className="treasury-label">What you&apos;re signing</span>
          <span className="console-label">inner_tx</span>
        </div>
        <h3 className="font-heading text-xl font-bold text-foreground">
          {innerType}
        </h3>
      </header>

      {/* Inner transaction body — flat dl, no surrounding card. */}
      {innerTxDetails && Object.keys(innerTxDetails).filter((k) => !['type', 'abiJson'].includes(k)).length > 0 && (
        <dl className="space-y-2 text-sm">
          {Object.entries(innerTxDetails)
            .filter(([k]) => !['type', 'abiJson'].includes(k))
            .map(([key, value]) => (
              <div key={key} className="flex gap-3">
                <dt className="w-32 flex-shrink-0 text-foreground-subtle text-xs uppercase tracking-wider pt-0.5">
                  {humanizeFieldName(key)}
                </dt>
                <dd className="text-foreground font-mono break-all">
                  {formatFieldValue(value)}
                </dd>
              </div>
            ))}
        </dl>
      )}

      {/* Schedule metadata — flat dl, separated by border-t. Render
          only when at least one field is set. */}
      {(scheduleMemo || payerAccountId || adminKey) && (
        <div className="border-t border-border pt-5">
          <div className="text-xs uppercase tracking-wider font-medium text-foreground-muted mb-3">
            <span className="treasury-label">Schedule metadata</span>
            <span className="console-label">schedule.metadata</span>
          </div>
          <dl className="space-y-2 text-sm">
            {scheduleMemo && (
              <div className="flex gap-3">
                <dt className="w-32 flex-shrink-0 text-foreground-subtle text-xs uppercase tracking-wider pt-0.5">Memo</dt>
                <dd className="text-foreground">{scheduleMemo}</dd>
              </div>
            )}
            {payerAccountId && (
              <div className="flex gap-3">
                <dt className="w-32 flex-shrink-0 text-foreground-subtle text-xs uppercase tracking-wider pt-0.5">Payer</dt>
                <dd className="text-foreground font-mono">{payerAccountId}</dd>
              </div>
            )}
            {adminKey && (
              <div className="flex gap-3">
                <dt className="w-32 flex-shrink-0 text-foreground-subtle text-xs uppercase tracking-wider pt-0.5">Admin key</dt>
                <dd className="text-foreground font-mono text-xs break-all">{adminKey}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* On-chain status — flat row, no card. Ground-truth signal
          that the schedule actually exists. */}
      <div className="border-t border-border pt-5">
        <div className="text-xs uppercase tracking-wider font-medium text-foreground-muted mb-3">
          <span className="treasury-label">On-chain status</span>
          <span className="console-label">on_chain</span>
        </div>
        <div className="flex items-start gap-3 text-sm">
          <Icon
            name={isExecuted ? 'check_circle' : isDeleted ? 'cancel' : 'cloud_done'}
            size={20}
            fill={isExecuted ? 1 : 0}
            className={
              isExecuted ? 'text-success' : isDeleted ? 'text-destructive' : 'text-info'
            }
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-foreground-subtle">Schedule ID:</span>
              <code className="font-mono text-foreground">{scheduleId}</code>
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

      {/* Actions — Approve primary (accent fill, .cmd for $⏎ in
          console + treasury → arrow), Reject secondary (real ghost
          button next to Approve, not a muted text-only link).
          Disabled if the schedule has already executed or been
          deleted. */}
      <div className="border-t border-border pt-6 flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={onApprove}
          disabled={disabled || isExecuted || isDeleted}
          className="cmd flex-1 inline-flex items-center justify-center px-6 py-3 rounded-md text-base font-semibold bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isExecuted
            ? 'Already executed'
            : isDeleted
            ? 'Schedule deleted'
            : 'Approve & sign on-chain'}
          {!(isExecuted || isDeleted) && (
            <span className="treasury-label ml-2 opacity-70">→</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onReject('Rejected by participant — schedule will not gather threshold from this signer.')}
          disabled={disabled || isExecuted || isDeleted}
          className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-medium text-foreground border border-border-strong hover:bg-surface-recessed disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Reject
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
