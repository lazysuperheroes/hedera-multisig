/**
 * Key Utilities
 *
 * Shared key management utilities for the server components.
 *
 * Eligibility comparison must canonicalize across DER vs raw encoding:
 * the CLI registers keys as SubjectPublicKeyInfo DER
 * (`302a300506032b6570032100…` for ed25519), but browser wallets
 * (HashPack via WalletConnect, etc.) deliver the raw 32-byte key over
 * the wire. Without canonicalization the AUTH eligibility check
 * treats the same key as two distinct values and rejects the
 * participant. `toRawPublicKeyHex` from `shared/crypto-utils.js` is
 * the canonical form — use it for any cross-producer equality check.
 *
 * @module server/utils/keyUtils
 */

const { toRawPublicKeyHex } = require('../../shared/crypto-utils');

/**
 * Normalize a public key to ensure consistent 0x prefix.
 *
 * Kept for backward-compatibility with callers that expect the 0x form
 * for display or transport. NOT a canonicalizer for equality — use
 * `toRawPublicKeyHex` for that.
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
 * Check if a public key is in the eligible list.
 *
 * @param {string} key - Public key to check (DER or raw hex)
 * @param {string[]} eligibleKeys - Eligible keys (any mix of DER/raw)
 * @returns {boolean} True if key is eligible
 */
function isKeyEligible(key, eligibleKeys) {
  if (!key || !eligibleKeys || eligibleKeys.length === 0) return false;
  const canonical = toRawPublicKeyHex(key);
  if (!canonical) return false;
  return eligibleKeys.some(eligible => toRawPublicKeyHex(eligible) === canonical);
}

/**
 * Find a matching key in the eligible list, returning the eligible
 * entry in its original (typically DER) form so callers that need the
 * canonical stored representation get it back.
 *
 * @param {string} key - Public key to find (DER or raw hex)
 * @param {string[]} eligibleKeys - Eligible keys (any mix of DER/raw)
 * @returns {string|null} Matching key from the list or null if not found
 */
function findMatchingKey(key, eligibleKeys) {
  if (!key || !eligibleKeys || eligibleKeys.length === 0) return null;
  const canonical = toRawPublicKeyHex(key);
  if (!canonical) return null;
  return eligibleKeys.find(eligible => toRawPublicKeyHex(eligible) === canonical) || null;
}

module.exports = {
  normalizePublicKey,
  isKeyEligible,
  findMatchingKey,
};
