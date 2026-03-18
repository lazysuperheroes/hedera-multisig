'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useTxHistory, TxHistoryEntry } from '../../hooks/useTxHistory';
import { CopyButton } from '../../components/CopyButton';
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
      'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 border border-green-300 dark:border-green-700',
    FAILURE:
      'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-700',
    PENDING:
      'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-700',
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
    'px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg ' +
    'bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm ' +
    'focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <main className="min-h-screen flex flex-col items-center p-4 sm:p-8 bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950">
      <div className="max-w-5xl w-full space-y-6 py-4">
        {/* Header */}
        <div className="text-center space-y-2">
          <Link
            href="/"
            className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
          >
            &larr; Back to Home
          </Link>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
            Transaction History
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Locally stored transactions this browser participated in.
          </p>
        </div>

        {/* Controls row */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Status filter */}
          <div className="flex items-center gap-2">
            <label
              htmlFor="status-filter"
              className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap"
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
              className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap"
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
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
                <span className="text-sm text-red-600 dark:text-red-400">
                  Are you sure?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    clearHistory();
                    setConfirmClear(false);
                  }}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  Yes, delete all
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Table / empty state */}
        {filtered.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-12 text-center">
            <svg
              className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4"
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
            <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
              No transactions yet
            </h2>
            <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
              Transactions you create or participate in will appear here.
              History is stored locally in your browser and never leaves your
              device.
            </p>
            <Link
              href="/create"
              className="inline-block mt-6 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
            >
              Create a Transaction
            </Link>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
            {/* Scrollable table wrapper */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                      Date
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                      Type
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                      Transaction ID
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                      Status
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                      Network
                    </th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">
                      HashScan
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {filtered.map((entry) => (
                    <tr
                      key={entry.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      {/* Date */}
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700 dark:text-gray-300">
                        {formatDate(entry.timestamp)}
                      </td>

                      {/* Type */}
                      <td className="px-4 py-3 whitespace-nowrap text-gray-800 dark:text-gray-200 font-medium">
                        {txTypeLabel(entry.transactionType)}
                      </td>

                      {/* Transaction ID */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <span
                            className="font-mono text-xs text-gray-700 dark:text-gray-300"
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
                              ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300'
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
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-xs font-medium"
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
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400">
              Showing {filtered.length} of {entries.length} transaction
              {entries.length !== 1 ? 's' : ''}.
              {entries.length > 0 && (
                <> Data stored locally in this browser only.</>
              )}
            </div>
          </div>
        )}

        {/* Info box */}
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
          <h3 className="font-semibold text-blue-900 dark:text-blue-200 mb-2">
            About Transaction History
          </h3>
          <ul className="list-disc list-inside space-y-1 text-sm text-blue-800 dark:text-blue-300">
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
        </div>
      </div>
    </main>
  );
}
