/**
 * ConnectingBanner
 *
 * Visible feedback during the silent gap between "wallet connected"
 * and "WebSocket authenticated". Default is ~1-3 seconds while AUTH
 * round-trips through the ngrok tunnel; without feedback users see a
 * blank-looking page and assume something broke.
 *
 * Shows a spinner plus a rotating message: the first few are concrete
 * (what the system is actually doing), the later ones drift whimsical
 * (carrier pigeons, reticulating splines) so a long wait stays
 * entertaining instead of ominous. Unmounts as soon as
 * `signingSession.state.connected` flips true.
 */

'use client';

import { useEffect, useState } from 'react';

// Later messages drift a little whimsical so a long wait stays
// engaging instead of ominous. The first message is built dynamically
// from `accountId` so the user immediately sees that we recognized
// their wallet — feedback they were missing when this lived in
// transient toasts that often rendered after success.
const FOLLOW_ON_MESSAGES = [
  'Negotiating with the coordinator...',
  'Validating your public key against the eligibility list...',
  'Coaxing the carrier pigeon through the ngrok tunnel...',
  'Discombobulating the signing channel...',
  'Reticulating splines...',
  'Convincing TCP that yes, we’re still here...',
  'Almost there — the cosmic rays are misbehaving today.',
] as const;

const ROTATION_MS = 1400;

export interface ConnectingBannerProps {
  /** Wallet account already paired (rendered for context). */
  accountId: string | null | undefined;
}

export function ConnectingBanner({ accountId }: ConnectingBannerProps) {
  // Build the message list inside the component so the wallet account
  // appears verbatim in the first frame the user sees. Index 0 is the
  // wallet-aware "trying your wallet (acct)" message; subsequent
  // indices walk through FOLLOW_ON_MESSAGES.
  const firstMessage = accountId
    ? `Trying your wallet (${accountId})...`
    : 'Trying your wallet...';
  const messages = [firstMessage, ...FOLLOW_ON_MESSAGES];

  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setMessageIndex((i) => Math.min(i + 1, messages.length - 1));
    }, ROTATION_MS);
    return () => clearInterval(id);
  }, [messages.length]);

  // Left-border callout matching /join's trust panels and /history's
  // storage-locality callout. Drops the previous bordered-card chrome
  // (border-2 border-info/40 rounded-lg p-6) — the soft-bg + accent
  // left-border carries the "active feedback" signal without adding
  // card weight.
  return (
    <div
      className="border-l-2 border-info bg-info-soft/30 pl-4 py-3 rounded-r-md"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <span
          className="inline-block w-4 h-4 mt-0.5 rounded-full border-2 border-info border-r-transparent animate-spin flex-shrink-0"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-info-soft-fg">
            Connecting to coordinator
          </p>
          {/* aria-live above announces the rotating message to screen readers */}
          <p className="text-xs text-info-soft-fg/90 mt-0.5">
            {messages[messageIndex]}
          </p>
        </div>
      </div>
    </div>
  );
}
