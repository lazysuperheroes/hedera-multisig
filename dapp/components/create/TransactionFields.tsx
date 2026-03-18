'use client';

import { BalanceCard } from './BalanceCard';
import type { AccountBalance } from '../../lib/mirror-node';

type TransactionType =
  | 'hbar-transfer'
  | 'token-transfer'
  | 'nft-transfer'
  | 'token-association'
  | 'contract-call';

interface TransactionFieldsProps {
  txType: TransactionType;
  txFields: Record<string, string>;
  setTxField: (key: string, value: string) => void;
  onFromBlur: () => void;
  walletAccountId: string | null;
  balance: AccountBalance | null;
  isLoadingBalance: boolean;
  balanceError: string | null;
}

const inputClass =
  'w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg ' +
  'focus:ring-2 focus:ring-blue-500 focus:border-transparent ' +
  'bg-white dark:bg-gray-700 text-gray-900 dark:text-white ' +
  'placeholder:text-gray-400 dark:placeholder:text-gray-500';

const labelClass =
  'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2';

function FromAccountField({
  txFields,
  setTxField,
  onFromBlur,
  walletAccountId,
  balance,
  isLoadingBalance,
  balanceError,
}: Omit<TransactionFieldsProps, 'txType'>) {
  return (
    <div>
      <label htmlFor="tx-from" className={labelClass}>
        From Account
      </label>
      <input
        id="tx-from"
        type="text"
        className={inputClass}
        placeholder={walletAccountId || '0.0.xxxxx'}
        value={txFields.from || ''}
        onChange={(e) => setTxField('from', e.target.value)}
        onBlur={onFromBlur}
      />
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Defaults to connected wallet if left blank.
      </p>
      <BalanceCard balance={balance} isLoading={isLoadingBalance} error={balanceError} />
    </div>
  );
}

function ToAccountField({
  txFields,
  setTxField,
}: Pick<TransactionFieldsProps, 'txFields' | 'setTxField'>) {
  return (
    <div>
      <label htmlFor="tx-to" className={labelClass}>
        To Account <span className="text-red-500">*</span>
      </label>
      <input
        id="tx-to"
        type="text"
        className={inputClass}
        placeholder="0.0.xxxxx"
        value={txFields.to || ''}
        onChange={(e) => setTxField('to', e.target.value)}
        required
      />
    </div>
  );
}

function TokenIdField({
  txFields,
  setTxField,
}: Pick<TransactionFieldsProps, 'txFields' | 'setTxField'>) {
  return (
    <div>
      <label htmlFor="tx-tokenId" className={labelClass}>
        Token ID <span className="text-red-500">*</span>
      </label>
      <input
        id="tx-tokenId"
        type="text"
        className={inputClass}
        placeholder="0.0.xxxxx"
        value={txFields.tokenId || ''}
        onChange={(e) => setTxField('tokenId', e.target.value)}
        required
      />
    </div>
  );
}

export function TransactionFields(props: TransactionFieldsProps) {
  const { txType, txFields, setTxField } = props;

  switch (txType) {
    case 'hbar-transfer':
      return (
        <>
          <FromAccountField {...props} />
          <ToAccountField txFields={txFields} setTxField={setTxField} />
          <div>
            <label htmlFor="tx-amount" className={labelClass}>
              Amount (HBAR) <span className="text-red-500">*</span>
            </label>
            <input
              id="tx-amount"
              type="number"
              step="0.00000001"
              min="0"
              className={inputClass}
              placeholder="1.0"
              value={txFields.amount || ''}
              onChange={(e) => setTxField('amount', e.target.value)}
              required
            />
          </div>
        </>
      );

    case 'token-transfer':
      return (
        <>
          <TokenIdField txFields={txFields} setTxField={setTxField} />
          <FromAccountField {...props} />
          <ToAccountField txFields={txFields} setTxField={setTxField} />
          <div>
            <label htmlFor="tx-amount" className={labelClass}>
              Amount (smallest unit) <span className="text-red-500">*</span>
            </label>
            <input
              id="tx-amount"
              type="number"
              min="0"
              className={inputClass}
              placeholder="100"
              value={txFields.amount || ''}
              onChange={(e) => setTxField('amount', e.target.value)}
              required
            />
          </div>
        </>
      );

    case 'nft-transfer':
      return (
        <>
          <TokenIdField txFields={txFields} setTxField={setTxField} />
          <div>
            <label htmlFor="tx-serial" className={labelClass}>
              Serial Number <span className="text-red-500">*</span>
            </label>
            <input
              id="tx-serial"
              type="number"
              min="1"
              className={inputClass}
              placeholder="1"
              value={txFields.serial || ''}
              onChange={(e) => setTxField('serial', e.target.value)}
              required
            />
          </div>
          <FromAccountField {...props} />
          <ToAccountField txFields={txFields} setTxField={setTxField} />
        </>
      );

    case 'token-association':
      return (
        <>
          <div>
            <label htmlFor="tx-account" className={labelClass}>
              Account
            </label>
            <input
              id="tx-account"
              type="text"
              className={inputClass}
              placeholder={props.walletAccountId || '0.0.xxxxx'}
              value={txFields.account || ''}
              onChange={(e) => setTxField('account', e.target.value)}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Defaults to connected wallet if left blank.
            </p>
          </div>
          <div>
            <label htmlFor="tx-tokenIds" className={labelClass}>
              Token IDs (comma-separated) <span className="text-red-500">*</span>
            </label>
            <input
              id="tx-tokenIds"
              type="text"
              className={inputClass}
              placeholder="0.0.111, 0.0.222"
              value={txFields.tokenIds || ''}
              onChange={(e) => setTxField('tokenIds', e.target.value)}
              required
            />
          </div>
        </>
      );

    case 'contract-call':
      return (
        <>
          <div>
            <label htmlFor="tx-contractId" className={labelClass}>
              Contract ID <span className="text-red-500">*</span>
            </label>
            <input
              id="tx-contractId"
              type="text"
              className={inputClass}
              placeholder="0.0.xxxxx"
              value={txFields.contractId || ''}
              onChange={(e) => setTxField('contractId', e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="tx-gas" className={labelClass}>
              Gas
            </label>
            <input
              id="tx-gas"
              type="number"
              min="21000"
              className={inputClass}
              placeholder="100000"
              value={txFields.gas || ''}
              onChange={(e) => setTxField('gas', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="tx-fnData" className={labelClass}>
              Function Parameters (hex)
            </label>
            <textarea
              id="tx-fnData"
              className={inputClass + ' font-mono text-sm'}
              placeholder="0x..."
              rows={3}
              value={txFields.functionData || ''}
              onChange={(e) => setTxField('functionData', e.target.value)}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              ABI-encoded function call data in hexadecimal.
            </p>
          </div>
        </>
      );
  }
}
