/**
 * Alternate-verify probe — tries a battery of message transformations
 * against a wallet-returned signature when the standard
 * `verify(bodyBytes, signature)` fails despite identical bodyBytes
 * and a matching public key.
 *
 * Originally built during the v2.2.0 ContractExecute investigation to
 * test the hypothesis that wallets were signing some non-standard
 * message form (sha384, prefixed, etc.). 19 candidates ruled out, all
 * failed — which redirected the investigation to the wallet-side
 * adapter, where we found `@hashgraph/hedera-wallet-connect`'s
 * `DAppSigner.signTransaction` rebuilding the TransactionBody before
 * sending to the wallet. Fixed by bypass in `dapp/lib/walletconnect.ts`.
 *
 * Kept as a regression-detection tool: any future signature-mismatch
 * (new SDK bug, new wallet quirk, our own bypass regressing) will
 * surface a definitive negative here, telling investigators "stop
 * looking at the wallet, look at the adapter / our code path."
 *
 * Caveat: a positive match (wallet signs e.g. sha384(bodyBytes))
 * confirms what the wallet did but does NOT give us a recoverable
 * signature, because the Hedera network only accepts sigs over
 * bodyBytes directly. Diagnostic, not a workaround.
 *
 * Localhost-gated; harmless to leave in.
 */

import type { PublicKey } from '@hashgraph/sdk';

const isDevHost = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (process.env.NEXT_PUBLIC_DEBUG_TX === '1') return true;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h.endsWith('.local');
};

interface VerifyCandidate {
  name: string;
  build: (bodyBytes: Uint8Array) => Promise<Uint8Array>;
}

const concatBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};

const sha = async (alg: 'SHA-256' | 'SHA-384' | 'SHA-512', bytes: Uint8Array): Promise<Uint8Array> => {
  // TS 5.7+ tightened SubtleCrypto types — Uint8Array<ArrayBufferLike>
  // isn't directly assignable to BufferSource. The cast is safe; Web
  // Crypto reads the byte view, never touches the underlying buffer.
  return new Uint8Array(await crypto.subtle.digest(alg, bytes as unknown as BufferSource));
};

const buildPrefixCandidates = (): VerifyCandidate[] => {
  // Plausible prefix conventions a Hedera wallet might apply. None of
  // these are documented in the Hedera spec — we're brute-forcing
  // common patterns from adjacent ecosystems.
  const prefixes: Array<[string, string]> = [
    ['hedera-prefix', 'Hedera Signed Message:\n'],
    ['hedera-eth-style', '\x19Hedera Signed Message:\n'],
    ['hedera-context-byte', '\x18Hedera Signed Message:\n'],
    ['hashgraph-testnet-id', 'hedera-testnet'],
    ['hashgraph-mainnet-id', 'hedera-mainnet'],
    ['walletconnect-prefix', 'WalletConnect Signed Transaction:\n'],
    ['eth-personal-sign', '\x19Ethereum Signed Message:\n'],
  ];

  const variants: VerifyCandidate[] = [];
  for (const [tag, prefixStr] of prefixes) {
    const prefixBytes = new TextEncoder().encode(prefixStr);
    variants.push({
      name: `${tag}: ${JSON.stringify(prefixStr)} || bodyBytes`,
      build: async (b) => concatBytes(prefixBytes, b),
    });
    variants.push({
      name: `${tag}: sha384(${JSON.stringify(prefixStr)} || bodyBytes)`,
      build: async (b) => sha('SHA-384', concatBytes(prefixBytes, b)),
    });
  }
  return variants;
};

const candidates: VerifyCandidate[] = [
  { name: 'direct: bodyBytes', build: async (b) => b },
  { name: 'sha256(bodyBytes)', build: async (b) => sha('SHA-256', b) },
  { name: 'sha384(bodyBytes)', build: async (b) => sha('SHA-384', b) },
  { name: 'sha512(bodyBytes)', build: async (b) => sha('SHA-512', b) },
  { name: 'reversed(bodyBytes)', build: async (b) => Uint8Array.from(b).reverse() },
  ...buildPrefixCandidates(),
];

export interface ProbeResult {
  found: boolean;
  variantName?: string;
  triedCount: number;
  skipped?: boolean;
}

/**
 * Try each verify-candidate transformation. Logs progress. Returns
 * the first match (if any) or a "no variant matched" verdict.
 */
export async function probeVerifyPaths(
  bodyBytes: Uint8Array,
  signature: Uint8Array,
  walletPubKey: PublicKey,
): Promise<ProbeResult> {
  if (!isDevHost()) {
    return { found: false, triedCount: 0, skipped: true };
  }

  console.log(
    '%c[probe] trying alternate verify paths to figure out what the wallet actually signed…',
    'color: #f59e0b; font-weight: bold;',
  );

  let tried = 0;
  for (const cand of candidates) {
    tried += 1;
    try {
      const message = await cand.build(bodyBytes);
      const ok = walletPubKey.verify(message, signature);
      if (ok) {
        console.log(
          `%c[probe] ✓ MATCH after ${tried} attempt(s): wallet signed "${cand.name}"`,
          'color: #16a34a; font-weight: bold;',
        );
        return { found: true, variantName: cand.name, triedCount: tried };
      }
    } catch {
      // Some variants throw if the message is empty / wrong shape — ignore.
    }
  }

  console.log(
    `%c[probe] ✗ no variant matched after ${tried} attempts — wallet signs something we cannot reproduce from bodyBytes. ` +
      'Most likely the wallet re-serialized the TransactionBody differently and discarded the modified bytes before returning, ' +
      'OR the wallet signs an internal representation we cannot reach.',
    'color: #dc2626; font-weight: bold;',
  );
  return { found: false, triedCount: tried };
}
