'use client';

import { useState, useCallback, useEffect } from 'react';
import { useWallet } from '../../hooks/useWallet';
import { useToast } from '../../hooks/useToast';
import { useCoordinatorConnection } from '../../hooks/useCoordinatorConnection';
import { useTransactionInjection } from '../../hooks/useTransactionInjection';
import { ToastContainer } from '../../components/Toast';
import { TransactionFields } from '../../components/create/TransactionFields';
import { ConnectStep } from '../../components/create/ConnectStep';
import { ShareStep } from '../../components/create/ShareStep';
import { StepProgress } from '../../components/StepProgress';
import { DEFAULT_NETWORK } from '../../lib/walletconnect-config';
import { fetchAccountBalance, AccountBalance } from '../../lib/mirror-node';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generateConnectionString } = require('../../../shared/connection-string');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TransactionType =
  | 'hbar-transfer'
  | 'token-transfer'
  | 'nft-transfer'
  | 'token-association'
  | 'contract-call';

type Step = 'connect' | 'build-tx' | 'share';

const DEFAULT_SERVER_URL =
  process.env.NEXT_PUBLIC_MULTISIG_SERVER_URL || 'ws://localhost:3001';

// ---------------------------------------------------------------------------
// Shared Tailwind classes
// ---------------------------------------------------------------------------

const inputClass =
  'w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg ' +
  'focus:ring-2 focus:ring-blue-500 focus:border-transparent ' +
  'bg-white dark:bg-gray-700 text-gray-900 dark:text-white ' +
  'placeholder:text-gray-400 dark:placeholder:text-gray-500';

const labelClass =
  'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2';

const cardClass =
  'bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6';

