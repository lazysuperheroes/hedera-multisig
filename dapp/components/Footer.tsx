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

export function Footer({ variant = 'full' }: FooterProps) {
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
            <LSHLogo variant="attribution" />
          </div>
        </div>
      </div>
    </footer>
  );
}
