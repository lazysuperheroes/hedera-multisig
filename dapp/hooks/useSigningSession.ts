/**
 * useSigningSession Hook
 *
 * React hook for managing signing session WebSocket connection.
 * Wraps BrowserSigningClient for easy use in React components.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserSigningClient } from '../lib/websocket-client';
import type {
  SigningClientStatus,
  SessionInfo,
  TransactionDetails,
} from '../types/protocol';

export interface UseSigningSessionOptions {
  verbose?: boolean;
  autoReconnect?: boolean;
  label?: string;
}

export interface Participant {
  id: string;
  publicKey: string | null;
  status: 'connected' | 'ready' | 'signed' | 'disconnected';
  label?: string;
  joinedAt: number;
}

export interface SigningSessionState {
  status: SigningClientStatus;
  participantId: string | null;
  sessionInfo: SessionInfo | null;
  transaction: {
    frozenTransaction: { base64: string; bytes?: Uint8Array } | null;
    txDetails: TransactionDetails | null;
    metadata: Record<string, unknown> | null;
    contractInterface: unknown | null;
  };
  /**
   * HIP-423 scheduled-tx context. Populated by AUTH_SUCCESS (for late
   * joiners) or by the SCHEDULE_CREATED broadcast (for participants
   * connected at announcement time). Null in real-time ceremonies —
   * the existing `transaction` slot is what realtime signers care about.
   * Sessions don't change mode mid-flight; mode is set at the first
   * inject/announce and stays put.
   */
  schedule: {
    scheduleId: string;
    expirationTime: number | null; // seconds since epoch
    scheduleMemo: string | null;
    payerAccountId: string | null;
    adminKey: string | null;
    innerTxDetails: TransactionDetails | Record<string, unknown> | null;
    innerTxBase64: string | null;
    abi?: unknown;
  } | null;
  stats: {
    participantsConnected: number;
    participantsReady: number;
    /**
     * How many participants the session expects in total (set at
     * session creation via `--participants` / `expectedParticipants`).
     * Surfaces in the UI as the denominator on "X/Y connected" so the
     * user has context for whether more signers are still expected.
     */
    participantsExpected: number;
    signaturesCollected: number;
    signaturesRequired: number;
  };
  participants: Participant[];
  error: string | null;
  connected: boolean;
}

