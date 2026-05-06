'use client';

import type { SignableAccount } from '../../hooks/useSessionSignableAccounts';

interface AccountSuggestionsProps {
  /** Stable ID for the <datalist> — must be unique per field instance. */
  datalistId: string;
  accounts: SignableAccount[];
  /** Called when the user clicks a suggestion chip. */
  onPick: (accountId: string) => void;
  /** Currently entered value, so we can hide the chip if it already matches. */
  currentValue: string;
  /** Suppress the chip while loading; keeps layout calm during page transitions. */
  isLoading?: boolean;
}

/**
 * Renders an HTML5 <datalist> for native input autocomplete plus a
 * one-tap chip for the dominant single-suggestion case. Place the
 * datalist in the DOM tree adjacent to the input, and reference it via
 * `list={datalistId}` on the input itself.
 */
export function AccountSuggestionsDatalist({
  datalistId,
  accounts,
}: Pick<AccountSuggestionsProps, 'datalistId' | 'accounts'>) {
  if (accounts.length === 0) return null;
  return (
    <datalist id={datalistId}>
      {accounts.map((a) => (
        <option key={a.accountId} value={a.accountId}>
          {a.summary}
        </option>
      ))}
    </datalist>
  );
}

/**
 * Below-input chip strip. Shows up to ~4 covered accounts as one-tap
 * fills. Hides if the input already contains a covered account, or if
 * we're still loading suggestions.
 */
export function AccountSuggestionsChips({
  accounts,
  onPick,
  currentValue,
  isLoading,
}: Omit<AccountSuggestionsProps, 'datalistId'>) {
  if (isLoading) {
    return (
      <p className="mt-1 text-xs text-foreground-subtle italic">
        Loading suggestions…
      </p>
    );
  }
  if (accounts.length === 0) return null;
  const trimmed = currentValue.trim();
  const visible = accounts.filter((a) => a.accountId !== trimmed);
  if (visible.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-foreground-subtle">
        {accounts.length === 1
          ? 'Session can sign for:'
          : 'Session can sign for:'}
      </span>
      {visible.slice(0, 4).map((a) => (
        <button
          key={a.accountId}
          type="button"
          onClick={() => onPick(a.accountId)}
          className="px-2 py-0.5 rounded-md font-mono bg-surface-recessed text-foreground border border-border hover:border-accent hover:bg-surface transition-colors"
          title={`Use ${a.accountId} (${a.summary})`}
        >
          {a.accountId}
        </button>
      ))}
      {visible.length > 4 && (
        <span className="text-foreground-subtle">
          +{visible.length - 4} more
        </span>
      )}
    </div>
  );
}
