'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useWallet } from '../../hooks/useWallet';
import { useToast } from '../../hooks/useToast';
import { useCoordinatorConnection } from '../../hooks/useCoordinatorConnection';
import { useTransactionInjection } from '../../hooks/useTransactionInjection';
import { useFeePayerCoverage } from '../../hooks/useFeePayerCoverage';
import { useSessionSignableAccounts } from '../../hooks/useSessionSignableAccounts';
import { useTheme } from '../../contexts/ThemeContext';
import { ToastContainer } from '../../components/Toast';
import { CopyButton } from '../../components/CopyButton';
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
import {
  ScheduleOptions,
  SCHEDULE_OPTIONS_DEFAULT,
  type ScheduleOptionsValue,
} from '../../components/create/ScheduleOptions';
import { DEFAULT_SUBSET_SIZE } from '../../lib/node-selection';
import { StepProgress } from '../../components/StepProgress';
import { Footer } from '../../components/Footer';
import { DEFAULT_NETWORK } from '../../lib/walletconnect-config';
import { resolveFeePayer } from '../../lib/fee-payer';
import { fetchAccountBalance, AccountBalance } from '../../lib/mirror-node';
import { formatRelativeFuture } from '../../lib/timeParser';

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

// Primary CTA — matches /join's Connect button: .cmd for $⏎ console
// decoration, hero-cta-primary for register-aware ghost-in-console
// flatten, plus the treasury → arrow rendered inline by callers via
// <span className="treasury-label">.
const primaryBtnClass =
  'cmd hero-cta-primary w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 ' +
  'rounded-md text-base font-semibold bg-accent text-accent-fg hover:bg-accent-hover ' +
  'transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

// Transaction type tabs. Five types as a chip-row instead of a
// <select> — surfaces the supported types confidently, matches the
// Stripe/Mercury aesthetic better than a dropdown, and reads as a
// real choice rather than a hidden selector.
const TX_TYPES: Array<{ value: TransactionType; label: string }> = [
  { value: 'hbar-transfer', label: 'HBAR transfer' },
  { value: 'token-transfer', label: 'Token transfer' },
  { value: 'nft-transfer', label: 'NFT transfer' },
  { value: 'token-association', label: 'Token association' },
  { value: 'contract-call', label: 'Contract call' },
];

