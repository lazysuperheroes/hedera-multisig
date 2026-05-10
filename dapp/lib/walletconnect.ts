/**
 * WalletConnect Client for Hedera MultiSig dApp
 *
 * Uses @hashgraph/hedera-wallet-connect@2.0.4 with Reown AppKit
 * Provides wallet connection, status, and signing capabilities
 */

import { DAppConnector, HederaJsonRpcMethod, HederaSessionEvent, HederaChainId, type ExtensionData } from "@hashgraph/hedera-wallet-connect";
import { LedgerId } from "@hashgraph/sdk";
import { type SignClientTypes } from "@walletconnect/types";
import { fetchAccountData, getCachedAccountData } from "./mirror-node";
import { emitConsoleLog } from "./console-log";

// Import extensionQuery for manual extension discovery (internal SDK API)
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

      emitConsoleLog({ level: 'info', source: 'wc', message: 'initializing v2.0.4', data: { network, chainId } });

      dappConnector = new DAppConnector(
        metadata,
        LedgerId.fromString(network),
        projectId,
        Object.values(HederaJsonRpcMethod),
        [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
        [chainId]
      );

      await dappConnector.init({ logger: 'error' });

      emitConsoleLog({ level: 'success', source: 'wc', message: 'initialized' });
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
    emitConsoleLog({ level: 'info', source: 'wc', message: `connecting to extension`, data: { extensionId } });
    await dappConnector.connectExtension(extensionId);
  } else if (onUri) {
    // Custom QR code flow - caller provides URI callback
    emitConsoleLog({ level: 'info', source: 'wc', message: 'starting pairing (custom QR)' });
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

  emitConsoleLog({ level: 'info', source: 'wc', message: 'disconnecting' });
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
 * Sign transaction with connected wallet — direct RPC path.
 *
 * BACKGROUND: We previously used `signer.signTransaction(transaction)`
 * from `@hashgraph/hedera-wallet-connect`'s `DAppSigner`. That helper
 * has a bug for multi-sig ceremonies: it calls
 * `transactionToTransactionBody(transaction, nodeAccountId)` to rebuild
 * a fresh `TransactionBody` from the parsed Transaction object, sends
 * THAT to the wallet for signing, then reattaches the wallet's
 * signature to the ORIGINAL `signedTx.bodyBytes` (preserved verbatim).
 *
 * For HBAR / token transfers, the rebuilt `TransactionBody` happens to
 * serialize byte-identically to the original — verify works. For
 * `ContractExecuteTransaction` the rebuild produces *different* proto
 * bytes (different default-value handling, field ordering, or similar
 * serializer divergence). The wallet's signature is mathematically
 * valid against the rebuilt body — but the SignedTransaction we get
 * back has the original (non-rebuilt) bodyBytes, so verify against
 * those bodyBytes returns false. Multi-sig aggregation breaks.
 *
 * Empirical confirmation: HashPack and Kabila exhibit identical
 * failure profiles for ContractExecute — same diag output, same
 * 0-of-19 alternate-verify-probe outcome. Two independently developed
 * wallets failing identically points to a shared dependency, which is
 * exactly `@hashgraph/hedera-wallet-connect`'s adapter.
 *
 * THE FIX: skip `signer.signTransaction` entirely. Call the WC RPC
 * method `HederaJsonRpcMethod.SignTransaction` directly with the
 * original `bodyBytes` from our SignedTransaction. The wallet signs
 * those exact bytes. We reattach the resulting signature to a fresh
 * SignedTransaction wrapping the SAME original bodyBytes. Verify
 * works. Aggregation works.
 *
 * Multi-node freeze caveat: we make ONE wallet call (matching the
 * spec's expectation of one signature prompt per signing operation)
 * and apply the resulting sig only to body[0]. Bodies 1..N stay
 * unsigned — the server already tolerates "single-sig submission
 * against multi-node freeze" by trimming to body[0] at execute time.
 * Single-node freeze (our default) is unaffected.
 *
 * @param transactionBytes - Frozen transaction bytes (Transaction proto)
 * @returns Signed transaction bytes ready to return to the coordinator
 */
export const signTransaction = async (transactionBytes: Uint8Array): Promise<{ result: Uint8Array }> => {
  if (!dappConnector) {
    throw new Error('Wallet not connected');
  }

  const signers = dappConnector.signers;
  if (!signers || signers.length === 0) {
    throw new Error('No signers available');
  }

  const signer = signers[0];

  // Lazy-import @hashgraph/proto only at the moment we need it. Keeps
  // the initial bundle smaller; the proto module is heavy.
  const { proto } = await import('@hashgraph/proto');

  // Decode the outer Transaction proto into its TransactionList shape
  // so we can pull out the SignedTransaction wrappers and their
  // bodyBytes — without going through the SDK's reconstruction.
  const txList = proto.TransactionList.decode(transactionBytes);
  if (!txList.transactionList || txList.transactionList.length === 0) {
    throw new Error('Transaction list is empty — cannot sign.');
  }

  // The wallet signs ONE body (body[0]). For multi-node freeze, the
  // server's executor trims to body[0] at submission time. For single-
  // node (our default), there's only one body anyway.
  const head = txList.transactionList[0];
  if (!head.signedTransactionBytes) {
    throw new Error('First transaction in list has no signedTransactionBytes — unexpected shape.');
  }

  const headSignedTx = proto.SignedTransaction.decode(head.signedTransactionBytes);
  const headBodyBytes = headSignedTx.bodyBytes;
  if (!headBodyBytes || headBodyBytes.length === 0) {
    throw new Error('SignedTransaction has no bodyBytes — cannot sign.');
  }

  // Build the WC RPC params: signer account in CAIP-2 form, body in
  // base64. This matches the contract `DAppSigner.signTransaction`
  // would have constructed internally — the difference is we use the
  // ORIGINAL bodyBytes from the SignedTransaction, not a rebuilt
  // TransactionBody.
  const ledgerId = signer.getLedgerId();
  const accountId = signer.getAccountId();
  // CAIP-2 prefix per ledger:
  //   testnet → "hedera:testnet"
  //   mainnet → "hedera:mainnet"
  // The DAppSigner has a private `_signerAccountId` that does this;
  // we replicate the format here so we don't depend on internal API.
  const ledgerName = ledgerId.toString().toLowerCase();
  const caipPrefix = `hedera:${ledgerName}`;
  const signerAccountId = `${caipPrefix}:${accountId.toString()}`;

  const transactionBodyBase64 = Buffer.from(headBodyBytes).toString('base64');

  // Call the RPC directly. signer.request handles topic + chainId
  // routing internally — we don't need to thread those through.
  const response = await signer.request<{ signatureMap: string }>({
    method: HederaJsonRpcMethod.SignTransaction,
    params: {
      signerAccountId,
      transactionBody: transactionBodyBase64,
    },
  });

  if (!response?.signatureMap) {
    throw new Error('Wallet returned no signatureMap — sign request may have been rejected.');
  }

  // Decode the wallet's returned sigMap (base64 → SignatureMap proto)
  // and merge into body[0]'s existing sigMap (which is empty for a
  // freshly frozen tx, but in principle could carry prior sigs).
  const walletSigMap = proto.SignatureMap.decode(Buffer.from(response.signatureMap, 'base64'));
  const existingSigMap = headSignedTx.sigMap || proto.SignatureMap.create({});
  const mergedSigPairs = [
    ...(existingSigMap.sigPair || []),
    ...(walletSigMap.sigPair || []),
  ];

  // Re-encode body[0]'s SignedTransaction with the SAME bodyBytes
  // we passed to the wallet — guaranteed verify-correctness because
  // the signature was made over those exact bytes.
  const updatedSignedTxBytes = proto.SignedTransaction.encode({
    bodyBytes: headBodyBytes,
    sigMap: proto.SignatureMap.create({ sigPair: mergedSigPairs }),
  }).finish();

  // Replace body[0]'s signedTransactionBytes; leave bodies 1..N
  // untouched (they retain their original structure with no signature).
  const updatedTxList = txList.transactionList.map((entry, idx) => {
    if (idx === 0) return { signedTransactionBytes: updatedSignedTxBytes };
    return entry;
  });

  const finalBytes = proto.TransactionList.encode({
    transactionList: updatedTxList,
  }).finish();

  return { result: finalBytes };
};

/**
 * Get DAppConnector instance (for advanced usage)
 */
export const getDAppConnector = (): DAppConnector | null => {
  return dappConnector;
};

// Export types for convenience
export type { ExtensionData };
