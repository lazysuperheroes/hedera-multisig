/**
 * Session Page
 *
 * Main page for participating in a multi-signature signing session.
 * Orchestrates WebSocket connection, wallet connection, transaction review, and signing.
 *
 * State Flow:
 * 1. Load session info from localStorage
 * 2. Connect wallet via WalletConnect
 * 3. Connect to WebSocket server
 * 4. Send PARTICIPANT_READY with public key
 * 5. Wait for TRANSACTION_RECEIVED
 * 6. Display transaction for review
 * 7. On approval, sign with WalletConnect
 * 8. Submit signature via WebSocket
 * 9. Wait for threshold/execution
 * 10. Display completion
 */

'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSigningSession } from '../../../hooks/useSigningSession';
import { useWalletConnect } from '../../../hooks/useWalletConnect';
import { useToast } from '../../../hooks/useToast';
import { useSessionRecovery } from '../../../hooks/useSessionRecovery';
import { WalletStatus } from '../../../components/WalletStatus';
import { TransactionReview } from '../../../components/TransactionReview';
import { SignatureProgress } from '../../../components/SignatureProgress';
import { ToastContainer } from '../../../components/Toast';

interface SessionInfo {
  serverUrl: string;
  sessionId: string;
  pin: string;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function SessionPage({ params }: PageProps) {
  const router = useRouter();
  const resolvedParams = use(params);
  const sessionId = resolvedParams.id;

  // Local state
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [currentStep, setCurrentStep] = useState<
    | 'loading'
    | 'wallet-connect'
    | 'session-connect'
    | 'ready'
    | 'waiting'
    | 'reviewing'
    | 'signing'
    | 'signed'
    | 'completed'
    | 'error'
  >('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Hooks
  const walletConnect = useWalletConnect({ network: 'testnet', autoConnect: false });
  const signingSession = useSigningSession({ verbose: true, label: 'Web (WalletConnect)' });
  const toast = useToast();
  const sessionRecovery = useSessionRecovery();

  // Load session info from localStorage (with recovery support)
  useEffect(() => {
    // Wait for storage check to complete
    if (!sessionRecovery.hasCheckedStorage) {
      return;
    }

    // Check if we have a saved session
    if (sessionRecovery.savedSession) {
      // Verify session ID matches
      if (sessionRecovery.savedSession.sessionId !== sessionId) {
        setErrorMessage('Session ID mismatch. Clearing saved session.');
        sessionRecovery.clearSession();
        setCurrentStep('error');
        return;
      }

      // Session found - restore it
      setSessionInfo({
        serverUrl: sessionRecovery.savedSession.serverUrl,
        sessionId: sessionRecovery.savedSession.sessionId,
        pin: sessionRecovery.savedSession.pin,
      });

      // Check if session is still fresh
      if (sessionRecovery.isSessionFresh()) {
        toast.info('Session Resumed', 'Resuming your previous session');
        setCurrentStep('wallet-connect');
      } else {
        toast.warning('Session Expired', 'Your session has expired. Please rejoin.');
        sessionRecovery.clearSession();
        setCurrentStep('error');
      }
    } else {
      // No saved session - check for legacy localStorage
      const stored = localStorage.getItem('hedera-multisig-session-info');
      if (!stored) {
        setErrorMessage('No session information found. Please join a session first.');
        setCurrentStep('error');
        return;
      }

      try {
        const parsed = JSON.parse(stored);
        if (parsed.sessionId !== sessionId) {
          setErrorMessage('Session ID mismatch. Please join the correct session.');
          setCurrentStep('error');
          return;
        }

        setSessionInfo(parsed);

        // Migrate to new session recovery system
        sessionRecovery.saveSession({
          serverUrl: parsed.serverUrl,
          sessionId: parsed.sessionId,
          pin: parsed.pin,
        });

        setCurrentStep('wallet-connect');
      } catch (error) {
        setErrorMessage('Invalid session information.');
        setCurrentStep('error');
      }
    }
  }, [sessionId, sessionRecovery.hasCheckedStorage, sessionRecovery.savedSession]);

  // Auto-update step based on session state
  useEffect(() => {
    if (signingSession.state.status === 'connected' && currentStep === 'session-connect') {
      setCurrentStep('ready');
    } else if (signingSession.state.status === 'ready' && currentStep === 'ready') {
      setCurrentStep('waiting');
    } else if (signingSession.state.status === 'reviewing' && currentStep === 'waiting') {
      setCurrentStep('reviewing');
      toast.info('Transaction Received', 'Please review the transaction details');
    } else if (signingSession.state.status === 'signed' && currentStep === 'signing') {
      setCurrentStep('signed');
    } else if (signingSession.state.status === 'completed') {
      setCurrentStep('completed');
      toast.success('Transaction Complete!', 'The multi-signature transaction was executed successfully');

      // Reset to waiting for next transaction (support multi-transaction sessions)
      setTimeout(() => {
        setCurrentStep('waiting');
        toast.info('Ready for Next Transaction', 'Session remains open. Waiting for coordinator...');
      }, 3000); // Show success for 3 seconds, then reset to waiting
    }
  }, [signingSession.state.status, currentStep, toast, sessionRecovery]);

  // Cleanup: Clear session on unmount (navigating away)
  useEffect(() => {
    return () => {
      // Only clear if not completed (if completed, already cleared above)
      if (currentStep !== 'completed' && currentStep !== 'error') {
        // Keep session for recovery if user accidentally navigates away
        console.log('Component unmounting - session saved for recovery');
      }
    };
  }, [currentStep]);

  // Handle wallet connection
  const handleConnectWallet = async () => {
    try {
      setErrorMessage(null);
      const walletInfo = await walletConnect.connect();

      console.log('Wallet connected:', walletInfo);
      toast.success('Wallet Connected', `Connected to ${walletInfo.accountId}`);

      // Save wallet info to session recovery
      if (sessionInfo) {
        sessionRecovery.updateSession({
          accountId: walletInfo.accountId,
          publicKey: walletInfo.publicKey,
        });
      }

      setCurrentStep('session-connect');

      // Auto-connect to session after wallet connection
      if (sessionInfo) {
        await handleConnectSession(walletInfo.publicKey);
      }
    } catch (error) {
      console.error('Wallet connection failed:', error);
      const errorMsg = (error as Error).message;
      setErrorMessage(errorMsg);
      toast.error('Connection Failed', errorMsg);
    }
  };

  // Handle session connection
  const handleConnectSession = async (publicKey: string) => {
    if (!sessionInfo) {
      setErrorMessage('No session information available');
      return;
    }

    try {
      setErrorMessage(null);
      toast.info('Connecting to Session', 'Authenticating with server...');

      // Connect to WebSocket (with public key for early validation)
      const result = await signingSession.connect(
        sessionInfo.serverUrl,
        sessionInfo.sessionId,
        sessionInfo.pin,
        publicKey
      );

      console.log('Session connected, sending PARTICIPANT_READY...');
      toast.success('Session Joined', 'You are now ready to sign transactions');

      // Save participant ID to session recovery
      sessionRecovery.updateSession({
        participantId: result.participantId,
      });

      // Send PARTICIPANT_READY
      signingSession.setReady(publicKey);
    } catch (error) {
      console.error('Session connection failed:', error);
      const errorMsg = (error as Error).message;
      setErrorMessage(errorMsg);
      toast.error('Session Connection Failed', errorMsg);
      setCurrentStep('wallet-connect');
    }
  };

  // Handle transaction approval
  const handleApprove = async () => {
    if (!signingSession.state.transaction.frozenTransaction) {
      setErrorMessage('No transaction to sign');
      return;
    }

    try {
      setCurrentStep('signing');
      setErrorMessage(null);
      toast.info('Signing Transaction', 'Please approve in your wallet app');

      console.log('Signing transaction with WalletConnect...');

      // Sign transaction with WalletConnect
      const signatureResult = await walletConnect.signTransaction(
        signingSession.state.transaction.frozenTransaction.base64
      );

      console.log('Transaction signed, submitting signature...');
      toast.success('Signature Created', 'Submitting to coordinator...');

      // Submit signature
      signingSession.submitSignature(signatureResult.publicKey, signatureResult.signature);

      console.log('Signature submitted successfully');
      toast.success('Signature Submitted', 'Waiting for other participants');
    } catch (error) {
      console.error('Signing failed:', error);
      const errorMsg = (error as Error).message;
      setErrorMessage(errorMsg);
      toast.error('Signing Failed', errorMsg);
      setCurrentStep('reviewing');
    }
  };

  // Handle transaction rejection
  const handleReject = (reason: string) => {
    console.log('Transaction rejected:', reason);
    signingSession.rejectTransaction(reason);
    toast.warning('Transaction Rejected', reason || 'You rejected the transaction');
    setCurrentStep('waiting');
  };

  // Handle disconnect
  const handleDisconnect = () => {
    signingSession.disconnect();
    walletConnect.disconnect();
    router.push('/');
  };

  // Render error state
  if (currentStep === 'error') {
    return (
      <main className="min-h-screen flex items-center justify-center p-8 bg-gray-50">
        <div className="max-w-lg w-full bg-white border-2 border-red-500 rounded-lg p-8">
          <div className="text-center mb-6">
            <div className="text-6xl mb-4">❌</div>
            <h1 className="text-2xl font-bold text-red-800 mb-2">Error</h1>
            <p className="text-red-600">{errorMessage}</p>
          </div>
          <button
            onClick={() => router.push('/join')}
            className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Back to Join Session
          </button>
        </div>
      </main>
    );
  }

  // Render loading state
  if (currentStep === 'loading') {
    return (
      <main className="min-h-screen flex items-center justify-center p-8 bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading session information...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8 bg-gray-50">
      {/* Toast Notifications */}
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white border-2 border-gray-300 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Multi-Signature Session</h1>
              <p className="text-sm text-gray-600 mt-1">Session ID: {sessionId}</p>
            </div>
            <button
              onClick={handleDisconnect}
              className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            >
              Disconnect
            </button>
          </div>

          {/* Step Indicator */}
          <div className="mt-6">
            <div className="flex items-center space-x-2">
              <StepIndicator
                step={1}
                label="Connect Wallet"
                active={currentStep === 'wallet-connect'}
                completed={
                  currentStep === 'session-connect' ||
                  currentStep === 'ready' ||
                  currentStep === 'waiting' ||
                  currentStep === 'reviewing' ||
                  currentStep === 'signing' ||
                  currentStep === 'signed' ||
                  currentStep === 'completed'
                }
              />
              <div className="flex-1 h-1 bg-gray-200">
                <div
                  className={`h-full ${
                    currentStep === 'session-connect' ||
                    currentStep === 'ready' ||
                    currentStep === 'waiting' ||
                    currentStep === 'reviewing' ||
                    currentStep === 'signing' ||
                    currentStep === 'signed' ||
                    currentStep === 'completed'
                      ? 'bg-green-500'
                      : 'bg-gray-200'
                  }`}
                />
              </div>
              <StepIndicator
                step={2}
                label="Join Session"
                active={currentStep === 'session-connect' || currentStep === 'ready'}
                completed={currentStep === 'waiting' || currentStep === 'reviewing' || currentStep === 'signing' || currentStep === 'signed' || currentStep === 'completed'}
              />
              <div className="flex-1 h-1 bg-gray-200">
                <div
                  className={`h-full ${
                    currentStep === 'reviewing' || currentStep === 'signing' || currentStep === 'signed' || currentStep === 'completed'
                      ? 'bg-green-500'
                      : 'bg-gray-200'
                  }`}
                />
              </div>
              <StepIndicator
                step={3}
                label="Review & Sign"
                active={currentStep === 'reviewing' || currentStep === 'signing'}
                completed={currentStep === 'signed' || currentStep === 'completed'}
              />
              <div className="flex-1 h-1 bg-gray-200">
                <div className={`h-full ${currentStep === 'completed' ? 'bg-green-500' : 'bg-gray-200'}`} />
              </div>
              <StepIndicator step={4} label="Complete" active={currentStep === 'completed'} completed={false} />
            </div>
          </div>
        </div>

        {/* Error Display */}
        {errorMessage && (
          <div className="bg-red-50 border-2 border-red-500 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <svg className="w-6 h-6 text-red-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <h3 className="font-semibold text-red-800">Error</h3>
                <p className="text-sm text-red-600">{errorMessage}</p>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Connect Wallet */}
        {currentStep === 'wallet-connect' && (
          <WalletStatus
            connected={walletConnect.state.connected}
            connecting={walletConnect.state.connecting}
            wallet={walletConnect.state.wallet}
            error={walletConnect.state.error}
            onConnect={handleConnectWallet}
            onDisconnect={() => walletConnect.disconnect()}
          />
        )}

        {/* Step 2+: Session Connection (shows wallet status + session status) */}
        {(currentStep === 'session-connect' || currentStep === 'ready' || currentStep === 'waiting' || currentStep === 'reviewing' || currentStep === 'signing' || currentStep === 'signed' || currentStep === 'completed') && (
          <>
            <WalletStatus
              connected={walletConnect.state.connected}
              connecting={walletConnect.state.connecting}
              wallet={walletConnect.state.wallet}
              error={walletConnect.state.error}
              onConnect={handleConnectWallet}
              onDisconnect={() => walletConnect.disconnect()}
            />

            {/* Session Status */}
            <div className="bg-white border-2 border-gray-300 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Session Status</h3>
              <div className="space-y-3">
                <StatusItem
                  label="WebSocket Connection"
                  status={signingSession.state.connected ? 'connected' : 'disconnected'}
                />
                <StatusItem
                  label="Participant Status"
                  status={signingSession.state.status === 'ready' || signingSession.state.status === 'waiting' ? 'ready' : signingSession.state.status}
                />
                {signingSession.state.sessionInfo && (
                  <>
                    <StatusItem label="Session Status" status={signingSession.state.sessionInfo.status} />
                    <StatusItem label="Threshold" status={`${signingSession.state.sessionInfo.threshold} signatures required`} />
                  </>
                )}
              </div>
            </div>

            {/* Signature Progress */}
            {(currentStep === 'waiting' || currentStep === 'reviewing' || currentStep === 'signing' || currentStep === 'signed' || currentStep === 'completed') && (
              <SignatureProgress
                signaturesCollected={signingSession.state.stats.signaturesCollected}
                signaturesRequired={signingSession.state.stats.signaturesRequired}
                participantsConnected={signingSession.state.stats.participantsConnected}
                participantsReady={signingSession.state.stats.participantsReady}
                thresholdMet={currentStep === 'completed'}
              />
            )}
          </>
        )}

        {/* Step 3: Transaction Review */}
        {currentStep === 'reviewing' && signingSession.state.transaction.frozenTransaction && (
          <TransactionReview
            frozenTransactionBase64={signingSession.state.transaction.frozenTransaction.base64}
            metadata={signingSession.state.transaction.metadata || undefined}
            contractInterface={signingSession.state.transaction.contractInterface}
            onApprove={handleApprove}
            onReject={handleReject}
            disabled={false}
          />
        )}

        {/* Step 3a: Signing in progress */}
        {currentStep === 'signing' && (
          <div className="bg-blue-50 border-2 border-blue-500 rounded-lg p-8 text-center">
            <div className="animate-pulse mb-4">
              <svg className="w-16 h-16 text-blue-600 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-blue-800 mb-2">Signing Transaction...</h2>
            <p className="text-blue-700">Please approve the signature request in your wallet</p>
          </div>
        )}

        {/* Step 3b: Signed, waiting for threshold */}
        {currentStep === 'signed' && (
          <div className="bg-green-50 border-2 border-green-500 rounded-lg p-8 text-center">
            <div className="mb-4">
              <svg className="w-16 h-16 text-green-600 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-green-800 mb-2">Signature Submitted!</h2>
            <p className="text-green-700">Waiting for other participants to sign...</p>
          </div>
        )}

        {/* Step 4: Completed */}
        {currentStep === 'completed' && (
          <div className="bg-green-50 border-2 border-green-600 rounded-lg p-8 text-center">
            <div className="mb-4">
              <svg className="w-20 h-20 text-green-600 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-green-800 mb-2">Transaction Executed!</h2>
            <p className="text-green-700 mb-6">
              The multi-signature transaction has been successfully executed on the Hedera network.
            </p>

            <div className="space-y-3">
              <button
                onClick={() => router.push('/')}
                className="w-full px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700"
              >
                Return to Home
              </button>
              <button
                onClick={() => router.push('/join')}
                className="w-full px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Join Another Session
              </button>
            </div>
          </div>
        )}

        {/* Waiting state */}
        {currentStep === 'waiting' && (
          <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-8 text-center">
            <div className="animate-pulse mb-4">
              <svg className="w-16 h-16 text-blue-600 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-blue-800 mb-2">Waiting for Transaction...</h2>
            <p className="text-blue-700 mb-6">The coordinator will send the transaction for review shortly</p>

            <button
              onClick={handleDisconnect}
              className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Leave Session
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

// Helper Components

function StepIndicator({
  step,
  label,
  active,
  completed,
}: {
  step: number;
  label: string;
  active: boolean;
  completed: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
          completed
            ? 'bg-green-500 text-white'
            : active
            ? 'bg-blue-500 text-white'
            : 'bg-gray-200 text-gray-500'
        }`}
      >
        {completed ? '✓' : step}
      </div>
      <div className={`text-xs mt-1 ${active ? 'text-blue-600 font-semibold' : 'text-gray-500'}`}>{label}</div>
    </div>
  );
}

function StatusItem({ label, status }: { label: string; status: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-200">
      <span className="text-sm text-gray-600">{label}:</span>
      <span className="text-sm font-mono font-semibold text-gray-800">{status}</span>
    </div>
  );
}
