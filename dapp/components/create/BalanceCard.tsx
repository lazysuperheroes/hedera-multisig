'use client';

import type { AccountBalance } from '../../lib/mirror-node';

interface BalanceCardProps {
  balance: AccountBalance | null;
  isLoading: boolean;
  error: string | null;
}

export function BalanceCard({ balance, isLoading, error }: BalanceCardProps) {
  if (isLoading) {
    return (
      <div className="mt-2 p-3 bg-surface-recessed rounded-lg flex items-center gap-2">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent" />
        <span className="text-sm text-foreground-subtle">
          Fetching balance...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-2 border-l-2 border-destructive bg-destructive-soft pl-3 py-2 text-sm text-destructive-soft-fg rounded-r-md">
        {error}
      </div>
    );
  }

  if (!balance) return null;

  return (
    <div className="mt-2 border-l-2 border-success bg-success-soft pl-3 py-2 rounded-r-md space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground-muted">
          Balance:
        </span>
        <span className="text-sm font-semibold text-success-soft-fg tabular-nums">
          {balance.hbarBalance}
        </span>
      </div>
      {balance.tokens.length > 0 && (
        <div className="text-xs text-foreground-muted space-y-0.5">
          <span className="font-medium">Tokens:</span>
          <ul className="ml-3 space-y-0.5">
            {balance.tokens.slice(0, 5).map((t) => (
              <li key={t.tokenId} className="font-mono tabular-nums">
                {t.tokenId}: {t.balance}
              </li>
            ))}
            {balance.tokens.length > 5 && (
              <li className="italic">
                +{balance.tokens.length - 5} more token
                {balance.tokens.length - 5 !== 1 ? 's' : ''}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
