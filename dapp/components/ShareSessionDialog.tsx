/**
 * Share Session Dialog
 *
 * Modal dialog for sharing session connection details with other participants.
 * Displays QR code, connection string, and individual session fields.
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeDisplay } from './QRCodeDisplay';
import { CopyButton } from './CopyButton';
import { Icon } from './Icon';
import { useFocusTrap } from '../hooks/useFocusTrap';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generateConnectionString } = require('../../shared/connection-string');

interface ShareSessionDialogProps {
  open: boolean;
  onClose: () => void;
  serverUrl: string;
  sessionId: string;
  pin: string;
}

/**
 * Generate a shareable URL with query parameters
 */
function generateShareableUrl(serverUrl: string, sessionId: string, pin: string): string {
  // Use the current origin for the dApp URL
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const params = new URLSearchParams({
    server: serverUrl,
    session: sessionId,
    pin: pin,
  });
  return `${baseUrl}/join?${params.toString()}`;
}

export function ShareSessionDialog({
  open,
  onClose,
  serverUrl,
  sessionId,
  pin,
}: ShareSessionDialogProps) {
  const [activeTab, setActiveTab] = useState<'qr' | 'text'>('qr');
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

  const connectionString = useMemo(
    () => generateConnectionString(serverUrl, sessionId, pin),
    [serverUrl, sessionId, pin]
  );

  const shareableUrl = useMemo(
    () => generateShareableUrl(serverUrl, sessionId, pin),
    [serverUrl, sessionId, pin]
  );

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-start justify-center pt-16"
      style={{ background: 'var(--scrim)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-dialog-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-border">
          <h2 id="share-dialog-title" className="font-heading text-xl font-bold text-foreground">Share session</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="text-foreground-subtle hover:text-foreground transition-colors p-1 -mt-1 -mr-1"
          >
            <Icon name="close" size={20} aria-hidden />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab('qr')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'qr'
                ? 'text-accent border-b-2 border-accent bg-info-soft'
                : 'text-foreground-subtle hover:text-foreground hover:bg-surface-recessed'
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              <Icon name="qr_code" size={16} aria-hidden />
              QR code
            </span>
          </button>
          <button
            onClick={() => setActiveTab('text')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'text'
                ? 'text-accent border-b-2 border-accent bg-info-soft'
                : 'text-foreground-subtle hover:text-foreground hover:bg-surface-recessed'
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              <Icon name="article" size={16} aria-hidden />
              Text details
            </span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {activeTab === 'qr' ? (
            <div className="space-y-6">
              {/* QR Code */}
              <QRCodeDisplay
                value={connectionString}
                size={220}
                description="Scan this QR code with the Hedera MultiSig dApp to join the session"
                showDownload={true}
                downloadFilename={`hedera-multisig-session-${sessionId.slice(0, 8)}`}
              />

              {/* Connection String (compact) */}
              <div className="bg-surface-recessed rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground-muted">Connection String</span>
                  <CopyButton text={connectionString} label="connection string" variant="button" size="sm" />
                </div>
                <div className="font-mono text-xs text-foreground-muted break-all bg-surface p-2 rounded border border-border">
                  {connectionString}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Connection String */}
              <div className="border-l-2 border-info bg-info-soft/40 pl-4 py-3 rounded-r-md">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-info-soft-fg">Connection string (recommended)</span>
                  <CopyButton text={connectionString} label="connection string" variant="button" size="sm" />
                </div>
                <div className="font-mono text-xs text-info-soft-fg break-all bg-surface p-2 rounded">
                  {connectionString}
                </div>
                <p className="text-xs text-accent mt-2">
                  Participants can paste this in the dApp&apos;s &ldquo;Quick Connect&rdquo; field
                </p>
              </div>

              {/* Shareable URL */}
              <div className="bg-surface-recessed rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground-muted">Shareable Link</span>
                  <CopyButton text={shareableUrl} label="shareable link" variant="button" size="sm" />
                </div>
                <div className="font-mono text-xs text-foreground-muted break-all bg-surface p-2 rounded border border-border">
                  {shareableUrl}
                </div>
                <p className="text-xs text-foreground-subtle mt-2">
                  Direct link that auto-fills session details
                </p>
              </div>

              {/* Individual Fields */}
              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-semibold text-foreground-muted mb-3">Individual Details</h4>
                <div className="space-y-3">
                  {/* Server URL */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-foreground-muted min-w-[80px]">Server URL:</span>
                    <div className="flex-1 flex items-center gap-2 justify-end">
                      <code className="text-sm font-mono bg-surface-recessed px-2 py-1 rounded truncate max-w-[200px]" title={serverUrl}>
                        {serverUrl}
                      </code>
                      <CopyButton text={serverUrl} label="server URL" size="sm" />
                    </div>
                  </div>

                  {/* Session ID */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-foreground-muted min-w-[80px]">Session ID:</span>
                    <div className="flex-1 flex items-center gap-2 justify-end">
                      <code className="text-sm font-mono bg-surface-recessed px-2 py-1 rounded">
                        {sessionId.length > 16 ? `${sessionId.slice(0, 8)}...${sessionId.slice(-6)}` : sessionId}
                      </code>
                      <CopyButton text={sessionId} label="session ID" size="sm" />
                    </div>
                  </div>

                  {/* PIN */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-foreground-muted min-w-[80px]">PIN:</span>
                    <div className="flex-1 flex items-center gap-2 justify-end">
                      <code className="text-sm font-mono bg-warning-soft px-2 py-1 rounded font-bold text-warning-soft-fg">
                        {pin}
                      </code>
                      <CopyButton text={pin} label="PIN" size="sm" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface-recessed border-t border-border rounded-b-lg">
          <p className="text-xs text-foreground-subtle text-center">
            Share these details only with authorized participants. The PIN provides session access.
          </p>
        </div>
      </div>
    </div>
  );
}

export default ShareSessionDialog;
