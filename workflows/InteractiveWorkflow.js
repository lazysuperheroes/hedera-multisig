/**
 * Interactive Workflow
 *
 * Handles real-time multi-signature coordination with live countdown timer.
 * All signers must be available simultaneously to complete within 110-second window.
 *
 * Process:
 * 1. Freeze transaction (starts 110s countdown)
 * 2. Display transaction details and timer
 * 3. Collect signatures in real-time from each signer
 * 4. Execute immediately once threshold is met
 */

const chalk = require('chalk');
const TransactionFreezer = require('../core/TransactionFreezer');
const TransactionDecoder = require('../core/TransactionDecoder');
const SignatureCollector = require('../core/SignatureCollector');
const SignatureVerifier = require('../core/SignatureVerifier');
const TransactionExecutor = require('../core/TransactionExecutor');
const TransactionDisplay = require('../ui/TransactionDisplay');
const ProgressIndicator = require('../ui/ProgressIndicator');
const ErrorFormatter = require('../ui/ErrorFormatter');
const HelpText = require('../ui/HelpText');

class InteractiveWorkflow {
  constructor(client, options = {}) {
    this.client = client;
    this.options = {
      auditLogPath: options.auditLogPath || './logs/audit.log',
      verbose: options.verbose !== false,
      showTimer: options.showTimer !== false,
      autoExecute: options.autoExecute !== false,
      contractInterface: options.contractInterface || null,
      ...options
    };

    this.progress = new ProgressIndicator();
    this.collector = new SignatureCollector({ mode: 'interactive' });
    this.verifier = new SignatureVerifier();
    this.executor = new TransactionExecutor(client, { auditLogPath: this.options.auditLogPath });

    this.isExpired = false;
    this.expirationTimer = null;
  }

