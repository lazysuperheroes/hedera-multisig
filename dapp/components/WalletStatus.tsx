/**
 * WalletStatus Component
 *
 * Displays wallet connection status, account info, and network info.
 * Provides connect/disconnect controls.
 */

'use client';

import { truncateString } from '../lib/walletconnect-config';

export interface WalletStatusProps {
  connected: boolean;
  connecting: boolean;
  wallet: {
    accountId: string;
    publicKey: string;
    network: string;
  } | null;
  error: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function WalletStatus({
  connected,
  connecting,
  wallet,
  error,
  onConnect,
  onDisconnect,
}: WalletStatusProps) {
  // Disconnected state
  if (!connected && !connecting) {
    return (
      <div className="bg-surface border-2 border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Wallet Connection</h3>
            <p className="text-sm text-foreground-muted">Connect your wallet to participate</p>
          </div>
          <div className="w-12 h-12 bg-surface-recessed rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-foreground-subtle" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
        </div>

        {error && (
          <div className="bg-destructive-soft border border-destructive/40 rounded p-3 mb-4">
            <p className="text-sm text-destructive-soft-fg">
              <span className="font-semibold">Error:</span> {error}
            </p>
          </div>
        )}

        <button
          onClick={onConnect}
          className="w-full px-4 py-3 bg-accent text-white font-semibold rounded-lg hover:bg-accent-hover transition-colors"
        >
          Connect Wallet
        </button>

        <div className="mt-4 text-xs text-foreground-subtle text-center">
          Supports HashPack, Blade, and hardware wallets (Ledger, Trezor)
        </div>
      </div>
    );
  }

  // Connecting state
  if (connecting) {
    return (
      <div className="bg-surface border-2 border-info rounded-lg p-6">
        <div className="flex items-center space-x-4">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent"></div>
          <div>
            <h3 className="text-lg font-semibold text-foreground">Connecting...</h3>
            <p className="text-sm text-foreground-muted">Please approve connection in your wallet</p>
          </div>
        </div>
      </div>
    );
  }

  // Connected state
  if (connected && wallet) {
    return (
      <div className="bg-success-soft border-2 border-success rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-success rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-success-soft-fg">Wallet Connected</h3>
              <p className="text-sm text-success-soft-fg">Ready to sign transactions</p>
            </div>
          </div>
          <button
            onClick={onDisconnect}
            className="px-3 py-1 text-sm bg-destructive-soft text-destructive-soft-fg rounded hover:bg-destructive-soft hover:bg-destructive transition-colors"
          >
            Disconnect
          </button>
        </div>

        <div className="space-y-3">
          {/* Account ID */}
          <div className="bg-surface rounded p-3">
            <div className="text-xs text-foreground-subtle mb-1">Account ID</div>
            <div className="font-mono text-sm text-foreground font-semibold">{wallet.accountId}</div>
          </div>

          {/* Public Key */}
          <div className="bg-surface rounded p-3">
            <div className="text-xs text-foreground-subtle mb-1">Public Key</div>
            <div className="font-mono text-xs text-foreground-muted break-all">
              {truncateString(wallet.publicKey, 12, 12)}
            </div>
          </div>

          {/* Network */}
          <div className="bg-surface rounded p-3">
            <div className="text-xs text-foreground-subtle mb-1">Network</div>
            <div className="flex items-center space-x-2">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  wallet.network === 'mainnet' ? 'bg-success' : 'bg-info'
                }`}
              ></span>
              <span className="text-sm font-semibold text-foreground capitalize">{wallet.network}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default WalletStatus;
