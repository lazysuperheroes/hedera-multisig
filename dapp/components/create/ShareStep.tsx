'use client';

import { useState } from 'react';
import { CopyButton } from '../CopyButton';
import { QRCodeDisplay } from '../QRCodeDisplay';
import type { SessionLiveState } from './SessionMonitor';

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
  network: 'testnet' | 'mainnet';
  /** Lifted from SessionMonitor — picks which sub-view to render. */
  liveState: SessionLiveState | null;
  /** Whether the URL form embeds the PIN. Off by default — explicit opt-in
   * because the link becomes a credential. */
  includePinInLink?: boolean;
  onTogglePinInLink?: (next: boolean) => void;
  /** Triggered from the completed/failed view to route back to the build
   * step with form state cleared, so the coordinator can inject another
   * transaction without losing the session or participants. */
  onStartAnother?: () => void;
}

export function ShareStep({
  sessionCredentials,
  serverUrl,
  connectionString,
  shareableUrl,
  network,
  liveState,
  includePinInLink = false,
  onTogglePinInLink,
  onStartAnother,
}: ShareStepProps) {
  // Phase: signing (default) / completed / failed / scheduled.
  // `idle` collapses to signing — when we land on the Share step
  // we've just injected, so there's always a transaction in flight
  // from the coordinator's perspective.
  //
  // Scheduled mode is its own branch: the coordinator's part is
  // done (schedule submitted on-chain), but no realtime "completed"
  // event will arrive over WS — signers act asynchronously and
  // mirror node tracks. We render a dedicated banner so the
  // coordinator gets a clear "your work here is done, build
  // another?" affordance instead of staring at the signing-view
  // share panel forever.
  const isScheduled = !!liveState?.scheduleId &&
    liveState.phase !== 'completed' &&
    liveState.phase !== 'failed';

  if (isScheduled) {
    return (
      <ScheduledLaunched
        liveState={liveState!}
        sessionCredentials={sessionCredentials}
        connectionString={connectionString}
        shareableUrl={shareableUrl}
        network={network}
        includePinInLink={includePinInLink}
        onTogglePinInLink={onTogglePinInLink}
        onStartAnother={onStartAnother}
      />
    );
  }

  const phase = liveState?.phase === 'completed' || liveState?.phase === 'failed'
    ? liveState.phase
    : 'signing';

  if (phase === 'completed') {
    return (
      <CompletedReceipt
        liveState={liveState!}
        threshold={sessionCredentials.threshold}
        network={network}
        onStartAnother={onStartAnother}
      />
    );
  }

  if (phase === 'failed') {
    return (
      <FailedReceipt
        liveState={liveState!}
        network={network}
        onStartAnother={onStartAnother}
      />
    );
  }

  return (
    <SigningShare
      sessionCredentials={sessionCredentials}
      serverUrl={serverUrl}
      connectionString={connectionString}
      shareableUrl={shareableUrl}
      includePinInLink={includePinInLink}
      onTogglePinInLink={onTogglePinInLink}
    />
  );
}

// ---------------------------------------------------------------------------
// Phase: scheduled. Schedule submitted on-chain, signers act asynchronously,
// mirror node tracks signature progression. Coordinator's WS-side work is
// done — surface a clear "build another?" affordance plus the connection
// string in case more signers need to join later.
// ---------------------------------------------------------------------------

