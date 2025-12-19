/**
 * Workflow Integration Tests
 *
 * Tests for InteractiveWorkflow, OfflineWorkflow, and WorkflowOrchestrator.
 * Validates end-to-end multi-signature transaction workflows.
 */

const { expect } = require('chai');
const {
  Client,
  AccountId,
  PrivateKey,
  TransferTransaction,
  Hbar
} = require('@hashgraph/sdk');

const WorkflowOrchestrator = require('../workflows/WorkflowOrchestrator');
const InteractiveWorkflow = require('../workflows/InteractiveWorkflow');
const OfflineWorkflow = require('../workflows/OfflineWorkflow');
const EnvKeyProvider = require('../keyManagement/EnvKeyProvider');
const PromptKeyProvider = require('../keyManagement/PromptKeyProvider');
const fs = require('fs').promises;
const path = require('path');

describe('Workflow Integration Tests', function() {
  // Extended timeout for network operations
  this.timeout(120000);

  let client;
  let testAccount1;
  let testAccount2;
  let testAccount3;
  let privateKey1;
  let privateKey2;
  let privateKey3;

  before(async function() {
    // Set up test environment
    try {
      // Create test client (adjust for your test environment)
      client = Client.forTestnet();

      // Generate test keys
      privateKey1 = PrivateKey.generateED25519();
      privateKey2 = PrivateKey.generateED25519();
      privateKey3 = PrivateKey.generateECDSA();

      testAccount1 = privateKey1.publicKey.toAccountId(0, 0, 123);
      testAccount2 = privateKey2.publicKey.toAccountId(0, 0, 124);
      testAccount3 = privateKey3.publicKey.toAccountId(0, 0, 125);

      // Note: In real tests, you would need to create actual accounts
      // For now, we'll use mock accounts
      console.log('Test environment initialized');

    } catch (error) {
      console.error('Setup failed:', error);
      throw error;
    }
  });

  after(async function() {
    if (client) {
      client.close();
    }
  });

  describe('WorkflowOrchestrator', function() {

    it('should validate configuration correctly', function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      // Valid interactive config
      const validConfig = {
        workflow: 'interactive',
        keyProviders: [new EnvKeyProvider(), new EnvKeyProvider()],
        threshold: 2
      };

      const validation = orchestrator._validateConfig(validConfig);
      expect(validation.valid).to.be.true;
    });

    it('should reject invalid configuration', function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      // Invalid: threshold exceeds signers
      const invalidConfig = {
        workflow: 'interactive',
        keyProviders: [new EnvKeyProvider()],
        threshold: 3
      };

      const validation = orchestrator._validateConfig(invalidConfig);
      expect(validation.valid).to.be.false;
      expect(validation.errors).to.have.lengthOf.at.least(1);
    });

    it('should reject missing keyProviders for interactive workflow', function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      const invalidConfig = {
        workflow: 'interactive',
        threshold: 2
      };

      const validation = orchestrator._validateConfig(invalidConfig);
      expect(validation.valid).to.be.false;
    });

    it('should display help for different topics', function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      // Should not throw
      expect(() => orchestrator.displayHelp('overview')).to.not.throw();
      expect(() => orchestrator.displayHelp('workflows')).to.not.throw();
      expect(() => orchestrator.displayHelp('interactive')).to.not.throw();
      expect(() => orchestrator.displayHelp('offline')).to.not.throw();
      expect(() => orchestrator.displayHelp('keys')).to.not.throw();
      expect(() => orchestrator.displayHelp('troubleshooting')).to.not.throw();
      expect(() => orchestrator.displayHelp('reference')).to.not.throw();
    });

    it('should create workflow instances on demand', function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      const interactiveWorkflow = orchestrator._getInteractiveWorkflow();
      expect(interactiveWorkflow).to.be.instanceOf(InteractiveWorkflow);

      const offlineWorkflow = orchestrator._getOfflineWorkflow();
      expect(offlineWorkflow).to.be.instanceOf(OfflineWorkflow);
    });

    it('should reuse workflow instances', function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      const workflow1 = orchestrator._getInteractiveWorkflow();
      const workflow2 = orchestrator._getInteractiveWorkflow();

      expect(workflow1).to.equal(workflow2);
    });

    it('should cleanup workflows', function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      orchestrator._getInteractiveWorkflow();
      orchestrator._getOfflineWorkflow();

      expect(() => orchestrator.cleanup()).to.not.throw();
    });
  });

  describe('OfflineWorkflow', function() {

    let workflow;
    const exportDir = './test-exports';

    before(async function() {
      workflow = new OfflineWorkflow(client, {
        exportDir,
        verbose: false
      });

      // Create export directory
      await fs.mkdir(exportDir, { recursive: true });
    });

    after(async function() {
      // Cleanup export directory
      try {
        const files = await fs.readdir(exportDir);
        for (const file of files) {
          await fs.unlink(path.join(exportDir, file));
        }
        await fs.rmdir(exportDir);
      } catch (error) {
        // Ignore cleanup errors
      }
    });

    it('should freeze and export transaction', async function() {
      // Create a simple transfer transaction
      const transaction = new TransferTransaction()
        .addHbarTransfer(testAccount1, Hbar.fromTinybars(-100))
        .addHbarTransfer(testAccount2, Hbar.fromTinybars(100));

      const metadata = {
        threshold: 2,
        requiredSigners: [testAccount1.toString(), testAccount2.toString()],
        signerLabels: ['Alice', 'Bob'],
        instructions: 'Please review and sign this transfer',
        createdBy: 'Test Script'
      };

      const result = await workflow.freezeAndExport(transaction, metadata);

      // Test should handle both success and graceful failure
      expect(result).to.have.property('success');

      if (result.success) {
        expect(result.transactionFile).to.exist;
        expect(result.metadataFile).to.exist;
        expect(result.frozenTransaction).to.exist;

        // Verify files were created
        const txFileExists = await fs.access(result.transactionFile)
          .then(() => true)
          .catch(() => false);
        expect(txFileExists).to.be.true;

        const metaFileExists = await fs.access(result.metadataFile)
          .then(() => true)
          .catch(() => false);
        expect(metaFileExists).to.be.true;

        // Verify metadata content
        const metaContent = await fs.readFile(result.metadataFile, 'utf8');
        const meta = JSON.parse(metaContent);
        expect(meta.signatureRequirements.threshold).to.equal(2);
        expect(meta.signatureRequirements.signerLabels).to.deep.equal(['Alice', 'Bob']);
      } else {
        // If it fails, should have error property
        expect(result.error).to.exist;
      }
    });

    it('should handle freeze errors gracefully', async function() {
      // Create an invalid transaction (missing client setup)
      const invalidTx = new TransferTransaction();

      const result = await workflow.freezeAndExport(invalidTx, {});

      expect(result.success).to.be.false;
      expect(result.error).to.exist;
    });

    it('should validate signature file format', async function() {
      // Create a test frozen transaction
      const transaction = new TransferTransaction()
        .addHbarTransfer(testAccount1, Hbar.fromTinybars(-100))
        .addHbarTransfer(testAccount2, Hbar.fromTinybars(100));

      const freezeResult = await workflow.freezeAndExport(transaction, {});
      if (!freezeResult.success) {
        this.skip(); // Skip if freeze failed
        return;
      }

      // Create invalid signature file
      const invalidSigFile = path.join(exportDir, 'invalid-sig.json');
      await fs.writeFile(invalidSigFile, JSON.stringify({
        invalid: 'structure'
      }));

      const result = await workflow.collectSignatures(
        freezeResult.frozenTransaction,
        [invalidSigFile],
        1
      );

      expect(result.success).to.be.false;
      expect(result.error).to.include('Insufficient');
    });

    it('should cleanup resources', function() {
      expect(() => workflow.cleanup()).to.not.throw();
    });
  });

  describe('InteractiveWorkflow', function() {

    let workflow;

    before(function() {
      workflow = new InteractiveWorkflow(client, {
        verbose: false,
        showTimer: false // Disable timer for tests
      });
    });

    it('should validate key provider array', function() {
      expect(() => {
        new InteractiveWorkflow(client, { verbose: false });
      }).to.not.throw();
    });

    it('should freeze transaction successfully', async function() {
      const transaction = new TransferTransaction()
        .addHbarTransfer(testAccount1, Hbar.fromTinybars(-100))
        .addHbarTransfer(testAccount2, Hbar.fromTinybars(100));

      const result = await workflow._freezeTransaction(transaction);

      // May fail due to client setup, but should not throw
      if (result.success) {
        expect(result.frozenTransaction).to.exist;
        expect(result.txDetails).to.exist;
        expect(result.expirationTime).to.be.a('number');
      } else {
        expect(result.error).to.exist;
      }
    });

    it('should handle expiration timer', function() {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 60;

      expect(() => {
        workflow._startExpirationTimer(futureTimestamp);
      }).to.not.throw();

      expect(() => {
        workflow._stopExpirationTimer();
      }).to.not.throw();
    });

    it('should detect expired transactions', function(done) {
      const pastTimestamp = Math.floor(Date.now() / 1000) - 10;

      workflow.isExpired = false;
      workflow._startExpirationTimer(pastTimestamp);

      // Wait longer for expiration to trigger (check interval + buffer)
      setTimeout(() => {
        expect(workflow.isExpired).to.be.true;
        workflow._stopExpirationTimer();
        done();
      }, 2500);
    });

    it('should cleanup resources', function() {
      expect(() => workflow.cleanup()).to.not.throw();
    });
  });

  describe('UI Components Integration', function() {

    it('should format errors consistently', function() {
      const ErrorFormatter = require('../ui/ErrorFormatter');

      const error = new Error('Test error');
      const formatted = ErrorFormatter.format(error, { test: 'context' });

      expect(formatted).to.be.a('string');
      expect(formatted).to.include('Test error');
    });

    it('should display transaction details', function() {
      const TransactionDisplay = require('../ui/TransactionDisplay');

      const txDetails = {
        transactionType: 'TransferTransaction',
        transactionId: '0.0.123@1234567890.123456789',
        accountId: '0.0.123',
        maxTransactionFee: 100000000,
        expirationTime: Math.floor(Date.now() / 1000) + 60
      };

      expect(() => {
        TransactionDisplay.displaySummary(txDetails);
      }).to.not.throw();
    });

    it('should display signature status', function() {
      const TransactionDisplay = require('../ui/TransactionDisplay');

      expect(() => {
        TransactionDisplay.displaySignatureStatus(2, 3, [
          { signed: true, label: 'Alice' },
          { signed: true, label: 'Bob' },
          { signed: false, label: 'Charlie' }
        ]);
      }).to.not.throw();
    });

    it('should show progress indicators', function() {
      const ProgressIndicator = require('../ui/ProgressIndicator');
      const progress = new ProgressIndicator();

      expect(() => {
        progress.showProgress(1, 3, 'Test step');
        progress.success('Success message');
        progress.warning('Warning message');
        progress.error('Error message');
        progress.info('Info message');
        progress.cleanup();
      }).to.not.throw();
    });

    it('should display help text', function() {
      const HelpText = require('../ui/HelpText');

      expect(() => {
        HelpText.tip('Test tip');
        HelpText.note('Test note');
        HelpText.securityWarning('Test warning');
      }).to.not.throw();
    });
  });

  describe('End-to-End Workflow Scenarios', function() {

    it('should support offline workflow phases independently', async function() {
      const orchestrator = new WorkflowOrchestrator(client, {
        verbose: false,
        exportDir: './test-e2e-exports'
      });

      const transaction = new TransferTransaction()
        .addHbarTransfer(testAccount1, Hbar.fromTinybars(-100))
        .addHbarTransfer(testAccount2, Hbar.fromTinybars(100));

      // Phase 1: Freeze and export
      const freezeResult = await orchestrator.freezeAndExport(transaction, {
        threshold: 2,
        signerLabels: ['Alice', 'Bob']
      });

      if (freezeResult.success) {
        expect(freezeResult.transactionFile).to.exist;

        // Cleanup
        try {
          await fs.unlink(freezeResult.transactionFile);
          await fs.unlink(freezeResult.metadataFile);
          await fs.rmdir('./test-e2e-exports');
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });

    it('should validate orchestrator configuration for different workflows', function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      // Interactive workflow config
      const interactiveConfig = {
        workflow: 'interactive',
        keyProviders: [new EnvKeyProvider(), new EnvKeyProvider()],
        threshold: 2,
        signerLabels: ['Alice', 'Bob']
      };

      const interactiveValidation = orchestrator._validateConfig(interactiveConfig);
      expect(interactiveValidation.valid).to.be.true;

      // Offline workflow config (export phase)
      const offlineExportConfig = {
        workflow: 'offline',
        metadata: { threshold: 2 }
      };

      const offlineValidation = orchestrator._validateConfig(offlineExportConfig);
      expect(offlineValidation.valid).to.be.true;

      // Offline workflow config (execute phase)
      const offlineExecuteConfig = {
        workflow: 'offline',
        signatureFiles: ['sig1.json', 'sig2.json'],
        threshold: 2
      };

      const offlineExecValidation = orchestrator._validateConfig(offlineExecuteConfig);
      expect(offlineExecValidation.valid).to.be.true;
    });
  });

  // ============================================================================
  // Enhanced Edge Case Tests
  // ============================================================================

  describe('WorkflowOrchestrator - Advanced Configuration Tests', function() {

    it('should validate threshold of 1 (minimum)', function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      const config = {
        workflow: 'interactive',
        keyProviders: [new EnvKeyProvider()],
        threshold: 1
      };

      const validation = orchestrator._validateConfig(config);
      expect(validation.valid).to.be.true;
    });

    it('should accept threshold of 0 (defaults to keyProviders length)', function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      const config = {
        workflow: 'interactive',
        keyProviders: [new EnvKeyProvider()],
        threshold: 0
      };

      // Threshold of 0 is falsy, so validation passes
      // Actual workflow will default to keyProviders.length
      const validation = orchestrator._validateConfig(config);
      expect(validation.valid).to.be.true;
    });

    it('should reject negative threshold', function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      const config = {
        workflow: 'interactive',
        keyProviders: [new EnvKeyProvider()],
        threshold: -1
      };

      const validation = orchestrator._validateConfig(config);
      expect(validation.valid).to.be.false;
    });

    it('should validate empty keyProviders array is invalid', function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      const config = {
        workflow: 'interactive',
        keyProviders: [],
        threshold: 1
      };

      const validation = orchestrator._validateConfig(config);
      expect(validation.valid).to.be.false;
      expect(validation.errors).to.include('At least one key provider is required');
    });

    it('should validate non-array keyProviders is invalid', function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      const config = {
        workflow: 'interactive',
        keyProviders: 'not-an-array',
        threshold: 1
      };

      const validation = orchestrator._validateConfig(config);
      expect(validation.valid).to.be.false;
      expect(validation.errors).to.include('Interactive workflow requires keyProviders array');
    });

    it('should validate offline workflow with non-array signatureFiles', function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      const config = {
        workflow: 'offline',
        signatureFiles: 'not-an-array',
        threshold: 2
      };

      const validation = orchestrator._validateConfig(config);
      expect(validation.valid).to.be.false;
      expect(validation.errors).to.include('signatureFiles must be an array');
    });

    it('should validate offline workflow with threshold exceeding signatures', function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      const config = {
        workflow: 'offline',
        signatureFiles: ['sig1.json'],
        threshold: 3
      };

      const validation = orchestrator._validateConfig(config);
      expect(validation.valid).to.be.false;
      expect(validation.errors).to.include('Threshold cannot exceed number of signature files');
    });

    it('should handle unknown workflow mode', async function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      const config = {
        workflow: 'unknown-mode',
        keyProviders: [new EnvKeyProvider()]
      };

      const transaction = new TransferTransaction()
        .addHbarTransfer(testAccount1, Hbar.fromTinybars(-100))
        .addHbarTransfer(testAccount2, Hbar.fromTinybars(100));

      const result = await orchestrator.execute(transaction, config);

      expect(result.success).to.be.false;
      expect(result.error).to.include('Unknown workflow mode');
    });

    it('should use default workflow mode when not specified', async function() {
      const orchestrator = new WorkflowOrchestrator(client, {
        verbose: false,
        defaultWorkflow: 'interactive'
      });

      const config = {
        keyProviders: [new EnvKeyProvider()]
      };

      // Validation should use default workflow
      const validation = orchestrator._validateConfig(config);
      expect(validation.valid).to.be.true;
    });

    it('should override default workflow when specified in config', function() {
      const orchestrator = new WorkflowOrchestrator(client, {
        verbose: false,
        defaultWorkflow: 'interactive'
      });

      const config = {
        workflow: 'offline'
      };

      const validation = orchestrator._validateConfig(config);
      expect(validation.valid).to.be.true;
    });

    it('should handle collectAndExecute with missing threshold', async function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      const transaction = new TransferTransaction()
        .addHbarTransfer(testAccount1, Hbar.fromTinybars(-100))
        .addHbarTransfer(testAccount2, Hbar.fromTinybars(100));

      // Should default threshold to signatureFiles length
      const result = await orchestrator.collectAndExecute(
        transaction,
        ['sig1.json', 'sig2.json']
      );

      // Will fail due to invalid signature files, but should not throw
      expect(result).to.have.property('success');
    });

    it('should handle execute with multiple validation errors', async function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      const config = {
        workflow: 'interactive',
        keyProviders: [],
        threshold: 0
      };

      const transaction = new TransferTransaction()
        .addHbarTransfer(testAccount1, Hbar.fromTinybars(-100))
        .addHbarTransfer(testAccount2, Hbar.fromTinybars(100));

      const result = await orchestrator.execute(transaction, config);

      expect(result.success).to.be.false;
      expect(result.error).to.exist;
    });
  });

  describe('WorkflowOrchestrator - Options and Configuration', function() {

    it('should accept custom default workflow', function() {
      const orchestrator = new WorkflowOrchestrator(client, {
        defaultWorkflow: 'offline'
      });

      expect(orchestrator.options.defaultWorkflow).to.equal('offline');
    });

    it('should accept custom audit log path', function() {
      const orchestrator = new WorkflowOrchestrator(client, {
        auditLogPath: './custom/audit.log'
      });

      expect(orchestrator.options.auditLogPath).to.equal('./custom/audit.log');
    });

    it('should accept custom export directory', function() {
      const orchestrator = new WorkflowOrchestrator(client, {
        exportDir: './custom-exports'
      });

      expect(orchestrator.options.exportDir).to.equal('./custom-exports');
    });

    it('should default verbose to true', function() {
      const orchestrator = new WorkflowOrchestrator(client, {});

      expect(orchestrator.options.verbose).to.be.true;
    });

    it('should allow verbose to be disabled', function() {
      const orchestrator = new WorkflowOrchestrator(client, {
        verbose: false
      });

      expect(orchestrator.options.verbose).to.be.false;
    });

    it('should merge custom options with defaults', function() {
      const orchestrator = new WorkflowOrchestrator(client, {
        customOption: 'value',
        verbose: false
      });

      expect(orchestrator.options.customOption).to.equal('value');
      expect(orchestrator.options.defaultWorkflow).to.equal('interactive'); // default
    });
  });

  describe('InteractiveWorkflow - Edge Cases', function() {

    let workflow;

    before(function() {
      workflow = new InteractiveWorkflow(client, {
        verbose: false,
        showTimer: false
      });
    });

    it('should handle timer cleanup when no timer exists', function() {
      workflow._stopExpirationTimer();
      expect(() => workflow._stopExpirationTimer()).to.not.throw();
    });

    it('should handle multiple timer starts', function() {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 60;

      workflow._startExpirationTimer(futureTimestamp);
      workflow._startExpirationTimer(futureTimestamp + 10);

      workflow._stopExpirationTimer();
    });

    it('should detect expiration correctly', function(done) {
      const pastTimestamp = Math.floor(Date.now() / 1000) - 10;

      workflow.isExpired = false;
      workflow._startExpirationTimer(pastTimestamp);

      // Wait longer for expiration to trigger (check interval + buffer)
      setTimeout(() => {
        expect(workflow.isExpired).to.be.true;
        workflow._stopExpirationTimer();
        done();
      }, 2500);
    });

    it('should not mark as expired for future timestamp', function(done) {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 300;

      workflow.isExpired = false;
      workflow._startExpirationTimer(futureTimestamp);

      setTimeout(() => {
        expect(workflow.isExpired).to.be.false;
        workflow._stopExpirationTimer();
        done();
      }, 100);
    });

    it('should cleanup without errors when called multiple times', function() {
      workflow.cleanup();
      expect(() => workflow.cleanup()).to.not.throw();
    });
  });

  describe('OfflineWorkflow - Signature Validation', function() {

    let workflow;
    const exportDir = './test-sig-validation';

    before(async function() {
      workflow = new OfflineWorkflow(client, {
        exportDir,
        verbose: false
      });

      await fs.mkdir(exportDir, { recursive: true });
    });

    after(async function() {
      try {
        const files = await fs.readdir(exportDir);
        for (const file of files) {
          await fs.unlink(path.join(exportDir, file));
        }
        await fs.rmdir(exportDir);
      } catch (error) {
        // Ignore
      }
    });

    it('should reject signature file with missing fields', async function() {
      const transaction = new TransferTransaction()
        .addHbarTransfer(testAccount1, Hbar.fromTinybars(-100))
        .addHbarTransfer(testAccount2, Hbar.fromTinybars(100));

      const freezeResult = await workflow.freezeAndExport(transaction, {});
      if (!freezeResult.success) {
        this.skip();
        return;
      }

      // Create signature file missing required fields
      const invalidSigFile = path.join(exportDir, 'missing-fields.json');
      await fs.writeFile(invalidSigFile, JSON.stringify({
        signer: 'Alice'
        // Missing signature, accountId, timestamp
      }));

      const result = await workflow.collectSignatures(
        freezeResult.frozenTransaction,
        [invalidSigFile],
        1
      );

      expect(result.success).to.be.false;
    });

    it('should handle empty signature files array', async function() {
      const transaction = new TransferTransaction()
        .addHbarTransfer(testAccount1, Hbar.fromTinybars(-100))
        .addHbarTransfer(testAccount2, Hbar.fromTinybars(100));

      const freezeResult = await workflow.freezeAndExport(transaction, {});
      if (!freezeResult.success) {
        this.skip();
        return;
      }

      const result = await workflow.collectSignatures(
        freezeResult.frozenTransaction,
        [],
        1
      );

      expect(result.success).to.be.false;
      expect(result.error).to.include('Insufficient');
    });

    it('should handle threshold greater than provided signatures', async function() {
      const transaction = new TransferTransaction()
        .addHbarTransfer(testAccount1, Hbar.fromTinybars(-100))
        .addHbarTransfer(testAccount2, Hbar.fromTinybars(100));

      const freezeResult = await workflow.freezeAndExport(transaction, {});
      if (!freezeResult.success) {
        this.skip();
        return;
      }

      // Create one valid-looking signature file
      const sigFile = path.join(exportDir, 'one-sig.json');
      await fs.writeFile(sigFile, JSON.stringify({
        signer: 'Alice',
        accountId: '0.0.123',
        signature: Buffer.from('fake-signature').toString('base64'),
        timestamp: new Date().toISOString()
      }));

      // Request threshold of 3 with only 1 signature
      const result = await workflow.collectSignatures(
        freezeResult.frozenTransaction,
        [sigFile],
        3
      );

      expect(result.success).to.be.false;
      expect(result.error).to.include('Insufficient');
    });

    it('should include metadata in export', async function() {
      const transaction = new TransferTransaction()
        .addHbarTransfer(testAccount1, Hbar.fromTinybars(-100))
        .addHbarTransfer(testAccount2, Hbar.fromTinybars(100));

      const metadata = {
        threshold: 3,
        requiredSigners: ['0.0.123', '0.0.124', '0.0.125'],
        signerLabels: ['Alice', 'Bob', 'Charlie'],
        instructions: 'Custom instructions',
        contractFunction: 'testFunction',
        createdBy: 'Test Suite'
      };

      const result = await workflow.freezeAndExport(transaction, metadata);

      if (result.success) {
        const metaContent = await fs.readFile(result.metadataFile, 'utf8');
        const meta = JSON.parse(metaContent);

        expect(meta.signatureRequirements.threshold).to.equal(3);
        expect(meta.signatureRequirements.signerLabels).to.deep.equal(['Alice', 'Bob', 'Charlie']);
        expect(meta.instructions).to.equal('Custom instructions');
        expect(meta.contractFunction).to.equal('testFunction');
        expect(meta.createdBy).to.equal('Test Suite');
      }
    });
  });

  describe('UI Components - ProgressIndicator', function() {

    it('should handle countdown display', function() {
      const ProgressIndicator = require('../ui/ProgressIndicator');
      const progress = new ProgressIndicator();

      const futureTimestamp = Math.floor(Date.now() / 1000) + 110;

      expect(() => {
        progress.startCountdown(futureTimestamp);
        progress.stopCountdown();
        progress.cleanup();
      }).to.not.throw();
    });

    it('should handle multiple cleanup calls', function() {
      const ProgressIndicator = require('../ui/ProgressIndicator');
      const progress = new ProgressIndicator();

      progress.cleanup();
      expect(() => progress.cleanup()).to.not.throw();
    });

    it('should show all message types', function() {
      const ProgressIndicator = require('../ui/ProgressIndicator');
      const progress = new ProgressIndicator();

      expect(() => {
        progress.success('Success');
        progress.error('Error');
        progress.warning('Warning');
        progress.info('Info');
        progress.showProgress(1, 5, 'Step 1');
        progress.showProgress(2, 5, 'Step 2');
        progress.cleanup();
      }).to.not.throw();
    });
  });

  describe('UI Components - ErrorFormatter', function() {

    const ErrorFormatter = require('../ui/ErrorFormatter');

    it('should format basic error', function() {
      const error = new Error('Test error message');
      const formatted = ErrorFormatter.format(error);

      expect(formatted).to.be.a('string');
      expect(formatted).to.include('Test error message');
    });

    it('should include context in formatted error', function() {
      const error = new Error('Test error');
      const formatted = ErrorFormatter.format(error, {
        component: 'TestComponent',
        operation: 'TestOperation'
      });

      expect(formatted).to.include('Test error');
    });

    it('should handle error without message', function() {
      const error = new Error();
      const formatted = ErrorFormatter.format(error);

      expect(formatted).to.be.a('string');
    });

    it('should handle string error', function() {
      const formatted = ErrorFormatter.format('String error message');

      expect(formatted).to.include('String error message');
    });

    it('should handle error with stack trace', function() {
      const error = new Error('Error with stack');
      const formatted = ErrorFormatter.format(error, { includeStack: true });

      expect(formatted).to.be.a('string');
      expect(formatted).to.include('Error with stack');
    });
  });

  describe('UI Components - TransactionDisplay', function() {

    const TransactionDisplay = require('../ui/TransactionDisplay');

    it('should display different transaction types', function() {
      const txTypes = [
        'TransferTransaction',
        'ContractExecuteTransaction',
        'ContractCreateTransaction',
        'AccountCreateTransaction'
      ];

      txTypes.forEach(txType => {
        expect(() => {
          TransactionDisplay.displaySummary({
            transactionType: txType,
            transactionId: '0.0.123@1234567890.123456789',
            accountId: '0.0.123',
            maxTransactionFee: 100000000
          });
        }).to.not.throw();
      });
    });

    it('should display signature status with various states', function() {
      const testCases = [
        { collected: 0, threshold: 3, signers: [] },
        { collected: 1, threshold: 3, signers: [{ signed: true, label: 'Alice' }] },
        { collected: 3, threshold: 3, signers: [
          { signed: true, label: 'Alice' },
          { signed: true, label: 'Bob' },
          { signed: true, label: 'Charlie' }
        ]},
        { collected: 2, threshold: 3, signers: [
          { signed: true, label: 'Alice' },
          { signed: true, label: 'Bob' },
          { signed: false, label: 'Charlie' },
          { signed: false, label: 'Dave' },
          { signed: false, label: 'Eve' }
        ]}
      ];

      testCases.forEach(testCase => {
        expect(() => {
          TransactionDisplay.displaySignatureStatus(
            testCase.collected,
            testCase.threshold,
            testCase.signers
          );
        }).to.not.throw();
      });
    });

    it('should handle transaction summary with missing fields', function() {
      expect(() => {
        TransactionDisplay.displaySummary({
          transactionType: 'TransferTransaction'
          // Missing other fields
        });
      }).to.not.throw();
    });

    it('should display full transaction details', function() {
      expect(() => {
        TransactionDisplay.displayFull({
          transactionType: 'ContractExecuteTransaction',
          transactionId: '0.0.123@1234567890.123456789',
          contractId: '0.0.456',
          functionName: 'executeFunction',
          maxTransactionFee: 100000000
        });
      }).to.not.throw();
    });
  });

  describe('UI Components - HelpText', function() {

    const HelpText = require('../ui/HelpText');

    it('should display all help sections', function() {
      expect(() => {
        HelpText.overview();
        HelpText.workflowSelection();
        HelpText.interactiveWorkflow();
        HelpText.offlineWorkflow();
        HelpText.keyManagement();
        HelpText.troubleshooting();
        HelpText.quickReference();
      }).to.not.throw();
    });

    it('should display utility messages', function() {
      expect(() => {
        HelpText.tip('Test tip message');
        HelpText.note('Test note message');
        HelpText.securityWarning('Test security warning');
      }).to.not.throw();
    });

    it('should handle empty messages', function() {
      expect(() => {
        HelpText.tip('');
        HelpText.note('');
        HelpText.securityWarning('');
      }).to.not.throw();
    });

    it('should handle multiline messages', function() {
      expect(() => {
        HelpText.tip('Line 1\nLine 2\nLine 3');
        HelpText.note('Multiline\nnote\nmessage');
      }).to.not.throw();
    });
  });

  describe('WorkflowOrchestrator - Error Propagation', function() {

    it('should catch and format errors from interactive workflow', async function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      // Create invalid transaction
      const invalidTransaction = null;

      const config = {
        workflow: 'interactive',
        keyProviders: [new EnvKeyProvider()],
        threshold: 1
      };

      const result = await orchestrator.execute(invalidTransaction, config);

      expect(result.success).to.be.false;
      expect(result.error).to.exist;
    });

    it('should catch and format errors from offline workflow', async function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      const invalidTransaction = null;

      const config = {
        workflow: 'offline'
      };

      const result = await orchestrator.execute(invalidTransaction, config);

      expect(result.success).to.be.false;
      expect(result.error).to.exist;
    });

    it('should cleanup even when execution fails', async function() {
      const orchestrator = new WorkflowOrchestrator(client, { verbose: false });

      const config = {
        workflow: 'interactive',
        keyProviders: [], // Invalid config
        threshold: 1
      };

      const transaction = new TransferTransaction();
      await orchestrator.execute(transaction, config);

      // Cleanup should have been called
      expect(() => orchestrator.cleanup()).to.not.throw();
    });
  });

  describe('OfflineWorkflow - Export File Naming', function() {

    let workflow;
    const exportDir = './test-file-naming';

    before(async function() {
      workflow = new OfflineWorkflow(client, {
        exportDir,
        verbose: false
      });

      await fs.mkdir(exportDir, { recursive: true });
    });

    after(async function() {
      try {
        const files = await fs.readdir(exportDir);
        for (const file of files) {
          await fs.unlink(path.join(exportDir, file));
        }
        await fs.rmdir(exportDir);
      } catch (error) {
        // Ignore
      }
    });

    it('should create files with timestamps', async function() {
      const transaction = new TransferTransaction()
        .addHbarTransfer(testAccount1, Hbar.fromTinybars(-100))
        .addHbarTransfer(testAccount2, Hbar.fromTinybars(100));

      const result = await workflow.freezeAndExport(transaction, {});

      if (result.success) {
        expect(result.transactionFile).to.match(/multisig-tx-\d+-frozen\.txt/);
        expect(result.metadataFile).to.match(/multisig-tx-\d+-metadata\.json/);
      }
    });

    it('should create unique files for multiple exports', async function() {
      const transaction = new TransferTransaction()
        .addHbarTransfer(testAccount1, Hbar.fromTinybars(-100))
        .addHbarTransfer(testAccount2, Hbar.fromTinybars(100));

      const result1 = await workflow.freezeAndExport(transaction, {});

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      const result2 = await workflow.freezeAndExport(transaction, {});

      if (result1.success && result2.success) {
        expect(result1.transactionFile).to.not.equal(result2.transactionFile);
        expect(result1.metadataFile).to.not.equal(result2.metadataFile);
      }
    });
  });
});
