'use client';

import Link from 'next/link';
import { CopyButton } from '../CopyButton';
import { QRCodeDisplay } from '../QRCodeDisplay';

const cardClass =
  'console-pane bg-surface rounded-lg shadow-sm border border-border p-6';

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
  /** Phase B1: opt-in to including PIN in shareable URL (default false) */
  includePinInLink?: boolean;
  onTogglePinInLink?: (next: boolean) => void;
}

export function ShareStep({
  sessionCredentials,
  serverUrl,
  connectionString,
  shareableUrl,
  injectionDone,
  includePinInLink = false,
  onTogglePinInLink,
}: ShareStepProps) {
  return (
    <section aria-label="Share session" className="space-y-6">
      {/* Success banner */}
      {injectionDone && (
        <div className="p-4 bg-success-soft border border-success/40 rounded-lg flex items-start gap-3">
          <svg
            className="w-6 h-6 text-success flex-shrink-0"
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
            <p className="font-semibold text-success-soft-fg">
              Transaction injected successfully
            </p>
            <p className="text-sm text-success-soft-fg">
              Share the credentials below so participants can join and
              sign. Remember: participants have 120 seconds from now to
              sign.
            </p>
          </div>
        </div>
      )}

      {/* Credentials card */}
      <div className={cardClass} data-pane-label="~/credentials">
        <h2 className="text-lg font-semibold text-foreground mb-4">
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
        <div className={cardClass} data-pane-label="~/share.links">
          <h2 className="text-lg font-semibold text-foreground mb-4">
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
              <div className="w-full space-y-3">
                <CopyableField
                  label="Shareable Link"
                  value={shareableUrl}
                  hint={
                    includePinInLink
                      ? 'This link includes the PIN — anyone with the URL can join. Treat it like a credential.'
                      : 'This link auto-fills server + session ID. Participants type the PIN themselves.'
                  }
                />
                {onTogglePinInLink && (
                  <label className="flex items-start gap-2 text-sm text-foreground-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includePinInLink}
                      onChange={(e) => onTogglePinInLink(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <strong>Include PIN in link</strong> (less secure — only enable for low-risk testnet demos).
                      The PIN is base64-encoded, not encrypted, so anyone who sees the URL can join.
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Monitor link */}
      <div className={cardClass} data-pane-label="~/monitor">
        <h2 className="text-lg font-semibold text-foreground mb-3">
          Monitor Session
        </h2>
        <p className="text-sm text-foreground-muted mb-4">
          Open the session page to watch participants join and monitor
          signature progress in real time.
        </p>
        <Link
          href={`/session/${sessionCredentials.sessionId}`}
          onClick={() => {
            // Phase B2: per-tab handoff via sessionStorage. The session page
            // reads, AUTHs, then deletes it immediately. PIN no longer
            // persists in localStorage.
            try {
              sessionStorage.setItem(
                'hedera-multisig-pending-join',
                JSON.stringify({
                  serverUrl,
                  sessionId: sessionCredentials.sessionId,
                  pin: sessionCredentials.pin,
                })
              );
            } catch {
              // sessionStorage unavailable in private browsing
            }
            // Best-effort purge of any legacy key that may still be around.
            try { localStorage.removeItem('hedera-multisig-session-info'); } catch {}
          }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white font-medium rounded-lg hover:bg-accent-hover transition-colors"
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
    neutral: 'bg-surface-recessed',
    warning: 'bg-warning-soft border border-warning/40',
    danger: 'bg-destructive-soft border border-destructive/40',
  }[variant];

  const labelColor = {
    neutral: 'text-foreground-subtle',
    warning: 'text-warning-soft-fg',
    danger: 'text-destructive-soft-fg',
  }[variant];

  const valueColor = {
    neutral: 'text-foreground',
    warning: 'text-warning-soft-fg',
    danger: 'text-destructive-soft-fg',
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
    <div className="w-full bg-surface-recessed rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-foreground-muted">{label}</span>
        <CopyButton text={value} label={label} variant="button" size="sm" />
      </div>
      <div className="font-mono text-xs text-foreground-muted break-all bg-surface p-2 rounded border border-border-strong">
        {value}
      </div>
      {hint && (
        <p className="text-xs text-foreground-subtle mt-2">{hint}</p>
      )}
    </div>
  );
}
