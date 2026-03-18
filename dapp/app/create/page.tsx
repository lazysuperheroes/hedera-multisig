'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useWallet } from '../../hooks/useWallet';
import { useToast } from '../../hooks/useToast';
import { ToastContainer } from '../../components/Toast';
import { CopyButton } from '../../components/CopyButton';
import { QRCodeDisplay } from '../../components/QRCodeDisplay';
import { DEFAULT_NETWORK } from '../../lib/walletconnect-config';

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

interface SessionCredentials {
  sessionId: string;
  pin: string;
  coordinatorToken: string;
  threshold: number;
  eligibleKeys: string[];
  status: string;
  expiresAt: string;
}

type Step = 'connect' | 'build-tx' | 'share';

const DEFAULT_SERVER_URL =
  process.env.NEXT_PUBLIC_MULTISIG_SERVER_URL || 'ws://localhost:3001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shared Tailwind classes for text inputs */
const inputClass =
  'w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg ' +
  'focus:ring-2 focus:ring-blue-500 focus:border-transparent ' +
  'bg-white dark:bg-gray-700 text-gray-900 dark:text-white ' +
  'placeholder:text-gray-400 dark:placeholder:text-gray-500';

const labelClass =
  'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2';

const cardClass = 'bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6';

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
  const wsRef = useRef<WebSocket | null>(null);

  // ---- step state ---------------------------------------------------------
  const [step, setStep] = useState<Step>('connect');

  // ---- Step 1: session connection -----------------------------------------
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [sessionId, setSessionId] = useState('');
  const [pin, setPin] = useState('');
  const [coordinatorToken, setCoordinatorToken] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [sessionCredentials, setSessionCredentials] =
    useState<SessionCredentials | null>(null);

  // ---- Step 2: transaction builder ----------------------------------------
  const [txType, setTxType] = useState<TransactionType>('hbar-transfer');
  const [txFields, setTxFields] = useState<Record<string, string>>({});
  const [isInjecting, setIsInjecting] = useState(false);
  const [injectError, setInjectError] = useState<string | null>(null);

  // ---- Step 3: share panel ------------------------------------------------
  const [injectionDone, setInjectionDone] = useState(false);

  // ---- Cleanup on unmount -------------------------------------------------
  useEffect(() => {
    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, []);

  // =========================================================================
  // Step 1 -- Connect to existing session as coordinator
  // =========================================================================

  const handleConnect = useCallback(async () => {
    if (!serverUrl || !sessionId || !pin || !coordinatorToken) {
      setConnectError('All fields are required.');
      return;
    }

    setIsConnecting(true);
    setConnectError(null);

    try {
      const ws = new WebSocket(serverUrl);
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Connection timed out after 10 seconds.'));
        }, 10000);

        ws.onopen = () => {
          // Send AUTH as coordinator
          ws.send(
            JSON.stringify({
              type: 'AUTH',
              payload: {
                sessionId,
                pin,
                role: 'coordinator',
                coordinatorToken,
              },
            })
          );
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string);

            if (msg.type === 'AUTH_SUCCESS') {
              clearTimeout(timeout);
              const info = msg.payload?.sessionInfo;
              setSessionCredentials({
                sessionId: info?.sessionId || sessionId,
                pin,
                coordinatorToken,
                threshold: info?.threshold ?? 0,
                eligibleKeys: info?.eligiblePublicKeys ?? [],
                status: info?.status ?? 'unknown',
                expiresAt: info?.expiresAt
                  ? new Date(info.expiresAt).toLocaleString()
                  : '',
              });

              // If session already has a transaction, skip to share step
              if (
                info?.status === 'transaction-received' ||
                info?.status === 'signing'
              ) {
                setStep('share');
                setInjectionDone(true);
              } else {
                setStep('build-tx');
              }
              toast.success(
                'Connected',
                'Authenticated as coordinator successfully.'
              );
              resolve();
            } else if (msg.type === 'AUTH_FAILED') {
              clearTimeout(timeout);
              reject(
                new Error(
                  msg.payload?.message || 'Authentication failed.'
                )
              );
            } else if (msg.type === 'ERROR') {
              clearTimeout(timeout);
              reject(new Error(msg.payload?.message || 'Server error.'));
            }
          } catch {
            // ignore parse errors from non-JSON frames
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(
            new Error(
              'WebSocket connection failed. Is the server running?'
            )
          );
        };

        ws.onclose = (event) => {
          if (!event.wasClean) {
            clearTimeout(timeout);
            reject(
              new Error('Connection closed unexpectedly.')
            );
          }
        };
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown error.';
      setConnectError(message);
      toast.error('Connection Failed', message);
    } finally {
      setIsConnecting(false);
    }
  }, [serverUrl, sessionId, pin, coordinatorToken, toast]);

  // =========================================================================
  // Step 2 -- Build & inject transaction
  // =========================================================================

  const setTxField = useCallback(
    (key: string, value: string) =>
      setTxFields((prev) => ({ ...prev, [key]: value })),
    []
  );

  const handleInjectTransaction = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setInjectError('WebSocket is not connected.');
      return;
    }

    if (!wallet.isConnected || !wallet.accountId) {
      setInjectError(
        'Connect your wallet first. The operator account pays fees.'
      );
      return;
    }

    setIsInjecting(true);
    setInjectError(null);

    try {
      // Dynamically import Hedera SDK -- keeps initial bundle smaller and
      // avoids SSR issues with the SDK.
      const {
        Client,
        TransferTransaction,
        TokenAssociateTransaction,
        ContractExecuteTransaction,
        AccountId,
        Hbar,
        TransactionId,
        NftId,
        TokenId,
      } = await import('@hashgraph/sdk');

      // Create a lightweight client for freezing (no operator key needed for
      // freeze -- the key is only needed for execution which happens server-side).
      const network = DEFAULT_NETWORK;
      const client =
        network === 'mainnet'
          ? Client.forMainnet()
          : Client.forTestnet();

      const operatorId = AccountId.fromString(wallet.accountId);

      // Build the appropriate transaction
      let tx: InstanceType<typeof TransferTransaction> |
              InstanceType<typeof TokenAssociateTransaction> |
              InstanceType<typeof ContractExecuteTransaction>;

      switch (txType) {
        case 'hbar-transfer': {
          const from = txFields.from || wallet.accountId;
          const to = txFields.to;
          const amount = parseFloat(txFields.amount || '0');
          if (!to) throw new Error('Recipient account is required.');
          if (amount <= 0) throw new Error('Amount must be greater than 0.');
          tx = new TransferTransaction()
            .addHbarTransfer(AccountId.fromString(from), new Hbar(-amount))
            .addHbarTransfer(AccountId.fromString(to), new Hbar(amount));
          break;
        }

        case 'token-transfer': {
          const tokenId = txFields.tokenId;
          const from = txFields.from || wallet.accountId;
          const to = txFields.to;
          const amount = parseInt(txFields.amount || '0', 10);
          if (!tokenId) throw new Error('Token ID is required.');
          if (!to) throw new Error('Recipient account is required.');
          if (amount <= 0)
            throw new Error('Amount must be greater than 0.');
          tx = new TransferTransaction()
            .addTokenTransfer(
              TokenId.fromString(tokenId),
              AccountId.fromString(from),
              -amount
            )
            .addTokenTransfer(
              TokenId.fromString(tokenId),
              AccountId.fromString(to),
              amount
            );
          break;
        }

        case 'nft-transfer': {
          const tokenId = txFields.tokenId;
          const serial = parseInt(txFields.serial || '0', 10);
          const from = txFields.from || wallet.accountId;
          const to = txFields.to;
          if (!tokenId) throw new Error('Token ID is required.');
          if (!to) throw new Error('Recipient account is required.');
          if (serial <= 0) throw new Error('Serial number is required.');
          const nftId = new NftId(TokenId.fromString(tokenId), serial);
          tx = new TransferTransaction().addNftTransfer(
            nftId,
            AccountId.fromString(from),
            AccountId.fromString(to)
          );
          break;
        }

        case 'token-association': {
          const account = txFields.account || wallet.accountId;
          const tokenIds = (txFields.tokenIds || '')
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
          if (tokenIds.length === 0)
            throw new Error('At least one Token ID is required.');
          tx = new TokenAssociateTransaction()
            .setAccountId(AccountId.fromString(account))
            .setTokenIds(tokenIds.map((tid) => TokenId.fromString(tid)));
          break;
        }

        case 'contract-call': {
          const contractId = txFields.contractId;
          const gas = parseInt(txFields.gas || '100000', 10);
          const fnData = txFields.functionData || '';
          if (!contractId) throw new Error('Contract ID is required.');
          const contractTx = new ContractExecuteTransaction()
            .setContractId(contractId)
            .setGas(gas);
          if (fnData) {
            contractTx.setFunctionParameters(
              Buffer.from(fnData.replace(/^0x/, ''), 'hex')
            );
          }
          tx = contractTx;
          break;
        }

        default:
          throw new Error('Unknown transaction type.');
      }

      // Generate a transaction ID BEFORE freezing (multi-sig hash stability)
      tx.setTransactionId(TransactionId.generate(operatorId));

      // Freeze the transaction
      const frozenTx = await tx.freezeWith(client);
      const frozenBytes = frozenTx.toBytes();
      const frozenBase64 =
        typeof Buffer !== 'undefined'
          ? Buffer.from(frozenBytes).toString('base64')
          : btoa(String.fromCharCode(...frozenBytes));

      // Send TRANSACTION_INJECT via WebSocket
      await new Promise<void>((resolve, reject) => {
        const ws = wsRef.current!;
        const timeout = setTimeout(() => {
          reject(new Error('Transaction injection timed out.'));
        }, 15000);

        const handler = (event: MessageEvent) => {
          try {
            const msg = JSON.parse(event.data as string);
            if (msg.type === 'TRANSACTION_RECEIVED') {
              clearTimeout(timeout);
              ws.removeEventListener('message', handler);
              resolve();
            } else if (msg.type === 'INJECTION_FAILED' || msg.type === 'ERROR') {
              clearTimeout(timeout);
              ws.removeEventListener('message', handler);
              reject(
                new Error(msg.payload?.message || 'Injection failed.')
              );
            }
          } catch {
            // ignore
          }
        };

        ws.addEventListener('message', handler);

        ws.send(
          JSON.stringify({
            type: 'TRANSACTION_INJECT',
            payload: {
              frozenTransaction: frozenBase64,
            },
          })
        );
      });

      setInjectionDone(true);
      setStep('share');
      toast.success(
        'Transaction Injected',
        'Transaction has been broadcast to participants.'
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unknown error.';
      setInjectError(message);
      toast.error('Injection Failed', message);
    } finally {
      setIsInjecting(false);
    }
  }, [wallet, txType, txFields, toast]);

  // =========================================================================
  // Connection string for sharing
  // =========================================================================

  const connectionString =
    sessionCredentials
      ? generateConnectionString(
          serverUrl,
          sessionCredentials.sessionId,
          sessionCredentials.pin
        )
      : '';

  const shareableUrl =
    sessionCredentials && typeof window !== 'undefined'
      ? `${window.location.origin}/join?server=${encodeURIComponent(
          serverUrl
        )}&session=${encodeURIComponent(
          sessionCredentials.sessionId
        )}&pin=${encodeURIComponent(sessionCredentials.pin)}`
      : '';

  // =========================================================================
  // Render helpers
  // =========================================================================

  const renderStepIndicator = () => {
    const steps: { key: Step; label: string; num: number }[] = [
      { key: 'connect', label: 'Connect to Session', num: 1 },
      { key: 'build-tx', label: 'Build Transaction', num: 2 },
      { key: 'share', label: 'Share & Monitor', num: 3 },
    ];
    const stepOrder: Step[] = ['connect', 'build-tx', 'share'];
    const currentIndex = stepOrder.indexOf(step);

    return (
      <nav aria-label="Progress" className="mb-8">
        <ol className="flex items-center justify-center gap-2 sm:gap-4">
          {steps.map((s, i) => {
            const isActive = i === currentIndex;
            const isDone = i < currentIndex;
            return (
              <li key={s.key} className="flex items-center gap-2">
                <span
                  className={`
                    flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold
                    ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : isDone
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }
                  `}
                  aria-current={isActive ? 'step' : undefined}
                >
                  {isDone ? (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    s.num
                  )}
                </span>
                <span
                  className={`
                    hidden sm:inline text-sm font-medium
                    ${
                      isActive
                        ? 'text-blue-600 dark:text-blue-400'
                        : isDone
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-gray-400 dark:text-gray-500'
                    }
                  `}
                >
                  {s.label}
                </span>
                {i < steps.length - 1 && (
                  <svg
                    className="w-5 h-5 text-gray-300 dark:text-gray-600 ml-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    );
  };

  // ---- Transaction-type-specific fields -----------------------------------

  const renderTxFields = () => {
    switch (txType) {
      case 'hbar-transfer':
        return (
          <>
            <div>
              <label htmlFor="tx-from" className={labelClass}>
                From Account
              </label>
              <input
                id="tx-from"
                type="text"
                className={inputClass}
                placeholder={wallet.accountId || '0.0.xxxxx'}
                value={txFields.from || ''}
                onChange={(e) => setTxField('from', e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Defaults to connected wallet if left blank.
              </p>
            </div>
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
            <div>
              <label htmlFor="tx-from" className={labelClass}>
                From Account
              </label>
              <input
                id="tx-from"
                type="text"
                className={inputClass}
                placeholder={wallet.accountId || '0.0.xxxxx'}
                value={txFields.from || ''}
                onChange={(e) => setTxField('from', e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Defaults to connected wallet if left blank.
              </p>
            </div>
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
            <div>
              <label htmlFor="tx-from" className={labelClass}>
                From Account
              </label>
              <input
                id="tx-from"
                type="text"
                className={inputClass}
                placeholder={wallet.accountId || '0.0.xxxxx'}
                value={txFields.from || ''}
                onChange={(e) => setTxField('from', e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Defaults to connected wallet if left blank.
              </p>
            </div>
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
                placeholder={wallet.accountId || '0.0.xxxxx'}
                value={txFields.account || ''}
                onChange={(e) => setTxField('account', e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Defaults to connected wallet if left blank.
              </p>
            </div>
            <div>
              <label htmlFor="tx-tokenIds" className={labelClass}>
                Token IDs (comma-separated){' '}
                <span className="text-red-500">*</span>
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
                onChange={(e) =>
                  setTxField('functionData', e.target.value)
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                ABI-encoded function call data in hexadecimal.
              </p>
            </div>
          </>
        );
    }
  };

  // =========================================================================
  // Main render
  // =========================================================================

  return (
    <main className="min-h-screen flex flex-col items-center p-4 sm:p-8 bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950">
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />

      <div className="max-w-2xl w-full space-y-6 py-4">
        {/* Header */}
        <div className="text-center space-y-2">
          <Link
            href="/"
            className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
          >
            &larr; Back to Home
          </Link>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white">
            Coordinator Panel
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Connect to a signing session, build a transaction, and share with
            participants.
          </p>
        </div>

        {/* Step indicator */}
        {renderStepIndicator()}

        {/* ================================================================
            Step 1 -- Connect to session
            ================================================================ */}
        {step === 'connect' && (
          <section aria-label="Connect to session" className={cardClass}>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-6">
              Session Credentials
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Enter the credentials for a session that was created via the CLI
              server command. You will authenticate as the coordinator.
            </p>
            <div className="space-y-5">
              {/* Server URL */}
              <div>
                <label htmlFor="serverUrl" className={labelClass}>
                  WebSocket Server URL
                </label>
                <input
                  id="serverUrl"
                  type="text"
                  className={inputClass}
                  placeholder="ws://localhost:3001"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  required
                />
              </div>

              {/* Session ID */}
              <div>
                <label htmlFor="sessionId" className={labelClass}>
                  Session ID
                </label>
                <input
                  id="sessionId"
                  type="text"
                  className={inputClass + ' font-mono'}
                  placeholder="Paste session ID from server output"
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value.trim())}
                  required
                />
              </div>

              {/* PIN */}
              <div>
                <label htmlFor="pin" className={labelClass}>
                  Session PIN
                </label>
                <input
                  id="pin"
                  type="text"
                  className={inputClass + ' font-mono tracking-widest'}
                  placeholder="XXXXXXXX"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.trim())}
                  required
                />
              </div>

              {/* Coordinator Token */}
              <div>
                <label htmlFor="coordToken" className={labelClass}>
                  Coordinator Token
                </label>
                <input
                  id="coordToken"
                  type="password"
                  className={inputClass + ' font-mono'}
                  placeholder="Paste coordinator token"
                  value={coordinatorToken}
                  onChange={(e) =>
                    setCoordinatorToken(e.target.value.trim())
                  }
                  required
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  The coordinator token is separate from the participant PIN
                  and grants elevated privileges.
                </p>
              </div>

              {/* Error */}
              {connectError && (
                <div
                  role="alert"
                  className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300"
                >
                  {connectError}
                </div>
              )}

              {/* Connect button */}
              <button
                type="button"
                onClick={handleConnect}
                disabled={
                  isConnecting ||
                  !serverUrl ||
                  !sessionId ||
                  !pin ||
                  !coordinatorToken
                }
                className={primaryBtnClass}
              >
                {isConnecting && (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                )}
                {isConnecting ? 'Connecting...' : 'Connect as Coordinator'}
              </button>
            </div>
          </section>
        )}

        {/* ================================================================
            Step 2 -- Transaction Builder
            ================================================================ */}
        {step === 'build-tx' && sessionCredentials && (
          <section
            aria-label="Build transaction"
            className="space-y-6"
          >
            {/* Session info summary */}
            <div className={cardClass}>
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
                Session Info
              </h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-gray-500 dark:text-gray-400">
                  Session ID
                </dt>
                <dd className="font-mono text-gray-900 dark:text-white truncate">
                  {sessionCredentials.sessionId}
                </dd>

                <dt className="text-gray-500 dark:text-gray-400">
                  Status
                </dt>
                <dd>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300">
                    {sessionCredentials.status}
                  </span>
                </dd>

                <dt className="text-gray-500 dark:text-gray-400">
                  Threshold
                </dt>
                <dd className="text-gray-900 dark:text-white">
                  {sessionCredentials.threshold} of{' '}
                  {sessionCredentials.eligibleKeys.length}
                </dd>

                <dt className="text-gray-500 dark:text-gray-400">
                  Expires
                </dt>
                <dd className="text-gray-900 dark:text-white">
                  {sessionCredentials.expiresAt || 'N/A'}
                </dd>
              </dl>
            </div>

            {/* Wallet check */}
            {!wallet.isConnected && (
              <div
                role="alert"
                className="p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm text-yellow-800 dark:text-yellow-300 flex items-start gap-3"
              >
                <svg
                  className="w-5 h-5 flex-shrink-0 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <p className="font-semibold">Wallet not connected</p>
                  <p>
                    Connect your wallet using the button in the navigation bar.
                    The connected account will be used as the transaction
                    operator (fee payer).
                  </p>
                </div>
              </div>
            )}

            {/* Transaction builder card */}
            <div className={cardClass}>
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
                Build Transaction
              </h2>

              {/* Transaction type selector */}
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
                    setInjectError(null);
                  }}
                >
                  <option value="hbar-transfer">HBAR Transfer</option>
                  <option value="token-transfer">Token Transfer</option>
                  <option value="nft-transfer">NFT Transfer</option>
                  <option value="token-association">
                    Token Association
                  </option>
                  <option value="contract-call">Contract Call</option>
                </select>
              </div>

              {/* Dynamic fields */}
              <div className="space-y-5">{renderTxFields()}</div>

              {/* Inject error */}
              {injectError && (
                <div
                  role="alert"
                  className="mt-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300"
                >
                  {injectError}
                </div>
              )}

              {/* Inject button */}
              <button
                type="button"
                onClick={handleInjectTransaction}
                disabled={isInjecting || !wallet.isConnected}
                className={primaryBtnClass + ' mt-6'}
              >
                {isInjecting && (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                )}
                {isInjecting
                  ? 'Building & Injecting...'
                  : 'Build & Inject Transaction'}
              </button>
            </div>
          </section>
        )}

        {/* ================================================================
            Step 3 -- Share credentials & monitor
            ================================================================ */}
        {step === 'share' && sessionCredentials && (
          <section aria-label="Share session" className="space-y-6">
            {/* Success banner */}
            {injectionDone && (
              <div className="p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg flex items-start gap-3">
                <svg
                  className="w-6 h-6 text-green-600 dark:text-green-400 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <div>
                  <p className="font-semibold text-green-800 dark:text-green-200">
                    Transaction injected successfully
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    Share the credentials below so participants can join and
                    sign. Remember: participants have 120 seconds from now to
                    sign.
                  </p>
                </div>
              </div>
            )}

            {/* Credentials card */}
            <div className={cardClass}>
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
                Session Credentials
              </h2>

              <div className="space-y-4">
                {/* Session ID */}
                <div className="flex items-center justify-between gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 block">
                      Session ID
                    </span>
                    <span className="text-sm font-mono text-gray-900 dark:text-white break-all">
                      {sessionCredentials.sessionId}
                    </span>
                  </div>
                  <CopyButton
                    text={sessionCredentials.sessionId}
                    label="Session ID"
                    variant="button"
                    size="sm"
                  />
                </div>

                {/* PIN */}
                <div className="flex items-center justify-between gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-yellow-700 dark:text-yellow-400 block">
                      PIN (share with participants)
                    </span>
                    <span className="text-lg font-mono font-bold text-yellow-800 dark:text-yellow-200 tracking-widest">
                      {sessionCredentials.pin}
                    </span>
                  </div>
                  <CopyButton
                    text={sessionCredentials.pin}
                    label="PIN"
                    variant="button"
                    size="sm"
                  />
                </div>

                {/* Coordinator Token */}
                <div className="flex items-center justify-between gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-red-700 dark:text-red-400 block">
                      Coordinator Token (keep private)
                    </span>
                    <span className="text-sm font-mono text-red-800 dark:text-red-200 break-all">
                      {sessionCredentials.coordinatorToken}
                    </span>
                  </div>
                  <CopyButton
                    text={sessionCredentials.coordinatorToken}
                    label="Coordinator Token"
                    variant="button"
                    size="sm"
                  />
                </div>

                {/* Server URL */}
                <div className="flex items-center justify-between gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400 block">
                      Server URL
                    </span>
                    <span className="text-sm font-mono text-gray-900 dark:text-white break-all">
                      {serverUrl}
                    </span>
                  </div>
                  <CopyButton
                    text={serverUrl}
                    label="Server URL"
                    variant="button"
                    size="sm"
                  />
                </div>
              </div>
            </div>

            {/* QR Code */}
            {connectionString && (
              <div className={cardClass}>
                <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">
                  Share with Participants
                </h2>

                <div className="flex flex-col items-center gap-6">
                  <QRCodeDisplay
                    value={connectionString}
                    size={200}
                    description="Participants scan this QR code with the dApp to join"
                    showDownload
                    downloadFilename={`hedera-multisig-${sessionCredentials.sessionId.slice(
                      0,
                      8
                    )}`}
                  />

                  {/* Connection string */}
                  <div className="w-full bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Connection String
                      </span>
                      <CopyButton
                        text={connectionString}
                        label="Connection String"
                        variant="button"
                        size="sm"
                      />
                    </div>
                    <div className="font-mono text-xs text-gray-600 dark:text-gray-400 break-all bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-600">
                      {connectionString}
                    </div>
                  </div>

                  {/* Shareable URL */}
                  {shareableUrl && (
                    <div className="w-full bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Shareable Link
                        </span>
                        <CopyButton
                          text={shareableUrl}
                          label="Shareable Link"
                          variant="button"
                          size="sm"
                        />
                      </div>
                      <div className="font-mono text-xs text-gray-600 dark:text-gray-400 break-all bg-white dark:bg-gray-800 p-2 rounded border border-gray-200 dark:border-gray-600">
                        {shareableUrl}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                        This link auto-fills session details on the Join page.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Monitor link */}
            <div className={cardClass}>
              <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-3">
                Monitor Session
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Open the session page to watch participants join and monitor
                signature progress in real time.
              </p>
              <Link
                href={`/session/${sessionCredentials.sessionId}`}
                onClick={() => {
                  // Store session info so the session page can connect
                  localStorage.setItem(
                    'hedera-multisig-session-info',
                    JSON.stringify({
                      serverUrl,
                      sessionId: sessionCredentials.sessionId,
                      pin: sessionCredentials.pin,
                    })
                  );
                }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
                Open Session Monitor
              </Link>
            </div>
          </section>
        )}

        {/* Info box */}
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
          <h3 className="font-semibold text-blue-900 dark:text-blue-200 mb-2">
            How this works
          </h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800 dark:text-blue-300">
            <li>
              Start a server with{' '}
              <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded text-xs">
                npm run multisig-server
              </code>{' '}
              to create a session.
            </li>
            <li>
              Enter the session credentials displayed by the server on this page.
            </li>
            <li>
              Connect your wallet and build the transaction to inject.
            </li>
            <li>
              Share the QR code or connection string with participants.
            </li>
            <li>
              Participants have 120 seconds to sign after injection.
            </li>
          </ol>
        </div>
      </div>
    </main>
  );
}
