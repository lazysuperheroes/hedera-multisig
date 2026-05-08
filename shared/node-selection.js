/**
 * Node selection for multi-sig transaction freezes.
 *
 * Multi-node freeze is the canonical Hedera multi-sig pattern: signing
 * every node body up front lets execute() rotate to any healthy node
 * if the first one is busy. But freezing against the FULL network is
 * impractical past ~14 nodes (3-signer transfer hits the 6 KB tx-size
 * cap; mainnet's 30+ nodes won't submit at all). This helper picks a
 * resilient-but-bounded subset.
 *
 * Strategies:
 *   - 'subset' (default): random N from client.network. Default N=6.
 *     Resilient to per-node downtime (1−p^N where p = per-node downtime
 *     probability), comfortably under the 6 KB cap for typical txs.
 *   - 'all': every unique node. Use only when you know the network is
 *     small (e.g., a single-node local dev cluster).
 *   - 'specific': exactly the AccountIds you supply. Validates each
 *     against the client's network — fails loudly if any are unknown.
 */

const { AccountId } = require('@hashgraph/sdk');

const DEFAULT_SUBSET_SIZE = 6;

/**
 * @param {import('@hashgraph/sdk').Client} client
 * @param {Object} [options]
 * @param {'subset'|'all'|'specific'} [options.strategy='subset']
 * @param {number} [options.subsetSize=6]
 * @param {Array<string|AccountId>} [options.nodeIds] — required for 'specific'
 * @param {() => number} [options.rng=Math.random]
 * @param {Object} [options.mirrorClient] - When provided, the returned
 *   array is post-processed by `orderByHealth` so the healthiest node
 *   sits at index 0. Critical when wallet signers (HashPack) only sign
 *   body[0] and the executor downgrades to single-node submission —
 *   that body needs to target a node currently accepting transactions.
 * @param {boolean} [options.useActivity=true] - Layer 3 of orderByHealth.
 * @returns {Promise<AccountId[]>|AccountId[]} Async iff mirrorClient given.
 */
function selectNodeAccountIds(client, options = {}) {
  const strategy = options.strategy || 'subset';
  const allUnique = uniqueNetworkNodes(client);

  if (allUnique.length === 0) {
    throw new Error('Client network has no nodes');
  }

  let result;
  if (strategy === 'all') {
    result = allUnique;
  } else if (strategy === 'specific') {
    if (!options.nodeIds || options.nodeIds.length === 0) {
      throw new Error("strategy 'specific' requires options.nodeIds");
    }
    const known = new Set(allUnique.map((a) => a.toString()));
    const valid = [];
    const invalid = [];
    for (const raw of options.nodeIds) {
      const str = typeof raw === 'string' ? raw : raw.toString();
      if (!known.has(str)) {
        invalid.push(str);
        continue;
      }
      valid.push(typeof raw === 'string' ? AccountId.fromString(raw) : raw);
    }
    if (invalid.length > 0) {
      throw new Error(
        `Node(s) not in this network: ${invalid.join(', ')}. ` +
          `Available: ${[...known].join(', ')}`
      );
    }
    result = valid;
  } else {
    // 'subset' (default)
    const requested = options.subsetSize ?? DEFAULT_SUBSET_SIZE;
    const N = Math.max(1, Math.min(Math.floor(requested), allUnique.length));
    const rng = options.rng || Math.random;
    const shuffled = [...allUnique];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    result = shuffled.slice(0, N);
  }

  // Synchronous return path preserves the original API for every call
  // site that doesn't pass a mirrorClient. The async path reorders so
  // the wallet-fallback "body[0]" target is healthy.
  if (!options.mirrorClient) return result;
  return orderByHealth(result.map((a) => a.toString()), {
    mirrorClient: options.mirrorClient,
    useActivity: options.useActivity,
    activityWindowSeconds: options.activityWindowSeconds,
    requireDeclineRewardFalse: options.requireDeclineRewardFalse,
  }).then((orderedStrings) => {
    const byString = new Map(result.map((a) => [a.toString(), a]));
    return orderedStrings.map((s) => byString.get(s)).filter(Boolean);
  });
}

