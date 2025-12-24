/**
 * Client Module Exports
 *
 * Provides participant-side functionality for networked multi-signature sessions.
 */

const SigningClient = require('./SigningClient');
const TransactionReviewer = require('./TransactionReviewer');

module.exports = {
  SigningClient,
  TransactionReviewer
};
