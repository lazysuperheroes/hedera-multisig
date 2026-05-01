'use client';

import { useState, useCallback } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';

interface QRScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [error, setError] = useState<string | null>(null);

  const handleScan = useCallback(
    (detectedCodes: { rawValue: string }[]) => {
      if (detectedCodes && detectedCodes.length > 0) {
        const data = detectedCodes[0].rawValue;
        if (data) onScan(data);
      }
    },
    [onScan]
  );

  const handleError = useCallback((err: unknown) => {
    console.error('QR Scanner error:', err);
    if (err instanceof Error) {
      if (err.name === 'NotAllowedError') {
        setError('Camera access denied. Please allow camera access to scan QR codes.');
      } else if (err.name === 'NotFoundError') {
        setError('No camera found. Please ensure your device has a camera.');
      } else {
        setError(`Camera error: ${err.message}`);
      }
    } else {
      setError('An error occurred while accessing the camera.');
    }
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--scrim)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-dialog-title"
    >
      <div className="bg-surface border border-border rounded-md p-4 max-w-md w-full mx-4 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 id="qr-dialog-title" className="font-heading text-lg font-semibold text-foreground">
            Scan QR code
          </h3>
          <button
            onClick={onClose}
            aria-label="Close scanner"
            className="p-2 text-foreground-subtle hover:text-foreground hover:bg-surface-recessed rounded-md transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        {error ? (
          <div role="alert" className="border-l-2 border-destructive bg-destructive-soft pl-4 py-3 rounded-md">
            <p className="text-sm text-destructive-soft-fg">{error}</p>
            <button
              onClick={onClose}
              className="mt-3 px-4 py-2 bg-destructive text-accent-fg text-sm font-semibold rounded-md hover:opacity-90"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-md">
            <Scanner
              onScan={handleScan}
              onError={handleError}
              constraints={{ facingMode: 'environment' }}
              styles={{
                container: { width: '100%', paddingTop: '100%', position: 'relative' },
                video: {
                  position: 'absolute', top: 0, left: 0,
                  width: '100%', height: '100%', objectFit: 'cover',
                },
              }}
            />
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-4 border-2 border-accent rounded-md opacity-50" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-4 border-accent rounded-md">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-accent rounded-tl-md" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-accent rounded-tr-md" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-accent rounded-bl-md" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-accent rounded-br-md" />
              </div>
            </div>
          </div>
        )}

        {!error && (
          <p className="text-sm text-foreground-muted text-center mt-4">
            Point your camera at the QR code from your coordinator
          </p>
        )}

        <button
          onClick={onClose}
          className="w-full mt-4 px-4 py-2 bg-surface-recessed text-foreground rounded-md hover:bg-border transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default QRScanner;
