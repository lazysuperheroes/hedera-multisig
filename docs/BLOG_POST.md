# Multi-sig on Hedera, the way we wish someone had built it for us

*A 2.1.0 release note from Lazy Superheroes — what's in it, who it's for, and how to try it.*

`MIT` · `Node 20/22/24` · `GPG-signed releases` · `npm OIDC provenance` · [Source](https://github.com/lazysuperheroes/hedera-multisig) · [npm](https://www.npmjs.com/package/@lazysuperheroes/hedera-multisig)

---

## What this is

**Stop one stolen laptop from draining your treasury.** `@lazysuperheroes/hedera-multisig` lets 2-of-3 (or any M-of-N) signers approve every move of HBAR, tokens, NFTs, or contract calls — natively on Hedera, no smart contract, no gas surprises. Open source, MIT-licensed, and we use it ourselves.

v2.1.0 ships **HIP-423 long-window scheduled transactions** (62-day async approvals — no more "everyone be online at 3 PM UTC Tuesday"), two end-to-end walkthroughs, and a **dual-mode UI** so your CFO doesn't have to read a terminal and your engineers don't have to click through wizards.

→ **Try the testnet dApp:** [`testnet-multisig.lazysuperheroes.com`](https://testnet-multisig.lazysuperheroes.com) (no install)
→ **Mainnet dApp:** [`multisig.lazysuperheroes.com`](https://multisig.lazysuperheroes.com)
→ **Install:** `npm install @lazysuperheroes/hedera-multisig`
→ **Source:** [`github.com/lazysuperheroes/hedera-multisig`](https://github.com/lazysuperheroes/hedera-multisig)

---

## Who this is for

Two audiences, both first-class:

1. **Teams managing shared assets** — treasuries, DAOs, project teams, families of co-signers. You want to move HBAR, tokens, NFTs, or call a contract, and you want it to take more than one person to authorise that.
2. **Developers integrating multi-sig on Hedera** — you're building a product, an agent, or an internal tool, and you need the *coordination* layer (how do signers find each other, exchange the frozen transaction, return signatures, verify execution) without inventing it from scratch.

Most multi-sig tooling assumes one of those audiences and ignores the other. The dApp now ships *two visual registers* — Treasury and Console — for exactly that reason. Same backend, same trust boundary, only the chrome differs.

---

## Why multi-sig at all

If you've already had this conversation, skip ahead. If you haven't:

**Single-signer accounts are a single point of failure.** Whoever holds the key controls the funds. They can be coerced, phished, hacked, or have their device stolen. A treasury that depends on one person's diligence is a treasury that depends on one person's bad day.

**Multi-sig requires M of N keys to authorise a transaction.** Compromising one key isn't enough. Losing one key isn't fatal. Different humans hold different keys, ideally with different operational habits and different attack surfaces.

Hedera does this *natively* — no smart contract required:

```javascript
import { KeyList } from '@hashgraph/sdk';

// 2 of 3 — any two keys can sign; one alone can't
const thresholdKey = new KeyList([key1, key2, key3], 2);
```

That's a real protocol-level threshold key. No deploy cost, no upgrade-key risk, no contract attack surface. Hedera's also fast (3-5 second finality), which matters because the protocol gives you a 120-second window between freezing a transaction and submitting it.

That 120 seconds is the operational problem this whole library exists to solve. **Every coordination decision below — pre-session key loading, scheduled mode, the WebSocket choice over HTTP polling — falls out of that constraint.**

---

## Where this fits

Most multi-sig you've seen is a smart contract — Safe.global on Ethereum, Squads on Solana. That model exists because EVM and SVM don't have native threshold keys. Hedera does. So this library coordinates the *off-chain* signature collection while the chain handles the threshold logic at the consensus layer — no bytecode, no upgrade key, no proxy, no contract audit.

Different tools for different jobs. Quick map of where each fits:

| | hedera-multisig | Safe.global / EVM contract multi-sig | HashPack (single account, multi-key) | Custom KeyList scripts |
|---|---|---|---|---|
| Hedera-native (no contract) | yes | n/a (EVM only) | yes | yes |
| M-of-N coordination across multiple devices | yes | yes | partial (single wallet UI) | DIY |
| Async signing > 120 s | yes (HIP-423, ~62 d) | yes (on EVM) | — | manual |
| Mixed CLI + browser + agent in one session | yes | — | — | DIY |
| Self-hosted coordinator (no third party in trust path) | yes | n/a | n/a | n/a |
| Per-tx cost | network fee only (~$0.0001 USD per HBAR transfer at current rates) | network + gas | network fee | network fee |
| Open source, MIT | yes | LGPL | proprietary | yours |

Each has a place. **HashPack is great as a hardware-wallet endpoint *inside* a multi-sig** — signers can absolutely use HashPack's hardware-wallet flow as one of the keys in our M-of-N ceremony, and our dApp speaks WalletConnect to make exactly that easy. Safe.global is the right answer if you're on EVM. Custom KeyList scripts are the right answer if your coordination is a one-off.

We're the coordination layer that makes Hedera-native threshold keys practical for human teams and headless agents. The same idea Ethereum uses Safe for, Bitcoin uses Unchained for, and Solana uses Squads for — adapted to Hedera's native threshold keys (faster finality, cheaper, no contract risk).

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

Three coordination patterns cover almost every real workflow. Pick by the question "do all signers need to be online at the same moment?"

### Real-time signing — when everyone can be present
**Use when:** routine treasury moves, daily ops, time-sensitive transactions where you can ping the team and get acknowledgements in 60 seconds.

The coordinator creates a session, participants join, the transaction is injected, everyone signs within the 120-second window, the network executes. We host the dApp UI; you (or a teammate) host the coordinator process. Signatures aggregate, the transaction lands.

This is the default flow on the dApp. CLI users can run the same flow from a terminal.

### Scheduled signing — when timezones don't align
**Use when:** signers in different timezones, multi-day approval cycles, governance votes, anything where waiting for everyone to be online together is impractical.

This is the headline of v2.1.0.

Hedera supports [**HIP-423 long-window scheduled transactions**](https://hips.hedera.com/hip/hip-423) — the network itself holds the transaction in escrow for up to ~62 days while signatures arrive piecemeal. No 120-second pressure. No "everyone be online at 3 PM UTC Tuesday." A signer in London approves at lunchtime; a signer in Singapore approves at breakfast the next day; a signer in San Francisco gets to it after their morning coffee. The network executes the moment threshold is met.

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

For UI users: the dApp's `/create` page builds a scheduled transaction the same way you'd build an interactive one. Use `--session-timeout` on `npx hedera-multisig server` to keep the coordination session alive long enough to match the schedule's window.

### Agent signing — when a policy can decide for you
**Use when:** automated treasury agents, programmatic approvals, agent-to-agent coordination on Hedera.

Concrete scenario: your AI agent autonomously rebalances a treasury. Below $1K to whitelisted addresses → agent signs alone. Above $1K, or to a new address → agent signs and a human co-signer is required. Below is what that policy looks like:

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

Two presets ship out of the box: `treasury` (conservative, allowlist-based) and `approvalBot` (rate-limited, broad-recipient). Compose any of five rules — `MaxAmountRule`, `AllowedRecipientsRule`, `AllowedTransactionTypesRule`, `TimeWindowRule`, `RateLimitRule` — with `AND` / `OR` for custom policies.

### Mixed mode — the architectural payoff

Two kinds of mixing both work in one session:

- **Heterogeneous participant types.** A headless agent and a human can co-sign the same transaction. The agent fires when policy passes; the human fires when policy abstains; both signatures land in the same threshold count.
- **Heterogeneous transports.** A CLI participant on a server, a dApp participant in a browser, and an agent in a container can all join the same session.

This works because **the server is signature-agnostic by design.** It validates format and threshold eligibility but has no opinion on *how* a signature was produced. A CLI user with a YubiKey, a dApp user with HashPack on a hardware wallet, and a headless agent with an HSM-backed `KeyProvider` are equivalent to the server — it's a router, not a signer.

---

## Try it in 5, master it in 30

**5-minute path** — no install, no account:

1. Visit [`testnet-multisig.lazysuperheroes.com`](https://testnet-multisig.lazysuperheroes.com)
2. Toggle between Treasury and Console in the top-right
3. Click around `/create`, `/join`, `/learn` — the UI works without a wallet connected so you can see the shape of every flow

**30-minute path** — end-to-end ceremony with real testnet HBAR:

```bash
# Get a free testnet account at https://portal.hedera.com (auto-funded with ~10,000 testnet ℏ)
# Then:
git clone https://github.com/lazysuperheroes/hedera-multisig
cd hedera-multisig
npm install
cp .env.example .env  # set OPERATOR_ID + OPERATOR_KEY from the portal

node examples/walkthrough-hbar/00-precheck.js     # pre-flight check
cat examples/walkthrough-hbar/README.md           # the walkthrough
```

Half an hour from a fresh testnet account to a successful 2-of-3 multi-sig transfer. You'll generate three keys, create a threshold-key account, run a real ceremony with a CLI participant + the dApp coordinator, and watch the transaction confirm on the mirror node.

**50-minute path** — contracts and EOA migration:

The contract walkthrough deploys a Counter contract as a single-sig EOA, interacts normally, then converts the EOA to 2-of-3 multi-sig via `AccountUpdateTransaction`, runs a *negative test* proving single-sig is dead, then runs multi-sig `increment()` and `withdraw()` ceremonies. Covers every common contract path including the deploy-as-multisig (HIP-423) alternative.

Both walkthroughs live at [`/learn`](https://testnet-multisig.lazysuperheroes.com/learn) on the testnet dApp, with prerequisites + GitHub links + a `[ ]` checklist of setup steps.

---

## Two registers, one backend

The dApp ships in two visual modes. **Treasury** (default) is calm, generous, financial-tool feel — for moving real money deliberately. **Console** is monospaced, dense, with a streaming event log — for engineers who want to watch the wire. Toggle in the top-right.

Same backend. Same session protocol. Same trust boundary. Same accessibility baseline (focus rings, ARIA labels, keyboard nav, focus traps, prefers-reduced-motion). Only the chrome differs.

<!-- TODO: side-by-side screenshot of Treasury and Console for the published post -->

---

## What's actually in the box

For the developer audience, the complete inventory:

**Library** (`@lazysuperheroes/hedera-multisig`, MIT, npm)
- `core/`: TransactionFreezer, SignatureCollector, SignatureVerifier, **TransactionExecutor with mirror-node confirmation polling and intent-vs-actual diff**
- `workflows/`: InteractiveWorkflow, OfflineWorkflow, ScheduledWorkflow (HIP-423 native), WorkflowOrchestrator
- `client/`: SigningClient (CLI/Node), AgentSigningClient (headless), PolicyEngine + 5 rules + 2 presets
- `server/`: WebSocket server with TLS/WSS, per-IP + per-session rate limiting, origin validation, coordinator-token elevation, reconnection tokens, Redis session-store option
- `keyManagement/`: KeyProvider abstraction with `sign()` + `canExposeKeys()` — opaque signers (HSM, MPC, hardware) are first-class
- `shared/transaction-decoder/`: 20+ Hedera transaction types decoded to readable form, with ABI verification for `ContractCall`
- `shared/CoordinationTransport`: WebSocketTransport (production) + FloraTransport (HCS-16 stub)
- 8 CLI commands: `server`, `participant`, `sign`, `inject`, `transfer`, `token`, `session`, `schedule`
- TypeScript declarations included; runs on Node 20/22/24; works in Next.js, plain Node, and any modern JS runtime

**dApp** (Next.js 16, hosted on Vercel)
- 6 routes: `/`, `/join`, `/create`, `/history`, `/learn`, `/session/[id]`
- Treasury + Console registers
- WalletConnect (HashPack, Blade, Kabila — including HashPack's hardware-wallet flow)
- Build-from-form / paste-frozen-base64 / CLI-inject — three ways to get a transaction into a session
- ABI editor for contract calls (arrays, tuples, structs)
- Browser-local transaction history with CSV export
- First-run onboarding (visit-counter-driven nudges; no auto-suggest)

**Documentation**
- [`SECURITY.md`](https://github.com/lazysuperheroes/hedera-multisig/blob/main/SECURITY.md) — disclosure policy + threat model + supported versions
- [`docs/THRESHOLD_GUIDE.md`](https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs/THRESHOLD_GUIDE.md) — M-of-N choice + nested KeyList semantics with worked examples
- [`docs/COORDINATOR_GUIDE.md`](https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs/COORDINATOR_GUIDE.md) — running the coordinator, tunnel trust model, scheduled-tx workflow
- [`docs/AGENT_INTEGRATION.md`](https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs/AGENT_INTEGRATION.md) — Agent SDK integration patterns
- [`docs/SECURITY_ARCHITECTURE.md`](https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs/SECURITY_ARCHITECTURE.md) — threat model, trust boundaries
- [`docs/ENCRYPTED_KEYS_GUIDE.md`](https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs/ENCRYPTED_KEYS_GUIDE.md) — AES-256-GCM + PBKDF2 key files

---

## Three extension points

If you're building on top of this, three abstractions are designed to be the seam — you should not need to fork:

- **`KeyProvider`** — implement `sign(txBytes)` + `canExposeKeys()` to wire any signer (HSM, MPC, hardware, custodial API). The library never assumes it can read your private key — only that it can ask something to sign. That's why YubiHSM, MPC services, and threshold-shared keys plug in cleanly.
- **`CoordinationTransport`** — swap the transport for any pub/sub substrate. `WebSocketTransport` is the production adapter; `FloraTransport` is the HCS-16 stub that already compiles, registers handlers, and proves the seam works (see *Roadmap* below).
- **`PolicyEngine` rules** — five built-in rules (`MaxAmountRule`, `AllowedRecipientsRule`, `AllowedTransactionTypesRule`, `TimeWindowRule`, `RateLimitRule`) compose with `AND` / `OR`. Custom rules implement a single `evaluate(tx, context)` method.

---

## Security model

A few principles. Longer treatment in [`SECURITY_ARCHITECTURE.md`](https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs/SECURITY_ARCHITECTURE.md).

### Trust zones

Three trust zones, one direction of data flow:

- **Signer device** — sees: private key (or talks to a hardware/HSM/MPC backend that holds it), frozen tx, signature. Produces: signature only.
- **Coordinator process** (yours, on your machine or a teammate's) — sees: frozen tx bytes, signatures, participant public keys, session metadata, PINs at auth time (timing-safe compared, never logged in full). Never sees: private keys, plaintext PINs in storage.
- **Hosted dApp / Vercel edge** — sees: nothing transactional. The dApp is a static frontend that opens a WebSocket directly to *your* coordinator. Vercel is not in the trust path.
- **Hedera mirror node** — the source of truth for "did it execute." We don't trust the coordinator's word on outcome; we poll the mirror node and surface the diff.

### Key handling

**Private keys never leave their `KeyProvider` boundary.** With WalletConnect or HSM, the bytes never enter our process at all — we hand the unsigned transaction in and a signature comes back. With `EncryptedFileProvider` (AES-256-GCM, PBKDF2-SHA256, per-file random salt), decryption happens locally and the decrypted key lives only in the signing process for the duration of one ceremony. Only frozen transactions and signatures travel over the network. The coordinator never holds a key.

### What if the coordinator is compromised?

A malicious coordinator can deny service, inject a fraudulent transaction, or lie about metadata — but it **cannot forge a signature, cannot extract a key, and cannot execute a transaction the participants did not actually sign.** This is why the dApp shows decoded-from-bytes details in green and coordinator-claimed metadata in yellow: *the green panel is what you're really signing*. Always read the green panel. The yellow panel is a hint, not a fact.

### Authorisation, tokens, rate-limit

- **Coordinator authorisation post-AUTH.** Privileged WebSocket messages (transaction inject, execute) verify `isCoordinator` on every receive — not just at connect.
- **Reconnection tokens** are HMAC-bound to the participant's public key and re-validated against the *current* eligible-keys set on every reconnect. Removing a signer from the session invalidates that signer's token immediately, even if the token hasn't expired — no token-revocation list to maintain.
- **PIN comparison is constant-time** (`crypto.timingSafeEqual`). Rate limit is 12/min per IP, plus per-session limits, to bound online guessing.

### Mirror-node verification

Every executed transaction is confirmed against the Hedera mirror node, with a side-by-side intent-vs-actual diff. This matters because WebSocket success messages can lie or get replayed; the mirror node is the only authoritative answer to "did the network execute exactly what we signed?" Note: mirror nodes are run by independent operators, so we treat a single confirmation as evidence, not proof. For high-value transfers, verify on a mirror node you trust.

### Logging

Coordinator processes log session events (connect/disconnect, transaction inject, signature received, execution result) to stderr by default. **No private keys, no PINs, no full signatures are logged. Coordinator tokens are redacted.** There is no telemetry; nothing leaves your machine unless you ship the logs yourself.

### Supply chain

- **`protobufjs` prototype-pollution ACE ([GHSA-xq3m-2v4x-88gg](https://github.com/advisories/GHSA-xq3m-2v4x-88gg)) is patched at the lockfile.** `package.json` `overrides` pin `protobufjs` to 7.5.6 / 8.0.3 across the transitive graph, including indirect dependencies that haven't yet shipped fixed releases upstream.
- **GPG-signed releases.** The `release.yml` workflow verifies signed tags, checks the package version matches the tag, runs the production audit gate, and publishes to npm with provenance via OIDC.
- **Verify a release locally:** `npm view @lazysuperheroes/hedera-multisig dist.signatures` shows the OIDC provenance attestation; `git verify-tag v2.1.0` checks the GPG signature against the maintainer key in [`SECURITY.md`](https://github.com/lazysuperheroes/hedera-multisig/blob/main/SECURITY.md).

### Always open source, all the time

The whole story above is verifiable by you, locally, without our cooperation. The source is on GitHub. Releases are signed and provenance-attested. Every signature in a ceremony is produced on the signer's device — you can inspect what your machine produced. Every executed transaction is on the public ledger — you can confirm what landed without taking our word for it.

We treat security as continuous: multi-agent reviews each release, weekly Dependabot, public disclosure policy in [`SECURITY.md`](https://github.com/lazysuperheroes/hedera-multisig/blob/main/SECURITY.md). v2.1.0 closed three critical findings and eight high-severity findings from our internal v2.0 review (post-AUTH coordinator-role gap, the protobufjs ACE, reconnection-token rebinding, plus PIN-in-link defaults, sessionStorage migration for PIN handoff, rate-limit headroom, signature mutex on execute, mirror confirmation on every execute, ABI selector verification, coordinator-token leak sweep, `SECURITY.md` itself). All closed; CHANGELOG entries link to the patches.

---

## Common pitfalls

In rough order of damage we've seen done:

- **Single point of infrastructure failure.** Multi-sig is only as distributed as your infrastructure. Don't run all your signers through one VPN exit. Don't host the coordinator on the same instance as your eligible keys. Don't make the coordinator a single point of failure for your own org.
- **Storing keys in `process.env`.** Don't. The library ships `EncryptedFileProvider` (AES-256-GCM + PBKDF2-SHA256) and supports hardware wallets via WalletConnect — including HashPack's hardware-wallet flow. Use them. For the encrypted file, use a passphrase with real entropy — a four-word diceware phrase is stronger than `Password1234`.
- **Ignoring the 120-second window.** If your signers can't be online together within 120 seconds of the transaction freezing, use scheduled signing. That's why HIP-423 exists.
- **Trusting the yellow panel.** If you're approving a transfer based only on the recipient name or memo in yellow, you're trusting the coordinator. **Verify the recipient ID and amount in the green panel before signing.** The yellow is a hint; the green is what your key is actually authorising.
- **Pasting PIN-bearing share links into chat or email.** Slack, Discord, email — any of those gets logged somewhere. The PIN-in-link feature is opt-in for exactly this reason. Default share is the connection string *without* the PIN; deliver the PIN out-of-band (Signal, in person, voice).
- **One threshold for everything.** A 2-of-3 makes sense for daily ops; it's wrong for your $10M cold-storage account. The [threshold guide](https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs/THRESHOLD_GUIDE.md) walks the trade-off.
- **Calendar-based key rotation.** Threshold keys don't weaken with age, and rotation itself is risky (a mistake can lock the account). Rotate when *circumstances demand* it — personnel change, suspected compromise, storage upgrade — not every 90 days.

---

## Roadmap — v2.2 and beyond

We're [Lazy Superheroes](https://lazysuperheroes.com), an LSH-umbrella web3 project on Hedera. This library powers the multi-sig flows in the rest of the LSH product family (alongside our `lazylotto-agent`), and we ship it MIT-licensed in the hope it's useful to anyone else building on Hedera.

v2.1.0 is closed. See the [CHANGELOG](https://github.com/lazysuperheroes/hedera-multisig/blob/main/CHANGELOG.md) for the full list.

**v2.2 — nested KeyList coordination.** Tree-aware ceremony coordination so the server understands recursive `KeyList` thresholds (e.g. `(security_officer) AND (2 of 3 devs)`), not just flat lists. Hedera consensus already supports this at the protocol level; the gap is in the coordination layer's UX.

**Phase 6 — Flora (HCS-16) on-chain coordination.** When [HCS-16](https://hashgraph.swirlds.com/improvement-proposals/) stabilises (~Q3/Q4 2026), we ship `FloraTransport` as a drop-in replacement for `WebSocketTransport`. The seam already exists today: `CoordinationTransport` is in `shared/`, `WebSocketTransport` is the production adapter, and `FloraTransport` is a working stub that compiles, registers handlers, and no-ops the wire calls. Flora will ship as `npm install` — no API breakage for existing integrations.

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

*Production-grade means: covered by automated tests with a coverage gate (84 unit tests + 245 coverage-suite tests, gated at lines 56 / functions 50 / branches 63), CI matrix across Node 20/22/24, GPG-signed git tags, npm OIDC provenance, multi-agent review per release, public disclosure policy.*

*MIT-licensed · open-source · built by [Lazy Superheroes](https://lazysuperheroes.com) for the Hedera community.*

*Source: [github.com/lazysuperheroes/hedera-multisig](https://github.com/lazysuperheroes/hedera-multisig) · npm: [`@lazysuperheroes/hedera-multisig`](https://www.npmjs.com/package/@lazysuperheroes/hedera-multisig) · Disclosure: [SECURITY.md](https://github.com/lazysuperheroes/hedera-multisig/blob/main/SECURITY.md)*
