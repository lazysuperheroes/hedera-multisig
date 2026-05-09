'use client';

import { useState, useEffect, Suspense, lazy } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Footer } from '../../components/Footer';
import { Icon } from '../../components/Icon';

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

  // Hydrate form state from URL parameters. "External system → React"
  // is the canonical use of useEffect.
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

    try {
      sessionStorage.setItem('hedera-multisig-pending-join', JSON.stringify(formData));
    } catch {}
    try { localStorage.removeItem('hedera-multisig-session-info'); } catch {}

    router.push(`/session/${formData.sessionId}`);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // Classify the coordinator URL by trust signal — drives the warning
  // panel under the manual form.
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
      {/* QR Scanner Modal — flat fallback, no card. The scrim itself
          is the surface; wrapping a spinner in a bordered box adds
          card-reflex weight that the brand asks against. */}
      {showQRScanner && (
        <Suspense
          fallback={
            <div
              className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4"
              style={{ background: 'var(--scrim)' }}
            >
              <Spinner large />
              <p className="text-foreground-muted">Loading camera…</p>
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

        {/* Header — H1 + a quiet sub-line that earns its place by
            describing the action sequence about to happen. Treasury
            only; console renders the H1 as a `$` prompt and the
            wordy orientation prose dilutes that. */}
        <header className="mb-10">
          <h1 className="page-hero font-heading text-4xl sm:text-5xl font-bold tracking-tight text-foreground leading-[1.05]">
            Join a signing session
          </h1>
          <p className="console-hide mt-4 text-base text-foreground-muted leading-relaxed max-w-md">
            Connect to your coordinator. Review the transaction in your
            wallet before approving.
          </p>
        </header>

        <form onSubmit={handleSubmit}>

          {/* CENTERPIECE — connection-string input. The single most
              common entry path: paste the string, optionally scan,
              fall through to manual only if neither lands. The
              auxiliary buttons are equal-weight (no accent fill)
              because the input itself IS the action; they're just
              alternative ways to populate it. Accent-fill is
              reserved exclusively for the Connect submit at the
              bottom of the manual form. */}
          <section aria-label="Connect by connection string">
            <label
              htmlFor="connectionString"
              className="block text-xs uppercase tracking-wider font-medium text-foreground-muted mb-3"
            >
              <span className="treasury-label">Connection string</span>
              <span className="console-label">connection_string</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                id="connectionString"
                value={connectionString}
                onChange={handleConnectionStringChange}
                placeholder="hmsc:eyJzZXJ2ZXJVcmwiOiJ3c3M6Ly8…"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className="
                  flex-1 px-5 py-4 rounded-md font-mono text-base
                  bg-surface text-foreground placeholder:text-foreground-subtle
                  border border-border focus:border-accent
                  focus:outline-none focus:ring-2 focus:ring-accent
                "
              />
              <button
                type="button"
                onClick={handlePaste}
                className="px-4 py-4 rounded-md text-sm text-foreground-muted hover:text-foreground hover:bg-surface-recessed border border-border transition-colors"
                title="Paste from clipboard"
                aria-label="Paste from clipboard"
              >
                <span className="treasury-label">Paste</span>
                <span className="console-label">[paste]</span>
              </button>
              <button
                type="button"
                onClick={() => setShowQRScanner(true)}
                className="px-4 py-4 rounded-md text-sm text-foreground-muted hover:text-foreground hover:bg-surface-recessed border border-border transition-colors"
                title="Scan QR code"
                aria-label="Scan QR code"
              >
                <span className="treasury-label">Scan QR</span>
                <span className="console-label">[scan]</span>
              </button>
            </div>
            <p className="console-hide mt-3 text-sm text-foreground-subtle">
              Paste the connection string from your coordinator, or
              scan its QR code.
            </p>
            {parseError && (
              <p role="alert" className="mt-3 text-sm text-destructive">{parseError}</p>
            )}
          </section>

          {/* Section break — when the manual form is closed, this
              acts as a decisive divider into the secondary path.
              When the form is open (URL params, parsed string,
              user-clicked), the divider is replaced by the form
              itself preceded by a smaller, less prominent header. */}
          {!showManualForm && (
            <div className="mt-12 flex items-center gap-4 text-sm text-foreground-muted">
              <hr className="flex-1 border-t border-border" />
              <button
                type="button"
                onClick={() => setShowManualForm(true)}
                className="text-foreground-muted hover:text-foreground transition-colors"
              >
                <span className="treasury-label">or enter session details manually</span>
                <span className="console-label">--manual</span>
              </button>
              <hr className="flex-1 border-t border-border" />
            </div>
          )}

          {/* MANUAL FORM — the secondary path. Stays collapsed until
              the user opts in (link), pastes a parseable string
              (auto-opens), or arrives via URL params (auto-opens).
              No section H2 here; the field labels carry the
              section's purpose, and adding one would compete with
              the centerpiece for attention. */}
          {showManualForm && (
            <section aria-label="Session details" className="mt-12 space-y-6">
              {connectionString && (
                <div className="flex justify-end -mb-2">
                  <span className="text-xs text-success-soft-fg flex items-center gap-1.5">
                    <Icon name="check_circle" size={14} fill={1} className="text-success" />
                    <span className="treasury-label">Auto-filled from connection string</span>
                    <span className="console-label">connection_string: parsed</span>
                  </span>
                </div>
              )}

              {/* Trust signal for the coordinator URL. Tunnel case
                  uses border-l-4 — that's the case where the user
                  most needs to read it; whisper-thin 2px would let
                  it slide past. */}
              {hostTrust && (
                <div
                  role="status"
                  className={`
                    rounded-md pl-4 py-3 text-sm
                    ${hostTrust === 'tunnel'
                      ? 'border-l-4 border-warning bg-warning-soft text-warning-soft-fg'
                      : hostTrust === 'localhost'
                      ? 'border-l-2 border-border-strong bg-surface-recessed text-foreground-muted'
                      : 'border-l-2 border-info bg-info-soft text-info-soft-fg'}
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

              {/* Optional display label. Lighter affordance than the
                  required fields above — small label, demoted intro
                  line. Treasury operators usually skip; CLI signers
                  have always set it via --label. */}
              <Field
                id="label" name="label"
                label="Your name (optional)"
                placeholder="e.g. alice"
                value={formData.label}
                onChange={handleChange}
              />
              <p className="console-hide -mt-4 text-xs text-foreground-subtle">
                Shown next to your row in the participant list. The
                coordinator still verifies your signature against the
                eligible-keys list — this is just a friendly label.
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
                Connect
              </button>

              {/* Action preview — what comes next, in three concrete
                  steps. Replaces the previous footnote-flavoured
                  copy with structured information that helps the
                  user form an expectation of the flow. */}
              <ol className="console-checklist mt-2 space-y-1.5 text-xs text-foreground-subtle list-decimal list-inside marker:text-foreground-muted">
                <li>Connect a Hedera wallet (HashPack, Blade, or Kabila)</li>
                <li>Review the transaction details in the dApp and your wallet</li>
                <li>Approve to sign — the coordinator collects, the network confirms</li>
              </ol>
            </section>
          )}
        </form>

        {/* Tertiary helper — collapsed by default, opens to a one-paragraph
            primer for first-time visitors who don't yet know what a
            connection string is. */}
        <details className="mt-12 text-xs text-foreground-subtle">
          <summary className="cursor-pointer font-medium text-foreground-muted hover:text-foreground">
            What&apos;s a connection string?
          </summary>
          <p className="mt-2 leading-relaxed">
            A short token starting with{' '}
            <code className="bg-surface-recessed px-1 rounded font-mono">hmsc:</code>{' '}
            that bundles the coordinator&apos;s server URL, the session
            ID, and (optionally) the PIN. Your coordinator generates
            it when they create the session and shares it via Slack,
            email, or a QR code. Paste it above to auto-fill the
            session details.
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
