/**
 * Wallet Selection Dialog
 *
 * Modal for selecting wallet connection method:
 * - Desktop: Shows detected extensions (HashPack, Blade, etc.) + WalletConnect
 * - Mobile: Shows WalletConnect QR code option
 *
 * Modal is the right surface for this — it's a transient picker shown
 * only when the user is choosing a wallet. Internal composition flat:
 * the modal *is* a card; sub-elements aren't.
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useWallet } from '../hooks/useWallet';
import { QRCodeSVG } from 'qrcode.react';
import { Icon } from './Icon';
import { useFocusTrap } from '../hooks/useFocusTrap';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  // Escape-to-close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Detect mobile (window-only API, must run after mount)
  useEffect(() => {
    const checkMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from navigator
    setIsMobile(checkMobile);
  }, []);

  // Trigger extension discovery when dialog opens
  useEffect(() => {
    if (open && isInitialized && !isMobile) {
      refreshExtensions();
    }
  }, [open, isInitialized, isMobile, refreshExtensions]);

  // Wait for extensions to load (up to 3 seconds)
  useEffect(() => {
    if (open && isInitialized && extensions.length === 0 && !isMobile) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- waiting flag tied to extension-load timer
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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- cleanup on dialog close
      setWalletConnectUri(null);
      setShowQRCode(false);
    }
  }, [open]);

  // Handle URI callback for QR code display
  const handleUriGenerated = useCallback((uri: string) => {
    setWalletConnectUri(uri);
  }, []);

  const handleConnect = async (extensionId?: string) => {
    try {
      if (extensionId) {
        await connect(extensionId);
        onClose();
      } else {
        setShowQRCode(true);
        await connect(undefined, handleUriGenerated);
        onClose();
      }
    } catch (error) {
      console.error('Failed to connect:', error);
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
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-start justify-center pt-16"
      style={{ background: 'var(--scrim)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-dialog-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <h2 id="wallet-dialog-title" className="font-heading text-xl font-bold text-foreground">
            Connect a wallet
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="text-foreground-subtle hover:text-foreground transition-colors -mt-1 -mr-1 p-1"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Mobile tip */}
        {isMobile && (
          <div className="mb-4 border-l-2 border-info bg-info-soft/30 pl-4 py-2 rounded-r-md">
            <p className="text-sm text-info-soft-fg">
              <strong>Tip:</strong> For the best experience, use your mobile
              wallet app&apos;s built-in browser.
            </p>
          </div>
        )}

        {/* Description */}
        <p className="text-sm text-foreground-muted mb-6">
          Connect your Hedera wallet to sign multi-signature transactions
          securely. Private keys stay in your wallet.
        </p>

        {/* Wallet options */}
        <div className="space-y-3">
          {showQRCode ? (
            <div className="text-center">
              <button
                onClick={handleBackToOptions}
                className="mb-4 inline-flex items-center gap-1 text-sm text-foreground-muted hover:text-foreground transition-colors"
              >
                <Icon name="arrow_back" size={16} />
                Back to options
              </button>

              {walletConnectUri ? (
                <div className="space-y-4">
                  {/* Pure white kept for QR scanability — every QR scanner
                      expects high-contrast on #fff. Don't tokenize. */}
                  <div className="bg-white p-4 rounded-md inline-block">
                    <QRCodeSVG
                      value={walletConnectUri}
                      size={200}
                      level="M"
                      includeMargin={true}
                    />
                  </div>
                  <p className="text-sm text-foreground-muted">
                    Scan with your mobile wallet
                  </p>
                  <p className="text-xs text-foreground-subtle">
                    Works with HashPack, Blade, and other WalletConnect-compatible wallets
                  </p>
                </div>
              ) : (
                <LoadingState label="Generating QR code…" />
              )}
            </div>
          ) : !isInitialized ? (
            <LoadingState label="Initializing…" />
          ) : isWaitingForExtensions ? (
            <LoadingState
              label="Detecting wallet extensions…"
              hint="Make sure your wallet extension is installed and unlocked."
            />
          ) : isMobile ? (
            // Mobile — single WalletConnect button
            <button
              onClick={() => handleConnect()}
              disabled={isConnecting}
              className="cmd w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-md text-base font-semibold bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isConnecting && <Spinner />}
              Connect wallet
              {!isConnecting && <span className="treasury-label ml-1 opacity-70">→</span>}
            </button>
          ) : extensions.length === 0 ? (
            // Desktop — no extensions detected. Refresh affordance is a
            // ghost button (not bg-warning, which is a severity color
            // and shouldn't be a primary-action background); the
            // surrounding callout carries the "you may have a problem"
            // signal.
            <>
              <div className="border-l-2 border-warning bg-warning-soft/30 pl-4 py-3 rounded-r-md mb-3">
                <p className="text-sm text-warning-soft-fg mb-2">
                  No wallet extensions detected. Make sure your wallet
                  extension is installed and unlocked.
                </p>
                <button
                  onClick={() => refreshExtensions()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-foreground border border-border-strong hover:bg-surface-recessed transition-colors"
                >
                  <Icon name="refresh" size={14} />
                  Refresh extensions
                </button>
              </div>

              <button
                onClick={() => handleConnect()}
                disabled={isConnecting}
                className="cmd w-full inline-flex items-center gap-3 px-4 py-3 rounded-md text-base font-semibold bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <WalletConnectMark />
                <span>WalletConnect QR code</span>
                <span className="treasury-label ml-auto opacity-70">→</span>
              </button>
            </>
          ) : (
            // Desktop — extensions detected. Each renders as a flat
            // hover-tinted row (not a card), then WalletConnect as a
            // primary accent option below.
            <>
              {extensions.map((extension) => (
                <button
                  key={extension.id}
                  onClick={() => handleConnect(extension.id)}
                  disabled={isConnecting}
                  className="w-full inline-flex items-center gap-3 px-4 py-3 rounded-md text-foreground hover:bg-surface-recessed border border-border disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {extension.icon && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={extension.icon}
                      alt={extension.name || ''}
                      className="w-6 h-6"
                    />
                  )}
                  <span className="font-medium">{extension.name}</span>
                </button>
              ))}

              <button
                onClick={() => handleConnect()}
                disabled={isConnecting}
                className="cmd w-full inline-flex items-center gap-3 px-4 py-3 rounded-md text-base font-semibold bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <WalletConnectMark />
                <span>WalletConnect</span>
                <span className="treasury-label ml-auto opacity-70">→</span>
              </button>
            </>
          )}
        </div>

        {/* Help line — promoted from a footer to a real explanatory
            line above the close affordance. The safety story matters
            here; treasury operators arriving fresh deserve to see why
            connecting a wallet is the right call. */}
        <p className="mt-6 pt-4 border-t border-border text-xs text-foreground-subtle leading-relaxed">
          <strong className="text-foreground-muted">Why connect a wallet?</strong>{' '}
          Your private keys never leave the wallet. The dApp asks for a
          signature when needed — your wallet shows you what you&apos;re
          signing before approving.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

