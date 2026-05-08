/**
 * ParticipantList Component
 *
 * Displays the list of connected participants with their status and public keys.
 * Shows real-time updates as participants join, become ready, sign, or disconnect.
 */

'use client';

import { CopyButton } from './CopyButton';
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
  return `${raw.slice(0, 10)}...${raw.slice(-8)}`;
}

/**
 * Get status badge styling
 */
function getStatusBadge(status: Participant['status']): {
  bg: string;
  text: string;
  label: string;
  icon: string;
} {
  switch (status) {
    case 'connected':
      return {
        bg: 'bg-warning-soft',
        text: 'text-warning-soft-fg',
        label: 'Connected',
        icon: '🔗',
      };
    case 'ready':
      return {
        bg: 'bg-info-soft',
        text: 'text-info-soft-fg',
        label: 'Ready',
        icon: '✓',
      };
    case 'signed':
      return {
        bg: 'bg-success-soft',
        text: 'text-success-soft-fg',
        label: 'Signed',
        icon: '✅',
      };
    case 'disconnected':
      return {
        bg: 'bg-surface-recessed',
        text: 'text-foreground-subtle',
        label: 'Disconnected',
        icon: '⚫',
      };
    default:
      return {
        bg: 'bg-surface-recessed',
        text: 'text-foreground-muted',
        label: 'Unknown',
        icon: '?',
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
      <div className="bg-surface border-2 border-border-strong rounded-lg p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">Participants</h3>
        <div className="text-center py-8 text-foreground-subtle">
          <div className="text-4xl mb-2">👥</div>
          <p>Waiting for participants to connect...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border-2 border-border-strong rounded-lg p-6">
      {/* Title only — the per-row entries already show how many are
          connected, and the top-of-page SignatureProgress carries the
          authoritative session-wide "X / Y connected" counter. Showing
          a "1 connected" badge here when SignatureProgress legitimately
          says "2 / 3" (e.g. a participant who signed earlier is still
          counted server-side) reads as a contradiction even though the
          two counters are answering different questions. */}
      <h3 className="text-lg font-semibold text-foreground mb-4">Participants</h3>

      <div className="space-y-3">
        {sortedParticipants.map((participant) => {
          const isCurrentUser = participant.id === currentParticipantId;
          const statusBadge = getStatusBadge(participant.status);
          // Eligibility check must canonicalize across DER vs raw —
          // CLI-registered eligible keys arrive in DER form; wallet-
          // delivered participant keys arrive raw. A naïve string
          // compare flagged every row as "not eligible" even when both
          // sides held the same key, just in different envelopes.
          const isEligible = participant.publicKey
            ? eligiblePublicKeys.some((k) => publicKeysEqual(k, participant.publicKey))
            : null;

          return (
            <div
              key={participant.id}
              className={`p-3 rounded-lg border-2 transition-colors ${
                isCurrentUser
                  ? 'border-accent bg-info-soft'
                  : participant.status === 'disconnected'
                  ? 'border-border bg-surface-recessed opacity-60'
                  : 'border-border bg-surface-recessed'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {/* Status Icon */}
                  <span className="text-lg">{statusBadge.icon}</span>

                  {/* Participant Info */}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground text-sm">
                        {isCurrentUser ? 'You' : `Participant`}
                      </span>
                      {isCurrentUser && (
                        <span className="px-1.5 py-0.5 bg-info-soft text-info-soft-fg text-xs rounded">
                          (You)
                        </span>
                      )}
                    </div>

                    {/* Public Key */}
                    {participant.publicKey ? (
                      <div className="flex items-center gap-1 mt-1">
                        <code className="text-xs font-mono text-foreground-muted bg-surface-recessed px-1.5 py-0.5 rounded">
                          {truncateKey(participant.publicKey)}
                        </code>
                        <CopyButton
                          text={participant.publicKey}
                          label="public key"
                          size="sm"
                        />
                        {isEligible === false && (
                          <span className="text-xs text-destructive" title="Not in eligible keys list">
                            ⚠️
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-foreground-subtle italic">
                        Waiting for public key...
                      </span>
                    )}
                  </div>
                </div>

                {/* Status Badge */}
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${statusBadge.bg} ${statusBadge.text}`}
                >
                  {statusBadge.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-3 border-t border-border">
        <div className="flex flex-wrap gap-3 text-xs text-foreground-subtle">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-warning"></span> Connected
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-info"></span> Ready
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-success"></span> Signed
          </span>
        </div>
      </div>
    </div>
  );
}

export default ParticipantList;
