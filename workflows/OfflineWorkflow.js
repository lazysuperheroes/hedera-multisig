/**
 * Offline Workflow
 *
 * Handles manual coordination multi-signature workflow.
 * Enables air-gapped signing and asynchronous signature collection without time pressure.
 *
 * Process:
 * 1. Freeze transaction and export to file
 * 2. Signers review and sign offline (using cli/sign.js)
 * 3. Collect signatures from all signers
 * 4. Verify and execute transaction
 */

const fs = require('fs').promises;
const path = require('path');
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

class OfflineWorkflow {
  constructor(client, options = {}) {
    this.client = client;
    this.options = {
      exportDir: options.exportDir || './multisig-transactions',
      auditLogPath: options.auditLogPath || './logs/audit.log',
      verbose: options.verbose !== false,
      contractInterface: options.contractInterface || null,
      ...options
    };

    this.progress = new ProgressIndicator();
    this.collector = new SignatureCollector({ mode: 'offline' });
    this.verifier = new SignatureVerifier();
    this.executor = new TransactionExecutor(client, { auditLogPath: this.options.auditLogPath });
  }

  /**
   * Phase 1: Freeze transaction and export for offline signing
   *
   * @param {Transaction} transaction - Hedera transaction to freeze
   * @param {Object} metadata - Transaction metadata for signers
   * @returns {Object} Export details with file paths
   */
  async freezeAndExport(transaction, metadata = {}) {
    try {
      if (this.options.verbose) {
        console.log(chalk.bold.cyan('\n━━━ Phase 1: Freeze & Export Transaction ━━━\n'));
      }

      // Step 1: Freeze the transaction
      this.progress.startSpinner('Freezing transaction');
      const frozenTxData = await TransactionFreezer.freeze(transaction, this.client, {
        contractInterface: this.options.contractInterface
      });
      const frozenTx = frozenTxData.transaction;
      this.progress.stopSpinner();
      this.progress.success('Transaction frozen successfully');

      // Get transaction details using TransactionDecoder
      const txDetails = frozenTxData.txDetails || TransactionDecoder.decode(
        frozenTx,
        this.options.contractInterface
      );
      txDetails.expirationTime = Math.floor(frozenTxData.expiresAt.getTime() / 1000);

      // Display transaction details
      if (this.options.verbose) {
        TransactionDisplay.displayFull(txDetails);
      }

      // Step 2: Ensure export directory exists
      await fs.mkdir(this.options.exportDir, { recursive: true });

      // Step 3: Generate file names
      const timestamp = Date.now();
      const txId = txDetails.transactionId?.replace(/[@.]/g, '-') || `tx-${timestamp}`;
      const baseFilename = `${txId}`;

      const txFile = path.join(this.options.exportDir, `${baseFilename}.tx`);
      const metadataFile = path.join(this.options.exportDir, `${baseFilename}.json`);

      // Step 4: Export transaction bytes
      const txBytes = frozenTx.toBytes();
      await fs.writeFile(txFile, txBytes);
      this.progress.success(`Transaction exported to: ${chalk.cyan(txFile)}`);

      // Step 5: Export metadata for signers
      const exportMetadata = {
        transactionId: txDetails.transactionId,
        transactionType: txDetails.transactionType,
        expirationTime: txDetails.expirationTime,
        expirationDate: new Date(txDetails.expirationTime * 1000).toISOString(),
        details: txDetails,
        signatureRequirements: {
          threshold: metadata.threshold || 1,
          requiredSigners: metadata.requiredSigners || [],
          signerLabels: metadata.signerLabels || []
        },
        instructions: metadata.instructions || 'Please review and sign this transaction',
        createdAt: new Date().toISOString(),
        createdBy: metadata.createdBy || 'Unknown'
      };

      await fs.writeFile(metadataFile, JSON.stringify(exportMetadata, null, 2));
      this.progress.success(`Metadata exported to: ${chalk.cyan(metadataFile)}`);

      // Step 6: Display next steps
      if (this.options.verbose) {
        console.log('\n' + chalk.bold.yellow('Next Steps:\n'));
        console.log('1. Share the transaction file with signers:');
        console.log(chalk.cyan(`   ${txFile}\n`));
        console.log('2. Signers should review the metadata file:');
        console.log(chalk.cyan(`   ${metadataFile}\n`));
        console.log('3. Signers can sign using:');
        console.log(chalk.green(`   node lib/multiSig/cli/sign.js ${txFile}\n`));
        console.log('4. Collect signatures and proceed to Phase 2\n');

        HelpText.securityWarning('Share files via secure channels only. Never share private keys.');
      }

      return {
        success: true,
        transactionFile: txFile,
        metadataFile: metadataFile,
        transactionId: txDetails.transactionId,
        expirationTime: txDetails.expirationTime,
        frozenTransaction: frozenTx,
        details: txDetails
      };

    } catch (error) {
      this.progress.stopSpinner();
      const formatted = ErrorFormatter.format(error, {
        phase: 'Freeze & Export',
        workflow: 'Offline'
      });
      console.error(formatted);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Phase 2: Collect signatures from signers
   *
   * @param {Transaction} frozenTransaction - The frozen transaction
   * @param {Array<Object>} signatureFiles - Array of signature file paths or signature objects
   * @param {number} threshold - Minimum number of required signatures
   * @returns {Object} Collection results
   */
  async collectSignatures(frozenTransaction, signatureFiles, threshold = 1) {
    try {
      if (this.options.verbose) {
        console.log(chalk.bold.cyan('\n━━━ Phase 2: Collect Signatures ━━━\n'));
      }

      const signatures = [];

      // Load signatures from files
      for (const sigFile of signatureFiles) {
        try {
          let sigData;

          // Handle different input formats
          if (typeof sigFile === 'string') {
            // File path provided
            this.progress.startSpinner(`Loading signature from ${path.basename(sigFile)}`);
            const content = await fs.readFile(sigFile, 'utf8');
            sigData = JSON.parse(content);
            this.progress.stopSpinner();
          } else if (typeof sigFile === 'object') {
            // Signature object provided directly
            sigData = sigFile;
          } else {
            throw new Error('Invalid signature format');
          }

          // Validate signature data structure
          if (!sigData.signature || !sigData.publicKey) {
            throw new Error('Invalid signature file format: missing required fields');
          }

          signatures.push(sigData);
          this.progress.success(`Loaded signature from ${sigData.signerLabel || sigData.accountId || 'unknown signer'}`);

        } catch (error) {
          this.progress.error(`Failed to load signature: ${error.message}`);
        }
      }

      // Display collection status
      if (this.options.verbose) {
        TransactionDisplay.displaySignatureStatus(
          signatures.length,
          threshold,
          signatures.map(s => ({
            signed: true,
            label: s.signerLabel || s.accountId || 'Unknown'
          }))
        );
      }

      // Check if we have enough signatures
      if (signatures.length < threshold) {
        throw new Error(
          `Insufficient signatures: collected ${signatures.length}, required ${threshold}`
        );
      }

      // Verify each signature
      if (this.options.verbose) {
        console.log(chalk.bold.cyan('\n━━━ Verifying Signatures ━━━\n'));
      }

      const verifiedSignatures = [];

      for (const sigData of signatures) {
        this.progress.startSpinner(`Verifying signature from ${sigData.signerLabel || 'signer'}`);

        const isValid = await this.verifier.verify(
          frozenTransaction,
          sigData.signature,
          sigData.publicKey
        );

        this.progress.stopSpinner();

        if (isValid) {
          verifiedSignatures.push(sigData);
          this.progress.success(`✓ Valid signature from ${sigData.signerLabel || sigData.accountId || 'signer'}`);
        } else {
          this.progress.error(`✗ Invalid signature from ${sigData.signerLabel || 'signer'}`);
        }
      }

      // Check verified signatures meet threshold
      if (verifiedSignatures.length < threshold) {
        throw new Error(
          `Insufficient valid signatures: verified ${verifiedSignatures.length}, required ${threshold}`
        );
      }

      if (this.options.verbose) {
        console.log(chalk.green.bold(`\n✓ All signatures verified successfully (${verifiedSignatures.length}/${threshold})\n`));
      }

      return {
        success: true,
        signatures: verifiedSignatures,
        count: verifiedSignatures.length,
        threshold: threshold,
        meetsThreshold: verifiedSignatures.length >= threshold
      };

    } catch (error) {
      this.progress.stopSpinner();
      const formatted = ErrorFormatter.format(error, {
        phase: 'Collect Signatures',
        workflow: 'Offline'
      });
      console.error(formatted);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Phase 3: Execute the multi-signed transaction
   *
   * @param {Transaction} frozenTransaction - The frozen transaction with signatures
   * @param {Array<Object>} signatures - Verified signatures to add
   * @returns {Object} Execution results
   */
  async executeTransaction(frozenTransaction, signatures) {
    try {
      if (this.options.verbose) {
        console.log(chalk.bold.cyan('\n━━━ Phase 3: Execute Transaction ━━━\n'));
      }

      // Add all signatures to the transaction
      let signedTx = frozenTransaction;

      for (const sigData of signatures) {
        signedTx = await signedTx.addSignature(
          sigData.publicKey,
          Buffer.from(sigData.signature, 'hex')
        );
      }

      // Execute the transaction
      this.progress.startSpinner('Submitting transaction to Hedera network');
      const result = await this.executor.execute(signedTx);
      this.progress.stopSpinner();

      if (result.success) {
        // Display receipt
        if (this.options.verbose) {
          TransactionDisplay.displayReceipt(result.receipt);
        }

        this.progress.success('Transaction executed successfully!');
        this.progress.info(`Transaction ID: ${result.receipt.transactionId?.toString()}`);

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
      const formatted = ErrorFormatter.format(error, {
        phase: 'Execute Transaction',
        workflow: 'Offline'
      });
      console.error(formatted);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Complete offline workflow: freeze, collect, execute
   *
   * @param {Transaction} transaction - Transaction to process
   * @param {Array<Object>} signatureFiles - Signature files or objects
   * @param {Object} options - Workflow options
   * @returns {Object} Complete workflow results
   */
  async run(transaction, signatureFiles, options = {}) {
    const {
      threshold = 1,
      metadata = {},
      skipExport = false
    } = options;

    try {
      // Phase 1: Freeze and export (if not skipped)
      let frozenTx = transaction;
      if (!skipExport) {
        const freezeResult = await this.freezeAndExport(transaction, metadata);
        if (!freezeResult.success) {
          return freezeResult;
        }
        frozenTx = freezeResult.frozenTransaction;
      }

      // Phase 2: Collect signatures
      const collectionResult = await this.collectSignatures(frozenTx, signatureFiles, threshold);
      if (!collectionResult.success) {
        return collectionResult;
      }

      // Phase 3: Execute
      const executionResult = await this.executeTransaction(frozenTx, collectionResult.signatures);

      return executionResult;

    } catch (error) {
      const formatted = ErrorFormatter.format(error, {
        workflow: 'Offline Complete'
      });
      console.error(formatted);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.progress.cleanup();
  }
}

module.exports = OfflineWorkflow;
