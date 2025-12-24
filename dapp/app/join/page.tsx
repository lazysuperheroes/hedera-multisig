'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function JoinPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    serverUrl: '',
    sessionId: '',
    pin: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

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

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-gradient-to-b from-gray-50 to-gray-100">
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
            Enter the session details provided by your coordinator
          </p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-lg shadow-lg p-8">
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
              <p className="mt-1 text-sm text-gray-500">
                The WebSocket server URL from your coordinator
              </p>
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
              <p className="mt-1 text-sm text-gray-500">
                Unique identifier for the signing session
              </p>
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
              <p className="mt-1 text-sm text-gray-500">
                Authentication PIN for this session
              </p>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="w-full px-6 py-4 bg-blue-600 text-white font-semibold rounded-lg shadow-lg hover:bg-blue-700 transition-colors"
            >
              Continue to Session
            </button>
          </form>
        </div>

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
      </div>
    </main>
  );
}
