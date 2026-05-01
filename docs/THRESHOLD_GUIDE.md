# Threshold keys and M-of-N: a practical guide

This guide explains how Hedera threshold keys work, how to choose
M-of-N for your use case, and what nested key-list configurations are
possible — plus what this library can and can't coordinate today.

If you're brand new to multi-sig, start at
[`docs/TREASURY_GUIDE.md`](TREASURY_GUIDE.md). This guide goes a layer
deeper: tradeoff analysis, edge cases, and the boundaries of what's
actually supported in v2.1.0.

## Table of contents

1. [The mental model](#the-mental-model)
2. [Choosing M and N](#choosing-m-and-n)
3. [Common configurations and when to use each](#common-configurations-and-when-to-use-each)
4. [Nested key lists — what's possible](#nested-key-lists--whats-possible)
5. [What this library supports today (v2.1.0)](#what-this-library-supports-today-v210)
6. [What's coming](#whats-coming)
7. [Decision recipes](#decision-recipes)

---

## The mental model

A Hedera account's `key` field defines who can authorize transactions
from that account. The key can be:

- A single **public key** — the account is controlled by one private key.
  This is a normal "EOA" account.
- A **`KeyList`** with a `threshold` — the account is controlled jointly
  by N keys, of which any M must sign for a transaction to succeed. M
  ≤ N. Setting M = N requires every signer; setting M = 1 means any
  one of the N can act alone.
- A **nested `KeyList`** — a key list whose elements include other key
  lists. Each branch evaluates its own threshold. The Hedera consensus
  layer supports this natively, recursively.

Examples:

| Configuration | Meaning |
|---|---|
| `Single(alice)` | Only alice's key authorizes. |
| `KeyList(threshold=1, [alice, bob, carol])` | Any one of alice, bob, carol authorizes. **1-of-3** — convenience, low security. |
| `KeyList(threshold=2, [alice, bob, carol])` | Any two of alice, bob, carol authorize. **2-of-3** — the most common multi-sig shape. |
| `KeyList(threshold=3, [alice, bob, carol])` | All three must sign. **3-of-3** — maximum security, no redundancy. |
| `KeyList(threshold=2, [alice, bob, KeyList(threshold=2, [eng_a, eng_b, eng_c])])` | Two of three branches; one branch is itself a 2-of-3 of the engineering team. **Nested** — see [Nested key lists](#nested-key-lists--whats-possible). |

The Hedera SDK's `KeyList` class accepts an array of `Key` objects and
a threshold. Every element can be a `PublicKey`, another `KeyList`, or
a `ContractId`/`DelegatableContractId` for contract-controlled keys.

## Choosing M and N

There are three forces in tension:

- **Security** — bigger M and bigger N make the account harder to
  compromise. M ≥ 2 means a single key leak doesn't move funds.
- **Availability** — bigger M makes legitimate operations harder. If
  you need 5 of 7 and three signers are on holiday, the treasury is
  frozen.
- **Operational cost** — every signer adds key-management overhead
  (generation, storage, rotation, audit). N grows the surface area
  even if M stays small.

Practical heuristics:

| Goal | Heuristic |
|---|---|
| Tolerate one compromised key without losing funds | M ≥ 2 |
| Tolerate one signer being unavailable | N − M ≥ 1 (i.e. at least one redundant signer) |
| Tolerate two unavailable signers | N − M ≥ 2 (e.g. 2-of-4, 3-of-5) |
| Resist insider threat (no single person can act alone) | M ≥ 2 with all signers on different teams / devices |
| Hot-wallet style operational account, low value | 1-of-N for convenience; rotate often |
| Cold storage / catastrophic recovery | M = N with offline keys |

**Common mistakes:**

- **M too high → frozen treasury.** Companies set 4-of-5 then discover
  one signer is on parental leave, another can't reach their hardware
  wallet, the CFO is in a different time zone. Multi-sig is only safe
  if you can actually execute it. Aim for **N − M ≥ 1** unless your
  use case is genuinely cold storage.
- **N too high → key sprawl.** Every additional signer is another
  device, another rotation event, another offboarding ceremony when
  someone leaves. 7 signers feels secure on paper; in practice each
  signer's keys are managed less carefully than they would be if there
  were 3.
- **M = N — single point of failure for availability.** Treat 3-of-3,
  4-of-4, etc. as cold-storage-only setups. Don't use them for
  operational accounts.
- **1-of-N — almost the same security as a single key.** It's
  convenient (any of N can act) but a single compromised key is
  enough. Use it for convenience accounts holding small balances, not
  treasury.

## Common configurations and when to use each

| Configuration | Tolerance | Best for | Watch out for |
|---|---|---|---|
| **2-of-3** | 1 unavailable, 1 compromised | Small-team treasury, DAO multi-sig, founder accounts | Easy to set up; the default for most teams. Offboarding requires a key rotation. |
| **3-of-5** | 2 unavailable, 2 compromised | Corporate treasury, larger DAO | Coordinating 3 signatures across time zones takes real planning. |
| **2-of-4** | 2 unavailable, 1 compromised | Operational account with rotation slack | Easier offboarding than 2-of-3 (drop a signer without losing redundancy). |
| **3-of-3** | 0 unavailable | Cold storage, M&A close conditions | Any one signer being unreachable freezes the account. Use with caution. |
| **2-of-2** | 0 unavailable | Two-person veto, escrow | Same caveat as 3-of-3. |
| **1-of-3** | 2 unavailable | Convenience accounts | Security ≈ single key. Don't store significant value. |
| **5-of-7 / 4-of-6** | 2 unavailable, multiple compromised | Large org treasury, governance councils | Coordination overhead is the limiting factor, not security. |

**A note on N > 7:** Hedera's protocol allows large key lists, but the
practical coordination cost grows non-linearly. At N = 10+, getting
M signatures within the 120-second freeze window becomes a
calendar-management exercise. Use **scheduled transactions** (HIP-423,
~62-day expiration) instead of the real-time window for ceremonies
that big.

## Nested key lists — what's possible

Hedera natively supports `KeyList` elements that are themselves
`KeyList`s. Each branch evaluates its own threshold. Examples:

### Example 1: Department-level approval

```
KeyList(threshold=2, [
  alice,                                         // CFO single key
  KeyList(threshold=2, [eng_lead, eng_a, eng_b]), // Engineering — 2 of 3
  KeyList(threshold=2, [fin_a, fin_b, fin_c]),    // Finance — 2 of 3
])
```

A transaction succeeds when **any 2 of these 3 branches** are
satisfied. The CFO + Engineering can act. Engineering + Finance can
act. The CFO + Finance can act. Engineering alone can't act (only
satisfies 1 branch). This is "2 departments approve, with each
department deciding internally how to authorize."

### Example 2: CEO-or-2-officers

```
KeyList(threshold=1, [
  ceo,                                           // CEO single key
  KeyList(threshold=2, [cfo, coo, cto, gc]),     // Any 2 officers
])
```

Either the CEO acts alone, OR any 2 of {CFO, COO, CTO, General
Counsel} act together. Useful when one person has unilateral authority
but during their absence a quorum of officers can take over.

### Example 3: Hot-spend with cold-recovery override

```
KeyList(threshold=1, [
  KeyList(threshold=2, [op_a, op_b, op_c]),      // Hot — 2 of 3 ops keys
  KeyList(threshold=3, [cold_a, cold_b, cold_c, cold_d, cold_e]), // Cold — 3 of 5
])
```

Day-to-day: 2 of 3 hot keys move funds. If hot keys are compromised:
3 of 5 cold keys override. This is a "tiered access" pattern.

### How nesting affects signature counting

For a transaction to succeed under a nested key, each branch is
evaluated **independently**. You don't pool signatures across branches.

In Example 1:
- alice signs → satisfies branch 1 (count: 1 satisfied branch)
- eng_lead + eng_a sign → satisfies branch 2's internal 2-of-3 (count: 2 satisfied branches; threshold met)
- The transaction succeeds.

If only eng_lead signed, branch 2 isn't satisfied (needs 2 of 3
inside), so even though eng_lead and alice sign, you'd have 1 satisfied
branch + 1 partial branch = not enough.

This is why nesting matters for coordination: a flat 5-of-7 needs **any
5 of 7** signatures; a 2-branch nested structure with each branch
being 3-of-5 needs **3+3 = 6 specific signatures arranged correctly**.

## What this library supports today (v2.1.0)

| Capability | Hedera native | This library |
|---|---|---|
| Flat M-of-N account creation | ✅ | ✅ — `cli/commands/keys.js`, walkthrough scripts |
| Flat M-of-N transaction signing (interactive) | ✅ | ✅ — `WorkflowOrchestrator.execute({workflow:'interactive'})` |
| Flat M-of-N transaction signing (offline / air-gapped) | ✅ | ✅ — `OfflineWorkflow` |
| Flat M-of-N transaction signing (networked / WebSocket) | ✅ | ✅ — `SigningSessionManager` + dApp |
| Flat M-of-N scheduled transactions (HIP-423, ~62 days) | ✅ | ✅ — `ScheduledWorkflow` + `cli schedule create` |
| Nested `KeyList` account creation | ✅ | ⚠️ — direct via `@hashgraph/sdk` works; no helper script. The Hedera SDK accepts arbitrarily nested `KeyList`s in `AccountCreateTransaction`. |
| Nested `KeyList` transaction signing | ✅ | ❌ — **flat-only**. `isKeyEligible()` (`server/utils/keyUtils.js:29`) does string comparison against a flat array of public keys. `SignatureVerifier.checkThreshold()` (`core/SignatureVerifier.js`) compares a flat count against a flat threshold. The coordinator does not understand "this signer satisfies branch 2 of the parent key." |
| Nested-aware UI (display branches, per-branch progress) | n/a | ❌ — TransactionReview shows a flat eligible-keys list; no tree rendering. |

### Why "flat-only" is fine for v2.1.0

The vast majority of multi-sig deployments use flat M-of-N. 2-of-3,
3-of-5, and 2-of-4 cover ~95% of treasury setups. The library is
deliberately optimized for the common case.

If you create a Hedera account with a nested `KeyList` and try to use
it with this library's networked workflow, what happens:

- The dApp builds a transaction normally.
- The coordinator collects signatures.
- Hedera consensus evaluates the nested key correctly and **may
  succeed** if the signatures happen to satisfy a valid branch
  combination.
- But the coordinator UI will show "X of N signatures collected" with
  a single flat threshold, which is misleading. A signer might think
  the transaction is one signature away from execution when in fact
  the wrong branch is satisfied.

In short: **using nested keys with this library today is at-your-own-
risk**. The signing math still happens on Hedera's side; the UI just
won't model it correctly. If you have a nested key requirement, prefer
the offline workflow (manual file-based signature collection) until
the networked workflow gains nested-aware coordination — see [What's
coming](#whats-coming).

## What's coming

**v2.2 candidate: nested `KeyList` coordination**

Tracked as a backlog item. Scope:

- **Server-side**: replace `isKeyEligible(key, eligibleKeys: string[])`
  with `isKeyEligible(key, keyTree: KeyTreeNode)` that walks a
  serialized representation of the nested structure. Threshold counting
  becomes a tree walk: each branch is "satisfied" when its internal
  threshold is met; the parent's threshold counts satisfied branches.
- **dApp UI**: render the key tree as a nested progress display.
  "Branch 1: alice ✓ (1/1)", "Branch 2: Engineering 1/2 (eng_lead has
  signed, need 1 more)", with per-branch progress bars.
- **Connection-string format**: extend `hmsc:` to carry the tree
  shape, not just a flat list of public keys.
- **Mixed scenarios**: ensure a single signer who sits in multiple
  branches (e.g. a CFO who is both a single-key signer in branch 1 and
  a member of a 2-of-3 in branch 2) is counted exactly once per branch
  with no double-counting.

Realistic timeline: v2.2.0, after v2.1.0 stabilizes with the flat
flows in production.

**Out of scope indefinitely:**

- ContractId-controlled keys (where a contract can authorize, not just
  signers). Hedera supports this; we don't have a use case for it in
  the scoped roadmap.
- Threshold-key rotation atomically with a transaction (in one
  consensus round). Hedera supports this via combining `AccountUpdate`
  + the operation; this library doesn't expose that combo today.

## Decision recipes

### "I'm a small team treasury, what should I pick?"

**2-of-3 flat KeyList.** Three signers across three devices, threshold
2. Walkthrough: [`examples/walkthrough-hbar/`](../examples/walkthrough-hbar/).

### "I'm a corporate treasury with engineering + finance approval"

If your governance permits a flat threshold: **3-of-5** with one
representative from each function. Simpler.

If your governance requires both functions to approve: **nested**, two
branches, each branch internally 2-of-3. **Cannot be coordinated
through this library's networked workflow today** — use the offline
workflow (file-based signatures) until v2.2.

### "I want a hot account that I can recover from cold keys if compromised"

The tiered nesting pattern from Example 3. Same caveat — offline-only
coordination today.

### "I'm building an agent-signed automation"

Flat 2-of-N where one signer is the agent and the rest are humans.
Configure the agent with a [PolicyEngine](AGENT_INTEGRATION.md) so it
auto-signs within rules. Agent + 1 human is enough to execute; humans
can override anytime by signing without the agent.

### "I want async signing across time zones / multi-day approvals"

**Scheduled transactions (HIP-423, up to ~62 days).** Configure your
account as a flat M-of-N. Use `cli schedule create --expiration-time
14d` to wrap the transaction. Each signer runs `cli schedule sign` at
their convenience. Network executes when threshold is met. See
[`docs/COORDINATOR_GUIDE.md`](COORDINATOR_GUIDE.md) §Scheduled
Transactions.

---

## See also

- [`TREASURY_GUIDE.md`](TREASURY_GUIDE.md) — quickstart for new users
- [`COORDINATOR_GUIDE.md`](COORDINATOR_GUIDE.md) — running the coordinator server, tunnels, scheduled transactions
- [`SECURITY_ARCHITECTURE.md`](SECURITY_ARCHITECTURE.md) — threat model and trust boundaries
- [`AGENT_INTEGRATION.md`](AGENT_INTEGRATION.md) — agent-signed automation with PolicyEngine
- [Hedera docs: Key types](https://docs.hedera.com/hedera/sdks-and-apis/sdks/keys) — official `KeyList` reference
- [HIP-423: Long-term scheduled transactions](https://hips.hedera.com/hip/hip-423) — async signing protocol
