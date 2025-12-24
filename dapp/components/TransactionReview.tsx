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
  const network = process.env.NEXT_PUBLIC_DEFAULT_NETWORK || 'testnet';

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

  return (
    <div className="space-y-6">
      {/* UNVERIFIED METADATA SECTION (if present) - YELLOW WARNING */}
      {metadata && validation && (
        <div className="bg-yellow-50 border-4 border-yellow-500 rounded-lg p-6">
          <div className="flex items-start space-x-3 mb-4">
            <div className="text-3xl">⚠️</div>
            <div>
              <h2 className="text-xl font-bold text-yellow-800">UNVERIFIED METADATA</h2>
              <p className="text-yellow-700 font-semibold">
                NOT cryptographically verified - coordinator-provided information only
              </p>
              <p className="text-yellow-600 text-sm mt-1">
                This information comes from the coordinator and could be fraudulent. Always verify against the
                VERIFIED section below.
              </p>
            </div>
          </div>

          {/* Metadata Warnings */}
          {validation.warnings.length > 0 && (
            <div className="bg-yellow-100 border-2 border-yellow-600 rounded p-4 mb-4">
              <h3 className="font-bold text-yellow-800 mb-2">⚠️ Validation Warnings:</h3>
              <ul className="space-y-1">
                {validation.warnings.map((warning, index) => (
                  <li key={index} className="text-yellow-700 text-sm">
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Metadata Content */}
          <div className="bg-white rounded border border-yellow-300 p-4">
            <h3 className="font-semibold text-gray-700 mb-2">Coordinator Claims:</h3>
            <pre className="text-sm text-gray-600 whitespace-pre-wrap overflow-x-auto">
              {JSON.stringify(metadata, null, 2)}
            </pre>
          </div>

          {/* Mismatches */}
          {Object.keys(validation.mismatches).length > 0 && (
            <div className="bg-red-100 border-2 border-red-600 rounded p-4 mt-4">
              <h3 className="font-bold text-red-800 mb-2">❌ CRITICAL: Metadata Mismatches Detected</h3>
              {Object.entries(validation.mismatches).map(([field, { metadata, actual }]) => (
                <div key={field} className="mb-2">
                  <p className="font-semibold text-red-700">{field}:</p>
                  <p className="text-red-600 text-sm">
                    Metadata: {JSON.stringify(metadata)} ≠ Actual: {JSON.stringify(actual)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VERIFIED TRANSACTION DATA SECTION - GREEN TRUST */}
      <div className="bg-green-50 border-4 border-green-600 rounded-lg p-6">
        <div className="flex items-start space-x-3 mb-4">
          <div className="text-3xl">✅</div>
          <div>
            <h2 className="text-xl font-bold text-green-800">VERIFIED TRANSACTION DATA</h2>
            <p className="text-green-700 font-semibold">Cryptographically verified from transaction bytes</p>
            <p className="text-green-600 text-sm mt-1">
              This data is extracted directly from the frozen transaction and cannot be forged.
            </p>
          </div>
        </div>

        {/* Transaction Checksum */}
        <div className="bg-white rounded border border-green-300 p-4 mb-4">
          <h3 className="font-semibold text-gray-700 mb-2">Transaction Checksum (SHA256):</h3>
          <p className="font-mono text-xs text-gray-600 break-all">{decoded.checksum}</p>
        </div>

        {/* Transaction Type */}
        <div className="bg-white rounded border border-green-300 p-4 mb-4">
          <h3 className="font-semibold text-gray-700 mb-2">Transaction Type:</h3>
          <p className="text-gray-800 font-mono">{decoded.type}</p>
        </div>

        {/* Transaction ID */}
        {decoded.details.transactionId && (
          <div className="bg-white rounded border border-green-300 p-4 mb-4">
            <h3 className="font-semibold text-gray-700 mb-2">Transaction ID:</h3>
            <p className="text-gray-800 font-mono text-sm">{decoded.details.transactionId}</p>
          </div>
        )}

        {/* Amounts (Transfers) */}
        {amounts.length > 0 && (
          <div className="bg-white rounded border border-green-300 p-4 mb-4">
            <h3 className="font-semibold text-gray-700 mb-2">Transfers:</h3>
            <div className="space-y-2">
              {amounts.map((amount, index) => (
                <div key={index} className="flex items-center justify-between text-sm">
                  <EntityLink type="account" id={amount.accountId} network={network} />
                  <span
                    className={`font-mono font-semibold ${
                      amount.amount.startsWith('+') ? 'text-green-700' : 'text-red-700'
                    }`}
                  >
                    {TransactionDecoder.formatAmount(amount.amount, amount.type)}
                  </span>
                  {amount.tokenId && (
                    <EntityLink type="token" id={amount.tokenId} network={network} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Accounts Involved */}
        {accounts.length > 0 && (
          <div className="bg-white rounded border border-green-300 p-4 mb-4">
            <h3 className="font-semibold text-gray-700 mb-2">Accounts Involved:</h3>
            <div className="flex flex-wrap gap-2">
              {accounts.map((account, index) => (
                <div key={index} className="px-2 py-1 bg-gray-100 rounded text-xs">
                  <EntityLink type="account" id={account} network={network} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Token Association */}
        {decoded.details.tokenIds && decoded.details.tokenIds.length > 0 && (
          <div className="bg-white rounded border border-green-300 p-4 mb-4">
            <h3 className="font-semibold text-gray-700 mb-2">Tokens to Associate:</h3>
            <div className="space-y-1">
              {decoded.details.tokenIds.map((tokenId, index) => (
                <div key={index} className="text-sm">
                  <EntityLink type="token" id={tokenId} network={network} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contract Execution */}
        {decoded.details.contractId && (
          <div className="bg-white rounded border border-green-300 p-4 mb-4">
            <h3 className="font-semibold text-gray-700 mb-2">Smart Contract Execution:</h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-semibold text-gray-600">Contract:</span>
                <span className="ml-2">
                  <EntityLink type="contract" id={decoded.details.contractId} network={network} />
                </span>
              </div>
              {decoded.details.functionName && (
                <div>
                  <span className="font-semibold text-gray-600">Function:</span>
                  <span className="ml-2 font-mono text-gray-800 font-bold">{decoded.details.functionName}()</span>
                </div>
              )}
              {decoded.details.gas && (
                <div>
                  <span className="font-semibold text-gray-600">Gas Limit:</span>
                  <span className="ml-2 font-mono text-gray-800">{decoded.details.gas.toLocaleString()}</span>
                </div>
              )}
              {decoded.details.functionParams && (
                <div>
                  <span className="font-semibold text-gray-600 block mb-1">Function Parameters:</span>
                  <div className="mt-1 p-3 bg-gray-50 rounded border border-gray-200">
                    <pre className="text-xs overflow-x-auto font-mono">
                      {JSON.stringify(decoded.details.functionParams, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
              {!decoded.details.functionName && (
                <div className="mt-2 p-2 bg-yellow-50 border border-yellow-300 rounded">
                  <p className="text-xs text-yellow-700">
                    ⚠️ No ABI provided - function name and parameters cannot be decoded. Review raw function data carefully.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Transaction Memo */}
        {decoded.details.transactionMemo && (
          <div className="bg-white rounded border border-green-300 p-4 mb-4">
            <h3 className="font-semibold text-gray-700 mb-2">Transaction Memo:</h3>
            <p className="text-sm text-gray-700">{decoded.details.transactionMemo}</p>
          </div>
        )}

        {/* Max Transaction Fee */}
        <div className="bg-white rounded border border-green-300 p-4">
          <h3 className="font-semibold text-gray-700 mb-2">Max Transaction Fee:</h3>
          <p className="text-sm text-gray-700">{decoded.details.maxTransactionFee} tinybars</p>
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
                placeholder="Reason for rejection (optional)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-red-500"
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
          disabled={disabled}
          className="flex-1 px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
        >
          ✅ Approve & Sign
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
