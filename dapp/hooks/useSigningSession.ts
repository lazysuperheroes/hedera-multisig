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
    metadata: Record<string, any> | null;
    contractInterface: any | null;
  };
  stats: {
    participantsConnected: number;
    participantsReady: number;
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
      setState((prev) => ({
        ...prev,
        status: 'connected',
        connected: true,
        participantId: data.participantId,
        sessionInfo: data.sessionInfo,
        stats: {
          participantsConnected: data.sessionInfo.stats?.participantsConnected || 0,
          participantsReady: data.sessionInfo.stats?.participantsReady || 0,
          signaturesCollected: data.sessionInfo.stats?.signaturesCollected || 0,
          signaturesRequired: data.sessionInfo.threshold,
        },
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
      }));
    });

    clientRef.current.on('signed', () => {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        status: 'signed',
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
          },
          participants: updatedParticipants,
        };
      });
    });

    clientRef.current.on('participantDisconnected', (data) => {
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
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

  // Connect to session
  const connect = useCallback(
    async (serverUrl: string, sessionId: string, pin: string, publicKey?: string) => {
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
        const result = await clientRef.current.connect(serverUrl, sessionId, pin, publicKey);
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
