import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--background)]">
      {/* Hero — left-aligned, CTAs above fold */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-12 sm:pt-24 sm:pb-20">
        <div className="max-w-3xl">
          <h1 className="animate-slide-up text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-gray-900 dark:text-white leading-[1.08]">
            Multi-signature
            <br />
            transactions
            <br />
            <span className="text-blue-600 dark:text-blue-400">for Hedera</span>
          </h1>
          <p className="animate-slide-up delay-100 mt-6 text-lg sm:text-xl text-gray-600 dark:text-gray-400 max-w-xl leading-relaxed">
            Coordinate multi-party signing across teams, agents, and time zones.
            Private keys never leave your device.
          </p>

          {/* Primary CTAs — above the fold, with role hint */}
          <div className="animate-slide-up delay-200 mt-10 space-y-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href="/join"
                className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
              >
                Join Signing Session
              </Link>
              <Link
                href="/create"
                className="inline-flex items-center justify-center px-8 py-4 text-lg font-semibold border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
              >
                Create Session
              </Link>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Participants join to sign. Coordinators create sessions and build transactions.
            </p>
          </div>
        </div>
      </section>

      {/* Use Cases — featured primary + two supporting */}
      <section className="border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
        <div className="max-w-6xl mx-auto px-6 py-16 sm:py-20">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-500 mb-10">
            Use cases
          </h2>

          {/* Primary use case — larger, full width */}
          <div className="mb-12">
            <h3 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white mb-3">
              Treasury Management
            </h3>
            <p className="text-gray-600 dark:text-gray-400 leading-relaxed max-w-2xl">
              Move HBAR, tokens, and NFTs with multi-party approval. Smart contract calls with ABI verification.
              The most common use case for teams managing shared accounts.
            </p>
          </div>

          {/* Supporting use cases — smaller, side by side */}
          <div className="grid sm:grid-cols-2 gap-x-12 gap-y-8">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                Agent Signing
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Automated agents with composable policy rules. Amount limits, recipient allowlists, time windows.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                Scheduled Transactions
              </h3>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Async signing over hours or days. No 120-second pressure for cross-timezone teams.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Security Model — hidden on mobile (most mobile users arrive via /join link, not landing page) */}
      <section className="hidden sm:block border-t border-gray-200 dark:border-gray-800">
        <div className="max-w-6xl mx-auto px-6 py-16 sm:py-24">
          <div className="grid lg:grid-cols-5 gap-12 lg:gap-16">
            <div className="lg:col-span-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 dark:text-gray-500 mb-10">
                Security Model
              </h2>
              <dl className="space-y-8">
                <div>
                  <dt className="text-lg font-bold text-gray-900 dark:text-white">Keys stay local</dt>
                  <dd className="mt-1.5 text-gray-600 dark:text-gray-400 leading-relaxed">
                    Private keys are never transmitted. Only frozen transactions and signatures flow over the network.
                  </dd>
                </div>
                <div>
                  <dt className="text-lg font-bold text-gray-900 dark:text-white">Verified data separation</dt>
                  <dd className="mt-1.5 text-gray-600 dark:text-gray-400 leading-relaxed">
                    You always see what the transaction actually does, clearly separated from what the coordinator claims it does.
                  </dd>
                </div>
                <div>
                  <dt className="text-lg font-bold text-gray-900 dark:text-white">Mixed sessions</dt>
                  <dd className="mt-1.5 text-gray-600 dark:text-gray-400 leading-relaxed">
                    CLI tools, browser wallets, and automated agents can join the same signing session.
                  </dd>
                </div>
                <div>
                  <dt className="text-lg font-bold text-gray-900 dark:text-white">Real-time coordination</dt>
                  <dd className="mt-1.5 text-gray-600 dark:text-gray-400 leading-relaxed">
                    Live sessions with automatic reconnection, so participants can sign together without manual coordination.
                  </dd>
                </div>
              </dl>
            </div>
            <div className="hidden lg:flex lg:col-span-2 items-center">
              <blockquote className="text-3xl xl:text-4xl font-bold leading-tight tracking-tight text-gray-900 dark:text-white">
                The server coordinates signing
                <span className="text-green-600 dark:text-green-400"> without ever seeing your private keys.</span>
              </blockquote>
            </div>
          </div>
        </div>
      </section>

      {/* Footer — compact, functional */}
      <footer className="border-t border-gray-200 dark:border-gray-800">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500 dark:text-gray-400">
          <p>Open source multi-sig tooling for the Hedera ecosystem.</p>
          <div className="flex items-center gap-6">
            <a
              href="https://github.com/lazysuperheroes/hedera-multisig#readme"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-gray-300 dark:decoration-gray-600 hover:text-gray-900 dark:hover:text-white hover:decoration-gray-500 transition-colors"
            >
              Docs
            </a>
            <a
              href="https://github.com/lazysuperheroes/hedera-multisig"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-gray-300 dark:decoration-gray-600 hover:text-gray-900 dark:hover:text-white hover:decoration-gray-500 transition-colors"
            >
              GitHub
            </a>
            <a
              href="https://www.npmjs.com/package/@lazysuperheroes/hedera-multisig"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-gray-300 dark:decoration-gray-600 hover:text-gray-900 dark:hover:text-white hover:decoration-gray-500 transition-colors"
            >
              npm
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
