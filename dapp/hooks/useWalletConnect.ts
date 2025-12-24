/**
 * useWalletConnect Hook
 *
 * React hook for managing WalletConnect wallet connection and signing.
 * Wraps WalletConnectClient for easy use in React components.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { WalletConnectClient, WalletInfo, SignatureResult } from '../lib/walletconnect-client';

export interface UseWalletConnectOptions {
  network?: 'testnet' | 'mainnet';
  autoConnect?: boolean;
}

export interface WalletConnectState {
  connected: boolean;
  connecting: boolean;
  wallet: WalletInfo | null;
  error: string | null;
}

export function useWalletConnect(options: UseWalletConnectOptions = {}) {
  const clientRef = useRef<WalletConnectClient | null>(null);
  const [state, setState] = useState<WalletConnectState>({
    connected: false,
    connecting: false,
    wallet: null,
    error: null,
  });

  const network = options.network || 'testnet';

  // Initialize client
  useEffect(() => {
    if (!clientRef.current) {
      clientRef.current = new WalletConnectClient();

      // Register event handlers
      clientRef.current.on('disconnect', () => {
        setState((prev) => ({
          ...prev,
          connected: false,
          wallet: null,
        }));
      });

      clientRef.current.on('accountsChanged', () => {
        // Refresh wallet info when accounts change
        if (clientRef.current && clientRef.current.isConnected()) {
          const walletInfo = clientRef.current.getWalletInfo();
          setState((prev) => ({
            ...prev,
            wallet: walletInfo,
          }));
        }
      });

      clientRef.current.on('chainChanged', () => {
        console.log('Chain changed - may need to reconnect');
      });
    }

    // Cleanup
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
    };
  }, []);

  // Connect to wallet
  const connect = useCallback(async (): Promise<WalletInfo> => {
    if (!clientRef.current) {
      throw new Error('Client not initialized');
    }

    setState((prev) => ({
      ...prev,
      connecting: true,
      error: null,
    }));

    try {
      const walletInfo = await clientRef.current.connect(network);

      setState({
        connected: true,
        connecting: false,
        wallet: walletInfo,
        error: null,
      });

      return walletInfo;
    } catch (error) {
      const errorMessage = (error as Error).message;

      setState({
        connected: false,
        connecting: false,
        wallet: null,
        error: errorMessage,
      });

      throw error;
    }
  }, [network]);

  // Sign transaction
  const signTransaction = useCallback(
    async (frozenTransactionBase64: string): Promise<SignatureResult> => {
      if (!clientRef.current) {
        throw new Error('Client not initialized');
      }

      if (!state.connected) {
        throw new Error('Wallet not connected');
      }

      try {
        const result = await clientRef.current.signTransaction(frozenTransactionBase64);
        return result;
      } catch (error) {
        const errorMessage = (error as Error).message;
        setState((prev) => ({
          ...prev,
          error: errorMessage,
        }));
        throw error;
      }
    },
    [state.connected]
  );

  // Disconnect wallet
  const disconnect = useCallback(async () => {
    if (!clientRef.current) return;

    try {
      await clientRef.current.disconnect();

      setState({
        connected: false,
        connecting: false,
        wallet: null,
        error: null,
      });
    } catch (error) {
      console.error('Error disconnecting:', error);
    }
  }, []);

  // Validate network match
  const validateNetwork = useCallback(
    (sessionNetwork: string): { valid: boolean; message?: string } => {
      if (!clientRef.current) {
        return { valid: false, message: 'Client not initialized' };
      }

      return clientRef.current.validateNetwork(sessionNetwork);
    },
    []
  );

  // Clear error
  const clearError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      error: null,
    }));
  }, []);

  return {
    state,
    connect,
    signTransaction,
    disconnect,
    validateNetwork,
    clearError,
    client: clientRef.current,
  };
}

export default useWalletConnect;
