/**
 * WebSocket Protocol Types
 *
 * TypeScript definitions for the WebSocket protocol used by the
 * Hedera MultiSig signing session system.
 */

// ============================================================================
// Base Message Types
// ============================================================================

export interface BaseMessage {
  type: string;
  payload?: any;
}

// ============================================================================
// Client → Server Messages
// ============================================================================

export interface AuthMessage {
  type: 'AUTH';
  payload: {
    sessionId: string;
    pin: string;
    role: 'participant' | 'coordinator';
    label?: string;
  };
}

export interface ParticipantReadyMessage {
  type: 'PARTICIPANT_READY';
  payload: {
    publicKey: string;
  };
}

export interface SignatureSubmitMessage {
  type: 'SIGNATURE_SUBMIT';
  payload: {
    publicKey: string;
    signature: string; // base64 encoded
  };
}

export interface TransactionRejectedMessage {
  type: 'TRANSACTION_REJECTED';
  payload: {
    reason: string;
  };
}

export interface PingMessage {
  type: 'PING';
  payload?: Record<string, never>;
}

export type ClientMessage =
  | AuthMessage
  | ParticipantReadyMessage
  | SignatureSubmitMessage
  | TransactionRejectedMessage
  | PingMessage;

// ============================================================================
// Server → Client Messages
// ============================================================================

export interface SessionInfo {
  sessionId: string;
  status: 'waiting' | 'transaction-received' | 'signing' | 'executing' | 'completed';
  threshold: number;
  eligiblePublicKeys: string[];
  expectedParticipants: number;
  expiresAt: number;
  txDetails?: TransactionDetails;
  frozenTransaction?: {
    base64: string;
    bytes?: Uint8Array;
  };
  metadata?: Record<string, any>;
  contractInterface?: any;
  stats?: {
    participantsExpected: number;
    participantsConnected: number;
    participantsReady: number;
    signaturesCollected: number;
    signaturesRequired: number;
  };
}

export interface TransactionDetails {
  type: string;
  transactionId?: string;
  nodeAccountId?: string;
  checksum?: string;
  transfers?: Array<{
    accountId: string;
    amount: number;
  }>;
  amounts?: number[];
  accounts?: string[];
  memo?: string;
  [key: string]: any;
}

export interface AuthSuccessMessage {
  type: 'AUTH_SUCCESS';
  payload: {
    participantId: string;
    sessionInfo: SessionInfo;
  };
}

export interface AuthFailedMessage {
  type: 'AUTH_FAILED';
  payload: {
    message: string;
  };
}

export interface TransactionReceivedMessage {
  type: 'TRANSACTION_RECEIVED';
  payload: {
    frozenTransaction: {
      base64: string;
      bytes?: Uint8Array;
    };
    txDetails: TransactionDetails;
    metadata?: Record<string, any>;
    contractInterface?: any;
  };
}

export interface SignatureAcceptedMessage {
  type: 'SIGNATURE_ACCEPTED';
  payload: {
    success: boolean;
    publicKey: string;
    signaturesCollected: number;
    signaturesRequired: number;
    thresholdMet: boolean;
  };
}

export interface SignatureRejectedMessage {
  type: 'SIGNATURE_REJECTED';
  payload: {
    message: string;
    publicKey?: string;
  };
}

export interface ThresholdMetMessage {
  type: 'THRESHOLD_MET';
  payload: {
    signaturesCollected: number;
    signaturesRequired: number;
  };
}

export interface TransactionExecutedMessage {
  type: 'TRANSACTION_EXECUTED';
  payload: {
    transactionId: string;
    status: string;
    receipt?: any;
  };
}

export interface ParticipantConnectedMessage {
  type: 'PARTICIPANT_CONNECTED';
  payload: {
    participantId: string;
    stats: {
      participantsExpected: number;
      participantsConnected: number;
      participantsReady: number;
    };
  };
}

export interface ParticipantReadyPayloadMessage {
  type: 'PARTICIPANT_READY';
  payload: {
    participantId: string;
    publicKey?: string;
    stats: {
      participantsExpected: number;
      participantsConnected: number;
      participantsReady: number;
    };
    allReady: boolean;
  };
}

export interface ParticipantDisconnectedMessage {
  type: 'PARTICIPANT_DISCONNECTED';
  payload: {
    participantId: string;
  };
}

export interface SessionExpiredMessage {
  type: 'SESSION_EXPIRED';
  payload?: Record<string, never>;
}

export interface ErrorMessage {
  type: 'ERROR';
  payload: {
    message: string;
    code?: string;
  };
}

export interface PongMessage {
  type: 'PONG';
  payload?: Record<string, never>;
}

export type ServerMessage =
  | AuthSuccessMessage
  | AuthFailedMessage
  | TransactionReceivedMessage
  | SignatureAcceptedMessage
  | SignatureRejectedMessage
  | ThresholdMetMessage
  | TransactionExecutedMessage
  | ParticipantConnectedMessage
  | ParticipantReadyPayloadMessage
  | ParticipantDisconnectedMessage
  | SessionExpiredMessage
  | ErrorMessage
  | PongMessage;

// ============================================================================
// Event Types
// ============================================================================

export type SigningClientStatus =
  | 'disconnected'
  | 'connected'
  | 'ready'
  | 'waiting'
  | 'reviewing'
  | 'signing'
  | 'signed'
  | 'rejected'
  | 'completed';

export interface SigningClientEvents {
  connected: (data: { participantId: string; sessionInfo: SessionInfo }) => void;
  ready: (data: { publicKey: string }) => void;
  transactionReceived: (data: TransactionReceivedMessage['payload']) => void;
  signed: (data: { publicKey: string }) => void;
  signatureAccepted: (data: SignatureAcceptedMessage['payload']) => void;
  signatureRejected: (data: SignatureRejectedMessage['payload']) => void;
  thresholdMet: (data: ThresholdMetMessage['payload']) => void;
  transactionExecuted: (data: TransactionExecutedMessage['payload']) => void;
  rejected: (data: { reason: string }) => void;
  participantConnected: (data: ParticipantConnectedMessage['payload']) => void;
  participantReady: (data: ParticipantReadyPayloadMessage['payload']) => void;
  participantDisconnected: (data: ParticipantDisconnectedMessage['payload']) => void;
  sessionExpired: () => void;
  error: (data: ErrorMessage['payload']) => void;
  disconnected: () => void;
}

export type EventName = keyof SigningClientEvents;
export type EventHandler<T extends EventName> = SigningClientEvents[T];
