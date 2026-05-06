/**
 * Footer — shared across all pages. Carries the LSH attribution
 * (the only place LAZY Gold appears in the dApp) and the open-source links.
 */

import Link from 'next/link';
import { LSHLogo } from './LSHLogo';

interface FooterProps {
  /** Compact = single line, no top description. Used on focused workflow pages. */
  variant?: 'full' | 'compact';
}

// Injected by `next.config.ts` from `package.json`. Falls back to 'dev'
// if running outside a Next.js build (e.g. unit tests, Storybook).
const VERSION = process.env.NEXT_PUBLIC_DAPP_VERSION || 'dev';
const BUILD_TIME = process.env.NEXT_PUBLIC_DAPP_BUILD_TIME || '';

export function Footer({ variant = 'full' }: FooterProps) {
  // Build-time tooltip so an operator can quickly confirm exactly which
  // bundle they're running. Useful when chasing "is the deployed dApp
  // actually picking up my changes?" without server-side correlation.
  const versionTooltip = BUILD_TIME
    ? `dApp v${VERSION} · built ${BUILD_TIME}`
    : `dApp v${VERSION}`;

  return (
    <footer className="mt-16 border-t border-border">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-foreground-subtle">
          {variant === 'full' ? (
            <p>Open-source multi-sig tooling for the Hedera ecosystem.</p>
          ) : (
            <span aria-hidden="true" />
          )}
          <div className="flex items-center gap-6 flex-wrap justify-center">
            <Link
              href="/learn"
              className="hover:text-foreground transition-colors"
            >
              Learn
            </Link>
            <a
              href="https://github.com/lazysuperheroes/hedera-multisig#readme"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Docs
            </a>
            <a
              href="https://github.com/lazysuperheroes/hedera-multisig"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              GitHub
            </a>
            <a
              href="https://www.npmjs.com/package/@lazysuperheroes/hedera-multisig"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              npm
            </a>
            <span className="hidden sm:inline w-px h-4 bg-border" aria-hidden="true" />
            <span
              className="text-xs font-mono opacity-70 cursor-help"
              title={versionTooltip}
            >
              v{VERSION}
            </span>
            <span className="hidden sm:inline w-px h-4 bg-border" aria-hidden="true" />
            <LSHLogo variant="attribution" />
          </div>
        </div>
      </div>
    </footer>
  );
}
