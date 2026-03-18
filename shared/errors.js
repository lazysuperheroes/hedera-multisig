/**
 * Shared Error Classes
 *
 * Typed error hierarchy for programmatic error handling.
 * Each error class has a `code` property matching ERROR_CODES in protocol.js.
 */

const { ERROR_CODES } = require('./protocol');

/**
 * Base error class for all MultiSig errors.
 */
class MultiSigError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR') {
    super(message);
    this.name = 'MultiSigError';
    this.code = code;
  }
}

/**
 * Transaction has expired (120-second validity window exceeded).
 */
class TransactionExpiredError extends MultiSigError {
  constructor(message = 'Transaction validity window has expired') {
    super(message, ERROR_CODES.TRANSACTION_EXPIRED);
    this.name = 'TransactionExpiredError';
  }
}

/**
 * Signature is cryptographically invalid.
 */
class InvalidSignatureError extends MultiSigError {
  constructor(message = 'Signature verification failed', details = {}) {
    super(message, ERROR_CODES.SIGNATURE_INVALID);
    this.name = 'InvalidSignatureError';
    this.publicKey = details.publicKey || null;
  }
}

/**
 * Not enough valid signatures to meet the threshold.
 */
class InsufficientSignaturesError extends MultiSigError {
  constructor(collected, required) {
    super(`Insufficient signatures: ${collected}/${required} required`, ERROR_CODES.SIGNATURE_INVALID);
    this.name = 'InsufficientSignaturesError';
    this.collected = collected;
    this.required = required;
  }
}

/**
 * Session not found or has been cleaned up.
 */
class SessionNotFoundError extends MultiSigError {
  constructor(sessionId) {
    super(`Session not found: ${sessionId || 'unknown'}`, ERROR_CODES.SESSION_NOT_FOUND);
    this.name = 'SessionNotFoundError';
    this.sessionId = sessionId;
  }
}

/**
 * Authentication failed (wrong PIN, wrong coordinator token, rate limited).
 */
class AuthenticationError extends MultiSigError {
  constructor(message = 'Authentication failed', code = ERROR_CODES.AUTH_INVALID_CREDENTIALS) {
    super(message, code);
    this.name = 'AuthenticationError';
  }
}

/**
 * Rate limit exceeded for authentication attempts.
 */
class RateLimitError extends AuthenticationError {
  constructor(message = 'Too many failed authentication attempts') {
    super(message, ERROR_CODES.AUTH_RATE_LIMITED);
    this.name = 'RateLimitError';
  }
}

/**
 * Session is in an invalid state for the requested operation.
 */
class InvalidSessionStateError extends MultiSigError {
  constructor(currentState, operation) {
    super(`Cannot ${operation} — session is in '${currentState}' state`, ERROR_CODES.SESSION_INVALID_STATE);
    this.name = 'InvalidSessionStateError';
    this.currentState = currentState;
  }
}

/**
 * Public key is not in the session's eligible signers list.
 */
class KeyNotEligibleError extends MultiSigError {
  constructor(message = 'Public key is not eligible to sign this transaction') {
    super(message, ERROR_CODES.SIGNATURE_KEY_NOT_ELIGIBLE);
    this.name = 'KeyNotEligibleError';
  }
}

/**
 * No frozen transaction in session (signature submitted before TX injection).
 */
class NoTransactionError extends MultiSigError {
  constructor() {
    super('No transaction to sign — transaction must be injected before signatures can be submitted', ERROR_CODES.SIGNATURE_NO_TRANSACTION);
    this.name = 'NoTransactionError';
  }
}

module.exports = {
  MultiSigError,
  TransactionExpiredError,
  InvalidSignatureError,
  InsufficientSignaturesError,
  SessionNotFoundError,
  AuthenticationError,
  RateLimitError,
  InvalidSessionStateError,
  KeyNotEligibleError,
  NoTransactionError,
};
