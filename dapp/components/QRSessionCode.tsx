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
import { Icon } from './Icon';

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
    <div className="flex flex-col items-center gap-6 p-6 bg-background">
      {/* Title — flat, no card chrome around the QR component itself.
          The component is typically rendered inside a parent surface
          (modal or page section) that already provides the boundary. */}
      <div className="text-center">
        <h3 className="font-heading text-lg font-bold text-foreground mb-1">Join session</h3>
        <p className="text-sm text-foreground-muted">Scan with mobile device or enter credentials manually</p>
      </div>

      {/* QR Code — keep the surrounding white background as a tight
          frame for scanability (QR scanners expect high-contrast on
          #fff). Drop the heavy border-2 + drop-shadow card chrome. */}
      <div className="p-4 bg-white rounded-md border border-border">
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
          <div className="text-center text-xs text-foreground-subtle uppercase tracking-wide font-medium mb-2">
            Or enter manually:
          </div>

          <div className="bg-surface-recessed rounded-lg p-3 border border-border">
            <div className="text-xs text-foreground-subtle mb-1">Server URL</div>
            <div className="text-sm font-mono text-foreground break-all">{serverUrl}</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-recessed rounded-lg p-3 border border-border">
              <div className="text-xs text-foreground-subtle mb-1">Session ID</div>
              <div className="text-sm font-mono text-foreground font-semibold">{sessionId}</div>
            </div>

            <div className="bg-surface-recessed rounded-lg p-3 border border-border">
              <div className="text-xs text-foreground-subtle mb-1">PIN</div>
              <div className="text-sm font-mono text-foreground font-semibold">{pin}</div>
            </div>
          </div>

          {/* Copy Button */}
          <button
            onClick={copyCredentials}
            className="cmd w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-accent text-accent-fg hover:bg-accent-hover transition-colors"
          >
            <Icon name={copied ? 'check' : 'content_copy'} size={16} />
            {copied ? 'Copied!' : 'Copy credentials'}
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
      alert('QR scanning from file uploads is not yet supported. Please enter credentials manually.');
    } catch (error) {
      console.error('Failed to scan QR code:', error);
      alert('Failed to scan QR code. Please enter credentials manually.');
    }
  };

  return (
    <div className="text-center">
      <label className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-accent text-accent-fg hover:bg-accent-hover transition-colors cursor-pointer">
        <Icon name="qr_code_scanner" size={18} />
        Scan QR code
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileUpload}
          className="sr-only"
        />
      </label>
      <p className="text-xs text-foreground-subtle mt-2">
        Take a photo of the QR code to join
      </p>
    </div>
  );
}
