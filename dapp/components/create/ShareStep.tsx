'use client';

import Link from 'next/link';
import { CopyButton } from '../CopyButton';
import { QRCodeDisplay } from '../QRCodeDisplay';

const cardClass =
  'bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6';

interface SessionCredentials {
  sessionId: string;
  pin: string;
  coordinatorToken: string;
  threshold: number;
  eligibleKeys: string[];
  status: string;
  expiresAt: string;
}

interface ShareStepProps {
  sessionCredentials: SessionCredentials;
  serverUrl: string;
  connectionString: string;
  shareableUrl: string;
  injectionDone: boolean;
}

export function ShareStep({
  sessionCredentials,
  serverUrl,
  connectionString,
  shareableUrl,
  injectionDone,
}: ShareStepProps) {
  return (
    <section aria-label="Share session" className="space-y-6">
      {/* Success banner */}
      {injectionDone && (
        <div className="p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg flex items-start gap-3">
          <svg
            className="w-6 h-6 text-green-600 dark:text-green-400 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p className="font-semibold text-green-800 dark:text-green-200">
              Transaction injected successfully
            </p>
            <p className="text-sm text-green-700 dark:text-green-300">
              Share the credentials below so participants can join and
              sign. Remember: participants have 120 seconds from now to
              sign.
            </p>
          </div>
        </div>
      )}

      {/* Credentials card */}
      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
          Session Credentials
        </h2>

        <div className="space-y-4">
          <CredentialRow
            label="Session ID"
            value={sessionCredentials.sessionId}
            copyLabel="Session ID"
            variant="neutral"
          />
          <CredentialRow
            label="PIN (share with participants)"
            value={sessionCredentials.pin}
            copyLabel="PIN"
            variant="warning"
            large
          />
          <CredentialRow
            label="Coordinator Token (keep private)"
            value={sessionCredentials.coordinatorToken}
            copyLabel="Coordinator Token"
            variant="danger"
          />
          <CredentialRow
            label="Server URL"
            value={serverUrl}
            copyLabel="Server URL"
            variant="neutral"
          />
        </div>
      </div>

      {/* QR Code + Connection String */}
      {connectionString && (
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
            Share with Participants
          </h2>

          <div className="flex flex-col items-center gap-6">
            <QRCodeDisplay
              value={connectionString}
              size={200}
              description="Participants scan this QR code with the dApp to join"
              showDownload
              downloadFilename={`hedera-multisig-${sessionCredentials.sessionId.slice(0, 8)}`}
            />

            <CopyableField label="Connection String" value={connectionString} />

            {shareableUrl && (
              <CopyableField
                label="Shareable Link"
                value={shareableUrl}
                hint="This link auto-fills session details on the Join page."
              />
            )}
          </div>
        </div>
      )}

      {/* Monitor link */}
      <div className={cardClass}>
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-3">
          Monitor Session
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Open the session page to watch participants join and monitor
          signature progress in real time.
        </p>
        <Link
          href={`/session/${sessionCredentials.sessionId}`}
          onClick={() => {
            try {
              localStorage.setItem(
                'hedera-multisig-session-info',
                JSON.stringify({
                  serverUrl,
                  sessionId: sessionCredentials.sessionId,
                  pin: sessionCredentials.pin,
                })
              );
            } catch {
              // localStorage unavailable in private browsing
            }
          }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
          Open Session Monitor
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (internal to ShareStep)
// ---------------------------------------------------------------------------

function CredentialRow({
  label,
  value,
  copyLabel,
  variant,
  large,
}: {
  label: string;
  value: string;
  copyLabel: string;
  variant: 'neutral' | 'warning' | 'danger';
  large?: boolean;
}) {
  const bg = {
    neutral: 'bg-gray-50 dark:bg-gray-700/50',
    warning: 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800',
    danger: 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800',
  }[variant];

  const labelColor = {
    neutral: 'text-gray-500 dark:text-gray-400',
    warning: 'text-yellow-700 dark:text-yellow-400',
    danger: 'text-red-700 dark:text-red-400',
  }[variant];

  const valueColor = {
    neutral: 'text-gray-900 dark:text-white',
    warning: 'text-yellow-800 dark:text-yellow-200',
    danger: 'text-red-800 dark:text-red-200',
  }[variant];

  return (
    <div className={`flex items-center justify-between gap-2 p-3 rounded-lg ${bg}`}>
      <div className="min-w-0">
        <span className={`text-xs font-medium ${labelColor} block`}>{label}</span>
        <span className={`font-mono break-all ${valueColor} ${large ? 'text-lg font-bold tracking-widest' : 'text-sm'}`}>
          {value}
        </span>
      </div>
      <CopyButton text={value} label={copyLabel} variant="button" size="sm" />
    </div>
  );
}

function CopyableField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="w-full bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
        <CopyButton text={value} label={label} variant="button" size="sm" />
      </div>
      <div className="font-mono text-xs text-gray-600 dark:text-gray-400 break-all bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-600">
        {value}
      </div>
      {hint && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{hint}</p>
      )}
    </div>
  );
}
