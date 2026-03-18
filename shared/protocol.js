/**
 * Shared Protocol Definitions
 *
 * Single source of truth for WebSocket message types, session states,
 * participant states, and error codes. All server, client, and dApp code
 * should import constants from this module instead of using string literals.
 */

// ============================================================================
// Client → Server Message Types
// ============================================================================

const CLIENT_MESSAGES = {
  AUTH: 'AUTH',
  PARTICIPANT_READY: 'PARTICIPANT_READY',
  STATUS_UPDATE: 'STATUS_UPDATE',
  SIGNATURE_SUBMIT: 'SIGNATURE_SUBMIT',
  TRANSACTION_INJECT: 'TRANSACTION_INJECT',
  TRANSACTION_REJECTED: 'TRANSACTION_REJECTED',
  EXECUTE_TRANSACTION: 'EXECUTE_TRANSACTION',
  PING: 'PING',
};

// ============================================================================
// Server → Client Message Types
// ============================================================================

const SERVER_MESSAGES = {
  AUTH_SUCCESS: 'AUTH_SUCCESS',
  AUTH_FAILED: 'AUTH_FAILED',
  TRANSACTION_RECEIVED: 'TRANSACTION_RECEIVED',
  SIGNATURE_ACCEPTED: 'SIGNATURE_ACCEPTED',
  SIGNATURE_REJECTED: 'SIGNATURE_REJECTED',
  SIGNATURE_RECEIVED: 'SIGNATURE_RECEIVED',
  THRESHOLD_MET: 'THRESHOLD_MET',
  TRANSACTION_EXECUTED: 'TRANSACTION_EXECUTED',
  TRANSACTION_EXPIRED: 'TRANSACTION_EXPIRED',
  TRANSACTION_REJECTED: 'TRANSACTION_REJECTED',
  PARTICIPANT_CONNECTED: 'PARTICIPANT_CONNECTED',
  PARTICIPANT_READY: 'PARTICIPANT_READY',
  PARTICIPANT_DISCONNECTED: 'PARTICIPANT_DISCONNECTED',
  PARTICIPANT_STATUS_UPDATE: 'PARTICIPANT_STATUS_UPDATE',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  INJECTION_FAILED: 'INJECTION_FAILED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  ERROR: 'ERROR',
  PONG: 'PONG',
};

// Combined for convenience (all message types)
const MESSAGE_TYPES = {
  ...CLIENT_MESSAGES,
  ...SERVER_MESSAGES,
};

// ============================================================================
// Session States
// ============================================================================

const SESSION_STATES = {
  WAITING: 'waiting',
  TRANSACTION_RECEIVED: 'transaction-received',
  SIGNING: 'signing',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  TRANSACTION_EXPIRED: 'transaction-expired',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
};

/**
 * Valid session state transitions.
 * Key = current state, Value = array of valid next states.
 */
const SESSION_TRANSITIONS = {
  [SESSION_STATES.WAITING]: [
    SESSION_STATES.TRANSACTION_RECEIVED,
    SESSION_STATES.EXPIRED,
    SESSION_STATES.CANCELLED,
  ],
  [SESSION_STATES.TRANSACTION_RECEIVED]: [
    SESSION_STATES.SIGNING,
    SESSION_STATES.TRANSACTION_EXPIRED,
    SESSION_STATES.EXPIRED,
    SESSION_STATES.CANCELLED,
  ],
  [SESSION_STATES.SIGNING]: [
    SESSION_STATES.EXECUTING,
    SESSION_STATES.TRANSACTION_EXPIRED,
    SESSION_STATES.EXPIRED,
    SESSION_STATES.CANCELLED,
  ],
  [SESSION_STATES.EXECUTING]: [
    SESSION_STATES.COMPLETED,
    SESSION_STATES.SIGNING, // revert on error (legacy 'active' mapped here)
  ],
  [SESSION_STATES.COMPLETED]: [], // terminal
  [SESSION_STATES.TRANSACTION_EXPIRED]: [
    SESSION_STATES.WAITING, // reset for new transaction injection
    SESSION_STATES.EXPIRED,
    SESSION_STATES.CANCELLED,
  ],
  [SESSION_STATES.EXPIRED]: [], // terminal
  [SESSION_STATES.CANCELLED]: [], // terminal
};

