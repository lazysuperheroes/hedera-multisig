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
import { StepProgress } from '../../../components/StepProgress';
import { ConnectingBanner } from '../../../components/ConnectingBanner';
import { DEFAULT_NETWORK } from '../../../lib/walletconnect-config';

interface SessionInfo {
  serverUrl: string;
  sessionId: string;
  pin?: string;
  reconnectionToken?: string;
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

  // Load session info from localStorage (with recovery support).
  //
  // Idempotent: returns early once `sessionInfo` is set so the effect
  // doesn't re-run when `sessionRecovery.savedSession` changes. The
  // re-run path is what introduced a credential-loss bug:
  //
  //   1. /join stages {serverUrl, sessionId, pin} in sessionStorage,
  //      navigates here.
  //   2. First run: savedSession is null (the hook only surfaces
  //      sessions that already carry a reconnectionToken). Fall-through
  //      reads sessionStorage and sets sessionInfo with the fresh PIN.
  //   3. We call sessionRecovery.saveSession() to migrate; the hook
  //      strips PIN (security) and stores {serverUrl, sessionId,
  //      timestamp}. setSavedSession updates in-memory savedSession.
  //   4. Without this guard, the effect re-runs because savedSession
  //      changed, takes the restore branch (sessionId matches), and
  //      writes a sessionInfo *without* the PIN — leaving AUTH with
  //      neither PIN nor reconnectionToken, which the server rejects
  //      as "missing credentials".
  //
  // Guarding on sessionInfo is the right semantic: this effect's job
  // is to load initial sessionInfo, and once that's done it has nothing
  // more to do.
  useEffect(() => {
    // Wait for storage check to complete
    if (!sessionRecovery.hasCheckedStorage) {
      return;
    }

    // Already loaded — don't re-run when savedSession changes.
    if (sessionInfo) {
      return;
    }

    // Check if we have a saved session
    if (sessionRecovery.savedSession) {
      // Verify session ID matches. If it doesn't, the user is here for
      // a fresh ceremony — clear the stale recovery silently and fall
      // through to the fresh-join branch below. (Prior behavior was to
      // surface a "you were previously connected to a different
      // session" error and force the user back to /join, which was
      // noise: they're already on /session/<new-id> with a fresh PIN
      // staged in sessionStorage. The earlier session is gone.)
      if (sessionRecovery.savedSession.sessionId !== sessionId) {
        sessionRecovery.clearSession();
        // fall through — the else-branch below handles fresh-join.
      } else {
        // Session found — restore it.
        setSessionInfo({
          serverUrl: sessionRecovery.savedSession.serverUrl,
          sessionId: sessionRecovery.savedSession.sessionId,
          reconnectionToken: sessionRecovery.savedSession.reconnectionToken,
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
        return;
      }
    }

    // Fall-through: no saved-session match — read the PIN handoff
    // staged by /join in sessionStorage.
    //
    // Phase B2: per-tab handoff via sessionStorage (auto-cleared on
    // tab close). Falls back to the legacy localStorage key for
    // anyone with an older build active in this tab.
    let stored: string | null = null;
    try { stored = sessionStorage.getItem('hedera-multisig-pending-join'); } catch {}
    if (!stored) {
      try { stored = localStorage.getItem('hedera-multisig-session-info'); } catch {}
    }
    // Always purge the legacy key — if found here, migrate then delete.
    try { localStorage.removeItem('hedera-multisig-session-info'); } catch {}

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

      // Migrate to new session recovery system (PIN-free; reconnection token
      // arrives later via AUTH_SUCCESS).
      sessionRecovery.saveSession({
        serverUrl: parsed.serverUrl,
        sessionId: parsed.sessionId,
        pin: parsed.pin,
      });

      // PIN has been consumed — purge the per-tab handoff immediately.
      // After this point the session uses reconnectionToken only.
      try { sessionStorage.removeItem('hedera-multisig-pending-join'); } catch {}

      setCurrentStep('wallet-connect');
    } catch (error) {
      setErrorMessage('Invalid session information.');
      setCurrentStep('error');
    }
  }, [sessionId, sessionRecovery.hasCheckedStorage, sessionRecovery.savedSession, sessionInfo]);

  // Auto-advance if wallet already connected via NavBar (Path A: Connect-first flow)
  useEffect(() => {
    // Guard: Only run once when conditions are met
    if (currentStep !== 'wallet-connect') return;
    if (!wallet.isConnected || !wallet.publicKey || !sessionInfo) return;

    // Prevent infinite reconnection loops
    if (hasAutoConnectedRef.current) {
      return;
    }

    // Check connection attempt limit
    if (connectionAttemptRef.current >= maxConnectionAttempts) {
      setErrorMessage('Failed to connect after multiple attempts. Please try refreshing the page.');
      setCurrentStep('error');
      return;
    }

    hasAutoConnectedRef.current = true;
    connectionAttemptRef.current += 1;

    // No transient toasts here. Earlier iterations fired
    // toast.info('Wallet Detected') + toast.info('Connecting to
    // Session') ahead of the connect, but React routinely batched
    // those state updates with the post-AUTH state updates that
    // arrived ~200-400ms later — the user saw all three render
    // together at the moment AUTH succeeded, which defeats the
    // purpose of progress feedback. The ConnectingBanner below
    // (rendered as soon as currentStep flips to 'session-connect')
    // is the persistent surface; it carries the wallet account in
    // its first message and rotates forward as the connect proceeds.
    setCurrentStep('session-connect');

    // Capture the non-null value, then kick the connect on the next
    // microtask so React commits the state-step update above before
    // the WebSocket open races with rendering.
    const publicKey = wallet.publicKey;
    Promise.resolve().then(() => handleConnectSession(publicKey!));
  }, [currentStep, wallet.isConnected, wallet.publicKey, sessionInfo?.sessionId]);

  // Auto-update step based on session state
  useEffect(() => {
    const sessionStatus = signingSession.state.status;
    const isConnectedToSession = signingSession.state.connected;

    // Handle StrictMode remount: if we're at wallet-connect but session is already connected
    // This can happen when useState resets currentStep but the WebSocket connection persists
    if (currentStep === 'wallet-connect' && isConnectedToSession) {
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
        // Session saved for recovery
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
      // Note: the "Connecting to Session" toast is fired by the
      // auto-advance effect upstream (Path A) BEFORE this function
      // runs, so React can flush it before the WebSocket roundtrip.
      // Firing it here would be redundant — the upstream call wins.

      // Connect to WebSocket (with public key for early validation).
      // When the saved-session restore branch populated sessionInfo,
      // it left a reconnectionToken in place of the PIN — pass that
      // through so AUTH carries the token. Without this the server
      // would see an empty PIN and reject with "missing credentials".
      const result = await signingSession.connect(
        sessionInfo.serverUrl,
        sessionInfo.sessionId,
        sessionInfo.pin || '',
        publicKey,
        sessionInfo.reconnectionToken
      );

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

      // Extract ALL signatures from the signed transaction, then
      // align them positionally to the ORIGINAL frozen tx bodies the
      // server has stored.
      //
      // The naïve approach — iterate `signedTx._signedTransactions.list`
      // and trust its order — works when the wallet preserves the
      // wire-order of the bodies it received. HashPack via WalletConnect
      // can reorder (and in some versions duplicate) the bodies when it
      // re-serializes after signing, which leaves signature[i] not
      // matching bodyBytes[i] from the server's perspective and the
      // server rejects with "Signature[1] does not match bodyBytes[1]".
      //
      // Robust fix: byte-equality match each wallet-returned body
      // against the original frozen tx's bodies, then place each
      // signature at the index the server expects. Whatever order the
      // wallet hands back, the server sees signatures lined up against
      // its bodyBytes[0..N].
      const originalTx = Transaction.fromBytes(txBytes);
      const originalSignedList: Array<{ bodyBytes?: Uint8Array }> =
        (originalTx as unknown as { _signedTransactions: { list: Array<{ bodyBytes?: Uint8Array }> } })
          ._signedTransactions.list;

      const signedTxList: Array<{
        bodyBytes?: Uint8Array;
        sigMap?: { sigPair?: Array<{ ed25519?: Uint8Array; ECDSASecp256k1?: Uint8Array }> };
      }> = (signedTx as unknown as {
        _signedTransactions: {
          list: Array<{
            bodyBytes?: Uint8Array;
            sigMap?: { sigPair?: Array<{ ed25519?: Uint8Array; ECDSASecp256k1?: Uint8Array }> };
          }>;
        };
      })._signedTransactions.list;

      // Hex-encode each original body so we can map walletBody → originalIndex.
      const toHex = (bytes: Uint8Array | undefined): string => {
        if (!bytes) return '';
        return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
      };
      const originalIndexByBody = new Map<string, number>();
      originalSignedList.forEach((entry, idx) => {
        const key = toHex(entry.bodyBytes);
        if (key) originalIndexByBody.set(key, idx);
      });

      const allSignatures: string[] = new Array(originalSignedList.length).fill('');
      let placed = 0;
      for (let i = 0; i < signedTxList.length; i++) {
        const entry = signedTxList[i];
        const sigPair = entry.sigMap?.sigPair?.[0];
        const signature = sigPair?.ed25519 || sigPair?.ECDSASecp256k1;
        if (!signature || signature.length === 0) {
          // Some bodies may legitimately come back unsigned by the
          // wallet — skip rather than throw. We only need at least
          // one valid signature for the legacy single-sig path; for
          // the multi-sig path we'll fail below if not all slots
          // get filled.
          continue;
        }
        const originalIdx = originalIndexByBody.get(toHex(entry.bodyBytes));
        if (originalIdx === undefined) {
          // The wallet returned a body that doesn't correspond to any
          // of the original bodies. That means the wallet re-built
          // the transaction (different node selection / timestamps /
          // freeze) — its signatures cannot be applied to our frozen
          // bytes at all.
          throw new Error(
            `Wallet-returned body[${i}] does not match any original body — ` +
            `the wallet appears to have re-frozen the transaction. The ` +
            `coordinator must re-inject for the wallet to sign the same bytes.`,
          );
        }
        allSignatures[originalIdx] = Buffer.from(signature).toString('base64');
        placed += 1;
      }

      if (placed === 0) {
        throw new Error('Wallet returned no usable signatures');
      }

      // Multi-node freeze: every body must have a signature. If the
      // wallet only signed a subset, fall back to the legacy single-
      // sig path which the server tolerates against bodyBytes[0].
      let signatureData: string | string[];
      if (placed === originalSignedList.length) {
        signatureData = allSignatures;
      } else {
        // Find the first non-empty signature — that's our single-sig
        // submission. Server will verify it against bodyBytes[0].
        const firstNonEmpty = allSignatures.find((s) => s !== '');
        if (!firstNonEmpty) {
          throw new Error('No signatures placed at any body index');
        }
        signatureData = firstNonEmpty;
      }
      const publicKey = wallet.publicKey!;

      toast.success('Signature Created', 'Submitting to coordinator...');

      // Submit signature(s)
      signingSession.submitSignature(publicKey, signatureData);

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
    signingSession.rejectTransaction(reason);
    toast.warning('Transaction Rejected', reason || 'You rejected the transaction');
    setCurrentStep('waiting');
  };

  // Handle disconnect
  const handleDisconnect = async () => {
    // Clear all session caches to ensure clean state for next session
    sessionRecovery.clearSession();
    try { localStorage.removeItem('hedera-multisig-session-info'); } catch {}
    try { sessionStorage.removeItem('hedera-multisig-pending-join'); } catch {}

    signingSession.disconnect();
    await wallet.disconnect();
    router.push('/');
  };

  // Handle clearing session cache and retrying
  const handleClearAndRetry = () => {
    sessionRecovery.clearSession();
    try { localStorage.removeItem('hedera-multisig-session-info'); } catch {}
    try { sessionStorage.removeItem('hedera-multisig-pending-join'); } catch {}
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
      <main className="min-h-screen flex items-center justify-center p-8 bg-surface-recessed">
        <div className="max-w-lg w-full bg-surface border-2 border-destructive rounded-lg p-8">
          <div className="text-center mb-6">
            <div className="text-6xl mb-4">❌</div>
            <h1 className="text-2xl font-bold text-destructive-soft-fg mb-2">Error</h1>
            <p className="text-destructive">{errorMessage}</p>
          </div>
          <div className="space-y-3">
            {isSessionMismatch && (
              <button
                onClick={handleClearAndRetry}
                className="w-full px-4 py-3 bg-success text-white rounded-lg hover:bg-success"
              >
                Clear Cache & Join This Session
              </button>
            )}
            <button
              onClick={() => router.push('/join')}
              className="w-full px-4 py-3 bg-accent text-white rounded-lg hover:bg-accent-hover"
            >
              Back to Join Session
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Render loading state.
  //
  // Two variants:
  //   (a) Wallet already connected (Path A) → show ConnectingBanner
  //       directly, since the user clearly has a wallet paired and
  //       expects to see "what's the system doing right now?". This
  //       removes the skeleton flash that previously preceded the
  //       wallet-connect step's banner — same surface across all
  //       three loading-→-wallet-connect-→-session-connect renders.
  //   (b) No wallet yet (Path B / cold load) → keep the skeleton so
  //       the user has a recognizable "page is loading" cue before
  //       the wallet-connect / connect-button UI shows up.
  if (currentStep === 'loading') {
    if (wallet.isConnected) {
      return (
        <main className="min-h-screen p-8 bg-surface-recessed" aria-busy="true" aria-label="Connecting to session">
          <div className="max-w-4xl mx-auto space-y-6">
            <ConnectingBanner accountId={wallet.accountId} />
          </div>
        </main>
      );
    }
    return (
      <main className="min-h-screen p-8 bg-surface-recessed" aria-busy="true" aria-label="Loading session">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Skeleton: session header card */}
          <div className="bg-surface border-2 border-border rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="skeleton h-6 w-56 rounded"></div>
                <div className="skeleton h-4 w-36 rounded"></div>
              </div>
              <div className="skeleton h-9 w-24 rounded-lg"></div>
            </div>
            {/* Skeleton: step indicator */}
            <div className="mt-6 flex items-center gap-1">
              {[1,2,3,4,5].map((i) => (
                <div key={i} className="flex items-center flex-1">
                  <div className="flex flex-col items-center min-w-[56px]">
                    <div className="skeleton w-10 h-10 rounded-full"></div>
                    <div className="skeleton h-3 w-12 mt-1.5 rounded"></div>
                  </div>
                  {i < 5 && <div className="skeleton flex-1 h-1.5 rounded-full mx-1"></div>}
                </div>
              ))}
            </div>
          </div>
          {/* Skeleton: content area */}
          <div className="bg-surface border-2 border-border rounded-lg p-6 space-y-4">
            <div className="skeleton h-5 w-40 rounded"></div>
            <div className="skeleton h-4 w-full rounded"></div>
            <div className="skeleton h-4 w-3/4 rounded"></div>
            <div className="skeleton h-12 w-full rounded-lg mt-4"></div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8 bg-surface-recessed">
      {/* Toast Notifications */}
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />

      {/* Share Session Dialog */}
      {sessionInfo && (
        <ShareSessionDialog
          open={showShareDialog}
          onClose={() => setShowShareDialog(false)}
          serverUrl={sessionInfo.serverUrl}
          sessionId={sessionInfo.sessionId}
          pin={sessionInfo.pin || ''}
        />
      )}

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-surface border-2 border-border rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Multi-Signature Session</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-foreground-muted">Session ID:</span>
                <code className="text-sm font-mono bg-surface-recessed px-2 py-0.5 rounded text-foreground">
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
                  className="px-4 py-2 text-sm bg-info-soft text-info-soft-fg rounded hover:bg-info-soft dark:hover:bg-accent-hover flex items-center gap-2"
                  title="Share session with other participants"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share
                </button>
              )}
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 text-sm bg-surface-recessed text-foreground-muted rounded hover:bg-border-strong dark:hover:bg-foreground-subtle"
              >
                Disconnect
              </button>
            </div>
          </div>

          {/* Step Indicator */}
          <div className="mt-6">
            <StepProgress
              steps={[
                { key: 'wallet', label: 'Wallet' },
                { key: 'join', label: 'Join' },
                { key: 'waiting', label: 'Waiting' },
                { key: 'sign', label: 'Sign' },
                { key: 'complete', label: 'Complete' },
              ]}
              currentIndex={
                currentStep === 'wallet-connect' ? 0 :
                currentStep === 'session-connect' || currentStep === 'ready' ? 1 :
                currentStep === 'waiting' ? 2 :
                currentStep === 'reviewing' || currentStep === 'signing' ? 3 :
                currentStep === 'signed' || currentStep === 'completed' ? 4 : 0
              }
            />
          </div>
        </div>

        {/* Error Display */}
        {errorMessage && (
          <div className="bg-destructive-soft border-2 border-destructive rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <svg className="w-6 h-6 text-destructive flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <h2 className="font-semibold text-destructive-soft-fg">Error</h2>
                <p className="text-sm text-destructive">{errorMessage}</p>
              </div>
            </div>
          </div>
        )}

        {/* Step 1: Connect Wallet
            Path A (wallet already connected globally via NavBar): we
            render the ConnectingBanner immediately so the user sees
            progress feedback the instant they land on the page,
            instead of a "Connect Wallet" button that flickers for a
            frame before the auto-advance effect fires. The banner is
            the same one shown during session-connect, so the visual
            experience is "land → see banner → see banner → connected"
            with no jarring intermediate state. */}
        {currentStep === 'wallet-connect' && wallet.isConnected && (
          <ConnectingBanner accountId={wallet.accountId} />
        )}

        {currentStep === 'wallet-connect' && !wallet.isConnected && (
          <>
            {/* Phase C17: prime first-time users on what's about to happen */}
            <details className="mb-4 rounded-lg border border-info/40 bg-info-soft p-4">
              <summary className="cursor-pointer text-sm font-semibold text-info-soft-fg">
                What&apos;s about to happen?
              </summary>
              <ol className="mt-3 ml-1 space-y-2 text-sm text-info-soft-fg">
                <li><strong>1.</strong> Connect your Hedera wallet (HashPack, Blade, or Kabila).</li>
                <li><strong>2.</strong> Wait for the coordinator to inject a transaction — usually within a few minutes.</li>
                <li><strong>3.</strong> Review the transaction details. You&apos;ll see exactly what you&apos;re being asked to sign — type, amounts, recipients, contract calls.</li>
                <li><strong>4.</strong> Approve or reject. If you approve, your wallet asks for confirmation. Your private key never leaves your device.</li>
              </ol>
            </details>
            <WalletStatus
              connected={wallet.isConnected}
              connecting={wallet.isConnecting}
              wallet={wallet.accountId ? { accountId: wallet.accountId, publicKey: wallet.publicKey || '', network: DEFAULT_NETWORK } : null}
              error={wallet.error}
              onConnect={handleConnectWallet}
              onDisconnect={() => wallet.disconnect()}
            />
          </>
        )}

        {/* Step 2+: Session Connection (shows wallet status + session status) */}
        {(currentStep === 'session-connect' || currentStep === 'ready' || currentStep === 'waiting' || currentStep === 'reviewing' || currentStep === 'signing' || currentStep === 'signed' || currentStep === 'completed') && (
          <>
            {/* Active feedback during the AUTH gap — WebSocket round-trip
                through the ngrok tunnel + eligibility check is 1-3s and
                otherwise looks like a frozen page. Banner unmounts as
                soon as the server replies AUTH_SUCCESS. */}
            {currentStep === 'session-connect' && !signingSession.state.connected && (
              <ConnectingBanner accountId={wallet.accountId} />
            )}

            <WalletStatus
              connected={wallet.isConnected}
              connecting={wallet.isConnecting}
              wallet={wallet.accountId ? { accountId: wallet.accountId, publicKey: wallet.publicKey || '', network: DEFAULT_NETWORK } : null}
              error={wallet.error}
              onConnect={handleConnectWallet}
              onDisconnect={() => wallet.disconnect()}
            />

            {/* Session Status */}
            <div className="bg-surface border-2 border-border rounded-lg p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4">Session Status</h2>
              <dl className="space-y-3">
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
              </dl>
            </div>

            {/* Signature Progress */}
            {(currentStep === 'waiting' || currentStep === 'reviewing' || currentStep === 'signing' || currentStep === 'signed' || currentStep === 'completed') && (
              <SignatureProgress
                signaturesCollected={signingSession.state.stats.signaturesCollected}
                signaturesRequired={signingSession.state.stats.signaturesRequired}
                participantsConnected={signingSession.state.stats.participantsConnected}
                participantsReady={signingSession.state.stats.participantsReady}
                participantsExpected={signingSession.state.stats.participantsExpected}
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
          <div className="bg-info-soft border-2 border-info rounded-lg p-8 text-center">
            <div className="animate-pulse mb-4">
              <svg className="w-16 h-16 text-accent mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-info-soft-fg mb-2">Signing Transaction...</h2>
            <p className="text-info-soft-fg">Please approve the signature request in your wallet</p>
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
          <div className="bg-success-soft border-2 border-success rounded-lg p-8 text-center">
            <div className="mb-4">
              <svg className="w-20 h-20 text-success mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-success-soft-fg mb-2">Transaction Executed!</h2>
            <p className="text-success-soft-fg mb-6">
              The multi-signature transaction has been successfully executed on the Hedera network.
            </p>

            <div className="space-y-3">
              <button
                onClick={() => router.push('/')}
                className="w-full px-6 py-3 bg-success text-white font-semibold rounded-lg hover:bg-success"
              >
                Return to Home
              </button>
              <button
                onClick={() => router.push('/join')}
                className="w-full px-6 py-3 bg-surface-recessed text-foreground-muted rounded-lg hover:bg-border-strong dark:hover:bg-foreground-subtle"
              >
                Join Another Session
              </button>
            </div>
          </div>
        )}

        {/* Waiting state */}
        {currentStep === 'waiting' && (
          <div className="bg-info-soft border-2 border-info/40 rounded-lg p-8 text-center">
            <div className="animate-pulse mb-4">
              <svg className="w-16 h-16 text-accent mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-info-soft-fg mb-2">Waiting for Transaction...</h2>
            <p className="text-info-soft-fg mb-6">The coordinator will send the transaction for review shortly</p>

            <button
              onClick={handleDisconnect}
              className="px-6 py-2 bg-surface-recessed text-foreground-muted rounded-lg hover:bg-border-strong dark:hover:bg-foreground-subtle transition-colors"
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

function StatusItem({ label, status }: { label: string; status: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border">
      <dt className="text-sm text-foreground-muted">{label}</dt>
      <dd className="text-sm font-mono font-semibold text-foreground">{status}</dd>
    </div>
  );
}
