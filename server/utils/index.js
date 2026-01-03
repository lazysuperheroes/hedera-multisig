/**
 * Server Utilities
 *
 * Common utilities for server components.
 *
 * @module server/utils
 */

const keyUtils = require('./keyUtils');

module.exports = {
  // Key utilities
  normalizePublicKey: keyUtils.normalizePublicKey,
  isKeyEligible: keyUtils.isKeyEligible,
  findMatchingKey: keyUtils.findMatchingKey,
};
