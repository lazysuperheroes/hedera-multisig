'use client';

import { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TxHistoryEntry {
  id: string;
  timestamp: string; // ISO date
  transactionId: string;
  transactionType: string; // e.g. 'TransferTransaction'
  status: 'SUCCESS' | 'FAILURE' | 'PENDING';
  network: string; // 'testnet' or 'mainnet'
  sessionId?: string;
  signers?: string[]; // sanitized public key previews
  details?: Record<string, unknown>; // transaction-specific details
}

const STORAGE_KEY = 'hedera_multisig_tx_history';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadEntries(): TxHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as TxHistoryEntry[];
  } catch {
    return [];
  }
}

function persistEntries(entries: TxHistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTxHistory() {
  const [entries, setEntries] = useState<TxHistoryEntry[]>([]);

  // Load from localStorage on mount (window-only, must run after mount to avoid SSR mismatch)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage
    setEntries(loadEntries());
  }, []);

  /** Re-read localStorage. Use after standalone helpers (saveTxHistoryEntry,
   * updateTxHistoryEntryStatus) write outside the hook. */
  const refresh = useCallback(() => {
    setEntries(loadEntries());
  }, []);

  /** Add a new entry (id is auto-generated). */
  const addEntry = useCallback(
    (entry: Omit<TxHistoryEntry, 'id'>) => {
      const newEntry: TxHistoryEntry = {
        ...entry,
        id:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : String(Date.now()),
      };
      setEntries((prev) => {
        const updated = [newEntry, ...prev];
        persistEntries(updated);
        return updated;
      });
    },
    []
  );

  /** Clear all history entries. */
  const clearHistory = useCallback(() => {
    setEntries([]);
    persistEntries([]);
  }, []);

  /** Generate a CSV string and trigger a file download. */
  const exportCsv = useCallback(() => {
    const rows = entries.length > 0 ? entries : loadEntries();
    if (rows.length === 0) return;

    const headers = [
      'Date',
      'Transaction ID',
      'Type',
      'Status',
      'Network',
      'Session ID',
      'Signers',
    ];

    const csvRows = [
      headers.join(','),
      ...rows.map((e) =>
        [
          `"${e.timestamp}"`,
          `"${e.transactionId}"`,
          `"${e.transactionType}"`,
          `"${e.status}"`,
          `"${e.network}"`,
          `"${e.sessionId || ''}"`,
          `"${(e.signers || []).join('; ')}"`,
        ].join(',')
      ),
    ];

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hedera-multisig-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [entries]);

  return { entries, addEntry, clearHistory, exportCsv, refresh };
}

// ---------------------------------------------------------------------------
// Standalone helper (for use outside React components, e.g. in create page)
// ---------------------------------------------------------------------------

/**
 * Save a transaction history entry directly to localStorage.
 * Use this when a React hook is impractical (e.g. inside a callback that
 * already has its own state management).
 */
export function saveTxHistoryEntry(entry: Omit<TxHistoryEntry, 'id'>): void {
  const existing = loadEntries();
  const newEntry: TxHistoryEntry = {
    ...entry,
    id:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()),
  };
  const updated = [newEntry, ...existing];
  persistEntries(updated);
}

/**
 * Update an existing history entry by transactionId. Used to flip a PENDING
 * entry to SUCCESS / FAILURE once the network settles. No-op if no entry
 * matches. Patch fields are shallow-merged into `details`.
 */
export function updateTxHistoryEntryStatus(
  transactionId: string,
  status: TxHistoryEntry['status'],
  detailsPatch?: Record<string, unknown>
): void {
  if (!transactionId || transactionId === 'unknown') return;
  const entries = loadEntries();
  let mutated = false;
  const updated = entries.map((e) => {
    if (e.transactionId !== transactionId) return e;
    if (e.status === status && !detailsPatch) return e;
    mutated = true;
    return {
      ...e,
      status,
      details: detailsPatch ? { ...(e.details || {}), ...detailsPatch } : e.details,
    };
  });
  if (mutated) persistEntries(updated);
}
