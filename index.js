/**
 * Hedera Multi-Signature Library
 *
 * Production-grade multi-signature transaction management for Hedera blockchain.
 *
 * @module @lazysuperheroes/hedera-multisig
 */

const packageJson = require('./package.json');

// Core Components
const TransactionFreezer = require('./core/TransactionFreezer');
const TransactionDecoder = require('./core/TransactionDecoder');
const SignatureCollector = require('./core/SignatureCollector');
const SignatureVerifier = require('./core/SignatureVerifier');
const TransactionExecutor = require('./core/TransactionExecutor');

// Key Management
const KeyProvider = require('./keyManagement/KeyProvider');
const KeyValidator = require('./keyManagement/KeyValidator');
const EnvKeyProvider = require('./keyManagement/EnvKeyProvider');
const PromptKeyProvider = require('./keyManagement/PromptKeyProvider');
const EncryptedFileProvider = require('./keyManagement/EncryptedFileProvider');

// Workflows
const WorkflowOrchestrator = require('./workflows/WorkflowOrchestrator');
const InteractiveWorkflow = require('./workflows/InteractiveWorkflow');
const OfflineWorkflow = require('./workflows/OfflineWorkflow');

// UI Components
const ProgressIndicator = require('./ui/ProgressIndicator');
const ErrorFormatter = require('./ui/ErrorFormatter');
const HelpText = require('./ui/HelpText');
const TransactionDisplay = require('./ui/TransactionDisplay');

// Server Components (Network-based Multi-Sig)
const { SessionStore, SigningSessionManager, WebSocketServer } = require('./server');

// Client Components (Network-based Multi-Sig)
const { SigningClient, TransactionReviewer } = require('./client');

// Main exports
module.exports = {
  // Core
  TransactionFreezer,
  TransactionDecoder,
  SignatureCollector,
  SignatureVerifier,
  TransactionExecutor,

  // Key Management
  KeyProvider,
  KeyValidator,
  EnvKeyProvider,
  PromptKeyProvider,
  EncryptedFileProvider,

  // Workflows
  WorkflowOrchestrator,
  InteractiveWorkflow,
  OfflineWorkflow,

  // UI Components
  ProgressIndicator,
  ErrorFormatter,
  HelpText,
  TransactionDisplay,

  // Server Components
  SessionStore,
  SigningSessionManager,
  WebSocketServer,

  // Client Components
  SigningClient,
  TransactionReviewer,

  // Version
  version: packageJson.version
};
