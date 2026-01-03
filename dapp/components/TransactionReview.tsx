/**
 * TransactionReview Component
 *
 * Security-critical component for displaying transaction details for user approval.
 *
 * CRITICAL DESIGN:
 * - GREEN "VERIFIED" section shows cryptographically verified data from transaction bytes
 * - YELLOW "UNVERIFIED" section shows coordinator-provided metadata (can be fraudulent)
 * - User must explicitly approve before signing
 */

'use client';

import { useState, useEffect } from 'react';
import {
  TransactionDecoder,
  DecodedTransaction,
  MetadataValidation,
  ExtractedAmount,
} from '../lib/transaction-decoder';

export interface TransactionReviewProps {
  frozenTransactionBase64: string;
  metadata?: Record<string, any>;
  contractInterface?: any; // ethers Interface
  onApprove: () => void;
  onReject: (reason: string) => void;
  disabled?: boolean;
}

// Helper function to generate HashScan URLs
function getHashScanUrl(
  type: 'transaction' | 'account' | 'contract' | 'token',
  id: string,
  network?: string
): string {
  const defaultNetwork = process.env.NEXT_PUBLIC_DEFAULT_NETWORK || 'testnet';
  const networkToUse = network || defaultNetwork;

  const baseUrl = networkToUse === 'mainnet'
    ? 'https://hashscan.io'
    : 'https://hashscan.io/testnet';

  return `${baseUrl}/${type}/${id}`;
}

