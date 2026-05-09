/**
 * ParticipantList Component
 *
 * Flat list of session participants with status, public key, and
 * eligibility. Replaces the previous bordered-cards-in-a-bordered-card
 * structure — every emoji-icon (🔗 ✓ ✅ ⚫ 👥 ⚠️) replaced with proper
 * Icon-component glyphs or color-token presence dots. Each row reads
 * as a flat hover-tinted entry, not a card.
 *
 * Real-time updates as participants join, become ready, sign, or
 * disconnect. The current user's row carries a small accent-left-
 * border to identify "this is you" without per-row card chrome.
 */

'use client';

import { CopyButton } from './CopyButton';
import { Icon } from './Icon';
import { toRawPublicKeyHex, publicKeysEqual } from '../lib/keyCanonical';
import type { Participant } from '../hooks/useSigningSession';

interface ParticipantListProps {
  participants: Participant[];
  currentParticipantId: string | null;
  eligiblePublicKeys?: string[];
}

/**
 * Truncate a key for display, after canonicalizing to raw hex.
 *
 * Without canonicalization rows would mix DER-form keys (CLI-produced,
 * 88 chars, prefixed `302a300506032b6570032100…`) with raw-form keys
 * (HashPack/WalletConnect-produced, 64 chars) — looking nothing alike
 * to a user comparing against `walkthrough-keys.json` which stores
 * raw. Always show raw.
 */
function truncateKey(key: string): string {
  const raw = toRawPublicKeyHex(key);
  if (!raw) return '';
  if (raw.length <= 20) return raw;
  return `${raw.slice(0, 10)}…${raw.slice(-8)}`;
}

/**
 * Status presentation. Three pieces:
 *   - dotColor: the row-leading 6px presence dot (matches the legend)
 *   - badgeBg / badgeText: the right-side pill
 *   - label: human-readable status name
 *
 * No emoji. Color carries severity; the legend at the bottom maps
 * dot-color → status name.
 */
function getStatusPresentation(status: Participant['status']): {
  dotColor: string;
  badgeBg: string;
  badgeText: string;
  label: string;
} {
  switch (status) {
    case 'connected':
      return {
        dotColor: 'bg-warning',
        badgeBg: 'bg-warning-soft',
        badgeText: 'text-warning-soft-fg',
        label: 'Connected',
      };
    case 'ready':
      return {
        dotColor: 'bg-info',
        badgeBg: 'bg-info-soft',
        badgeText: 'text-info-soft-fg',
        label: 'Ready',
      };
    case 'signed':
      return {
        dotColor: 'bg-success',
        badgeBg: 'bg-success-soft',
        badgeText: 'text-success-soft-fg',
        label: 'Signed',
      };
    case 'disconnected':
      return {
        dotColor: 'bg-foreground-subtle',
        badgeBg: 'bg-surface-recessed',
        badgeText: 'text-foreground-subtle',
        label: 'Disconnected',
      };
    default:
      return {
        dotColor: 'bg-foreground-subtle',
        badgeBg: 'bg-surface-recessed',
        badgeText: 'text-foreground-muted',
        label: 'Unknown',
      };
  }
}

export function ParticipantList({
  participants,
  currentParticipantId,
  eligiblePublicKeys = [],
}: ParticipantListProps) {
  // Filter out disconnected participants (but keep all others)
  const activeParticipants = participants.filter(
    (p) => p.status !== 'disconnected'
  );

  // Sort: ready/signed first, then by join time
  const sortedParticipants = [...activeParticipants].sort((a, b) => {
    const statusOrder = { signed: 0, ready: 1, connected: 2, disconnected: 3 };
    const orderDiff = statusOrder[a.status] - statusOrder[b.status];
    if (orderDiff !== 0) return orderDiff;
    return a.joinedAt - b.joinedAt;
  });

  if (sortedParticipants.length === 0) {
    return (
      <section aria-label="Participants">
        <h3 className="text-xs uppercase tracking-wider font-medium text-foreground-muted mb-3">
          <span className="treasury-label">Participants</span>
          <span className="console-label">participants</span>
        </h3>
        <p className="text-sm text-foreground-subtle">
          Waiting for participants to connect…
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Participants">
      <h3 className="text-xs uppercase tracking-wider font-medium text-foreground-muted mb-3">
        <span className="treasury-label">Participants</span>
        <span className="console-label">participants</span>
      </h3>

      <ul className="divide-y divide-border">
        {sortedParticipants.map((participant) => {
          const isCurrentUser = participant.id === currentParticipantId;
          const presentation = getStatusPresentation(participant.status);
          // Eligibility check must canonicalize across DER vs raw —
          // CLI-registered eligible keys arrive in DER form; wallet-
          // delivered participant keys arrive raw. A naïve string
          // compare flagged every row as "not eligible" even when both
          // sides held the same key, just in different envelopes.
          const isEligible = participant.publicKey
            ? eligiblePublicKeys.some((k) => publicKeysEqual(k, participant.publicKey))
            : null;
          const isDisconnected = participant.status === 'disconnected';

          return (
            <li
              key={participant.id}
              className={`
                flex items-center gap-3 py-3 px-2 -mx-2 rounded-md transition-colors
                ${isCurrentUser ? 'border-l-2 border-accent pl-3 -ml-3' : ''}
                ${isDisconnected ? 'opacity-60' : ''}
              `}
            >
              {/* Status presence dot — matches the legend below. */}
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${presentation.dotColor}`}
                aria-hidden="true"
              />

              {/* Identity column: name + (You) tag + public key chip. */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-foreground text-sm">
                    {isCurrentUser ? 'You' : (participant.label || 'Participant')}
                  </span>
                  {isCurrentUser && participant.label && (
                    <span className="text-xs text-foreground-subtle">
                      ({participant.label})
                    </span>
                  )}
                </div>
                {participant.publicKey ? (
                  <div className="flex items-center gap-1.5 mt-1">
                    <code className="text-xs font-mono text-foreground-muted">
                      {truncateKey(participant.publicKey)}
                    </code>
                    <CopyButton
                      text={participant.publicKey}
                      label="public key"
                      size="sm"
                    />
                    {isEligible === false && (
                      <span
                        className="inline-flex items-center text-destructive"
                        title="Not in eligible keys list"
                      >
                        <Icon name="warning" size={14} className="text-destructive" />
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-foreground-subtle italic">
                    Waiting for public key…
                  </span>
                )}
              </div>

              {/* Status badge — right-aligned pill. */}
              <span
                className={`flex-shrink-0 px-2 py-1 rounded text-xs font-medium ${presentation.badgeBg} ${presentation.badgeText}`}
              >
                {presentation.label}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Legend — dot-color → status mapping. Matches the row dots
          exactly so the legend is a real key, not decoration. */}
      <div className="mt-4 flex flex-wrap gap-4 text-xs text-foreground-subtle">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-warning" /> Connected
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-info" /> Ready
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-success" /> Signed
        </span>
      </div>
    </section>
  );
}

export default ParticipantList;
