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
import { TransactionReview } from '../../../components/TransactionReview';
import { ScheduledReview } from '../../../components/ScheduledReview';
import { SignatureProgress } from '../../../components/SignatureProgress';
import { PostSigningStatus } from '../../../components/PostSigningStatus';
import { ToastContainer } from '../../../components/Toast';
import { CopyButton } from '../../../components/CopyButton';
import { SessionCountdown } from '../../../components/SessionCountdown';
import { ShareSessionDialog } from '../../../components/ShareSessionDialog';
import { ParticipantList } from '../../../components/ParticipantList';
import { StepProgress } from '../../../components/StepProgress';
import { ConnectingBanner } from '../../../components/ConnectingBanner';
import { Icon } from '../../../components/Icon';
import { DEFAULT_NETWORK } from '../../../lib/walletconnect-config';
import { diagnoseBodyMismatch } from '../../../lib/diagnose-body-mismatch';
import { probeVerifyPaths } from '../../../lib/probe-verify-paths';

interface SessionInfo {
  serverUrl: string;
  sessionId: string;
  pin?: string;
  reconnectionToken?: string;
  /**
   * Optional friendly name the user supplied at /join (e.g. "alice").
   * Forwarded to the WebSocket client so the server stores it on the
   * participant and other clients can show "alice" in the row list
   * instead of a generic "Participant".
   */
  label?: string;
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
  // Default fallback label; the user-supplied display name (if any)
  // is collected on /join, persisted via sessionInfo.label, and passed
  // per-call into signingSession.connect() — that overrides the
  // constructor-time default at AUTH time even though the client was
  // built before sessionInfo populated.
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

