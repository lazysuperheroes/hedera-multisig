/**
 * TypeScript declarations for @lazysuperheroes/hedera-multisig
 *
 * Production-grade multi-signature transaction management for Hedera blockchain.
 */

import { Transaction, Client, PrivateKey, PublicKey, AccountId } from '@hashgraph/sdk';
import { WebSocket } from 'ws';

// ============================================================================
// Core Components
// ============================================================================

export interface FreezeOptions {
  client?: Client;
  nodeAccountIds?: AccountId[];
}

export interface DecodedTransaction {
  type: string;
  transactionId: string;
  memo?: string;
  maxTransactionFee?: string;
  validDuration?: number;
  nodeAccountIds?: string[];
  [key: string]: unknown;
}

export class TransactionFreezer {
  constructor(client: Client);
  freeze(transaction: Transaction, options?: FreezeOptions): Promise<Transaction>;
  static freeze(transaction: Transaction, client: Client, options?: FreezeOptions): Promise<Transaction>;
}

export class TransactionDecoder {
  static decode(transaction: Transaction, contractInterface?: unknown): DecodedTransaction;
  static getTransactionType(transaction: Transaction): string;
}

export interface SignatureData {
  publicKey: string;
  signature: string;
}

export class SignatureCollector {
  constructor();
  addSignature(publicKey: string | PublicKey, signature: Uint8Array | string): void;
  getSignatures(): SignatureData[];
  hasSignature(publicKey: string | PublicKey): boolean;
  clear(): void;
  get count(): number;
}

export interface VerificationResult {
  valid: boolean;
  message?: string;
  publicKey?: string;
}

export class SignatureVerifier {
  constructor(client?: Client);
  verify(
    transaction: Transaction,
    publicKey: string | PublicKey,
    signature: Uint8Array | string
  ): Promise<VerificationResult>;
  static verify(
    transaction: Transaction,
    publicKey: string | PublicKey,
    signature: Uint8Array | string,
    client?: Client
  ): Promise<VerificationResult>;
}

export interface ExecutionResult {
  success: boolean;
  transactionId?: string;
  receipt?: unknown;
  error?: string;
}

export class TransactionExecutor {
  constructor(client: Client);
  execute(transaction: Transaction, signatures?: SignatureData[]): Promise<ExecutionResult>;
}

// ============================================================================
// Key Management
// ============================================================================

export interface KeyInfo {
  privateKey: string;
  publicKey: string;
  type?: string;
}

export abstract class KeyProvider {
  abstract get name(): string;
  abstract get securityLevel(): 'low' | 'medium' | 'high';
  abstract getKeys(): Promise<KeyInfo[]>;
  abstract isAvailable(): Promise<boolean>;
}

export interface ValidationResult {
  valid: boolean;
  format?: string;
  type?: string;
  errors?: string[];
}

export class KeyValidator {
  static validatePrivateKey(key: string): ValidationResult;
  static validatePublicKey(key: string): ValidationResult;
  static validateSignature(signature: string): ValidationResult;
  static validateThreshold(threshold: number, totalKeys: number): ValidationResult;
}

export interface EnvKeyProviderOptions {
  prefix?: string;
  envFile?: string;
}

export class EnvKeyProvider extends KeyProvider {
  constructor(options?: EnvKeyProviderOptions);
  get name(): string;
  get securityLevel(): 'medium';
  getKeys(): Promise<KeyInfo[]>;
  isAvailable(): Promise<boolean>;
  checkEnvSecurity(): { secure: boolean; warnings: string[] };
}

export class PromptKeyProvider extends KeyProvider {
  constructor();
  get name(): string;
  get securityLevel(): 'medium';
  getKeys(): Promise<KeyInfo[]>;
  isAvailable(): Promise<boolean>;
}

export interface EncryptedFileMetadata {
  version: number;
  algorithm: string;
  keyCount: number;
  createdAt: string;
}

