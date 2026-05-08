/**
 * Canonical public-key utilities for the dApp.
 *
 * Mirrors `shared/crypto-utils.js#toRawPublicKeyHex` on the server so
 * that DER (CLI-produced) and raw (HashPack/WalletConnect-produced)
 * forms of the same key compare equal.
 *
 * Without this, the participant-list eligibility check string-compares
 * a 64-char raw hex from a wallet-connected signer against an
 * 88-char DER-prefixed string in `session.eligiblePublicKeys` and
 * surfaces a ⚠️ "not eligible" warning on every row, even though both
 * keys are correct.
 */

const ED25519_DER_PREFIX = '302a300506032b6570032100';
const ECDSA_SECP256K1_DER_PREFIX = '302d300706052b8104000a032200';

/**
 * Canonicalize a Hedera public key to lowercase raw hex.
 *
 *   - Strips a leading `0x` if present.
 *   - Lowercases.
 *   - If the result starts with a known Hedera DER prefix (ed25519 or
 *     ECDSA secp256k1), strips that too.
 */
export function toRawPublicKeyHex(key: string | null | undefined): string {
  if (!key || typeof key !== 'string') return '';
  let hex = key.trim().toLowerCase();
  if (hex.startsWith('0x')) hex = hex.slice(2);
  if (hex.startsWith(ED25519_DER_PREFIX)) {
    hex = hex.slice(ED25519_DER_PREFIX.length);
  } else if (hex.startsWith(ECDSA_SECP256K1_DER_PREFIX)) {
    hex = hex.slice(ECDSA_SECP256K1_DER_PREFIX.length);
  }
  return hex;
}

/**
 * Two keys equal-by-canonical-form?
 *
 * Convenience wrapper for the common case: compare a wallet-supplied
 * key (often raw) against a CLI-registered eligible key (often DER).
 */
export function publicKeysEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const canonicalA = toRawPublicKeyHex(a);
  const canonicalB = toRawPublicKeyHex(b);
  return canonicalA !== '' && canonicalA === canonicalB;
}
