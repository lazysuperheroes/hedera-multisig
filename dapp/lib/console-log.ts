/**
 * Console-log event bus — lightweight, no dependencies.
 *
 * Any code path that wants to surface activity to the ConsoleLog drawer
 * dispatches a CustomEvent on `window`. The drawer subscribes once and
 * maintains a rolling buffer.
 *
 * Why a global event bus instead of a Zustand/Redux store?
 *   - Zero footprint when console register isn't active (no subscribers)
 *   - No prop drilling
 *   - Hooks (useWallet etc.) can emit without depending on UI components
 *   - Events are append-only — no state to share
 */

export type ConsoleLogLevel = 'info' | 'warn' | 'error' | 'success' | 'debug';

export interface ConsoleLogEntry {
  /** Unix ms timestamp */
  ts: number;
  level: ConsoleLogLevel;
  /** Short source label — `wallet`, `ws`, `mirror`, `tx`, etc. */
  source: string;
  /** One-line summary for the log row */
  message: string;
  /** Optional structured data — rendered as inline JSON in the drawer */
  data?: Record<string, unknown>;
}

const EVENT_NAME = 'console-log';

/**
 * Emit a console-log entry. Safe to call from any code path; SSR-safe
 * (no-op when window is undefined).
 */
export function emitConsoleLog(entry: Omit<ConsoleLogEntry, 'ts'>): void {
  if (typeof window === 'undefined') return;
  const detail: ConsoleLogEntry = { ...entry, ts: Date.now() };
  window.dispatchEvent(new CustomEvent<ConsoleLogEntry>(EVENT_NAME, { detail }));
}

/**
 * Subscribe to console-log events. Returns an unsubscribe fn.
 */
export function subscribeConsoleLog(
  handler: (entry: ConsoleLogEntry) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const wrapper = (e: Event) => {
    const ce = e as CustomEvent<ConsoleLogEntry>;
    handler(ce.detail);
  };
  window.addEventListener(EVENT_NAME, wrapper);
  return () => window.removeEventListener(EVENT_NAME, wrapper);
}
