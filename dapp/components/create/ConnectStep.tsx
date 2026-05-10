'use client';

const inputClass =
  'w-full px-4 py-3 rounded-md border border-border bg-surface text-foreground ' +
  'placeholder:text-foreground-subtle focus:border-accent focus:outline-none ' +
  'focus:ring-2 focus:ring-accent transition-colors';

const labelClass =
  'block text-sm font-medium text-foreground-muted mb-2';

// Connect form is a flat section. Treasury sees no card chrome (matches
// /join's centerpiece pattern); console keeps the .console-pane class
// so the terminal-window header strip ("~/connect.session") still
// renders via globals.css. shadow-sm dropped — drop-shadows on
// non-modal surfaces are the brand's anti-pattern.
const cardClass = 'console-pane';

// Primary CTA — matches /join's Connect button: cmd hero-cta-primary,
// semantic text-accent-fg (was text-white literal), no drop-shadow
// (was shadow-lg). The treasury → arrow is rendered inline by the
// caller via <span className="treasury-label opacity-70">.
const primaryBtnClass =
  'cmd hero-cta-primary w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 ' +
  'rounded-md text-base font-semibold bg-accent text-accent-fg ' +
  'hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

interface ConnectStepProps {
  serverUrl: string;
  onServerUrlChange: (v: string) => void;
  sessionId: string;
  onSessionIdChange: (v: string) => void;
  pin: string;
  onPinChange: (v: string) => void;
  coordinatorToken: string;
  onCoordinatorTokenChange: (v: string) => void;
  connectionString: string;
  onConnectionStringChange: (v: string) => void;
  onPasteConnectionString: () => void;
  connectionStringError: string | null;
  connectionStringFilled: boolean;
  isConnecting: boolean;
  connectError: string | null;
  onConnect: () => void;
}

export function ConnectStep({
  serverUrl,
  onServerUrlChange,
  sessionId,
  onSessionIdChange,
  pin,
  onPinChange,
  coordinatorToken,
  onCoordinatorTokenChange,
  connectionString,
  onConnectionStringChange,
  onPasteConnectionString,
  connectionStringError,
  connectionStringFilled,
  isConnecting,
  connectError,
  onConnect,
}: ConnectStepProps) {
  return (
    <section
      aria-label="Connect to session"
      className={cardClass}
      data-pane-label="~/connect.session"
    >
      {/* H2 + body description hidden in console — pane label `~/connect.session`
          already names the section, and engineers don't need the long-form
          intro that treasury keeps. */}
      <h2 className="console-hide text-lg font-semibold text-foreground mb-6">
        Session Credentials
      </h2>
      <p className="console-hide text-sm text-foreground-subtle mb-6">
        Enter the credentials for a session that was created via the CLI
        server command. You will authenticate as the coordinator.
      </p>
      <div className="space-y-5">
        {/* Quick-connect: paste the HMSC string from the CLI to auto-fill
            Server URL, Session ID, and PIN. The Coordinator Token isn't in
            the HMSC and must still be entered manually below. */}
        <div className="form-row">
          <label htmlFor="connStr" className={labelClass}>
            Connection string{' '}
            <span className="font-normal text-foreground-subtle">
              (optional shortcut)
            </span>
          </label>
          <div className="flex gap-2">
            <input
              id="connStr"
              type="text"
              className={inputClass + ' font-mono text-sm'}
              placeholder="hmsc:… (auto-fills Server URL, Session ID, PIN)"
              value={connectionString}
              onChange={(e) => onConnectionStringChange(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={onPasteConnectionString}
              className="px-4 py-3 rounded-lg text-sm text-foreground hover:bg-surface-recessed border border-border-strong transition-colors whitespace-nowrap"
              title="Paste from clipboard"
            >
              Paste
            </button>
          </div>
          {connectionStringError ? (
            <p
              role="alert"
              className="form-hint mt-1.5 text-xs text-destructive"
            >
              {connectionStringError}
            </p>
          ) : connectionStringFilled ? (
            <p className="form-hint mt-1.5 text-xs text-success-soft-fg">
              Auto-filled from connection string — Coordinator Token still
              required below.
            </p>
          ) : (
            <p className="form-hint mt-1.5 text-xs text-foreground-subtle">
              Paste the <code className="font-mono">hmsc:</code> string
              from the CLI server output. Or skip and fill the fields
              below manually.
            </p>
          )}
        </div>

        <div className="form-row">
          <label htmlFor="serverUrl" className={labelClass}>
            Server URL
          </label>
          <input
            id="serverUrl"
            type="text"
            className={inputClass}
            placeholder="ws://localhost:3001"
            value={serverUrl}
            onChange={(e) => onServerUrlChange(e.target.value)}
            autoComplete="url"
            spellCheck={false}
            required
          />
        </div>

        <div className="form-row">
          <label htmlFor="sessionId" className={labelClass}>
            Session ID
          </label>
          <input
            id="sessionId"
            type="text"
            className={inputClass + ' font-mono'}
            placeholder="Paste session ID from server output"
            value={sessionId}
            onChange={(e) => onSessionIdChange(e.target.value.trim())}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            required
          />
        </div>

        <div className="form-row">
          <label htmlFor="pin" className={labelClass}>
            Session PIN
          </label>
          <input
            id="pin"
            type="text"
            className={inputClass + ' font-mono tracking-widest'}
            placeholder="XXXXXXXX"
            value={pin}
            onChange={(e) => onPinChange(e.target.value.trim())}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            required
          />
        </div>

        <div className="form-row">
          <label htmlFor="coordToken" className={labelClass}>
            Coordinator Token
          </label>
          <input
            id="coordToken"
            type="password"
            className={inputClass + ' font-mono'}
            placeholder="Coordinator token from server output"
            value={coordinatorToken}
            onChange={(e) => onCoordinatorTokenChange(e.target.value.trim())}
            autoComplete="off"
            spellCheck={false}
            required
          />
          <p className="form-hint mt-1 text-xs text-foreground-subtle">
            The coordinator token is separate from the participant PIN
            and grants elevated privileges.
          </p>
        </div>

        {connectError && (
          <div
            role="alert"
            className="border-l-2 border-destructive bg-destructive-soft pl-4 py-3 text-sm text-destructive-soft-fg rounded-r-md"
          >
            {connectError}
          </div>
        )}

        <button
          type="button"
          onClick={onConnect}
          disabled={isConnecting || !serverUrl || !sessionId || !pin || !coordinatorToken}
          className={primaryBtnClass}
        >
          {isConnecting && (
            <span className="inline-block w-4 h-4 rounded-full border-2 border-current border-r-transparent animate-spin" />
          )}
          {isConnecting ? 'Connecting…' : 'Connect as coordinator'}
          {!isConnecting && <span className="treasury-label opacity-70">→</span>}
        </button>
      </div>
    </section>
  );
}
