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
  error: string | null;
  connected: boolean;
}

export function useSigningSession(options: UseSigningSessionOptions = {}) {
  const clientRef = useRef<BrowserSigningClient | null>(null);
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
    error: null,
    connected: false,
  });

  // Initialize client
  useEffect(() => {
    if (!clientRef.current) {
      clientRef.current = new BrowserSigningClient({
        verbose: options.verbose !== false,
        label: options.label,
      });

      // Register event handlers
      clientRef.current.on('connected', (data) => {
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
        setState((prev) => ({
          ...prev,
          status: 'ready',
        }));
      });

      clientRef.current.on('transactionReceived', (data) => {
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
        setState((prev) => ({
          ...prev,
          status: 'signed',
        }));
      });

      clientRef.current.on('signatureAccepted', (data) => {
        setState((prev) => ({
          ...prev,
          stats: {
            ...prev.stats,
            signaturesCollected: data.signaturesCollected,
          },
        }));
      });

      clientRef.current.on('thresholdMet', (data) => {
        setState((prev) => ({
          ...prev,
          stats: {
            ...prev.stats,
            signaturesCollected: data.signaturesCollected,
          },
        }));
      });

      clientRef.current.on('transactionExecuted', (data) => {
        setState((prev) => ({
          ...prev,
          status: 'completed',
        }));
      });

      clientRef.current.on('participantReady', (data) => {
        setState((prev) => ({
          ...prev,
          stats: {
            ...prev.stats,
            participantsConnected: data.stats.participantsConnected,
            participantsReady: data.stats.participantsReady,
          },
        }));
      });

      clientRef.current.on('sessionExpired', () => {
        setState((prev) => ({
          ...prev,
          status: 'disconnected',
          connected: false,
          error: 'Session expired',
        }));
      });

      clientRef.current.on('error', (data) => {
        setState((prev) => ({
          ...prev,
          error: data.message,
        }));
      });

      clientRef.current.on('disconnected', () => {
        setState((prev) => ({
          ...prev,
          status: 'disconnected',
          connected: false,
        }));
      });
    }

    // Cleanup
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
    };
  }, [options.verbose, options.label]);

  // Connect to session
  const connect = useCallback(
    async (serverUrl: string, sessionId: string, pin: string, publicKey?: string) => {
      if (!clientRef.current) {
        throw new Error('Client not initialized');
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
    []
  );

  // Set ready (after wallet connection)
  const setReady = useCallback((publicKey: string) => {
    if (!clientRef.current) {
      throw new Error('Client not initialized');
    }

    clientRef.current.setReady(publicKey);
  }, []);

  // Submit signature
  const submitSignature = useCallback((publicKey: string, signature: string) => {
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
