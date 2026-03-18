/**
 * TypeScript declarations for @lazysuperheroes/hedera-multisig
 *
 * Production-grade multi-signature transaction management for Hedera blockchain.
 * Updated to match actual API as of v1.3.0+.
 */

import { Transaction, Client, PrivateKey, PublicKey, AccountId } from '@hashgraph/sdk';

// ============================================================================
// Core Components (all static methods)
// ============================================================================

export interface FrozenTransactionData {
  transaction: Transaction;
  base64: string;
  bytes: Uint8Array;
  txDetails: TransactionDetails;
  frozenAt: Date;
  expiresAt: Date;
  hash: string;
}

export class TransactionFreezer {
  static freeze(transaction: Transaction, client: Client, options?: {
    contractInterface?: unknown;
  }): Promise<FrozenTransactionData>;
  static formatTimeRemaining(frozenTx: FrozenTransactionData): string;
  static validateNotExpired(frozenTx: FrozenTransactionData): void;
}

export interface TransactionDetails {
  type: string;
  transactionId?: string;
  transactionType?: string;
  transfers?: Array<{ accountId: string; amount: string }>;
  tokenTransfers?: Array<{ tokenId: string; transfers: Array<{ accountId: string; amount: string }> }>;
  nftTransfers?: Array<{ tokenId: string; transfers: Array<{ senderAccountId: string; receiverAccountId: string; serialNumber: number }> }>;
  tokenIds?: string[];
  accountId?: string;
  contractId?: string;
  gas?: number;
  functionName?: string;
  functionParams?: Record<string, unknown>;
  selectorVerified?: boolean;
  amount?: string;
  [key: string]: unknown;
}

export class TransactionDecoder {
  /** @deprecated Use SharedTransactionDecoder instead */
  static decode(transaction: Transaction, contractInterface?: unknown): TransactionDetails;
  static display(txDetails: TransactionDetails, options?: { verbose?: boolean; compact?: boolean }): void;
}

export interface SignatureData {
  publicKey: string;
  signature: string;
}

export class SignatureCollector {
  static collectInteractive(frozenTx: FrozenTransactionData, requiredSignatures: number, options?: {
    timeout?: number;
    localKeys?: PrivateKey[];
    verbose?: boolean;
  }): Promise<SignatureData[]>;
  static collectOffline(frozenTx: FrozenTransactionData, requiredSignatures: number, options?: {
    localKeys?: PrivateKey[];
    verbose?: boolean;
  }): Promise<SignatureData[]>;
  static generateSignatures(frozenTx: FrozenTransactionData, privateKeys: PrivateKey[]): SignatureData[];
}

export interface VerificationResult {
  valid: boolean;
  validCount: number;
  totalCount: number;
  details: Array<{ publicKey: string; valid: boolean; error: string | null }>;
  errors: string[];
}

export class SignatureVerifier {
  static verify(frozenTx: { bytes: Uint8Array }, signatures: SignatureData[], options?: {
    expectedPublicKeys?: string[];
    threshold?: number;
  }): Promise<VerificationResult>;
  static verifySingle(frozenTx: { bytes: Uint8Array }, sigTuple: SignatureData): Promise<{ publicKey: string; valid: boolean; error: string | null }>;
  static checkThreshold(threshold: number, providedCount: number): boolean;
  static parseSignatureTuple(input: string): SignatureData | null;
  static generateChecksum(input: { bytes: Uint8Array } | Uint8Array): string;
}

export interface ExecutionResult {
  success: boolean;
  transactionId?: string;
  receipt?: unknown;
  status?: string;
  executionTimeMs?: number;
  error?: string;
}

