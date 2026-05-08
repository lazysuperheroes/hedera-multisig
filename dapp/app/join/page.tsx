'use client';

import { useState, useEffect, Suspense, lazy } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Footer } from '../../components/Footer';

// Lazy load QR scanner to avoid SSR issues
const QRScanner = lazy(() => import('../../components/QRScanner'));

// Shared connection string utilities
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseConnectionString } = require('../../../shared/connection-string');

function JoinPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [formData, setFormData] = useState({
    serverUrl: '',
    sessionId: '',
    pin: '',
    label: '',
  });
  const [connectionString, setConnectionString] = useState('');
  const [showManualForm, setShowManualForm] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);

  // Check for URL parameters on load. Hydrating form state from query
  // strings is "sync external system → React" — useEffect is the right tool.
  useEffect(() => {
    const server = searchParams.get('server') || searchParams.get('s');
    const session = searchParams.get('session') || searchParams.get('id') || searchParams.get('i');
    const pin = searchParams.get('pin') || searchParams.get('p');

    if (server && session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData((prev) => ({ ...prev, serverUrl: server, sessionId: session, pin: pin || '' }));
      setShowManualForm(true);
    }
  }, [searchParams]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.serverUrl || !formData.sessionId || !formData.pin) return;

    // Phase B2: per-tab handoff via sessionStorage (clears on tab close).
    try {
      sessionStorage.setItem('hedera-multisig-pending-join', JSON.stringify(formData));
    } catch {}
    try { localStorage.removeItem('hedera-multisig-session-info'); } catch {}

    router.push(`/session/${formData.sessionId}`);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  /**
   * Phase C18: classify the coordinator URL by trust signal.
   */
  const hostTrust = (() => {
    const url = formData.serverUrl.trim();
    if (!url) return null;
    let host: string;
    try { host = new URL(url).host; } catch { return null; }
    if (/^(localhost(:\d+)?|127\.0\.0\.1(:\d+)?|0\.0\.0\.0(:\d+)?)$/i.test(host)) return 'localhost' as const;
    if (/(\.|^)(ngrok\.io|ngrok-free\.app|loca\.lt|trycloudflare\.com|serveo\.net)(:\d+)?$/i.test(host)) return 'tunnel' as const;
    return 'unknown' as const;
  })();

  const handleConnectionStringChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.trim();
    setConnectionString(value);
    setParseError(null);
    if (!value) return;

    const parsed = parseConnectionString(value);
    if (parsed) {
      setFormData((prev) => ({
        ...prev,
        serverUrl: parsed.serverUrl,
        sessionId: parsed.sessionId,
        pin: parsed.pin || '',
      }));
      setShowManualForm(true);
    } else {
      setParseError("This doesn't look like a valid connection string. It should start with hmsc:");
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const parsed = parseConnectionString(text.trim());
        if (parsed) {
          setConnectionString(text.trim());
          setFormData((prev) => ({
            ...prev,
            serverUrl: parsed.serverUrl,
            sessionId: parsed.sessionId,
            pin: parsed.pin || '',
          }));
          setShowManualForm(true);
          setParseError(null);
        } else {
          setParseError("The clipboard text isn't a valid connection string. Ask your coordinator for a new one.");
        }
      }
    } catch {
      setParseError('Clipboard access denied. Try pasting manually with Ctrl+V.');
    }
  };

  const handleQRScan = (data: string) => {
    setShowQRScanner(false);
    const parsed = parseConnectionString(data.trim());
    if (parsed) {
      setConnectionString(data.trim());
      setFormData((prev) => ({
        ...prev,
        serverUrl: parsed.serverUrl,
        sessionId: parsed.sessionId,
        pin: parsed.pin || '',
      }));
      setShowManualForm(true);
      setParseError(null);
    } else {
      setParseError("This QR code doesn't contain session details. Make sure you're scanning the coordinator's QR code.");
    }
  };

  return (
    <main className="min-h-screen bg-background">
      {/* QR Scanner Modal */}
      {showQRScanner && (
        <Suspense
          fallback={
            <div
              className="fixed inset-0 z-50 flex items-center justify-center"
              style={{ background: 'var(--scrim)' }}
            >
              <div className="bg-surface border border-border p-8 rounded-md">
                <Spinner large />
                <p className="mt-4 text-foreground-muted">Loading camera…</p>
              </div>
            </div>
          }
        >
          <QRScanner
            onScan={handleQRScan}
            onClose={() => setShowQRScanner(false)}
          />
        </Suspense>
      )}

      <section className="max-w-2xl mx-auto px-6 py-12 sm:py-16">
        {/* Header — H1 only, no redundant subtitle */}
        <h1 className="page-hero font-heading text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-12 leading-[1.1]">
          Join a signing session
        </h1>

        <form onSubmit={handleSubmit} className="space-y-12">

          {/* Section 1 — Quick connect. Section labelled by the input
              label itself; no eyebrow needed. */}
          <section aria-label="Quick connect">
            <label htmlFor="connectionString" className="block text-sm font-medium text-foreground mb-2">
              Connection string
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                id="connectionString"
                value={connectionString}
                onChange={handleConnectionStringChange}
                placeholder="Paste connection string (hmsc:…)"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="
                  flex-1 px-4 py-3 rounded-md font-mono text-sm
                  bg-surface text-foreground placeholder:text-foreground-subtle
                  border border-border focus:border-accent
                  focus:outline-none focus:ring-2 focus:ring-accent
                "
              />
              <button
                type="button"
                onClick={handlePaste}
                className="px-3 py-3 rounded-md text-sm text-foreground hover:bg-surface-recessed border border-border transition-colors"
                title="Paste from clipboard"
              >
                <span className="treasury-label">Paste</span>
                <span className="console-label">[paste]</span>
              </button>
              <button
                type="button"
                onClick={() => setShowQRScanner(true)}
                className="px-3 py-3 rounded-md text-sm bg-accent text-accent-fg hover:bg-accent-hover transition-colors"
                title="Scan QR code"
              >
                <span className="treasury-label">Scan QR</span>
                <span className="console-label">[scan]</span>
              </button>
            </div>
            <p className="mt-2 text-sm text-foreground-subtle">
              Paste the connection string from your coordinator, or scan the QR code.
            </p>
            {parseError && (
              <p role="alert" className="mt-2 text-sm text-destructive">{parseError}</p>
            )}
          </section>

          {/* Toggle between auto-filled view and manual entry. Console
              renders this as a CLI-style flag (`--manual`) via the
              .manual-toggle class — treasury keeps the prose. */}
          {!showManualForm && (
            <button
              type="button"
              onClick={() => setShowManualForm(true)}
              className="manual-toggle text-sm text-accent hover:underline"
              data-treasury-label="Or enter session details manually →"
              data-console-label="--manual"
            >
              <span className="treasury-label">
                Or enter session details manually →
              </span>
              <span className="console-label">
                --manual
              </span>
            </button>
          )}

          {/* Section 2 — Manual / details */}
          {showManualForm && (
            <section aria-label="Session details" className="space-y-6 pt-2">
              {/* No section label — the field labels (Server URL / Session ID
                  / Session PIN) make the section's purpose self-evident.
                  The auto-fill confirmation badge floats top-right. */}
              {connectionString && (
                <div className="flex justify-end -mb-2">
                  <span className="text-xs text-success-soft-fg flex items-center gap-1.5">
                    <CheckIcon />
                    <span className="treasury-label">Auto-filled from connection string</span>
                    <span className="console-label">connection_string: parsed</span>
                  </span>
                </div>
              )}

              {/* Trust signal for the coordinator URL */}
              {hostTrust && (
                <div
                  role="status"
                  className={`
                    rounded-md border-l-2 pl-4 py-3 text-sm
                    ${hostTrust === 'tunnel'
                      ? 'border-warning bg-warning-soft text-warning-soft-fg'
                      : hostTrust === 'localhost'
                      ? 'border-border-strong bg-surface-recessed text-foreground-muted'
                      : 'border-info bg-info-soft text-info-soft-fg'}
                  `}
                >
                  {hostTrust === 'tunnel' && (
                    <>
                      <strong>Tunnel coordinator detected.</strong> This URL points to a public tunnel
                      (ngrok / localtunnel / cloudflared) relaying to someone else&apos;s computer. The tunnel
                      provider can observe transaction metadata in transit. Only join if you trust the
                      coordinator personally.
                    </>
                  )}
                  {hostTrust === 'localhost' && (
                    <>
                      <strong>Local coordinator.</strong> This URL points to your own machine — fine for
                      testing or LAN-only ceremonies.
                    </>
                  )}
                  {hostTrust === 'unknown' && (
                    <>
                      <strong>Custom coordinator.</strong> Verify with the coordinator that this URL is
                      correct. Look for <code className="font-mono text-xs">wss://</code> for encrypted
                      connections.
                    </>
                  )}
                </div>
              )}

              <Field
                id="serverUrl" name="serverUrl"
                label="Server URL"
                placeholder="wss://multisig.example.com or ws://localhost:3001"
                value={formData.serverUrl}
                onChange={handleChange}
                required
              />

              <Field
                id="sessionId" name="sessionId"
                label="Session ID"
                placeholder="abc123def456"
                mono
                value={formData.sessionId}
                onChange={handleChange}
                required
              />

              <div>
                <Field
                  id="pin" name="pin"
                  label="Session PIN"
                  type="password"
                  placeholder="Enter session PIN"
                  value={formData.pin}
                  onChange={handleChange}
                  required
                />
                {!formData.pin && connectionString && (
                  <p className="mt-1 text-sm text-warning-soft-fg">
                    PIN not included in connection string — please enter it manually.
                  </p>
                )}
              </div>

              {/* Optional display label so other participants and the
                  coordinator see who's signing instead of a generic
                  "Participant" row. CLI signers have always supplied
                  this via --label; web signers couldn't until now. */}
              <Field
                id="label" name="label"
                label="Your name (optional)"
                placeholder="e.g. alice"
                value={formData.label}
                onChange={handleChange}
              />
              <p className="-mt-4 text-xs text-foreground-subtle">
                Shown next to your row in the participant list. The coordinator
                still verifies your signature against the eligible-keys list —
                this is just a friendly label.
              </p>

              <button
                type="submit"
                disabled={!formData.serverUrl || !formData.sessionId || !formData.pin}
                className="
                  cmd w-full px-6 py-3.5 rounded-md text-base font-semibold
                  bg-accent text-accent-fg hover:bg-accent-hover
                  disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                "
              >
                Join Session
              </button>
              <p className="text-xs text-foreground-subtle">
                You&apos;ll need a Hedera wallet (HashPack, Blade, or Kabila) on the next page. After joining,
                you&apos;ll review the transaction before signing — nothing executes until you approve.
              </p>
            </section>
          )}
        </form>

        {/* Connection string format hint — collapsed, minimal */}
        <details className="mt-12 text-xs text-foreground-subtle">
          <summary className="cursor-pointer font-medium text-foreground-muted hover:text-foreground">
            About connection strings
          </summary>
          <p className="mt-2 leading-relaxed">
            Connection strings start with{' '}
            <code className="bg-surface-recessed px-1 rounded font-mono">hmsc:</code>{' '}
            followed by encoded session data. They contain the server URL, session ID, and optionally
            the PIN. Your coordinator will provide this when creating a session.
          </p>
        </details>
      </section>

      <Footer variant="compact" />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

interface FieldProps {
  id: string;
  name: string;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  mono?: boolean;
  required?: boolean;
}

function Field({ id, name, label, placeholder, value, onChange, type = 'text', mono, required }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground mb-2">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className={`
          w-full px-4 py-3 rounded-md
          bg-surface text-foreground placeholder:text-foreground-subtle
          border border-border focus:border-accent
          focus:outline-none focus:ring-2 focus:ring-accent
          ${mono ? 'font-mono' : ''}
        `}
      />
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function Spinner({ large }: { large?: boolean }) {
  return (
    <div
      className={`
        ${large ? 'h-12 w-12 border-2' : 'h-5 w-5 border-2'}
        rounded-full border-current border-r-transparent animate-spin text-accent mx-auto
      `}
      aria-hidden="true"
    />
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center p-8 bg-background">
          <div className="text-center">
            <Spinner large />
            <p className="mt-4 text-foreground-muted">Loading…</p>
          </div>
        </main>
      }
    >
      <JoinPageContent />
    </Suspense>
  );
}
