/**
 * WalletConnect Client for Hedera MultiSig dApp
 *
 * Uses @hashgraph/hedera-wallet-connect@2.0.4 with Reown AppKit
 * Provides wallet connection, status, and signing capabilities
 */

import { DAppConnector, HederaJsonRpcMethod, HederaSessionEvent, HederaChainId, type ExtensionData } from "@hashgraph/hedera-wallet-connect";
import { LedgerId, type AccountId, Transaction } from "@hashgraph/sdk";
import { type SignClientTypes } from "@walletconnect/types";
import { fetchAccountData, getCachedAccountData } from "./mirror-node";

// Import extensionQuery for manual extension discovery
// @ts-ignore - Internal API but needed for manual extension refresh
import { extensionQuery } from "@hashgraph/hedera-wallet-connect/dist/lib/shared/extensionController";

// Network configuration
const getNetwork = () => {
  const network = process.env.NEXT_PUBLIC_DEFAULT_NETWORK || 'testnet';
  return network as 'testnet' | 'mainnet';
};

// Chain ID mapping
const getChainId = () => {
  const network = getNetwork();
  switch (network) {
    case 'mainnet':
      return HederaChainId.Mainnet;
    case 'testnet':
    default:
      return HederaChainId.Testnet;
  }
};

// WalletConnect Project ID from environment
const getProjectId = () => {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (!projectId) {
    console.error('❌ NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID not set!');
    throw new Error('WalletConnect Project ID is required');
  }
  return projectId;
};

// Build dApp metadata
const getMetadata = (): SignClientTypes.Metadata => {
  const currentUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const network = getNetwork();

  return {
    name: network === 'testnet' ? 'Hedera MultiSig (Testnet)' : 'Hedera MultiSig',
    description: 'Secure multi-signature transaction signing for Hedera',
    url: currentUrl,
    icons: ['/favicon.ico'],
  };
};

// Singleton DAppConnector instance
let dappConnector: DAppConnector | null = null;
let isInitializing = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize WalletConnect/Reown
 *
 * Safe to call multiple times - will return existing initialization
 */
