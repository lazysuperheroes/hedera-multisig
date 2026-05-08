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
              .map((p) => ({
                id: p.participantId,
                publicKey: p.publicKey || null,
                status:
                  p.status === 'rejected'
                    ? 'disconnected' // protocol distinguishes; UI lumps both as inactive
                    : (p.status as Participant['status']),
                label: p.label || undefined,
                joinedAt: p.connectedAt || Date.now(),
              }))
          : [];

      setState((prev) => ({
        ...prev,
        status: 'connected',
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
      setState((prev) => ({
        ...prev,
        status: 'reviewing',
        transaction: {
          frozenTransaction: data.frozenTransaction,
          txDetails: data.txDetails,
          metadata: data.metadata || null,
          contractInterface: data.contractInterface || null,
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
      // Clear transaction state and reset to ready status
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
          };
        } else {
          // Add new participant
          updatedParticipants = [
            ...prev.participants,
            {
              id: data.participantId,
              publicKey: null,
              status: 'connected',
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
      reconnectionToken?: string
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
          reconnectionToken
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
