'use client';

import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
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
          <ContractAbiEditor txFields={txFields} setTxField={setTxField} />
        </>
      );
  }
}

/**
 * Phase B10: ABI-driven contract-call editor.
 *
 * Coordinator pastes a contract ABI JSON; the component parses it, presents a
 * function dropdown, and renders one typed input per argument. As inputs
 * change, the calldata is encoded via ethers.Interface and stored in
 * `functionData`. Falls back to raw-hex paste when no ABI is provided —
 * preserving the previous workflow for power users.
 */
function ContractAbiEditor({
  txFields,
  setTxField,
}: {
  txFields: Record<string, string>;
  setTxField: (key: string, value: string) => void;
}) {
  const [abiText, setAbiText] = useState(txFields.abiJson || '');
  const [selectedFn, setSelectedFn] = useState<string>(txFields.functionName || '');
  const [argValues, setArgValues] = useState<Record<string, string>>({});

  const { iface, fnList, parseError } = useMemo(() => {
    if (!abiText.trim()) return { iface: null, fnList: [], parseError: null };
    try {
      const parsed = JSON.parse(abiText);
      const i = new ethers.Interface(parsed);
      const fns: { name: string; signature: string; inputs: ReadonlyArray<ethers.ParamType> }[] = [];
      i.forEachFunction((fragment) => {
        // Skip view/pure if you want — but coordinators may want to call constants too.
        // Filter to non-constructor functions only.
        fns.push({
          name: fragment.name,
          signature: fragment.format('sighash'),
          inputs: fragment.inputs,
        });
      });
      return { iface: i, fnList: fns, parseError: null };
    } catch (err) {
      return { iface: null, fnList: [], parseError: (err as Error).message };
    }
  }, [abiText]);

  const selectedFragment = useMemo(() => {
    if (!iface || !selectedFn) return null;
    try {
      return iface.getFunction(selectedFn);
    } catch {
      return null;
    }
  }, [iface, selectedFn]);

  // Encode calldata when args change
  useEffect(() => {
    if (!iface || !selectedFragment) return;
    try {
      const orderedArgs = selectedFragment.inputs.map((input, idx) => {
        const key = input.name || `arg${idx}`;
        const raw = argValues[key] || '';
        // Light coercion for common types — ethers handles strings well otherwise
        if (input.type.startsWith('uint') || input.type.startsWith('int')) {
          return raw.trim() === '' ? '0' : raw.trim();
        }
        if (input.type === 'bool') {
          return raw.toLowerCase() === 'true' || raw === '1';
        }
        return raw;
      });
      const encoded = iface.encodeFunctionData(selectedFn, orderedArgs);
      setTxField('functionData', encoded);
      setTxField('abiJson', abiText);
      setTxField('functionName', selectedFn);
    } catch {
      // Encoding errors (bad arg values) — leave functionData as-is so user sees the error in build step
    }
  }, [iface, selectedFragment, selectedFn, argValues, abiText, setTxField]);

  const inputClassLocal =
    'w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg ' +
    'focus:ring-2 focus:ring-blue-500 focus:border-transparent ' +
    'bg-white dark:bg-gray-700 text-gray-900 dark:text-white ' +
    'placeholder:text-gray-400 dark:placeholder:text-gray-500';
  const labelClassLocal =
    'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2';

  return (
    <>
      <div>
        <label htmlFor="tx-abi" className={labelClassLocal}>
          Contract ABI (JSON) <span className="text-gray-500 font-normal">— optional, but enables verified review</span>
        </label>
        <textarea
          id="tx-abi"
          className={inputClassLocal + ' font-mono text-xs'}
          placeholder='[ { "type": "function", "name": "transfer", "inputs": [...] }, ... ]'
          rows={4}
          value={abiText}
          onChange={(e) => setAbiText(e.target.value)}
        />
        {parseError && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            ABI parse error: {parseError}
          </p>
        )}
        {iface && fnList.length > 0 && (
          <p className="mt-1 text-xs text-green-700 dark:text-green-400">
            ABI loaded — {fnList.length} function{fnList.length === 1 ? '' : 's'} available. Participants will see verified function names and decoded arguments.
          </p>
        )}
      </div>

      {iface && fnList.length > 0 && (
        <div>
          <label htmlFor="tx-fn" className={labelClassLocal}>
            Function <span className="text-red-500">*</span>
          </label>
          <select
            id="tx-fn"
            className={inputClassLocal}
            value={selectedFn}
            onChange={(e) => {
              setSelectedFn(e.target.value);
              setArgValues({});
            }}
          >
            <option value="">— Select function —</option>
            {fnList.map((fn) => (
              <option key={fn.signature} value={fn.name}>
                {fn.signature}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedFragment && selectedFragment.inputs.length > 0 && (
        <div className="space-y-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 p-4">
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">
            ARGUMENTS for {selectedFragment.name}()
          </p>
          {selectedFragment.inputs.map((input, idx) => {
            const key = input.name || `arg${idx}`;
            return (
              <div key={key}>
                <label htmlFor={`arg-${key}`} className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                  <code className="font-mono">{input.name || `arg${idx}`}</code>
                  <span className="ml-2 text-gray-400">({input.type})</span>
                </label>
                <input
                  id={`arg-${key}`}
                  type="text"
                  className={inputClassLocal + ' text-sm font-mono'}
                  placeholder={argPlaceholder(input.type)}
                  value={argValues[key] || ''}
                  onChange={(e) =>
                    setArgValues({ ...argValues, [key]: e.target.value })
                  }
                />
              </div>
            );
          })}
        </div>
      )}

      <div>
        <label htmlFor="tx-fnData" className={labelClassLocal}>
          Encoded Calldata {iface && selectedFn ? '(auto-generated)' : '(paste hex if no ABI)'}
        </label>
        <textarea
          id="tx-fnData"
          className={inputClassLocal + ' font-mono text-xs'}
          placeholder="0x..."
          rows={3}
          value={txFields.functionData || ''}
          onChange={(e) => setTxField('functionData', e.target.value)}
          readOnly={!!(iface && selectedFn)}
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {iface && selectedFn
            ? 'Generated from ABI + arguments above. Edit ABI/args to change.'
            : 'ABI-encoded function call data in hexadecimal. Provide an ABI above for verified review.'}
        </p>
      </div>
    </>
  );
}

function argPlaceholder(type: string): string {
  if (type.startsWith('uint') || type.startsWith('int')) return '0';
  if (type === 'address') return '0x...';
  if (type === 'bool') return 'true / false';
  if (type === 'bytes' || type.startsWith('bytes')) return '0x...';
  if (type === 'string') return 'value';
  return '';
}
