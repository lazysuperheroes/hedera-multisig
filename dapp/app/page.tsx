import Link from 'next/link';
import { Footer } from '../components/Footer';

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      {/* Hero — left-aligned, CTAs above fold. No accent-color span;
          the headline carries on its own. */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-12 sm:pt-24 sm:pb-20">
        <div className="max-w-3xl">
          <h1 className="page-hero animate-slide-up font-heading text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-foreground leading-[1.08]">
            Multi-sig that
            <br />
            survives time zones
            <br />
            on Hedera.
          </h1>
          <p className="animate-slide-up delay-100 mt-6 text-lg sm:text-xl text-foreground-muted max-w-xl leading-relaxed">
            Approve Tuesday, sign Wednesday from London, network executes
            when the threshold is met. Up to 62 days later. Threshold
            signatures, agent automation, scheduled async signing.
            Private keys never leave your device.
          </p>

          {/* Primary CTAs */}
          <div className="animate-slide-up delay-200 mt-10 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/join"
                className="
                  inline-flex items-center justify-center px-7 py-3.5 text-base font-semibold
                  bg-accent text-accent-fg rounded-md
                  hover:bg-accent-hover transition-colors
                "
              >
                Join Signing Session
              </Link>
              <Link
                href="/create"
                className="
                  inline-flex items-center justify-center px-7 py-3.5 text-base font-semibold
                  text-foreground border border-border-strong rounded-md
                  hover:bg-surface-recessed transition-colors
                "
              >
                Create Session
              </Link>
            </div>
            <p className="text-sm text-foreground-subtle">
              Participants join to sign. Coordinators create sessions and build transactions.
            </p>
          </div>

          {/* "How this works" — flat callout, not a bordered card */}
          <div className="animate-slide-up delay-300 mt-10 max-w-2xl border-l-2 border-accent/30 pl-5 py-1 text-sm text-foreground-muted leading-relaxed">
            <span className="font-semibold text-foreground">How this works.</span>{' '}
            We host the user interface;{' '}
            <strong className="text-foreground">you (or a teammate) host the coordinator</strong>{' '}
            via{' '}
            <code className="text-xs font-mono bg-surface-recessed px-1.5 py-0.5 rounded">
              npx hedera-multisig server
            </code>
            . The dApp connects to that coordinator URL — Vercel never sees your transactions.{' '}
            <Link href="/learn" className="text-accent hover:underline whitespace-nowrap">
              New here? Try the walkthrough →
            </Link>
          </div>
        </div>
      </section>

      {/* Use cases — staircase rhythm. Each case sits at a different
          horizontal position. Section break carried by the border-t +
          spacing; no eyebrow chrome — Treasury's H2 leads the section. */}
      <section className="border-t border-border bg-surface-recessed/40">
        <div className="max-w-6xl mx-auto px-6 py-16 sm:py-24">

          {/* Treasury — full width, dominant. H2 acts as the section header. */}
          <div className="max-w-3xl mb-14">
            <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-3 tracking-tight">
              Treasury management
            </h2>
            <p className="text-foreground-muted leading-relaxed text-lg">
              Move HBAR, tokens, and NFTs with multi-party approval.
              Smart-contract calls with ABI verification. The most common use
              case for teams managing shared accounts.
            </p>
            <Link
              href="/learn"
              className="mt-4 inline-flex text-sm font-medium text-accent hover:underline"
            >
              See the HBAR walkthrough →
            </Link>
          </div>

          {/* Agent signing — one offset step in. */}
          <div className="max-w-xl ml-4 sm:ml-12 mb-10 border-l border-border pl-6">
            <h3 className="font-heading text-lg font-bold text-foreground mb-2">
              Agent signing
            </h3>
            <p className="text-foreground-muted leading-relaxed text-sm">
              Automated agents with composable policy rules. Amount limits,
              recipient allowlists, time windows.
            </p>
          </div>

          {/* Scheduled transactions — two offset steps in. */}
          <div className="max-w-xl ml-8 sm:ml-24 border-l border-border pl-6">
            <h3 className="font-heading text-lg font-bold text-foreground mb-2">
              Scheduled transactions
            </h3>
            <p className="text-foreground-muted leading-relaxed text-sm">
              Async signing over hours, days, or up to ~62 days (HIP-423).
              No 120-second pressure for cross-timezone teams.
            </p>
          </div>
        </div>
      </section>

      {/* Security model — asymmetric pull-quote layout, kept (it works).
          Hidden on mobile (most mobile users arrive via /join link). */}
      <section className="hidden sm:block border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-16 sm:py-24">
          <div className="grid lg:grid-cols-5 gap-12 lg:gap-16">
            <div className="lg:col-span-3">
              <h2 className="font-heading text-2xl sm:text-3xl font-bold text-foreground mb-10 tracking-tight">
                Security model
              </h2>
              <dl className="space-y-8">
                <SecurityPrinciple
                  title="Keys stay local"
                  body="Private keys are never transmitted. Only frozen transactions and signatures flow over the network."
                />
                <SecurityPrinciple
                  title="Verified data separation"
                  body="You always see what the transaction actually does, clearly separated from what the coordinator claims it does."
                />
                <SecurityPrinciple
                  title="Mixed sessions"
                  body="CLI tools, browser wallets, and automated agents can join the same signing session."
                />
                <SecurityPrinciple
                  title="Real-time coordination"
                  body="Live sessions with automatic reconnection, so participants can sign together without manual coordination."
                />
              </dl>
            </div>
            <div className="hidden lg:flex lg:col-span-2 items-center">
              <blockquote className="font-heading text-3xl xl:text-4xl font-bold leading-[1.15] tracking-tight text-foreground">
                The server coordinates signing
                <span className="text-success"> without ever seeing your private keys.</span>
              </blockquote>
            </div>
          </div>
        </div>
      </section>

      <Footer variant="full" />
    </main>
  );
}

function SecurityPrinciple({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <dt className="font-heading text-lg font-bold text-foreground">{title}</dt>
      <dd className="mt-1.5 text-foreground-muted leading-relaxed">{body}</dd>
    </div>
  );
}
