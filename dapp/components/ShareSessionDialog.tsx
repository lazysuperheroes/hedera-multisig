/**
 * Share Session Dialog
 *
 * Modal dialog for sharing session connection details with other participants.
 * Displays QR code, connection string, and individual session fields.
 */

'use client';

import { useMemo, useState } from 'react';
import { QRCodeDisplay } from './QRCodeDisplay';
import { CopyButton, CopyableText } from './CopyButton';
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
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Share Session</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('qr')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'qr'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
              QR Code
            </span>
          </button>
          <button
            onClick={() => setActiveTab('text')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'text'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Text Details
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
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Connection String</span>
                  <CopyButton text={connectionString} label="connection string" variant="button" size="sm" />
                </div>
                <div className="font-mono text-xs text-gray-600 break-all bg-white p-2 rounded border border-gray-200">
                  {connectionString}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Connection String */}
              <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-blue-800">Connection String (Recommended)</span>
                  <CopyButton text={connectionString} label="connection string" variant="button" size="sm" />
                </div>
                <div className="font-mono text-xs text-blue-700 break-all bg-white p-2 rounded border border-blue-200">
                  {connectionString}
                </div>
                <p className="text-xs text-blue-600 mt-2">
                  Participants can paste this in the dApp's "Quick Connect" field
                </p>
              </div>

              {/* Shareable URL */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Shareable Link</span>
                  <CopyButton text={shareableUrl} label="shareable link" variant="button" size="sm" />
                </div>
                <div className="font-mono text-xs text-gray-600 break-all bg-white p-2 rounded border border-gray-200">
                  {shareableUrl}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Direct link that auto-fills session details
                </p>
              </div>

              {/* Individual Fields */}
              <div className="border-t border-gray-200 pt-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Individual Details</h4>
                <div className="space-y-3">
                  {/* Server URL */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-600 min-w-[80px]">Server URL:</span>
                    <div className="flex-1 flex items-center gap-2 justify-end">
                      <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded truncate max-w-[200px]" title={serverUrl}>
                        {serverUrl}
                      </code>
                      <CopyButton text={serverUrl} label="server URL" size="sm" />
                    </div>
                  </div>

                  {/* Session ID */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-600 min-w-[80px]">Session ID:</span>
                    <div className="flex-1 flex items-center gap-2 justify-end">
                      <code className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">
                        {sessionId.length > 16 ? `${sessionId.slice(0, 8)}...${sessionId.slice(-6)}` : sessionId}
                      </code>
                      <CopyButton text={sessionId} label="session ID" size="sm" />
                    </div>
                  </div>

                  {/* PIN */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-600 min-w-[80px]">PIN:</span>
                    <div className="flex-1 flex items-center gap-2 justify-end">
                      <code className="text-sm font-mono bg-yellow-100 px-2 py-1 rounded font-bold text-yellow-800">
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
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 rounded-b-lg">
          <p className="text-xs text-gray-500 text-center">
            Share these details only with authorized participants. The PIN provides session access.
          </p>
        </div>
      </div>
    </div>
  );
}

export default ShareSessionDialog;
