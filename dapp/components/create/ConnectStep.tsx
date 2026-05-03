'use client';

const inputClass =
  'w-full px-4 py-3 border border-border-strong rounded-lg ' +
  'focus:border-accent ' +
  'bg-surface text-foreground ' +
  'placeholder:text-foreground-subtle';

const labelClass =
  'block text-sm font-medium text-foreground-muted mb-2';

const cardClass =
  'console-pane bg-surface rounded-lg shadow-sm border border-border p-6';

const primaryBtnClass =
  'cmd w-full px-6 py-4 bg-accent text-white font-semibold rounded-lg shadow-lg ' +
  'hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
  'flex items-center justify-center gap-2';

interface ConnectStepProps {
  serverUrl: string;
  onServerUrlChange: (v: string) => void;
  sessionId: string;
  onSessionIdChange: (v: string) => void;
  pin: string;
  onPinChange: (v: string) => void;
  coordinatorToken: string;
  onCoordinatorTokenChange: (v: string) => void;
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
            className="p-3 bg-destructive-soft border border-destructive/40 rounded-lg text-sm text-destructive-soft-fg"
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
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
          )}
          {isConnecting ? 'Connecting...' : 'Connect as Coordinator'}
        </button>
      </div>
    </section>
  );
}
