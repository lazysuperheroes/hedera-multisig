/**
 * LandingOnboarding — first-run UX surfaces for the landing page.
 *
 * Owns visit tracking + two prompts:
 *   1. "How this works" — shown on visits 1–2, dismissible. After dismiss
 *      it doesn't reappear. Treasury operators read it once and move on.
 *   2. "Try Console mode" — shown only when visits >= 3 AND user has
 *      never tried Console AND user is currently in treasury register.
 *      Dismissible. Never auto-suggested below visit 3 — gentle invite,
 *      not nag.
 *
 * Bumps the visit counter on mount. SSR-safe via useOnboarding.
 */

'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { useOnboarding } from '../hooks/useOnboarding';
import { useTheme } from '../contexts/ThemeContext';

export function LandingOnboarding() {
  const { state, bumpVisit, dismissPrompt } = useOnboarding();
  const { register, setRegister } = useTheme();
  const bumpedRef = useRef(false);

  // Bump visit counter once on mount
  useEffect(() => {
    if (bumpedRef.current) return;
    bumpedRef.current = true;
    bumpVisit();
  }, [bumpVisit]);

  const showHowThisWorks = !state.dismissed.includes('how-this-works');
  const showConsoleNudge =
    state.visits >= 3 &&
    !state.triedConsole &&
    !state.dismissed.includes('try-console') &&
    register === 'treasury';

  return (
    <>
      {showHowThisWorks && (
        <div className="animate-slide-up delay-300 mt-10 max-w-2xl border-l-2 border-accent/30 pl-5 py-1 text-sm text-foreground-muted leading-relaxed relative">
          <button
            onClick={() => dismissPrompt('how-this-works')}
            aria-label="Dismiss intro"
            className="
              absolute top-0 right-0 -mt-1 -mr-1 w-7 h-7 inline-flex items-center justify-center
              text-foreground-subtle hover:text-foreground hover:bg-surface-recessed rounded-md transition-colors
            "
          >
            ×
          </button>
          <span className="font-semibold text-foreground">How this works.</span>{' '}
          We host the user interface;{' '}
          <strong className="text-foreground">you (or a teammate) host the coordinator</strong>{' '}
          via{' '}
          <code className="text-xs font-mono bg-surface-recessed px-1.5 py-0.5 rounded">
            npx hedera-multisig server
          </code>
          . The dApp connects to that coordinator URL — Vercel never sees your transactions.{' '}
          <Link href="/learn" className="text-accent hover:underline whitespace-nowrap">
            New here? Try the walkthrough →
          </Link>
        </div>
      )}

      {showConsoleNudge && (
        <div
          role="note"
          className="
            animate-slide-up mt-6 max-w-2xl
            border border-accent/40 bg-accent-soft/40
            rounded-md px-4 py-3 text-sm text-foreground-muted
            flex items-start gap-3
          "
        >
          <span className="font-mono text-accent font-bold flex-shrink-0">$</span>
          <div className="flex-1">
            <span className="text-foreground font-medium">Tip — </span>
            you&apos;ve been here a few times. There&apos;s a denser{' '}
            <button
              onClick={() => {
                setRegister('console');
                dismissPrompt('try-console');
              }}
              className="text-accent font-semibold hover:underline"
            >
              Console mode
            </button>{' '}
            for engineer / power-user views. Try it out — toggle back any time
            from the top bar.
          </div>
          <button
            onClick={() => dismissPrompt('try-console')}
            aria-label="Dismiss tip"
            className="
              flex-shrink-0 w-6 h-6 inline-flex items-center justify-center
              text-foreground-subtle hover:text-foreground transition-colors
            "
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