export class TransactionExecutor {
  static execute(frozenTx: FrozenTransactionData, signatures: SignatureData[], client: Client, options?: {
    skipAuditLog?: boolean;
    auditLogPath?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ExecutionResult>;
}

// ============================================================================
// Key Management
// ============================================================================

export abstract class KeyProvider {
  abstract getKeys(): Promise<PrivateKey[]>;
  abstract getName(): string;
  getSecurityLevel(): string;
  canExposeKeys(): boolean;
  sign(transactionBytes: Uint8Array): Promise<SignatureData[]>;
}

export class EnvKeyProvider extends KeyProvider {
  constructor(options?: { prefix?: string; envFile?: string });
  getKeys(): Promise<PrivateKey[]>;
  getName(): string;
  getSecurityLevel(): 'medium';
}

export class PromptKeyProvider extends KeyProvider {
  constructor();
  getKeys(): Promise<PrivateKey[]>;
  getName(): string;
  getSecurityLevel(): 'high';
}

export class EncryptedFileProvider extends KeyProvider {
  constructor(filePath: string);
  getKeys(): Promise<PrivateKey[]>;
  getName(): string;
  getSecurityLevel(): 'high';
  static createEncryptedFile(filePath: string, privateKeys: string[], passphrase: string): Promise<void>;
  static generatePassphrase(length?: number): string;
}

export class KeyValidator {
  static validatePrivateKey(key: string): { valid: boolean; format?: string; type?: string; errors?: string[] };
  static validatePublicKey(key: string): { valid: boolean; format?: string; errors?: string[] };
}

// ============================================================================
// Workflows
// ============================================================================

export interface WorkflowResult {
  success: boolean;
  receipt?: unknown;
  transactionId?: string;
  error?: string;
}

export class WorkflowOrchestrator {
  constructor(client: Client, options?: Record<string, unknown>);
  executeWithSession(transaction: Transaction, options?: Record<string, unknown>): Promise<WorkflowResult>;
}

export class InteractiveWorkflow {
  constructor(client: Client, options?: { auditLogPath?: string; verbose?: boolean; contractInterface?: unknown });
  run(transaction: Transaction, keyProviders: KeyProvider[], options?: {
    threshold?: number;
    signerLabels?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<WorkflowResult>;
  cleanup(): void;
}

export class OfflineWorkflow {
  constructor(client: Client, options?: { exportDir?: string; auditLogPath?: string; verbose?: boolean });
  freezeAndExport(transaction: Transaction, metadata?: Record<string, unknown>): Promise<WorkflowResult & { transactionFile?: string; metadataFile?: string }>;
  collectSignatures(frozenTransaction: Transaction, signatureFiles: Array<string | SignatureData>, threshold?: number): Promise<{ success: boolean; signatures: SignatureData[]; count: number }>;
  executeTransaction(frozenTransaction: Transaction, signatures: SignatureData[]): Promise<WorkflowResult>;
  run(transaction: Transaction, signatureFiles: Array<string | SignatureData>, options?: { threshold?: number }): Promise<WorkflowResult>;
}

// ============================================================================
// Server Components
// ============================================================================

export type SessionStatus = 'waiting' | 'transaction-received' | 'signing' | 'executing' | 'completed' | 'transaction-expired' | 'expired' | 'cancelled';

export interface SessionStats {
  participantsConnected: number;
  participantsReady: number;
  participantsExpected: number;
  signaturesCollected: number;
  signaturesRequired: number;
}

export interface Session {
  sessionId: string;
  pin: string;
  coordinatorToken: string | null;
  status: SessionStatus;
  threshold: number;
  eligiblePublicKeys: string[];
  frozenTransaction?: unknown;
  txDetails?: TransactionDetails;
  participants: Map<string, { participantId: string; status: string; publicKey?: string; label?: string }>;
  signatures: Map<string, SignatureData>;
  stats: SessionStats;
  createdAt: number;
  expiresAt: number;
}

export class SessionStore {
  constructor(options?: { defaultTimeout?: number; cleanupInterval?: number; maxSessions?: number });
  createSession(sessionData: Partial<Session>): Promise<Session>;
  getSession(sessionId: string): Promise<Session | null>;
  authenticate(sessionId: string, pin: string): Promise<boolean>;
  updateStatus(sessionId: string, status: SessionStatus): Promise<void>;
  addParticipant(sessionId: string, participant: { label?: string }): Promise<string>;
  addSignature(sessionId: string, participantId: string, signature: SignatureData): Promise<void>;
  isThresholdMet(sessionId: string): Promise<boolean>;
  getSignatures(sessionId: string): Promise<SignatureData[]>;
  getStats(sessionId: string): Promise<SessionStats | null>;
  listActiveSessions(): Promise<Array<{ sessionId: string; createdAt: number; expiresAt: number; stats: SessionStats }>>;
  shutdown(): void;
}

export interface SessionInfo {
  sessionId: string;
  pin: string;
  coordinatorToken: string;
  threshold: number;
  eligiblePublicKeys: string[];
  expectedParticipants: number;
  status: SessionStatus;
  createdAt: number;
  expiresAt: number;
}

export class SigningSessionManager {
  constructor(client: Client, options?: {
    defaultTimeout?: number;
    autoExecute?: boolean;
    store?: SessionStore;
    verbose?: boolean;
  });
  createSession(transaction: Transaction | null, config: {
    pin?: string;
    threshold?: number;
    eligiblePublicKeys?: string[];
    expectedParticipants?: number;
    timeout?: number;
  }): Promise<SessionInfo>;
  getSessionInfo(sessionId: string): Promise<SessionInfo | null>;
  authenticate(sessionId: string, pin: string): Promise<boolean>;
  authenticateCoordinator(sessionId: string, pin: string, coordinatorToken: string): Promise<boolean>;
  addParticipant(sessionId: string, participant: { label?: string }): Promise<{ participantId: string }>;
  submitSignature(sessionId: string, participantId: string, signature: SignatureData): Promise<{
    success: boolean;
    thresholdMet: boolean;
    signaturesCollected: number;
    signaturesRequired: number;
  }>;
  executeTransaction(sessionId: string): Promise<ExecutionResult>;
  injectTransaction(sessionId: string, transaction: Transaction, options?: Record<string, unknown>): Promise<unknown>;
  generateReconnectionToken(sessionId: string, participantId: string): Promise<string>;
  shutdown(): void;
}

export class WebSocketServer {
  constructor(sessionManager: SigningSessionManager, options?: {
    port?: number;
    host?: string;
    verbose?: boolean;
    allowedOrigins?: string[] | null;
    maxSessions?: number;
    tunnel?: { enabled: boolean; provider?: 'ngrok' | 'localtunnel' };
    tls?: { enabled: boolean; cert: string; key: string; ca?: string; passphrase?: string };
  });
  start(): Promise<{ url: string; port: number; publicUrl?: string }>;
  stop(): Promise<void>;
  broadcastToSession(sessionId: string, message: unknown): Promise<void>;
  sendToParticipant(participantId: string, message: unknown): void;
  sendToCoordinator(sessionId: string, message: unknown): void;
}

// ============================================================================
// Client Components
// ============================================================================

export class SigningClient {
  constructor(options?: { verbose?: boolean; label?: string; maxReconnectAttempts?: number; reconnectInterval?: number });
  connect(serverUrl: string, sessionId: string, pin: string): Promise<{
    participantId: string;
    sessionInfo: SessionInfo;
  }>;
  loadKeys(privateKey: string | PrivateKey): { publicKey: string };
  setReady(): Promise<{ success: boolean }>;
  signTransaction(): Promise<SignatureData>;
  rejectTransaction(reason?: string): void;
  disconnect(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}

// ============================================================================
// Shared Components
// ============================================================================

export function getTransactionTypeName(transaction: Transaction): string;

export function generateConnectionString(serverUrl: string, sessionId: string, pin: string): string;
export function parseConnectionString(connectionString: string): { serverUrl: string; sessionId: string; pin: string } | null;
export function isValidConnectionString(connectionString: string): boolean;

export function timingSafeCompare(a: string, b: string): boolean;
export function generateSessionId(): string;
export function generateParticipantId(): string;
export function sanitizePublicKey(publicKey: string): string;
export function normalizeFrozenTransaction(frozenTransaction: unknown): { bytes: Buffer; base64: string; transaction?: Transaction } | null;

// Error classes
export class MultiSigError extends Error {
  code: string;
}
export class TransactionExpiredError extends MultiSigError {}
export class InvalidSignatureError extends MultiSigError {}
export class InsufficientSignaturesError extends MultiSigError {}
export class SessionNotFoundError extends MultiSigError {}
export class AuthenticationError extends MultiSigError {}
export class RateLimitError extends AuthenticationError {}
export class InvalidSessionStateError extends MultiSigError {}
export class KeyNotEligibleError extends MultiSigError {}
export class NoTransactionError extends MultiSigError {}

// Protocol constants
export const MESSAGE_TYPES: Record<string, string>;
export const SESSION_STATES: Record<string, string>;
export const ERROR_CODES: Record<string, string>;
export const PARTICIPANT_STATES: Record<string, string>;
export const ROLES: Record<string, string>;
export function isValidTransition(currentState: string, nextState: string): boolean;

export const version: string;
