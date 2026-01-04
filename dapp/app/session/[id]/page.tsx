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

import { use, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSigningSession } from '../../../hooks/useSigningSession';
import { useWallet } from '../../../hooks/useWallet';
import { useToast } from '../../../hooks/useToast';
import { useSessionRecovery } from '../../../hooks/useSessionRecovery';
import { WalletStatus } from '../../../components/WalletStatus';
import { TransactionReview } from '../../../components/TransactionReview';
import { SignatureProgress } from '../../../components/SignatureProgress';
import { PostSigningStatus } from '../../../components/PostSigningStatus';
import { ToastContainer } from '../../../components/Toast';
import { CopyButton } from '../../../components/CopyButton';
import { SessionCountdown } from '../../../components/SessionCountdown';
import { ShareSessionDialog } from '../../../components/ShareSessionDialog';
import { ParticipantList } from '../../../components/ParticipantList';
import { DEFAULT_NETWORK } from '../../../lib/walletconnect-config';

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

  // Share dialog state
  const [showShareDialog, setShowShareDialog] = useState(false);

  // Signed transaction info (for post-signing status display)
  const [signedTransactionId, setSignedTransactionId] = useState<string | null>(null);
  const [signedTransactionDetails, setSignedTransactionDetails] = useState<{
    type: string;
    transfers?: Array<{ accountId: string; amount: string }>;
    tokenIds?: string[];
    contractId?: string;
    functionName?: string;
    memo?: string;
    maxTransactionFee?: string;
  } | null>(null);

  // Hooks
  const wallet = useWallet(); // Global wallet state (shared with NavBar)
  const signingSession = useSigningSession({ verbose: true, label: 'Web (WalletConnect)' });
  const toast = useToast();
  const sessionRecovery = useSessionRecovery();

  // Refs to prevent infinite reconnection loops
  const hasAutoConnectedRef = useRef(false);
  const connectionAttemptRef = useRef(0);
  const maxConnectionAttempts = 3;

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
        setErrorMessage(
          `You were previously connected to a different session (${sessionRecovery.savedSession.sessionId.substring(0, 8)}...). ` +
          `To join session ${sessionId.substring(0, 8)}..., please use the Join page with the correct details.`
        );
        // Don't clear the session - let user go back to join page
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
          setErrorMessage(
            `Session ID mismatch. You have saved session ${parsed.sessionId.substring(0, 8)}... ` +
            `but are trying to access ${sessionId.substring(0, 8)}.... Please join the correct session.`
          );
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

  // Auto-advance if wallet already connected via NavBar (Path A: Connect-first flow)
  useEffect(() => {
    // Guard: Only run once when conditions are met
    if (currentStep !== 'wallet-connect') return;
    if (!wallet.isConnected || !wallet.publicKey || !sessionInfo) return;

    // Prevent infinite reconnection loops
    if (hasAutoConnectedRef.current) {
      console.log('Skipping auto-connect - already attempted in this session');
      return;
    }

    // Check connection attempt limit
    if (connectionAttemptRef.current >= maxConnectionAttempts) {
      console.log('Max connection attempts reached, stopping auto-reconnect');
      setErrorMessage('Failed to connect after multiple attempts. Please try refreshing the page.');
      setCurrentStep('error');
      return;
    }

    hasAutoConnectedRef.current = true;
    connectionAttemptRef.current += 1;
    console.log(`Wallet already connected via NavBar, auto-advancing to session connection (attempt ${connectionAttemptRef.current})`);

    // Set step first to prevent re-triggering
    setCurrentStep('session-connect');

    // Show one-time notification
    setTimeout(() => {
      toast.info('Wallet Detected', `Using connected wallet: ${wallet.accountId}`);
    }, 100);

    // Auto-connect to session with the connected wallet's public key
    const publicKey = wallet.publicKey; // Capture the non-null value
    setTimeout(() => {
      handleConnectSession(publicKey!); // Safe because we checked above
    }, 200);
  }, [currentStep, wallet.isConnected, wallet.publicKey, sessionInfo?.sessionId]);

  // Auto-update step based on session state
  useEffect(() => {
    const sessionStatus = signingSession.state.status;
    const isConnectedToSession = signingSession.state.connected;

    // Handle StrictMode remount: if we're at wallet-connect but session is already connected
    // This can happen when useState resets currentStep but the WebSocket connection persists
    if (currentStep === 'wallet-connect' && isConnectedToSession) {
      console.log('State sync: Already connected to session, advancing UI step');
      if (sessionStatus === 'ready' || sessionStatus === 'waiting') {
        setCurrentStep('waiting');
      } else if (sessionStatus === 'connected') {
        setCurrentStep('ready');
      } else if (sessionStatus === 'reviewing') {
        setCurrentStep('reviewing');
      }
      return;
    }

    // Normal step transitions
    if (sessionStatus === 'connected' && currentStep === 'session-connect') {
      setCurrentStep('ready');
    } else if (sessionStatus === 'ready' && currentStep === 'ready') {
      setCurrentStep('waiting');
    } else if (sessionStatus === 'ready' && currentStep === 'session-connect') {
      // Fast path: already ready, skip 'ready' step
      setCurrentStep('waiting');
    } else if (sessionStatus === 'reviewing' && currentStep === 'waiting') {
      setCurrentStep('reviewing');
      toast.info('Transaction Received', 'Please review the transaction details');
    } else if (sessionStatus === 'signed' && currentStep === 'signing') {
      setCurrentStep('signed');
    } else if (sessionStatus === 'completed' && currentStep !== 'completed' && currentStep !== 'signed') {
      // Only auto-transition to completed if not already showing post-signing status
      // User can stay in 'signed' state to watch mirror node polling
      setCurrentStep('completed');
      toast.success('Transaction Complete!', 'The multi-signature transaction was executed successfully');
    }
  }, [signingSession.state.status, signingSession.state.connected, currentStep]);

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

      // Trigger wallet connection (opens wallet selection dialog)
      await wallet.connect();

      // Wait for wallet to connect
      // Note: The useWallet hook will update wallet.isConnected when ready
      // The auto-advance effect will then handle moving to session-connect step

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

      // Allow retry but with the ref guard in place
      // Reset hasAutoConnectedRef to allow manual retry, but connectionAttemptRef still tracks total attempts
      hasAutoConnectedRef.current = false;
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

      // Import signing function
      const { signTransaction } = await import('../../../lib/walletconnect');

      // Convert base64 to Uint8Array
      const txBytes = Buffer.from(
        signingSession.state.transaction.frozenTransaction.base64,
        'base64'
      );

      // Sign transaction
      const signResult = await signTransaction(txBytes);

      // Extract signature from signed transaction bytes
      const signedTxBytes = signResult.result;
      const { Transaction } = await import('@hashgraph/sdk');
      const signedTx = Transaction.fromBytes(signedTxBytes);

      // Extract transaction ID for post-signing status
      const txId = signedTx.transactionId?.toString() || 'Unknown';
      setSignedTransactionId(txId);

      // Extract transaction details from the decoded transaction (if available)
      const txDetails = signingSession.state.transaction.txDetails;
      if (txDetails) {
        setSignedTransactionDetails({
          type: txDetails.type || 'Unknown',
          transfers: txDetails.transfers as Array<{ accountId: string; amount: string }> | undefined,
          tokenIds: txDetails.tokenIds,
          contractId: txDetails.contractId,
          functionName: txDetails.functionName,
          memo: txDetails.transactionMemo || txDetails.memo,
          maxTransactionFee: txDetails.maxTransactionFee,
        });
      }

      // Extract ALL signatures from the signed transaction
      // Each entry in _signedTransactions.list corresponds to a different node account ID
      // and has a unique signature for that node-specific transaction body
      const signedTxList = signedTx._signedTransactions.list;
      const allSignatures: string[] = [];

      for (let i = 0; i < signedTxList.length; i++) {
        const signatureMap = signedTxList[i].sigMap;
        if (!signatureMap || !signatureMap.sigPair || signatureMap.sigPair.length === 0) {
          throw new Error(`No signatures found in signed transaction entry ${i}`);
        }

        const sigPair = signatureMap.sigPair[0];
        const signature = sigPair.ed25519 || sigPair.ECDSASecp256k1;
        if (!signature) {
          throw new Error(`Invalid signature format in entry ${i}`);
        }

        allSignatures.push(Buffer.from(signature).toString('base64'));
      }

      if (allSignatures.length === 0) {
        throw new Error('No signatures extracted from signed transaction');
      }

      // For single-node transactions, send single signature; for multi-node, send array
      const signatureData = allSignatures.length === 1 ? allSignatures[0] : allSignatures;
      const publicKey = wallet.publicKey!;

      console.log(`Transaction signed (${allSignatures.length} node signatures), submitting...`);
      toast.success('Signature Created', 'Submitting to coordinator...');

      // Submit signature(s)
      signingSession.submitSignature(publicKey, signatureData);

      console.log('Signature submitted successfully');
      toast.success('Signature Submitted', 'Checking network status...');
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
  const handleDisconnect = async () => {
    // Clear all session caches to ensure clean state for next session
    sessionRecovery.clearSession();
    localStorage.removeItem('hedera-multisig-session-info');

    signingSession.disconnect();
    await wallet.disconnect();
    router.push('/');
  };

  // Handle clearing session cache and retrying
  const handleClearAndRetry = () => {
    sessionRecovery.clearSession();
    localStorage.removeItem('hedera-multisig-session-info');
    window.location.reload();
  };

  // Handle clearing post-signing status to be ready for next transaction
  const handleClearPostSigning = () => {
    setSignedTransactionId(null);
    setSignedTransactionDetails(null);
    setCurrentStep('waiting');
    toast.info('Ready for Next Transaction', 'Waiting for coordinator to send another transaction');
  };

  // Render error state
  if (currentStep === 'error') {
    const isSessionMismatch = errorMessage?.includes('previously connected') || errorMessage?.includes('mismatch');

    return (
      <main className="min-h-screen flex items-center justify-center p-8 bg-gray-50">
        <div className="max-w-lg w-full bg-white border-2 border-red-500 rounded-lg p-8">
          <div className="text-center mb-6">
            <div className="text-6xl mb-4">❌</div>
            <h1 className="text-2xl font-bold text-red-800 mb-2">Error</h1>
            <p className="text-red-600">{errorMessage}</p>
          </div>
          <div className="space-y-3">
            {isSessionMismatch && (
              <button
                onClick={handleClearAndRetry}
                className="w-full px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Clear Cache & Join This Session
              </button>
            )}
            <button
              onClick={() => router.push('/join')}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Back to Join Session
            </button>
          </div>
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

      {/* Share Session Dialog */}
      {sessionInfo && (
        <ShareSessionDialog
          open={showShareDialog}
          onClose={() => setShowShareDialog(false)}
          serverUrl={sessionInfo.serverUrl}
          sessionId={sessionInfo.sessionId}
          pin={sessionInfo.pin}
        />
      )}

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white border-2 border-gray-300 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Multi-Signature Session</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-gray-600">Session ID:</span>
                <code className="text-sm font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-800">
                  {sessionId.length > 16 ? `${sessionId.slice(0, 8)}...${sessionId.slice(-6)}` : sessionId}
                </code>
                <CopyButton text={sessionId} label="Session ID" size="sm" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Session countdown timer */}
              {signingSession.state.sessionInfo?.expiresAt && (
                <SessionCountdown
                  expiresAt={signingSession.state.sessionInfo.expiresAt}
                  onExpired={() => {
                    toast.warning('Session has expired');
                    setErrorMessage('Session has expired');
                    setCurrentStep('error');
                  }}
                />
              )}
              {/* Share button - only show when session is connected */}
              {sessionInfo && (currentStep === 'waiting' || currentStep === 'reviewing' || currentStep === 'ready') && (
                <button
                  onClick={() => setShowShareDialog(true)}
                  className="px-4 py-2 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200 flex items-center gap-2"
                  title="Share session with other participants"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share
                </button>
              )}
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                Disconnect
              </button>
            </div>
          </div>

          {/* Step Indicator */}
          <div className="mt-6">
            <div className="flex items-center space-x-1">
              {/* Step 1: Connect Wallet */}
              <StepIndicator
                step={1}
                label="Wallet"
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
              <StepConnector
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

              {/* Step 2: Join Session */}
              <StepIndicator
                step={2}
                label="Join"
                active={currentStep === 'session-connect' || currentStep === 'ready'}
                completed={
                  currentStep === 'waiting' ||
                  currentStep === 'reviewing' ||
                  currentStep === 'signing' ||
                  currentStep === 'signed' ||
                  currentStep === 'completed'
                }
              />
              <StepConnector
                completed={
                  currentStep === 'waiting' ||
                  currentStep === 'reviewing' ||
                  currentStep === 'signing' ||
                  currentStep === 'signed' ||
                  currentStep === 'completed'
                }
              />

              {/* Step 3: Waiting for Transaction */}
              <StepIndicator
                step={3}
                label="Waiting"
                active={currentStep === 'waiting'}
                completed={
                  currentStep === 'reviewing' ||
                  currentStep === 'signing' ||
                  currentStep === 'signed' ||
                  currentStep === 'completed'
                }
              />
              <StepConnector
                completed={
                  currentStep === 'reviewing' ||
                  currentStep === 'signing' ||
                  currentStep === 'signed' ||
                  currentStep === 'completed'
                }
              />

              {/* Step 4: Review & Sign */}
              <StepIndicator
                step={4}
                label="Sign"
                active={currentStep === 'reviewing' || currentStep === 'signing'}
                completed={currentStep === 'signed' || currentStep === 'completed'}
              />
              <StepConnector completed={currentStep === 'signed' || currentStep === 'completed'} />

              {/* Step 5: Complete */}
              <StepIndicator
                step={5}
                label="Complete"
                active={currentStep === 'signed' || currentStep === 'completed'}
                completed={currentStep === 'completed'}
              />
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
            connected={wallet.isConnected}
            connecting={wallet.isConnecting}
            wallet={wallet.accountId ? { accountId: wallet.accountId, publicKey: wallet.publicKey || '', network: DEFAULT_NETWORK } : null}
            error={wallet.error}
            onConnect={handleConnectWallet}
            onDisconnect={() => wallet.disconnect()}
          />
        )}

        {/* Step 2+: Session Connection (shows wallet status + session status) */}
        {(currentStep === 'session-connect' || currentStep === 'ready' || currentStep === 'waiting' || currentStep === 'reviewing' || currentStep === 'signing' || currentStep === 'signed' || currentStep === 'completed') && (
          <>
            <WalletStatus
              connected={wallet.isConnected}
              connecting={wallet.isConnecting}
              wallet={wallet.accountId ? { accountId: wallet.accountId, publicKey: wallet.publicKey || '', network: DEFAULT_NETWORK } : null}
              error={wallet.error}
              onConnect={handleConnectWallet}
              onDisconnect={() => wallet.disconnect()}
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

            {/* Participant List */}
            {(currentStep === 'waiting' || currentStep === 'reviewing' || currentStep === 'signing' || currentStep === 'signed') && (
              <ParticipantList
                participants={signingSession.state.participants}
                currentParticipantId={signingSession.state.participantId}
                eligiblePublicKeys={signingSession.state.sessionInfo?.eligiblePublicKeys}
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

        {/* Step 3b: Signed - show post-signing status with mirror node polling */}
        {currentStep === 'signed' && signedTransactionId && (
          <PostSigningStatus
            transactionId={signedTransactionId}
            transactionDetails={signedTransactionDetails}
            network={DEFAULT_NETWORK as 'testnet' | 'mainnet'}
            onClear={handleClearPostSigning}
          />
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
    <div className="flex flex-col items-center min-w-[50px]">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
          completed
            ? 'bg-green-500 text-white'
            : active
            ? 'bg-blue-500 text-white'
            : 'bg-gray-200 text-gray-500'
        }`}
      >
        {completed ? '✓' : step}
      </div>
      <div className={`text-xs mt-1 text-center ${active ? 'text-blue-600 font-semibold' : completed ? 'text-green-600' : 'text-gray-500'}`}>
        {label}
      </div>
    </div>
  );
}

function StepConnector({ completed }: { completed: boolean }) {
  return (
    <div className="flex-1 h-1 bg-gray-200 min-w-[20px]">
      <div className={`h-full transition-all ${completed ? 'bg-green-500' : 'bg-gray-200'}`} />
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
