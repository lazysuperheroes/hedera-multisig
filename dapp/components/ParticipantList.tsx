/**
 * ParticipantList Component
 *
 * Displays the list of connected participants with their status and public keys.
 * Shows real-time updates as participants join, become ready, sign, or disconnect.
 */

'use client';

import { CopyButton } from './CopyButton';
import type { Participant } from '../hooks/useSigningSession';

interface ParticipantListProps {
  participants: Participant[];
  currentParticipantId: string | null;
  eligiblePublicKeys?: string[];
}

/**
 * Truncate a public key for display
 */
function truncateKey(key: string): string {
  if (!key) return '';
  if (key.length <= 20) return key;
  return `${key.slice(0, 10)}...${key.slice(-8)}`;
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
        bg: 'bg-yellow-100 dark:bg-yellow-900/30',
        text: 'text-yellow-800 dark:text-yellow-200',
        label: 'Connected',
        icon: '🔗',
      };
    case 'ready':
      return {
        bg: 'bg-blue-100 dark:bg-blue-900/30',
        text: 'text-blue-800 dark:text-blue-200',
        label: 'Ready',
        icon: '✓',
      };
    case 'signed':
      return {
        bg: 'bg-green-100 dark:bg-green-900/30',
        text: 'text-green-800 dark:text-green-200',
        label: 'Signed',
        icon: '✅',
      };
    case 'disconnected':
      return {
        bg: 'bg-gray-100 dark:bg-gray-700',
        text: 'text-gray-500 dark:text-gray-400',
        label: 'Disconnected',
        icon: '⚫',
      };
    default:
      return {
        bg: 'bg-gray-100 dark:bg-gray-700',
        text: 'text-gray-600 dark:text-gray-400',
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
      <div className="bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">Participants</h3>
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <div className="text-4xl mb-2">👥</div>
          <p>Waiting for participants to connect...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Participants</h3>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {sortedParticipants.filter((p) => p.status !== 'disconnected').length} connected
        </span>
      </div>

      <div className="space-y-3">
        {sortedParticipants.map((participant) => {
          const isCurrentUser = participant.id === currentParticipantId;
          const statusBadge = getStatusBadge(participant.status);
          const isEligible = participant.publicKey
            ? eligiblePublicKeys.some(
                (k) => k.toLowerCase() === participant.publicKey?.toLowerCase()
              )
            : null;

          return (
            <div
              key={participant.id}
              className={`p-3 rounded-lg border-2 transition-colors ${
                isCurrentUser
                  ? 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/30'
                  : participant.status === 'disconnected'
                  ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 opacity-60'
                  : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {/* Status Icon */}
                  <span className="text-lg">{statusBadge.icon}</span>

                  {/* Participant Info */}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800 dark:text-gray-200 text-sm">
                        {isCurrentUser ? 'You' : `Participant`}
                      </span>
                      {isCurrentUser && (
                        <span className="px-1.5 py-0.5 bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 text-xs rounded">
                          (You)
                        </span>
                      )}
                    </div>

                    {/* Public Key */}
                    {participant.publicKey ? (
                      <div className="flex items-center gap-1 mt-1">
                        <code className="text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                          {truncateKey(participant.publicKey)}
                        </code>
                        <CopyButton
                          text={participant.publicKey}
                          label="public key"
                          size="sm"
                        />
                        {isEligible === false && (
                          <span className="text-xs text-red-600 dark:text-red-400" title="Not in eligible keys list">
                            ⚠️
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-gray-500 italic">
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
      <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-400"></span> Connected
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-400"></span> Ready
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-400"></span> Signed
          </span>
        </div>
      </div>
    </div>
  );
}

export default ParticipantList;
