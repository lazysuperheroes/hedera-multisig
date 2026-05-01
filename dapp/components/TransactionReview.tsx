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
import { Icon } from './Icon';

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
      className="text-accent hover:text-info-soft-fg dark:hover:text-info-soft-fg underline font-mono inline-flex items-center gap-1"
      title={`View ${id} on HashScan`}
    >
      {id}
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
      <div className="space-y-4" aria-busy="true" aria-label="Loading transaction details">
        {/* Skeleton: mimics the verified transaction card shape */}
        <div className="bg-surface border-2 border-border rounded-lg overflow-hidden">
          <div className="bg-success px-4 py-3">
            <div className="skeleton h-5 w-48 rounded" style={{background: 'rgba(255,255,255,0.2)'}}></div>
          </div>
          <div className="p-4 space-y-4">
            <div className="skeleton h-3 w-20 rounded"></div>
            <div className="p-3 bg-surface-recessed rounded-lg space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3 w-12 rounded"></div>
                  <div className="skeleton h-4 w-32 rounded"></div>
                </div>
                <div className="skeleton h-6 w-24 rounded"></div>
                <div className="flex-1 space-y-2 text-right">
                  <div className="skeleton h-3 w-12 rounded ml-auto"></div>
                  <div className="skeleton h-4 w-32 rounded ml-auto"></div>
                </div>
              </div>
            </div>
            <div className="skeleton h-3 w-full rounded"></div>
            <div className="skeleton h-3 w-3/4 rounded"></div>
          </div>
        </div>
        <div className="space-y-3 pt-4">
          <div className="skeleton h-14 w-full rounded-lg"></div>
          <div className="skeleton h-10 w-full rounded-lg"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-destructive-soft border-2 border-destructive rounded-lg p-6">
        <h2 className="text-xl font-bold text-destructive-soft-fg mb-2">Could Not Read Transaction</h2>
        <p className="text-destructive">{error}</p>
        <button
          onClick={() => onReject(`Decoding error: ${error}`)}
          className="mt-4 px-4 py-2 bg-destructive text-white rounded hover:bg-destructive transition-colors"
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
        <div className="bg-destructive-soft border-2 border-destructive rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="text-destructive">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-destructive-soft-fg">Transaction Expired</h3>
              <p className="text-sm text-destructive-soft-fg">
                This transaction has timed out and can no longer be signed. Please request a new transaction from the coordinator.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Countdown Timer */}
      {secondsRemaining !== null && !isExpired && (
        <div className={`border-l-2 rounded-md p-3 ${
          secondsRemaining <= 30 ? 'bg-destructive-soft border-destructive' :
          secondsRemaining <= 60 ? 'bg-warning-soft border-warning' :
          'bg-info-soft border-info'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Icon
                name="schedule"
                size={20}
                className={secondsRemaining <= 30 ? 'text-destructive' : secondsRemaining <= 60 ? 'text-warning' : 'text-info'}
              />
              <span className={`font-semibold ${secondsRemaining <= 30 ? 'text-destructive-soft-fg' : secondsRemaining <= 60 ? 'text-warning-soft-fg' : 'text-info-soft-fg'}`}>
                Time to Sign
              </span>
            </div>
            <span className={`font-mono font-bold text-lg tabular-nums ${secondsRemaining <= 30 ? 'text-destructive-soft-fg' : secondsRemaining <= 60 ? 'text-warning-soft-fg' : 'text-info-soft-fg'}`}>
              {formatTimeRemaining(secondsRemaining)}
            </span>
          </div>
          <div
            className="w-full bg-surface-recessed rounded-full h-2"
            role="progressbar"
            aria-valuenow={secondsRemaining}
            aria-valuemin={0}
            aria-valuemax={decoded?.details.transactionValidDuration || 120}
            aria-label={`${secondsRemaining} seconds remaining to sign`}
          >
            <div
              className={`h-2 rounded-full transition-all duration-1000 ${
                secondsRemaining <= 30 ? 'bg-destructive' :
                secondsRemaining <= 60 ? 'bg-warning' :
                'bg-info'
              }`}
              style={{ width: `${100 - progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Warnings Banner (if mismatches detected) */}
      {validation && Object.keys(validation.mismatches).length > 0 && (
        <div className="bg-destructive-soft border-2 border-destructive rounded-lg p-4">
          <div className="flex items-center gap-2 text-destructive-soft-fg font-semibold mb-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span>Metadata Mismatch Warning</span>
          </div>
          <p className="text-sm text-destructive-soft-fg mb-2">
            What the coordinator claims this transaction does doesn&apos;t match what it actually does. Review carefully before signing.
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer text-destructive hover:text-destructive-soft-fg">Show details</summary>
            <div className="mt-2 p-2 bg-destructive-soft rounded">
              {Object.entries(validation.mismatches).map(([field, { metadata: meta, actual }]) => (
                <div key={field} className="mb-1 text-destructive-soft-fg">
                  <span className="font-semibold">{field}:</span> claimed &quot;{JSON.stringify(meta)}&quot; vs actual &quot;{JSON.stringify(actual)}&quot;
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Main Transaction Card */}
      <div className="bg-surface border-2 border-border-strong rounded-lg overflow-hidden">
        {/* Header */}
        <div className="bg-success text-white px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span className="font-semibold">Verified Transaction</span>
            </div>
            <span className="text-sm bg-success px-2 py-1 rounded">{decoded.type}</span>
          </div>
        </div>

        {/* Transfers Section (most important) */}
        {amounts.length > 0 && (
          <div className="p-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground-muted mb-3">TRANSFERS</h3>
            <div className="space-y-3">
              {formattedTransfers.senders.map((sender, i) => {
                const receiver = formattedTransfers.receivers[i];
                return (
                  <div key={i} className="flex items-center gap-3 p-3 bg-surface-recessed rounded-lg">
                    {/* From */}
                    <div className="flex-1">
                      <div className="text-xs text-foreground-subtle mb-1">From</div>
                      <EntityLink type="account" id={sender.accountId} network={network} />
                    </div>
                    {/* Arrow + Amount */}
                    <div className="flex flex-col items-center">
                      <div className="text-lg font-bold text-foreground tabular-nums">
                        {TransactionDecoder.formatAmount(sender.amount.replace('-', ''), sender.type).replace('+', '').replace('-', '')}
                      </div>
                      <div className="text-foreground-subtle">&rarr;</div>
                    </div>
                    {/* To */}
                    <div className="flex-1 text-right">
                      <div className="text-xs text-foreground-subtle mb-1">To</div>
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
          <div className="p-4 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground-muted mb-2">TOKEN ASSOCIATION</h3>
            <div className="flex flex-wrap gap-2">
              {decoded.details.tokenIds.map((tokenId, index) => (
                <div key={index} className="px-3 py-1 bg-info-soft border border-info/40 rounded">
                  <EntityLink type="token" id={tokenId} network={network} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contract Execution (Phase B9) */}
        {decoded.details.contractId && (
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground-muted">CONTRACT CALL</h3>
              {decoded.details.functionName ? (
                decoded.details.selectorVerified ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success-soft text-success-soft-fg border border-success/40">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    ABI Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-destructive-soft text-destructive-soft-fg border border-destructive/40">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM10 5a1 1 0 011 1v3a1 1 0 11-2 0V6a1 1 0 011-1zm0 8a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
                    </svg>
                    Selector Mismatch
                  </span>
                )
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-warning-soft text-warning-soft-fg border border-warning/40">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  No ABI — Unverifiable
                </span>
              )}
            </div>
            <div className="space-y-2 text-sm text-foreground">
              <div className="flex gap-2">
                <span className="text-foreground-subtle">Contract:</span>
                <EntityLink type="contract" id={decoded.details.contractId} network={network} />
              </div>
              {decoded.details.functionName && (
                <div className="flex gap-2">
                  <span className="text-foreground-subtle">Function:</span>
                  <span className="font-mono font-semibold text-foreground">
                    {decoded.details.functionName}({Object.keys(decoded.details.functionParams || {}).length === 0 ? '' : ''})
                  </span>
                </div>
              )}
              {decoded.details.gas && (
                <div className="flex gap-2">
                  <span className="text-foreground-subtle">Gas:</span>
                  <span className="font-mono text-foreground tabular-nums">{decoded.details.gas.toLocaleString()}</span>
                </div>
              )}
              {/* Phase B9: render decoded args inline as a name/value table */}
              {decoded.details.functionParams && Object.keys(decoded.details.functionParams).length > 0 && (
                <div className="mt-3 p-3 bg-surface-recessed rounded border border-border">
                  <p className="text-xs font-semibold text-foreground-subtle mb-2">PARAMETERS</p>
                  <dl className="space-y-1.5 text-xs">
                    {Object.entries(decoded.details.functionParams).map(([name, value]) => (
                      <div key={name} className="flex gap-3 items-start">
                        <dt className="font-mono text-foreground-subtle flex-shrink-0">{name}:</dt>
                        <dd className="font-mono break-all text-foreground">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              {/* Phase B9: when ABI absent, surface the raw selector + calldata so a
                  technically-savvy participant can verify against 4byte.directory or
                  an expected value. Better than showing nothing. */}
              {!decoded.details.functionName && decoded.details.functionSelector && (
                <div className="mt-3 p-3 bg-warning-soft rounded-md border border-warning/40">
                  <p className="text-xs font-semibold text-warning-soft-fg mb-2">
                    No ABI provided — function name and arguments cannot be decoded.
                  </p>
                  <p className="text-xs text-warning-soft-fg mb-2">
                    Verify the selector below matches the function you expect (look it up at <a href="https://www.4byte.directory" target="_blank" rel="noopener noreferrer" className="underline">4byte.directory</a> or compare against the contract source).
                  </p>
                  <div className="space-y-1 text-xs">
                    <div className="flex gap-2">
                      <span className="text-foreground-subtle flex-shrink-0">Selector:</span>
                      <span className="font-mono break-all text-foreground">{decoded.details.functionSelector}</span>
                    </div>
                    {decoded.details.encodedCalldata && decoded.details.encodedCalldata.length > 10 && (
                      <details>
                        <summary className="cursor-pointer text-foreground-subtle text-xs">Show full calldata ({(decoded.details.encodedCalldata.length - 10) / 2} bytes of args)</summary>
                        <div className="mt-1 font-mono break-all text-foreground-muted bg-surface p-2 rounded-md border border-warning/40">
                          {decoded.details.encodedCalldata}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Metadata from Coordinator (collapsed by default if no issues) */}
        {metadata && (
          <div className="p-4 border-b border-border bg-warning-soft/60">
            <details className={validation && !validation.valid ? 'open' : ''}>
              <summary className="cursor-pointer flex items-center gap-2 text-sm font-semibold text-warning-soft-fg">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <span>Coordinator&apos;s description (not verified)</span>
              </summary>
              <div className="mt-3 p-3 bg-surface rounded-md border border-warning/40 text-xs">
                <pre className="text-foreground-muted whitespace-pre-wrap overflow-x-auto">
                  {JSON.stringify(metadata, null, 2)}
                </pre>
              </div>
            </details>
          </div>
        )}

        {/* Technical Details (collapsed) */}
        <div className="p-4 bg-surface-recessed">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-foreground-muted">
              Transaction Details
            </summary>
            <div className="mt-3 space-y-2 text-xs text-foreground">
              <div className="flex gap-2">
                <span className="text-foreground-subtle">Transaction ID:</span>
                <span className="font-mono text-foreground">{decoded.details.transactionId}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-foreground-subtle">Max Fee:</span>
                <span className="font-mono text-foreground">{decoded.details.maxTransactionFee}</span>
              </div>
              {decoded.details.validStartTimestamp && (
                <div className="flex gap-2">
                  <span className="text-foreground-subtle">Valid Start:</span>
                  <span className="font-mono text-foreground">{new Date(decoded.details.validStartTimestamp * 1000).toLocaleString()}</span>
                </div>
              )}
              {decoded.details.transactionValidDuration && (
                <div className="flex gap-2">
                  <span className="text-foreground-subtle">Valid Duration:</span>
                  <span className="font-mono text-foreground tabular-nums">{decoded.details.transactionValidDuration}s</span>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <span className="text-foreground-subtle">Checksum (SHA256):</span>
                <span className="font-mono text-[10px] break-all bg-surface-recessed p-1 rounded text-foreground-muted">{decoded.checksum}</span>
              </div>
              {decoded.details.transactionMemo && (
                <div className="flex gap-2">
                  <span className="text-foreground-subtle">Memo:</span>
                  <span className="text-foreground">{decoded.details.transactionMemo}</span>
                </div>
              )}

              {/* Nested Raw Transaction Data */}
              <details className="mt-4 pt-3 border-t border-border">
                <summary className="cursor-pointer text-sm font-semibold text-foreground-muted hover:text-foreground hover:text-foreground">
                  Raw Transaction Data
                </summary>
                <div className="mt-3 p-3 bg-surface rounded border border-border overflow-auto max-h-96">
                  <pre className="text-[11px] font-mono text-foreground-muted whitespace-pre-wrap">
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

      {/* ACTIONS — Approve is dominant, Reject is secondary */}
      <div className="space-y-3 pt-4 border-t-2 border-border">
        {/* Approve — the hero action, full-width, visually dominant */}
        <button
          onClick={onApprove}
          disabled={disabled || isExpired}
          className={`w-full px-6 py-4 text-lg font-bold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            isExpired
              ? 'bg-border-strong text-foreground-muted cursor-not-allowed'
              : 'bg-success text-white hover:bg-success shadow-md hover:shadow-lg active:shadow-sm active:translate-y-px'
          }`}
        >
          {isExpired ? 'Transaction Expired' : 'Approve & Sign'}
        </button>

        {/* Reject — secondary, subdued */}
        <div>
          {showRejectInput ? (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Enter optional rejection reason..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full px-4 py-2 border border-border-strong bg-surface rounded focus:ring-2 focus:ring-red-500 text-foreground placeholder:text-foreground-subtle dark:placeholder:text-foreground-subtle"
              />
              <div className="flex space-x-2">
                <button
                  onClick={handleReject}
                  disabled={disabled}
                  className="flex-1 px-4 py-2 bg-destructive text-white font-semibold rounded-lg hover:bg-destructive disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Confirm Rejection
                </button>
                <button
                  onClick={() => {
                    setShowRejectInput(false);
                    setRejectReason('');
                  }}
                  className="px-4 py-2 bg-surface-recessed text-foreground-muted rounded-lg hover:bg-border-strong dark:hover:bg-foreground-subtle transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleReject}
              disabled={disabled}
              className="w-full px-4 py-2 text-sm font-medium text-foreground-muted hover:text-destructive dark:hover:text-destructive hover:bg-destructive-soft dark:hover:bg-destructive-soft rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reject Transaction
            </button>
          )}
        </div>
      </div>

      {/* Warning Footer */}
      <div className="bg-surface-recessed/60 border border-border rounded p-4 text-center">
        <p className="text-sm text-foreground-muted">
          <span className="font-semibold">Important:</span> Signing authorizes this transaction to execute.
          Review the details above before approving.
        </p>
      </div>
    </div>
  );
}

export default TransactionReview;