export default function CreatePage() {
  const wallet = useWallet();
  const toast = useToast();
  const connection = useCoordinatorConnection();
  const injection = useTransactionInjection(connection.wsRef);
  const { register } = useTheme();
  const isConsole = register === 'console';

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
  // HIP-423 schedule options. Off by default — real-time signing is
  // the project's primary path; scheduled is a secondary affordance
  // for cross-timezone treasury work where signers can't coordinate
  // live. The component itself is collapsed-by-default so the form
  // doesn't add visual weight when scheduled isn't in play.
  const [scheduleOptions, setScheduleOptions] = useState<ScheduleOptionsValue>(SCHEDULE_OPTIONS_DEFAULT);
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

  // Note: the package-wide DEFAULT_SUBSET_SIZE is now 1 (see
  // `shared/node-selection.js` for the wallet-compatibility rationale),
  // so contract calls land on single-node freeze automatically without
  // a special-case override here. CLI-only coordinators who want
  // multi-node resilience bump it via the strategy picker below.

  const handleTransactionReset = useCallback(() => {
    // Server confirmed TRANSACTION_RESET. Clear the form fields the previous
    // transaction left behind, drop the stale balance display (the prior
    // account isn't selected anymore — and even if the user re-types the
    // same account, the balance has changed since fees were charged), and
    // route back to the build step. The SessionMonitor's own state already
    // reset itself on the same broadcast.
    setTxFields({});
    setFromBalance(null);
    setBalanceError(null);
    setIsLoadingBalance(false);
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
      // When scheduled is on, the injection hook builds the inner tx
      // unfrozen, wraps it in a ScheduleCreateTransaction, has the
      // wallet sign+submit it directly to the network, then announces
      // the resulting scheduleId to the WS session via SCHEDULE_ANNOUNCE.
      // The result is the same outward shape — `setStep('share')` works
      // for both real-time and scheduled flows.
      const scheduled = scheduleOptions.enabled
        ? {
            expirationInput: scheduleOptions.expirationInput,
            scheduleMemo: scheduleOptions.scheduleMemo || undefined,
            payerAccountId: scheduleOptions.payerAccountId || undefined,
            adminKey: scheduleOptions.adminKey || undefined,
          }
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
        scheduled,
      });
      setStep('share');
      toast.success(
        scheduleOptions.enabled ? 'Schedule Created' : 'Transaction Injected',
        scheduleOptions.enabled
          ? 'Schedule submitted to the network. Participants will sign at their convenience.'
          : 'Transaction has been broadcast to participants.',
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      toast.error(scheduleOptions.enabled ? 'Schedule Failed' : 'Injection Failed', message);
    }
  }, [txType, txFields, wallet.accountId, sessionId, injection, toast, nodeStrategy, scheduleOptions]);

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
    <main className="min-h-screen bg-background">
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />

      <section className="max-w-2xl mx-auto px-6 py-8 sm:py-12">
        {/* Header — matches /join post-redesign: bigger H1, sentence
            case, treasury-only sub-line. Console mode hides the
            sub-line; the page-hero $ prefix carries the orientation. */}
        <header className="mb-8">
          <h1 className="page-hero font-heading text-4xl sm:text-5xl font-bold tracking-tight text-foreground leading-[1.05]">
            Create a signing session
          </h1>
          <p className="console-hide mt-3 text-foreground-muted leading-relaxed max-w-md">
            Spin up a coordinator session, build the transaction, and share
            the connection string with your signers.
          </p>
        </header>

        {/* Connection-string chip — quiet header pill once a session
            exists. Surfaces the share affordance throughout build-tx
            (Pre-Session Workflow needs participants to connect BEFORE
            the coordinator builds the transaction; the share step
            comes after, which was a real UX gap). Hidden on the
            connect step (no session yet) and on share (which has
            its own full sharing UI). */}
        {step === 'build-tx' && connection.sessionCredentials && shareConnectionString && (
          <div className="flex items-center gap-3 mb-6 text-xs">
            <span className="font-medium uppercase tracking-wider text-foreground-subtle flex-shrink-0">
              <span className="treasury-label">Share</span>
              <span className="console-label">share</span>
            </span>
            <code className="font-mono text-foreground-muted truncate flex-1 min-w-0">
              {shareConnectionString.length > 48
                ? `${shareConnectionString.slice(0, 32)}…${shareConnectionString.slice(-12)}`
                : shareConnectionString}
            </code>
            <CopyButton text={shareConnectionString} label="connection string" size="sm" />
          </div>
        )}

        <div className="space-y-8">
          {/* StepProgress — hide on share. Once the coordinator's at
              the share step the wizard is over (the breadcrumb
              showing "01 ✓ · 02 ✓ · 03 Share" is just chrome). */}
          {step !== 'share' && (
            <StepProgress steps={createSteps} currentIndex={currentStepIndex} />
          )}

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

          {/* Live session monitor — flat section, no card chrome. The
              monitor is informational ("who's connected, what's the
              state"); a bordered container around it added visual
              weight without aiding focus. Eyebrow heading instead of
              card title; border-t separator marks the section
              transition. */}
          {(step === 'build-tx' || step === 'share') &&
            connection.sessionCredentials &&
            connection.ws && (
              <section
                aria-label="Live session"
                className="border-t border-border pt-6"
              >
                <h2 className="text-xs uppercase tracking-wider font-medium text-foreground-muted mb-3">
                  <span className="treasury-label">Live session</span>
                  <span className="console-label">live</span>
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
              {/* Session info — flat inline dl. Hairline divider marks
                  the section break without card chrome. Status now
                  uses a semantic dot + text instead of a hardcoded
                  warning-yellow pill (status carries varied meaning;
                  the previous always-yellow pill was decorative). */}
              <div className="border-t border-border pt-6">
                <h2 className="text-xs uppercase tracking-wider font-medium text-foreground-muted mb-3">
                  <span className="treasury-label">Session</span>
                  <span className="console-label">session</span>
                </h2>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
                  <dt className="text-foreground-subtle">
                    <span className="treasury-label">ID</span>
                    <span className="console-label">session_id</span>
                  </dt>
                  <dd className="font-mono text-foreground truncate">
                    {connection.sessionCredentials.sessionId}
                  </dd>
                  <dt className="text-foreground-subtle">
                    <span className="treasury-label">Status</span>
                    <span className="console-label">status</span>
                  </dt>
                  <dd>
                    <SessionStatusIndicator status={connection.sessionCredentials.status} />
                  </dd>
                  <dt className="text-foreground-subtle">
                    <span className="treasury-label">Threshold</span>
                    <span className="console-label">threshold</span>
                  </dt>
                  <dd className="text-foreground tabular-nums">
                    {connection.sessionCredentials.threshold} of{' '}
                    {connection.sessionCredentials.eligibleKeys.length}
                  </dd>
                  <dt className="text-foreground-subtle">
                    <span className="treasury-label">Expires</span>
                    <span className="console-label">expires_at</span>
                  </dt>
                  <dd className="text-foreground">
                    <ExpiresValue expiresAt={connection.sessionCredentials.expiresAt} />
                  </dd>
                </dl>
              </div>

              {/* Wallet status — informational, not a hard block. The
                  fee payer is whatever account ends up in From /
                  Account; the wallet is just a fallback. The detailed
                  prose is treasury-only (console operators know multi-
                  sig fee mechanics); console hides it via console-hide. */}
              {!wallet.isConnected && (
                <div
                  role="status"
                  className="console-hide border-l-2 border-info bg-info-soft/30 pl-4 py-3 text-sm text-info-soft-fg rounded-r-md"
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

              {/* Transaction builder. Card chrome was redundant once
                  the rest of the page flattened — single bordered
                  surface on a flat page reads as "the special
                  section" but every section is special on a
                  coordinator's build-tx page. The console-pane class
                  is kept so console mode still gets the terminal-
                  window header strip ("~/INJECT.TX") via globals.css;
                  treasury sees a flat section with border-t separator
                  matching Live Session and Session info above. */}
              <div
                className="console-pane border-t border-border pt-6"
                data-pane-label="~/inject.tx"
              >
                <h2 className="text-xs uppercase tracking-wider font-medium text-foreground-muted mb-4">
                  <span className="treasury-label">Inject transaction</span>
                  <span className="console-label">inject_tx</span>
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
                    Paste frozen transaction
                  </TabButton>
                </div>

                {txMode === 'build' && (
                  <div role="tabpanel" id="build-panel" aria-labelledby="build-tab">
                    <div className="mb-6">
                      <div
                        id="tx-type-label"
                        className="text-sm font-medium text-foreground mb-3"
                      >
                        Transaction type
                      </div>
                      <TxTypeTablist
                        value={txType}
                        onChange={(t) => {
                          setTxType(t);
                          setTxFields({});
                        }}
                      />
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

                    {/* Power-user options: FreezeStrategy + ScheduleOptions.
                        Both already render as collapsed-by-default
                        single-line summaries internally, but they
                        still take vertical real-estate that most
                        treasury operators don't need. So:
                          - Treasury → wrap in an "Advanced" details
                            disclosure (one click to reveal the two
                            summary rows underneath).
                          - Console → render inline, always visible
                            (the dev audience wants the levers up
                            front; one less click).
                        FeePayerCallout above stays always-visible in
                        both modes — it's a status surface (warns
                        about coverage problems), not an option panel. */}
                    {isConsole ? (
                      <div className="mt-5 space-y-4">
                        <FreezeStrategy
                          txType={txType}
                          signerCount={connection.sessionCredentials?.threshold ?? 1}
                          value={nodeStrategy}
                          onChange={setNodeStrategy}
                        />
                        <ScheduleOptions
                          value={scheduleOptions}
                          onChange={setScheduleOptions}
                        />
                      </div>
                    ) : (
                      <details className="mt-5 group">
                        <summary className="cursor-pointer inline-flex items-center gap-1.5 text-sm font-medium text-foreground-muted hover:text-foreground transition-colors">
                          <span>Advanced — node freeze, scheduling</span>
                          <span className="opacity-60 group-open:rotate-180 inline-block transition-transform" aria-hidden="true">▾</span>
                        </summary>
                        <div className="mt-4 space-y-4">
                          <FreezeStrategy
                            txType={txType}
                            signerCount={connection.sessionCredentials?.threshold ?? 1}
                            value={nodeStrategy}
                            onChange={setNodeStrategy}
                          />
                          <ScheduleOptions
                            value={scheduleOptions}
                            onChange={setScheduleOptions}
                          />
                        </div>
                      </details>
                    )}

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
                      {getInjectButtonLabel(injection.isInjecting, scheduleOptions.enabled)}
                      {!injection.isInjecting && (
                        <span className="treasury-label opacity-70">→</span>
                      )}
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
                      {!injection.isInjecting && (
                        <span className="treasury-label opacity-70">→</span>
                      )}
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
                // Reset scheduleOptions so re-issuing after a
                // schedule expired or executed doesn't carry the
                // previous toggle ON state implicitly. The
                // coordinator can re-toggle if they want another
                // scheduled tx — explicit beats sticky for an
                // affordance with cost implications (creating a
                // schedule pays a small fee).
                setScheduleOptions(SCHEDULE_OPTIONS_DEFAULT);
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
      </section>

      <Footer variant="compact" />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components and helpers
// ---------------------------------------------------------------------------

/**
 * SessionStatusIndicator — small dot + status text. Replaces the
 * always-warning-yellow pill that previously colored every session
 * status the same regardless of meaning. Color now carries semantic
 * weight: pending/idle states are neutral; in-flight is info; failure
 * states are destructive.
 */
function SessionStatusIndicator({ status }: { status: string }) {
  const s = status.toLowerCase();
  const dot =
    s === 'completed' || s === 'executed' ? 'bg-success' :
    s === 'failed' || s === 'expired' || s === 'rejected' ? 'bg-destructive' :
    s === 'signing' || s === 'executing' || s === 'reviewing' ? 'bg-warning' :
    s === 'waiting' || s === 'ready' ? 'bg-info' :
    'bg-foreground-subtle';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden="true" />
      <span className="font-mono text-xs text-foreground">{status}</span>
    </span>
  );
}

/**
 * TxTypeTablist — chip-row tablist for transaction type. Five
 * sentence-case pills with full WAI-ARIA tablist semantics: only the
 * selected chip is tabIndex={0}, arrow keys cycle between, Home/End
 * jump to first/last. Matches the keyboard convention used by the
 * Build/Paste tablist directly above it.
 */
function TxTypeTablist({
  value,
  onChange,
}: {
  value: TransactionType;
  onChange: (t: TransactionType) => void;
}) {
  // Each chip needs a focusable element so arrow-key navigation
  // can move focus, not just selection. Tracking refs by index.
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % TX_TYPES.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TX_TYPES.length) % TX_TYPES.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TX_TYPES.length - 1;
    else return;
    e.preventDefault();
    onChange(TX_TYPES[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-labelledby="tx-type-label"
      className="flex flex-wrap gap-2"
    >
      {TX_TYPES.map((t, i) => {
        const isSelected = value === t.value;
        return (
          <button
            key={t.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={isSelected}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={
              isSelected
                ? 'px-3 py-1.5 rounded-md text-sm font-medium bg-accent text-accent-fg transition-colors'
                : 'px-3 py-1.5 rounded-md text-sm font-medium text-foreground-muted border border-border hover:text-foreground hover:bg-surface-recessed transition-colors'
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * ExpiresValue — renders the session expiry as a relative duration
 * (e.g. "in ~30m") with the absolute timestamp as a tooltip. Replaces
 * the previous raw ISO timestamp display ("2026-05-10T14:32:00.000Z"),
 * which a coordinator had to mentally convert to "is that 5 minutes
 * or 5 hours from now?" before reading.
 */
function ExpiresValue({ expiresAt }: { expiresAt: string | null | undefined }) {
  if (!expiresAt) return <span className="text-foreground-subtle">—</span>;
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) {
    return <span className="font-mono text-xs">{expiresAt}</span>;
  }
  const isPast = ms < Date.now();
  const relative = isPast ? 'expired' : formatRelativeFuture(ms);
  return (
    <span title={expiresAt} className="font-mono text-xs">
      {relative}
    </span>
  );
}

/**
 * Inject-button copy. Four-way matrix: (loading × scheduled). Lifted
 * out of the JSX so the four labels are visible at a glance instead
 * of buried in nested ternaries.
 */
function getInjectButtonLabel(isInjecting: boolean, scheduledEnabled: boolean): string {
  if (isInjecting) {
    return scheduledEnabled
      ? 'Submitting schedule to network…'
      : 'Building & injecting…';
  }
  return scheduledEnabled
    ? 'Build & schedule transaction'
    : 'Build & inject transaction';
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
