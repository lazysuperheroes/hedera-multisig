import Link from 'next/link';
import { Footer } from '../../components/Footer';

export const metadata = {
  title: 'Learn — Hedera MultiSig',
  description:
    'Two end-to-end walkthroughs: HBAR/token multi-sig and smart-contract multi-sig with EOA-to-multi-sig migration.',
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
              the walkthrough cards directly. console-hide drops it. */}
          <p className="console-hide mt-4 text-lg text-foreground-muted leading-relaxed">
            Two end-to-end walkthroughs that take you from a fresh testnet account to a successful
            multi-sig ceremony. Read the README, run the scripts, see real transactions land on
            HashScan.
          </p>
        </div>

        {/* Testnet redirect callout — walkthroughs use testnet accounts;
            mainnet users should switch to the testnet dApp to follow along.
            Shown on the testnet build too as a "you're in the right place"
            confirmation, in a quieter form. */}
        <div
          className={`
            mb-12 max-w-3xl rounded-md border-l-2 pl-4 py-3
            ${isMainnetBuild
              ? 'border-warning bg-warning-soft text-warning-soft-fg'
              : 'border-info/60 bg-info-soft/60 text-info-soft-fg'}
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
                className="underline font-medium hover:opacity-80"
              >
                portal.hedera.com
              </a>
              .
            </p>
          )}
        </div>

        {/* Walkthroughs — full-bleed primary, then a sidenote secondary.
            No eyebrows; the H2 + body weight + indentation carry the
            structural signal. */}
        <div className="mb-20">
          {/* Primary — HBAR walkthrough. Full breath in treasury;
              terminal pane in console (~/walkthrough.hbar). */}
          <Link
            href={`${REPO_BASE}/walkthrough-hbar`}
            target="_blank"
            rel="noopener noreferrer"
            className="console-pane group block max-w-3xl mb-16 p-0"
            data-pane-label="~/walkthrough.hbar"
          >
            <h2 className="font-heading text-3xl sm:text-4xl font-bold text-foreground mb-4 tracking-tight group-hover:text-accent transition-colors leading-tight">
              HBAR walkthrough
            </h2>
            <p className="text-foreground-muted leading-relaxed text-lg mb-5">
              30-minute end-to-end: generate three keys, create a 2-of-3
              threshold-key account, run a real multi-sig ceremony, and
              verify on the mirror node. Treasury teams that only move
              HBAR or fungible tokens can stop here.
            </p>
            <ul className="text-sm text-foreground-subtle space-y-1 mb-5">
              <li>· Threshold-key account creation</li>
              <li>· CLI participant + dApp coordinator flow</li>
              <li>· Mirror-node confirmation</li>
            </ul>
            <span className="text-sm font-medium text-accent group-hover:underline">
              Open on GitHub →
            </span>
          </Link>

          {/* Secondary — dApp walkthrough. Pulled out as a marginalia
              note: smaller, indented. */}
          <div className="ml-4 sm:ml-24 max-w-xl border-l-2 border-border pl-6 py-2 mb-10">
            <Link
              href={`${REPO_BASE}/walkthrough-dapp`}
              target="_blank"
              rel="noopener noreferrer"
              className="console-pane group block"
              data-pane-label="~/walkthrough.dapp"
            >
              <h2 className="font-heading text-xl font-bold text-foreground mb-3 group-hover:text-accent transition-colors">
                Sign via the public dApp
              </h2>
              <p className="text-foreground-muted leading-relaxed text-sm mb-3">
                Same multi-sig HBAR transfer, but signers participate
                through this dApp + a Hedera wallet. Hybrid pattern:
                alice in HashPack via WalletConnect, bob via CLI — same
                ceremony, same coordinator. Best for &ldquo;what does signing
                actually feel like for participants?&rdquo;
              </p>
              <ul className="text-xs text-foreground-subtle space-y-1 mb-3">
                <li>· HTTPS dApp ⇒ WSS coordinator (<code className="font-mono">--tunnel-provider ngrok</code>)</li>
                <li>· HashPack key import + WalletConnect signing</li>
                <li>· Mixed-mode: web wallet + CLI participant</li>
                <li>· Receipt view on completion (no credentials, no clutter)</li>
              </ul>
              <span className="text-sm font-medium text-accent group-hover:underline">
                Open on GitHub →
              </span>
            </Link>
          </div>

          {/* Tertiary — Smart-contract walkthrough. Same indented
              marginalia treatment. In console it gets its own pane
              chrome (~/walkthrough.contract). */}
          <div className="ml-4 sm:ml-24 max-w-xl border-l-2 border-border pl-6 py-2">
            <Link
              href={`${REPO_BASE}/walkthrough-contract`}
              target="_blank"
              rel="noopener noreferrer"
              className="console-pane group block"
              data-pane-label="~/walkthrough.contract"
            >
              <h2 className="font-heading text-xl font-bold text-foreground mb-3 group-hover:text-accent transition-colors">
                Smart-contract walkthrough
              </h2>
              <p className="text-foreground-muted leading-relaxed text-sm mb-3">
                Deploy a Counter contract as a single-sig EOA, interact
                normally, then convert the account to 2-of-3 multi-sig and
                prove single-sig is dead. Teaches every common contract path.
              </p>
              <ul className="text-xs text-foreground-subtle space-y-1 mb-3">
                <li>· <code className="font-mono">ContractCreateFlow</code> deployment</li>
                <li>· EOA → multi-sig via <code className="font-mono">AccountUpdate</code></li>
                <li>· Negative test proving authorization changed</li>
                <li>· Multi-sig <code className="font-mono">increment()</code> + <code className="font-mono">withdraw()</code></li>
                <li>· Alternate: deploy directly as multi-sig (HIP-423)</li>
              </ul>
              <span className="text-sm font-medium text-accent group-hover:underline">
                Open on GitHub →
              </span>
            </Link>
          </div>
        </div>

        {/* Prerequisites — flat list, body-weight section header */}
        <div className="border-t border-border pt-10 mb-16">
          <h3 className="font-heading text-base font-semibold text-foreground mb-4">
            Prerequisites
          </h3>
          <ol className="console-checklist text-sm text-foreground-muted space-y-2.5 list-decimal list-inside max-w-3xl">
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
              in either walkthrough directory — verifies env, balance, and dependencies.
            </li>
          </ol>
        </div>

        {/* Other docs — compact list, not card grid */}
        <div className="border-t border-border pt-10">
          <h2 className="font-heading text-xl font-bold text-foreground mb-4">
            Deeper reading
          </h2>
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
        </div>
      </section>

      <Footer variant="full" />
    </main>
  );
}

function DocLink({ href, title, hint }: { href: string; title: string; hint: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-baseline gap-3 hover:text-foreground transition-colors"
      >
        <span className="font-semibold text-foreground group-hover:text-accent transition-colors">
          {title}
        </span>
        <span className="text-foreground-subtle">·</span>
        <span className="text-foreground-muted">{hint}</span>
        <span className="text-accent ml-auto opacity-0 group-hover:opacity-100 transition-opacity">→</span>
      </a>
    </li>
  );
}
