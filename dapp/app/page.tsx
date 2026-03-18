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
            WalletConnect Participant Portal
          </p>
        </div>

        {/* Description */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 space-y-4">
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-100">
            Sign Multi-Signature Transactions with Your Wallet
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Join signing sessions and approve multi-signature transactions using your connected Hedera wallet.
            Supports hardware wallets via WalletConnect providers like HashPack.
          </p>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-2">
            <div className="text-3xl">🔐</div>
            <h3 className="font-semibold text-gray-800 dark:text-gray-100">Secure</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Private keys never leave your wallet. Hardware wallet support included.
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-2">
            <div className="text-3xl">✅</div>
            <h3 className="font-semibold text-gray-800 dark:text-gray-100">Verified</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Review cryptographically verified transaction data before signing.
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-2">
            <div className="text-3xl">⚡</div>
            <h3 className="font-semibold text-gray-800 dark:text-gray-100">Real-Time</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              WebSocket coordination for fast multi-party signing sessions.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="pt-4">
          <Link
            href="/join"
            className="inline-block px-8 py-4 bg-blue-600 text-white font-semibold rounded-lg shadow-lg hover:bg-blue-700 transition-colors"
          >
            Join Signing Session
          </Link>
        </div>

        {/* Footer Note */}
        <div className="text-sm text-gray-500 dark:text-gray-400 pt-8">
          <p>
            Part of the Hedera MultiSig networked architecture.{' '}
            <a
              href="https://github.com/lazysuperheroes/hedera-multisig"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              View on GitHub
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
