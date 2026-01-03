'use client';

import { useState, useEffect, Suspense, lazy } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

// Lazy load QR scanner to avoid SSR issues
const QRScanner = lazy(() => import('../../components/QRScanner'));

/**
 * Parse a connection string (hmsc:base64) into components
 * Format: hmsc:base64(JSON) where JSON = {s: serverUrl, i: sessionId, p?: pin}
 */
function parseConnectionString(connStr: string): { serverUrl: string; sessionId: string; pin?: string } | null {
  try {
    // Check for hmsc: prefix
    if (!connStr.startsWith('hmsc:')) {
      return null;
    }

    const base64 = connStr.slice(5); // Remove 'hmsc:' prefix
    const json = Buffer.from(base64, 'base64').toString('utf8');
    const data = JSON.parse(json);

    if (!data.s || !data.i) {
      return null;
    }

    return {
      serverUrl: data.s,
      sessionId: data.i,
      pin: data.p || undefined,
    };
  } catch {
    return null;
  }
}

function JoinPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [formData, setFormData] = useState({
    serverUrl: '',
    sessionId: '',
    pin: '',
  });
  const [connectionString, setConnectionString] = useState('');
  const [showManualForm, setShowManualForm] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);

  // Check for URL parameters on load
  useEffect(() => {
    const server = searchParams.get('server') || searchParams.get('s');
    const session = searchParams.get('session') || searchParams.get('id') || searchParams.get('i');
    const pin = searchParams.get('pin') || searchParams.get('p');

    if (server && session) {
      setFormData({
        serverUrl: server,
        sessionId: session,
        pin: pin || '',
      });
      setShowManualForm(true);

      // If all fields are provided via URL, show a message
      if (pin) {
        // Auto-submit after a brief delay to show the user what's happening
        // Or just show filled form for confirmation
      }
    }
  }, [searchParams]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    if (!formData.serverUrl || !formData.sessionId || !formData.pin) {
      return;
    }

    // Store session info in localStorage for the session page
    localStorage.setItem('hedera-multisig-session-info', JSON.stringify(formData));

    // Navigate to session page
    router.push(`/session/${formData.sessionId}`);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleConnectionStringChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.trim();
    setConnectionString(value);
    setParseError(null);

    if (!value) {
      return;
    }

    const parsed = parseConnectionString(value);
    if (parsed) {
      setFormData({
        serverUrl: parsed.serverUrl,
        sessionId: parsed.sessionId,
        pin: parsed.pin || '',
      });
      setShowManualForm(true);

      // If PIN is included, we could auto-submit, but let's show the form for confirmation
    } else {
      setParseError('Invalid connection string format');
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const parsed = parseConnectionString(text.trim());
        if (parsed) {
          setConnectionString(text.trim());
          setFormData({
            serverUrl: parsed.serverUrl,
            sessionId: parsed.sessionId,
            pin: parsed.pin || '',
          });
          setShowManualForm(true);
          setParseError(null);
        } else {
          setParseError('Clipboard does not contain a valid connection string');
        }
      }
    } catch {
      setParseError('Could not read from clipboard');
    }
  };

  const handleQRScan = (data: string) => {
    setShowQRScanner(false);
    const parsed = parseConnectionString(data.trim());
    if (parsed) {
      setConnectionString(data.trim());
      setFormData({
        serverUrl: parsed.serverUrl,
        sessionId: parsed.sessionId,
        pin: parsed.pin || '',
      });
      setShowManualForm(true);
      setParseError(null);
    } else {
      setParseError('QR code does not contain a valid connection string');
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-gradient-to-b from-gray-50 to-gray-100">
      {/* QR Scanner Modal */}
      {showQRScanner && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
            <div className="bg-white p-8 rounded-lg">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading camera...</p>
            </div>
          </div>
        }>
          <QRScanner
            onScan={handleQRScan}
            onClose={() => setShowQRScanner(false)}
          />
        </Suspense>
      )}

      <div className="max-w-2xl w-full space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <Link href="/" className="text-blue-600 hover:underline text-sm">
            ← Back to Home
          </Link>
          <h1 className="text-4xl font-bold text-gray-900">
            Join Signing Session
          </h1>
          <p className="text-gray-600">
            Paste a connection string or enter session details manually
          </p>
        </div>

        {/* Quick Connect - Connection String */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Quick Connect</h2>

          <div className="space-y-4">
            {/* Connection String Input */}
            <div>
              <label htmlFor="connectionString" className="block text-sm font-medium text-gray-700 mb-2">
                Connection String
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  id="connectionString"
                  value={connectionString}
                  onChange={handleConnectionStringChange}
                  placeholder="hmsc:eyJzIjoi..."
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder:text-gray-400 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={handlePaste}
                  className="px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
                  title="Paste from clipboard"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Paste
                </button>
                <button
                  type="button"
                  onClick={() => setShowQRScanner(true)}
                  className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                  title="Scan QR code"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                  </svg>
                  Scan
                </button>
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Paste the connection string from your coordinator, or scan the QR code
              </p>
              {parseError && (
                <p className="mt-1 text-sm text-red-600">{parseError}</p>
              )}
            </div>

            {/* Toggle for manual entry */}
            {!showManualForm && (
              <button
                type="button"
                onClick={() => setShowManualForm(true)}
                className="text-sm text-blue-600 hover:text-blue-800 underline"
              >
                Enter details manually instead
              </button>
            )}
          </div>
        </div>

        {/* Manual Form */}
        {showManualForm && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-800">Session Details</h2>
              {connectionString && (
                <span className="text-sm text-green-600 flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Auto-filled from connection string
                </span>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Server URL */}
              <div>
                <label htmlFor="serverUrl" className="block text-sm font-medium text-gray-700 mb-2">
                  WebSocket Server URL
                </label>
                <input
                  type="text"
                  id="serverUrl"
                  name="serverUrl"
                  value={formData.serverUrl}
                  onChange={handleChange}
                  placeholder="ws://localhost:3001 or wss://example.com"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder:text-gray-400"
                  required
                />
              </div>

              {/* Session ID */}
              <div>
                <label htmlFor="sessionId" className="block text-sm font-medium text-gray-700 mb-2">
                  Session ID
                </label>
                <input
                  type="text"
                  id="sessionId"
                  name="sessionId"
                  value={formData.sessionId}
                  onChange={handleChange}
                  placeholder="abc123def456"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder:text-gray-400 font-mono"
                  required
                />
              </div>

              {/* PIN */}
              <div>
                <label htmlFor="pin" className="block text-sm font-medium text-gray-700 mb-2">
                  Session PIN
                </label>
                <input
                  type="password"
                  id="pin"
                  name="pin"
                  value={formData.pin}
                  onChange={handleChange}
                  placeholder="Enter session PIN"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900 placeholder:text-gray-400"
                  required
                />
                {!formData.pin && connectionString && (
                  <p className="mt-1 text-sm text-yellow-600">
                    PIN not included in connection string - please enter it manually
                  </p>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!formData.serverUrl || !formData.sessionId || !formData.pin}
                className="w-full px-6 py-4 bg-blue-600 text-white font-semibold rounded-lg shadow-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue to Session
              </button>
            </form>
          </div>
        )}

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="font-semibold text-blue-900 mb-2">What happens next?</h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800">
            <li>Connect your Hedera wallet via WalletConnect</li>
            <li>Join the signing session with the provided credentials</li>
            <li>Review the transaction details (verified and unverified data)</li>
            <li>Approve and sign the transaction with your wallet</li>
            <li>Wait for other participants to meet the signature threshold</li>
          </ol>
        </div>

        {/* Connection String Format Info */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-gray-600">
          <details>
            <summary className="cursor-pointer font-medium text-gray-700">About connection strings</summary>
            <p className="mt-2">
              Connection strings start with <code className="bg-gray-200 px-1 rounded">hmsc:</code> followed by encoded session data.
              They contain the server URL, session ID, and optionally the PIN. Your coordinator will provide this when creating a session.
            </p>
          </details>
        </div>
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center p-8 bg-gradient-to-b from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </main>
    }>
      <JoinPageContent />
    </Suspense>
  );
}
