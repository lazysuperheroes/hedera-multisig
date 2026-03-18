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
      <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg flex items-center gap-2">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Fetching balance...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-600 dark:text-red-400">
        {error}
      </div>
    );
  }

  if (!balance) return null;

  return (
    <div className="mt-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Balance:
        </span>
        <span className="text-sm font-semibold text-green-700 dark:text-green-300 tabular-nums">
          {balance.hbarBalance}
        </span>
      </div>
      {balance.tokens.length > 0 && (
        <div className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
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