export function useSigningSession(options: UseSigningSessionOptions = {}) {
  const clientRef = useRef<BrowserSigningClient | null>(null);
  const cleanupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const [state, setState] = useState<SigningSessionState>({
    status: 'disconnected',
    participantId: null,
    sessionInfo: null,
    transaction: {
      frozenTransaction: null,
      txDetails: null,
      metadata: null,
      contractInterface: null,
    },
    schedule: null,
    stats: {
      participantsConnected: 0,
      participantsReady: 0,
      participantsExpected: 0,
      signaturesCollected: 0,
      signaturesRequired: 0,
    },
    participants: [],
    error: null,
    connected: false,
  });

  // Initialize client
  useEffect(() => {
    // Cancel any pending cleanup from previous mount cycle (React StrictMode)
    if (cleanupTimeoutRef.current) {
      clearTimeout(cleanupTimeoutRef.current);
      cleanupTimeoutRef.current = null;
    }

    isMountedRef.current = true;

    // If client already exists (StrictMode remount), sync state from client
    if (clientRef.current) {
      const status = clientRef.current.getStatus();
      const sessionInfo = clientRef.current.getSessionInfo();
      const participantId = clientRef.current.getParticipantId();

      console.log('useSigningSession: Syncing state from existing client, status:', status);

      if (sessionInfo) {
        setState((prev) => ({
          ...prev,
          status,
          connected: true, // If we have sessionInfo, we're connected
          participantId,
          sessionInfo,
          stats: {
            participantsConnected: sessionInfo.stats?.participantsConnected || 0,
            participantsReady: sessionInfo.stats?.participantsReady || 0,
            participantsExpected: sessionInfo.stats?.participantsExpected || sessionInfo.expectedParticipants || 0,
            signaturesCollected: sessionInfo.stats?.signaturesCollected || 0,
            signaturesRequired: sessionInfo.threshold,
          },
          error: null,
        }));
      }

      // Return cleanup function for existing client
      return () => {
        isMountedRef.current = false;
        cleanupTimeoutRef.current = setTimeout(() => {
          if (clientRef.current) {
            clientRef.current.disconnect();
            clientRef.current = null;
          }
        }, 100);
      };
    }

    // Create new client if none exists
    clientRef.current = new BrowserSigningClient({
      verbose: options.verbose !== false,
      label: options.label,
    });

    // Register event handlers
    clientRef.current.on('connected', (data) => {
      if (!isMountedRef.current) return;

      // Seed `state.participants` from the AUTH_SUCCESS snapshot.
      // PARTICIPANT_CONNECTED broadcasts only fire for FUTURE arrivals,
      // so a participant who joins after others would otherwise never
      // see them in the list — the top counter would say "2/3 connected"
      // but the row list would show only the current user. The server
      // includes a `participants` array in sessionInfo precisely so the
      // late joiner can backfill. We exclude self (added separately by
      // PARTICIPANT_CONNECTED if/when the server broadcasts it, or
      // simply absent from the visible list which is the existing
      // convention for the current user's row).
      const seededParticipants: Participant[] =
        Array.isArray(data.sessionInfo.participants)
          ? data.sessionInfo.participants
              .filter((p) => p.participantId !== data.participantId)
              .map((p) => {
                // Server preserves 'signed' / 'rejected' across ceremonies
                // so the threshold count remains accurate when a tx
                // completes and a new one is injected. But when there's
                // NO active transaction (sessionInfo.status === 'waiting')
                // those badges are nonsensical from the user's POV —
                // nobody can have signed a transaction that doesn't
                // exist. Downgrade stale 'signed' → 'ready' and
                // 'rejected' → 'disconnected' (the latter matching the
                // existing UI convention for inactive participants).
                const sessionWaiting = data.sessionInfo.status === 'waiting';
                let status: Participant['status'];
                if (p.status === 'rejected') {
                  status = 'disconnected';
                } else if (sessionWaiting && p.status === 'signed') {
                  status = 'ready';
                } else {
                  status = p.status as Participant['status'];
                }
                return {
                  id: p.participantId,
                  publicKey: p.publicKey || null,
                  status,
                  label: p.label || undefined,
                  joinedAt: p.connectedAt || Date.now(),
                };
              })
          : [];

      // Seed `state.schedule` from the AUTH_SUCCESS sessionInfo for
      // late joiners on a scheduled session. The server stamps these
      // fields onto `getSessionInfo` once a SCHEDULE_ANNOUNCE arrives,
      // so a participant who connects AFTER the schedule was created
      // gets the context inline rather than waiting for a re-broadcast
      // (which never fires).
      const sched = data.sessionInfo.scheduleId
        ? {
            scheduleId: data.sessionInfo.scheduleId,
            expirationTime: data.sessionInfo.scheduleExpirationTime ?? null,
            scheduleMemo: data.sessionInfo.scheduleMemo ?? null,
            payerAccountId: data.sessionInfo.schedulePayerAccountId ?? null,
            adminKey: data.sessionInfo.scheduleAdminKey ?? null,
            innerTxDetails: data.sessionInfo.innerTxDetails ?? null,
            innerTxBase64: data.sessionInfo.innerTxBase64 ?? null,
          }
        : null;

      setState((prev) => ({
        ...prev,
        status: sched ? 'reviewing' : 'connected',
        connected: true,
        participantId: data.participantId,
        sessionInfo: data.sessionInfo,
        stats: {
          participantsConnected: data.sessionInfo.stats?.participantsConnected || 0,
          participantsReady: data.sessionInfo.stats?.participantsReady || 0,
          participantsExpected:
            data.sessionInfo.stats?.participantsExpected ||
            data.sessionInfo.expectedParticipants ||
            0,
          signaturesCollected: data.sessionInfo.stats?.signaturesCollected || 0,
          signaturesRequired: data.sessionInfo.threshold,
        },
        participants: seededParticipants,
        schedule: sched,
        error: null,
      }));
    });

    clientRef.current.on('ready', () => {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        status: 'ready',
      }));
    });

    clientRef.current.on('transactionReceived', (data) => {
      if (!isMountedRef.current) return;

      // Reconstruct the ethers Interface from the wire-canonical `abi`
      // array (JSON-serializable list of fragment strings) the server
      // sends. ethers.Interface objects don't survive JSON.stringify,
      // so the server can't ship the rich form directly; it ships
      // `abi` and clients rebuild. Falls back to a legacy
      // `contractInterface` field if some caller still sets it.
      // Without this rebuild, contract-call transactions show up in
      // TransactionReview as "No ABI — Unverifiable" even when the
      // CLI side gets the full "increment() ✓ ABI verified" view from
      // the same broadcast — the data is on the wire, the dApp just
      // wasn't looking at the right field.
      const dataWithAbi = data as typeof data & { abi?: unknown };
      let reconstructedInterface: unknown = data.contractInterface || null;
      if (!reconstructedInterface && Array.isArray(dataWithAbi.abi) && dataWithAbi.abi.length > 0) {
        try {
          // Lazy-import ethers so the browser bundle only pulls it in
          // when a contract-call tx actually arrives. ethers exposes
          // both new-style (`Interface`) and legacy (`utils.Interface`)
          // surfaces; the v6 import shape is `import { Interface }`.
          // We use a dynamic import to keep the hook async-safe and
          // avoid a top-level dependency. Fire-and-forget into
          // setState — by the time review renders, contractInterface
          // will be populated. (TransactionReview's effect re-runs on
          // its prop change.)
          import('ethers').then((ethersMod) => {
            try {
              const iface = new ethersMod.Interface(dataWithAbi.abi as string[]);
              setState((prev) => ({
                ...prev,
                transaction: {
                  ...prev.transaction,
                  contractInterface: iface,
                },
              }));
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('[multisig] ABI reconstruction failed:', (err as Error).message);
            }
          }).catch(() => { /* ethers unavailable; review falls back to "No ABI" */ });
        } catch {
          reconstructedInterface = null;
        }
      }

      setState((prev) => ({
        ...prev,
        status: 'reviewing',
        transaction: {
          frozenTransaction: data.frozenTransaction,
          txDetails: data.txDetails,
          metadata: data.metadata || null,
          contractInterface: reconstructedInterface,
        },
        // Reset stale per-transaction status from any previous
        // ceremony in this session. The server's clearTransactionState
        // already does this server-side (signatures Map cleared,
        // signed/rejected → ready), but the dApp's
        // state.participants[i].status doesn't auto-reset, so a row
        // that was "Signed" from the previous tx kept that green badge
        // against the new tx until the next PARTICIPANT_STATUS_UPDATE
        // landed. Mirror the server's reset rule: signed → ready.
        // Disconnected stays disconnected (they're filtered from the
        // visible list by ParticipantList anyway).
        participants: prev.participants.map((p) =>
          p.status === 'signed' ? { ...p, status: 'ready' as const } : p,
        ),
      }));
    });

    // HIP-423 scheduled-tx broadcast. Coordinator already submitted
    // ScheduleCreate to the network; we just need to track scheduleId
    // + expiration so the UI can render the long-window review screen.
    // Distinct from transactionReceived (no frozen-tx body to verify;
    // signing happens via ScheduleSignTransaction submitted directly
    // to the network, not over WebSocket).
    clientRef.current.on('scheduleCreated', (data) => {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        status: 'reviewing',
        schedule: {
          scheduleId: data.scheduleId,
          expirationTime: data.expirationTime ?? null,
          scheduleMemo: data.scheduleMemo ?? null,
          payerAccountId: data.payerAccountId ?? null,
          adminKey: data.adminKey ?? null,
          innerTxDetails: data.innerTxDetails ?? null,
          innerTxBase64: data.innerTxBase64 ?? null,
          abi: data.abi,
        },
        // Don't touch the realtime `transaction` slot — sessions
        // don't change mode mid-flight, and a stray frozen-tx blob
        // here would confuse the review screen's mode detection.
      }));
    });

    clientRef.current.on('signed', () => {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        status: 'signed',
      }));
    });

    // Broadcast notification when ANY participant has signed (server
    // sends SIGNATURE_RECEIVED to every connected client). Flip the
    // matching row to "signed" so the participant list goes green
    // alongside the signature counter incrementing. Without this the
    // CLI signer's row stayed "Ready" forever in the dApp.
    clientRef.current.on('signatureReceived', (data) => {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        stats: {
          ...prev.stats,
          participantsConnected:
            data.stats?.participantsConnected ?? prev.stats.participantsConnected,
          participantsReady:
            data.stats?.participantsReady ?? prev.stats.participantsReady,
          participantsExpected:
            data.stats?.participantsExpected ?? prev.stats.participantsExpected,
          signaturesCollected:
            data.stats?.signaturesCollected ?? prev.stats.signaturesCollected,
          signaturesRequired:
            data.stats?.signaturesRequired ?? prev.stats.signaturesRequired,
        },
        participants: prev.participants.map((p) =>
          p.id === data.participantId ? { ...p, status: 'signed' as const } : p,
        ),
      }));
    });

    clientRef.current.on('rejected', () => {
      if (!isMountedRef.current) return;
      // A rejection (local or remote) aborts the whole ceremony. The
      // server has already reset the per-tx state on its end and is
      // broadcasting PARTICIPANT_STATUS_UPDATE for any 'signed' rows
      // it just demoted, but apply the same reset locally so the UI
      // is consistent in the same render pass — no flash of "1/2
      // signatures collected" against a tx the session already
      // canceled, no stale "Bob: Signed" badge.
      setState((prev) => ({
        ...prev,
        status: 'ready',
        transaction: {
          frozenTransaction: null,
          txDetails: null,
          metadata: null,
          contractInterface: null,
        },
        stats: {
          ...prev.stats,
          signaturesCollected: 0,
        },
        participants: prev.participants.map((p) =>
          p.status === 'signed' ? { ...p, status: 'ready' as const } : p,
        ),
      }));
    });

    clientRef.current.on('transactionExpired', () => {
      if (!isMountedRef.current) return;
      // Clear transaction state and reset to ready status
      console.log('Transaction expired - resetting state');
      setState((prev) => ({
        ...prev,
        status: 'ready',
        transaction: {
          frozenTransaction: null,
          txDetails: null,
          metadata: null,
          contractInterface: null,
        },
      }));
    });

    clientRef.current.on('signatureAccepted', (data) => {
      if (!isMountedRef.current) return;
      setState((prev) => {
        // Update participant status to 'signed' if we have their public key
        const updatedParticipants = prev.participants.map((p) =>
          p.publicKey === data.publicKey ? { ...p, status: 'signed' as const } : p
        );

        return {
          ...prev,
          stats: {
            ...prev.stats,
            signaturesCollected: data.signaturesCollected,
          },
          participants: updatedParticipants,
        };
      });
    });

    clientRef.current.on('thresholdMet', (data) => {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        stats: {
          ...prev.stats,
          signaturesCollected: data.signaturesCollected,
        },
      }));
    });

    clientRef.current.on('transactionExecuted', (data) => {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        status: 'completed',
      }));
    });

    clientRef.current.on('participantConnected', (data) => {
      if (!isMountedRef.current) return;
      setState((prev) => {
        // Check if participant already exists (reconnection case)
        const existingIndex = prev.participants.findIndex((p) => p.id === data.participantId);
        let updatedParticipants: Participant[];

        if (existingIndex >= 0) {
          // Update existing participant
          updatedParticipants = [...prev.participants];
          updatedParticipants[existingIndex] = {
            ...updatedParticipants[existingIndex],
            status: 'connected',
            // Refresh label too — the server's broadcast carries it
            // and a participant's display name might have just been
            // set on a fresh AUTH (e.g. they reconnected with --label).
            label: data.label || updatedParticipants[existingIndex].label,
          };
        } else {
          // Add new participant
          updatedParticipants = [
            ...prev.participants,
            {
              id: data.participantId,
              publicKey: null,
              status: 'connected',
              label: data.label || undefined,
              joinedAt: Date.now(),
            },
          ];
        }

        return {
          ...prev,
          stats: {
            ...prev.stats,
            participantsConnected: data.stats.participantsConnected,
            participantsReady: data.stats.participantsReady,
            participantsExpected: data.stats.participantsExpected ?? prev.stats.participantsExpected,
          },
          participants: updatedParticipants,
        };
      });
    });

    clientRef.current.on('participantReady', (data) => {
      if (!isMountedRef.current) return;
      setState((prev) => {
        // Update participant with their public key and ready status
        const updatedParticipants = prev.participants.map((p) =>
          p.id === data.participantId
            ? { ...p, publicKey: data.publicKey || null, status: 'ready' as const }
            : p
        );

        // If participant wasn't in list (edge case), add them
        const participantExists = prev.participants.some((p) => p.id === data.participantId);
        if (!participantExists && data.publicKey) {
          updatedParticipants.push({
            id: data.participantId,
            publicKey: data.publicKey,
            status: 'ready',
            joinedAt: Date.now(),
          });
        }

        return {
          ...prev,
          stats: {
            ...prev.stats,
            participantsConnected: data.stats.participantsConnected,
            participantsReady: data.stats.participantsReady,
            participantsExpected: data.stats.participantsExpected ?? prev.stats.participantsExpected,
          },
          participants: updatedParticipants,
        };
      });
    });

    clientRef.current.on('participantDisconnected', (data) => {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        // Sync stats from the server's disconnect payload — without
        // this, the SignatureProgress count stayed stale when a
        // participant left, contributing to the perceived mismatch
        // between the top counter and the bottom row count.
        stats: data.stats
          ? {
              ...prev.stats,
              participantsConnected: data.stats.participantsConnected,
              participantsReady: data.stats.participantsReady,
              participantsExpected: data.stats.participantsExpected ?? prev.stats.participantsExpected,
            }
          : prev.stats,
        participants: prev.participants.map((p) =>
          p.id === data.participantId ? { ...p, status: 'disconnected' as const } : p
        ),
      }));
    });

    clientRef.current.on('sessionExpired', () => {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        status: 'disconnected',
        connected: false,
        error: 'Session expired',
      }));
    });

    clientRef.current.on('error', (data) => {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        error: data.message,
      }));
    });

    clientRef.current.on('disconnected', () => {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        status: 'disconnected',
        connected: false,
      }));
    });

    // Cleanup - use delayed disconnect to allow React StrictMode remount cycle
    return () => {
      isMountedRef.current = false;

      // Delay disconnect to allow for StrictMode remount
      // If component remounts quickly, the timeout will be cancelled
      cleanupTimeoutRef.current = setTimeout(() => {
        if (clientRef.current) {
          clientRef.current.disconnect();
          clientRef.current = null;
        }
      }, 100);
    };
  }, [options.verbose, options.label]);

  // Connect to session.
  //
  // Pass `reconnectionToken` instead of (or alongside) `pin` when
  // re-attaching to a session that the server has previously
  // AUTH_SUCCESS'd this client into — the saved-session restore path
  // on /session/[id]/page.tsx hits this. Without the token the
  // BrowserSigningClient would AUTH with an empty PIN and the server
  // would reject for missing credentials.
  const connect = useCallback(
    async (
      serverUrl: string,
      sessionId: string,
      pin: string,
      publicKey?: string,
      reconnectionToken?: string,
      label?: string,
    ) => {
      // Recreate client if it was cleaned up
      if (!clientRef.current) {
        console.log('Recreating BrowserSigningClient after cleanup...');
        clientRef.current = new BrowserSigningClient({
          verbose: options.verbose !== false,
          label: options.label,
        });
      }

      setState((prev) => ({ ...prev, status: 'disconnected', error: null }));

      try {
        const result = await clientRef.current.connect(
          serverUrl,
          sessionId,
          pin,
          publicKey,
          reconnectionToken,
          label,
        );
        return result;
      } catch (error) {
        setState((prev) => ({
          ...prev,
          status: 'disconnected',
          error: (error as Error).message,
        }));
        throw error;
      }
    },
    [options.verbose, options.label]
  );

  // Set ready (after wallet connection)
  const setReady = useCallback((publicKey: string) => {
    if (!clientRef.current) {
      throw new Error('Client not initialized');
    }

    clientRef.current.setReady(publicKey);
  }, []);

  // Submit signature
  const submitSignature = useCallback((publicKey: string, signature: string | string[]) => {
    if (!clientRef.current) {
      throw new Error('Client not initialized');
    }

    clientRef.current.submitSignature(publicKey, signature);
  }, []);

  // Reject transaction
  const rejectTransaction = useCallback((reason: string) => {
    if (!clientRef.current) {
      throw new Error('Client not initialized');
    }

    clientRef.current.rejectTransaction(reason);
  }, []);

  // Disconnect
  const disconnect = useCallback(() => {
    if (!clientRef.current) return;

    clientRef.current.disconnect();
  }, []);

  return {
    state,
    connect,
    setReady,
    submitSignature,
    rejectTransaction,
    disconnect,
    client: clientRef.current,
  };
}

export default useSigningSession;
