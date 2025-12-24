/**
 * QR Session Code Component
 *
 * Displays a QR code containing session credentials (server URL, session ID, PIN).
 * Allows mobile users to quickly join sessions by scanning the QR code.
 *
 * QR Code Format (JSON):
 * {
 *   "type": "hedera-multisig-session",
 *   "version": "1.0.0",
 *   "serverUrl": "wss://server.com:3001",
 *   "sessionId": "abc123",
 *   "pin": "456789"
 * }
 */

'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';

export interface QRSessionCodeProps {
  serverUrl: string;
  sessionId: string;
  pin: string;
  size?: number;
  showCredentials?: boolean;
}

export function QRSessionCode({
  serverUrl,
  sessionId,
  pin,
  size = 256,
  showCredentials = true,
}: QRSessionCodeProps) {
  const [copied, setCopied] = useState(false);

  // Generate QR code data
  const qrData = JSON.stringify({
    type: 'hedera-multisig-session',
    version: '1.0.0',
    serverUrl,
    sessionId,
    pin,
  });

  // Copy credentials to clipboard
  const copyCredentials = () => {
    const text = `Server: ${serverUrl}\nSession ID: ${sessionId}\nPIN: ${pin}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col items-center gap-6 p-6 bg-white rounded-lg border-2 border-gray-200">
      {/* Title */}
      <div className="text-center">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Join Session</h3>
        <p className="text-sm text-gray-600">Scan with mobile device or enter credentials manually</p>
      </div>

      {/* QR Code */}
      <div className="p-4 bg-white rounded-lg border-2 border-gray-300 shadow-sm">
        <QRCodeSVG
          value={qrData}
          size={size}
          level="H"
          includeMargin={true}
          bgColor="#ffffff"
          fgColor="#000000"
        />
      </div>

      {/* Credentials (optional) */}
      {showCredentials && (
        <div className="w-full max-w-md space-y-3">
          <div className="text-center text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">
            Or enter manually:
          </div>

          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
            <div className="text-xs text-gray-500 mb-1">Server URL</div>
            <div className="text-sm font-mono text-gray-900 break-all">{serverUrl}</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <div className="text-xs text-gray-500 mb-1">Session ID</div>
              <div className="text-sm font-mono text-gray-900 font-semibold">{sessionId}</div>
            </div>

            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <div className="text-xs text-gray-500 mb-1">PIN</div>
              <div className="text-sm font-mono text-gray-900 font-semibold">{pin}</div>
            </div>
          </div>

          {/* Copy Button */}
          <button
            onClick={copyCredentials}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy Credentials
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * QR Scanner Component (for mobile)
 *
 * Allows users to scan a QR code and auto-fill session credentials.
 */
export interface QRScanResult {
  serverUrl: string;
  sessionId: string;
  pin: string;
}

export function QRScanButton({ onScan }: { onScan: (result: QRScanResult) => void }) {
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // Note: QR code scanning from images requires additional library (jsQR)
      // For now, this is a placeholder for future implementation
      console.log('QR scanning from file upload - requires jsQR library');
      alert('QR scanning from file upload is not yet implemented. Please enter credentials manually.');
    } catch (error) {
      console.error('Failed to scan QR code:', error);
      alert('Failed to scan QR code. Please enter credentials manually.');
    }
  };

  return (
    <div className="text-center">
      <label className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors cursor-pointer text-sm font-medium">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
        </svg>
        Scan QR Code
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileUpload}
          className="sr-only"
        />
      </label>
      <p className="text-xs text-gray-500 mt-2">
        Take a photo of the QR code to join
      </p>
    </div>
  );
}
