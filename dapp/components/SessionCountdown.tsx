'use client';

import { useState, useEffect } from 'react';

interface SessionCountdownProps {
  expiresAt: number; // Unix timestamp in milliseconds
  onExpired?: () => void;
}

/**
 * Formats seconds into a human-readable string
 */
function formatDuration(seconds: number): string {
  if (seconds <= 0) return 'Expired';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

/**
 * SessionCountdown Component
 * Displays a countdown timer showing when the session expires
 */
export function SessionCountdown({ expiresAt, onExpired }: SessionCountdownProps) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    const updateCountdown = () => {
      const now = Date.now();
      const remaining = Math.floor((expiresAt - now) / 1000);

      if (remaining <= 0) {
        setSecondsRemaining(0);
        setIsExpired(true);
        onExpired?.();
      } else {
        setSecondsRemaining(remaining);
        setIsExpired(false);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, onExpired]);

  // Determine urgency level for styling
  const getUrgencyLevel = (): 'normal' | 'warning' | 'critical' | 'expired' => {
    if (isExpired) return 'expired';
    if (secondsRemaining <= 60) return 'critical'; // Less than 1 minute
    if (secondsRemaining <= 300) return 'warning'; // Less than 5 minutes
    return 'normal';
  };

  const urgency = getUrgencyLevel();

  const styles = {
    normal: {
      container: 'bg-gray-100 text-gray-700',
      icon: 'text-gray-500',
      time: 'text-gray-800',
    },
    warning: {
      container: 'bg-yellow-100 text-yellow-800',
      icon: 'text-yellow-600',
      time: 'text-yellow-900',
    },
    critical: {
      container: 'bg-red-100 text-red-800 animate-pulse',
      icon: 'text-red-600',
      time: 'text-red-900',
    },
    expired: {
      container: 'bg-red-200 text-red-900',
      icon: 'text-red-700',
      time: 'text-red-900',
    },
  };

  const currentStyle = styles[urgency];

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${currentStyle.container}`}>
      <svg
        className={`w-4 h-4 ${currentStyle.icon}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span className="text-xs font-medium">Session:</span>
      <span className={`font-mono font-bold ${currentStyle.time}`}>
        {formatDuration(secondsRemaining)}
      </span>
    </div>
  );
}

export default SessionCountdown;
