/**
 * Wallet Selection Dialog
 *
 * Modal for selecting wallet connection method:
 * - Desktop: Shows detected extensions (HashPack, Blade, etc.) + WalletConnect
 * - Mobile: Shows WalletConnect QR code option
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useWallet } from '../hooks/useWallet';
import { QRCodeSVG } from 'qrcode.react';

export interface WalletSelectionDialogProps {
  open: boolean;
  onClose: () => void;
}

export function WalletSelectionDialog({ open, onClose }: WalletSelectionDialogProps) {
  const { extensions, isInitialized, connect, isConnecting, refreshExtensions } = useWallet();
  const [isMobile, setIsMobile] = useState(false);
  const [isWaitingForExtensions, setIsWaitingForExtensions] = useState(false);
  const [walletConnectUri, setWalletConnectUri] = useState<string | null>(null);
  const [showQRCode, setShowQRCode] = useState(false);

  // Detect mobile
  useEffect(() => {
    const checkMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    setIsMobile(checkMobile);
  }, []);

  // Trigger extension discovery when dialog opens
  useEffect(() => {
    if (open && isInitialized && !isMobile) {
      console.log('Wallet dialog opened, triggering extension discovery...');
      refreshExtensions();
    }
  }, [open, isInitialized, isMobile, refreshExtensions]);

  // Wait for extensions to load (up to 3 seconds)
  useEffect(() => {
    if (open && isInitialized && extensions.length === 0 && !isMobile) {
      setIsWaitingForExtensions(true);

      const timer = setTimeout(() => {
        setIsWaitingForExtensions(false);
      }, 3000);

      return () => clearTimeout(timer);
    } else if (extensions.length > 0) {
      setIsWaitingForExtensions(false);
    }
  }, [open, isInitialized, extensions.length, isMobile]);

  // Reset QR code state when dialog closes
  useEffect(() => {
    if (!open) {
      setWalletConnectUri(null);
      setShowQRCode(false);
    }
  }, [open]);

  // Handle URI callback for QR code display
  const handleUriGenerated = useCallback((uri: string) => {
    console.log('📱 WalletConnect URI received for QR display');
    setWalletConnectUri(uri);
  }, []);

  const handleConnect = async (extensionId?: string) => {
    try {
      if (extensionId) {
        // Direct extension connection
        await connect(extensionId);
        onClose();
      } else {
        // QR code flow - show QR first, then wait for connection
        setShowQRCode(true);
        await connect(undefined, handleUriGenerated);
        // Connection successful - close dialog
        onClose();
      }
    } catch (error) {
      console.error('Failed to connect:', error);
      // Reset QR state on error
      setWalletConnectUri(null);
      setShowQRCode(false);
    }
  };

  const handleBackToOptions = () => {
    setShowQRCode(false);
    setWalletConnectUri(null);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Connect Wallet
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mobile Alert */}
        {isMobile && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <span className="font-semibold">Tip:</span> For the best experience, use your mobile wallet app's built-in browser.
            </p>
          </div>
        )}

        {/* Description */}
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          Connect your Hedera wallet to sign multi-signature transactions securely.
        </p>

        {/* Wallet Options */}
        <div className="space-y-3">
          {showQRCode ? (
            // QR Code View
            <div className="text-center">
              <button
                onClick={handleBackToOptions}
                className="mb-4 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to options
              </button>

              {walletConnectUri ? (
                <div className="space-y-4">
                  <div className="bg-white p-4 rounded-lg inline-block">
                    <QRCodeSVG
                      value={walletConnectUri}
                      size={200}
                      level="M"
                      includeMargin={true}
                    />
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Scan this QR code with your mobile wallet app
                  </p>
                  <p className="text-xs text-gray-500">
                    Works with HashPack, Blade, and other WalletConnect-compatible wallets
                  </p>
                </div>
              ) : (
                <div className="py-8">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    Generating QR code...
                  </p>
                </div>
              )}
            </div>
          ) : !isInitialized ? (
            // Loading initialization
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-2 text-sm text-gray-500">Initializing...</p>
            </div>
          ) : isWaitingForExtensions ? (
            // Waiting for extensions
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                Detecting wallet extensions...
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Make sure your wallet extension is installed and unlocked
              </p>
            </div>
          ) : isMobile ? (
            // Mobile: Single WalletConnect button
            <button
              onClick={() => handleConnect()}
              disabled={isConnecting}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
            >
              {isConnecting && (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              )}
              Connect Wallet
            </button>
          ) : extensions.length === 0 ? (
            // Desktop: No extensions found - show manual refresh and WalletConnect
            <>
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg">
                <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-3">
                  No wallet extensions detected. Make sure your wallet extension is installed and unlocked.
                </p>
                <button
                  onClick={() => refreshExtensions()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors text-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Refresh Extensions
                </button>
              </div>

              {/* Generic WalletConnect option */}
              <button
                onClick={() => handleConnect()}
                disabled={isConnecting}
                className="w-full flex items-center gap-3 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
              >
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M5.54 7.09c3.65-3.58 9.59-3.58 13.24 0l.44.43c.18.18.18.47 0 .65l-1.5 1.47c-.09.09-.24.09-.33 0l-.6-.59c-2.55-2.5-6.68-2.5-9.23 0l-.64.63c-.09.09-.24.09-.33 0L5.1 8.22c-.18-.18-.18-.47 0-.65l.44-.48zm16.33 3.04l1.34 1.31c.18.18.18.47 0 .65l-6.03 5.91c-.18.18-.47.18-.65 0L12 13.73c-.05-.05-.12-.05-.17 0L7.3 17.99c-.18.18-.47.18-.65 0L.62 12.08c-.18-.18-.18-.47 0-.65l1.34-1.31c.18-.18.47-.18.65 0l4.54 4.45c.05.05.12.05.17 0l4.54-4.45c.18-.18.47-.18.65 0l4.54 4.45c.05.05.12.05.17 0l4.54-4.45c.18-.18.47-.18.65 0z"/>
                </svg>
                <span className="font-medium">WalletConnect QR Code</span>
              </button>
            </>
          ) : (
            // Desktop: Show extensions + WalletConnect
            <>
              {extensions.map((extension) => (
                <button
                  key={extension.id}
                  onClick={() => handleConnect(extension.id)}
                  disabled={isConnecting}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-50 rounded-lg transition-colors"
                >
                  {extension.icon && (
                    <img
                      src={extension.icon}
                      alt={extension.name || ''}
                      className="w-6 h-6"
                    />
                  )}
                  <span className="font-medium text-gray-900 dark:text-white">
                    {extension.name}
                  </span>
                </button>
              ))}

              {/* Generic WalletConnect option */}
              <button
                onClick={() => handleConnect()}
                disabled={isConnecting}
                className="w-full flex items-center gap-3 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
              >
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M5.54 7.09c3.65-3.58 9.59-3.58 13.24 0l.44.43c.18.18.18.47 0 .65l-1.5 1.47c-.09.09-.24.09-.33 0l-.6-.59c-2.55-2.5-6.68-2.5-9.23 0l-.64.63c-.09.09-.24.09-.33 0L5.1 8.22c-.18-.18-.18-.47 0-.65l.44-.48zm16.33 3.04l1.34 1.31c.18.18.18.47 0 .65l-6.03 5.91c-.18.18-.47.18-.65 0L12 13.73c-.05-.05-.12-.05-.17 0L7.3 17.99c-.18.18-.47.18-.65 0L.62 12.08c-.18-.18-.18-.47 0-.65l1.34-1.31c.18-.18.47-.18.65 0l4.54 4.45c.05.05.12.05.17 0l4.54-4.45c.18-.18.47-.18.65 0l4.54 4.45c.05.05.12.05.17 0l4.54-4.45c.18-.18.47-.18.65 0z"/>
                </svg>
                <span className="font-medium">WalletConnect</span>
              </button>
            </>
          )}
        </div>

        {/* Help Link */}
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <span className="font-medium">Why connect a wallet?</span> Your private keys stay in your wallet. We only request signatures when needed.
          </p>
        </div>
      </div>
    </div>
  );
}
