'use client';

import { useState } from 'react';
import {
  resolveFeePayer,
  isValidAccountId,
  type TransactionType,
} from '../../lib/fee-payer';
import type { CoverageState } from '../../hooks/useFeePayerCoverage';
import type { SignableAccountsState } from '../../hooks/useSessionSignableAccounts';
import {
  AccountSuggestionsDatalist,
  AccountSuggestionsChips,
} from './AccountSuggestions';

interface FeePayerCalloutProps {
  txType: TransactionType;
  txFields: Record<string, string>;
  walletAccountId: string | null;
  mode: 'build' | 'paste';
  setTxField: (key: string, value: string) => void;
  coverage?: CoverageState;
  signableAccounts?: SignableAccountsState;
}

export function FeePayerCallout({
  txType,
  txFields,
  walletAccountId,
  mode,
  setTxField,
  coverage,
  signableAccounts,
}: FeePayerCalloutProps) {
  const [showOverride, setShowOverride] = useState(false);
  const [draftOverride, setDraftOverride] = useState(
    txFields.feePayerOverride || ''
  );
  const [overrideError, setOverrideError] = useState<string | null>(null);

  if (mode === 'paste') {
    return (
      <div
        role="status"
        className="border-l-2 border-info bg-info-soft pl-4 py-3 text-sm text-info-soft-fg"
      >
        <p>
          <strong>Fee payer:</strong> Pre-frozen transaction — fee payer was set
          when the transaction was built.
        </p>
      </div>
    );
  }

  const resolved = resolveFeePayer(txType, txFields, walletAccountId);
  const { accountId, source } = resolved;

  // Tone follows coverage when we have a verdict; otherwise stay neutral-info.
  const tone =
    coverage?.status === 'covered'
      ? {
          border: 'border-success',
          bg: 'bg-success-soft',
          text: 'text-success-soft-fg',
        }
      : coverage?.status === 'uncovered'
        ? {
            border: 'border-destructive',
            bg: 'bg-destructive-soft',
            text: 'text-destructive-soft-fg',
          }
        : coverage?.status === 'error'
          ? {
              border: 'border-warning',
              bg: 'bg-warning-soft',
              text: 'text-warning-soft-fg',
            }
          : {
              border: 'border-info',
              bg: 'bg-info-soft',
              text: 'text-info-soft-fg',
            };

  const accountSpan = accountId ? (
    <code className="font-mono text-foreground">{accountId}</code>
  ) : null;

  const lineForSource = () => {
    if (!accountId) {
      const primaryField =
        txType === 'token-association'
          ? 'Account'
          : txType === 'contract-call'
            ? 'Caller'
            : 'From';
      return (
        <span>
          <strong>Fee payer:</strong> <em>not set</em> — fill the{' '}
          <strong>{primaryField}</strong> field, connect a wallet, or use
          Override.
        </span>
      );
    }
    switch (source) {
      case 'from-field':
        return (
          <span>
            <strong>Fee payer:</strong> {accountSpan} — pays from the{' '}
            <strong>From</strong> account.
          </span>
        );
      case 'account-field':
        return (
          <span>
            <strong>Fee payer:</strong> {accountSpan} — pays from the{' '}
            <strong>Account</strong> field.
          </span>
        );
      case 'contract-caller-field':
        return (
          <span>
            <strong>Fee payer:</strong> {accountSpan} — pays from the{' '}
            <strong>Caller</strong> field.
          </span>
        );
      case 'wallet':
        return (
          <span>
            <strong>Fee payer:</strong> {accountSpan} — pays from your{' '}
            <strong>connected wallet</strong>. Connect a different wallet, or
            fill the primary field, to change.
          </span>
        );
      case 'override':
        return (
          <span>
            <strong>Fee payer:</strong> {accountSpan} —{' '}
            <strong>manual override</strong>. The transaction will use this
            account as fee payer regardless of the primary field.
          </span>
        );
      default:
        return null;
    }
  };

  const handleSaveOverride = () => {
    const trimmed = draftOverride.trim();
    if (!trimmed) {
      setOverrideError('Account ID cannot be blank.');
      return;
    }
    if (!isValidAccountId(trimmed)) {
      setOverrideError('Format must be 0.0.XXXXX (Hedera account ID).');
      return;
    }
    setTxField('feePayerOverride', trimmed);
    setShowOverride(false);
    setOverrideError(null);
  };

  const handleClearOverride = () => {
    setTxField('feePayerOverride', '');
    setDraftOverride('');
    setShowOverride(false);
    setOverrideError(null);
  };

  const renderCoverageLine = () => {
    if (!coverage || coverage.status === 'idle') return null;
    if (coverage.status === 'loading') {
      return (
        <p className="mt-1.5 text-xs italic opacity-80">Verifying coverage…</p>
      );
    }
    const prefix =
      coverage.status === 'covered'
        ? '✓'
        : coverage.status === 'uncovered'
          ? '⚠'
          : 'ⓘ';
    return (
      <p className="mt-1.5 text-xs">
        <span aria-hidden="true">{prefix}</span> {coverage.message}
      </p>
    );
  };

  return (
    <div
      role="status"
      className={`border-l-2 ${tone.border} ${tone.bg} pl-4 py-3 text-sm ${tone.text}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          {lineForSource()}
          {renderCoverageLine()}
        </div>
        <div className="flex shrink-0 gap-3">
          {source === 'override' ? (
            <button
              type="button"
              onClick={handleClearOverride}
              className="text-xs underline hover:no-underline"
            >
              Use From / wallet instead
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraftOverride(txFields.feePayerOverride || '');
                setShowOverride((v) => !v);
              }}
              className="text-xs underline hover:no-underline"
              aria-expanded={showOverride}
            >
              {showOverride ? 'Cancel' : 'Override'}
            </button>
          )}
        </div>
      </div>

      {showOverride && (
        <div className="mt-3 pt-3 border-t border-info/30 space-y-2">
          <label
            htmlFor="fee-payer-override"
            className="block text-xs font-medium text-foreground"
          >
            Fee payer account ID
          </label>
          <div className="flex gap-2">
            <input
              id="fee-payer-override"
              type="text"
              className="flex-1 px-3 py-2 rounded-md font-mono text-sm bg-surface text-foreground placeholder:text-foreground-subtle border border-border focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="0.0.XXXXX"
              value={draftOverride}
              onChange={(e) => {
                setDraftOverride(e.target.value);
                setOverrideError(null);
              }}
              autoComplete="off"
              spellCheck={false}
              list={signableAccounts ? 'fee-payer-override-suggestions' : undefined}
            />
            <button
              type="button"
              onClick={handleSaveOverride}
              className="px-3 py-2 rounded-md text-sm bg-accent text-accent-fg hover:bg-accent-hover transition-colors"
            >
              Save
            </button>
          </div>
          {signableAccounts && (
            <>
              <AccountSuggestionsDatalist
                datalistId="fee-payer-override-suggestions"
                accounts={signableAccounts.accounts}
              />
              <AccountSuggestionsChips
                accounts={signableAccounts.accounts}
                onPick={(id) => {
                  setDraftOverride(id);
                  setOverrideError(null);
                }}
                currentValue={draftOverride}
                isLoading={signableAccounts.status === 'loading'}
              />
            </>
          )}
          {overrideError && (
            <p role="alert" className="text-xs text-destructive">
              {overrideError}
            </p>
          )}
          <p className="text-xs text-foreground-subtle">
            Use this when the fee payer differs from the sender (e.g. a sponsor
            account). Both accounts must sign.
          </p>
        </div>
      )}
    </div>
  );
}
