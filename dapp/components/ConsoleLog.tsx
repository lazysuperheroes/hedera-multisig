/**
 * ConsoleLog — bottom drawer streaming connection / event log.
 *
 * Visible only in console register. Three states:
 *   - 'closed'  ~32px header strip only. Last log line shown inline.
 *   - 'tease'   ~120px (default). Header + last 5-6 entries visible
 *               without dominating the viewport.
 *   - 'open'    max-h-[40vh]. Full scrollable drawer.
 *
 * Header click cycles closed → tease → open → closed. A × button on
 * the right fully closes from any state. Body gets matching
 * padding-bottom so content never sits under the drawer.
 *
 * Subscribes to the global event bus (lib/console-log.ts) and keeps a
 * rolling 200-entry buffer.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { subscribeConsoleLog, emitConsoleLog, type ConsoleLogEntry, type ConsoleLogLevel } from '../lib/console-log';
import { useOnboarding } from '../hooks/useOnboarding';

const MAX_ENTRIES = 200;
const STORAGE_KEY_STATE = 'console-log-state';

type DrawerState = 'closed' | 'tease' | 'open';

const STATE_HEIGHTS: Record<DrawerState, string> = {
  closed: '2.25rem',  // header strip only (~36px)
  tease:  '7.5rem',   // header + ~6 lines (~120px)
  open:   '42vh',     // full drawer
};

function isValidState(s: string | null): s is DrawerState {
  return s === 'closed' || s === 'tease' || s === 'open';
}

function nextState(s: DrawerState): DrawerState {
  return s === 'closed' ? 'tease' : s === 'tease' ? 'open' : 'closed';
}

export function ConsoleLog() {
  const { register } = useTheme();
  const { state: onboarding, markTriedConsole } = useOnboarding();
  const [entries, setEntries] = useState<ConsoleLogEntry[]>([]);
  const [drawerState, setDrawerState] = useState<DrawerState>('closed');
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);
  const welcomeEmittedRef = useRef(false);

  // Load saved state. Default to 'tease' on first console activation.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_STATE);
      if (isValidState(stored)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDrawerState(stored);
      } else if (register === 'console') {
        // Default-tease the first time a user lands in console
        setDrawerState('tease');
      }
    } catch {}
  }, [register]);

  // First-time welcome: emit a multi-line init sequence so the drawer
  // teaches the user what it streams + how to control it. Idempotent
  // via onboarding.triedConsole + a session-local ref.
  useEffect(() => {
    if (
      register === 'console' &&
      !onboarding.triedConsole &&
      !welcomeEmittedRef.current
    ) {
      welcomeEmittedRef.current = true;
      // Stagger the welcome so it reads like an init sequence.
      const lines: Array<Omit<ConsoleLogEntry, 'ts'>> = [
        { level: 'info',  source: 'console', message: 'register=console initialized' },
        { level: 'debug', source: 'console', message: 'streaming wallet · ws · mirror events (rolling 200-entry buffer)' },
        { level: 'info',  source: 'console', message: 'try connecting a wallet, joining a session, or building a transaction — events appear here' },
        { level: 'debug', source: 'console', message: 'click the header to cycle: closed → tease → open · × to close fully' },
        { level: 'info',  source: 'console', message: 'switch back to treasury anytime via the toggle in the top bar' },
      ];
      lines.forEach((line, i) => setTimeout(() => emitConsoleLog(line), 60 * i));
      markTriedConsole();
    }
  }, [register, onboarding.triedConsole, markTriedConsole]);

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

  // Auto-scroll on new entries when drawer is showing content
  useEffect(() => {
    if (drawerState !== 'closed' && scrollRef.current && wasOpenRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    wasOpenRef.current = drawerState !== 'closed';
  }, [entries, drawerState]);

  // Reserve body padding so content doesn't sit under the drawer.
  // Cleared on register switch / unmount.
  useEffect(() => {
    if (register !== 'console') {
      document.body.style.paddingBottom = '';
      return;
    }
    document.body.style.paddingBottom = STATE_HEIGHTS[drawerState];
    return () => {
      document.body.style.paddingBottom = '';
    };
  }, [register, drawerState]);

  const cycle = () => {
    const next = nextState(drawerState);
    setDrawerState(next);
    try { localStorage.setItem(STORAGE_KEY_STATE, next); } catch {}
  };

  const close = () => {
    setDrawerState('closed');
    try { localStorage.setItem(STORAGE_KEY_STATE, 'closed'); } catch {}
  };

  // Render nothing in treasury register
  if (register !== 'console') return null;

  const showBody = drawerState !== 'closed';
  const bodyHeight = drawerState === 'tease' ? 'max-h-[5.5rem]' : 'max-h-[36vh]';

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
      {/* Drawer header — clickable to cycle states */}
      <div className="flex items-center justify-between gap-3 px-4 py-1.5 border-b border-border">
        <button
          onClick={cycle}
          className="
            flex items-center gap-3 text-left text-foreground-muted hover:text-foreground
            transition-colors flex-1 min-w-0
          "
          aria-expanded={drawerState !== 'closed'}
          aria-controls="console-log-body"
          aria-label={`Console log. Currently ${drawerState}. Click to cycle.`}
        >
          <span className="text-accent font-bold">$</span>
          <span className="uppercase tracking-wider text-[10px] flex-shrink-0">console.log</span>
          <span className="text-foreground-subtle tabular-nums flex-shrink-0">
            {entries.length}{entries.length === MAX_ENTRIES ? '+' : ''} entries
          </span>
          {drawerState === 'closed' && entries.length > 0 && (
            <span className="text-foreground-subtle truncate hidden sm:inline">
              · {entries[entries.length - 1].source}: {entries[entries.length - 1].message}
            </span>
          )}
          <span className="ml-auto text-foreground-subtle text-[10px] uppercase tracking-wider">
            {drawerState}
          </span>
          <span className="text-foreground-subtle">{stateGlyph(drawerState)}</span>
        </button>
        {drawerState !== 'closed' && (
          <button
            onClick={close}
            aria-label="Close console log"
            className="
              flex-shrink-0 w-6 h-6 inline-flex items-center justify-center
              text-foreground-subtle hover:text-foreground transition-colors
            "
          >
            ×
          </button>
        )}
      </div>

      {/* Drawer body */}
      {showBody && (
        <div
          id="console-log-body"
          ref={scrollRef}
          className={`overflow-y-auto px-4 py-2 bg-surface-recessed ${bodyHeight}`}
        >
          {entries.length === 0 ? (
            <p className="text-foreground-subtle italic py-2">
              # waiting for events. connect a wallet, join a session, or build a transaction.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {entries.map((entry, idx) => (
                <LogRow key={`${entry.ts}-${idx}`} entry={entry} />
              ))}
            </ul>
          )}
          {/* Footer with clear button — only in 'open' state to save space in tease */}
          {entries.length > 0 && drawerState === 'open' && (
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

function stateGlyph(s: DrawerState): string {
  return s === 'closed' ? '▲' : s === 'tease' ? '◆' : '▼';
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
