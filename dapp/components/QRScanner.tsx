'use client';

import { useState, useCallback } from 'react';
import { Scanner } from '@yudiel/react-qr-scanner';

interface QRScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

export function QRScanner({ onScan, onClose }: QRScannerProps) {
  const [error, setError] = useState<string | null>(null);

  const handleScan = useCallback((detectedCodes: { rawValue: string }[]) => {
    if (detectedCodes && detectedCodes.length > 0) {
      const data = detectedCodes[0].rawValue;
      if (data) {
        onScan(data);
      }
    }
  }, [onScan]);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="bg-white rounded-lg p-4 max-w-md w-full mx-4 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Scan QR Code</h3>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scanner */}
        {error ? (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-center">
            <svg className="w-12 h-12 text-red-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-red-700 text-sm">{error}</p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-lg">
            <Scanner
              onScan={handleScan}
              onError={handleError}
              constraints={{
                facingMode: 'environment',
              }}
              styles={{
                container: {
                  width: '100%',
                  paddingTop: '100%', // 1:1 aspect ratio
                  position: 'relative',
                },
                video: {
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                },
              }}
            />
            {/* Scanning overlay */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-4 border-2 border-blue-500 rounded-lg opacity-50" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-4 border-blue-500 rounded-lg">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-500 rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-500 rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-500 rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-500 rounded-br-lg" />
              </div>
            </div>
          </div>
        )}

        {/* Instructions */}
        {!error && (
          <p className="text-sm text-gray-600 text-center mt-4">
            Point your camera at the QR code from your coordinator
          </p>
        )}

        {/* Cancel button */}
        <button
          onClick={onClose}
          className="w-full mt-4 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default QRScanner;
