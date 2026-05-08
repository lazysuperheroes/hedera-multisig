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
  payload?: unknown;
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
  metadata?: Record<string, unknown>;
  contractInterface?: unknown;
  stats?: {
    participantsExpected: number;
    participantsConnected: number;
    participantsReady: number;
    signaturesCollected: number;
    signaturesRequired: number;
  };
  /**
   * Snapshot of currently-tracked participants at the moment AUTH_SUCCESS
   * was sent. Critical for late joiners: PARTICIPANT_CONNECTED broadcasts
   * only fire for FUTURE arrivals, so without this snapshot a participant
   * who joins after others would never see them in the participant list,
   * even though `stats.participantsConnected` would correctly count them.
   */
  participants?: Array<{
    participantId: string;
    status: 'connected' | 'ready' | 'signed' | 'rejected' | 'disconnected';
    publicKey?: string | null;
    label?: string | null;
    connectedAt?: number;
    isAgent?: boolean;
  }>;
  /**
   * Session mode. 'realtime' is the default — signers connect, the
   * coordinator injects, signatures collected over WebSocket, server
   * executes. 'scheduled' is HIP-423 — coordinator submits a
   * ScheduleCreate to the network, scheduleId distributed via WS,
   * signers submit ScheduleSignTransaction independently to the
   * network at their convenience. Mirror node is source of truth
   * for schedule status in scheduled mode.
   */
  mode?: 'realtime' | 'scheduled';
  scheduleId?: string | null;
  /** Seconds since epoch. */
  scheduleExpirationTime?: number | null;
  scheduleMemo?: string | null;
  schedulePayerAccountId?: string | null;
  scheduleAdminKey?: string | null;
  innerTxDetails?: TransactionDetails | Record<string, unknown> | null;
  innerTxBase64?: string | null;
}

/**
 * Server broadcast announcing a freshly-created HIP-423 schedule.
 * Distinct from TransactionReceivedMessage: there's no frozen
 * transaction, no signature collection over WS — the wire payload
 * is just enough context for participants to display the inner tx,
 * find the schedule on the network, and submit their own
 * ScheduleSignTransaction.
 */
export interface ScheduleCreatedMessage {
  type: 'SCHEDULE_CREATED';
  payload: {
    scheduleId: string;
    expirationTime: number | null;
    scheduleMemo: string | null;
    payerAccountId: string | null;
    adminKey: string | null;
    innerTxDetails: TransactionDetails | Record<string, unknown> | null;
    innerTxBase64: string | null;
    abi?: unknown;
    announcedAt: number;
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
  // Passthrough bag for transaction-type-specific fields (tokenIds, contractId,
  // functionName, transactionMemo, maxTransactionFee, etc.). Decoder writes
  // everything it extracts; consumers read what they expect.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    metadata?: Record<string, unknown>;
    contractInterface?: unknown;
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

/**
 * Server broadcast to all participants when ANY participant's signature
 * has been accepted. Distinct from SIGNATURE_ACCEPTED, which is the
 * server's confirmation back to the signer themselves. Receiving
 * clients use this to flip the relevant participant's row from "Ready"
 * to "Signed".
 */
export interface SignatureReceivedMessage {
  type: 'SIGNATURE_RECEIVED';
  payload: {
    participantId: string;
    publicKeyPreview?: string;
    stats: {
      participantsExpected: number;
      participantsConnected: number;
      participantsReady: number;
      signaturesCollected: number;
      signaturesRequired: number;
    };
    thresholdMet: boolean;
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
    receipt?: unknown;
  };
}

export interface ParticipantConnectedMessage {
  type: 'PARTICIPANT_CONNECTED';
  payload: {
    participantId: string;
    /** Friendly display name supplied at AUTH (CLI --label or web join form). */
    label?: string | null;
    isAgent?: boolean;
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
    /**
     * Refreshed session-wide stats from the server. Optional for
     * backward compat with older servers that didn't include them in
     * the disconnect broadcast — when present the dApp uses them to
     * keep the SignatureProgress counter in sync with the actual
     * server state.
     */
    stats?: {
      participantsExpected: number;
      participantsConnected: number;
      participantsReady: number;
    };
  };
}

export interface SessionExpiredMessage {
  type: 'SESSION_EXPIRED';
  payload?: Record<string, never>;
}

export interface TransactionExpiredMessage {
  type: 'TRANSACTION_EXPIRED';
  payload: {
    sessionId: string;
    message: string;
  };
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

/**
 * Server broadcast when ANY participant rejects the in-flight tx.
 * Distinct from the same-named client→server message participants
 * send to *initiate* a rejection. The server resets the per-tx state
 * (signatures map cleared, signed→ready, frozenTransaction nulled,
 * session back to 'waiting') and broadcasts this so every connected
 * client can mirror the reset locally.
 */
export interface TransactionRejectedBroadcastMessage {
  type: 'TRANSACTION_REJECTED';
  payload: {
    participantId: string;
    reason: string;
    stats?: {
      participantsExpected?: number;
      participantsConnected?: number;
      participantsReady?: number;
      signaturesCollected?: number;
      signaturesRequired?: number;
    };
  };
}

export type ServerMessage =
  | AuthSuccessMessage
  | AuthFailedMessage
  | TransactionReceivedMessage
  | ScheduleCreatedMessage
  | SignatureAcceptedMessage
  | SignatureRejectedMessage
  | SignatureReceivedMessage
  | ThresholdMetMessage
  | TransactionExecutedMessage
  | TransactionExpiredMessage
  | TransactionRejectedBroadcastMessage
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
  scheduleCreated: (data: ScheduleCreatedMessage['payload']) => void;
  signed: (data: { publicKey: string }) => void;
  signatureAccepted: (data: SignatureAcceptedMessage['payload']) => void;
  signatureRejected: (data: SignatureRejectedMessage['payload']) => void;
  signatureReceived: (data: SignatureReceivedMessage['payload']) => void;
  thresholdMet: (data: ThresholdMetMessage['payload']) => void;
  transactionExecuted: (data: TransactionExecutedMessage['payload']) => void;
  transactionExpired: (data: { sessionId: string; message: string }) => void;
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
