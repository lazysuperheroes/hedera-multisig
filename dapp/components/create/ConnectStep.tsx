'use client';

const inputClass =
  'w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg ' +
  'focus:ring-2 focus:ring-blue-500 focus:border-transparent ' +
  'bg-white dark:bg-gray-700 text-gray-900 dark:text-white ' +
  'placeholder:text-gray-400 dark:placeholder:text-gray-500';

const labelClass =
  'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2';

const cardClass =
  'bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6';

const primaryBtnClass =
  'w-full px-6 py-4 bg-blue-600 text-white font-semibold rounded-lg shadow-lg ' +
  'hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
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
    <section aria-label="Connect to session" className={cardClass}>
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-6">
        Session Credentials
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Enter the credentials for a session that was created via the CLI
        server command. You will authenticate as the coordinator.
      </p>
      <div className="space-y-5">
        <div>
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
            required
          />
        </div>

        <div>
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
            required
          />
        </div>

        <div>
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
            required
          />
        </div>

        <div>
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
            required
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            The coordinator token is separate from the participant PIN
            and grants elevated privileges.
          </p>
        </div>

        {connectError && (
          <div
            role="alert"
            className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300"
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
