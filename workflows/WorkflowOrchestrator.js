/**
 * Workflow Orchestrator
 *
 * Main entry point for multi-signature operations.
 * Coordinates workflow selection, validation, and execution.
 *
 * Supports:
 * - Interactive workflow (real-time, <110s)
 * - Offline workflow (manual coordination, air-gapped)
 * - Automatic workflow selection based on configuration
 */

const chalk = require('chalk');
const InteractiveWorkflow = require('./InteractiveWorkflow');
const OfflineWorkflow = require('./OfflineWorkflow');
const ErrorFormatter = require('../ui/ErrorFormatter');
const HelpText = require('../ui/HelpText');
const ProgressIndicator = require('../ui/ProgressIndicator');

class WorkflowOrchestrator {
  constructor(client, options = {}) {
    this.client = client;
    this.options = {
      defaultWorkflow: options.defaultWorkflow || 'interactive',
      auditLogPath: options.auditLogPath || './logs/audit.log',
      exportDir: options.exportDir || './multisig-transactions',
      verbose: options.verbose !== false,
      ...options
    };

    this.progress = new ProgressIndicator();
    this.workflows = {
      interactive: null,
      offline: null
    };
  }

  /**
   * Execute a multi-signature transaction
   *
   * @param {Transaction} transaction - Hedera transaction to execute
   * @param {Object} config - Multi-signature configuration
   * @returns {Object} Execution results
   */
  async execute(transaction, config) {
    try {
      // Validate configuration
      const validation = this._validateConfig(config);
      if (!validation.valid) {
        throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
      }

      // Determine workflow mode
      const workflowMode = config.workflow || this.options.defaultWorkflow;

      if (this.options.verbose) {
        this._displayWorkflowInfo(workflowMode, config);
      }

      // Execute appropriate workflow
      let result;
      switch (workflowMode) {
        case 'interactive':
          result = await this._executeInteractive(transaction, config);
          break;

        case 'offline':
          result = await this._executeOffline(transaction, config);
          break;

        default:
          throw new Error(`Unknown workflow mode: ${workflowMode}`);
      }

      return result;

    } catch (error) {
      const formatted = ErrorFormatter.format(error, {
        component: 'WorkflowOrchestrator',
        workflow: config.workflow || 'unknown'
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
   * Freeze and export transaction for offline signing
   *
   * @param {Transaction} transaction - Transaction to freeze
   * @param {Object} metadata - Transaction metadata
   * @returns {Object} Export results
   */
  async freezeAndExport(transaction, metadata = {}) {
    try {
      const workflow = this._getOfflineWorkflow();
      return await workflow.freezeAndExport(transaction, metadata);

    } catch (error) {
      const formatted = ErrorFormatter.format(error, {
        component: 'WorkflowOrchestrator',
        operation: 'Freeze & Export'
      });
      console.error(formatted);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Collect signatures and execute (offline workflow completion)
   *
   * @param {Transaction} frozenTransaction - Frozen transaction
   * @param {Array<Object>} signatureFiles - Signature files or objects
   * @param {Object} config - Execution configuration
   * @returns {Object} Execution results
   */
  async collectAndExecute(frozenTransaction, signatureFiles, config = {}) {
    try {
      const workflow = this._getOfflineWorkflow();
      const threshold = config.threshold || signatureFiles.length;

      // Collect signatures
      const collectionResult = await workflow.collectSignatures(
        frozenTransaction,
        signatureFiles,
        threshold
      );

      if (!collectionResult.success) {
        return collectionResult;
      }

      // Execute transaction
      const executionResult = await workflow.executeTransaction(
        frozenTransaction,
        collectionResult.signatures
      );

      return executionResult;

    } catch (error) {
      const formatted = ErrorFormatter.format(error, {
        component: 'WorkflowOrchestrator',
        operation: 'Collect & Execute'
      });
      console.error(formatted);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Display help information
   *
   * @param {string} topic - Specific help topic (optional)
   */
  displayHelp(topic = null) {
    switch (topic) {
      case 'overview':
        HelpText.overview();
        break;

      case 'workflows':
      case 'workflow':
        HelpText.workflowSelection();
        break;

      case 'interactive':
        HelpText.interactiveWorkflow();
        break;

      case 'offline':
        HelpText.offlineWorkflow();
        break;

      case 'keys':
      case 'key-management':
        HelpText.keyManagement();
        break;

      case 'troubleshooting':
      case 'troubleshoot':
        HelpText.troubleshooting();
        break;

      case 'quick':
      case 'reference':
        HelpText.quickReference();
        break;

      default:
        // Display all help
        HelpText.overview();
        HelpText.workflowSelection();
        HelpText.quickReference();
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Execute interactive workflow
   * @private
   */
  async _executeInteractive(transaction, config) {
    const workflow = this._getInteractiveWorkflow();

    const {
      keyProviders,
      threshold,
      signerLabels,
      metadata
    } = config;

    return await workflow.run(transaction, keyProviders, {
      threshold: threshold || keyProviders.length,
      signerLabels: signerLabels || [],
      metadata: metadata || {}
    });
  }

  /**
   * Execute offline workflow
   * @private
   */
  async _executeOffline(transaction, config) {
    const workflow = this._getOfflineWorkflow();

    const {
      signatureFiles,
      threshold,
      metadata,
      skipExport
    } = config;

    if (!signatureFiles && !skipExport) {
      // Phase 1: Just freeze and export
      return await workflow.freezeAndExport(transaction, metadata || {});
    } else {
      // Complete workflow or Phase 2+3
      return await workflow.run(transaction, signatureFiles, {
        threshold: threshold || (signatureFiles ? signatureFiles.length : 1),
        metadata: metadata || {},
        skipExport: skipExport || false
      });
    }
  }

  /**
   * Get or create interactive workflow instance
   * @private
   */
  _getInteractiveWorkflow() {
    if (!this.workflows.interactive) {
      this.workflows.interactive = new InteractiveWorkflow(this.client, {
        auditLogPath: this.options.auditLogPath,
        verbose: this.options.verbose
      });
    }
    return this.workflows.interactive;
  }

  /**
   * Get or create offline workflow instance
   * @private
   */
  _getOfflineWorkflow() {
    if (!this.workflows.offline) {
      this.workflows.offline = new OfflineWorkflow(this.client, {
        exportDir: this.options.exportDir,
        auditLogPath: this.options.auditLogPath,
        verbose: this.options.verbose
      });
    }
    return this.workflows.offline;
  }

  /**
   * Validate multi-signature configuration
   * @private
   */
  _validateConfig(config) {
    const errors = [];

    // Workflow-specific validation
    const workflow = config.workflow || this.options.defaultWorkflow;

    if (workflow === 'interactive') {
      if (!config.keyProviders || !Array.isArray(config.keyProviders)) {
        errors.push('Interactive workflow requires keyProviders array');
      } else if (config.keyProviders.length === 0) {
        errors.push('At least one key provider is required');
      } else if (config.threshold && config.threshold > config.keyProviders.length) {
        errors.push('Threshold cannot exceed number of key providers');
      }
    }

    if (workflow === 'offline') {
      // Offline can run in two modes:
      // 1. Freeze & Export (no signatures yet)
      // 2. Collect & Execute (with signatures)
      // Both are valid, so we only validate if signatureFiles are provided

      if (config.signatureFiles && !Array.isArray(config.signatureFiles)) {
        errors.push('signatureFiles must be an array');
      }

      if (config.signatureFiles && config.threshold && config.threshold > config.signatureFiles.length) {
        errors.push('Threshold cannot exceed number of signature files');
      }
    }

    // General validation
    if (config.threshold && config.threshold < 1) {
      errors.push('Threshold must be at least 1');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Display workflow information
   * @private
   */
  _displayWorkflowInfo(workflowMode, config) {
    console.log('\n' + chalk.bold.cyan('Multi-Signature Transaction'));
    console.log(chalk.cyan('─'.repeat(50)));
    console.log(chalk.white('Workflow Mode: ') + chalk.yellow(workflowMode.toUpperCase()));

    if (workflowMode === 'interactive') {
      const signers = config.keyProviders.length;
      const threshold = config.threshold || signers;
      console.log(chalk.white('Signers: ') + chalk.cyan(`${signers} total`));
      console.log(chalk.white('Threshold: ') + chalk.cyan(`${threshold} required`));
      console.log(chalk.white('Time Limit: ') + chalk.yellow('110 seconds'));
    } else if (workflowMode === 'offline') {
      if (config.signatureFiles) {
        const threshold = config.threshold || config.signatureFiles.length;
        console.log(chalk.white('Signatures: ') + chalk.cyan(`${config.signatureFiles.length} provided`));
        console.log(chalk.white('Threshold: ') + chalk.cyan(`${threshold} required`));
      } else {
        console.log(chalk.white('Mode: ') + chalk.yellow('Freeze & Export'));
      }
    }

    console.log(chalk.cyan('─'.repeat(50)) + '\n');
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.workflows.interactive) {
      this.workflows.interactive.cleanup();
    }
    if (this.workflows.offline) {
      this.workflows.offline.cleanup();
    }
    this.progress.cleanup();
  }
}

module.exports = WorkflowOrchestrator;
