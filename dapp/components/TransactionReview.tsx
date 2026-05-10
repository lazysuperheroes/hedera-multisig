/**
 * TransactionReview Component
 *
 * Security-critical surface: shows what's about to be signed, lets the
 * participant approve or reject. The most-viewed page in the dApp;
 * the visual discipline matters as much as the logic.
 *
 * Verified-vs-unverified contract:
 *   - Cryptographically verified data (decoded from frozen tx bytes)
 *     is the page's primary content — left-aligned, flat, no
 *     decorative chrome.
 *   - Coordinator-supplied metadata renders in three modes:
 *       (a) all fields verified → quiet "additional context" details
 *       (b) some verified some not → split panel
 *       (c) nothing verifiable → clear note with explanation
 *     Hard mismatches (claim ≠ actual) trigger a destructive warning
 *     above the main body.
 *
 * Composition follows the post-redesign discipline of /join, /history,
 * the session page, and ScheduledReview: flat sections separated by
 * `border-t`, no per-section card chrome, mode banner / countdown /
 * warnings as left-border callouts. Approve + Reject as side-by-side
 * actions, both first-class (Reject is no longer a muted text link).
 */

'use client';

import { useState, useEffect } from 'react';
import type { ethers } from 'ethers';
import {
  TransactionDecoder,
  DecodedTransaction,
  MetadataValidation,
  ExtractedAmount,
} from '../lib/transaction-decoder';
import { Icon } from './Icon';