/**
 * Check if a state transition is valid.
 *
 * @param {string} currentState - Current session state
 * @param {string} nextState - Proposed next state
 * @returns {boolean} True if transition is valid
 */
function isValidTransition(currentState, nextState) {
  const validNextStates = SESSION_TRANSITIONS[currentState];
  if (!validNextStates) return false;
  return validNextStates.includes(nextState);
}

/**
 * States in which a session is considered "active" (not terminal).
 */
const ACTIVE_SESSION_STATES = [
  SESSION_STATES.WAITING,
  SESSION_STATES.TRANSACTION_RECEIVED,
  SESSION_STATES.SIGNING,
];

/**
 * States in which authentication is allowed.
 */
const AUTH_VALID_STATES = [
  SESSION_STATES.WAITING,
  SESSION_STATES.TRANSACTION_RECEIVED,
  SESSION_STATES.SIGNING,
];

/**
 * States in which signatures can be accepted.
 */
const SIGNATURE_VALID_STATES = [
  SESSION_STATES.TRANSACTION_RECEIVED,
  SESSION_STATES.SIGNING,
];

// ============================================================================
// Participant States
// ============================================================================

const PARTICIPANT_STATES = {
  CONNECTED: 'connected',
  READY: 'ready',
  REVIEWING: 'reviewing',
  SIGNING: 'signing',
  SIGNED: 'signed',
  REJECTED: 'rejected',
  DISCONNECTED: 'disconnected',
};

// ============================================================================
// Error Codes
// ============================================================================

const ERROR_CODES = {
  // Authentication
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_RATE_LIMITED: 'AUTH_RATE_LIMITED',
  AUTH_KEY_NOT_ELIGIBLE: 'AUTH_KEY_NOT_ELIGIBLE',
  AUTH_COORDINATOR_TOKEN_INVALID: 'AUTH_COORDINATOR_TOKEN_INVALID',

  // Session
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_INVALID_STATE: 'SESSION_INVALID_STATE',

  // Signature
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  SIGNATURE_DUPLICATE: 'SIGNATURE_DUPLICATE',
  SIGNATURE_KEY_NOT_ELIGIBLE: 'SIGNATURE_KEY_NOT_ELIGIBLE',
  SIGNATURE_NO_TRANSACTION: 'SIGNATURE_NO_TRANSACTION',

  // Transaction
  TRANSACTION_EXPIRED: 'TRANSACTION_EXPIRED',
  TRANSACTION_INVALID: 'TRANSACTION_INVALID',
  TRANSACTION_INJECTION_FAILED: 'TRANSACTION_INJECTION_FAILED',
  TRANSACTION_EXECUTION_FAILED: 'TRANSACTION_EXECUTION_FAILED',

  // Protocol
  MESSAGE_INVALID: 'MESSAGE_INVALID',
  MESSAGE_TOO_LARGE: 'MESSAGE_TOO_LARGE',
};

// ============================================================================
// Participant Roles
// ============================================================================

const ROLES = {
  COORDINATOR: 'coordinator',
  PARTICIPANT: 'participant',
  AGENT: 'agent',
};

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Message types
  CLIENT_MESSAGES,
  SERVER_MESSAGES,
  MESSAGE_TYPES,

  // Session states
  SESSION_STATES,
  SESSION_TRANSITIONS,
  isValidTransition,
  ACTIVE_SESSION_STATES,
  AUTH_VALID_STATES,
  SIGNATURE_VALID_STATES,

  // Participant states
  PARTICIPANT_STATES,

  // Error codes
  ERROR_CODES,

  // Roles
  ROLES,
};
