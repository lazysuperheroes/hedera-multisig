/**
 * WalletConnect Configuration
 *
 * This file provides fallback configuration for local development.
 * In production, ALWAYS use environment variables set in Vercel/hosting platform.
 *
 * Security Note:
 * - WalletConnect Project IDs are public identifiers (not secret keys)
 * - They are visible in browser DevTools (client-side)
 * - Configure domain restrictions in WalletConnect dashboard for security
 * - Use separate Project IDs for testnet and production
 */

export interface WalletConnectConfig {
  projectId: string;
  network: 'testnet' | 'mainnet';
  description: string;
}

/**
 * WalletConnect Project IDs
 *
 * PRODUCTION: These should be overridden by environment variables:
 * - NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
 * - NEXT_PUBLIC_DEFAULT_NETWORK
 *
 * LOCAL DEVELOPMENT: Update these with your project IDs from:
 * https://cloud.walletconnect.com/
 */
const WALLETCONNECT_PROJECTS: Record<'testnet' | 'mainnet', WalletConnectConfig> = {
  testnet: {
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '', // TODO: Add your testnet Project ID here for local dev
    network: 'testnet',
    description: 'Hedera MultiSig - Testnet',
  },
  mainnet: {
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '', // TODO: Add your production Project ID here (NOT RECOMMENDED - use env vars)
    network: 'mainnet',
    description: 'Hedera MultiSig - Production',
  },
};

/**
 * Get active WalletConnect configuration
 *
 * Priority:
 * 1. Environment variable: NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (highest priority)
 * 2. Fallback config based on NEXT_PUBLIC_DEFAULT_NETWORK
 * 3. Default to testnet
 */
export function getWalletConnectConfig(): WalletConnectConfig {
  const network = (process.env.NEXT_PUBLIC_DEFAULT_NETWORK || 'testnet') as 'testnet' | 'mainnet';
  const envProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

  const config = WALLETCONNECT_PROJECTS[network];

  // Environment variable takes precedence
  if (envProjectId) {
    return {
      ...config,
      projectId: envProjectId,
    };
  }

  // Validate configuration
  if (!config.projectId) {
    console.error(
      '❌ WalletConnect Project ID not configured!\n\n' +
      'Please set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID environment variable.\n' +
      'Get your Project ID from: https://cloud.walletconnect.com/\n\n' +
      'For local development, you can also update:\n' +
      'dapp/config/walletconnect.config.ts (not recommended for production)'
    );
  }

  return config;
}

/**
 * Validate WalletConnect configuration
 *
 * Call this on app startup to ensure configuration is valid
 */
export function validateWalletConnectConfig(): boolean {
  const config = getWalletConnectConfig();

  if (!config.projectId) {
    return false;
  }

  // Project ID should be a UUID-like string
  if (config.projectId.length < 20) {
    console.warn('⚠️ WalletConnect Project ID seems invalid (too short)');
    return false;
  }

  return true;
}

/**
 * Get configuration for specific network
 * Useful for tools that need to reference both configs
 */
export function getWalletConnectConfigForNetwork(network: 'testnet' | 'mainnet'): WalletConnectConfig {
  return WALLETCONNECT_PROJECTS[network];
}
