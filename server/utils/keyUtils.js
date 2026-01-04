/**
 * Key Utilities
 *
 * Shared key management utilities for the server components.
 * Handles public key normalization and eligibility checks.
 *
 * @module server/utils/keyUtils
 */

/**
 * Normalize a public key to ensure consistent 0x prefix
 *
 * @param {string} key - Public key (with or without 0x prefix)
 * @returns {string} Normalized public key with 0x prefix
 */
function normalizePublicKey(key) {
  if (!key) return key;
  const trimmed = key.trim();
  return trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
}

/**
 * Check if a public key is in the eligible list (handles 0x prefix variations)
 *
 * @param {string} key - Public key to check
 * @param {string[]} eligibleKeys - List of eligible public keys
 * @returns {boolean} True if key is eligible
 */
function isKeyEligible(key, eligibleKeys) {
  if (!key || !eligibleKeys || eligibleKeys.length === 0) return false;
  const normalizedKey = normalizePublicKey(key);
  return eligibleKeys.some(eligible => normalizePublicKey(eligible) === normalizedKey);
}

/**
 * Find matching key in the eligible list
 *
 * @param {string} key - Public key to find
 * @param {string[]} eligibleKeys - List of eligible public keys
 * @returns {string|null} Matching key from the list or null if not found
 */
function findMatchingKey(key, eligibleKeys) {
  if (!key || !eligibleKeys || eligibleKeys.length === 0) return null;
  const normalizedKey = normalizePublicKey(key);
  return eligibleKeys.find(eligible => normalizePublicKey(eligible) === normalizedKey) || null;
}

module.exports = {
  normalizePublicKey,
  isKeyEligible,
  findMatchingKey,
};
