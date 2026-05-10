'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import {
  useTxHistory,
  updateTxHistoryEntryStatus,
  TxHistoryEntry,
} from '../../hooks/useTxHistory';
import { CopyButton } from '../../components/CopyButton';
import { Footer } from '../../components/Footer';
import { Icon } from '../../components/Icon';
import {
  getHashScanTransactionUrl,
  fetchTransactionStatus,
} from '../../lib/mirror-node';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type StatusFilter = 'ALL' | 'SUCCESS' | 'FAILURE' | 'PENDING';
type DateRange = 'all' | '24h' | '7d' | '30d';

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  all: 'All time',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
};

const STATUS_LABELS: Record<TxHistoryEntry['status'], string> = {
  SUCCESS: 'Success',
  FAILURE: 'Failure',
  PENDING: 'Pending',
};

// Threshold below which the filter UI is hidden — short lists are
// scannable without filtering. Above this, the filters earn their
// real-estate.
const FILTERS_VISIBLE_THRESHOLD = 5;

// Mirror-node lag (~3-5s). Treat anything older than this as "should have
// landed by now" — if it's still missing on mirror, mark expired.
const STALE_PENDING_MS = 130 * 1000; // 120s validity + 10s buffer

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateTxId(txId: string): string {
  if (txId.length <= 24) return txId;
  return `${txId.slice(0, 14)}…${txId.slice(-8)}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function isWithinRange(iso: string, range: DateRange): boolean {
  if (range === 'all') return true;
  const now = Date.now();
  const ts = new Date(iso).getTime();
  const msMap: Record<string, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  return now - ts <= (msMap[range] ?? Infinity);
}

/** Human-readable transaction type label */
function txTypeLabel(raw: string): string {
  // Strip 'Transaction' suffix and add spaces before capitals
  const clean = raw.replace(/Transaction$/i, '');
  return clean.replace(/([a-z])([A-Z])/g, '$1 $2') || raw;
}

// ---------------------------------------------------------------------------
// Status badge — flat soft-bg pill, no /40 border hedge.
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: TxHistoryEntry['status'] }) {
  const classes: Record<TxHistoryEntry['status'], string> = {
    SUCCESS: 'bg-success-soft text-success-soft-fg',
    FAILURE: 'bg-destructive-soft text-destructive-soft-fg',
    PENDING: 'bg-warning-soft text-warning-soft-fg',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${classes[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HistoryPage() {
  const { entries, clearHistory, exportCsv, refresh } = useTxHistory();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [confirmClear, setConfirmClear] = useState(false);
  const [refreshingPending, setRefreshingPending] = useState<number>(0);

  // Backfill PENDING entries by polling the mirror node. Without this, a tx
  // that injected, signed, and executed on a previous visit would stay
  // "PENDING" in localStorage forever — confusing for a treasury operator
  // who looks at history days later. Local sessions have a 120s validity;
  // if mirror still doesn't know about a tx that's older than that, it
  // expired (signers didn't meet threshold in time).
  //
  // Surfaces an inline "Refreshing N pending…" status while the polling
  // is in flight — without this, the UI looked frozen during the 1-3s
  // mirror round-trip.
  useEffect(() => {
    const pending = entries.filter(
      (e) =>
        e.status === 'PENDING' &&
        e.transactionId &&
        e.transactionId !== 'unknown'
    );
    if (pending.length === 0) {
      setRefreshingPending(0);
      return;
    }

    setRefreshingPending(pending.length);
    let cancelled = false;
    (async () => {
      let touched = false;
      for (const e of pending) {
        if (cancelled) return;
        const network = (e.network === 'mainnet' ? 'mainnet' : 'testnet') as
          | 'testnet'
          | 'mainnet';
        try {
          const status = await fetchTransactionStatus(e.transactionId, network);
          if (cancelled) return;
          const ageMs = Date.now() - new Date(e.timestamp).getTime();

          if (status.found) {
            if (status.result === 'SUCCESS') {
              updateTxHistoryEntryStatus(e.transactionId, 'SUCCESS', {
                receiptStatus: status.result,
                consensusTimestamp: status.consensusTimestamp,
                chargedFee: status.chargedFee,
                executedAt: new Date().toISOString(),
              });
            } else {
              updateTxHistoryEntryStatus(e.transactionId, 'FAILURE', {
                failureReason: status.result || 'Network rejected the transaction.',
                consensusTimestamp: status.consensusTimestamp,
                failedAt: new Date().toISOString(),
              });
            }
            touched = true;
          } else if (ageMs > STALE_PENDING_MS) {
            updateTxHistoryEntryStatus(e.transactionId, 'FAILURE', {
              failureReason:
                'Not found on mirror node after the 120-second window — likely expired before threshold was met.',
              expiredAt: new Date().toISOString(),
            });
            touched = true;
          }
        } catch {
          // Mirror down / transient — leave PENDING; we'll retry next mount.
        }
      }
      if (!cancelled) {
        setRefreshingPending(0);
        if (touched) refresh();
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length]);

  // Filter & sort (newest first)
  const filtered = useMemo(() => {
    return entries
      .filter((e) => {
        if (statusFilter !== 'ALL' && e.status !== statusFilter) return false;
        if (!isWithinRange(e.timestamp, dateRange)) return false;
        return true;
      })
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
  }, [entries, statusFilter, dateRange]);

  const showFilters = entries.length > FILTERS_VISIBLE_THRESHOLD;

  // Shared select treatment matching /join's input pattern — keeps the
  // visible focus ring (a11y regression in the previous version was
  // `focus:border-transparent` with no replacement).
  const selectClass =
    'px-3 py-2 rounded-md text-sm border border-border bg-surface text-foreground ' +
    'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent transition-colors';

  return (
    <main className="min-h-screen bg-background">
      <section className="max-w-5xl mx-auto px-6 py-8 sm:py-12">

        {/* Header — flat, asymmetric, matching /join post-redesign */}
        <header className="mb-8 max-w-2xl">
          <h1 className="page-hero font-heading text-3xl sm:text-4xl font-bold tracking-tight text-foreground leading-[1.05]">
            Transaction history
          </h1>
          <p className="console-hide mt-3 text-foreground-muted leading-relaxed">
            Transactions this browser participated in.
          </p>
          {/* Storage-locality callout — info-soft tint at /20 instead of
              the previous /60 hedge. Hidden in console (engineers know
              localStorage). */}
          <div className="console-hide mt-5 border-l-2 border-info bg-info-soft/30 pl-4 py-2.5 text-xs text-info-soft-fg rounded-r-md">
            <strong>Stored in this browser only.</strong> Switching devices,
            clearing site data, or using private browsing will reset this list.
            Use the CSV export below to keep a record.
          </div>
        </header>

        {/* Pending-mirror-poll status line. Only renders while polling
            is in flight so the user doesn't think the UI is frozen
            during the mirror round-trip. */}
        {refreshingPending > 0 && (
          <div className="mb-4 flex items-center gap-2 text-xs text-foreground-muted" role="status" aria-live="polite">
            <Spinner />
            Refreshing {refreshingPending} pending {refreshingPending === 1 ? 'transaction' : 'transactions'}…
          </div>
        )}

        {/* Controls row — flat, no card chrome. Filters only render
            once there are enough entries to filter meaningfully
            (FILTERS_VISIBLE_THRESHOLD); export/clear are always
            available when there's any history at all. */}
        {entries.length > 0 && (
          <div className="mb-6 flex items-center gap-3 flex-wrap">
            {showFilters && (
              <>
                <label htmlFor="status-filter" className="sr-only">Status</label>
                <select
                  id="status-filter"
                  className={selectClass}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                  aria-label="Filter by status"
                >
                  <option value="ALL">All statuses</option>
                  <option value="SUCCESS">Success</option>
                  <option value="FAILURE">Failure</option>
                  <option value="PENDING">Pending</option>
                </select>

                <label htmlFor="date-range" className="sr-only">Period</label>
                <select
                  id="date-range"
                  className={selectClass}
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value as DateRange)}
                  aria-label="Filter by period"
                >
                  {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map((k) => (
                    <option key={k} value={k}>{DATE_RANGE_LABELS[k]}</option>
                  ))}
                </select>
              </>
            )}

            <div className="flex-1" />

            <button
              type="button"
              onClick={exportCsv}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md text-foreground-muted hover:text-foreground hover:bg-surface-recessed border border-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Icon name="download" size={16} />
              Export CSV
            </button>

            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                disabled={entries.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md text-destructive border border-destructive/30 hover:bg-destructive-soft disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Icon name="delete_outline" size={16} />
                Clear history
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-destructive">Are you sure?</span>
                <button
                  type="button"
                  onClick={() => {
                    clearHistory();
                    setConfirmClear(false);
                  }}
                  className="px-3 py-1.5 text-sm font-medium rounded-md bg-destructive text-destructive-fg hover:opacity-90 transition-opacity"
                >
                  Yes, delete all
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-3 py-1.5 text-sm font-medium rounded-md text-foreground-muted hover:text-foreground hover:bg-surface-recessed border border-border transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* Table or empty state */}
        {filtered.length === 0 ? (
          entries.length === 0 ? <EmptyState /> : <NoMatchesState />
        ) : (
          <>
            <h2 className="sr-only">Transactions</h2>
            <div
              className="console-pane overflow-x-auto"
              data-pane-label="~/log"
            >
              <table className="w-full text-sm text-left">
                <caption className="sr-only">Transaction history</caption>
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 py-2.5 font-medium text-xs uppercase tracking-wider text-foreground-muted">
                      <span className="treasury-label">Date</span>
                      <span className="console-label">ts</span>
                    </th>
                    <th className="px-3 py-2.5 font-medium text-xs uppercase tracking-wider text-foreground-muted">
                      Type
                    </th>
                    <th className="px-3 py-2.5 font-medium text-xs uppercase tracking-wider text-foreground-muted">
                      <span className="treasury-label">Transaction ID</span>
                      <span className="console-label">tx_id</span>
                    </th>
                    <th className="px-3 py-2.5 font-medium text-xs uppercase tracking-wider text-foreground-muted">
                      Status
                    </th>
                    <th className="px-3 py-2.5 font-medium text-xs uppercase tracking-wider text-foreground-muted">
                      <span className="treasury-label">Network</span>
                      <span className="console-label">net</span>
                    </th>
                    <th className="px-3 py-2.5 font-medium text-xs uppercase tracking-wider text-foreground-muted">
                      <span className="treasury-label">HashScan</span>
                      <span className="console-label">scan</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((entry) => (
                    <tr
                      key={entry.id}
                      className="hover:bg-surface-recessed/50 transition-colors"
                    >
                      <td className="px-3 py-3 whitespace-nowrap text-foreground-muted">
                        {formatDate(entry.timestamp)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-foreground font-medium">
                        {txTypeLabel(entry.transactionType)}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <span
                            className="font-mono text-xs text-foreground-muted"
                            title={entry.transactionId}
                          >
                            {truncateTxId(entry.transactionId)}
                          </span>
                          <CopyButton
                            text={entry.transactionId}
                            label="Transaction ID"
                            size="sm"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <StatusBadge status={entry.status} />
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <NetworkChip network={entry.network} />
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <a
                          href={getHashScanTransactionUrl(
                            entry.transactionId,
                            entry.network as 'testnet' | 'mainnet'
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-accent hover:underline text-xs font-medium"
                        >
                          View
                          <Icon name="open_in_new" size={14} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary footer — flat row, not a card. */}
            <p className="mt-3 text-xs text-foreground-subtle">
              Showing {filtered.length} of {entries.length} transaction
              {entries.length !== 1 ? 's' : ''}.
              {entries.length > 0 && <> Stored locally in this browser only.</>}
            </p>
          </>
        )}

        {/* About details — quiet disclosure at the bottom. Hidden in
            console (engineers know what localStorage is). */}
        <div className="console-hide mt-12 pt-6 border-t border-border">
          <details className="text-sm text-foreground-muted">
            <summary className="cursor-pointer font-medium text-foreground-muted hover:text-foreground transition-colors">
              About transaction history
            </summary>
            <ul className="list-disc list-inside space-y-1 mt-3">
              <li>
                History is stored in your browser&apos;s localStorage and never
                sent to any server.
              </li>
              <li>
                Only transactions created or signed from this browser are recorded.
              </li>
              <li>
                Clearing your browser data will remove this history permanently.
              </li>
              <li>
                Use &quot;Export CSV&quot; to save a copy before clearing.
              </li>
            </ul>
          </details>
        </div>
      </section>
      <Footer variant="compact" />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

/**
 * Empty state for the "no transactions ever" case. Dual CTAs match the
 * landing page's two-audience framing — Join is the primary path (most
 * arrivals are joiners), Create is the secondary ghost. Replaces the
 * previous bordered-card centered-clock-icon layout.
 */
function EmptyState() {
  return (
    <div className="py-16 sm:py-20 max-w-md">
      <Icon name="receipt_long" size={48} className="text-foreground-subtle mb-4" />
      <h2 className="font-heading text-xl font-bold text-foreground mb-2">
        No transactions yet
      </h2>
      <p className="text-foreground-muted leading-relaxed mb-6">
        Transactions you create or participate in will appear here. History
        is stored locally in your browser and never leaves your device.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/join"
          className="cmd hero-cta-primary inline-flex items-center justify-center px-5 py-2.5 rounded-md text-sm font-semibold bg-accent text-accent-fg hover:bg-accent-hover transition-colors"
        >
          Join session
          <span className="treasury-label ml-2 opacity-70">→</span>
        </Link>
        <Link
          href="/create"
          className="cmd inline-flex items-center justify-center px-5 py-2.5 rounded-md text-sm font-semibold text-foreground border border-border-strong hover:bg-surface-recessed transition-colors"
        >
          Create session
        </Link>
      </div>
    </div>
  );
}

/**
 * "No matches" state — entries exist but the active filters
 * exclude them all. Distinct from the no-history-ever empty
 * state; the action here is "broaden your filters", not
 * "go start something".
 */
function NoMatchesState() {
  return (
    <div className="py-12 max-w-md">
      <Icon name="filter_alt_off" size={36} className="text-foreground-subtle mb-3" />
      <h2 className="font-heading text-lg font-bold text-foreground mb-1">
        No matches
      </h2>
      <p className="text-foreground-muted text-sm leading-relaxed">
        No transactions match the current filters. Try widening the date range
        or selecting a different status.
      </p>
    </div>
  );
}

/**
 * Network chip in the table column. Mainnet keeps the success-soft
 * tint (real-money signal); testnet now uses a true neutral
 * (surface-recessed + foreground-muted) instead of warning-yellow,
 * which previously misappropriated the warning palette to
 * communicate "non-mainnet" — a metadata distinction, not a status.
 */
function NetworkChip({ network }: { network: string }) {
  const isMainnet = network === 'mainnet';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono ${
        isMainnet
          ? 'bg-success-soft text-success-soft-fg'
          : 'bg-surface-recessed text-foreground-muted'
      }`}
    >
      {network}
    </span>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block w-3 h-3 rounded-full border-2 border-current border-r-transparent animate-spin"
      aria-hidden="true"
    />
  );
}
