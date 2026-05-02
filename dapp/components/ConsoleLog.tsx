/**
 * ConsoleLog — bottom drawer streaming connection / event log.
 *
 * Visible only in console register. Subscribes to the global event bus
 * (lib/console-log.ts) and maintains a rolling buffer of the most
 * recent N entries. Toggleable open/closed; persists state across page
 * navigations via localStorage.
 *
 * Design intent: in console register, the dApp should look like a
 * running shell session. The drawer makes wallet/WS/mirror activity
 * visible the way a terminal makes process activity visible.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { subscribeConsoleLog, type ConsoleLogEntry, type ConsoleLogLevel } from '../lib/console-log';

const MAX_ENTRIES = 200;
const STORAGE_KEY_OPEN = 'console-log-open';

export function ConsoleLog() {
  const { register } = useTheme();
  const [entries, setEntries] = useState<ConsoleLogEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  // Load saved open/closed state. Hydration setState — same canonical
  // pattern as ThemeContext (localStorage isn't available on the server,
  // so we sync after mount).
  //
  // Default-open in console register the first time a user lands here:
  // engineer-tool registers should announce "this drawer exists" by
  // showing it. Treasury never renders this component at all.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_OPEN);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === '1') setIsOpen(true);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      else if (stored === null && register === 'console') setIsOpen(true);
    } catch {}
  }, [register]);

  // Subscribe to log events
  useEffect(() => {
    const unsubscribe = subscribeConsoleLog((entry) => {
      setEntries((prev) => {
        const next = [...prev, entry];
        if (next.length > MAX_ENTRIES) next.splice(0, next.length - MAX_ENTRIES);
        return next;
      });
    });
    return unsubscribe;
  }, []);

  // Auto-scroll to bottom on new entries when open
  useEffect(() => {
    if (isOpen && scrollRef.current && wasOpenRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    wasOpenRef.current = isOpen;
  }, [entries, isOpen]);

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    try { localStorage.setItem(STORAGE_KEY_OPEN, next ? '1' : '0'); } catch {}
  };

  // Render nothing in treasury register
  if (register !== 'console') return null;

  return (
    <div
      className="
        fixed bottom-0 left-0 right-0 z-30
        font-mono text-[12px]
        bg-background border-t-2 border-accent
        shadow-[0_-2px_12px_rgba(0,0,0,0.15)]
      "
      role="log"
      aria-label="Console log"
      aria-live="polite"
    >
      {/* Drawer header — always visible, clickable to toggle */}
      <button
        onClick={toggle}
        className="
          w-full flex items-center justify-between gap-3 px-4 py-1.5
          text-left text-foreground-muted hover:text-foreground
          border-b border-border transition-colors
        "
        aria-expanded={isOpen}
        aria-controls="console-log-body"
      >
        <span className="flex items-center gap-3">
          <span className="text-accent font-bold">$</span>
          <span className="uppercase tracking-wider text-[10px]">console.log</span>
          <span className="text-foreground-subtle tabular-nums">
            {entries.length}{entries.length === MAX_ENTRIES ? '+' : ''} entries
          </span>
        </span>
        <span className="flex items-center gap-3 text-[11px]">
          {!isOpen && entries.length > 0 && (
            <span className="text-foreground-subtle truncate max-w-[40vw] hidden sm:inline">
              {entries[entries.length - 1].source}: {entries[entries.length - 1].message}
            </span>
          )}
          <span className="text-foreground-subtle">{isOpen ? '▼' : '▲'}</span>
        </span>
      </button>

      {/* Drawer body — only rendered when open */}
      {isOpen && (
        <div
          id="console-log-body"
          ref={scrollRef}
          className="max-h-[40vh] overflow-y-auto px-4 py-2 bg-surface-recessed"
        >
          {entries.length === 0 ? (
            <p className="text-foreground-subtle italic py-4">
              # waiting for events. connect a wallet, join a session, or build a transaction.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {entries.map((entry, idx) => (
                <LogRow key={`${entry.ts}-${idx}`} entry={entry} />
              ))}
            </ul>
          )}
          {/* Footer with clear button */}
          {entries.length > 0 && (
            <div className="mt-3 pt-2 border-t border-border flex items-center gap-3 text-[11px]">
              <button
                onClick={() => setEntries([])}
                className="text-foreground-muted hover:text-destructive transition-colors"
              >
                $ clear
              </button>
              <span className="text-foreground-subtle">
                {entries.length} of {MAX_ENTRIES} max
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LogRow({ entry }: { entry: ConsoleLogEntry }) {
  const time = formatTime(entry.ts);
  const colour = LEVEL_COLOURS[entry.level];

  return (
    <li className="flex items-start gap-3">
      <span className="text-foreground-subtle tabular-nums flex-shrink-0">{time}</span>
      <span className={`uppercase tracking-wider text-[10px] flex-shrink-0 w-12 ${colour}`}>
        {entry.level}
      </span>
      <span className="text-accent flex-shrink-0">{entry.source}</span>
      <span className="text-foreground flex-1 break-all">
        {entry.message}
        {entry.data && (
          <span className="text-foreground-subtle ml-2">
            {JSON.stringify(entry.data)}
          </span>
        )}
      </span>
    </li>
  );
}

const LEVEL_COLOURS: Record<ConsoleLogLevel, string> = {
  debug: 'text-foreground-subtle',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-destructive',
  success: 'text-success',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
