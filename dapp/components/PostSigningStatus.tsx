/**
 * PostSigningStatus Component
 *
 * Displays transaction status after user has signed.
 * Polls mirror node to check if transaction has been executed.
 *
 * Features:
 * - Shows transaction ID with HashScan link
 * - Expandable transaction details
 * - Auto-polls mirror node for execution result
 * - 125-second timeout handling
 * - "Clear / Ready for Next" button
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import {
  fetchTransactionStatus,
  getHashScanTransactionUrl,
  TransactionStatus,
} from '../lib/mirror-node';
import { CopyButton } from './CopyButton';

export interface PostSigningStatusProps {
  transactionId: string;
  transactionDetails?: {
    type: string;
    transfers?: Array<{ accountId: string; amount: string }>;
    tokenIds?: string[];
    contractId?: string;
    functionName?: string;
    memo?: string;
    maxTransactionFee?: string;
  } | null;
  network?: 'testnet' | 'mainnet';
  onClear: () => void;
}

// Polling stages
// Hedera transactions have a 120-second validity window after freezing.
// Mirror node needs ~5 seconds to reflect consensus. Total: 125 seconds.
const STILL_CHECKING_MS = 60 * 1000;  // Show reassurance message after 60s
const POLLING_TIMEOUT_MS = 125 * 1000; // Hard boundary: 120s validity + 5s mirror lag
// Poll interval (3 seconds)
const POLL_INTERVAL_MS = 3000;

export function PostSigningStatus({
  transactionId,
  transactionDetails,
  network = 'testnet',
  onClear,
}: PostSigningStatusProps) {
  const [status, setStatus] = useState<'polling' | 'still-checking' | 'success' | 'error' | 'timeout'>('polling');
  const [txStatus, setTxStatus] = useState<TransactionStatus | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTimeRef = useRef(Date.now());
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const hashScanUrl = getHashScanTransactionUrl(transactionId, network);

  // Poll mirror node for transaction status
  useEffect(() => {
    // Skip polling if transaction ID is unknown or invalid
    if (!transactionId || transactionId === 'Unknown') {
      setStatus('timeout');
      return;
    }

    const pollStatus = async () => {
      const elapsed = Date.now() - startTimeRef.current;

      // Check for timeout
      if (elapsed >= POLLING_TIMEOUT_MS) {
        setStatus('timeout');
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
        }
        return;
      }

      // Transition to "still checking" after 30s
      if (elapsed >= STILL_CHECKING_MS) {
        setStatus((prev) => prev === 'polling' ? 'still-checking' : prev);
      }

      try {
        const result = await fetchTransactionStatus(transactionId, network);
        setTxStatus(result);

        if (result.found) {
          // Transaction found - check result
          if (result.result === 'SUCCESS') {
            setStatus('success');
          } else {
            setStatus('error');
          }
          // Stop polling
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }
        }
      } catch (error) {
        console.error('Error polling transaction status:', error);
        // Continue polling on error
      }
    };

    // Start polling
    pollStatus(); // Initial poll
    pollIntervalRef.current = setInterval(pollStatus, POLL_INTERVAL_MS);

    // Track elapsed time for UI
    elapsedIntervalRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    };
  }, [transactionId, network]);

  return (
    <div className="space-y-4">
      {/* Status Header */}
      <div
        className={`border-2 rounded-lg p-6 ${
          status === 'success'
            ? 'bg-green-50 dark:bg-green-950/30 border-green-500 dark:border-green-700'
            : status === 'error'
            ? 'bg-red-50 dark:bg-red-950/30 border-red-500 dark:border-red-700'
            : status === 'timeout'
            ? 'bg-yellow-50 dark:bg-yellow-950/30 border-yellow-500 dark:border-yellow-700'
            : 'bg-blue-50 dark:bg-blue-950/30 border-blue-500 dark:border-blue-700'
        }`}
      >
        {/* Status Icon */}
        <div className="flex items-center justify-center mb-4">
          {status === 'success' && (
            <div className="text-green-600 dark:text-green-400">
              <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
          {status === 'error' && (
            <div className="text-red-600 dark:text-red-400">
              <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          )}
          {status === 'timeout' && (
            <div className="text-yellow-600 dark:text-yellow-400">
              <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          )}
          {(status === 'polling' || status === 'still-checking') && (
            <div className="animate-pulse text-blue-600 dark:text-blue-400">
              <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
          )}
        </div>

        {/* Status Message */}
        <div className="text-center">
          {status === 'success' && (
            <>
              <h2 className="text-xl font-bold text-green-800 dark:text-green-200 mb-2">Transaction Successful!</h2>
              <p className="text-green-700 dark:text-green-300">
                Transaction {transactionId} <span className="font-bold">SUCCESS</span>
              </p>
            </>
          )}
          {status === 'error' && (
            <>
              <h2 className="text-xl font-bold text-red-800 dark:text-red-200 mb-2">Transaction Failed</h2>
              <p className="text-red-700 dark:text-red-300">
                Transaction {transactionId} <span className="font-bold">{txStatus?.result || 'ERROR'}</span>
              </p>
            </>
          )}
          {status === 'timeout' && (
            <>
              <h2 className="text-xl font-bold text-yellow-800 dark:text-yellow-200 mb-2">Transaction Not Found</h2>
              <p className="text-yellow-700 dark:text-yellow-300">
                The transaction wasn&apos;t found on the network after {Math.floor(POLLING_TIMEOUT_MS / 1000)} seconds.
                Check HashScan below — it may still be processing, or the signing threshold wasn&apos;t met.
              </p>
            </>
          )}
          {status === 'polling' && (
            <>
              <h2 className="text-xl font-bold text-blue-800 dark:text-blue-200 mb-2">Signature Submitted!</h2>
              <p className="text-blue-700 dark:text-blue-300 mb-2">
                Checking if the transaction went through... (<span className="tabular-nums">{elapsedSeconds}s</span>)
              </p>
              <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2 mt-3">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min((elapsedSeconds / 125) * 100, 100)}%` }}
                />
              </div>
            </>
          )}
          {status === 'still-checking' && (
            <>
              <h2 className="text-xl font-bold text-blue-800 dark:text-blue-200 mb-2">Still Checking...</h2>
              <p className="text-blue-700 dark:text-blue-300 mb-2">
                The transaction hasn&apos;t appeared on the network yet. This can happen if other signers haven&apos;t signed yet, or if the network is busy. (<span className="tabular-nums">{elapsedSeconds}s</span>)
              </p>
              <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2 mt-3">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min((elapsedSeconds / 125) * 100, 100)}%` }}
                />
              </div>
            </>
          )}
        </div>

        {/* Transaction ID Link */}
        <div className="mt-4 text-center">
          <a
            href={hashScanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium ${
              status === 'success'
                ? 'bg-green-600 text-white hover:bg-green-700'
                : status === 'error'
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            View on HashScan
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>

      {/* Transaction Details (Expandable) */}
      <div className="bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 rounded-lg">
        <details>
          <summary className="cursor-pointer p-4 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Transaction Details
          </summary>
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 space-y-3 text-sm">
            {/* Transaction ID */}
            <div className="flex gap-2 items-start">
              <span className="text-gray-500 dark:text-gray-400 w-32 flex-shrink-0">Transaction ID:</span>
              <span className="font-mono text-gray-800 dark:text-gray-200 break-all">{transactionId}</span>
              <CopyButton text={transactionId} label="Transaction ID" size="sm" />
            </div>

            {/* Type */}
            {transactionDetails?.type && (
              <div className="flex gap-2">
                <span className="text-gray-500 dark:text-gray-400 w-32">Type:</span>
                <span className="text-gray-800 dark:text-gray-200">{transactionDetails.type}</span>
              </div>
            )}

            {/* Transfers */}
            {transactionDetails?.transfers && transactionDetails.transfers.length > 0 && (
              <div className="flex gap-2">
                <span className="text-gray-500 dark:text-gray-400 w-32">Transfers:</span>
                <div className="text-gray-800 dark:text-gray-200">
                  {transactionDetails.transfers.map((t, i) => (
                    <div key={i} className="font-mono text-xs">
                      {t.accountId}: {t.amount}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Token IDs */}
            {transactionDetails?.tokenIds && transactionDetails.tokenIds.length > 0 && (
              <div className="flex gap-2">
                <span className="text-gray-500 dark:text-gray-400 w-32">Tokens:</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">
                  {transactionDetails.tokenIds.join(', ')}
                </span>
              </div>
            )}

            {/* Contract */}
            {transactionDetails?.contractId && (
              <div className="flex gap-2">
                <span className="text-gray-500 dark:text-gray-400 w-32">Contract:</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">{transactionDetails.contractId}</span>
              </div>
            )}

            {/* Function */}
            {transactionDetails?.functionName && (
              <div className="flex gap-2">
                <span className="text-gray-500 dark:text-gray-400 w-32">Function:</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">{transactionDetails.functionName}()</span>
              </div>
            )}

            {/* Max Fee */}
            {transactionDetails?.maxTransactionFee && (
              <div className="flex gap-2">
                <span className="text-gray-500 dark:text-gray-400 w-32">Max Fee:</span>
                <span className="font-mono text-gray-800 dark:text-gray-200">{transactionDetails.maxTransactionFee}</span>
              </div>
            )}

            {/* Memo */}
            {transactionDetails?.memo && (
              <div className="flex gap-2">
                <span className="text-gray-500 dark:text-gray-400 w-32">Memo:</span>
                <span className="text-gray-800 dark:text-gray-200">{transactionDetails.memo}</span>
              </div>
            )}

            {/* Mirror Node Result (if available) */}
            {txStatus?.found && (
              <>
                <div className="border-t border-gray-200 dark:border-gray-700 my-2 pt-2">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Network Result</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-gray-500 dark:text-gray-400 w-32">Result:</span>
                  <span className={`font-bold ${txStatus.result === 'SUCCESS' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {txStatus.result}
                  </span>
                </div>
                {txStatus.chargedFee !== null && (
                  <div className="flex gap-2">
                    <span className="text-gray-500 dark:text-gray-400 w-32">Fee Charged:</span>
                    <span className="font-mono text-gray-800 dark:text-gray-200">{(txStatus.chargedFee / 100000000).toFixed(8)} HBAR</span>
                  </div>
                )}
                {txStatus.consensusTimestamp && (
                  <div className="flex gap-2">
                    <span className="text-gray-500 dark:text-gray-400 w-32">Consensus:</span>
                    <span className="font-mono text-gray-800 dark:text-gray-200">{txStatus.consensusTimestamp}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </details>
      </div>

      {/* Clear Button */}
      <div className="text-center">
        <button
          onClick={onClear}
          className="px-6 py-3 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 transition-colors"
        >
          Ready for Next Transaction
        </button>
      </div>
    </div>
  );
}

export default PostSigningStatus;
