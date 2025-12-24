/**
 * WalletConnect Configuration
 *
 * Configuration for Hedera WalletConnect integration.
 * Uses @hashgraph/hedera-wallet-connect for official Hedera support.
 */

import { DAppConnector } from '@hashgraph/hedera-wallet-connect';
import { LedgerId } from '@hashgraph/sdk';

// Get WalletConnect Project ID from environment
export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';

// Get default network from environment
export const DEFAULT_NETWORK = (process.env.NEXT_PUBLIC_DEFAULT_NETWORK || 'testnet') as 'testnet' | 'mainnet';

// Validate Project ID
if (!WALLETCONNECT_PROJECT_ID) {
  console.warn(
    '⚠️  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID not set. ' +
    'Get your project ID at https://cloud.walletconnect.com/'
  );
}

/**
 * dApp metadata for WalletConnect
 */
export const DAPP_METADATA = {
  name: 'Hedera MultiSig',
  description: 'Multi-signature transaction signing for Hedera',
  url: typeof window !== 'undefined' ? window.location.origin : '',
  icons: [`${typeof window !== 'undefined' ? window.location.origin : ''}/logo.png`],
};

/**
 * Initialize WalletConnect DAppConnector
 *
 * @param network - Hedera network (testnet or mainnet)
 * @returns Initialized DAppConnector instance
 */
export async function initWalletConnect(network: 'testnet' | 'mainnet' = DEFAULT_NETWORK): Promise<DAppConnector> {
  if (!WALLETCONNECT_PROJECT_ID) {
    throw new Error(
      'WalletConnect Project ID not configured. ' +
      'Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID in your .env.local file. ' +
      'Get your project ID at https://cloud.walletconnect.com/'
    );
  }

  console.log(`🔗 Initializing WalletConnect for ${network}...`);

  try {
    // Create LedgerId from network string
    const ledgerId = network === 'mainnet' ? LedgerId.MAINNET : LedgerId.TESTNET;

    // Initialize DAppConnector with constructor
    const dAppConnector = new DAppConnector(
      DAPP_METADATA,
      ledgerId,
      WALLETCONNECT_PROJECT_ID
    );

    // Initialize the connector
    await dAppConnector.init();

    console.log('✅ WalletConnect initialized successfully');

    return dAppConnector;
  } catch (error) {
    console.error('Failed to initialize WalletConnect:', error);
    throw error;
  }
}

/**
 * Get network from Hedera network string
 *
 * @param network - Network name (testnet, mainnet)
 * @returns LedgerId
 */
export function getLedgerId(network: 'testnet' | 'mainnet'): string {
  return network === 'mainnet' ? 'mainnet' : 'testnet';
}

/**
 * Validate network match between wallet and session
 *
 * @param walletNetwork - Network from connected wallet
 * @param sessionNetwork - Network from signing session
 * @returns true if networks match
 */
export function validateNetworkMatch(
  walletNetwork: string,
  sessionNetwork: string
): { valid: boolean; message?: string } {
  const normalizeNetwork = (net: string) => {
    return net.toLowerCase().includes('mainnet') ? 'mainnet' : 'testnet';
  };

  const walletNet = normalizeNetwork(walletNetwork);
  const sessionNet = normalizeNetwork(sessionNetwork);

  if (walletNet !== sessionNet) {
    return {
      valid: false,
      message: `Network mismatch! Wallet is on ${walletNet} but session requires ${sessionNet}`,
    };
  }

  return { valid: true };
}

/**
 * Format account ID for display
 *
 * @param accountId - Hedera account ID
 * @returns Formatted account ID
 */
export function formatAccountId(accountId: string): string {
  return accountId;
}

/**
 * Truncate string for display
 *
 * @param str - String to truncate
 * @param startChars - Characters to show at start
 * @param endChars - Characters to show at end
 * @returns Truncated string
 */
export function truncateString(str: string, startChars = 6, endChars = 4): string {
  if (str.length <= startChars + endChars) {
    return str;
  }
  return `${str.slice(0, startChars)}...${str.slice(-endChars)}`;
}

export default {
  WALLETCONNECT_PROJECT_ID,
  DEFAULT_NETWORK,
  DAPP_METADATA,
  initWalletConnect,
  getLedgerId,
  validateNetworkMatch,
  formatAccountId,
  truncateString,
};
