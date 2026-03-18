/**
 * Client Module Exports
 *
 * Provides participant-side functionality for networked multi-signature sessions.
 */

const SigningClient = require('./SigningClient');
const AgentSigningClient = require('./AgentSigningClient');
const TransactionReviewer = require('./TransactionReviewer');
const {
  PolicyEngine,
  MaxAmountRule,
  AllowedRecipientsRule,
  AllowedTransactionTypesRule,
  TimeWindowRule,
  RateLimitRule,
  createTreasuryAgentPolicy,
  createApprovalBotPolicy,
} = require('./PolicyEngine');

module.exports = {
  SigningClient,
  AgentSigningClient,
  TransactionReviewer,
  PolicyEngine,
  MaxAmountRule,
  AllowedRecipientsRule,
  AllowedTransactionTypesRule,
  TimeWindowRule,
  RateLimitRule,
  createTreasuryAgentPolicy,
  createApprovalBotPolicy,
};
