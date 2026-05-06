/**
 * Single source of truth for "which account pays the network fee?"
 *
 * Both the build/inject hook and the FeePayerCallout consume this so they
 * cannot disagree about the resolved payer. Priority order:
 *
 *   1. txFields.feePayerOverride — explicit coordinator override
 *   2. Per-type primary field:
 *        - transfer types  → txFields.from
 *        - token-association → txFields.account
 *        - contract-call   → txFields.caller
 *   3. walletAccountId — connected-wallet fallback
 *   4. unset (no payer derivable)
 */

export type FeePayerSource =
  | 'from-field'
  | 'account-field'
  | 'contract-caller-field'
  | 'wallet'
  | 'override'
  | 'unset';

export type TransactionType =
  | 'hbar-transfer'
  | 'token-transfer'
  | 'nft-transfer'
  | 'token-association'
  | 'contract-call';

export interface ResolvedFeePayer {
  accountId: string | null;
  source: FeePayerSource;
}

const ACCOUNT_ID_REGEX = /^0\.0\.\d+$/;

export function isValidAccountId(value: string): boolean {
  return ACCOUNT_ID_REGEX.test(value.trim());
}

export function resolveFeePayer(
  txType: TransactionType,
  txFields: Record<string, string>,
  walletAccountId: string | null
): ResolvedFeePayer {
  const override = txFields.feePayerOverride?.trim();
  if (override) {
    return { accountId: override, source: 'override' };
  }

  if (txType === 'token-association') {
    const account = txFields.account?.trim();
    if (account) return { accountId: account, source: 'account-field' };
  } else if (txType === 'contract-call') {
    const caller = txFields.caller?.trim();
    if (caller) return { accountId: caller, source: 'contract-caller-field' };
  } else {
    const from = txFields.from?.trim();
    if (from) return { accountId: from, source: 'from-field' };
  }

  if (walletAccountId) {
    return { accountId: walletAccountId, source: 'wallet' };
  }

  return { accountId: null, source: 'unset' };
}
