/**
 * useWallet Hook
 *
 * React hook for wallet connection state and operations
 * Works with @hashgraph/hedera-wallet-connect@2.0.4
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  initializeWalletConnect,
  connectWallet,
  disconnectWallet,
  getAccountId,
  getPublicKey,
  getPublicKeyType,
  getBalance,
  getEvmAddress,
  isConnected as checkIsConnected,
  getAvailableExtensions,
  refreshExtensions as triggerExtensionQuery,
  fetchConnectedAccountData,
  type ExtensionData,
} from '../lib/walletconnect';

export interface UseWalletReturn {
  // State
  accountId: string | null;
  publicKey: string | null;
  publicKeyType: string | null;
  evmAddress: string | null;
  balance: string | null;
  isConnected: boolean;
  isInitialized: boolean;
  extensions: ExtensionData[];
  isConnecting: boolean;
  error: string | null;

  // Actions
  connect: (extensionId?: string, onUri?: (uri: string) => void) => Promise<void>;
  disconnect: () => Promise<void>;
  refreshExtensions: () => void;
}

export function useWallet(): UseWalletReturn {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [publicKeyType, setPublicKeyType] = useState<string | null>(null);
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [extensions, setExtensions] = useState<ExtensionData[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetchAttemptRef = useRef<number>(0);

  // Initialize WalletConnect on mount
  useEffect(() => {
    const init = async () => {
      try {
        await initializeWalletConnect();
        setIsInitialized(true);
        updateExtensions();
      } catch (err) {
        console.error('Failed to initialize WalletConnect:', err);
        setError('Failed to initialize wallet connection');
      }
    };

    init();
  }, []);

  // Update extensions list
  const updateExtensions = useCallback(() => {
    const available = getAvailableExtensions();
    setExtensions(available);
  }, []);

  // Refresh extensions by triggering a new query
  const refreshExtensions = useCallback(() => {
    triggerExtensionQuery();
    // Wait a bit for extensions to respond, then update
    setTimeout(() => {
      updateExtensions();
    }, 300);
  }, [updateExtensions]);

  // Poll for extensions (they may load after page load)
  useEffect(() => {
    if (!isInitialized) return;

    const interval = setInterval(() => {
      updateExtensions();
    }, 1000);

    return () => clearInterval(interval);
  }, [isInitialized, updateExtensions]);

  // Poll for connection status changes
  useEffect(() => {
    if (!isInitialized) return;

    const interval = setInterval(() => {
      const connected = checkIsConnected();
      setIsConnected(connected);

      if (connected) {
        const acctId = getAccountId();
        const pubKey = getPublicKey();
        const pubKeyType = getPublicKeyType();
        const evmAddr = getEvmAddress();
        const bal = getBalance();

        setAccountId(acctId);
        setPublicKey(pubKey);
        setPublicKeyType(pubKeyType);
        setEvmAddress(evmAddr);
        setBalance(bal);

        // If we have account but no cached data, trigger a fetch
        // Throttle: Only fetch once every 10 seconds to prevent spam
        if (acctId && (!pubKey || !evmAddr || !bal)) {
          const now = Date.now();
          if (now - lastFetchAttemptRef.current > 10000) {
            lastFetchAttemptRef.current = now;
            fetchConnectedAccountData().catch(err => {
              console.warn('Failed to refresh account data:', err);
            });
          }
        }
      } else {
        setAccountId(null);
        setPublicKey(null);
        setPublicKeyType(null);
        setEvmAddress(null);
        setBalance(null);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isInitialized]);

  // Connect to wallet
  const connect = useCallback(async (extensionId?: string, onUri?: (uri: string) => void) => {
    setIsConnecting(true);
    setError(null);

    try {
      await connectWallet(extensionId, onUri);

      // Wait a moment for connection to establish
      await new Promise(resolve => setTimeout(resolve, 500));

      const connected = checkIsConnected();
      setIsConnected(connected);

      if (connected) {
        setAccountId(getAccountId());
        setPublicKey(getPublicKey());
        setPublicKeyType(getPublicKeyType());
        setEvmAddress(getEvmAddress());
        setBalance(getBalance());

        // Fetch account data from mirror node (public key, key type, balance, EVM address)
        // This runs in background and updates cache
        fetchConnectedAccountData().catch(err => {
          console.warn('Failed to fetch account data from mirror node:', err);
          // Don't throw - this is optional enrichment
        });
      }
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
      throw err;
    } finally {
      setIsConnecting(false);
    }
  }, []);

  // Disconnect from wallet
  const disconnect = useCallback(async () => {
    setError(null);

    try {
      await disconnectWallet();
    } catch (err) {
      // Log but don't throw - disconnect should always succeed from UI perspective
      console.warn('Disconnect warning (continuing anyway):', err);
    }

    // Always clean up local state regardless of disconnectWallet result
    setAccountId(null);
    setPublicKey(null);
    setIsConnected(false);
  }, []);

  return {
    accountId,
    publicKey,
    publicKeyType,
    evmAddress,
    balance,
    isConnected,
    isInitialized,
    extensions,
    isConnecting,
    error,
    connect,
    disconnect,
    refreshExtensions,
  };
}
