import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950">
      <div className="max-w-4xl w-full space-y-8 text-center">
        {/* Header */}
        <div className="space-y-4">
          <h1 className="text-5xl font-bold text-gray-900 dark:text-white">
            Hedera MultiSig
          </h1>
          <p className="text-xl text-gray-600 dark:text-gray-400">
            Multi-Signature Transaction Management for Hedera
          </p>
        </div>

        {/* Value Proposition */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">
            Secure Multi-Party Signing for Teams and Agents
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Coordinate multi-signature transactions across geographies with real-time WebSocket sessions,
            offline air-gapped signing, scheduled async workflows, and automated agent policies.
            Private keys never leave your device.
          </p>
        </div>

        {/* Use Cases */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-2">
            <div className="text-3xl">🏦</div>
            <h3 className="font-semibold text-gray-800 dark:text-gray-100">Treasury Management</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Move HBAR, tokens, and NFTs with multi-party approval. Smart contract calls with ABI verification.
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-2">
            <div className="text-3xl">🤖</div>
            <h3 className="font-semibold text-gray-800 dark:text-gray-100">Agent Signing</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Automated agents with composable policy rules. Amount limits, recipient allowlists, time windows.
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-2">
            <div className="text-3xl">📅</div>
            <h3 className="font-semibold text-gray-800 dark:text-gray-100">Scheduled Transactions</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Async signing over hours or days. No 120-second pressure for cross-timezone teams.
            </p>
          </div>
        </div>

        {/* Security Features */}
        <div className="grid md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-1">
            <div className="text-2xl">🔐</div>
            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Keys Stay Local</h4>
            <p className="text-xs text-gray-600 dark:text-gray-400">Private keys never transmitted</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-1">
            <div className="text-2xl">✅</div>
            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Verified Data</h4>
            <p className="text-xs text-gray-600 dark:text-gray-400">Cryptographic TX verification</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-1">
            <div className="text-2xl">🔗</div>
            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Mixed Sessions</h4>
            <p className="text-xs text-gray-600 dark:text-gray-400">CLI + dApp + hardware wallets</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-1">
            <div className="text-2xl">⚡</div>
            <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Real-Time</h4>
            <p className="text-xs text-gray-600 dark:text-gray-400">WebSocket coordination</p>
          </div>
        </div>

        {/* CTAs */}
        <div className="pt-4 space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/join"
              className="inline-block px-8 py-4 bg-blue-600 text-white font-semibold rounded-lg shadow-lg hover:bg-blue-700 transition-colors"
            >
              Join Signing Session
            </Link>
            <Link
              href="/create"
              className="inline-block px-8 py-4 bg-gray-700 dark:bg-gray-600 text-white font-semibold rounded-lg shadow-lg hover:bg-gray-800 dark:hover:bg-gray-500 transition-colors"
            >
              Coordinator Panel
            </Link>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Participants join sessions. Coordinators create sessions and build transactions.
          </p>
        </div>

        {/* Footer */}
        <div className="text-sm text-gray-500 dark:text-gray-400 pt-4 space-y-1">
          <p>
            Open source multi-sig tooling for the Hedera ecosystem.{' '}
            <a
              href="https://github.com/lazysuperheroes/hedera-multisig"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              View on GitHub
            </a>
            {' | '}
            <a
              href="https://www.npmjs.com/package/@lazysuperheroes/hedera-multisig"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              npm Package
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
