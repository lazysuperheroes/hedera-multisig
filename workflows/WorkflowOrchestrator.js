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
const fs = require('fs');
const path = require('path');
const InteractiveWorkflow = require('./InteractiveWorkflow');
const OfflineWorkflow = require('./OfflineWorkflow');
const ErrorFormatter = require('../ui/ErrorFormatter');
const HelpText = require('../ui/HelpText');
const ProgressIndicator = require('../ui/ProgressIndicator');
const { SigningSessionManager, WebSocketServer } = require('../server');

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
      offline: null,
      networked: {
        sessionManager: null,
        wsServer: null
      }
    };
    this.activeSessionFile = path.join(process.cwd(), '.multisig-session');
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

        case 'networked':
          result = await this._executeNetworked(transaction, config);
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
   * Create a networked multi-signature session (pre-session pattern)
   *
   * @param {Object} config - Session configuration
   * @returns {Object} Session information with server details
   */
  async createNetworkedSession(config) {
    try {
      const validation = this._validateNetworkedConfig(config, true);
      if (!validation.valid) {
        throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
      }

      // Create session manager
      const sessionManager = new SigningSessionManager(this.client, {
        defaultTimeout: config.timeout || 1800000, // 30 minutes
        verbose: this.options.verbose
      });

      // Create pre-session (no transaction yet)
      const session = await sessionManager.createSession(null, {
        threshold: config.threshold,
        eligiblePublicKeys: config.eligiblePublicKeys,
        expectedParticipants: config.expectedParticipants || config.eligiblePublicKeys.length,
        timeout: config.timeout,
        pin: config.pin,
        ...config.eventHandlers
      });

      // Create and start WebSocket server
      const wsServer = new WebSocketServer(sessionManager, {
        port: config.port || 3000,
        host: config.host || 'localhost',
        verbose: this.options.verbose,
        tunnel: config.tunnel !== false ? {
          enabled: true,
          provider: config.tunnelProvider || 'auto'
        } : null
      });

      const serverInfo = await wsServer.start();

      // Store references
      this.workflows.networked.sessionManager = sessionManager;
      this.workflows.networked.wsServer = wsServer;

      // Write session ID to file for executeWithSession
      this._writeActiveSession(session.sessionId);

      if (this.options.verbose) {
        console.log(chalk.bold.green('\n✅ Networked session created successfully!\n'));
        console.log(chalk.cyan('═'.repeat(60)));
        console.log(chalk.white('Session ID: ') + chalk.yellow(session.sessionId));
        console.log(chalk.white('PIN: ') + chalk.bold.yellow(session.pin));

        if (serverInfo.publicUrl) {
          console.log(chalk.white('Public URL: ') + chalk.yellow(serverInfo.publicUrl));
          console.log(chalk.white('Local URL: ') + chalk.gray(serverInfo.url));
        } else {
          console.log(chalk.white('Server URL: ') + chalk.yellow(serverInfo.url));
        }

        console.log(chalk.white('Threshold: ') + chalk.yellow(`${config.threshold} of ${config.eligiblePublicKeys.length}`));
        console.log(chalk.white('Expires: ') + chalk.yellow(new Date(session.expiresAt).toLocaleString()));
        console.log(chalk.cyan('═'.repeat(60)) + '\n');
      }

      return {
        success: true,
        session,
        serverInfo,
        shareUrl: serverInfo.publicUrl || serverInfo.url
      };

    } catch (error) {
      const formatted = ErrorFormatter.format(error, {
        component: 'WorkflowOrchestrator',
        operation: 'Create Networked Session'
      });
      console.error(formatted);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute transaction with existing networked session
   *
   * @param {Transaction} transaction - Hedera transaction to execute
   * @param {Object} options - Execution options
   * @returns {Object} Execution result
   */
  async executeWithSession(transaction, options = {}) {
    try {
      const sessionId = options.sessionId || this._readActiveSession();

      if (!sessionId) {
        throw new Error('No active session found. Create a session first with createNetworkedSession()');
      }

      const sessionManager = this.workflows.networked.sessionManager;

      if (!sessionManager) {
        throw new Error('Session manager not initialized. Create a session first.');
      }

      // Freeze transaction
      if (!transaction._isFrozen) {
        transaction.freezeWith(this.client);
      }

      // Inject transaction into session
      const result = await sessionManager.injectTransaction(sessionId, transaction, {
        metadata: options.metadata,
        contractInterface: options.contractInterface
      });

      if (this.options.verbose) {
        console.log(chalk.green('\n✅ Transaction injected into session'));
        console.log(chalk.white('   Participants will now review and sign...\n'));
      }

      return {
        success: true,
        sessionId,
        status: result.status,
        txDetails: result.txDetails
      };

    } catch (error) {
      const formatted = ErrorFormatter.format(error, {
        component: 'WorkflowOrchestrator',
        operation: 'Execute with Session'
      });
      console.error(formatted);

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Detect active networked session
   *
   * @returns {string|null} Session ID or null
   */
  detectActiveSession() {
    return this._readActiveSession();
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
   * Execute networked workflow
   * @private
   */
  async _executeNetworked(transaction, config) {
    const {
      sessionId,
      threshold,
      eligiblePublicKeys,
      expectedParticipants,
      metadata,
      contractInterface
    } = config;

    // Check if session already exists
    const existingSessionId = sessionId || this._readActiveSession();

    if (existingSessionId) {
      // Inject transaction into existing session
      return await this.executeWithSession(transaction, {
        sessionId: existingSessionId,
        metadata,
        contractInterface
      });
    } else {
      // Create new session and inject transaction
      // Validation
      const validation = this._validateNetworkedConfig(config, false);
      if (!validation.valid) {
        throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
      }

      // Create session
      const sessionResult = await this.createNetworkedSession({
        threshold,
        eligiblePublicKeys,
        expectedParticipants,
        ...config
      });

      if (!sessionResult.success) {
        return sessionResult;
      }

      // Inject transaction
      return await this.executeWithSession(transaction, {
        sessionId: sessionResult.session.sessionId,
        metadata,
        contractInterface
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

    if (workflow === 'networked') {
      const validation = this._validateNetworkedConfig(config, false);
      errors.push(...validation.errors);
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
   * Validate networked workflow configuration
   * @private
   */
  _validateNetworkedConfig(config, isPreSession) {
    const errors = [];

    // For new sessions (not using existing sessionId)
    if (!config.sessionId && isPreSession !== false) {
      if (!config.threshold) {
        errors.push('Networked workflow requires threshold');
      }

      if (!config.eligiblePublicKeys || !Array.isArray(config.eligiblePublicKeys)) {
        errors.push('Networked workflow requires eligiblePublicKeys array');
      } else if (config.eligiblePublicKeys.length === 0) {
        errors.push('At least one eligible public key is required');
      } else if (config.threshold && config.threshold > config.eligiblePublicKeys.length) {
        errors.push('Threshold cannot exceed number of eligible keys');
      }
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
    } else if (workflowMode === 'networked') {
      const threshold = config.threshold || 'N/A';
      const participants = config.expectedParticipants || config.eligiblePublicKeys?.length || 'N/A';
      console.log(chalk.white('Threshold: ') + chalk.cyan(`${threshold} signatures required`));
      console.log(chalk.white('Expected Participants: ') + chalk.cyan(participants));
      console.log(chalk.white('Session Timeout: ') + chalk.yellow('30 minutes'));
      console.log(chalk.white('Transaction Window: ') + chalk.yellow('120 seconds'));
    }

    console.log(chalk.cyan('─'.repeat(50)) + '\n');
  }

  /**
   * Write active session ID to file
   * @private
   */
  _writeActiveSession(sessionId) {
    try {
      fs.writeFileSync(this.activeSessionFile, sessionId, 'utf8');
    } catch (error) {
      // Non-critical, just log
      if (this.options.verbose) {
        console.warn(chalk.yellow(`Warning: Could not write session file: ${error.message}`));
      }
    }
  }

  /**
   * Read active session ID from file
   * @private
   */
  _readActiveSession() {
    try {
      if (fs.existsSync(this.activeSessionFile)) {
        return fs.readFileSync(this.activeSessionFile, 'utf8').trim();
      }
    } catch (error) {
      // File doesn't exist or can't be read
    }
    return null;
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
    if (this.workflows.networked.wsServer) {
      this.workflows.networked.wsServer.stop();
    }
    if (this.workflows.networked.sessionManager) {
      this.workflows.networked.sessionManager.shutdown();
    }
    this.progress.cleanup();

    // Clean up session file
    try {
      if (fs.existsSync(this.activeSessionFile)) {
        fs.unlinkSync(this.activeSessionFile);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

module.exports = WorkflowOrchestrator;
