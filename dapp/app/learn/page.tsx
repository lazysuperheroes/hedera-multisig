import Link from 'next/link';

export const metadata = {
  title: 'Learn — Hedera MultiSig',
  description:
    'Two end-to-end walkthroughs: HBAR/token multi-sig and smart-contract multi-sig with EOA-to-multi-sig migration.',
};

const REPO_BASE = 'https://github.com/lazysuperheroes/hedera-multisig/tree/main/examples';

export default function LearnPage() {
  return (
    <main className="min-h-screen bg-[var(--background)]">
      <section className="max-w-5xl mx-auto px-6 py-12 sm:py-20">
        <div className="max-w-3xl mb-12">
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-gray-900 dark:text-white leading-tight">
            Learn by doing
          </h1>
          <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
            Two end-to-end walkthroughs that take you from a fresh testnet
            account to a successful multi-sig ceremony. Read the README,
            run the scripts, see real transactions land on HashScan.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-6 mb-12">
          {/* HBAR walkthrough */}
          <Link
            href={`${REPO_BASE}/walkthrough-hbar`}
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xl">
                ℏ
              </span>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                HBAR walkthrough
              </h2>
              <span className="ml-auto text-xs px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800">
                Start here
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              30-minute end-to-end: generate three keys, create a 2-of-3
              threshold-key account, run a real multi-sig ceremony, and
              verify on the mirror node. Treasury teams that only move
              HBAR or fungible tokens can stop here.
            </p>
            <ul className="text-xs text-gray-500 dark:text-gray-500 space-y-1 mb-4">
              <li>· Threshold-key account creation</li>
              <li>· CLI participant + dApp coordinator flow</li>
              <li>· Mirror-node confirmation</li>
            </ul>
            <span className="text-sm font-medium text-blue-600 dark:text-blue-400 group-hover:underline">
              Open on GitHub →
            </span>
          </Link>

          {/* Contract walkthrough */}
          <Link
            href={`${REPO_BASE}/walkthrough-contract`}
            target="_blank"
            rel="noopener noreferrer"
            className="group rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-xl font-mono">
                {'<>'}
              </span>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                Smart contract walkthrough
              </h2>
              <span className="ml-auto text-xs px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
                +20 min
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Deploy a Counter contract as a single-sig EOA, interact
              normally, then convert the account to 2-of-3 multi-sig and
              prove single-sig is dead. Runs the same operations under
              multi-sig ceremony. Teaches every common contract path.
            </p>
            <ul className="text-xs text-gray-500 dark:text-gray-500 space-y-1 mb-4">
              <li>· <code>ContractCreateFlow</code> deployment pattern</li>
              <li>· EOA → multi-sig migration via <code>AccountUpdate</code></li>
              <li>· Negative test proving authorization changed</li>
              <li>· Multi-sig <code>increment()</code> + <code>withdraw()</code> ceremonies</li>
              <li>· Alternate path: deploy directly as multi-sig (HIP-423)</li>
            </ul>
            <span className="text-sm font-medium text-blue-600 dark:text-blue-400 group-hover:underline">
              Open on GitHub →
            </span>
          </Link>
        </div>

        {/* Prerequisites note */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-6 mb-12">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 uppercase tracking-wider">
            Prerequisites
          </h3>
          <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-2 list-decimal list-inside">
            <li>
              <strong>Get a testnet account</strong> at{' '}
              <a
                href="https://portal.hedera.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                portal.hedera.com
              </a>{' '}
              (free; auto-funded with ~10,000 ℏ).
            </li>
            <li>
              <strong>Clone the repo</strong> from{' '}
              <a
                href="https://github.com/lazysuperheroes/hedera-multisig"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                github.com/lazysuperheroes/hedera-multisig
              </a>{' '}
              and run <code className="text-xs bg-gray-200 dark:bg-gray-900 px-1 rounded">npm install</code>.
            </li>
            <li>
              <strong>Copy <code>.env.example</code> to <code>.env</code></strong> and set <code className="text-xs bg-gray-200 dark:bg-gray-900 px-1 rounded">OPERATOR_ID</code> + <code className="text-xs bg-gray-200 dark:bg-gray-900 px-1 rounded">OPERATOR_KEY</code>.
            </li>
            <li>
              <strong>Run <code className="text-xs bg-gray-200 dark:bg-gray-900 px-1 rounded">node 00-precheck.js</code></strong> in either walkthrough directory — verifies env, balance, and dependencies.
            </li>
          </ol>
        </div>

        {/* Other learning resources */}
        <div className="grid sm:grid-cols-3 gap-4">
          <Link
            href="https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs/AGENT_INTEGRATION.md"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
          >
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Agent Signing SDK</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">PolicyEngine, composable rules, automated signing.</p>
          </Link>
          <Link
            href="https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs/COORDINATOR_GUIDE.md"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
          >
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Coordinator Guide</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">Tunnel trust model, scheduled transactions, troubleshooting.</p>
          </Link>
          <Link
            href="https://github.com/lazysuperheroes/hedera-multisig/blob/main/docs/SECURITY_ARCHITECTURE.md"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
          >
            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Security Architecture</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">Threat model, trust boundaries, audit posture.</p>
          </Link>
        </div>
      </section>
    </main>
  );
}
