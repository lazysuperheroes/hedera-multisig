'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useTxHistory, TxHistoryEntry } from '../../hooks/useTxHistory';
import { CopyButton } from '../../components/CopyButton';
import { Footer } from '../../components/Footer';
import { getHashScanTransactionUrl } from '../../lib/mirror-node';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type StatusFilter = 'ALL' | 'SUCCESS' | 'FAILURE' | 'PENDING';
type DateRange = 'all' | '24h' | '7d' | '30d';

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  all: 'All Time',
  '24h': 'Last 24 Hours',
  '7d': 'Last 7 Days',
  '30d': 'Last 30 Days',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateTxId(txId: string): string {
  if (txId.length <= 24) return txId;
  return `${txId.slice(0, 14)}...${txId.slice(-8)}`;
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
// Status badge component
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: TxHistoryEntry['status'] }) {
  const classes: Record<TxHistoryEntry['status'], string> = {
    SUCCESS:
      'bg-success-soft text-success-soft-fg border border-success/40',
    FAILURE:
      'bg-destructive-soft text-destructive-soft-fg border border-destructive/40',
    PENDING:
      'bg-warning-soft text-warning-soft-fg border border-warning/40',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${classes[status]}`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function HistoryPage() {
  const { entries, clearHistory, exportCsv } = useTxHistory();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [confirmClear, setConfirmClear] = useState(false);

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

  // ---- Shared Tailwind tokens ----
  const selectClass =
    'px-3 py-2 border border-border-strong rounded-lg ' +
    'bg-white dark:bg-surface text-foreground text-sm ' +
    'focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <main className="min-h-screen p-4 sm:p-8 bg-background">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="page-hero font-heading text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Transaction history
          </h1>
          <p className="console-hide mt-2 text-foreground-muted">
            Transactions this browser participated in.
          </p>
          {/* Treasury keeps the explicit "stored in browser only" warning;
              console operators know browser storage is browser storage. */}
          <div className="console-hide mt-4 border-l-2 border-info/60 bg-info-soft/60 pl-4 py-2 text-xs text-info-soft-fg max-w-2xl">
            <strong>Stored in this browser only.</strong> Switching devices, clearing site data, or using private browsing will reset this list. Use the CSV export below to keep a record.
          </div>
        </div>

        <div className="space-y-6">

        {/* Controls row — gets ~/filters pane chrome in console */}
        <div
          className="console-pane bg-surface rounded-lg shadow-sm border border-border p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3"
          data-pane-label="~/filters"
        >
          {/* Status filter */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="status-filter"
              className="text-sm font-medium text-foreground-muted whitespace-nowrap"
            >
              Status:
            </label>
            <select
              id="status-filter"
              className={selectClass}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="ALL">All</option>
              <option value="SUCCESS">Success</option>
              <option value="FAILURE">Failure</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>

          {/* Date range filter */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="date-range"
              className="text-sm font-medium text-foreground-muted whitespace-nowrap"
            >
              Period:
            </label>
            <select
              id="date-range"
              className={selectClass}
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRange)}
            >
              {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map((k) => (
                <option key={k} value={k}>
                  {DATE_RANGE_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportCsv}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-surface-recessed text-foreground-muted hover:bg-border dark:hover:bg-foreground-subtle transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Export CSV
            </button>

            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                disabled={entries.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-destructive-soft text-destructive-soft-fg hover:bg-destructive-soft dark:hover:bg-destructive-soft transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                Clear History
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-destructive">
                  Are you sure?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    clearHistory();
                    setConfirmClear(false);
                  }}
                  className="cmd px-3 py-1.5 text-sm font-medium rounded-lg bg-destructive text-white hover:bg-destructive transition-colors"
                >
                  Yes, delete all
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-border text-foreground-muted hover:bg-border-strong transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Table / empty state */}
        {filtered.length === 0 ? (
          <div className="bg-surface rounded-lg shadow-sm border border-border p-12 text-center">
            <svg
              className="w-16 h-16 mx-auto text-foreground-subtle mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h2 className="text-xl font-semibold text-foreground-muted mb-2">
              No transactions yet
            </h2>
            <p className="text-foreground-subtle max-w-md mx-auto">
              Transactions you create or participate in will appear here.
              History is stored locally in your browser and never leaves your
              device.
            </p>
            <Link
              href="/create"
              className="cmd inline-block mt-6 px-6 py-3 bg-accent text-white font-semibold rounded-lg hover:bg-accent-hover transition-colors"
            >
              Create a Transaction
            </Link>
          </div>
        ) : (
          <div
            className="console-pane bg-surface rounded-lg shadow-sm border border-border overflow-hidden"
            data-pane-label="~/log"
          >
            {/* Scrollable table wrapper */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <caption className="sr-only">Transaction history</caption>
                <thead>
                  <tr className="border-b border-border bg-surface-recessed">
                    <th className="px-4 py-3 font-medium text-foreground-muted">
                      <span className="treasury-label">Date</span>
                      <span className="console-label">ts</span>
                    </th>
                    <th className="px-4 py-3 font-medium text-foreground-muted">
                      Type
                    </th>
                    <th className="px-4 py-3 font-medium text-foreground-muted">
                      <span className="treasury-label">Transaction ID</span>
                      <span className="console-label">tx_id</span>
                    </th>
                    <th className="px-4 py-3 font-medium text-foreground-muted">
                      Status
                    </th>
                    <th className="px-4 py-3 font-medium text-foreground-muted">
                      <span className="treasury-label">Network</span>
                      <span className="console-label">net</span>
                    </th>
                    <th className="px-4 py-3 font-medium text-foreground-muted">
                      <span className="treasury-label">HashScan</span>
                      <span className="console-label">scan</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filtered.map((entry) => (
                    <tr
                      key={entry.id}
                      className="hover:bg-surface-recessed dark:hover:bg-surface-recessed transition-colors"
                    >
                      {/* Date */}
                      <td className="px-4 py-3 whitespace-nowrap text-foreground-muted">
                        {formatDate(entry.timestamp)}
                      </td>

                      {/* Type */}
                      <td className="px-4 py-3 whitespace-nowrap text-foreground font-medium">
                        {txTypeLabel(entry.transactionType)}
                      </td>

                      {/* Transaction ID */}
                      <td className="px-4 py-3 whitespace-nowrap">
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

                      {/* Status */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={entry.status} />
                      </td>

                      {/* Network */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                            entry.network === 'mainnet'
                              ? 'bg-success-soft text-success-soft-fg'
                              : 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300'
                          }`}
                        >
                          {entry.network}
                        </span>
                      </td>

                      {/* HashScan link */}
                      <td className="px-4 py-3 whitespace-nowrap">
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
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            />
                          </svg>
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary footer */}
            <div className="px-4 py-3 border-t border-border bg-surface-recessed text-xs text-foreground-subtle">
              Showing {filtered.length} of {entries.length} transaction
              {entries.length !== 1 ? 's' : ''}.
              {entries.length > 0 && (
                <> Data stored locally in this browser only.</>
              )}
            </div>
          </div>
        )}

        {/* Info — lighter treatment, separated from main content. Hidden in
            console (engineers know what localStorage is). */}
        <div className="console-hide mt-6 border-t border-border pt-6">
          <details className="text-sm text-foreground-muted">
            <summary className="cursor-pointer font-medium text-foreground-muted">
              About Transaction History
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
        </div>
      </div>
      <Footer variant="compact" />
    </main>
  );
}
