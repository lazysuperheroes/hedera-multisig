/**
 * Browser-side node selection for multi-sig transaction freezes.
 *
 * Mirror of `shared/node-selection.js` (Node CJS). The dApp is bundled
 * by Next.js so we can't directly import the root CommonJS helper —
 * this is the same algorithm in TypeScript with the dApp's lazy-import
 * pattern for `@hashgraph/sdk`.
 *
 * See `shared/node-selection.js` for the full rationale on subset
 * sizing, the 6 KB tx-size cap, and why multi-node freeze is canonical.
 */

import type { AccountId, Client } from '@hashgraph/sdk';

export const DEFAULT_SUBSET_SIZE = 6;

export type NodeStrategy = 'subset' | 'all' | 'specific';

export interface NodeSelectionOptions {
  strategy?: NodeStrategy;
  subsetSize?: number;
  nodeIds?: Array<string | AccountId>;
  rng?: () => number;
}

/**
 * Dedupe `client.network` (each node is exposed under multiple
 * endpoints — gRPC :50211 + gRPC-Web :443). Returns AccountId[] in
 * insertion order, each appearing exactly once.
 */
export function uniqueNetworkNodes(
  client: Client,
  AccountIdCtor: typeof AccountId
): AccountId[] {
  const seen = new Set<string>();
  const out: AccountId[] = [];
  // Hedera SDK's `client.network` is `Record<string, AccountId>`.
  const network = client.network as unknown as Record<string, AccountId | string>;
  for (const id of Object.values(network)) {
    const acc = typeof id === 'string' ? AccountIdCtor.fromString(id) : id;
    const key = acc.toString();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(acc);
    }
  }
  return out;
}

/**
 * Pick node AccountIds for a multi-sig freeze.
 */
export async function selectNodeAccountIds(
  client: Client,
  options: NodeSelectionOptions = {}
): Promise<AccountId[]> {
  const { AccountId: AccountIdCtor } = await import('@hashgraph/sdk');
  const strategy: NodeStrategy = options.strategy || 'subset';
  const allUnique = uniqueNetworkNodes(client, AccountIdCtor);

  if (allUnique.length === 0) {
    throw new Error('Client network has no nodes');
  }

  if (strategy === 'all') {
    return allUnique;
  }

  if (strategy === 'specific') {
    if (!options.nodeIds || options.nodeIds.length === 0) {
      throw new Error("strategy 'specific' requires options.nodeIds");
    }
    const known = new Set(allUnique.map((a) => a.toString()));
    const valid: AccountId[] = [];
    const invalid: string[] = [];
    for (const raw of options.nodeIds) {
      const str = typeof raw === 'string' ? raw : raw.toString();
      if (!known.has(str)) {
        invalid.push(str);
        continue;
      }
      valid.push(typeof raw === 'string' ? AccountIdCtor.fromString(raw) : raw);
    }
    if (invalid.length > 0) {
      throw new Error(
        `Node(s) not in this network: ${invalid.join(', ')}. ` +
          `Available: ${[...known].join(', ')}`
      );
    }
    return valid;
  }

  // 'subset' (default)
  const requested = options.subsetSize ?? DEFAULT_SUBSET_SIZE;
  const N = Math.max(1, Math.min(Math.floor(requested), allUnique.length));
  const rng = options.rng || Math.random;
  const shuffled = [...allUnique];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, N);
}
