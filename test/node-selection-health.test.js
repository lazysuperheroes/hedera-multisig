/**
 * Tests for the health-aware ordering layer.
 *
 * The wallet-fallback path (HashPack only signs body[0], executor
 * downgrades to single-node submission) makes node-zero of the freeze
 * load-bearing. This test guards the three-layer ordering rule:
 *   1. shuffle (always; works without mirror)
 *   2. healthy (stake>0 + service_endpoints) before unhealthy
 *   3. recent-activity before idle
 */

const { expect } = require('chai');
const { orderByHealth, selectHealthyNode } = require('../shared/node-selection');

function makeMirror({ nodes, activity } = {}) {
  return {
    async getNetworkNodes() {
      return nodes || [];
    },
    async getNodeRecentActivity(id) {
      if (!activity) return null;
      if (Object.prototype.hasOwnProperty.call(activity, id)) return activity[id];
      return null;
    },
  };
}

describe('shared/node-selection — health-aware ordering', function() {

  it('returns empty for empty input', async function() {
    expect(await orderByHealth([])).to.deep.equal([]);
    expect(await selectHealthyNode([])).to.equal(null);
  });

  it('shuffles without a mirror client (degraded mode is never worse than always-[0])', async function() {
    // 100 trials: with no mirror, every input position should win
    // index 0 at least once (Fisher-Yates is uniform). Probabilistic
    // but with N=100 trials over a 6-element list, a stuck "always
    // returns input order" implementation would fail this nearly
    // always.
    const ids = ['0.0.3', '0.0.4', '0.0.5', '0.0.6', '0.0.7', '0.0.8'];
    const seen = new Set();
    for (let i = 0; i < 100; i++) {
      const ordered = await orderByHealth(ids);
      seen.add(ordered[0]);
    }
    expect(seen.size).to.be.greaterThan(1);
  });

  it('promotes healthy nodes ahead of unhealthy ones', async function() {
    const mirrorClient = makeMirror({
      nodes: [
        { node_account_id: '0.0.3', stake: 100, service_endpoints: [{ ip_address_v4: '1.2.3.4' }] },
        { node_account_id: '0.0.4', stake: 0, service_endpoints: [{ ip_address_v4: '1.2.3.5' }] }, // 0 stake → unhealthy
        { node_account_id: '0.0.5', stake: 100, service_endpoints: [] }, // no endpoints → unhealthy
        { node_account_id: '0.0.6', stake: 100, service_endpoints: [{ ip_address_v4: '1.2.3.6' }] },
      ],
    });
    const ordered = await orderByHealth(['0.0.3', '0.0.4', '0.0.5', '0.0.6'], {
      mirrorClient,
      useActivity: false, // isolate layer 2
    });
    // 0.0.3 and 0.0.6 are healthy; 0.0.4 and 0.0.5 are not.
    const firstTwo = ordered.slice(0, 2).sort();
    expect(firstTwo).to.deep.equal(['0.0.3', '0.0.6']);
    const lastTwo = ordered.slice(2).sort();
    expect(lastTwo).to.deep.equal(['0.0.4', '0.0.5']);
  });

  it('promotes nodes with recent activity to the very front', async function() {
    const allHealthy = ['0.0.3', '0.0.4', '0.0.5'].map((id) => ({
      node_account_id: id, stake: 100, service_endpoints: [{ ip_address_v4: '1.2.3.4' }],
    }));
    const mirrorClient = makeMirror({
      nodes: allHealthy,
      activity: {
        '0.0.3': false,
        '0.0.4': true,  // recently active → wins
        '0.0.5': null,  // unknown
      },
    });
    const ordered = await orderByHealth(['0.0.3', '0.0.4', '0.0.5'], { mirrorClient });
    expect(ordered[0]).to.equal('0.0.4');
  });

  it('preserves the input set (no candidate is dropped, even when all are unhealthy)', async function() {
    const mirrorClient = makeMirror({ nodes: [] }); // mirror knows nothing
    const ordered = await orderByHealth(['0.0.99', '0.0.100'], {
      mirrorClient,
      useActivity: false,
    });
    expect(ordered.sort()).to.deep.equal(['0.0.100', '0.0.99']);
  });

  it('degrades silently to shuffle-only when getNetworkNodes throws', async function() {
    const mirrorClient = {
      async getNetworkNodes() { throw new Error('boom'); },
      async getNodeRecentActivity() { return null; },
    };
    const ordered = await orderByHealth(['0.0.3', '0.0.4'], { mirrorClient });
    expect(ordered.sort()).to.deep.equal(['0.0.3', '0.0.4']);
  });

  it('handles AccountId-shaped objects (toString)', async function() {
    const mirrorClient = makeMirror({
      nodes: [
        { node_account_id: '0.0.3', stake: 100, service_endpoints: [{ ip_address_v4: '1.2.3.4' }] },
      ],
    });
    const candidates = [
      { toString: () => '0.0.3' },
      { toString: () => '0.0.4' },
    ];
    const ordered = await orderByHealth(candidates, { mirrorClient, useActivity: false });
    expect(ordered[0]).to.equal('0.0.3');
  });

  it('selectHealthyNode returns the head of orderByHealth', async function() {
    const mirrorClient = makeMirror({
      nodes: [
        { node_account_id: '0.0.5', stake: 100, service_endpoints: [{ ip_address_v4: '1.2.3.4' }] },
      ],
      activity: { '0.0.5': true },
    });
    const picked = await selectHealthyNode(['0.0.4', '0.0.5'], { mirrorClient });
    expect(picked).to.equal('0.0.5');
  });
});