      // Don't purge the sessionStorage handoff here. React 18 StrictMode
      // dev double-mounts this component: mount #1 consumes, then
      // unmounts before AUTH_SUCCESS lands a reconnectionToken in
      // localStorage; mount #2 sees no sessionStorage AND a
      // reconnectionToken-less saved session (which `useSessionRecovery`
      // discards) — net result, "No session information found." Leaving
      // the key alone makes the read idempotent across remounts and
      // retry-on-auth-failure. sessionStorage auto-clears on tab close,
      // and re-running /join overwrites it, so leaving it in place for
      // the tab's lifetime is benign.

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
    } else if (
      sessionStatus === 'reviewing' &&
      (currentStep === 'waiting' || currentStep === 'completed' || currentStep === 'signed')
    ) {
      // Multi-tx-per-session: a coordinator can inject a SECOND
      // transaction after the first one completed. The participant
      // might still be parked on the post-signing screen ('signed' or
      // 'completed') — accept the new TRANSACTION_RECEIVED as a
      // legitimate transition and clear the stale post-signing card so
      // the new review screen shows up clean.
      setSignedTransactionId(null);
      setSignedTransactionDetails(null);
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
        sessionInfo.reconnectionToken,
        sessionInfo.label,
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

  // Handle transaction approval — branches by session mode.
  const handleApprove = async () => {
    // HIP-423 scheduled-tx branch. Distinct flow:
    //   1. Build a ScheduleSignTransaction(scheduleId).
    //   2. Have the wallet sign + execute it directly to the network.
    //   3. NO SIGNATURE_SUBMIT over WS — the signature lives on-chain.
    //      The coordinator and other participants discover it via
    //      mirror-node `getScheduleInfo`.
    if (signingSession.state.schedule) {
      const schedule = signingSession.state.schedule;
      try {
        setCurrentStep('signing');
        setErrorMessage(null);
        toast.info('Signing Schedule', 'Please approve in your wallet — your signature goes on-chain');

        const sdk = await import('@hashgraph/sdk');
        const sdkAny = sdk as unknown as {
          ScheduleSignTransaction: new () => {
            setScheduleId: (id: unknown) => unknown;
            executeWithSigner: (signer: unknown) => Promise<{
              transactionId: { toString(): string };
              getReceiptWithSigner: (signer: unknown) => Promise<{ status: { toString(): string } }>;
            }>;
          };
          ScheduleId: { fromString: (s: string) => unknown };
        };

        const { getDAppConnector } = await import('../../../lib/walletconnect');
        const dappConnector = getDAppConnector();
        if (!dappConnector || !dappConnector.signers || dappConnector.signers.length === 0) {
          throw new Error('Wallet not connected — connect your wallet first.');
        }
        const signer = dappConnector.signers[0] as unknown;

        const signTx = new sdkAny.ScheduleSignTransaction();
        signTx.setScheduleId(sdkAny.ScheduleId.fromString(schedule.scheduleId));

        const response = await (signTx as unknown as {
          executeWithSigner: (s: unknown) => Promise<{
            transactionId: { toString(): string };
            getReceiptWithSigner: (s: unknown) => Promise<{ status: { toString(): string } }>;
          }>;
        }).executeWithSigner(signer);
        const receipt = await response.getReceiptWithSigner(signer);

        toast.success('Signature on-chain', `ScheduleSign tx submitted: ${response.transactionId.toString()}`);

        // Mark this user as signed locally. Other participants discover
        // it via mirror node — no WS broadcast needed.
        setSignedTransactionId(response.transactionId.toString());
        setSignedTransactionDetails({
          type: 'ScheduleSignTransaction',
          memo: schedule.scheduleMemo || `Sign schedule ${schedule.scheduleId}`,
        });
        setCurrentStep('signed');
      } catch (error) {
        console.error('ScheduleSign failed:', error);
        const msg = (error as Error).message || 'Unknown signing error';
        setErrorMessage(msg);
        toast.error('Signing Failed', msg);
        setCurrentStep('reviewing');
      }
      return;
    }

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
      const { Transaction, PublicKey } = await import('@hashgraph/sdk');
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

      // Align wallet-returned signatures to the ORIGINAL frozen tx
      // bodies the server has stored.
      //
      // The byte-equality match alone (2.1.15) wasn't enough: HashPack
      // can preserve `bodyBytes` correctly across all SignedTransaction
      // entries while populating sigMap with bogus or duplicated
      // signatures past index 0. The body-equality match would happily
      // place those bogus signatures at indices > 0 and the server
      // would reject at the first invalid one.
      //
      // 2.1.16: cryptographically VERIFY each wallet-returned signature
      // locally with the wallet's public key. Only signatures that
      // actually verify against their body get placed. If only sig[0]
      // verifies, fall through to the legacy single-sig path — the
      // server already tolerates that against bodyBytes[0].
      const originalTx = Transaction.fromBytes(txBytes);
      const originalSignedList: Array<{ bodyBytes?: Uint8Array }> =
        (originalTx as unknown as { _signedTransactions: { list: Array<{ bodyBytes?: Uint8Array }> } })
          ._signedTransactions.list;

      const signedTxList: Array<{
        bodyBytes?: Uint8Array;
        sigMap?: { sigPair?: Array<{ pubKeyPrefix?: Uint8Array; ed25519?: Uint8Array; ECDSASecp256k1?: Uint8Array }> };
      }> = (signedTx as unknown as {
        _signedTransactions: {
          list: Array<{
            bodyBytes?: Uint8Array;
            sigMap?: { sigPair?: Array<{ pubKeyPrefix?: Uint8Array; ed25519?: Uint8Array; ECDSASecp256k1?: Uint8Array }> };
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

      // Wallet's public key (DER- or raw-encoded). The SDK accepts
      // both via PublicKey.fromString.
      let walletPubKey;
      try {
        walletPubKey = PublicKey.fromString(wallet.publicKey!);
      } catch (parseErr) {
        throw new Error(
          `Could not parse wallet public key for signature verification: ${(parseErr as Error).message}`,
        );
      }

      const allSignatures: string[] = new Array(originalSignedList.length).fill('');
      let placed = 0;
      const verificationLog: Array<{ walletIdx: number; originalIdx: number | null; verified: boolean }> = [];

      for (let i = 0; i < signedTxList.length; i++) {
        const entry = signedTxList[i];
        const sigPair = entry.sigMap?.sigPair?.[0];
        const signature = sigPair?.ed25519 || sigPair?.ECDSASecp256k1;
        if (!signature || signature.length === 0) {
          verificationLog.push({ walletIdx: i, originalIdx: null, verified: false });
          continue;
        }
        const walletBodyBytes = entry.bodyBytes;
        if (!walletBodyBytes) {
          verificationLog.push({ walletIdx: i, originalIdx: null, verified: false });
          continue;
        }

        // First try the same-index match against the original frozen
        // tx — typical case when the wallet preserves order. If that
        // fails verification, scan all original bodies for a match.
        const candidateOriginalIdx = originalIndexByBody.get(toHex(walletBodyBytes));
        let verifiedOriginalIdx: number | null = null;

        const tryVerify = (originalIdx: number): boolean => {
          const origBody = originalSignedList[originalIdx]?.bodyBytes;
          if (!origBody) return false;
          try {
            return walletPubKey.verify(origBody, signature);
          } catch {
            return false;
          }
        };

        if (candidateOriginalIdx !== undefined && tryVerify(candidateOriginalIdx)) {
          verifiedOriginalIdx = candidateOriginalIdx;
        } else {
          // Fallback scan: maybe the body bytes match but the signature
          // was made over some other body, or the wallet substituted
          // bodies during re-serialization. Either way, brute-force the
          // signature against each original body.
          for (let j = 0; j < originalSignedList.length; j++) {
            if (allSignatures[j] !== '') continue; // already filled
            if (tryVerify(j)) {
              verifiedOriginalIdx = j;
              break;
            }
          }
        }

        if (verifiedOriginalIdx === null) {
          verificationLog.push({ walletIdx: i, originalIdx: null, verified: false });
          continue;
        }

        allSignatures[verifiedOriginalIdx] = Buffer.from(signature).toString('base64');
        placed += 1;
        verificationLog.push({ walletIdx: i, originalIdx: verifiedOriginalIdx, verified: true });
      }

      // Diagnostic log for the user / our future selves — clearly shows
      // how many of the wallet's claimed signatures were real.
      console.log(
        `[multisig] wallet returned ${signedTxList.length} sigMap entries, ${placed} verified against original bodies (out of ${originalSignedList.length})`,
        verificationLog,
      );

      // Even on the success path, run the diagnostic on localhost so
      // we can study what the wallet did (or didn't do) when the
      // ceremony works. Compares wallet bodyBytes with coord bodyBytes
      // field-by-field; if they're identical the diag stays quiet.
      // Useful for distinguishing "wallet signed verbatim" from
      // "wallet re-froze but happened to produce identical bytes."
      await diagnoseBodyMismatch({
        coordBodies: originalSignedList,
        walletBodies: signedTxList,
      });

      if (placed === 0) {
        // Wallet's signatures don't verify against the coordinator's
        // stored bodyBytes. Three distinct causes:
        //   - Problem A (node-selection): wallet only signs body[0]
        //     of a multi-node freeze. subsetSize=1 sidesteps this.
        //   - Problem B (parameter adjustment): wallet adjusts gas /
        //     fee / timestamp / transactionId before signing — common
        //     for ContractExecuteTransaction with HashPack and
        //     Kabila. subsetSize=1 does NOT help; the only reliable
        //     multi-sig path for contract execution via wallet is
        //     HIP-423 scheduled transactions.
        //   - Problem C (key mismatch): wallet signed with a different
        //     key than `wallet.publicKey` reports. Most commonly the
        //     paired account key has rotated, or the wallet is signing
        //     with a key that isn't the one in our threshold keylist.
        //     Diagnostic below cross-checks pubKeyPrefix against
        //     walletPubKey to confirm.
        //
        // Run the dev-only diagnostic so localhost devs can see the
        // exact field-level diff and triage which problem is biting.
        await diagnoseBodyMismatch({
          coordBodies: originalSignedList,
          walletBodies: signedTxList,
        });

        // Sig-pair-level key + format diagnostic. When the body bytes
        // are identical but the signature still doesn't verify, this
        // is the only thing that distinguishes Problem C ("wrong key")
        // from a sig-encoding bug. Localhost-gated.
        if (typeof window !== 'undefined') {
          const h = window.location.hostname;
          const onLocalhost = h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h.endsWith('.local');
          if (onLocalhost || process.env.NEXT_PUBLIC_DEBUG_TX === '1') {
            const walletKeyHex = wallet.publicKey
              ? Buffer.from(walletPubKey.toBytesRaw()).toString('hex')
              : '<unset>';
            for (let i = 0; i < signedTxList.length; i++) {
              const sigPair = signedTxList[i].sigMap?.sigPair?.[0];
              const prefix = sigPair?.pubKeyPrefix
                ? Buffer.from(sigPair.pubKeyPrefix).toString('hex')
                : '<missing>';
              const ed25519Sig = sigPair?.ed25519;
              const ecdsaSig = sigPair?.ECDSASecp256k1;
              const sigField = ed25519Sig ? 'ed25519' : ecdsaSig ? 'ECDSASecp256k1' : '<none>';
              const sigBytes = ed25519Sig || ecdsaSig;
              const sigLen = sigBytes ? sigBytes.length : 0;
              const sigHex = sigBytes
                ? Buffer.from(sigBytes).toString('hex').slice(0, 32) + '…'
                : '<empty>';
              console.log(
                `[diag] body[${i}] sigPair: field=${sigField} sigLen=${sigLen}B sigHex=${sigHex}`,
              );
              console.log(
                `[diag] body[${i}] pubKeyPrefix (signed-with) = ${prefix}`,
              );
              console.log(
                `[diag] body[${i}] wallet.publicKey         = ${walletKeyHex}`,
              );
              if (prefix !== '<missing>' && walletKeyHex !== '<unset>') {
                const matches = walletKeyHex.startsWith(prefix) || prefix.startsWith(walletKeyHex);
                console.log(
                  `[diag] body[${i}] key match = ${matches ? 'YES (pubKeyPrefix is prefix of wallet key)' : 'NO — Problem C: wallet signed with a different key'}`,
                );
              }
            }

            // Alternate-verify probe: try a battery of message
            // transformations to figure out what the wallet actually
            // signed, given that bodyBytes match + key matches but
            // direct verify fails. Even a positive match doesn't give
            // us a usable signature (the network only accepts direct
            // sign-bodyBytes), but it tells us whether to file a
            // wallet bug or to look elsewhere.
            const firstSigPair = signedTxList[0]?.sigMap?.sigPair?.[0];
            const probeSig = firstSigPair?.ed25519 || firstSigPair?.ECDSASecp256k1;
            const probeBody = originalSignedList[0]?.bodyBytes;
            if (probeSig && probeBody) {
              const probe = await probeVerifyPaths(probeBody, probeSig, walletPubKey);
              if (probe.found) {
                console.log(
                  `%c[probe] CONCLUSION: wallet signs "${probe.variantName}" instead of bodyBytes directly. ` +
                    'The Hedera network only accepts signatures over bodyBytes — so even though we now know the ' +
                    'convention, the wallet\'s signatures cannot be aggregated into a multi-sig transaction. ' +
                    'This is a wallet-side compliance bug. Recommend redirecting users to HashPack (single-node freeze) ' +
                    'or CLI participants for ContractExecute live ceremonies; file an issue with the wallet vendor.',
                  'color: #f59e0b;',
                );
              } else {
                console.log(
                  '%c[probe] CONCLUSION: no recognizable signing-message convention. The wallet signs an internal ' +
                    'representation we cannot reproduce from the wire data. Most likely it re-serializes the ' +
                    'TransactionBody (with gas/fee/timestamp adjustments) and signs the modified version, then ' +
                    'discards the modified bytes before returning. No recoverable workaround exists from the dApp side.',
                  'color: #dc2626;',
                );
              }
            }
          }
        }

        throw new Error(
          `Wallet returned ${signedTxList.length} signatures but none verified against the original transaction bodies.\n\n` +
          `For HBAR transfers and most simple transactions this works because wallets sign verbatim. ` +
          `For ContractExecuteTransaction, HashPack and Kabila re-freeze the transaction internally ` +
          `with their own gas/fee/timestamp adjustments before signing — so the signatures are valid ` +
          `against the wallet's re-frozen bytes, not the coordinator's stored bytes.\n\n` +
          `The reliable fix for multi-sig contract execution via wallet is HIP-423 scheduled transactions ` +
          `(/create's "Schedule this transaction" toggle). Each signer's ScheduleSignTransaction goes ` +
          `to the network independently — no shared-bytes aggregation, no wallet-rewrite mismatch.\n\n` +
          `Running on localhost? Open the browser console for a [diag] field-level diff showing exactly ` +
          `which fields the wallet changed.`,
        );
      }

      let signatureData: string | string[];
      if (placed === originalSignedList.length) {
        // Every body has a verified signature — submit the full array.
        signatureData = allSignatures;
      } else {
        // Wallet only signed a subset (typical for HashPack: just
        // body[0]). Fall through to the legacy single-sig path, which
        // the server tolerates against bodyBytes[0]. Pick the
        // signature that's at index 0 if available; otherwise pick
        // the first verified one.
        signatureData = allSignatures[0] || (allSignatures.find((s) => s !== '') as string);
        console.log(
          `[multisig] only ${placed}/${originalSignedList.length} bodies signed — submitting as legacy single-sig`,
        );
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

  // Render error state — flat, asymmetric, no card. Matches the
  // /join post-redesign convention: icon left, content right, single
  // cluster of CTAs at the bottom.
  if (currentStep === 'error') {
    const isSessionMismatch = errorMessage?.includes('previously connected') || errorMessage?.includes('mismatch');

    return (
      <main className="min-h-screen bg-background">
        <section className="max-w-2xl mx-auto px-6 py-16 sm:py-24">
          <div className="flex items-start gap-4">
            <Icon name="error_outline" size={32} className="text-destructive flex-shrink-0 mt-1" />
            <div className="flex-1">
              <h1 className="page-hero font-heading text-3xl sm:text-4xl font-bold tracking-tight text-foreground leading-[1.05]">
                Something went wrong
              </h1>
              <p className="mt-3 text-foreground-muted leading-relaxed">{errorMessage}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                {isSessionMismatch && (
                  <button
                    onClick={handleClearAndRetry}
                    className="cmd inline-flex items-center justify-center px-6 py-3 rounded-md text-base font-semibold bg-accent text-accent-fg hover:bg-accent-hover transition-colors"
                  >
                    Clear cache & retry
                    <span className="treasury-label ml-2 opacity-70">→</span>
                  </button>
                )}
                <button
                  onClick={() => router.push('/join')}
                  className="inline-flex items-center justify-center px-6 py-3 rounded-md text-base font-semibold text-foreground border border-border-strong hover:bg-surface-recessed transition-colors"
                >
                  Back to join
                </button>
              </div>
            </div>
          </div>
        </section>
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
        <main className="min-h-screen bg-background" aria-busy="true" aria-label="Connecting to session">
          <section className="max-w-3xl mx-auto px-6 py-8 sm:py-12">
            <ConnectingBanner accountId={wallet.accountId} />
          </section>
        </main>
      );
    }
    return (
      <main className="min-h-screen bg-background" aria-busy="true" aria-label="Loading session">
        <section className="max-w-3xl mx-auto px-6 py-8 sm:py-12 space-y-8">
          {/* Flat skeleton — eyebrow, headline, status row, body bones.
              Matches the new flat structure (no card chrome) so the
              loading state previews the actual page shape. */}
          <div className="space-y-3">
            <div className="skeleton h-3 w-32 rounded"></div>
            <div className="skeleton h-10 w-72 rounded"></div>
          </div>
          <div className="skeleton h-10 w-full rounded"></div>
          <div className="space-y-2">
            <div className="skeleton h-4 w-2/3 rounded"></div>
            <div className="skeleton h-4 w-1/2 rounded"></div>
            <div className="skeleton h-4 w-3/4 rounded"></div>
          </div>
        </section>
      </main>
    );
  }

  const abbreviatedSessionId = sessionId.length > 16
    ? `${sessionId.slice(0, 8)}…${sessionId.slice(-6)}`
    : sessionId;
  const isInActiveSession = ['session-connect', 'ready', 'waiting', 'reviewing', 'signing', 'signed', 'completed'].includes(currentStep);
  const showShareButton = sessionInfo && (currentStep === 'waiting' || currentStep === 'reviewing' || currentStep === 'ready');

  return (
    <main className="min-h-screen bg-background">
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />

      {sessionInfo && (
        <ShareSessionDialog
          open={showShareDialog}
          onClose={() => setShowShareDialog(false)}
          serverUrl={sessionInfo.serverUrl}
          sessionId={sessionInfo.sessionId}
          pin={sessionInfo.pin || ''}
        />
      )}

      <section className="max-w-3xl mx-auto px-6 py-8 sm:py-12">

        {/* Header — flat, asymmetric. Eyebrow + H1 + treasury sub-line.
            No card chrome; the typography carries the hierarchy. */}
        <header className="mb-8">
          <div className="flex items-center gap-2 mb-3 text-xs">
            <span className="font-medium uppercase tracking-wider text-foreground-muted">
              <span className="treasury-label">Session</span>
              <span className="console-label">session_id</span>
            </span>
            <code className="font-mono text-foreground-subtle">{abbreviatedSessionId}</code>
            <CopyButton text={sessionId} label="Session ID" size="sm" />
          </div>
          <h1 className="page-hero font-heading text-3xl sm:text-4xl font-bold tracking-tight text-foreground leading-[1.05]">
            Signing session
          </h1>
          <p className="console-hide mt-3 text-foreground-muted leading-relaxed max-w-md">
            Review the transaction the coordinator sends. Approve in your
            wallet to add your signature.
          </p>
        </header>

        {/* Slim StepProgress + countdown row. Lifts the wizard state
            out of the header card (which doesn't exist anymore) and
            puts it just above the active-phase block. Share button
            sits inline rather than competing with H1 for attention. */}
        {isInActiveSession && (
          <div className="mb-10 flex items-center justify-between gap-4 flex-wrap">
            <StepProgress
              steps={[
                { key: 'wallet', label: 'Connect' },
                { key: 'join', label: 'Join' },
                { key: 'waiting', label: 'Waiting' },
                { key: 'sign', label: 'Sign' },
                { key: 'complete', label: 'Done' },
              ]}
              currentIndex={
                currentStep === 'wallet-connect' ? 0 :
                currentStep === 'session-connect' || currentStep === 'ready' ? 1 :
                currentStep === 'waiting' ? 2 :
                currentStep === 'reviewing' || currentStep === 'signing' ? 3 :
                currentStep === 'signed' || currentStep === 'completed' ? 4 : 0
              }
            />
            <div className="flex items-center gap-3">
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
              {showShareButton && (
                <button
                  onClick={() => setShowShareDialog(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-foreground-muted hover:text-foreground hover:bg-surface-recessed transition-colors"
                  title="Share session with other participants"
                >
                  <Icon name="share" size={14} />
                  Share
                </button>
              )}
            </div>
          </div>
        )}

        {/* Inline error banner — left-border treatment matches the trust
            panels on /join. No bordered card; severity carried by color
            and the bold opening sentence. */}
        {errorMessage && (
          <div role="alert" className="mb-8 flex items-start gap-3 border-l-2 border-destructive bg-destructive-soft pl-4 py-3 text-sm rounded-r-md">
            <Icon name="error_outline" size={20} className="text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-destructive-soft-fg">Error</p>
              <p className="text-destructive-soft-fg/90">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Connection panel — replaces WalletStatus + Session Status
            cards with one flat <dl>. Only renders when there's
            something meaningful to show (wallet initialized + active
            session, or wallet-connect step's "not connected" state). */}
        {wallet.isInitialized && (currentStep !== 'wallet-connect' || !wallet.isConnected) && (
          <ConnectionPanel
            wallet={wallet}
            sessionInfoData={signingSession.state.sessionInfo}
            connected={signingSession.state.connected}
            participantStatus={signingSession.state.status}
          />
        )}

        {/* Wallet-connect sub-states */}
        {currentStep === 'wallet-connect' && !wallet.isInitialized && (
          <div className="mt-8">
            <PhaseStatus
              icon="hourglass_empty"
              title="Standby — checking session"
              body="Looking for a paired wallet. This is usually instant."
            />
          </div>
        )}

        {currentStep === 'wallet-connect' && wallet.isInitialized && wallet.isConnected && (
          <div className="mt-8">
            <ConnectingBanner accountId={wallet.accountId} />
          </div>
        )}

        {currentStep === 'wallet-connect' && wallet.isInitialized && !wallet.isConnected && (
          <div className="mt-8 space-y-6">
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-foreground hover:text-accent transition-colors">
                What&apos;s about to happen?
              </summary>
              <ol className="console-checklist mt-3 ml-1 space-y-2 text-foreground-muted list-decimal list-inside">
                <li>Connect your Hedera wallet (HashPack, Blade, or Kabila).</li>
                <li>Wait for the coordinator to inject a transaction — usually within a few minutes.</li>
                <li>Review the transaction details. You&apos;ll see exactly what you&apos;re being asked to sign — type, amounts, recipients, contract calls.</li>
                <li>Approve or reject. If you approve, your wallet asks for confirmation. Your private key never leaves your device.</li>
              </ol>
            </details>
            <PhaseStatus
              icon="account_balance_wallet"
              title="Connect your Hedera wallet"
              body="Choose HashPack, Blade, or Kabila. Your private key stays in the wallet — only the signature comes back to the dApp."
              action={
                <button
                  onClick={handleConnectWallet}
                  disabled={wallet.isConnecting}
                  className="cmd inline-flex items-center justify-center px-6 py-3 rounded-md text-base font-semibold bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {wallet.isConnecting ? 'Connecting…' : 'Connect Wallet'}
                  <span className="treasury-label ml-2 opacity-70">→</span>
                </button>
              }
            />
            {wallet.error && (
              <p role="alert" className="text-sm text-destructive">{wallet.error}</p>
            )}
          </div>
        )}

        {/* AUTH gap banner — WebSocket round-trip + eligibility check
            is otherwise dead air. Unmounts on AUTH_SUCCESS. */}
        {currentStep === 'session-connect' && !signingSession.state.connected && (
          <div className="mt-8">
            <ConnectingBanner accountId={wallet.accountId} />
          </div>
        )}

        {/* Phase-aware body. Single persistent surface that swaps
            icon/title/body/action by currentStep, replacing three
            previously-identical centered-card templates (waiting,
            signing, completed). The reviewing phase delegates to
            the dedicated ScheduledReview / TransactionReview surfaces. */}
        {currentStep === 'waiting' && (
          <div className="mt-8">
            <PhaseStatus
              icon="schedule"
              title="Waiting for transaction"
              body="The coordinator will inject a transaction shortly. You can leave this tab open — we'll show it the moment it arrives."
            />
          </div>
        )}

        {currentStep === 'reviewing' && signingSession.state.schedule && (
          <div className="mt-8">
            <ScheduledReview
              scheduleId={signingSession.state.schedule.scheduleId}
              expirationTime={signingSession.state.schedule.expirationTime}
              scheduleMemo={signingSession.state.schedule.scheduleMemo}
              payerAccountId={signingSession.state.schedule.payerAccountId}
              adminKey={signingSession.state.schedule.adminKey}
              innerTxDetails={signingSession.state.schedule.innerTxDetails as Record<string, unknown> | null}
              network={DEFAULT_NETWORK as 'testnet' | 'mainnet'}
              onApprove={handleApprove}
              onReject={handleReject}
              disabled={false}
            />
          </div>
        )}
        {currentStep === 'reviewing' && !signingSession.state.schedule && signingSession.state.transaction.frozenTransaction && (
          <div className="mt-8">
            <TransactionReview
              frozenTransactionBase64={signingSession.state.transaction.frozenTransaction.base64}
              metadata={signingSession.state.transaction.metadata || undefined}
              contractInterface={signingSession.state.transaction.contractInterface}
              onApprove={handleApprove}
              onReject={handleReject}
              disabled={false}
            />
          </div>
        )}

        {currentStep === 'signing' && (
          <div className="mt-8">
            <PhaseStatus
              icon="edit"
              title="Approve in your wallet"
              body="Your wallet popup is asking for the signature. The dApp continues once you approve."
            />
          </div>
        )}

        {currentStep === 'signed' && signedTransactionId && (
          <div className="mt-8">
            <PostSigningStatus
              transactionId={signedTransactionId}
              transactionDetails={signedTransactionDetails}
              network={DEFAULT_NETWORK as 'testnet' | 'mainnet'}
              onClear={handleClearPostSigning}
            />
          </div>
        )}

        {currentStep === 'completed' && (
          <div className="mt-8">
            <PhaseStatus
              icon="check_circle"
              title="Transaction executed"
              body="The multi-signature transaction is confirmed on the Hedera network."
              tone="success"
              action={
                <>
                  <button
                    onClick={handleClearPostSigning}
                    className="cmd inline-flex items-center justify-center px-6 py-3 rounded-md text-base font-semibold bg-accent text-accent-fg hover:bg-accent-hover transition-colors"
                  >
                    Wait for next transaction
                    <span className="treasury-label ml-2 opacity-70">→</span>
                  </button>
                  <button
                    onClick={() => router.push('/')}
                    className="text-sm text-foreground-muted hover:text-foreground transition-colors"
                  >
                    Return home
                  </button>
                  <button
                    onClick={() => router.push('/join')}
                    className="text-sm text-foreground-muted hover:text-foreground transition-colors"
                  >
                    Join another session
                  </button>
                </>
              }
            />
          </div>
        )}

        {/* Signature progress + participant list. Sub-components
            still have their own card chrome internally — flagged
            for follow-up flatten pass. */}
        {(currentStep === 'waiting' || currentStep === 'reviewing' || currentStep === 'signing' || currentStep === 'signed' || currentStep === 'completed') && (
          <div className="mt-10 space-y-6">
            <SignatureProgress
              signaturesCollected={signingSession.state.stats.signaturesCollected}
              signaturesRequired={signingSession.state.stats.signaturesRequired}
              participantsConnected={signingSession.state.stats.participantsConnected}
              participantsReady={signingSession.state.stats.participantsReady}
              participantsExpected={signingSession.state.stats.participantsExpected}
              thresholdMet={currentStep === 'completed'}
            />
            {(currentStep === 'waiting' || currentStep === 'reviewing' || currentStep === 'signing' || currentStep === 'signed') && (
              <ParticipantList
                participants={signingSession.state.participants}
                currentParticipantId={signingSession.state.participantId}
                eligiblePublicKeys={signingSession.state.sessionInfo?.eligiblePublicKeys}
              />
            )}
          </div>
        )}

        {/* Disconnect — quiet ghost link at the bottom rather than a
            shouting button next to the H1. Only shown when there's an
            active session to disconnect from. */}
        {currentStep !== 'wallet-connect' && (
          <div className="mt-12 pt-6 border-t border-border">
            <button
              onClick={handleDisconnect}
              className="text-sm text-foreground-muted hover:text-destructive transition-colors"
            >
              Disconnect from session
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

/**
 * PhaseStatus — single persistent state-machine surface that swaps
 * icon/title/body/action by phase. Replaces three previously-
 * identical bordered "centered icon + heading + paragraph" cards
 * (waiting, signing, completed). Flat composition: icon-left,
 * content-right, action below.
 */
function PhaseStatus({ icon, title, body, action, tone = 'info' }: {
  icon: string;
  title: string;
  body: string;
  action?: React.ReactNode;
  tone?: 'info' | 'success';
}) {
  const iconColor = tone === 'success' ? 'text-success' : 'text-accent';
  return (
    <div className="flex items-start gap-4">
      <Icon name={icon} size={32} className={`${iconColor} flex-shrink-0 mt-1`} />
      <div className="flex-1 min-w-0">
        <h2 className="font-heading text-xl font-bold text-foreground mb-2">
          {title}
        </h2>
        <p className="text-foreground-muted leading-relaxed">{body}</p>
        {action && (
          <div className="mt-6 flex flex-wrap items-center gap-4">{action}</div>
        )}
      </div>
    </div>
  );
}

/**
 * ConnectionPanel — flat <dl> showing wallet + coordinator + session
 * threshold status in three-or-four rows. Replaces the WalletStatus
 * component AND the Session Status card with one consolidated block,
 * since all three are connection states (wallet→user, WS→coordinator,
 * session→threshold).
 */
function ConnectionPanel({
  wallet,
  sessionInfoData,
  connected,
  participantStatus,
}: {
  wallet: ReturnType<typeof useWallet>;
  sessionInfoData: { threshold?: number; status?: string; eligiblePublicKeys?: string[] } | null;
  connected: boolean;
  participantStatus: string;
}) {
  const walletDisplay = wallet.isConnected
    ? <><span className="font-semibold text-foreground">{wallet.accountId}</span>{wallet.publicKeyType && <span className="text-foreground-subtle"> · {wallet.publicKeyType}</span>}</>
    : wallet.isConnecting
      ? <span className="text-foreground-subtle">Connecting…</span>
      : <span className="text-foreground-subtle">Not connected</span>;

  return (
    <dl className="border-t border-border pt-6 space-y-3 text-sm">
      <Row label="Wallet" value={walletDisplay} />
      <Row
        label="Coordinator"
        value={connected
          ? <span className="text-success-soft-fg font-medium">Connected</span>
          : <span className="text-foreground-subtle">Disconnected</span>}
      />
      {participantStatus && participantStatus !== 'idle' && (
        <Row
          label="Status"
          value={<span className="text-foreground font-mono text-xs">{participantStatus}</span>}
        />
      )}
      {sessionInfoData?.threshold !== undefined && (
        <Row
          label="Threshold"
          value={<span className="text-foreground">{sessionInfoData.threshold} of {sessionInfoData.eligiblePublicKeys?.length ?? '?'} signatures required</span>}
        />
      )}
    </dl>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-32 flex-shrink-0 text-foreground-muted text-xs uppercase tracking-wider">{label}</dt>
      <dd className="text-foreground font-mono text-sm">{value}</dd>
    </div>
  );
}