const primaryBtnClass =
  'w-full px-6 py-4 bg-blue-600 text-white font-semibold rounded-lg shadow-lg ' +
  'hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
  'flex items-center justify-center gap-2';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CreatePage() {
  const wallet = useWallet();
  const toast = useToast();

  // Hooks for business logic
  const connection = useCoordinatorConnection();
  const injection = useTransactionInjection(connection.wsRef);

  // ---- Step state -----------------------------------------------------------
  const [step, setStep] = useState<Step>('connect');

  // ---- Step 1: form fields --------------------------------------------------
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [sessionId, setSessionId] = useState('');
  const [pin, setPin] = useState('');
  const [coordinatorToken, setCoordinatorToken] = useState('');

  // ---- Step 2: transaction builder ------------------------------------------
  const [txType, setTxType] = useState<TransactionType>('hbar-transfer');
  const [txFields, setTxFields] = useState<Record<string, string>>({});

  // ---- Balance lookup -------------------------------------------------------
  const [fromBalance, setFromBalance] = useState<AccountBalance | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const isTransferType =
    txType === 'hbar-transfer' ||
    txType === 'token-transfer' ||
    txType === 'nft-transfer';

  const handleFromBlur = useCallback(async () => {
    const accountId = txFields.from || wallet.accountId;
    if (!accountId || !isTransferType) return;
    if (!/^0\.0\.\d+$/.test(accountId)) return;

    setIsLoadingBalance(true);
    setBalanceError(null);
    setFromBalance(null);

    try {
      const balance = await fetchAccountBalance(accountId, DEFAULT_NETWORK);
      if (balance) {
        setFromBalance(balance);
      } else {
        setBalanceError('Account not found');
      }
    } catch {
      setBalanceError('Failed to fetch balance');
    } finally {
      setIsLoadingBalance(false);
    }
  }, [txFields.from, wallet.accountId, isTransferType]);

  // Reset balance when transaction type changes
  useEffect(() => {
    setFromBalance(null);
    setBalanceError(null);
  }, [txType]);

  // ---- Handlers (delegate to hooks) -----------------------------------------

  const handleConnect = useCallback(async () => {
    try {
      const { hasTransaction } = await connection.connect({
        serverUrl, sessionId, pin, coordinatorToken,
      });
      toast.success('Connected', 'Authenticated as coordinator successfully.');
      if (hasTransaction) {
        setStep('share');
      } else {
        setStep('build-tx');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      toast.error('Connection Failed', message);
    }
  }, [serverUrl, sessionId, pin, coordinatorToken, connection, toast]);

  const handleInjectTransaction = useCallback(async () => {
    try {
      await injection.inject({
        txType,
        txFields,
        walletAccountId: wallet.accountId!,
        sessionId,
      });
      setStep('share');
      toast.success('Transaction Injected', 'Transaction has been broadcast to participants.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      toast.error('Injection Failed', message);
    }
  }, [txType, txFields, wallet.accountId, sessionId, injection, toast]);

  const setTxField = useCallback(
    (key: string, value: string) =>
      setTxFields((prev) => ({ ...prev, [key]: value })),
    []
  );

  // ---- Derived values -------------------------------------------------------

  const connectionString =
    connection.sessionCredentials
      ? generateConnectionString(
          serverUrl,
          connection.sessionCredentials.sessionId,
          connection.sessionCredentials.pin
        )
      : '';

  const shareableUrl =
    connection.sessionCredentials && typeof window !== 'undefined'
      ? `${window.location.origin}/join?server=${encodeURIComponent(
          serverUrl
        )}&session=${encodeURIComponent(
          connection.sessionCredentials.sessionId
        )}&pin=${encodeURIComponent(connection.sessionCredentials.pin)}`
      : '';

  const createSteps = [
    { key: 'connect', label: 'Connect' },
    { key: 'build-tx', label: 'Build' },
    { key: 'share', label: 'Share' },
  ];
  const stepOrder: Step[] = ['connect', 'build-tx', 'share'];
  const currentStepIndex = stepOrder.indexOf(step);

  // ---- Render ---------------------------------------------------------------

  return (
    <main className="min-h-screen p-4 sm:p-8 bg-[var(--background)]">
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />

      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
            Create Session
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            Connect to a signing session, build a transaction, and share with
            participants.
          </p>
        </div>

        <div className="space-y-6">

        {/* Step indicator */}
        <StepProgress steps={createSteps} currentIndex={currentStepIndex} />

        {/* Step 1 -- Connect to session */}
        {step === 'connect' && (
          <ConnectStep
            serverUrl={serverUrl}
            onServerUrlChange={setServerUrl}
            sessionId={sessionId}
            onSessionIdChange={setSessionId}
            pin={pin}
            onPinChange={setPin}
            coordinatorToken={coordinatorToken}
            onCoordinatorTokenChange={setCoordinatorToken}
            isConnecting={connection.isConnecting}
            connectError={connection.connectError}
            onConnect={handleConnect}
          />
        )}

        {/* Step 2 -- Transaction Builder */}
        {step === 'build-tx' && connection.sessionCredentials && (
          <section aria-label="Build transaction" className="space-y-6">
            {/* Session info summary */}
            <div className={cardClass}>
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
                Session Info
              </h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-gray-500 dark:text-gray-400">Session ID</dt>
                <dd className="font-mono text-gray-900 dark:text-white truncate">
                  {connection.sessionCredentials.sessionId}
                </dd>
                <dt className="text-gray-500 dark:text-gray-400">Status</dt>
                <dd>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300">
                    {connection.sessionCredentials.status}
                  </span>
                </dd>
                <dt className="text-gray-500 dark:text-gray-400">Threshold</dt>
                <dd className="text-gray-900 dark:text-white">
                  {connection.sessionCredentials.threshold} of{' '}
                  {connection.sessionCredentials.eligibleKeys.length}
                </dd>
                <dt className="text-gray-500 dark:text-gray-400">Expires</dt>
                <dd className="text-gray-900 dark:text-white">
                  {connection.sessionCredentials.expiresAt || 'N/A'}
                </dd>
              </dl>
            </div>

            {/* Wallet check */}
            {!wallet.isConnected && (
              <div
                role="alert"
                className="p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm text-yellow-800 dark:text-yellow-300 flex items-start gap-3"
              >
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div>
                  <p className="font-semibold">Wallet not connected</p>
                  <p>Connect your wallet using the button in the navigation bar. The connected account will be used as the transaction operator (fee payer).</p>
                </div>
              </div>
            )}

            {/* Transaction builder card */}
            <div className={cardClass}>
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
                Build Transaction
              </h2>

              <div className="mb-6">
                <label htmlFor="txType" className={labelClass}>
                  Transaction Type
                </label>
                <select
                  id="txType"
                  className={inputClass}
                  value={txType}
                  onChange={(e) => {
                    setTxType(e.target.value as TransactionType);
                    setTxFields({});
                  }}
                >
                  <option value="hbar-transfer">HBAR Transfer</option>
                  <option value="token-transfer">Token Transfer</option>
                  <option value="nft-transfer">NFT Transfer</option>
                  <option value="token-association">Token Association</option>
                  <option value="contract-call">Contract Call</option>
                </select>
              </div>

              <div className="space-y-5">
                <TransactionFields
                  txType={txType}
                  txFields={txFields}
                  setTxField={setTxField}
                  onFromBlur={handleFromBlur}
                  walletAccountId={wallet.accountId}
                  balance={fromBalance}
                  isLoadingBalance={isLoadingBalance}
                  balanceError={balanceError}
                />
              </div>

              {injection.injectError && (
                <div role="alert" className="mt-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
                  {injection.injectError}
                </div>
              )}

              <button
                type="button"
                onClick={handleInjectTransaction}
                disabled={injection.isInjecting || !wallet.isConnected}
                className={primaryBtnClass + ' mt-6'}
              >
                {injection.isInjecting && (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                )}
                {injection.isInjecting ? 'Building & Injecting...' : 'Build & Inject Transaction'}
              </button>
            </div>
          </section>
        )}

        {/* Step 3 -- Share credentials & monitor */}
        {step === 'share' && connection.sessionCredentials && (
          <ShareStep
            sessionCredentials={connection.sessionCredentials}
            serverUrl={serverUrl}
            connectionString={connectionString}
            shareableUrl={shareableUrl}
            injectionDone={injection.injectionDone}
          />
        )}

        </div>
      </div>
    </main>
  );
}
