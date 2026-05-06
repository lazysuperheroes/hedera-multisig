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
 * @returns {AccountId[]}
 */
function selectNodeAccountIds(client, options = {}) {
  const strategy = options.strategy || 'subset';
  const allUnique = uniqueNetworkNodes(client);

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
    return valid;
  }

  // 'subset' (default)
  const requested = options.subsetSize ?? DEFAULT_SUBSET_SIZE;
  const N = Math.max(1, Math.min(Math.floor(requested), allUnique.length));
  const rng = options.rng || Math.random;
  const shuffled = [...allUnique];
  // Fisher-Yates
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, N);
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

module.exports = {
  selectNodeAccountIds,
  uniqueNetworkNodes,
  DEFAULT_SUBSET_SIZE,
};
