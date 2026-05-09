import Link from 'next/link';
import { Footer } from '../components/Footer';
import { LandingOnboarding } from '../components/LandingOnboarding';

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      {/* Hero — left-aligned, CTAs above fold. No accent-color span;
          the headline carries on its own. text-balance lets the
          browser pick line breaks at each viewport rather than the
          old hard-coded <br/> shape that broke at intermediate widths. */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-12 sm:pt-24 sm:pb-20">
        <div className="max-w-3xl">
          <h1 className="page-hero font-heading text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-foreground leading-[1.08] text-balance">
            Multi-sig that survives time zones on Hedera.
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-foreground-muted max-w-xl leading-relaxed">
            Approve Tuesday, sign Wednesday from London, network executes
            when the threshold is met. Up to 62 days later. Threshold
            signatures, agent automation, scheduled async signing.
            Private keys never leave your device.
          </p>

          {/* Primary CTAs. Treasury → Join filled, Create ghost (most
              arrivals are joiners via Slack links). Console → both
              ghost-flag, equal weight (devs are equally likely to be
              creating sessions or joining them); see .hero-cta-primary
              rule in globals.css. */}
          <div className="mt-10 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/join"
                className="
                  cmd hero-cta-primary inline-flex items-center justify-center px-7 py-3.5 text-base font-semibold
                  bg-accent text-accent-fg rounded-md
                  hover:bg-accent-hover transition-colors
                "
              >
                Join session
              </Link>
              <Link
                href="/create"
                className="
                  cmd inline-flex items-center justify-center px-7 py-3.5 text-base font-semibold
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

          {/* Onboarding surfaces: "How this works" callout (dismissible)
              + Try-Console nudge (after visit 3, treasury only). Visit
              counter bumps on mount of LandingOnboarding. The callout
              also carries the security framing (Vercel never sees your
              transactions, etc.) — replaces the dedicated security
              section that lived here in earlier versions. */}
          <LandingOnboarding />
        </div>
      </section>

      {/* Use cases — Treasury full-width dominant, Agent + Scheduled as
          equally-indented secondary peers below. The hierarchy is
          intentional: Treasury is the most common case and the entry
          point for most teams; Agent and Scheduled are first-class but
          secondary. Equal indent on the two peers signals they're at
          the same level of importance to each other (no implicit
          ranking via offset depth, which the previous staircase did). */}
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

          {/* Agent + Scheduled — two equal-indent peers under a shared
              vertical rule. Both use h3 + smaller body to read as
              secondary to Treasury, but neither is positioned as
              ranking above the other. */}
          <div className="ml-4 sm:ml-12 border-l border-border pl-6 space-y-10">
            <div className="max-w-xl">
              <h3 className="font-heading text-lg font-bold text-foreground mb-2">
                Agent signing
              </h3>
              <p className="text-foreground-muted leading-relaxed text-sm">
                Automated agents with composable policy rules. Amount limits,
                recipient allowlists, time windows.
              </p>
              <Link
                href="/learn"
                className="mt-3 inline-flex text-sm font-medium text-accent hover:underline"
              >
                See the agent walkthrough →
              </Link>
            </div>

            <div className="max-w-xl">
              <h3 className="font-heading text-lg font-bold text-foreground mb-2">
                Scheduled transactions
              </h3>
              <p className="text-foreground-muted leading-relaxed text-sm">
                Async signing over hours, days, or up to ~62 days (HIP-423).
                No 120-second pressure for cross-timezone teams.
              </p>
              <Link
                href="/learn"
                className="mt-3 inline-flex text-sm font-medium text-accent hover:underline"
              >
                See the scheduled walkthrough →
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer variant="full" />
    </main>
  );
}
