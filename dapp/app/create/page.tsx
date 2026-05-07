'use client';

import { useState, useCallback, useEffect } from 'react';
import { useWallet } from '../../hooks/useWallet';
import { useToast } from '../../hooks/useToast';
import { useCoordinatorConnection } from '../../hooks/useCoordinatorConnection';
import { useTransactionInjection } from '../../hooks/useTransactionInjection';
import { useFeePayerCoverage } from '../../hooks/useFeePayerCoverage';
import { useSessionSignableAccounts } from '../../hooks/useSessionSignableAccounts';
import { ToastContainer } from '../../components/Toast';
import { TransactionFields } from '../../components/create/TransactionFields';
import { ConnectStep } from '../../components/create/ConnectStep';
import { ShareStep } from '../../components/create/ShareStep';
import { FeePayerCallout } from '../../components/create/FeePayerCallout';
import {
  SessionMonitor,
  type SessionLiveState,
} from '../../components/create/SessionMonitor';
import {
  FreezeStrategy,
  type NodeStrategyValue,
} from '../../components/create/FreezeStrategy';
import { DEFAULT_SUBSET_SIZE } from '../../lib/node-selection';
import { StepProgress } from '../../components/StepProgress';
import { Footer } from '../../components/Footer';
import { DEFAULT_NETWORK } from '../../lib/walletconnect-config';
import { resolveFeePayer } from '../../lib/fee-payer';
import { fetchAccountBalance, AccountBalance } from '../../lib/mirror-node';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generateConnectionString, parseConnectionString } = require('../../../shared/connection-string');

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

  const [connectionString, setConnectionString] = useState('');
  const [connectionStringError, setConnectionStringError] = useState<string | null>(null);
  const [connectionStringFilled, setConnectionStringFilled] = useState(false);

  const [txType, setTxType] = useState<TransactionType>('hbar-transfer');
  const [txFields, setTxFields] = useState<Record<string, string>>({});
  const [txMode, setTxMode] = useState<'build' | 'paste'>('build');
  const [pastedBase64, setPastedBase64] = useState('');
  const [pastedAbiJson, setPastedAbiJson] = useState('');
  const [nodeStrategy, setNodeStrategy] = useState<NodeStrategyValue>({
    strategy: 'subset',
    subsetSize: DEFAULT_SUBSET_SIZE,
    nodeIds: '',
  });
  // Lifted live session state — SessionMonitor publishes it, ShareStep
  // consumes it to switch between signing / completed / failed layouts.
  const [liveSessionState, setLiveSessionState] = useState<SessionLiveState | null>(null);

  const [fromBalance, setFromBalance] = useState<AccountBalance | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const isTransferType =
    txType === 'hbar-transfer' || txType === 'token-transfer' || txType === 'nft-transfer';

  // Path 2: validate that the resolved fee payer is actually controlled by
  // the session's signing pool. Suppress in paste mode (the fee payer is
  // baked into the frozen tx) and before the coordinator has connected.
  const feePayerCoverage = useFeePayerCoverage({
    txType,
    txFields,
    walletAccountId: wallet.accountId,
    sessionEligibleKeys: connection.sessionCredentials?.eligibleKeys ?? [],
    sessionThreshold: connection.sessionCredentials?.threshold ?? 0,
    network: DEFAULT_NETWORK,
    enabled: txMode === 'build' && step === 'build-tx',
  });

  // Reverse-lookup which on-chain accounts the session can strictly sign for.
  // Surfaced as one-tap chips and a native datalist on the From/Caller/Account
  // fields and inside the FeePayerCallout's override panel — replaces "go
  // consult walkthrough-state.json, copy/paste account ID" with one click in
  // the dominant treasury case.
  const signableAccounts = useSessionSignableAccounts({
    sessionEligibleKeys: connection.sessionCredentials?.eligibleKeys ?? [],
    sessionThreshold: connection.sessionCredentials?.threshold ?? 0,
    network: DEFAULT_NETWORK,
    enabled: step === 'build-tx',
  });

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

  const handleTransactionReset = useCallback(() => {
    // Server confirmed TRANSACTION_RESET. Clear the form fields the previous
    // transaction left behind and route back to the build step. The
    // SessionMonitor's own state already reset itself on the same broadcast.
    setTxFields({});
    injection.reset?.();
    setStep('build-tx');
    toast.info(
      'Transaction reset',
      'Session is back to waiting — build a new transaction below.'
    );
  }, [injection, toast]);

  const handleConnectionStringChange = useCallback((value: string) => {
    const trimmed = value.trim();
    setConnectionString(trimmed);
    setConnectionStringError(null);
    if (!trimmed) {
      setConnectionStringFilled(false);
      return;
    }
    const parsed = parseConnectionString(trimmed);
    if (parsed) {
      setServerUrl(parsed.serverUrl);
      setSessionId(parsed.sessionId);
      if (parsed.pin) setPin(parsed.pin);
      setConnectionStringFilled(true);
    } else {
      setConnectionStringFilled(false);
      setConnectionStringError(
        "This doesn't look like a valid connection string. It should start with hmsc:"
      );
    }
  }, []);

  const handlePasteConnectionString = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) handleConnectionStringChange(text);
    } catch {
      setConnectionStringError(
        'Clipboard access denied. Try pasting manually with Ctrl+V.'
      );
    }
  }, [handleConnectionStringChange]);

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
      const nodeIds = nodeStrategy.strategy === 'specific'
        ? nodeStrategy.nodeIds.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;
      await injection.inject({
        txType,
        txFields,
        walletAccountId: wallet.accountId,
        sessionId,
        nodeSelection: {
          strategy: nodeStrategy.strategy,
          subsetSize: nodeStrategy.subsetSize,
          nodeIds,
        },
      });
      setStep('share');
      toast.success('Transaction Injected', 'Transaction has been broadcast to participants.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      toast.error('Injection Failed', message);
    }
  }, [txType, txFields, wallet.accountId, sessionId, injection, toast, nodeStrategy]);

  const handleInjectPastedBase64 = useCallback(async () => {
    try {
      await injection.injectFrozenBase64(pastedBase64, {
        sessionId,
        label: 'paste-base64',
        abiJson: pastedAbiJson || undefined,
      });
      setStep('share');
      toast.success('Transaction Injected', 'Pre-frozen transaction has been broadcast to participants.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      toast.error('Injection Failed', message);
    }
  }, [pastedBase64, pastedAbiJson, sessionId, injection, toast]);

  const setTxField = useCallback(
    (key: string, value: string) =>
      setTxFields((prev) => ({ ...prev, [key]: value })),
    []
  );

  const shareConnectionString = connection.sessionCredentials
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
              connectionString={connectionString}
              onConnectionStringChange={handleConnectionStringChange}
              onPasteConnectionString={handlePasteConnectionString}
              connectionStringError={connectionStringError}
              connectionStringFilled={connectionStringFilled}
              isConnecting={connection.isConnecting}
              connectError={connection.connectError}
              onConnect={handleConnect}
            />
          )}

          {/* Live session monitor — visible from the build step onward so
              the coordinator sees who's already connected before deciding
              to inject. The condition (build-tx || share) keeps the
              component mounted across the transition, preserving
              participant + state updates received between steps. */}
          {(step === 'build-tx' || step === 'share') &&
            connection.sessionCredentials &&
            connection.ws && (
              <section
                aria-label="Live session"
                className="bg-surface border border-border rounded-md p-5"
              >
                <h2 className="font-heading text-base font-semibold text-foreground mb-3">
                  Live session
                </h2>
                <SessionMonitor
                  ws={connection.ws}
                  wsRef={connection.wsRef}
                  threshold={connection.sessionCredentials.threshold}
                  expectedParticipants={
                    connection.sessionCredentials.eligibleKeys.length
                  }
                  network={DEFAULT_NETWORK}
                  onTransactionReset={handleTransactionReset}
                  initialSessionStatus={connection.sessionCredentials.status}
                  initialParticipants={
                    connection.sessionCredentials.participants
                  }
                  onStateChange={setLiveSessionState}
                />
              </section>
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

              {/* Wallet status — informational, not a hard block. The fee
                  payer is whatever account ends up in From / Account; the
                  wallet is just a fallback when those are blank. For a
                  multi-sig treasury, the threshold account pays its own
                  fee from its own balance — no wallet required. */}
              {!wallet.isConnected && (
                <div
                  role="status"
                  className="border-l-2 border-info bg-info-soft pl-4 py-3 text-sm text-info-soft-fg"
                >
                  <p className="font-semibold">No wallet connected — that&apos;s fine for multi-sig treasury</p>
                  <p className="mt-1">
                    The account in <strong>From</strong> (or <strong>Account</strong> for
                    token-association) pays the network fee. For a multi-sig treasury, that&apos;s
                    typically the threshold account itself. Connect a wallet only if you want a
                    personal wallet to be the fee payer.
                  </p>
                </div>
              )}

              {/* Transaction builder — KEEP the card here. This is where focus + chrome help.
                  In console register, the .console-pane class + data-pane-label add a
                  terminal-window header strip ("~/INJECT.TX") via globals.css. */}
              <div
                className="console-pane bg-surface border border-border rounded-md p-6"
                data-pane-label="~/inject.tx"
              >
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
                        signableAccounts={signableAccounts}
                      />
                    </div>

                    <div className="mt-5">
                      <FeePayerCallout
                        txType={txType}
                        txFields={txFields}
                        walletAccountId={wallet.accountId}
                        mode="build"
                        setTxField={setTxField}
                        coverage={feePayerCoverage}
                        signableAccounts={signableAccounts}
                      />
                    </div>

                    {/* Multi-node freeze bookkeeping (Phase K).
                        Default-collapsed one-line summary; auto-expands
                        when the size estimate hits amber/red so the
                        warning is unmissable. The strategy lever and
                        the size readout live in the same panel — no
                        more upward causality. */}
                    <FreezeStrategy
                      txType={txType}
                      signerCount={connection.sessionCredentials?.threshold ?? 1}
                      value={nodeStrategy}
                      onChange={setNodeStrategy}
                    />

                    {injection.injectError && (
                      <div role="alert" className="mt-4 border-l-2 border-destructive bg-destructive-soft pl-4 py-3 text-sm text-destructive-soft-fg">
                        {injection.injectError}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleInjectTransaction}
                      disabled={
                        injection.isInjecting ||
                        !resolveFeePayer(txType, txFields, wallet.accountId).accountId ||
                        // Block when coverage check has positively determined
                        // the session can't satisfy this account. Don't block
                        // on 'loading' or 'error' — those shouldn't punish the
                        // user for slow infrastructure.
                        feePayerCoverage.status === 'uncovered'
                      }
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

                    <div className="mb-5">
                      <FeePayerCallout
                        txType={txType}
                        txFields={txFields}
                        walletAccountId={wallet.accountId}
                        mode="paste"
                        setTxField={setTxField}
                      />
                    </div>

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

                    {/* Optional ABI for contract calls — when provided,
                        participants see verified function names and decoded
                        arguments. Pre-frozen contract calls (e.g. from
                        prepare-multisig-increment.js) lose this info on
                        the wire; pasting the source ABI restores it. */}
                    <div className="mt-5">
                      <label htmlFor="pasted-abi" className={labelClass}>
                        Contract ABI{' '}
                        <span className="font-normal text-foreground-subtle">
                          (optional — enables verified review for contract calls)
                        </span>
                      </label>
                      <textarea
                        id="pasted-abi"
                        className={inputClass + ' font-mono text-xs'}
                        rows={3}
                        placeholder='[ { "type": "function", "name": "increment", ... }, ... ]'
                        value={pastedAbiJson}
                        onChange={(e) => setPastedAbiJson(e.target.value)}
                      />
                      <p className="mt-1 text-xs text-foreground-subtle">
                        Paste the JSON ABI of the contract you&apos;re calling
                        (e.g.{' '}
                        <code className="text-xs font-mono bg-surface-recessed px-1 rounded">
                          Counter.json
                        </code>
                        &apos;s <code className="font-mono">abi</code> array).
                        Skip for non-contract transactions.
                      </p>
                    </div>

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

          {/* Step 3 — Share. Three-state layout (signing / completed /
              failed) driven by `liveSessionState` lifted out of
              SessionMonitor. Credentials demote to a disclosure once
              signing starts and disappear entirely on completion. */}
          {step === 'share' && connection.sessionCredentials && (
            <ShareStep
              sessionCredentials={connection.sessionCredentials}
              serverUrl={serverUrl}
              connectionString={shareConnectionString}
              shareableUrl={shareableUrl}
              network={DEFAULT_NETWORK}
              liveState={liveSessionState}
              includePinInLink={includePinInLink}
              onTogglePinInLink={setIncludePinInLink}
              onStartAnother={() => {
                setStep('build-tx');
                injection.reset();
                setTxFields({});
                setPastedBase64('');
                setPastedAbiJson('');
                // Clear lifted live state too — SessionMonitor will
                // republish fresh state when the next TRANSACTION_RECEIVED
                // arrives, but null-ing here avoids a brief flash of the
                // previous CompletedReceipt if the user route-flips
                // before the new event lands.
                setLiveSessionState(null);
              }}
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
