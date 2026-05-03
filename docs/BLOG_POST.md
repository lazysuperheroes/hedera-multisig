# Multi-sig on Hedera, the way we wish someone had built it for us

*A 2.1.0 release note from Lazy Superheroes — what's in it, who it's for, and how to try it in five minutes.*

---

## The two-minute version

If you came here for the elevator pitch:

> **`@lazysuperheroes/hedera-multisig` is the production-grade multi-signature toolkit for Hedera.** It ships a CLI, a server, a hosted dApp at [`multisig.lazysuperheroes.com`](https://multisig.lazysuperheroes.com) (and a testnet sibling at [`testnet-multisig.lazysuperheroes.com`](https://testnet-multisig.lazysuperheroes.com)), and an Agent SDK. v2.1.0 ships HIP-423 long-window scheduled transactions, two end-to-end walkthroughs, and a dual-register UX (Treasury for finance teams, Console for engineers). MIT-licensed. Open source. We use it ourselves.

Now the longer version.

---

## Who this is for

This release was written with two audiences in front of us at all times:

1. **Teams who want to manage shared assets more securely.** Treasuries, DAOs, project teams, families of co-signers. You want to move HBAR, tokens, NFTs, or call a contract — and you want it to take more than one person to authorise that.
2. **Developers integrating multi-sig on Hedera.** You're building a product, an agent, or an internal tool, and you need the *coordination* layer — how do signers find each other, exchange the frozen transaction, return signatures, and verify execution — without inventing it from scratch.

Most multi-sig tooling assumes one of those audiences and ignores the other. We tried hard not to. Where the two diverge — in chrome density, default copy, what gets surfaced — the dApp now ships *two visual registers* for exactly that reason. More on that below.

---

## Why multi-sig at all

If you've already had this conversation, skip ahead. If you haven't, the short version is:

**Single-signer accounts are a single point of failure.** Whoever holds the key controls the funds. They can be coerced, phished, hacked, or have their device stolen. A treasury that depends on one person's diligence is a treasury that depends on one person's bad day.

**Multi-sig requires M of N keys to authorise a transaction.** Compromising one key isn't enough. Losing one key isn't fatal. Different humans hold different keys, ideally with different operational habits and different attack surfaces.

Hedera does this *natively* — no smart contract required:

```javascript
import { KeyList } from '@hashgraph/sdk';

// 2 of 3 — any two keys can sign; one alone can't
const thresholdKey = new KeyList([key1, key2, key3], 2);
```

That's a real protocol-level threshold key. No deploy cost, no upgrade-key risk, no contract attack surface. Hedera's also fast (3-5 second finality), which matters because the protocol gives you a 120-second window between freezing a transaction and submitting it.

That 120 seconds is the operational problem this whole library exists to solve.

---

## When to use multi-sig

Roughly, in increasing order of "you need this now":

- **Day-1 of operating a shared treasury.** Before the first real funds arrive.
- **Any account holding more than a personal-loss-worth of assets.** Set your own number; for most teams it's somewhere between $5K and $50K.
- **Any account that can call administrative functions on a contract.** Pause, upgrade, mint, set fee — these should never be a single key.
- **Any agent that signs on your behalf.** Even with a tight policy engine, having a human co-signer for above-threshold transfers is cheap insurance.
- **Any high-stakes one-off** — even if you usually run with single-sig, rotate to multi-sig for a specific event (an audit, an exchange transfer, a token launch). You can move back afterward.

If you're nodding along but haven't pulled the trigger because you've been told it's complicated to coordinate — that's exactly what this library is for.

---

## When to use *which* signing pattern

We've arrived at three coordination patterns that cover almost every real workflow. Pick by the question "do all signers need to be online at the same moment?"

### Real-time signing — when everyone can be present
**Use when:** routine treasury moves, daily ops, time-sensitive transactions where you can ping the team and get acknowledgements in 60 seconds.

The coordinator creates a session, participants join, the transaction is injected, everyone signs within the 120-second window, the network executes. We host the dApp UI; you (or a teammate) host the coordinator process. Signatures aggregate, the transaction lands.

This is the default flow on the dApp. CLI users can run the same flow from a terminal.

### Scheduled signing — when timezones don't align
**Use when:** signers in different timezones, multi-day approval cycles, governance votes, anything where waiting for everyone to be online together is impractical.

This is the killer feature in v2.1.0, and it deserves its own paragraph.

Hedera supports [**HIP-423 long-window scheduled transactions**](https://hips.hedera.com/hip/hip-423) — the network itself holds the transaction in escrow for up to ~62 days while signatures arrive piecemeal. No 120-second pressure. No "everyone be online at 3 PM UTC Tuesday." A signer in London can approve at lunchtime; a signer in Singapore can approve at breakfast the next day; a signer in San Francisco gets to it after their morning coffee. The network executes the moment threshold is met.

```bash
# Coordinator creates a 30-day window
npx hedera-multisig schedule create \
  --to 0.0.RECIPIENT --amount 50000 \
  --expiration-time 30d

# Each signer can sign whenever — over hours, days, weeks
npx hedera-multisig schedule sign \
  --schedule-id 0.0.SCHEDULE --keyfile signer1.key
```

`--expiration-time` accepts ISO-8601 (`2026-06-30T12:00:00Z`) or duration suffixes (`30d`, `8w`, `2h`). Capped at the HIP-423 horizon (~62 days).

For UI users: the dApp's `/create` page lets you build a scheduled transaction the same way you'd build an interactive one — and the corresponding `--session-timeout` flag on `npx hedera-multisig server` keeps the coordination session alive long enough to match the schedule's window.

### Agent signing — when a policy can decide for you
**Use when:** automated treasury agents, programmatic approvals, agent-to-agent coordination on Hedera.

The Agent SDK ships a headless signing client with a composable policy engine. You compose rules (max amount, allowed recipients, allowed transaction types, time windows, rate limits) and the agent auto-signs when the transaction passes the policy. Two presets ship out of the box: `treasury` (conservative, allowlist-based) and `approvalBot` (rate-limited, broad-recipient).

```javascript
import { AgentSigningClient, PolicyEngine } from '@lazysuperheroes/hedera-multisig';

const agent = new AgentSigningClient({
  approvalPolicy: PolicyEngine.treasury({
    maxAmount: 1000,
    allowedRecipients: ['0.0.98765', '0.0.11111'],
  }),
});

await agent.connect(serverUrl, sessionId, pin);
// Agent now auto-signs qualifying transactions; everything else falls
// through to a human co-signer.
```

You can mix patterns in one session — agents and humans can co-sign the same transaction. CLI participants and dApp participants can co-sign the same transaction. The server is signature-agnostic; it doesn't care how the signature was generated.

---

## How to try it — five-minute path

You don't need to install anything to try the dApp. We host both networks:

- **Mainnet UI:** [`multisig.lazysuperheroes.com`](https://multisig.lazysuperheroes.com)
- **Testnet UI:** [`testnet-multisig.lazysuperheroes.com`](https://testnet-multisig.lazysuperheroes.com) — go here first

Important: **we host the UI; you host the coordinator.** The dApp is a frontend that connects to a WebSocket coordinator process running on your machine (or a teammate's). Vercel never sees your transactions. The coordinator never sees your private keys. Each participant signs locally and sends only the signature over the wire.

The fastest end-to-end test:

```bash
# Get a free testnet account at https://portal.hedera.com (auto-funded)
# Then:
git clone https://github.com/lazysuperheroes/hedera-multisig
cd hedera-multisig
npm install
cp .env.example .env  # set OPERATOR_ID + OPERATOR_KEY from the portal

# Pre-flight check
node examples/walkthrough-hbar/00-precheck.js

# Run the 30-minute walkthrough
cat examples/walkthrough-hbar/README.md
```

The HBAR walkthrough takes you from a fresh testnet account to a successful 2-of-3 multi-sig transfer in about half an hour. You'll generate three keys, create a threshold-key account, run a real ceremony with a CLI participant + the dApp coordinator, and watch the transaction confirm on the mirror node.

The contract walkthrough goes further: deploy a Counter contract as a single-sig EOA, interact normally, then convert the EOA to 2-of-3 multi-sig via `AccountUpdateTransaction`, run a *negative test* proving single-sig is dead, then run multi-sig `increment()` and `withdraw()` ceremonies. Covers every common contract path including the deploy-as-multisig (HIP-423) alternative.

Both walkthroughs live at [`/learn`](https://testnet-multisig.lazysuperheroes.com/learn) on the testnet dApp, with prerequisites + GitHub links + a `[ ]` checklist of setup steps.

---

## The dApp has two registers

This is the thing we're proudest of in 2.1.0 and probably the thing that makes us different.

We built the dApp for the two audiences in the intro. Forcing them into one visual treatment was the wrong call:

- **Treasury operators** want a calm, careful, premium-financial feel. Big headlines. Generous whitespace. Heebo and Unbounded typography. Stripe-meets-Mercury energy. The kind of UI where moving real money feels deliberate.
- **Engineers and power users** want a dense, terminal-flavoured tool. Mono everything. Sharp corners. Compact forms with inline labels. A streaming connection log they can watch. Vercel-meets-Railway energy.

So the toggle in the top-right of the dApp swaps between the two. **Treasury** is the default — that's what most visitors see. **Console** is one click away.

Console is not "Treasury with a darker palette." It changes:
- Body face goes monospace
- Cards get sharp zero-radius corners and pane-header chrome (`~/connect.session`, `~/inject.tx`, `~/share`)
- Form labels go inline (`server_url:    [ws://...]`) instead of stacked
- The NavBar collapses into a one-line shell-prompt bar at the top: `lsh/multisig | $ ~/multisig:/create | /join /create /history /learn`
- A streaming **ConsoleLog** drawer at the bottom shows wallet events, WebSocket messages, mirror-node polls in real-time
- Page headings render as `$ create session` (literal command-line prompt)
- Primary CTAs gain `$ ` prefix and `⏎` keyboard hint

Both registers ship with the same accessibility baseline — focus rings, ARIA labels, keyboard navigation, focus traps in dialogs, prefers-reduced-motion support, semantic HTML. We put real work into making this not just a paint job.

---

## What's actually in the box

For the developer audience, here's the complete inventory:

**Library** (`@lazysuperheroes/hedera-multisig`, MIT, npm)
- `core/`: TransactionFreezer, SignatureCollector, SignatureVerifier, TransactionExecutor (with mirror-node confirmation polling)
- `workflows/`: InteractiveWorkflow, OfflineWorkflow, ScheduledWorkflow (HIP-423 native), WorkflowOrchestrator
- `client/`: SigningClient (CLI/Node), AgentSigningClient (headless), PolicyEngine + 5 rules + 2 presets
- `server/`: WebSocket server with TLS/WSS, per-IP + per-session rate limiting, origin validation, coordinator-token elevation, reconnection tokens, mirror-node verification, Redis session-store option
- `keyManagement/`: KeyProvider abstraction with `sign()` + `canExposeKeys()` — supports opaque signers (HSM, MPC, hardware)
- `shared/transaction-decoder/`: 20+ Hedera transaction types decoded to readable form, with ABI verification for `ContractCall`
- 8 CLI commands: `server`, `participant`, `sign`, `inject`, `transfer`, `token`, `session`, `schedule`

**dApp** (Next.js 16, hosted on Vercel)
- 6 routes: `/`, `/join`, `/create`, `/history`, `/learn`, `/session/[id]`
- Treasury + Console registers
- WalletConnect (HashPack, Blade, Kabila support)
- Build-from-form / paste-frozen-base64 / CLI-inject — three ways to get a transaction into a session
- ABI editor for contract calls (arrays, tuples, structs)
- Browser-local transaction history with CSV export
- First-run onboarding (visit-counter-driven nudges; no auto-suggest)

**Testing**
- 84 unit tests in the core library + 245 coverage-suite tests
- Coverage gate at lines 56 / functions 50 / branches 63 (measured 58.65 / 51.36 / 65.4)
- 13 transaction-decoder fixture snapshots for cross-implementation parity
- Two end-to-end walkthroughs (HBAR + Smart Contract) as scripted manual scenarios in `TESTING.md`

**Documentation**
- [`SECURITY.md`](https://github.com/lazysuperheroes/hedera-multisig/blob/main/SECURITY.md) — disclosure policy + threat model + supported versions
- [`docs/THRESHOLD_GUIDE.md`](https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs/THRESHOLD_GUIDE.md) — M-of-N choice + nested KeyList semantics with worked examples
- [`docs/COORDINATOR_GUIDE.md`](https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs/COORDINATOR_GUIDE.md) — running the coordinator, tunnel trust model, scheduled-tx workflow
- [`docs/AGENT_INTEGRATION.md`](https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs/AGENT_INTEGRATION.md) — Agent SDK integration patterns
- [`docs/SECURITY_ARCHITECTURE.md`](https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs/SECURITY_ARCHITECTURE.md) — threat model, trust boundaries, audit posture
- [`docs/ENCRYPTED_KEYS_GUIDE.md`](https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs/ENCRYPTED_KEYS_GUIDE.md) — AES-256-GCM + PBKDF2 key files

---

## Security model — the short version

A few principles we hold to. There's a longer treatment in `SECURITY_ARCHITECTURE.md` if you want depth.

- **Private keys never leave the device.** Only frozen transactions and signatures travel over the network. The coordinator orchestrates; it never holds a key.
- **Verified vs unverified data are visually separate** in the UI. The transaction details that come from the cryptographically-signed bytes are presented in green; coordinator-supplied metadata that *could* be fraudulent is in yellow. Mismatches surface as warnings.
- **Coordinator authorisation post-AUTH.** Privileged WebSocket messages (transaction inject, execute) verify `isCoordinator` on every receive — not just at connect. Closes the [post-AUTH role gap that we found in our v2.0 review](https://github.com/lazysuperheroes/hedera-multisig/blob/main/CHANGELOG.md#critical-1).
- **Reconnection tokens bound to public key.** Eligibility is re-checked when a stale token is used; if you've been removed from the eligible-keys set, your old token is rejected.
- **Mirror-node verification** confirms that what we *thought* the network executed actually was executed. The dApp shows a side-by-side intent-vs-actual diff after every transaction.
- **No `protobufjs` ACE CVE** — we ship version-keyed `overrides` in `package.json` to force the patched releases (7.5.6 / 8.0.3) in the vulnerable ranges.
- **GPG-signed releases.** The `release.yml` workflow verifies signed tags, checks the package version matches the tag, runs the production audit gate, and publishes to npm with provenance via OIDC.

---

## Common pitfalls

In rough order of "we've seen people do this":

- **Storing keys in `process.env`.** Don't. The library ships an `EncryptedFileProvider` (AES-256-GCM + PBKDF2, ≥12-character passphrase) and supports hardware wallets via WalletConnect. Use them.
- **One threshold for everything.** A 2-of-3 makes sense for daily ops; it's wrong for your $10M cold-storage account. The threshold guide documents the trade-off.
- **Ignoring the 120-second window.** If your signers can't be online together within 120 seconds of the transaction freezing, use scheduled signing. That's why HIP-423 exists.
- **Single point of infrastructure failure.** Multi-sig is only as distributed as your infrastructure. Don't run all your signers through one VPN exit. Don't host the coordinator on the same instance as your eligible keys. Don't make the coordinator a single point of failure for your own org.
- **Calendar-based key rotation.** Threshold keys don't weaken with age, and rotation itself is risky (a mistake can lock the account). Rotate when *circumstances demand* it — personnel change, suspected compromise, storage upgrade — not every 90 days.

---

## Where this came from, and where it's going

We're [Lazy Superheroes](https://lazysuperheroes.com), an LSH-umbrella web3 project on Hedera. This library powers the multi-sig flows for the rest of our products and is licensed MIT for everyone else to use.

v2.1.0 closed the multi-agent v2.0 review (3 critical findings, 8 highs), shipped HIP-423 long-window scheduled transactions through the CLI and dApp, added the dual-register UX, ran two end-to-end walkthroughs as scripted manual scenarios, and tightened the release supply chain (provenance, signed tags, weekly Dependabot, Node 20/22/24 CI matrix). 

v2.2 is one item: **nested KeyList coordination** — tree-aware ceremony coordination so the server understands recursive `KeyList` thresholds (e.g. `(security_officer) AND (2 of 3 devs)`), not just flat lists. Hedera consensus already supports this; the gap is the coordination layer.

Phase 6 is on the roadmap when [HCS-16 (Flora)](https://hashgraph.swirlds.com/improvement-proposals/) stabilises — we already have the `CoordinationTransport` abstraction with a `WebSocketTransport` adapter and a `FloraTransport` stub. When the standard ships, the protocol-level upgrade is a transport swap, not a rewrite.

---

## Try it

In order from "least committed" to "most committed":

1. **Visit the testnet dApp.** [`testnet-multisig.lazysuperheroes.com`](https://testnet-multisig.lazysuperheroes.com). Toggle between Treasury and Console in the top-right. No install, no account.
2. **Get a free testnet account** at [`portal.hedera.com`](https://portal.hedera.com) — auto-funded with ~10,000 testnet ℏ.
3. **Run the HBAR walkthrough.** 30 minutes, end-to-end, from key generation to mirror-node confirmation. [`examples/walkthrough-hbar/README.md`](https://github.com/lazysuperheroes/hedera-multisig/tree/main/examples/walkthrough-hbar).
4. **Run the contract walkthrough.** 50 minutes. Adds the EOA→multi-sig migration arc. [`examples/walkthrough-contract/README.md`](https://github.com/lazysuperheroes/hedera-multisig/tree/main/examples/walkthrough-contract).
5. **Install the library.** `npm install @lazysuperheroes/hedera-multisig`. Read the [README](https://github.com/lazysuperheroes/hedera-multisig#readme) and pick the workflow that fits.

If you ship something interesting on top of this, [tell us](https://github.com/lazysuperheroes/hedera-multisig/issues) — we read every issue.

---

*MIT-licensed · open-source · production-grade · built by [Lazy Superheroes](https://lazysuperheroes.com) for the Hedera community.*

*Source: [github.com/lazysuperheroes/hedera-multisig](https://github.com/lazysuperheroes/hedera-multisig) · npm: [`@lazysuperheroes/hedera-multisig`](https://www.npmjs.com/package/@lazysuperheroes/hedera-multisig) · Disclosure: [SECURITY.md](https://github.com/lazysuperheroes/hedera-multisig/blob/main/SECURITY.md)*