function LoadingState({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="text-center py-8">
      <Spinner large />
      <p className="mt-3 text-sm text-foreground-muted">{label}</p>
      {hint && <p className="mt-1 text-xs text-foreground-subtle">{hint}</p>}
    </div>
  );
}

function Spinner({ large }: { large?: boolean }) {
  return (
    <span
      className={`inline-block rounded-full border-2 border-current border-r-transparent animate-spin text-accent ${
        large ? 'h-8 w-8' : 'h-4 w-4'
      }`}
      aria-hidden="true"
    />
  );
}

/**
 * WalletConnect logomark. Hand-rolled SVG path is the official
 * WalletConnect mark; consolidated into one place so it doesn't
 * appear inline twice in the dialog body.
 */
function WalletConnectMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="flex-shrink-0"
    >
      <path d="M5.54 7.09c3.65-3.58 9.59-3.58 13.24 0l.44.43c.18.18.18.47 0 .65l-1.5 1.47c-.09.09-.24.09-.33 0l-.6-.59c-2.55-2.5-6.68-2.5-9.23 0l-.64.63c-.09.09-.24.09-.33 0L5.1 8.22c-.18-.18-.18-.47 0-.65l.44-.48zm16.33 3.04l1.34 1.31c.18.18.18.47 0 .65l-6.03 5.91c-.18.18-.47.18-.65 0L12 13.73c-.05-.05-.12-.05-.17 0L7.3 17.99c-.18.18-.47.18-.65 0L.62 12.08c-.18-.18-.18-.47 0-.65l1.34-1.31c.18-.18.47-.18.65 0l4.54 4.45c.05.05.12.05.17 0l4.54-4.45c.18-.18.47-.18.65 0l4.54 4.45c.05.05.12.05.17 0l4.54-4.45c.18-.18.47-.18.65 0z" />
    </svg>
  );
}