function ScheduledLaunched({
  liveState,
  sessionCredentials,
  connectionString,
  shareableUrl,
  network,
  includePinInLink,
  onTogglePinInLink,
  onStartAnother,
}: {
  liveState: SessionLiveState;
  sessionCredentials: SessionCredentials;
  connectionString: string;
  shareableUrl: string;
  network: 'testnet' | 'mainnet';
  includePinInLink?: boolean;
  onTogglePinInLink?: (next: boolean) => void;
  onStartAnother?: () => void;
}) {
  const scheduleId = liveState.scheduleId!;
  const expiresAt = liveState.scheduleExpirationTime
    ? new Date(liveState.scheduleExpirationTime * 1000)
    : null;
  const expiresInLabel = expiresAt
    ? formatRelativeFuture(expiresAt.getTime())
    : 'unspecified';
  const hashScanUrl = `https://hashscan.io/${network}/schedule/${scheduleId}`;

  return (
    <section aria-label="Schedule launched" className="space-y-6">
      <div className="border-l-2 border-info bg-info-soft/40 pl-4 py-3 rounded-r-md">
        <h2 className="text-base font-bold text-info-soft-fg">
          Schedule launched (HIP-423)
        </h2>
        <p className="mt-2 text-sm text-info-soft-fg/90 leading-relaxed">
          Your part is done — the schedule is on-chain. Signers will sign at
          their convenience via <code className="font-mono">ScheduleSignTransaction</code>.
          The Hedera network executes the inner transaction automatically the
          moment threshold is met (or expires the schedule if not).
        </p>

        <dl className="mt-4 space-y-1.5 text-sm">
          <div className="flex gap-3">
            <dt className="w-32 flex-shrink-0 text-info-soft-fg/80">Schedule ID:</dt>
            <dd className="flex-1 min-w-0">
              <code className="font-mono text-info-soft-fg break-all">{scheduleId}</code>
              <a
                href={hashScanUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 underline text-info-soft-fg hover:no-underline whitespace-nowrap"
              >
                HashScan ↗
              </a>
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-32 flex-shrink-0 text-info-soft-fg/80">Expires:</dt>
            <dd className="text-info-soft-fg">
              {expiresInLabel}
              {expiresAt && (
                <span className="ml-2 text-info-soft-fg/70 text-xs">
                  ({expiresAt.toUTCString().replace(/:\d\d GMT/, ' GMT')})
                </span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      {onStartAnother && (
        <button
          type="button"
          onClick={onStartAnother}
          className="
            w-full px-6 py-3 rounded-md text-base font-semibold
            bg-accent text-accent-fg hover:bg-accent-hover transition-colors
          "
        >
          Build another transaction
        </button>
      )}

      <details className="group border-t border-border pt-4">
        <summary className="cursor-pointer list-none flex items-center justify-between text-sm text-foreground-muted hover:text-foreground transition-colors py-1">
          <span>Need to share the session with another signer?</span>
          <span aria-hidden className="text-xs opacity-60 group-open:hidden">show</span>
          <span aria-hidden className="text-xs opacity-60 hidden group-open:inline">hide</span>
        </summary>

        <div className="mt-4">
          <ShareKit
            sessionCredentials={sessionCredentials}
            serverUrl=""
            connectionString={connectionString}
            shareableUrl={shareableUrl}
            includePinInLink={includePinInLink}
            onTogglePinInLink={onTogglePinInLink}
          />
        </div>
      </details>
    </section>
  );
}

function formatRelativeFuture(targetMs: number): string {
  const ms = targetMs - Date.now();
  if (ms <= 0) return 'expired';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `in ${days}d${hours > 0 ? ` ${hours}h` : ''}`;
  if (hours > 0) return `in ${hours}h${mins > 0 ? ` ${mins}m` : ''}`;
  return `in ${mins}m`;
}

// ---------------------------------------------------------------------------
// Phase: signing (in-flight). Live monitor sits above this in page.tsx and
// carries the action; this view exists for re-share. Credentials are
// demoted behind a disclosure since the 120s window has already started.
// ---------------------------------------------------------------------------

function SigningShare({
  sessionCredentials,
  serverUrl,
  connectionString,
  shareableUrl,
  includePinInLink,
  onTogglePinInLink,
}: {
  sessionCredentials: SessionCredentials;
  serverUrl: string;
  connectionString: string;
  shareableUrl: string;
  includePinInLink?: boolean;
  onTogglePinInLink?: (next: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section aria-label="Share session" className="space-y-6">
      <p className="text-sm text-foreground-muted leading-relaxed">
        Signing in progress. Participants who already have the connection
        string will receive the transaction automatically.
      </p>

      <details
        className="group border-t border-border pt-4"
        open={open}
        onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer list-none flex items-center justify-between text-sm text-foreground-muted hover:text-foreground transition-colors py-1">
          <span>Need to re-share with someone?</span>
          <span aria-hidden className="text-xs opacity-60 group-open:hidden">show</span>
          <span aria-hidden className="text-xs opacity-60 hidden group-open:inline">hide</span>
        </summary>

        <div className="mt-4">
          <ShareKit
            sessionCredentials={sessionCredentials}
            serverUrl={serverUrl}
            connectionString={connectionString}
            shareableUrl={shareableUrl}
            includePinInLink={includePinInLink}
            onTogglePinInLink={onTogglePinInLink}
          />
        </div>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Phase: completed. Receipt view — transaction ID + HashScan + signers.
// No credentials, no banner.
// ---------------------------------------------------------------------------

function CompletedReceipt({
  liveState,
  threshold,
  network,
  onStartAnother,
}: {
  liveState: SessionLiveState;
  threshold: number;
  network: 'testnet' | 'mainnet';
  onStartAnother?: () => void;
}) {
  const txId = liveState.transactionId || '';
  const signedSigners = liveState.signers.filter((s) => s.status === 'signed');

  return (
    <section aria-label="Transaction executed" className="space-y-6">
      <header className="border-t border-border pt-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Transaction executed
          </h2>
          <span className="text-xs text-success font-medium tabular-nums">
            {liveState.mirrorConfirmed
              ? 'mirror confirmed'
              : 'consensus confirmed'}
          </span>
        </div>
        <p className="mt-1 text-sm text-foreground-muted">
          {signedSigners.length} of {threshold} required signatures collected.
          The network accepted the transaction.
        </p>
      </header>

      {txId && (
        <div className="space-y-3">
          <div>
            <span className="block text-xs font-medium text-foreground-subtle mb-1">
              Transaction ID
            </span>
            <div className="flex items-center justify-between gap-3">
              <code className="font-mono text-sm text-foreground break-all">
                {txId}
              </code>
              <CopyButton text={txId} label="Transaction ID" variant="button" size="sm" />
            </div>
          </div>

          <a
            href={hashscanUrl(txId, network)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover transition-colors"
          >
            View on HashScan
            <ExternalLinkIcon />
          </a>
        </div>
      )}

      {signedSigners.length > 0 && (
        <div className="border-t border-border pt-4">
          <h3 className="text-xs font-medium text-foreground-subtle mb-2">
            Signers ({signedSigners.length}/{threshold})
          </h3>
          <ul className="space-y-1.5">
            {signedSigners.map((s) => (
              <li
                key={s.participantId}
                className="flex items-center gap-2 text-sm tabular-nums"
              >
                <CheckIcon />
                <span className="text-foreground">{s.label}</span>
                {s.isAgent && (
                  <span className="text-xs text-foreground-subtle">(agent)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {onStartAnother && (
        <div className="border-t border-border pt-4">
          <button
            type="button"
            onClick={onStartAnother}
            className="text-sm font-medium text-foreground hover:text-accent border border-border-strong hover:border-accent rounded-md px-4 py-2 transition-colors"
          >
            Build another transaction
          </button>
          <p className="mt-2 text-xs text-foreground-subtle">
            Returns to the build step. The session and connected participants
            stay live — they don&apos;t need to reconnect.
          </p>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Phase: failed. Failure summary + retry guidance.
// ---------------------------------------------------------------------------

function FailedReceipt({
  liveState,
  network,
  onStartAnother,
}: {
  liveState: SessionLiveState;
  network: 'testnet' | 'mainnet';
  onStartAnother?: () => void;
}) {
  const txId = liveState.transactionId || '';
  return (
    <section aria-label="Transaction failed" className="space-y-6">
      <header className="border-t border-border pt-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-heading text-lg font-semibold text-foreground">
            Transaction did not execute
          </h2>
          <span className="text-xs text-destructive font-medium">failed</span>
        </div>
        {liveState.failureReason && (
          <p className="mt-2 text-sm text-foreground leading-relaxed">
            <span className="text-foreground-subtle">Reason: </span>
            <span className="font-mono">{liveState.failureReason}</span>
          </p>
        )}
      </header>

      {txId && (
        <div className="space-y-3">
          <div>
            <span className="block text-xs font-medium text-foreground-subtle mb-1">
              Transaction ID
            </span>
            <div className="flex items-center justify-between gap-3">
              <code className="font-mono text-sm text-foreground break-all">
                {txId}
              </code>
              <CopyButton text={txId} label="Transaction ID" variant="button" size="sm" />
            </div>
          </div>

          <a
            href={hashscanUrl(txId, network)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover transition-colors"
          >
            View on HashScan
            <ExternalLinkIcon />
          </a>
        </div>
      )}

      <div className="border-t border-border pt-4 text-sm text-foreground-muted leading-relaxed">
        <p className="font-medium text-foreground mb-2">What to try next</p>
        <ul className="space-y-1 list-disc list-inside text-foreground-muted">
          <li>Check the failure reason above and the HashScan record for the network status code.</li>
          <li>Common: insufficient balance on the fee payer, or the transaction expired before threshold was met (120s window).</li>
          <li>You can reset the session and inject a new transaction; participants stay connected.</li>
        </ul>
      </div>

      {onStartAnother && (
        <button
          type="button"
          onClick={onStartAnother}
          className="text-sm font-medium text-foreground hover:text-accent border border-border-strong hover:border-accent rounded-md px-4 py-2 transition-colors"
        >
          Build another transaction
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sharing toolkit — used by SigningShare's disclosure. QR + link is the
// happy path; individual values live behind a nested disclosure since
// 95% of operators only need the link or QR.
// ---------------------------------------------------------------------------

function ShareKit({
  sessionCredentials,
  serverUrl,
  connectionString,
  shareableUrl,
  includePinInLink,
  onTogglePinInLink,
}: {
  sessionCredentials: SessionCredentials;
  serverUrl: string;
  connectionString: string;
  shareableUrl: string;
  includePinInLink?: boolean;
  onTogglePinInLink?: (next: boolean) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-start">
        <div className="flex md:block justify-center">
          <QRCodeDisplay
            value={connectionString}
            size={180}
            description="Participants scan to join"
            showDownload
            downloadFilename={`hedera-multisig-${sessionCredentials.sessionId.slice(0, 8)}`}
          />
        </div>

        <div className="space-y-4 min-w-0">
          <div>
            <span className="block text-xs font-medium text-foreground-subtle mb-1">
              Connection string
            </span>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 font-mono text-xs text-foreground bg-surface-recessed px-2 py-1.5 rounded border border-border break-all">
                {connectionString}
              </code>
              <CopyButton
                text={connectionString}
                label="Connection string"
                variant="button"
                size="sm"
              />
            </div>
          </div>

          {shareableUrl && (
            <div>
              <span className="block text-xs font-medium text-foreground-subtle mb-1">
                Share link
              </span>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 font-mono text-xs text-foreground bg-surface-recessed px-2 py-1.5 rounded border border-border break-all">
                  {shareableUrl}
                </code>
                <CopyButton
                  text={shareableUrl}
                  label="Share link"
                  variant="button"
                  size="sm"
                />
              </div>
              {onTogglePinInLink && (
                <label className="mt-2 flex items-start gap-2 text-xs text-foreground-subtle cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!includePinInLink}
                    onChange={(e) => onTogglePinInLink(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    Embed PIN in link (less secure — anyone with the URL can
                    join). Off by default; participants type the PIN themselves.
                  </span>
                </label>
              )}
            </div>
          )}
        </div>
      </div>

      <details className="border-t border-border pt-3">
        <summary className="cursor-pointer list-none text-xs text-foreground-subtle hover:text-foreground transition-colors py-1">
          Show individual credentials
        </summary>
        <div className="mt-3 space-y-3">
          <CredentialRow
            label="Session ID"
            value={sessionCredentials.sessionId}
            copyLabel="Session ID"
          />
          <CredentialRow
            label="PIN"
            value={sessionCredentials.pin}
            copyLabel="PIN"
            mono={false}
          />
          <CredentialRow
            label="Coordinator token"
            value={sessionCredentials.coordinatorToken}
            copyLabel="Coordinator token"
            secret
            hint="Re-auth secret. Keep this private — anyone with it can act as coordinator."
          />
          <CredentialRow
            label="Server URL"
            value={serverUrl}
            copyLabel="Server URL"
            hint="Auto-detected. Already encoded into the connection string above."
          />
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------

function CredentialRow({
  label,
  value,
  copyLabel,
  mono = true,
  secret = false,
  hint,
}: {
  label: string;
  value: string;
  copyLabel: string;
  mono?: boolean;
  secret?: boolean;
  hint?: string;
}) {
  const [revealed, setRevealed] = useState(!secret);
  const display = revealed ? value : '•'.repeat(Math.min(24, value.length));

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-foreground-subtle">
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          {secret && (
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              className="text-xs text-foreground-subtle hover:text-foreground transition-colors"
              aria-pressed={revealed}
            >
              {revealed ? 'hide' : 'show'}
            </button>
          )}
          <CopyButton text={value} label={copyLabel} variant="icon" size="sm" />
        </div>
      </div>
      <code
        className={`block ${mono ? 'font-mono' : ''} text-sm text-foreground break-all`}
      >
        {display}
      </code>
      {hint && (
        <p className="text-xs text-foreground-subtle">{hint}</p>
      )}
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-success"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function hashscanUrl(txId: string, network: 'testnet' | 'mainnet') {
  // Hedera tx IDs from the SDK are `0.0.X@T.N`; HashScan wants `0.0.X-T-N`
  // for the deep-link route.
  const formatted = txId.replace('@', '-').replace(/\.(?=\d+$)/, '-');
  return `https://hashscan.io/${network}/transactionsById/${formatted}`;
}
