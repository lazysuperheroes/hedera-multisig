/**
 * WalletConnect Client
 *
 * Handles WalletConnect connection and transaction signing using Hedera's
 * official @hashgraph/hedera-wallet-connect library.
 *
 * Uses hedera_signTransaction to sign transactions WITHOUT executing them,
 * which is perfect for multi-sig signature collection.
 */

import { DAppConnector, HederaSessionEvent } from '@hashgraph/hedera-wallet-connect';
import { Transaction, AccountId, PublicKey, Key } from '@hashgraph/sdk';
import { initWalletConnect, validateNetworkMatch } from './walletconnect-config';

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
  private connector: DAppConnector | null = null;
  private accountId: AccountId | null = null;
  private publicKey: Key | null = null;
  private network: 'testnet' | 'mainnet' = 'testnet';

  /**
   * Connect to wallet via WalletConnect
   *
   * @param network - Hedera network (testnet or mainnet)
   * @returns Wallet information
   */
  async connect(network: 'testnet' | 'mainnet' = 'testnet'): Promise<WalletInfo> {
    try {
      this.network = network;

      // Initialize WalletConnect
      this.connector = await initWalletConnect(network);

      // Open WalletConnect modal for user to select wallet
      console.log('🔗 Opening WalletConnect modal...');
      await this.connector.openModal();

      // Wait for connection
      const signers = this.connector.signers;

      if (!signers || signers.length === 0) {
        throw new Error('No wallet connected. Please try again.');
      }

      // Use first signer (account)
      const signer = signers[0];
      this.accountId = signer.getAccountId();
      this.publicKey = signer.getAccountKey();

      console.log('✅ Wallet connected successfully');
      console.log(`   Account: ${this.accountId.toString()}`);
      console.log(`   Public Key: ${this.publicKey.toString()}`);
      console.log(`   Network: ${network}`);

      return {
        accountId: this.accountId.toString(),
        publicKey: this.publicKey.toString(),
        network: network,
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
    if (!this.connector) {
      throw new Error('Wallet not connected. Call connect() first.');
    }

    if (!this.accountId || !this.publicKey) {
      throw new Error('Account or public key not available');
    }

    try {
      console.log('📝 Requesting signature from wallet...');

      // Decode frozen transaction from base64
      const txBytes = Buffer.from(frozenTransactionBase64, 'base64');
      const transaction = Transaction.fromBytes(txBytes);

      console.log('   Transaction decoded successfully');
      console.log(`   Type: ${transaction.constructor.name}`);

      // Get signer for this account
      const signers = this.connector.signers;
      if (!signers || signers.length === 0) {
        throw new Error('No signers available');
      }

      const signer = signers[0];

      // Sign transaction using hedera_signTransaction
      // This will open the wallet app for user approval
      console.log('   Opening wallet for approval...');

      const signedTx = await signer.signTransaction(transaction);

      console.log('✅ Transaction signed by wallet');

      // Extract signature from signed transaction
      const signature = this.extractSignature(signedTx);

      return {
        publicKey: this.publicKey.toString(),
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
   * @returns Signature as base64 string
   */
  private extractSignature(signedTransaction: Transaction): string {
    try {
      if (!this.publicKey) {
        throw new Error('Public key not available');
      }

      // Get signature map from signed transaction
      const signatureMap = signedTransaction.getSignatures();

      // The signature map is organized by node account ID, then by public key
      // For a frozen transaction, there should be signatures for each node
      // We need to extract OUR signature (from our public key)

      let signature: any = null;

      // Iterate through all node signatures
      for (const [nodeAccountId, publicKeyToSignature] of signatureMap) {
        // Look for our public key in this node's signatures
        const publicKeyString = this.publicKey.toString();

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

      // Convert signature to base64
      const signatureBase64 = Buffer.from(signature).toString('base64');

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
    if (this.connector) {
      try {
        await this.connector.disconnectAll();
        console.log('✅ Wallet disconnected');
      } catch (error) {
        console.error('Error disconnecting wallet:', error);
      }
    }

    this.connector = null;
    this.accountId = null;
    this.publicKey = null;
  }

  /**
   * Get current wallet info
   */
  getWalletInfo(): WalletInfo | null {
    if (!this.accountId || !this.publicKey) {
      return null;
    }

    return {
      accountId: this.accountId.toString(),
      publicKey: this.publicKey.toString(),
      network: this.network,
    };
  }

  /**
   * Check if wallet is connected
   */
  isConnected(): boolean {
    return this.connector !== null && this.accountId !== null;
  }

  /**
   * Validate network match
   *
   * @param sessionNetwork - Network required by session
   * @returns Validation result
   */
  validateNetwork(sessionNetwork: string): { valid: boolean; message?: string } {
    if (!this.network) {
      return {
        valid: false,
        message: 'Wallet network not available',
      };
    }

    return validateNetworkMatch(this.network, sessionNetwork);
  }

  /**
   * Register event handlers for wallet events
   *
   * @param event - Event name
   * @param handler - Event handler
   */
  on(event: 'disconnect' | 'accountsChanged' | 'chainChanged', handler: () => void): void {
    if (!this.connector) return;

    // Event handling will be implemented based on DAppConnector API
    // For now, just log the registration
    console.log(`Event handler registered for ${event}`);

    // TODO: Implement actual event listeners when WalletConnect session is active
    // The DAppConnector may expose session.on() or similar methods
  }
}

export default WalletConnectClient;
