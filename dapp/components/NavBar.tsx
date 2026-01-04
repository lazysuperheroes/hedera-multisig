/**
 * NavBar Component
 *
 * Top navigation with wallet connection controls
 * Shows: Connect button (disconnected) or Account info (connected)
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useWallet } from '../hooks/useWallet';
import { WalletSelectionDialog } from './WalletSelectionDialog';

export function NavBar() {
  const { accountId, publicKey, publicKeyType, evmAddress, balance, isConnected, isConnecting, connect, disconnect } = useWallet();
  const [showWalletDialog, setShowWalletDialog] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleConnectClick = async () => {
    if (isConnected) {
      // Disconnect
      await disconnect();
    } else {
      // Show wallet selection dialog
      setShowWalletDialog(true);
    }
  };

  const handleCopyPublicKey = async () => {
    if (publicKey) {
      await navigator.clipboard.writeText(publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getButtonText = () => {
    if (isConnecting) return 'Connecting...';
    if (isConnected) return 'Disconnect';
    return 'Connect Wallet';
  };

  const network = process.env.NEXT_PUBLIC_DEFAULT_NETWORK || 'testnet';

  return (
    <>
      <nav className="sticky top-0 left-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            {/* Logo / Brand */}
            <Link href="/" className="flex items-center space-x-3">
              <div className="flex items-center justify-center w-10 h-10 bg-blue-600 rounded-lg">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                  Hedera MultiSig
                </h1>
                {network === 'testnet' && (
                  <span className="text-xs text-orange-600 dark:text-orange-400 font-medium">
                    TESTNET
                  </span>
                )}
              </div>
            </Link>

            {/* Right Side: Wallet Info + Connect Button */}
            <div className="flex items-center gap-4">
              {/* Connected Wallet Info */}
              {isConnected && accountId && (
                <div className="hidden lg:flex items-start gap-3 px-4 py-2.5 bg-gray-100 dark:bg-gray-800 rounded-lg max-w-2xl">
                  <div className="w-7 h-7 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg
                      className="w-4 h-4 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    {/* Top Row: Account ID, Key Type, Balance */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="text-sm font-mono font-semibold text-gray-900 dark:text-white">
                        {accountId}
                      </div>
                      {publicKeyType && (
                        <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 rounded">
                          {publicKeyType}
                        </div>
                      )}
                      {balance && (
                        <div className="text-sm text-green-600 dark:text-green-400 font-semibold">
                          {balance}
                        </div>
                      )}
                    </div>
                    {/* Bottom Row: Public Key and EVM Address */}
                    <div className="flex items-center gap-3 text-xs">
                      {publicKey && (
                        <div className="font-mono text-gray-600 dark:text-gray-400 truncate" title={publicKey}>
                          <span className="text-gray-500 dark:text-gray-500">PubKey:</span> {publicKey.substring(0, 16)}...{publicKey.substring(publicKey.length - 8)}
                        </div>
                      )}
                      {evmAddress && (
                        <div className="font-mono text-gray-600 dark:text-gray-400 truncate" title={evmAddress}>
                          <span className="text-gray-500 dark:text-gray-500">EVM:</span> {evmAddress.substring(0, 10)}...{evmAddress.substring(evmAddress.length - 8)}
                        </div>
                      )}
                    </div>
                  </div>
                  {publicKey && (
                    <button
                      onClick={handleCopyPublicKey}
                      className="px-2.5 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap self-start mt-0.5"
                      title="Copy Public Key"
                    >
                      {copied ? (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Copied!
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Copy Public Key
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}

              {/* Connect/Disconnect Button */}
              <button
                onClick={handleConnectClick}
                disabled={isConnecting}
                className={`
                  px-4 py-2 rounded-lg font-medium transition-colors
                  ${isConnected
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }
                  disabled:opacity-50 disabled:cursor-not-allowed
                  flex items-center gap-2
                `}
              >
                {isConnecting && (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                )}
                {getButtonText()}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Wallet Selection Dialog */}
      <WalletSelectionDialog
        open={showWalletDialog}
        onClose={() => setShowWalletDialog(false)}
      />
    </>
  );
}