/**
 * Dedupe `client.network` (which exposes each node under multiple
 * endpoints — gRPC :50211 + gRPC-Web :443). Returns AccountId[] in
 * insertion order with each AccountId appearing exactly once.
 */
function uniqueNetworkNodes(client) {
  const seen = new Set();
  const out = [];
  for (const id of Object.values(client.network)) {
    const acc = typeof id === 'string' ? AccountId.fromString(id) : id;
    const key = acc.toString();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(acc);
    }
  }
  return out;
}

/**
 * Reorder a candidate node list so the entry most likely to accept a
 * submission lands at index 0, preserving the rest as a randomized
 * pool behind it.
 *
 * The motivation is **freeze-time**, not execute-time: when a wallet
 * signer only signs body[0] of a multi-node freeze (HashPack via
 * WalletConnect typically does this), the executor is forced to
 * downgrade to single-node submission against that one body. The node
 * at body[0] needs to be healthy. By promoting a verified-active node
 * to index 0 *during freeze*, we make the eventual single-node fallback
 * land on a live target, while keeping the multi-node array intact
 * for the canonical multi-sig path (CLI signers who produce all N
 * signatures still get full resilience).
 *
 *   1. Random-shuffle the candidates so we don't always hammer the
 *      lowest-numbered node id.
 *   2. Filter against the mirror node's address book — keep only nodes
 *      with `stake > 0` and a non-empty `service_endpoints` list (the
 *      ones currently participating in consensus). Nodes failing this
 *      get pushed to the back rather than removed, so we still return
 *      every input candidate.
 *   3. If recent-activity is requested, prefer candidates that have
 *      processed a transaction in the last N seconds — Hedera doesn't
 *      expose a liveness ping, but consensus runs continuously so an
 *      idle node is suspect. Best-effort: null ("unknown, transient
 *      mirror failure") doesn't disqualify, only `false` does.
 *
 * Output is always a permutation of the input — same set, possibly
 * reordered. Falls back to a randomized order if mirror calls fail, so
 * callers can treat this as "best-effort improvement, never worse than
 * shuffle".
 *
 * @param {Array<{toString(): string}|string>} candidates - Node account ids
 * @param {Object} [options]
 * @param {Object} [options.mirrorClient] - MirrorNodeClient instance.
 *   When omitted, returns a pure shuffle.
 * @param {boolean} [options.useActivity=true] - Apply layer #3.
 * @param {number} [options.activityWindowSeconds=60] - Layer #3 window.
 * @param {boolean} [options.requireDeclineRewardFalse=false] - Layer #2 strictness.
 * @returns {Promise<string[]>} Reordered ids; same set as input.
 */
async function orderByHealth(candidates, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const ids = candidates.map((c) => (typeof c === 'string' ? c : c.toString()));

  // Layer 1: Fisher-Yates. Cheap, gives 1/N odds across the freeze's
  // nodes even if mirror is unreachable.
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  if (!options.mirrorClient) return shuffled;

  // Layer 2: rank by address-book health. Healthy ids first, the rest
  // appended (so the input set is preserved).
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
    // Mirror unreachable — degrade silently to shuffle-only.
  }

  // Layer 3: bubble candidates with verified recent activity to the
  // very front. Only consult mirror for the top candidates that
  // already passed layer 2 — bounded cost per freeze.
  if (options.useActivity === false) return healthyFirst;
  const window = options.activityWindowSeconds || 60;
  try {
    const checks = await Promise.all(
      healthyFirst.map((id) =>
        options.mirrorClient.getNodeRecentActivity(id, { windowSeconds: window }),
      ),
    );
    const active = [];
    const passive = [];
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
 * Convenience: pick a single healthiest candidate.
 *
 * Just `orderByHealth(candidates, options)[0]`. Useful at execution
 * time when the executor is forced to single-node submission and
 * needs one node id; callers that want the full reordered list (the
 * common case at freeze time) should use `orderByHealth` directly.
 */
async function selectHealthyNode(candidates, options = {}) {
  const ordered = await orderByHealth(candidates, options);
  return ordered[0] || null;
}

module.exports = {
  selectNodeAccountIds,
  uniqueNetworkNodes,
  orderByHealth,
  selectHealthyNode,
  DEFAULT_SUBSET_SIZE,
};