export const initializeWalletConnect = async (): Promise<void> => {
  // Return existing initialization if in progress
  if (initPromise) {
    return initPromise;
  }

  // Return immediately if already initialized
  if (dappConnector && !isInitializing) {
    return Promise.resolve();
  }

  isInitializing = true;

  initPromise = new Promise(async (resolve, reject) => {
    try {
      const metadata = getMetadata();
      const network = getNetwork();
      const projectId = getProjectId();
      const chainId = getChainId();

      console.log('🔌 Initializing WalletConnect v2.0.4...');
      console.log('📍 Network:', network);
      console.log('🆔 Chain ID:', chainId);
      console.log('🔑 Project ID:', projectId?.substring(0, 8) + '...');

      dappConnector = new DAppConnector(
        metadata,
        LedgerId.fromString(network),
        projectId,
        Object.values(HederaJsonRpcMethod),
        [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
        [chainId]
      );

      await dappConnector.init({ logger: 'error' });

      console.log('✅ WalletConnect initialized successfully');
      isInitializing = false;
      resolve();
    } catch (error) {
      console.error('❌ WalletConnect initialization failed:', error);
      isInitializing = false;
      initPromise = null;
      reject(error);
    }
  });

  return initPromise;
};

/**
 * Trigger manual extension discovery
 *
 * Call this to re-query for wallet extensions.
 * Useful when extensions load after initial page load.
 */
export const refreshExtensions = (): void => {
  if (typeof window === 'undefined') return;

  console.log('🔄 Manually triggering extension discovery...');
  extensionQuery();
};

/**
 * Get available wallet extensions (HashPack, Blade, etc.)
 *
 * Deduplicates by extension ID (extensions can be added multiple times by the library)
 */
export const getAvailableExtensions = (): ExtensionData[] => {
  if (!dappConnector) {
    console.warn('DAppConnector not initialized');
    return [];
  }

  const available = dappConnector.extensions?.filter(ext => ext.available) || [];

  // Deduplicate by extension ID (library can add same extension multiple times)
  const seen = new Set<string>();
  return available.filter(ext => {
    if (seen.has(ext.id)) {
      return false;
    }
    seen.add(ext.id);
    return true;
  });
};

/**
 * Connect to wallet by extension ID or via QR code callback
 *
 * @param extensionId - Optional extension ID (e.g., 'hashpack'). If not provided, uses QR code flow
 * @param onUri - Optional callback when URI is generated (for custom QR code display)
 */
export const connectWallet = async (extensionId?: string, onUri?: (uri: string) => void): Promise<void> => {
  await initializeWalletConnect();

  if (!dappConnector) {
    throw new Error('DAppConnector failed to initialize');
  }

  if (extensionId) {
    // Connect to specific extension (HashPack, Blade, etc.)
    console.log('🔌 Connecting to extension:', extensionId);
    await dappConnector.connectExtension(extensionId);
  } else if (onUri) {
    // Custom QR code flow - caller provides URI callback
    console.log('🔌 Starting WalletConnect pairing with custom QR...');
    await dappConnector.connect((uri) => {
      console.log('📱 WalletConnect URI generated');
      onUri(uri);
    });
  } else {
    // Fallback: Open WalletConnect modal (QR code for mobile wallets)
    console.log('🔌 Opening WalletConnect modal');
    await dappConnector.openModal();
  }
};

/**
 * Disconnect from wallet
 */
export const disconnectWallet = async (): Promise<void> => {
  if (!dappConnector) {
    console.warn('DAppConnector not initialized');
    return;
  }

  // Check if there are any active sessions/signers before trying to disconnect
  if (dappConnector.signers.length === 0) {
    console.log('🔌 No active wallet session to disconnect');
    return;
  }

  console.log('🔌 Disconnecting wallet');
  try {
    await dappConnector.disconnectAll();
  } catch (err) {
    // If disconnect fails (e.g., session already expired), just log and continue
    console.warn('Disconnect warning (session may already be closed):', err);
  }
};

/**
 * Get connected account ID
 */
export const getAccountId = (): string | null => {
  if (!dappConnector || dappConnector.signers.length === 0) {
    return null;
  }

  return dappConnector.signers[0]?.getAccountId()?.toString() || null;
};

/**
 * Get connected account's public key
 *
 * Gets public key from mirror node cache (populated after connection)
 */
export const getPublicKey = (): string | null => {
  if (!dappConnector || dappConnector.signers.length === 0) {
    return null;
  }

  try {
    const signer = dappConnector.signers[0];
    const accountId = signer.getAccountId()?.toString();

    if (!accountId) {
      return null;
    }

    // Get from cached mirror node data
    const cached = getCachedAccountData(accountId);
    if (cached && cached.publicKey) {
      return cached.publicKey;
    }

    return null;
  } catch (error) {
    console.error('Error getting public key:', error);
    return null;
  }
};

/**
 * Check if wallet is connected
 */
export const isConnected = (): boolean => {
  return dappConnector !== null && dappConnector.signers.length > 0;
};

/**
 * Get connected account balance
 *
 * @returns Balance as formatted string (e.g., "1.2 ℏ") or null
 */
export const getBalance = (): string | null => {
  if (!dappConnector || dappConnector.signers.length === 0) {
    return null;
  }

  try {
    const accountId = dappConnector.signers[0]?.getAccountId()?.toString();
    if (!accountId) {
      return null;
    }

    const cached = getCachedAccountData(accountId);
    return cached?.balance || null;
  } catch (error) {
    console.error('Error getting balance:', error);
    return null;
  }
};

/**
 * Get connected account EVM address
 *
 * @returns EVM address (0x...) or null
 */
export const getEvmAddress = (): string | null => {
  if (!dappConnector || dappConnector.signers.length === 0) {
    return null;
  }

  try {
    const accountId = dappConnector.signers[0]?.getAccountId()?.toString();
    if (!accountId) {
      return null;
    }

    const cached = getCachedAccountData(accountId);
    return cached?.evmAddress || null;
  } catch (error) {
    console.error('Error getting EVM address:', error);
    return null;
  }
};

/**
 * Get connected account public key type
 *
 * @returns Key type (e.g., "ED25519", "ECDSA_SECP256K1") or null
 */
export const getPublicKeyType = (): string | null => {
  if (!dappConnector || dappConnector.signers.length === 0) {
    return null;
  }

  try {
    const accountId = dappConnector.signers[0]?.getAccountId()?.toString();
    if (!accountId) {
      return null;
    }

    const cached = getCachedAccountData(accountId);
    return cached?.publicKeyType || null;
  } catch (error) {
    console.error('Error getting public key type:', error);
    return null;
  }
};

/**
 * Fetch account data from mirror node after connection
 *
 * Call this after connecting to populate public key and balance
 */
export const fetchConnectedAccountData = async (): Promise<void> => {
  if (!dappConnector || dappConnector.signers.length === 0) {
    console.warn('No connected wallet to fetch data for');
    return;
  }

  try {
    const accountId = dappConnector.signers[0]?.getAccountId()?.toString();
    if (!accountId) {
      console.warn('No account ID available');
      return;
    }

    const network = getNetwork();
    console.log(`Fetching account data for ${accountId} on ${network}`);

    await fetchAccountData(accountId, network);
  } catch (error) {
    console.error('Failed to fetch account data from mirror node:', error);
    // Don't throw - this is optional enrichment
  }
};

/**
 * Sign transaction with connected wallet
 *
 * @param transactionBytes - Frozen transaction bytes
 * @returns Signature result from wallet
 */
export const signTransaction = async (transactionBytes: Uint8Array): Promise<any> => {
  if (!dappConnector) {
    throw new Error('Wallet not connected');
  }

  const signers = dappConnector.signers;
  if (!signers || signers.length === 0) {
    throw new Error('No signers available');
  }

  const signer = signers[0];

  // Convert bytes to Transaction for signing
  const transaction = Transaction.fromBytes(transactionBytes);

  // Use signer.signTransaction (does NOT execute, only signs)
  const signedTx = await signer.signTransaction(transaction);

  return { result: signedTx.toBytes() };
};

/**
 * Get DAppConnector instance (for advanced usage)
 */
export const getDAppConnector = (): DAppConnector | null => {
  return dappConnector;
};

// Export types for convenience
export type { ExtensionData };
