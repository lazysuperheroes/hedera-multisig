/**
 * WalletConnect Client (v2.0.4)
 *
 * Handles WalletConnect connection and transaction signing using Hedera's
 * official @hashgraph/hedera-wallet-connect@2.0.4 library with Reown.
 *
 * Uses hedera_signTransaction to sign transactions WITHOUT executing them,
 * which is perfect for multi-sig signature collection.
 */

import { Transaction, PublicKey } from '@hashgraph/sdk';
import {
  initializeWalletConnect,
  connectWallet,
  disconnectWallet,
  getAccountId,
  getPublicKey,
  getDAppConnector,
  signTransaction as signTx,
} from './walletconnect';

export interface WalletInfo {
  accountId: string;
  publicKey: string;
  network: string;
}

export interface SignatureResult {
  publicKey: string;
  signature: string; // base64 encoded
}

export class WalletConnectClient {
  private network: 'testnet' | 'mainnet' = 'testnet';
  private eventHandlers: Map<string, Function[]> = new Map();

  /**
   * Connect to wallet via WalletConnect
   *
   * @param network - Hedera network (testnet or mainnet)
   * @param extensionId - Optional extension ID for direct connection
   * @returns Wallet information
   */
  async connect(network: 'testnet' | 'mainnet' = 'testnet', extensionId?: string): Promise<WalletInfo> {
    try {
      this.network = network;

      // Initialize WalletConnect
      await initializeWalletConnect();

      // Open WalletConnect modal or connect to extension
      console.log('🔗 Opening wallet connection...');
      await connectWallet(extensionId);

      // Wait a moment for connection to establish
      await new Promise(resolve => setTimeout(resolve, 1000));

      const accountId = getAccountId();
      const publicKey = getPublicKey();

      if (!accountId || !publicKey) {
        throw new Error('No wallet connected. Please try again.');
      }

      console.log('✅ Wallet connected successfully');
      console.log(`   Account: ${accountId}`);
      console.log(`   Public Key: ${publicKey}`);
      console.log(`   Network: ${network}`);

      return {
        accountId,
        publicKey,
        network,
      };
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      throw error;
    }
  }

  /**
   * Sign transaction with connected wallet
   *
   * Uses hedera_signTransaction which signs WITHOUT executing,
   * perfect for collecting signatures for multi-sig transactions.
   *
   * @param frozenTransactionBase64 - Frozen transaction as base64 string
   * @returns Signature result with public key and signature
   */
  async signTransaction(frozenTransactionBase64: string): Promise<SignatureResult> {
    const accountId = getAccountId();
    const publicKey = getPublicKey();

    if (!accountId || !publicKey) {
      throw new Error('Wallet not connected. Call connect() first.');
    }

    try {
      console.log('📝 Requesting signature from wallet...');

      // Decode frozen transaction from base64
      const txBytes = Buffer.from(frozenTransactionBase64, 'base64');
      const transaction = Transaction.fromBytes(txBytes);

      console.log('   Transaction decoded successfully');
      console.log(`   Type: ${transaction.constructor.name}`);

      // Sign transaction using wallet
      // This will open the wallet app for user approval
      console.log('   Opening wallet for approval...');

      const signedTxResult = await signTx(txBytes);
      const signedTx = signedTxResult.result;

      console.log('✅ Transaction signed by wallet');

      // Extract signature from signed transaction
      const signature = this.extractSignature(signedTx, publicKey);

      return {
        publicKey: publicKey,
        signature: signature,
      };
    } catch (error) {
      console.error('Failed to sign transaction:', error);
      throw error;
    }
  }

  /**
   * Extract signature from signed transaction
   *
   * @param signedTransaction - Transaction signed by wallet
   * @param publicKeyString - Public key to extract signature for
   * @returns Signature as base64 string
   */
  private extractSignature(signedTransaction: any, publicKeyString: string): string {
    try {
      // Parse the public key
      const publicKey = PublicKey.fromString(publicKeyString);

      // Convert signed transaction bytes to Transaction object
      const signedTx = Transaction.fromBytes(signedTransaction);

      // Get signature map from signed transaction
      const signatureMap = signedTx.getSignatures();

      let signature: any = null;

      // Iterate through all node signatures
      for (const [nodeAccountId, publicKeyToSignature] of signatureMap) {
        // Look for our public key in this node's signatures
        for (const [pubKey, sig] of publicKeyToSignature) {
          if (pubKey.toString() === publicKeyString) {
            signature = sig;
            console.log(`   Found signature for node: ${nodeAccountId.toString()}`);
            break;
          }
        }

        if (signature) break;
      }

      if (!signature) {
        throw new Error('Could not find signature in signed transaction');
      }

      // Convert signature to base64 (handle Uint8Array or other types)
      const signatureBytes = signature instanceof Uint8Array ? signature : Uint8Array.from(signature);
      const signatureBase64 = Buffer.from(signatureBytes).toString('base64');

      console.log('   Signature extracted successfully');
      console.log(`   Signature (first 32 chars): ${signatureBase64.substring(0, 32)}...`);

      return signatureBase64;
    } catch (error) {
      console.error('Failed to extract signature:', error);
      throw error;
    }
  }

  /**
   * Disconnect wallet
   */
  async disconnect(): Promise<void> {
    try {
      await disconnectWallet();
      console.log('✅ Wallet disconnected');
    } catch (error) {
      console.error('Error disconnecting wallet:', error);
    }
  }

  /**
   * Get current wallet info
   */
  getWalletInfo(): WalletInfo | null {
    const accountId = getAccountId();
    const publicKey = getPublicKey();

    if (!accountId || !publicKey) {
      return null;
    }

    return {
      accountId,
      publicKey,
      network: this.network,
    };
  }

  /**
   * Check if wallet is connected
   */
  isConnected(): boolean {
    return getAccountId() !== null && getPublicKey() !== null;
  }

  /**
   * Validate network match
   *
   * @param sessionNetwork - Network required by session
   * @returns Validation result
   */
  validateNetwork(sessionNetwork: string): { valid: boolean; message?: string } {
    const normalizedWalletNetwork = this.network.toLowerCase();
    const normalizedSessionNetwork = sessionNetwork.toLowerCase();

    if (normalizedWalletNetwork !== normalizedSessionNetwork) {
      return {
        valid: false,
        message: `Network mismatch: Wallet is on ${this.network}, but session requires ${sessionNetwork}`,
      };
    }

    return { valid: true };
  }

  /**
   * Register event handlers for wallet events
   *
   * @param event - Event name
   * @param handler - Event handler
   */
  on(event: 'disconnect' | 'accountsChanged' | 'chainChanged', handler: () => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }

    this.eventHandlers.get(event)!.push(handler);

    // TODO: Implement actual event listeners when DAppConnector API supports it
    console.log(`Event handler registered for ${event}`);
  }
}

export default WalletConnectClient;