export class EncryptedFileProvider extends KeyProvider {
  constructor(filePath: string);
  get name(): string;
  get securityLevel(): 'high';
  getKeys(): Promise<KeyInfo[]>;
  isAvailable(): Promise<boolean>;
  getMetadata(): EncryptedFileMetadata;
  static createEncryptedFile(
    filePath: string,
    privateKeys: string[],
    passphrase: string
  ): Promise<void>;
  static generatePassphrase(length?: number): string;
}

// ============================================================================
// Workflows
// ============================================================================

export interface WorkflowConfig {
  threshold: number;
  signers: Array<{ publicKey: string; name?: string }>;
  client?: Client;
  timeout?: number;
}

export interface WorkflowResult {
  success: boolean;
  transaction?: Transaction;
  signatures?: SignatureData[];
  error?: string;
}

export class WorkflowOrchestrator {
  constructor(config: WorkflowConfig);
  execute(transaction: Transaction): Promise<WorkflowResult>;
}

export class InteractiveWorkflow {
  constructor(config: WorkflowConfig);
  run(transaction: Transaction): Promise<WorkflowResult>;
}

export interface OfflineWorkflowExport {
  transaction: string;
  transactionId: string;
  requiredSignatures: number;
  signers: string[];
  createdAt: string;
}

export class OfflineWorkflow {
  constructor(config: WorkflowConfig);
  export(transaction: Transaction): OfflineWorkflowExport;
  import(data: OfflineWorkflowExport): Transaction;
  addSignature(publicKey: string, signature: string): void;
  isComplete(): boolean;
}

// ============================================================================
// UI Components
// ============================================================================

export class ProgressIndicator {
  constructor(options?: { total?: number; format?: string });
  update(current: number, message?: string): void;
  complete(message?: string): void;
}

export class ErrorFormatter {
  static format(error: Error | string): string;
  static formatWithContext(error: Error | string, context: Record<string, unknown>): string;
}

export class HelpText {
  static show(command?: string): void;
  static getCommands(): string[];
}

export class TransactionDisplay {
  static show(transaction: DecodedTransaction): void;
  static showCompact(transaction: DecodedTransaction): string;
}

// ============================================================================
// Server Components
// ============================================================================

export interface SessionStoreOptions {
  defaultTimeout?: number;
  cleanupInterval?: number;
}

export interface Session {
  sessionId: string;
  pin: string;
  status: 'waiting' | 'transaction-received' | 'signing' | 'executing' | 'completed' | 'expired' | 'cancelled';
  threshold: number;
  eligiblePublicKeys: string[];
  frozenTransaction?: string;
  txDetails?: DecodedTransaction;
  participants: Map<string, ParticipantData>;
  signatures: Map<string, SignatureData>;
  stats: SessionStats;
  createdAt: number;
  expiresAt: number;
}

export interface ParticipantData {
  participantId: string;
  status: 'connected' | 'ready' | 'reviewing' | 'signing' | 'signed' | 'rejected' | 'disconnected';
  publicKey?: string;
  label?: string;
  connectedAt: number;
}

export interface SessionStats {
  participantsConnected: number;
  participantsReady: number;
  participantsExpected: number;
  signaturesCollected: number;
  signaturesRequired: number;
}

export class SessionStore {
  constructor(options?: SessionStoreOptions);
  createSession(sessionData: Partial<Session>): Session;
  getSession(sessionId: string): Session | null;
  authenticate(sessionId: string, pin: string): boolean;
  updateStatus(sessionId: string, status: Session['status']): void;
  addParticipant(sessionId: string, participant: Partial<ParticipantData>): string;
  addSignature(sessionId: string, participantId: string, signature: SignatureData): void;
  isThresholdMet(sessionId: string): boolean;
  getSignatures(sessionId: string): SignatureData[];
  deleteSession(sessionId: string): void;
  shutdown(): void;
}

export interface SigningSessionManagerOptions {
  defaultTimeout?: number;
  autoExecute?: boolean;
  auditLogPath?: string;
  verbose?: boolean;
  store?: SessionStore;
}