  /**
   * Run the complete interactive workflow
   *
   * @param {Transaction} transaction - Hedera transaction to process
   * @param {Array<Object>} keyProviders - Array of KeyProvider instances for each signer
   * @param {Object} options - Workflow options
   * @returns {Object} Execution results
   */
  async run(transaction, keyProviders, options = {}) {
    const {
      threshold = keyProviders.length, // Default: all signers required
      signerLabels = [],
      metadata = {}
    } = options;

    try {
      if (this.options.verbose) {
        console.log(chalk.bold.cyan('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
        console.log(chalk.bold.cyan('  INTERACTIVE MULTI-SIGNATURE WORKFLOW'));
        console.log(chalk.bold.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

        HelpText.note(`Collecting ${threshold} of ${keyProviders.length} signatures in real-time`);
        HelpText.securityWarning('You have 110 seconds to complete all signatures');
        console.log();
      }

      // Step 1: Freeze the transaction
      const freezeResult = await this._freezeTransaction(transaction);
      if (!freezeResult.success) {
        return freezeResult;
      }

      const { frozenTransaction, txDetails, expirationTime } = freezeResult;

      // Step 2: Display transaction details
      if (this.options.verbose) {
        TransactionDisplay.displayFull(txDetails);
        TransactionDisplay.displaySigningWarning(txDetails);
      }

      // Step 3: Start expiration countdown
      if (this.options.showTimer) {
        this._startExpirationTimer(expirationTime);
      }

      // Step 4: Collect signatures from all signers
      const collectionResult = await this._collectSignatures(
        frozenTransaction,
        keyProviders,
        threshold,
        signerLabels
      );

      // Stop timer
      this._stopExpirationTimer();

      if (!collectionResult.success) {
        return collectionResult;
      }

      // Check if transaction expired during collection
      if (this.isExpired) {
        throw new Error('Transaction expired before all signatures were collected');
      }

      // Step 5: Execute the transaction
      if (this.options.autoExecute) {
        const executionResult = await this._executeTransaction(
          collectionResult.signedTransaction,
          txDetails
        );
        return executionResult;
      } else {
        // Return signed transaction for manual execution
        return {
          success: true,
          signedTransaction: collectionResult.signedTransaction,
          signatures: collectionResult.signatures,
          message: 'Signatures collected successfully. Execute manually if needed.'
        };
      }

    } catch (error) {
      this._stopExpirationTimer();
      const formatted = ErrorFormatter.format(error, {
        workflow: 'Interactive',
        phase: 'Complete Workflow'
      });
      console.error(formatted);

      return {
        success: false,
        error: error.message
      };
    } finally {
      this.cleanup();
    }
  }

  /**
   * Freeze the transaction and get details
   * @private
   */
  async _freezeTransaction(transaction) {
    try {
      if (this.options.verbose) {
        console.log(chalk.bold.cyan('━━━ Step 1: Freeze Transaction ━━━\n'));
      }

      this.progress.startSpinner('Freezing transaction');
      const frozenTxData = await TransactionFreezer.freeze(transaction, this.client, {
        contractInterface: this.options.contractInterface
      });
      const frozenTx = frozenTxData.transaction;
      this.progress.stopSpinner();

      // Get transaction details using TransactionDecoder
      const txDetails = frozenTxData.txDetails || TransactionDecoder.decode(
        frozenTx,
        this.options.contractInterface
      );
      const expirationTime = Math.floor(frozenTxData.expiresAt.getTime() / 1000);
      txDetails.expirationTime = expirationTime;

      this.progress.success('Transaction frozen successfully');
      this.progress.info(`Expiration: ${new Date(expirationTime * 1000).toLocaleString()}`);
      console.log();

      return {
        success: true,
        frozenTransaction: frozenTx,
        txDetails,
        expirationTime
      };

    } catch (error) {
      this.progress.stopSpinner();
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Collect signatures from all signers with live progress
   * @private
   */
  async _collectSignatures(frozenTransaction, keyProviders, threshold, signerLabels) {
    try {
      if (this.options.verbose) {
        console.log(chalk.bold.cyan('━━━ Step 2: Collect Signatures ━━━\n'));
      }

      const signatures = [];
      let signedTx = frozenTransaction;

      for (let i = 0; i < keyProviders.length; i++) {
        const keyProvider = keyProviders[i];
        const label = signerLabels[i] || `Signer ${i + 1}`;

        // Check expiration before each signature
        if (this.isExpired) {
          throw new Error('Transaction expired during signature collection');
        }

        // Display progress
        if (this.options.verbose) {
          this.progress.showProgress(i + 1, keyProviders.length, chalk.white(`Collecting signature from ${label}`));
        }

        try {
          // Collect signature using the key provider
          const sigResult = await this.collector.collectSignature(
            frozenTransaction,
            keyProvider,
            { signerLabel: label }
          );

          if (!sigResult.success) {
            this.progress.warning(`Failed to collect signature from ${label}: ${sigResult.error}`);
            continue;
          }

          // Verify signature immediately
          const isValid = await this.verifier.verify(
            frozenTransaction,
            sigResult.signature,
            sigResult.publicKey
          );

          if (!isValid) {
            this.progress.error(`Invalid signature from ${label}`);
            continue;
          }

          // Add signature to transaction
          signedTx = await signedTx.addSignature(
            sigResult.publicKey,
            Buffer.from(sigResult.signature, 'hex')
          );

          signatures.push({
            ...sigResult,
            signerLabel: label
          });

          this.progress.success(`✓ Valid signature collected from ${label} (${signatures.length}/${threshold})`);

          // Display current status
          if (this.options.verbose) {
            TransactionDisplay.displaySignatureStatus(
              signatures.length,
              threshold,
              keyProviders.map((_, idx) => ({
                signed: idx < signatures.length,
                label: signerLabels[idx] || `Signer ${idx + 1}`
              }))
            );
          }

          // Check if threshold is met
          if (signatures.length >= threshold) {
            this.progress.success(`\n✓ Threshold met: ${signatures.length} of ${threshold} signatures collected\n`);
            break;
          }

        } catch (error) {
          this.progress.error(`Error collecting signature from ${label}: ${error.message}`);
          // Continue to next signer
        }
      }

      // Verify we have enough signatures
      if (signatures.length < threshold) {
        throw new Error(
          `Insufficient signatures: collected ${signatures.length}, required ${threshold}`
        );
      }

      return {
        success: true,
        signedTransaction: signedTx,
        signatures,
        count: signatures.length
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute the signed transaction
   * @private
   */
  async _executeTransaction(signedTransaction, txDetails) {
    try {
      if (this.options.verbose) {
        console.log(chalk.bold.cyan('━━━ Step 3: Execute Transaction ━━━\n'));
      }

      // Final expiration check
      if (this.isExpired) {
        throw new Error('Transaction expired before execution');
      }

      this.progress.startSpinner('Submitting transaction to Hedera network');
      const result = await this.executor.execute(signedTransaction);
      this.progress.stopSpinner();

      if (result.success) {
        // Display receipt
        if (this.options.verbose) {
          TransactionDisplay.displayReceipt(result.receipt, txDetails);
        }

        this.progress.success('Transaction executed successfully!');

        return {
          success: true,
          receipt: result.receipt,
          transactionId: result.receipt.transactionId?.toString()
        };
      } else {
        throw new Error(result.error || 'Transaction execution failed');
      }

    } catch (error) {
      this.progress.stopSpinner();
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Start countdown timer for transaction expiration
   * @private
   */
  _startExpirationTimer(expirationTimestamp) {
    this.isExpired = false;

    const onExpired = () => {
      this.isExpired = true;
      console.log(chalk.red.bold('\n⏰ TRANSACTION EXPIRED - Signature collection aborted\n'));
    };

    this.expirationTimer = this.progress.startCountdown(expirationTimestamp, onExpired);
  }

  /**
   * Stop countdown timer
   * @private
   */
  _stopExpirationTimer() {
    if (this.expirationTimer) {
      this.progress.stopCountdown();
      this.expirationTimer = null;
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this._stopExpirationTimer();
    this.progress.cleanup();
  }
}

module.exports = InteractiveWorkflow;
