/**
 * Browser-side node selection for multi-sig transaction freezes.
 *
 * Mirror of `shared/node-selection.js` (Node CJS). The dApp is bundled
 * by Next.js so we can't directly import the root CommonJS helper —
 * this is the same algorithm in TypeScript with the dApp's lazy-import
 * pattern for `@hashgraph/sdk`.
 *
 * Default subset size is 1 — see `shared/node-selection.js` for the
 * full rationale (TL;DR: HashPack re-freezes ContractExecuteTransaction
 * internally before signing, multi-node freezes break wallet-signed
 * ceremonies with no recovery path). Bump for CLI-only ceremonies.
 */

import type { AccountId, Client } from '@hashgraph/sdk';

export const DEFAULT_SUBSET_SIZE = 1;

export type NodeStrategy = 'subset' | 'all' | 'specific';

/**
 * Optional mirror-node helper used by `orderByHealth` to put the
 * healthiest candidate at index 0 of a freeze. Implemented separately
 * for the dApp because the Node-side MirrorNodeClient isn't bundleable
 * here. Pass `null` to skip health ranking entirely.
 */
export interface MirrorHealthClient {
  getNetworkNodes(): Promise<Array<{
    node_account_id?: string;
    nodeAccountId?: string;
    stake?: number | string;
    service_endpoints?: unknown[];
    decline_reward?: boolean;
  }>>;
  getNodeRecentActivity(
    nodeAccountId: string,
    options?: { windowSeconds?: number },
  ): Promise<boolean | null>;
}

export interface NodeSelectionOptions {
  strategy?: NodeStrategy;
  subsetSize?: number;
  nodeIds?: Array<string | AccountId>;
  rng?: () => number;
  /**
   * When provided, the returned array is post-processed by
   * `orderByHealth` so the healthiest node sits at index 0. Critical
   * when a wallet signer (HashPack) only signs body[0] and the
   * executor downgrades to single-node submission — that body needs
   * to target a node currently accepting transactions.
   */
  mirrorClient?: MirrorHealthClient;
  useActivity?: boolean;
  activityWindowSeconds?: number;
  requireDeclineRewardFalse?: boolean;
}

/**
 * Reorder a candidate node list so the entry most likely to accept a
 * submission lands at index 0, preserving the rest as a randomized
 * pool. Browser-side mirror of `shared/node-selection.js#orderByHealth`.
 *
 * Three layers:
 *   1. Fisher-Yates shuffle (free, never worse than always-pick-[0]).
 *   2. Address-book filter via `/api/v1/network/nodes` — healthy nodes
 *      (stake > 0, non-empty service_endpoints) come first.
 *   3. Recent-activity preference via `/api/v1/transactions?node=…` —
 *      nodes that processed a transaction in the last N seconds get
 *      bumped to the very front.
 *
 * Output is a permutation of input; null/transient mirror failures
 * degrade to layer 1 silently.
 */
export async function orderByHealth(
  candidates: Array<string | AccountId>,
  options: {
    mirrorClient?: MirrorHealthClient;
    useActivity?: boolean;
    activityWindowSeconds?: number;
    requireDeclineRewardFalse?: boolean;
  } = {},
): Promise<string[]> {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const ids = candidates.map((c) => (typeof c === 'string' ? c : c.toString()));

  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  if (!options.mirrorClient) return shuffled;

  let healthyFirst = shuffled;
  try {
    const nodes = await options.mirrorClient.getNetworkNodes();
    const okIds = new Set(
      nodes
        .filter((n) => Number(n.stake) > 0)
        .filter((n) => Array.isArray(n.service_endpoints) && n.service_endpoints.length > 0)
        .filter((n) => !options.requireDeclineRewardFalse || n.decline_reward === false)
        .map((n) => String(n.node_account_id || n.nodeAccountId || ''))
        .filter((id) => id.length > 0),
    );
    const healthy = shuffled.filter((id) => okIds.has(id));
    const rest = shuffled.filter((id) => !okIds.has(id));
    healthyFirst = [...healthy, ...rest];
  } catch {
    // Mirror unreachable — degrade to shuffle-only.
  }

  if (options.useActivity === false) return healthyFirst;
  const window = options.activityWindowSeconds || 60;
  try {
    const checks = await Promise.all(
      healthyFirst.map((id) =>
        options.mirrorClient!.getNodeRecentActivity(id, { windowSeconds: window }),
      ),
    );
    const active: string[] = [];
    const passive: string[] = [];
    healthyFirst.forEach((id, i) => {
      if (checks[i] === true) active.push(id);
      else passive.push(id);
    });
    return [...active, ...passive];
  } catch {
    return healthyFirst;
  }
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
  const subset = shuffled.slice(0, N);

  if (!options.mirrorClient) return subset;

  // Promote the healthiest candidate to index 0 so the wallet-fallback
  // body[0] target is alive. Preserves the full subset for multi-node
  // submission resilience when CLI signers contribute full sig arrays.
  const orderedStrings = await orderByHealth(subset, {
    mirrorClient: options.mirrorClient,
    useActivity: options.useActivity,
    activityWindowSeconds: options.activityWindowSeconds,
    requireDeclineRewardFalse: options.requireDeclineRewardFalse,
  });
  const byString = new Map(subset.map((a) => [a.toString(), a]));
  return orderedStrings
    .map((s) => byString.get(s))
    .filter((a): a is AccountId => Boolean(a));
}
