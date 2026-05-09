import Link from 'next/link';
import { Footer } from '../../components/Footer';

export const metadata = {
  title: 'Learn — Hedera MultiSig',
  description:
    'Walkthroughs that take you from a fresh testnet account to a successful multi-sig ceremony. The HBAR walkthrough is the canonical example; everything else is a variant.',
};

const REPO_BASE = 'https://github.com/lazysuperheroes/hedera-multisig/tree/main/examples';
const DOCS_BASE = 'https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs';
const TESTNET_DAPP_URL = 'https://testnet-multisig.lazysuperheroes.com';

export default function LearnPage() {
  // Walkthroughs are testnet-only. If this build serves the mainnet dApp,
  // push visitors over to the testnet dApp so they can follow along live.
  const network = process.env.NEXT_PUBLIC_DEFAULT_NETWORK || 'testnet';
  const isMainnetBuild = network === 'mainnet';

  return (
    <main className="min-h-screen bg-background">
      <section className="max-w-5xl mx-auto px-6 py-12 sm:py-20">
        <div className="max-w-3xl mb-12">
          <h1 className="page-hero font-heading text-3xl sm:text-5xl font-bold tracking-tight text-foreground leading-[1.1]">
            Learn by doing
          </h1>
          {/* Long subhead is treasury-friendly orientation; engineers scan
              the canonical walkthrough's steps directly. console-hide drops it. */}
          <p className="console-hide mt-4 text-lg text-foreground-muted leading-relaxed">
            Walkthroughs that take you from a fresh testnet account to a
            successful multi-sig ceremony. The HBAR walkthrough below is the
            canonical example; everything else is a variant — same shape, one
            piece changed.
          </p>
        </div>

        {/* Testnet redirect callout. Full warning if user is on the mainnet
            dApp ("you're in the wrong place"); quiet neutral confirmation if
            already on testnet ("you're in the right place, here's a tip").
            No /60 opacity hedges — true neutral for the testnet variant. */}
        <div
          className={`
            mb-12 max-w-3xl rounded-md border-l-2 pl-4 py-3
            ${isMainnetBuild
              ? 'border-warning bg-warning-soft text-warning-soft-fg'
              : 'border-border-strong bg-surface-recessed text-foreground-muted'}
          `}
          role={isMainnetBuild ? 'alert' : 'note'}
        >
          {isMainnetBuild ? (
            <p className="text-sm">
              <strong>You&apos;re on the mainnet dApp.</strong> The walkthroughs run on Hedera
              testnet — switch to{' '}
              <a
                href={TESTNET_DAPP_URL}
                className="underline font-medium hover:opacity-80"
              >
                testnet-multisig.lazysuperheroes.com
              </a>{' '}
              to follow along with real transactions and a free testnet account.
            </p>
          ) : (
            <p className="text-sm">
              You&apos;re on the testnet dApp — the right place to follow these walkthroughs.
              Get a free testnet account at{' '}
              <a
                href="https://portal.hedera.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium hover:opacity-80 text-foreground"
              >
                portal.hedera.com
              </a>
              .
            </p>
          )}
        </div>

        {/* HBAR canonical — embedded skim. Six steps with mono prefixes
            (treasury) / [ ] checklist (console). The point of the skim:
            absorb in 30 seconds what the walkthrough actually does
            without leaving the page or reading the README. */}
        <section
          className="console-pane mb-20 max-w-3xl"
          data-pane-label="~/walkthrough.hbar"
        >
          <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-3">
            HBAR walkthrough — the canonical example
          </h2>
          <p className="text-foreground-muted leading-relaxed mb-8">
            ~30 minutes end-to-end. CLI signers, CLI coordinator, real
            multi-sig ceremony, mirror confirmation. The simplest path
            through the protocol — every variant below changes one piece
            of this.
          </p>

          <ol className="console-checklist space-y-4 mb-8 list-none">
            <Step
              n="01"
              title="Precheck"
              desc="Verify operator credentials, balance, and dependencies."
              ref="00-precheck.js"
            />
            <Step
              n="02"
              title="Generate keys"
              desc="Three Ed25519 keys, encrypted with a passphrase. Each signer holds one."
              ref="01-generate-keys.js"
            />
            <Step
              n="03"
              title="Create the threshold account"
              desc="KeyList(2-of-3) wraps the three public keys. The account is the multi-sig treasury."
              ref="02-create-threshold-account.js"
            />
            <Step
              n="04"
              title="Start the coordinator"
              desc="WebSocket server holds session state, broadcasts the frozen tx, collects signatures."
              ref="npx hedera-multisig server"
            />
            <Step
              n="05"
              title="Sign the ceremony"
              desc="Coordinator builds + freezes + injects an HBAR transfer. CLI participants review and approve within 120s."
              ref="npx hedera-multisig participant"
            />
            <Step
              n="06"
              title="Verify"
              desc="Mirror node confirms the transfer landed. Receipt success isn't enough — the network must externalize."
              ref="06-verify-on-mirror.js"
            />
          </ol>

          <a
            href={`${REPO_BASE}/walkthrough-hbar`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
          >
            View the full walkthrough on GitHub
            <span aria-hidden>→</span>
          </a>
        </section>

        {/* Variants — compact reference list. Each variant is one
            paragraph: the change vs HBAR, why it matters. Single-column
            stacked, no card grid. Order is roughly simplest → most
            divergent: signing surface → tx type → key curve → tx type
            with migration → coordination model → signer type. */}
        <section className="mb-20 max-w-3xl">
          <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-3">
            Variants
          </h2>
          <p className="console-hide text-foreground-muted leading-relaxed mb-8">
            Each variant is the HBAR walkthrough with one piece swapped —
            signing surface, transaction type, key curve, or coordination
            model. Skim the line, follow the link if it&apos;s the shape
            you need.
          </p>

          <dl className="space-y-5">
            <Variant href={`${REPO_BASE}/walkthrough-dapp`} title="dApp signing">
              Same ceremony, but signers participate through the public dApp + a
              Hedera wallet (HashPack, Blade, Kabila) instead of the CLI
              participant. Best for &ldquo;what does signing actually feel like
              for participants?&rdquo;
            </Variant>
            <Variant href={`${REPO_BASE}/walkthrough-token`} title="Token & NFT transfers">
              Same shape, different transaction types — HTS fungible transfers,
              NFT transfers, and token-association ceremonies. Smoke-test for
              the dApp&apos;s non-HBAR transaction-builder paths.
            </Variant>
            <Variant href={`${REPO_BASE}/walkthrough-ecdsa`} title="ECDSA keys">
              Same dApp flow as above, but with secp256k1 (ECDSA) keys instead
              of Ed25519. Validates the entire stack — coordinator, dApp, CLI,
              mirror — is genuinely curve-agnostic. Useful when an EVM-native
              team brings their existing keys.
            </Variant>
            <Variant href={`${REPO_BASE}/walkthrough-contract`} title="Smart-contract calls">
              Deploy as a single-sig EOA, interact normally, then convert the
              account to 2-of-3 multi-sig and prove single-sig is dead. Adds
              the EOA→multi-sig migration story plus multi-sig{' '}
              <code className="text-xs font-mono bg-surface-recessed px-1 rounded">increment()</code>
              {' '}and{' '}
              <code className="text-xs font-mono bg-surface-recessed px-1 rounded">withdraw()</code>
              {' '}ceremonies.
            </Variant>
            <Variant href={`${REPO_BASE}/walkthrough-scheduled`} title="Scheduled signing">
              No 120-second window — HIP-423 async signing over hours, days, or
              up to ~62 days. Each signer signs on their own time; the network
              executes when the threshold is met. The pattern for cross-timezone
              treasury teams.
            </Variant>
            <Variant href={`${REPO_BASE}/walkthrough-agent`} title="Agent automation">
              Replaces a human signer with a headless agent driven by composable
              policy rules — amount limits, recipient allowlists, time windows.
              Same ceremony shape, different signer. Showcase for the Agent
              Signing SDK.
            </Variant>
          </dl>
        </section>

        {/* Prerequisites — flat list. console-checklist transforms the
            ordered-list markers to [ ] in console mode. */}
        <section className="border-t border-border pt-10 mb-16 max-w-3xl">
          <h2 className="font-heading text-xl font-bold text-foreground mb-4">
            Prerequisites
          </h2>
          <ol className="console-checklist text-sm text-foreground-muted space-y-2.5 list-decimal list-inside">
            <li>
              <strong className="text-foreground">Get a testnet account</strong> at{' '}
              <a
                href="https://portal.hedera.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                portal.hedera.com
              </a>{' '}
              (free; auto-funded with ~10,000 ℏ).
            </li>
            <li>
              <strong className="text-foreground">Clone the repo</strong> from{' '}
              <a
                href="https://github.com/lazysuperheroes/hedera-multisig"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                github.com/lazysuperheroes/hedera-multisig
              </a>{' '}
              and run <code className="text-xs font-mono bg-surface-recessed px-1 rounded">npm install</code>.
            </li>
            <li>
              <strong className="text-foreground">Copy <code className="text-xs font-mono bg-surface-recessed px-1 rounded">.env.example</code> to <code className="text-xs font-mono bg-surface-recessed px-1 rounded">.env</code></strong>{' '}
              and set <code className="text-xs font-mono bg-surface-recessed px-1 rounded">OPERATOR_ID</code> + <code className="text-xs font-mono bg-surface-recessed px-1 rounded">OPERATOR_KEY</code>.
            </li>
            <li>
              <strong className="text-foreground">Run <code className="text-xs font-mono bg-surface-recessed px-1 rounded">node 00-precheck.js</code></strong>{' '}
              in the walkthrough directory — verifies env, balance, and dependencies.
            </li>
          </ol>
        </section>

        {/* Deeper reading — promoted from a footer-like list to a
            real section. Architecture / security / decision recipes —
            the docs that go beyond the demo, for treasury teams
            choosing whether this is the right multi-sig solution. */}
        <section className="border-t border-border pt-10 max-w-3xl">
          <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-3">
            Deeper reading
          </h2>
          <p className="console-hide text-foreground-muted leading-relaxed mb-6">
            Architecture, threat model, and decision recipes — the
            documents that go beyond the demo. For teams choosing
            whether this is the right multi-sig solution.
          </p>

          <ul className="space-y-3 text-sm">
            <DocLink
              href={`${DOCS_BASE}/AGENT_INTEGRATION.md`}
              title="Agent Signing SDK"
              hint="PolicyEngine, composable rules, automated signing."
            />
            <DocLink
              href={`${DOCS_BASE}/COORDINATOR_GUIDE.md`}
              title="Coordinator guide"
              hint="Tunnel trust model, scheduled transactions, troubleshooting."
            />
            <DocLink
              href={`${DOCS_BASE}/SECURITY_ARCHITECTURE.md`}
              title="Security architecture"
              hint="Threat model, trust boundaries, audit posture."
            />
            <DocLink
              href={`${DOCS_BASE}/THRESHOLD_GUIDE.md`}
              title="Threshold guide"
              hint="M-of-N choice, nested KeyList semantics, decision recipes."
            />
          </ul>
        </section>
      </section>

      <Footer variant="full" />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

/**
 * Step row in the embedded HBAR walkthrough skim. Mono prefix (`01`,
 * `02`, …) only appears in treasury — console mode swaps the prefix
 * for a [ ] checklist marker via the .console-checklist > li::before
 * rule. The script/command reference is rendered subtle so treasury
 * operators can ignore it; engineers find it.
 */
function Step({ n, title, desc, ref }: { n: string; title: string; desc: string; ref: string }) {
  return (
    <li className="flex gap-3">
      <span className="treasury-label font-mono text-xs text-foreground-subtle pt-1 select-none tabular-nums">
        {n}
      </span>
      <div className="flex-1">
        <span className="font-semibold text-foreground">{title}.</span>{' '}
        <span className="text-foreground-muted">{desc}</span>{' '}
        <code className="text-xs font-mono text-foreground-subtle whitespace-nowrap">
          ({ref})
        </code>
      </div>
    </li>
  );
}

/**
 * Variant row in the variants list. Renders as a single-line title +
 * description in a definition-list shape. Children carry the body so
 * JSX entities and inline <code> work without dangerouslySetInnerHTML.
 * The whole row is the link; aria-label tightens screen-reader output.
 */
function Variant({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  return (
    <div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${title} walkthrough — view on GitHub`}
        className="group block hover:bg-surface-recessed/40 -mx-2 px-2 py-1.5 rounded-md transition-colors"
      >
        <dt className="inline font-semibold text-foreground group-hover:text-accent transition-colors">
          {title}
        </dt>
        <dd className="inline text-foreground-muted ml-1">
          {' — '}
          {children}
        </dd>
      </a>
    </div>
  );
}

/**
 * Doc link in the deeper-reading section. Same hover-affordance as
 * the variants list (background tint + accent on the title).
 */
function DocLink({ href, title, hint }: { href: string; title: string; hint: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${title} — open documentation on GitHub`}
        className="group flex items-baseline gap-3 hover:bg-surface-recessed/40 -mx-2 px-2 py-1.5 rounded-md transition-colors"
      >
        <span className="font-semibold text-foreground group-hover:text-accent transition-colors">
          {title}
        </span>
        <span className="text-foreground-subtle">·</span>
        <span className="text-foreground-muted">{hint}</span>
        <span className="text-accent ml-auto opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden>→</span>
      </a>
    </li>
  );
}