// Component to render entity ID with HashScan link
function EntityLink({ type, id, network }: { type: 'account' | 'contract' | 'token'; id: string; network?: string }) {
  return (
    <a
      href={getHashScanUrl(type, id, network)}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:text-blue-800 underline font-mono inline-flex items-center gap-1"
      title={`View ${id} on HashScan`}
    >
      {id}
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}

export function TransactionReview({
  frozenTransactionBase64,
  metadata,
  contractInterface,
  onApprove,
  onReject,
  disabled = false,
}: TransactionReviewProps) {
  const [decoded, setDecoded] = useState<DecodedTransaction | null>(null);
  const [validation, setValidation] = useState<MetadataValidation | null>(null);
  const [amounts, setAmounts] = useState<ExtractedAmount[]>([]);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [isExpired, setIsExpired] = useState(false);
  const network = process.env.NEXT_PUBLIC_DEFAULT_NETWORK || 'testnet';

  // Countdown timer effect
  useEffect(() => {
    if (!decoded?.details.expiresAt) return;

    const updateCountdown = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = decoded.details.expiresAt! - now;

      if (remaining <= 0) {
        setSecondsRemaining(0);
        setIsExpired(true);
      } else {
        setSecondsRemaining(remaining);
        setIsExpired(false);
      }
    };

    // Update immediately
    updateCountdown();

    // Update every second
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [decoded?.details.expiresAt]);

  useEffect(() => {
    async function decodeTransaction() {
      try {
        setLoading(true);
        setError(null);

        // Decode transaction
        const decodedTx = await TransactionDecoder.decode(frozenTransactionBase64, contractInterface);
        setDecoded(decodedTx);

        // Extract amounts and accounts
        const extractedAmounts = TransactionDecoder.extractAmounts(decodedTx.details);
        setAmounts(extractedAmounts);

        const extractedAccounts = TransactionDecoder.extractAccounts(decodedTx.details);
        setAccounts(extractedAccounts);

        // Validate metadata if provided
        if (metadata) {
          const metadataValidation = TransactionDecoder.validateMetadata(decodedTx.details, metadata);
          setValidation(metadataValidation);
        }

        setLoading(false);
      } catch (err) {
        console.error('Failed to decode transaction:', err);
        setError((err as Error).message);
        setLoading(false);
      }
    }

    decodeTransaction();
  }, [frozenTransactionBase64, metadata, contractInterface]);

  const handleReject = () => {
    if (showRejectInput) {
      onReject(rejectReason || 'Transaction rejected by user');
      setShowRejectInput(false);
      setRejectReason('');
    } else {
      setShowRejectInput(true);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        <span className="ml-4 text-gray-600">Decoding transaction...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border-2 border-red-500 rounded-lg p-6">
        <h2 className="text-xl font-bold text-red-700 mb-2">❌ Decoding Error</h2>
        <p className="text-red-600">{error}</p>
        <button
          onClick={() => onReject(`Decoding error: ${error}`)}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Reject Transaction
        </button>
      </div>
    );
  }

  if (!decoded) {
    return null;
  }

  // Format transfers for display (sender → receiver)
  // Amount strings are like "-1 ℏ" or "100" - extract numeric part to determine sign
  const formattedTransfers = amounts.reduce((acc, amount) => {
    const numericStr = amount.amount.replace(/[^\d.-]/g, '');
    const value = parseFloat(numericStr) || 0;
    if (value < 0) {
      acc.senders.push({ accountId: amount.accountId, amount: amount.amount, tokenId: amount.tokenId, type: amount.type });
    } else {
      acc.receivers.push({ accountId: amount.accountId, amount: amount.amount, tokenId: amount.tokenId, type: amount.type });
    }
    return acc;
  }, { senders: [] as ExtractedAmount[], receivers: [] as ExtractedAmount[] });

  // Format time remaining
  const formatTimeRemaining = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate progress percentage (how much time has passed)
  const progressPercent = decoded?.details.transactionValidDuration && secondsRemaining !== null
    ? Math.max(0, Math.min(100, ((decoded.details.transactionValidDuration - secondsRemaining) / decoded.details.transactionValidDuration) * 100))
    : 0;

  return (
    <div className="space-y-4">
      {/* EXPIRED Banner */}
      {isExpired && (
        <div className="bg-red-100 border-2 border-red-600 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="text-red-600">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-red-800">Transaction Expired</h3>
              <p className="text-sm text-red-700">
                This transaction has timed out and can no longer be signed. Please request a new transaction from the coordinator.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Countdown Timer */}
      {secondsRemaining !== null && !isExpired && (
        <div className={`border-2 rounded-lg p-3 ${
          secondsRemaining <= 30 ? 'bg-red-50 border-red-400' :
          secondsRemaining <= 60 ? 'bg-yellow-50 border-yellow-400' :
          'bg-blue-50 border-blue-400'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <svg className={`w-5 h-5 ${secondsRemaining <= 30 ? 'text-red-600' : secondsRemaining <= 60 ? 'text-yellow-600' : 'text-blue-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className={`font-semibold ${secondsRemaining <= 30 ? 'text-red-800' : secondsRemaining <= 60 ? 'text-yellow-800' : 'text-blue-800'}`}>
                Time to Sign
              </span>
            </div>
            <span className={`font-mono font-bold text-lg ${secondsRemaining <= 30 ? 'text-red-700' : secondsRemaining <= 60 ? 'text-yellow-700' : 'text-blue-700'}`}>
              {formatTimeRemaining(secondsRemaining)}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-1000 ${
                secondsRemaining <= 30 ? 'bg-red-500' :
                secondsRemaining <= 60 ? 'bg-yellow-500' :
                'bg-blue-500'
              }`}
              style={{ width: `${100 - progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Warnings Banner (if mismatches detected) */}
      {validation && Object.keys(validation.mismatches).length > 0 && (
        <div className="bg-red-50 border-2 border-red-500 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-800 font-semibold mb-2">
            <span className="text-xl">⚠️</span>
            <span>Metadata Mismatch Warning</span>
          </div>
          <p className="text-sm text-red-700 mb-2">
            Coordinator-provided metadata doesn&apos;t match the verified transaction data. Review carefully!
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer text-red-600 hover:text-red-800">Show details</summary>
            <div className="mt-2 p-2 bg-red-100 rounded">
              {Object.entries(validation.mismatches).map(([field, { metadata: meta, actual }]) => (
                <div key={field} className="mb-1">
                  <span className="font-semibold">{field}:</span> claimed &quot;{JSON.stringify(meta)}&quot; vs actual &quot;{JSON.stringify(actual)}&quot;
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Main Transaction Card */}
      <div className="bg-white border-2 border-gray-300 rounded-lg overflow-hidden">
        {/* Header */}
        <div className="bg-green-600 text-white px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">✅</span>
              <span className="font-semibold">Verified Transaction</span>
            </div>
            <span className="text-sm bg-green-700 px-2 py-1 rounded">{decoded.type}</span>
          </div>
        </div>

        {/* Transfers Section (most important) */}
        {amounts.length > 0 && (
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-600 mb-3">TRANSFERS</h3>
            <div className="space-y-3">
              {formattedTransfers.senders.map((sender, i) => {
                const receiver = formattedTransfers.receivers[i];
                return (
                  <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    {/* From */}
                    <div className="flex-1">
                      <div className="text-xs text-gray-500 mb-1">From</div>
                      <EntityLink type="account" id={sender.accountId} network={network} />
                    </div>
                    {/* Arrow + Amount */}
                    <div className="flex flex-col items-center">
                      <div className="text-lg font-bold text-gray-800">
                        {TransactionDecoder.formatAmount(sender.amount.replace('-', ''), sender.type).replace('+', '').replace('-', '')}
                      </div>
                      <div className="text-gray-400">→</div>
                    </div>
                    {/* To */}
                    <div className="flex-1 text-right">
                      <div className="text-xs text-gray-500 mb-1">To</div>
                      {receiver && <EntityLink type="account" id={receiver.accountId} network={network} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Token Association */}
        {decoded.details.tokenIds && decoded.details.tokenIds.length > 0 && (
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-600 mb-2">TOKEN ASSOCIATION</h3>
            <div className="flex flex-wrap gap-2">
              {decoded.details.tokenIds.map((tokenId, index) => (
                <div key={index} className="px-3 py-1 bg-blue-50 border border-blue-200 rounded">
                  <EntityLink type="token" id={tokenId} network={network} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contract Execution */}
        {decoded.details.contractId && (
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">CONTRACT CALL</h3>
            <div className="space-y-2 text-sm text-gray-800">
              <div className="flex gap-2">
                <span className="text-gray-500">Contract:</span>
                <EntityLink type="contract" id={decoded.details.contractId} network={network} />
              </div>
              {decoded.details.functionName && (
                <div className="flex gap-2">
                  <span className="text-gray-500">Function:</span>
                  <span className="font-mono font-semibold text-gray-800">{decoded.details.functionName}()</span>
                </div>
              )}
              {decoded.details.gas && (
                <div className="flex gap-2">
                  <span className="text-gray-500">Gas:</span>
                  <span className="font-mono text-gray-800">{decoded.details.gas.toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Metadata from Coordinator (collapsed by default if no issues) */}
        {metadata && (
          <div className="p-4 border-b border-gray-200 bg-yellow-50">
            <details className={validation && !validation.valid ? 'open' : ''}>
              <summary className="cursor-pointer flex items-center gap-2 text-sm font-semibold text-yellow-800">
                <span>⚠️</span>
                <span>Coordinator-Provided Info (Unverified)</span>
              </summary>
              <div className="mt-3 p-3 bg-white rounded border border-yellow-200 text-xs">
                <pre className="text-gray-600 whitespace-pre-wrap overflow-x-auto">
                  {JSON.stringify(metadata, null, 2)}
                </pre>
              </div>
            </details>
          </div>
        )}

        {/* Technical Details (collapsed) */}
        <div className="p-4 bg-gray-50">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-gray-700">
              Transaction Details
            </summary>
            <div className="mt-3 space-y-2 text-xs text-gray-800">
              <div className="flex gap-2">
                <span className="text-gray-500">Transaction ID:</span>
                <span className="font-mono text-gray-800">{decoded.details.transactionId}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-gray-500">Max Fee:</span>
                <span className="font-mono text-gray-800">{decoded.details.maxTransactionFee}</span>
              </div>
              {decoded.details.validStartTimestamp && (
                <div className="flex gap-2">
                  <span className="text-gray-500">Valid Start:</span>
                  <span className="font-mono text-gray-800">{new Date(decoded.details.validStartTimestamp * 1000).toLocaleString()}</span>
                </div>
              )}
              {decoded.details.transactionValidDuration && (
                <div className="flex gap-2">
                  <span className="text-gray-500">Valid Duration:</span>
                  <span className="font-mono text-gray-800">{decoded.details.transactionValidDuration}s</span>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <span className="text-gray-500">Checksum (SHA256):</span>
                <span className="font-mono text-[10px] break-all bg-gray-100 p-1 rounded text-gray-700">{decoded.checksum}</span>
              </div>
              {decoded.details.transactionMemo && (
                <div className="flex gap-2">
                  <span className="text-gray-500">Memo:</span>
                  <span className="text-gray-800">{decoded.details.transactionMemo}</span>
                </div>
              )}

              {/* Nested Raw Transaction Data */}
              <details className="mt-4 pt-3 border-t border-gray-200">
                <summary className="cursor-pointer text-sm font-semibold text-gray-600 hover:text-gray-800">
                  Raw Transaction Data
                </summary>
                <div className="mt-3 p-3 bg-white rounded border border-gray-200 overflow-auto max-h-96">
                  <pre className="text-[11px] font-mono text-gray-700 whitespace-pre-wrap">
                    {JSON.stringify(decoded.details, (key, value) => {
                      // Handle Uint8Array and other binary data
                      if (value instanceof Uint8Array) {
                        return `[Uint8Array(${value.length})]`;
                      }
                      // Handle BigInt
                      if (typeof value === 'bigint') {
                        return value.toString();
                      }
                      return value;
                    }, 2)}
                  </pre>
                </div>
              </details>
            </div>
          </details>
        </div>
      </div>

      {/* ACTIONS */}
      <div className="flex items-center justify-between space-x-4 pt-4 border-t-2 border-gray-200">
        {/* Reject */}
        <div className="flex-1">
          {showRejectInput ? (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Enter optional rejection reason..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-red-500 text-gray-800 placeholder:text-gray-400"
              />
              <div className="flex space-x-2">
                <button
                  onClick={handleReject}
                  disabled={disabled}
                  className="flex-1 px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm Rejection
                </button>
                <button
                  onClick={() => {
                    setShowRejectInput(false);
                    setRejectReason('');
                  }}
                  className="px-4 py-3 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleReject}
              disabled={disabled}
              className="w-full px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ❌ Reject Transaction
            </button>
          )}
        </div>

        {/* Approve */}
        <button
          onClick={onApprove}
          disabled={disabled || isExpired}
          className={`flex-1 px-6 py-3 font-semibold rounded-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${
            isExpired
              ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
              : 'bg-green-600 text-white hover:bg-green-700'
          }`}
        >
          {isExpired ? '⏱️ Transaction Expired' : '✅ Approve & Sign'}
        </button>
      </div>

      {/* Warning Footer */}
      <div className="bg-gray-100 border border-gray-300 rounded p-4 text-center">
        <p className="text-sm text-gray-700">
          ⚠️ <span className="font-semibold">Important:</span> Signing this transaction will create a cryptographic
          signature that authorizes these actions. Review all details carefully before approving.
        </p>
      </div>
    </div>
  );
}

export default TransactionReview;