export interface SessionInfo {
  sessionId: string;
  pin: string;
  threshold: number;
  eligiblePublicKeys: string[];
  expectedParticipants: number;
  status: Session['status'];
  createdAt: number;
  expiresAt: number;
}

export class SigningSessionManager {
  constructor(client: Client, options?: SigningSessionManagerOptions);
  createSession(transaction: Transaction | null, config: {
    pin?: string;
    threshold?: number;
    eligiblePublicKeys?: string[];
    expectedParticipants?: number;
    timeout?: number;
  }): Promise<SessionInfo>;
  getSessionInfo(sessionId: string): SessionInfo | null;
  injectTransaction(sessionId: string, transaction: Transaction): Promise<Session>;
  addParticipant(sessionId: string, participant: Partial<ParticipantData>): { participantId: string };
  submitSignature(
    sessionId: string,
    participantId: string,
    signature: { publicKey: string; signature: string }
  ): Promise<{
    signaturesCollected: number;
    signaturesRequired: number;
    thresholdMet: boolean;
  }>;
  executeTransaction(sessionId: string): Promise<ExecutionResult>;
}

export interface WebSocketServerOptions {
  port?: number;
  host?: string;
  verbose?: boolean;
  tunnel?: {
    enabled: boolean;
    provider?: 'ngrok' | 'localtunnel';
  };
  tls?: {
    enabled: boolean;
    cert: string;
    key: string;
    ca?: string;
    passphrase?: string;
  };
}

export interface ServerStartResult {
  url: string;
  port: number;
  tunnelUrl?: string;
}

export class WebSocketServer {
  constructor(sessionManager: SigningSessionManager, options?: WebSocketServerOptions);
  start(): Promise<ServerStartResult>;
  stop(): Promise<void>;
  broadcastToSession(sessionId: string, message: unknown): void;
  sendToParticipant(participantId: string, message: unknown): void;
}

// ============================================================================
// Client Components
// ============================================================================

export interface SigningClientOptions {
  serverUrl: string;
  sessionId: string;
  pin: string;
  label?: string;
  autoSign?: boolean;
}

export interface SigningClientEvents {
  connected: () => void;
  authenticated: (data: { participantId: string; sessionInfo: SessionInfo }) => void;
  transactionReceived: (data: { transaction: string; txDetails: DecodedTransaction }) => void;
  signatureRequested: (data: { transaction: string }) => void;
  thresholdMet: () => void;
  transactionExecuted: (data: ExecutionResult) => void;
  error: (error: Error) => void;
  disconnected: () => void;
}

export class SigningClient {
  constructor(options: SigningClientOptions);
  connect(): Promise<void>;
  disconnect(): void;
  signTransaction(privateKey: string | PrivateKey): Promise<void>;
  rejectTransaction(reason?: string): void;
  loadKeys(privateKey: string | PrivateKey): { publicKey: string };
  on<K extends keyof SigningClientEvents>(event: K, handler: SigningClientEvents[K]): void;
  off<K extends keyof SigningClientEvents>(event: K, handler: SigningClientEvents[K]): void;
}

export interface ReviewResult {
  approved: boolean;
  transaction?: DecodedTransaction;
  warnings?: string[];
}

export class TransactionReviewer {
  constructor();
  review(transactionBytes: string): Promise<ReviewResult>;
  decode(transactionBytes: string): Promise<DecodedTransaction>;
}

// ============================================================================
// Shared Components
// ============================================================================

export interface SharedDecoderOptions {
  contractInterface?: unknown;
}

export const SharedTransactionDecoder: {
  decode(transaction: Transaction, options?: SharedDecoderOptions): Promise<DecodedTransaction>;
  getTransactionTypeName(transaction: Transaction): string;
  extractAmount(transaction: Transaction): { amount: string; unit: string } | null;
  extractAccounts(transaction: Transaction): { from?: string; to?: string };
};

// ============================================================================
// Module Exports
// ============================================================================

export const version: string;