export interface TransactionReviewProps {
  frozenTransactionBase64: string;
  metadata?: Record<string, unknown>;
  contractInterface?: unknown; // ethers Interface
  onApprove: () => void;
  onReject: (reason: string) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function EntityLink({ type, id, network }: { type: 'account' | 'contract' | 'token'; id: string; network?: string }) {
  return (
    <a
      href={getHashScanUrl(type, id, network)}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent hover:underline font-mono inline-flex items-center gap-1"
      title={`View ${id} on HashScan`}
    >
      {id}
      <Icon name="open_in_new" size={12} />
    </a>
  );
}

function formatTimeRemaining(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

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
  const [, setAccounts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [isExpired, setIsExpired] = useState(false);
  const network = process.env.NEXT_PUBLIC_DEFAULT_NETWORK || 'testnet';

  // Countdown timer
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
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [decoded?.details.expiresAt]);

  useEffect(() => {
    async function decodeTransaction() {
      try {
        setLoading(true);
        setError(null);
        const decodedTx = await TransactionDecoder.decode(
          frozenTransactionBase64,
          contractInterface as ethers.Interface | undefined
        );
        setDecoded(decodedTx);
        const extractedAmounts = TransactionDecoder.extractAmounts(decodedTx.details);
        setAmounts(extractedAmounts);
        const extractedAccounts = TransactionDecoder.extractAccounts(decodedTx.details);
        setAccounts(extractedAccounts);
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

  // Loading state — flat bones matching the new structure (eyebrow,
  // headline, status row, content rows, action footer).
  if (loading) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading transaction details">
        <div className="space-y-2">
          <div className="skeleton h-3 w-24 rounded"></div>
          <div className="skeleton h-8 w-64 rounded"></div>
        </div>
        <div className="skeleton h-12 w-full rounded"></div>
        <div className="space-y-2 border-t border-border pt-5">
          <div className="skeleton h-4 w-32 rounded"></div>
          <div className="skeleton h-4 w-3/4 rounded"></div>
          <div className="skeleton h-4 w-1/2 rounded"></div>
        </div>
        <div className="border-t border-border pt-5 flex gap-3">
          <div className="skeleton h-12 flex-1 rounded-md"></div>
          <div className="skeleton h-12 w-24 rounded-md"></div>
        </div>
      </div>
    );
  }

  // Error state — flat, asymmetric, Icon + heading + reject CTA.
  if (error) {
    return (
      <div className="flex items-start gap-3">
        <Icon name="error_outline" size={28} className="text-destructive flex-shrink-0 mt-1" />
        <div className="flex-1">
          <h2 className="font-heading text-lg font-bold text-foreground mb-1">
            Could not read transaction
          </h2>
          <p className="text-sm text-destructive-soft-fg mb-4">{error}</p>
          <button
            onClick={() => onReject(`Decoding error: ${error}`)}
            className="inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium text-foreground border border-border-strong hover:bg-surface-recessed transition-colors"
          >
            Reject transaction
          </button>
        </div>
      </div>
    );
  }

  if (!decoded) return null;

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

  const progressPercent = decoded?.details.transactionValidDuration && secondsRemaining !== null
    ? Math.max(0, Math.min(100, ((decoded.details.transactionValidDuration - secondsRemaining) / decoded.details.transactionValidDuration) * 100))
    : 0;

  return (
    <div className="space-y-6">

      {/* Expired banner — left-border callout, no card */}
      {isExpired && (
        <div role="alert" className="flex items-start gap-3 border-l-2 border-destructive bg-destructive-soft pl-4 py-3 rounded-r-md">
          <Icon name="error_outline" size={20} className="text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-destructive-soft-fg">Transaction expired</p>
            <p className="text-sm text-destructive-soft-fg/90">
              This transaction has timed out and can no longer be signed.
              Ask the coordinator to inject a new one.
            </p>
          </div>
        </div>
      )}

      {/* Countdown — left-border callout that shifts color/severity as
          the clock runs down. Three tiers (info → warning → destructive)
          carry the urgency without decorative motion. */}
      {secondsRemaining !== null && !isExpired && (
        <div className={`border-l-2 pl-4 py-3 rounded-r-md ${
          secondsRemaining <= 30 ? 'bg-destructive-soft border-destructive' :
          secondsRemaining <= 60 ? 'bg-warning-soft border-warning' :
          'bg-info-soft/50 border-info'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Icon
                name="schedule"
                size={18}
                className={secondsRemaining <= 30 ? 'text-destructive' : secondsRemaining <= 60 ? 'text-warning' : 'text-info'}
              />
              <span className={`text-sm font-semibold ${
                secondsRemaining <= 30 ? 'text-destructive-soft-fg' :
                secondsRemaining <= 60 ? 'text-warning-soft-fg' :
                'text-info-soft-fg'
              }`}>
                <span className="treasury-label">Time to sign</span>
                <span className="console-label">time_remaining</span>
              </span>
            </div>
            <span className={`font-mono font-bold text-base tabular-nums ${
              secondsRemaining <= 30 ? 'text-destructive-soft-fg' :
              secondsRemaining <= 60 ? 'text-warning-soft-fg' :
              'text-info-soft-fg'
            }`}>
              {formatTimeRemaining(secondsRemaining)}
            </span>
          </div>
          <div
            className="w-full bg-surface-recessed rounded-full h-1.5 overflow-hidden"
            role="progressbar"
            aria-valuenow={secondsRemaining}
            aria-valuemin={0}
            aria-valuemax={decoded?.details.transactionValidDuration || 120}
            aria-label={`${secondsRemaining} seconds remaining to sign`}
          >
            <div
              className={`h-full rounded-full transition-all duration-1000 ${
                secondsRemaining <= 30 ? 'bg-destructive' :
                secondsRemaining <= 60 ? 'bg-warning' :
                'bg-info'
              }`}
              style={{ width: `${100 - progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Mismatch warning — destructive left-border callout when the
          coordinator's metadata claims something different from what
          the bytes say. */}
      {validation && Object.keys(validation.mismatches).length > 0 && (
        <div role="alert" className="border-l-2 border-destructive bg-destructive-soft pl-4 py-3 rounded-r-md">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="warning" size={18} className="text-destructive flex-shrink-0" />
            <p className="font-semibold text-destructive-soft-fg">
              Metadata mismatch
            </p>
          </div>
          <p className="text-sm text-destructive-soft-fg/90 mb-2">
            What the coordinator claims this transaction does doesn&apos;t
            match what it actually does. Review carefully before signing.
          </p>
          <details className="text-xs">
            <summary className="cursor-pointer text-destructive-soft-fg hover:underline">
              Show details
            </summary>
            <div className="mt-2 space-y-1 text-destructive-soft-fg">
              {Object.entries(validation.mismatches).map(([field, { metadata: meta, actual }]) => (
                <div key={field}>
                  <span className="font-semibold">{field}:</span>{' '}
                  claimed &quot;{JSON.stringify(meta)}&quot; vs actual &quot;{JSON.stringify(actual)}&quot;
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Header — eyebrow + title. Replaces the previous bg-success
          green band; success is reserved for downstream status moments
          (threshold met, mirror confirmed). Decoding the bytes isn't
          a moment to celebrate — it's table stakes. */}
      <header>
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-medium text-foreground-muted mb-2">
          <Icon name="verified" size={14} className="text-success" />
          <span className="treasury-label">Verified · what you&apos;re signing</span>
          <span className="console-label">verified_tx</span>
        </div>
        <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground">
          {decoded.type}
        </h2>
      </header>

      {/* Transfers — flat dl rendering each sender→receiver pair as a
          row. No per-row card; just key:value with a center arrow. */}
      {amounts.length > 0 && (
        <section className="border-t border-border pt-5">
          <div className="text-xs uppercase tracking-wider font-medium text-foreground-muted mb-3">
            <span className="treasury-label">Transfers</span>
            <span className="console-label">transfers</span>
          </div>
          <div className="space-y-3">
            {formattedTransfers.senders.map((sender, i) => {
              const receiver = formattedTransfers.receivers[i];
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-foreground-subtle">From</div>
                    <EntityLink type="account" id={sender.accountId} network={network} />
                  </div>
                  <div className="flex flex-col items-center flex-shrink-0">
                    <div className="text-base font-semibold text-foreground tabular-nums">
                      {TransactionDecoder.formatAmount(sender.amount.replace('-', ''), sender.type).replace('+', '').replace('-', '')}
                    </div>
                    <Icon name="arrow_forward" size={16} className="text-foreground-subtle" />
                  </div>
                  <div className="flex-1 min-w-0 text-right">
                    <div className="text-xs text-foreground-subtle">To</div>
                    {receiver && <EntityLink type="account" id={receiver.accountId} network={network} />}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Token association — flat list of token IDs as inline pills. */}
      {decoded.details.tokenIds && decoded.details.tokenIds.length > 0 && (
        <section className="border-t border-border pt-5">
          <div className="text-xs uppercase tracking-wider font-medium text-foreground-muted mb-3">
            <span className="treasury-label">Token association</span>
            <span className="console-label">token_associate</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {decoded.details.tokenIds.map((tokenId, index) => (
              <div key={index} className="inline-flex items-center px-2 py-0.5 bg-info-soft text-info-soft-fg rounded text-xs font-mono">
                <EntityLink type="token" id={tokenId} network={network} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Contract call — flat dl with ABI-verification status pill */}
      {decoded.details.contractId && (
        <section className="border-t border-border pt-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="text-xs uppercase tracking-wider font-medium text-foreground-muted">
              <span className="treasury-label">Contract call</span>
              <span className="console-label">contract_call</span>
            </div>
            <AbiBadge details={decoded.details} />
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex gap-3">
              <dt className="w-24 flex-shrink-0 text-foreground-subtle text-xs uppercase tracking-wider pt-0.5">Contract</dt>
              <dd className="text-foreground"><EntityLink type="contract" id={decoded.details.contractId} network={network} /></dd>
            </div>
            {decoded.details.functionName && (
              <div className="flex gap-3">
                <dt className="w-24 flex-shrink-0 text-foreground-subtle text-xs uppercase tracking-wider pt-0.5">Function</dt>
                <dd className="font-mono font-semibold text-foreground">{decoded.details.functionName}()</dd>
              </div>
            )}
            {decoded.details.gas && (
              <div className="flex gap-3">
                <dt className="w-24 flex-shrink-0 text-foreground-subtle text-xs uppercase tracking-wider pt-0.5">Gas</dt>
                <dd className="font-mono text-foreground tabular-nums">{decoded.details.gas.toLocaleString()}</dd>
              </div>
            )}
          </dl>

          {/* Decoded params */}
          {decoded.details.functionParams && Object.keys(decoded.details.functionParams).length > 0 && (
            <div className="mt-4">
              <div className="text-xs uppercase tracking-wider font-medium text-foreground-muted mb-2">Parameters</div>
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

          {/* No-ABI fallback — surface raw selector + calldata so a
              technically-savvy participant can verify against
              4byte.directory. */}
          {!decoded.details.functionName && decoded.details.functionSelector && (
            <div className="mt-4 border-l-2 border-warning bg-warning-soft/30 pl-4 py-3 rounded-r-md">
              <p className="text-xs font-semibold text-warning-soft-fg mb-2">
                No ABI provided — function name and arguments cannot be decoded.
              </p>
              <p className="text-xs text-warning-soft-fg/90 mb-2">
                Verify the selector below matches the function you expect (look it up at{' '}
                <a href="https://www.4byte.directory" target="_blank" rel="noopener noreferrer" className="underline">4byte.directory</a>).
              </p>
              <div className="space-y-1 text-xs">
                <div className="flex gap-2">
                  <span className="text-foreground-subtle flex-shrink-0">Selector:</span>
                  <span className="font-mono break-all text-foreground">{decoded.details.functionSelector}</span>
                </div>
                {decoded.details.encodedCalldata && decoded.details.encodedCalldata.length > 10 && (
                  <details>
                    <summary className="cursor-pointer text-foreground-subtle hover:text-foreground transition-colors">
                      Show full calldata ({(decoded.details.encodedCalldata.length - 10) / 2} bytes of args)
                    </summary>
                    <div className="mt-1 font-mono break-all text-foreground-muted bg-surface-recessed p-2 rounded">
                      {decoded.details.encodedCalldata}
                    </div>
                  </details>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Coordinator metadata — three rendering modes (verified /
          mixed / unverifiable). Sub-component handles the branching. */}
      {metadata && (
        <CoordinatorMetadataSection
          metadata={metadata}
          validation={validation}
        />
      )}

      {/* Technical details — collapsed by default. Tx ID, max fee,
          checksum, raw transaction body. Engineers expand when
          they need to. */}
      <section className="border-t border-border pt-5">
        <details>
          <summary className="cursor-pointer text-xs uppercase tracking-wider font-medium text-foreground-muted hover:text-foreground transition-colors">
            <span className="treasury-label">Technical details</span>
            <span className="console-label">tx.details</span>
          </summary>
          <div className="mt-3 space-y-2 text-xs">
            <div className="flex gap-3">
              <dt className="w-32 flex-shrink-0 text-foreground-subtle uppercase tracking-wider pt-0.5">Transaction ID</dt>
              <dd className="font-mono text-foreground break-all">{decoded.details.transactionId}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-32 flex-shrink-0 text-foreground-subtle uppercase tracking-wider pt-0.5">Max fee</dt>
              <dd className="font-mono text-foreground">{decoded.details.maxTransactionFee}</dd>
            </div>
            {decoded.details.validStartTimestamp && (
              <div className="flex gap-3">
                <dt className="w-32 flex-shrink-0 text-foreground-subtle uppercase tracking-wider pt-0.5">Valid start</dt>
                <dd className="font-mono text-foreground">{new Date(decoded.details.validStartTimestamp * 1000).toLocaleString()}</dd>
              </div>
            )}
            {decoded.details.transactionValidDuration && (
              <div className="flex gap-3">
                <dt className="w-32 flex-shrink-0 text-foreground-subtle uppercase tracking-wider pt-0.5">Valid duration</dt>
                <dd className="font-mono text-foreground tabular-nums">{decoded.details.transactionValidDuration}s</dd>
              </div>
            )}
            <div className="flex gap-3">
              <dt className="w-32 flex-shrink-0 text-foreground-subtle uppercase tracking-wider pt-0.5">Checksum</dt>
              <dd className="font-mono text-[10px] break-all text-foreground-muted">{decoded.checksum}</dd>
            </div>
            {decoded.details.transactionMemo && (
              <div className="flex gap-3">
                <dt className="w-32 flex-shrink-0 text-foreground-subtle uppercase tracking-wider pt-0.5">Memo</dt>
                <dd className="text-foreground">{decoded.details.transactionMemo}</dd>
              </div>
            )}

            <details className="mt-3 pt-2">
              <summary className="cursor-pointer text-foreground-subtle hover:text-foreground transition-colors">
                Raw transaction data
              </summary>
              <div className="mt-2 p-3 bg-surface-recessed rounded overflow-auto max-h-96">
                <pre className="text-[11px] font-mono text-foreground-muted whitespace-pre-wrap">
                  {JSON.stringify(decoded.details, (key, value) => {
                    if (value instanceof Uint8Array) return `[Uint8Array(${value.length})]`;
                    if (typeof value === 'bigint') return value.toString();
                    return value;
                  }, 2)}
                </pre>
              </div>
            </details>
          </div>
        </details>
      </section>

      {/* Actions — Approve + Reject side-by-side. Both first-class;
          Reject is a real ghost button next to Approve, not the muted
          text-link it used to be. Optional rejection-reason input
          appears inline if Reject is clicked once (click again to
          confirm). */}
      <div className="border-t border-border pt-6">
        {showRejectInput ? (
          <div className="space-y-3">
            <label htmlFor="reject-reason" className="block text-sm font-medium text-foreground">
              Why are you rejecting this?
            </label>
            <input
              id="reject-reason"
              type="text"
              placeholder="Optional rejection reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              autoFocus
              className="w-full px-4 py-2 rounded-md border border-border bg-surface text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent transition-colors"
            />
            <div className="flex gap-3">
              <button
                onClick={handleReject}
                disabled={disabled}
                className="flex-1 inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-semibold bg-destructive text-destructive-fg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                Confirm rejection
              </button>
              <button
                onClick={() => {
                  setShowRejectInput(false);
                  setRejectReason('');
                }}
                className="inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium text-foreground border border-border-strong hover:bg-surface-recessed transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={onApprove}
              disabled={disabled || isExpired}
              className="cmd flex-1 inline-flex items-center justify-center px-6 py-3 rounded-md text-base font-semibold bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isExpired ? 'Transaction expired' : 'Approve'}
              {!isExpired && <span className="treasury-label ml-2 opacity-70">→</span>}
            </button>
            <button
              onClick={handleReject}
              disabled={disabled}
              className="inline-flex items-center justify-center px-6 py-3 rounded-md text-sm font-medium text-foreground border border-border-strong hover:bg-surface-recessed disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

/**
 * AbiBadge — verified / mismatch / no-ABI status pill for the contract
 * call section. Three states; soft-bg pills, no border-color hedges,
 * Icon glyphs from the project's canonical icon set.
 */
function AbiBadge({ details }: { details: DecodedTransaction['details'] }) {
  if (!details.functionName) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-warning-soft text-warning-soft-fg">
        <Icon name="warning" size={12} />
        No ABI
      </span>
    );
  }
  // The verified path: selector matches the ABI AND args re-encode
  // byte-for-byte against the original calldata.
  const verified = details.abiVerified ?? details.selectorVerified;
  if (verified) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-success-soft text-success-soft-fg"
        title="Selector matches the ABI AND the decoded args re-encode byte-for-byte against the original calldata"
      >
        <Icon name="check_circle" size={12} fill={1} />
        ABI verified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-destructive-soft text-destructive-soft-fg">
      <Icon name="error_outline" size={12} />
      ABI mismatch
    </span>
  );
}

/**
 * CoordinatorMetadataSection — three rendering modes:
 *   (a) Has verified fields AND no unverified surplus → quiet
 *       "verified additional context" details disclosure (no callout
 *       chrome; the verification is the signal, not chrome).
 *   (b) Some verified, some unverifiable → split: verified summary
 *       on top, unverifiable JSON underneath with explanation.
 *   (c) Nothing verifiable at all → warning-flavor disclosure with a
 *       clear note about what would make it green.
 *
 * Hard mismatches (claim ≠ actual) trigger the destructive callout
 * above the main body, not here.
 */
function CoordinatorMetadataSection({
  metadata,
  validation,
}: {
  metadata: Record<string, unknown>;
  validation: MetadataValidation | null;
}) {
  const verifiedKeys = validation ? Object.keys(validation.verified || {}) : [];
  const hasVerified = verifiedKeys.length > 0;
  const cf = (metadata.customFields && typeof metadata.customFields === 'object')
    ? metadata.customFields as Record<string, unknown>
    : null;
  const unverifiableCustomFields: Record<string, unknown> | null = cf
    ? Object.fromEntries(Object.entries(cf).filter(([k]) => !verifiedKeys.includes(k)))
    : null;
  const otherMetadata: Record<string, unknown> = Object.fromEntries(
    Object.entries(metadata).filter(([k]) => k !== 'customFields'),
  );
  const hasUnverifiableSurplus =
    (unverifiableCustomFields && Object.keys(unverifiableCustomFields).length > 0) ||
    Object.keys(otherMetadata).length > 0;

  // Mode (a): everything verified, nothing left over.
  if (hasVerified && !hasUnverifiableSurplus) {
    return (
      <section className="border-t border-border pt-5">
        <details>
          <summary className="cursor-pointer flex items-center gap-2 text-xs uppercase tracking-wider font-medium text-foreground-muted hover:text-foreground transition-colors">
            <Icon name="verified" size={14} className="text-success" />
            <span className="treasury-label">Verified additional context</span>
            <span className="console-label">metadata.verified</span>
          </summary>
          <dl className="mt-3 space-y-1.5 text-xs">
            {verifiedKeys.map((k) => (
              <div key={k} className="flex gap-3">
                <dt className="text-foreground-subtle">{k}:</dt>
                <dd className="font-mono break-all text-foreground flex-1">
                  {JSON.stringify(validation!.verified[k].matched)}
                  <span className="ml-2 text-success-soft-fg">✓ matches frozen tx</span>
                </dd>
              </div>
            ))}
          </dl>
        </details>
      </section>
    );
  }

  // Mode (b) / (c): some or none verified, surplus to surface.
  return (
    <section className="border-t border-border pt-5">
      <details>
        <summary className="cursor-pointer flex items-center gap-2 text-xs uppercase tracking-wider font-medium text-foreground-muted hover:text-foreground transition-colors">
          <Icon name="info" size={14} className="text-warning" />
          <span className="treasury-label">
            Coordinator&apos;s description{hasVerified ? ' (some fields verified)' : ' (informational)'}
          </span>
          <span className="console-label">metadata.unverified</span>
        </summary>
        <div className="mt-3 space-y-3 text-xs">
          {hasVerified && (
            <div className="border-l-2 border-success pl-3 py-2">
              <p className="text-success-soft-fg font-semibold mb-1">
                Verified against the frozen transaction
              </p>
              <dl className="space-y-1">
                {verifiedKeys.map((k) => (
                  <div key={k} className="flex gap-2">
                    <dt className="text-foreground-subtle">{k}:</dt>
                    <dd className="font-mono break-all text-foreground">
                      {JSON.stringify(validation!.verified[k].matched)}
                      <span className="ml-2 text-success-soft-fg">✓</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <div className="border-l-2 border-warning pl-3 py-2">
            <p className="text-foreground-muted mb-2">
              The fields below are coordinator-supplied context the dApp
              can&apos;t cross-check against the on-chain transaction
              (they describe intent, not transaction payload). Trust
              them only as much as you trust the coordinator.
            </p>
            <pre className="text-foreground-muted whitespace-pre-wrap overflow-x-auto">
              {JSON.stringify(
                {
                  ...otherMetadata,
                  ...(unverifiableCustomFields && Object.keys(unverifiableCustomFields).length > 0
                    ? { customFields: unverifiableCustomFields }
                    : {}),
                },
                null,
                2,
              )}
            </pre>
          </div>
        </div>
      </details>
    </section>
  );
}

export default TransactionReview;
