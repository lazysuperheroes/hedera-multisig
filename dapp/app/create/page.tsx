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
import { Footer } from '../../components/Footer';
import { DEFAULT_NETWORK } from '../../lib/walletconnect-config';
import { fetchAccountBalance, AccountBalance } from '../../lib/mirror-node';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generateConnectionString } = require('../../../shared/connection-string');

type TransactionType =
  | 'hbar-transfer'
  | 'token-transfer'
  | 'nft-transfer'
  | 'token-association'
  | 'contract-call';

type Step = 'connect' | 'build-tx' | 'share';

const DEFAULT_SERVER_URL =
  process.env.NEXT_PUBLIC_MULTISIG_SERVER_URL || 'ws://localhost:3001';

// Token-aware shared classes
const inputClass =
  'w-full px-4 py-3 rounded-md bg-surface text-foreground placeholder:text-foreground-subtle ' +
  'border border-border focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent';

const labelClass = 'block text-sm font-medium text-foreground mb-2';

const primaryBtnClass =
  'w-full px-6 py-3.5 bg-accent text-accent-fg font-semibold rounded-md ' +
  'hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
  'flex items-center justify-center gap-2';

export default function CreatePage() {
  const wallet = useWallet();
  const toast = useToast();
  const connection = useCoordinatorConnection();
  const injection = useTransactionInjection(connection.wsRef);

  const [step, setStep] = useState<Step>('connect');

  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [sessionId, setSessionId] = useState('');
  const [pin, setPin] = useState('');
  const [coordinatorToken, setCoordinatorToken] = useState('');
  const [includePinInLink, setIncludePinInLink] = useState(false);

  const [txType, setTxType] = useState<TransactionType>('hbar-transfer');
  const [txFields, setTxFields] = useState<Record<string, string>>({});
  const [txMode, setTxMode] = useState<'build' | 'paste'>('build');
  const [pastedBase64, setPastedBase64] = useState('');

  const [fromBalance, setFromBalance] = useState<AccountBalance | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const isTransferType =
    txType === 'hbar-transfer' || txType === 'token-transfer' || txType === 'nft-transfer';

  const handleFromBlur = useCallback(async () => {
    const accountId = txFields.from || wallet.accountId;
    if (!accountId || !isTransferType) return;
    if (!/^0\.0\.\d+$/.test(accountId)) return;

    setIsLoadingBalance(true);
    setBalanceError(null);
    setFromBalance(null);

    try {
      const balance = await fetchAccountBalance(accountId, DEFAULT_NETWORK);
      if (balance) setFromBalance(balance);
      else setBalanceError('Account not found');
    } catch {
      setBalanceError('Failed to fetch balance');
    } finally {
      setIsLoadingBalance(false);
    }
  }, [txFields.from, wallet.accountId, isTransferType]);

  useEffect(() => {
    setFromBalance(null);
    setBalanceError(null);
  }, [txType]);

  const handleConnect = useCallback(async () => {
    try {
      const { hasTransaction } = await connection.connect({
        serverUrl, sessionId, pin, coordinatorToken,
      });
      toast.success('Connected', 'Authenticated as coordinator successfully.');
      setStep(hasTransaction ? 'share' : 'build-tx');
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

  const handleInjectPastedBase64 = useCallback(async () => {
    try {
      await injection.injectFrozenBase64(pastedBase64, { sessionId, label: 'paste-base64' });
      setStep('share');
      toast.success('Transaction Injected', 'Pre-frozen transaction has been broadcast to participants.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      toast.error('Injection Failed', message);
    }
  }, [pastedBase64, sessionId, injection, toast]);

  const setTxField = useCallback(
    (key: string, value: string) =>
      setTxFields((prev) => ({ ...prev, [key]: value })),
    []
  );

  const connectionString = connection.sessionCredentials
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
        )}${
          includePinInLink
            ? `&pin=${encodeURIComponent(connection.sessionCredentials.pin)}`
            : ''
        }`
      : '';

  const createSteps = [
    { key: 'connect', label: 'Connect' },
    { key: 'build-tx', label: 'Build' },
    { key: 'share', label: 'Share' },
  ];
  const stepOrder: Step[] = ['connect', 'build-tx', 'share'];
  const currentStepIndex = stepOrder.indexOf(step);

  return (
    <main className="min-h-screen p-4 sm:p-8 bg-background">
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />

      <div className="max-w-2xl mx-auto">
        {/* Header — H1 only. The StepProgress below carries the
            "what comes next" signal; subtitle would just restate it. */}
        <h1 className="page-hero font-heading text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-8">
          Create Session
        </h1>

        <div className="space-y-8">
          <StepProgress steps={createSteps} currentIndex={currentStepIndex} />

          {/* Step 1 — Connect */}
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

          {/* Step 2 — Transaction Builder */}
          {step === 'build-tx' && connection.sessionCredentials && (
            <section aria-label="Build transaction" className="space-y-8">
              {/* Session info — flat inline dl. Hairline divider above
                  marks the section transition without needing chrome.
                  (Critique #3 minor obs.) */}
              <div className="pt-2 border-t border-border">
                <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
                  <dt className="text-foreground-subtle">ID</dt>
                  <dd className="font-mono text-foreground truncate">
                    {connection.sessionCredentials.sessionId}
                  </dd>
                  <dt className="text-foreground-subtle">Status</dt>
                  <dd>
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-warning-soft text-warning-soft-fg">
                      {connection.sessionCredentials.status}
                    </span>
                  </dd>
                  <dt className="text-foreground-subtle">Threshold</dt>
                  <dd className="text-foreground tabular-nums">
                    {connection.sessionCredentials.threshold} of{' '}
                    {connection.sessionCredentials.eligibleKeys.length}
                  </dd>
                  <dt className="text-foreground-subtle">Expires</dt>
                  <dd className="text-foreground">
                    {connection.sessionCredentials.expiresAt || 'N/A'}
                  </dd>
                </dl>
              </div>

              {/* Wallet check — flat alert, no border-only card */}
              {!wallet.isConnected && (
                <div
                  role="alert"
                  className="border-l-2 border-warning bg-warning-soft pl-4 py-3 text-sm text-warning-soft-fg"
                >
                  <p className="font-semibold">Wallet not connected</p>
                  <p>
                    Connect your wallet using the button in the navigation bar. The connected
                    account will be used as the transaction operator (fee payer).
                  </p>
                </div>
              )}

              {/* Transaction builder — KEEP the card here. This is where focus + chrome help. */}
              <div className="bg-surface border border-border rounded-md p-6">
                <h2 className="font-heading text-lg font-semibold text-foreground mb-4">
                  Inject transaction
                </h2>

                {/* Phase D13a + F4: tabs with WAI-ARIA tablist semantics */}
                <div
                  className="mb-6 flex gap-2 border-b border-border"
                  role="tablist"
                  aria-label="Transaction injection mode"
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                      e.preventDefault();
                      setTxMode(txMode === 'build' ? 'paste' : 'build');
                    } else if (e.key === 'Home') {
                      e.preventDefault();
                      setTxMode('build');
                    } else if (e.key === 'End') {
                      e.preventDefault();
                      setTxMode('paste');
                    }
                  }}
                >
                  <TabButton
                    id="build-tab"
                    controls="build-panel"
                    selected={txMode === 'build'}
                    onClick={() => setTxMode('build')}
                  >
                    Build from form
                  </TabButton>
                  <TabButton
                    id="paste-tab"
                    controls="paste-panel"
                    selected={txMode === 'paste'}
                    onClick={() => setTxMode('paste')}
                  >
                    Paste frozen TX
                  </TabButton>
                </div>

                {txMode === 'build' && (
                  <div role="tabpanel" id="build-panel" aria-labelledby="build-tab">
                    <div className="mb-6">
                      <label htmlFor="txType" className={labelClass}>
                        Transaction type
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
                      <div role="alert" className="mt-4 border-l-2 border-destructive bg-destructive-soft pl-4 py-3 text-sm text-destructive-soft-fg">
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
                        <span className="inline-block w-4 h-4 rounded-full border-2 border-current border-r-transparent animate-spin" />
                      )}
                      {injection.isInjecting ? 'Building & injecting…' : 'Build & inject transaction'}
                    </button>
                  </div>
                )}

                {txMode === 'paste' && (
                  <div role="tabpanel" id="paste-panel" aria-labelledby="paste-tab">
                    <p className="text-sm text-foreground-muted mb-3">
                      Paste a pre-frozen transaction (base64) from the CLI prep scripts (e.g.{' '}
                      <code className="text-xs font-mono bg-surface-recessed px-1 rounded">
                        examples/walkthrough-contract/07-prepare-multisig-increment.js
                      </code>
                      ) and inject as-is. No wallet required — the pre-frozen transaction already
                      has its own payer + transactionId.
                    </p>

                    <label htmlFor="pasted-base64" className={labelClass}>
                      Frozen transaction (base64)
                    </label>
                    <textarea
                      id="pasted-base64"
                      className={inputClass + ' font-mono text-xs'}
                      rows={6}
                      placeholder="CgQQBxgL..."
                      value={pastedBase64}
                      onChange={(e) => setPastedBase64(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-foreground-subtle">
                      Length: <span className="tabular-nums">{pastedBase64.trim().length}</span> chars
                      {pastedBase64.trim().length > 0 &&
                        <> (~<span className="tabular-nums">{Math.round(pastedBase64.trim().length * 3 / 4)}</span> raw bytes)</>}
                      . Frozen transactions have a 120-second validity — paste + inject quickly after
                      running the prep script.
                    </p>

                    {injection.injectError && (
                      <div role="alert" className="mt-4 border-l-2 border-destructive bg-destructive-soft pl-4 py-3 text-sm text-destructive-soft-fg">
                        {injection.injectError}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleInjectPastedBase64}
                      disabled={injection.isInjecting || pastedBase64.trim().length === 0}
                      className={primaryBtnClass + ' mt-6'}
                    >
                      {injection.isInjecting && (
                        <span className="inline-block w-4 h-4 rounded-full border-2 border-current border-r-transparent animate-spin" />
                      )}
                      {injection.isInjecting ? 'Injecting…' : 'Inject pre-frozen transaction'}
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Step 3 — Share */}
          {step === 'share' && connection.sessionCredentials && (
            <ShareStep
              sessionCredentials={connection.sessionCredentials}
              serverUrl={serverUrl}
              connectionString={connectionString}
              shareableUrl={shareableUrl}
              injectionDone={injection.injectionDone}
              includePinInLink={includePinInLink}
              onTogglePinInLink={setIncludePinInLink}
            />
          )}
        </div>
      </div>

      <Footer variant="compact" />
    </main>
  );
}

interface TabButtonProps {
  id: string;
  controls: string;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ id, controls, selected, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={selected}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      onClick={onClick}
      className={`
        px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
        focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2
        focus-visible:ring-offset-background rounded-t
        ${selected
          ? 'border-accent text-accent'
          : 'border-transparent text-foreground-subtle hover:text-foreground'}
      `}
    >
      {children}
    </button>
  );
}
