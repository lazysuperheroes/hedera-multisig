/**
 * ConsoleBar — top status bar that replaces NavBar in console register.
 *
 * Format (single line, mono throughout):
 *   [LSH] $ ~/multisig:/path  |  /join /create /history /learn  |  net:testnet  wallet:0.0.X  [☀] [T]
 *
 * The path segments are clickable for navigation. The wallet pill is
 * collapsible. Mobile collapses nav links into a menu button.
 *
 * Design intent: the dApp in console mode should look like a running
 * shell session, not a banking app. This bar is the strongest single
 * signal of that.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWallet } from '../hooks/useWallet';
import { WalletSelectionDialog } from './WalletSelectionDialog';
import { ThemeToggle } from './ThemeToggle';
import { RegisterToggle } from './RegisterToggle';

const NAV_LINKS = [
  { href: '/join', label: '/join' },
  { href: '/create', label: '/create' },
  { href: '/history', label: '/history' },
  { href: '/learn', label: '/learn' },
];

export function ConsoleBar({ showWalletPanel }: { showWalletPanel: boolean }) {
  const pathname = usePathname();
  const network = process.env.NEXT_PUBLIC_DEFAULT_NETWORK || 'testnet';
  const [showMobileNav, setShowMobileNav] = useState(false);

  // Show landing page as `~/multisig` (no trailing route); other routes
  // hang off it as `~/multisig:/create`. This is the shell-prompt-style
  // path that announces "you're in a tool."
  const path = pathname === '/' ? '~/multisig' : `~/multisig:${pathname}`;

  return (
    <nav
      className="
        sticky top-0 left-0 z-40 bg-background border-b-2 border-accent
        font-mono text-[13px]
      "
      aria-label="Console navigation"
    >
      <div className="max-w-[1400px] mx-auto px-4 flex items-center gap-3 h-9">

        {/* Brand mark — minimal, just the LSH wordmark */}
        <Link
          href="/"
          className="flex items-center gap-2 text-foreground hover:opacity-80 transition-opacity flex-shrink-0"
          aria-label="Home"
        >
          <BrandLogo />
        </Link>

        <Sep />

        {/* Path — shell prompt style */}
        <span className="text-foreground tabular-nums truncate">
          <span className="text-accent font-bold">$</span>{' '}
          <span className="text-foreground-muted">{path}</span>
        </span>

        <Sep className="hidden md:inline" />

        {/* Nav links — inline mono. Hidden on mobile (replaced with menu). */}
        <div className="hidden md:flex items-center gap-2.5 flex-shrink-0">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`
                px-1 py-0.5 transition-colors hover:text-accent
                ${pathname === link.href || pathname.startsWith(link.href + '/')
                  ? 'text-accent border-b border-accent'
                  : 'text-foreground-muted'}
              `}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Network — mainnet stays success-green (real-money signal),
            testnet is a true neutral. Network is metadata, not status;
            warning-yellow misappropriates the severity palette. Matches
            the NetworkBadge / NetworkChip treatment elsewhere. */}
        <span className="hidden lg:inline text-foreground-subtle flex-shrink-0">
          net:<span className={network === 'mainnet' ? 'text-success' : 'text-foreground-muted'}>
            {network}
          </span>
        </span>

        <Sep className="hidden lg:inline" />

        {/* Wallet pill */}
        {showWalletPanel && <ConsoleWalletPill />}

        <Sep className="hidden lg:inline" />

        {/* Theme + register toggles */}
        <ThemeToggle />
        <RegisterToggle />

        {/* Mobile nav menu button */}
        <button
          onClick={() => setShowMobileNav(!showMobileNav)}
          className="md:hidden text-foreground-muted hover:text-foreground transition-colors px-2"
          aria-label={showMobileNav ? 'Close menu' : 'Open menu'}
          aria-expanded={showMobileNav}
        >
          {showMobileNav ? '×' : '≡'}
        </button>
      </div>

      {/* Mobile nav drawer */}
      {showMobileNav && (
        <div className="md:hidden border-t border-border px-4 py-2 bg-surface">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setShowMobileNav(false)}
                className="py-1.5 text-foreground-muted hover:text-accent transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}

function Sep({ className = '' }: { className?: string }) {
  return (
    <span
      className={`text-foreground-subtle select-none ${className}`}
      aria-hidden="true"
    >
      |
    </span>
  );
}

/**
 * BrandLogo — compact wordmark for ConsoleBar. The full LSH wordmark
 * with the `[CONSOLE]` tag is overkill in this register since the
 * entire bar already signals "console". Just show LSH.
 */
function BrandLogo() {
  return (
    <span className="font-mono text-[13px] font-bold tracking-tight">
      <span className="text-accent">lsh</span>
      <span className="text-foreground-subtle">/</span>
      <span className="text-foreground">multisig</span>
    </span>
  );
}

function ConsoleWalletPill() {
  const wallet = useWallet();
  const [showDialog, setShowDialog] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  if (!wallet.isConnected) {
    return (
      <>
        <button
          onClick={() => setShowDialog(true)}
          className="text-foreground-muted hover:text-accent transition-colors"
          title="Connect wallet"
        >
          wallet:<span className="text-foreground-subtle">none</span>
        </button>
        <WalletSelectionDialog open={showDialog} onClose={() => setShowDialog(false)} />
      </>
    );
  }

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-foreground hover:text-accent transition-colors flex items-center gap-1"
          aria-label="Wallet details"
        >
          <span className="text-success">●</span>
          <span className="text-foreground-subtle">wallet:</span>
          <span className="tabular-nums">{wallet.accountId}</span>
        </button>

        {showDetails && (
          <div
            role="dialog"
            aria-label="Wallet details"
            className="
              absolute right-0 top-full mt-1 w-72 z-50
              bg-surface border border-accent
              p-3 text-[12px]
            "
          >
            <dl className="space-y-2">
              <div>
                <dt className="text-foreground-subtle uppercase tracking-wider text-[10px]">account</dt>
                <dd className="text-foreground tabular-nums">{wallet.accountId}</dd>
              </div>
              {wallet.publicKeyType && (
                <div>
                  <dt className="text-foreground-subtle uppercase tracking-wider text-[10px]">key_type</dt>
                  <dd className="text-accent">{wallet.publicKeyType}</dd>
                </div>
              )}
              {wallet.publicKey && (
                <div>
                  <dt className="text-foreground-subtle uppercase tracking-wider text-[10px]">pubkey</dt>
                  <dd className="text-foreground break-all">
                    {wallet.publicKey}
                  </dd>
                </div>
              )}
              {wallet.evmAddress && (
                <div>
                  <dt className="text-foreground-subtle uppercase tracking-wider text-[10px]">evm</dt>
                  <dd className="text-foreground break-all">{wallet.evmAddress}</dd>
                </div>
              )}
              <div className="pt-2 border-t border-border">
                <button
                  onClick={() => { wallet.disconnect(); setShowDetails(false); }}
                  className="text-destructive hover:opacity-80 text-[12px]"
                >
                  $ disconnect
                </button>
              </div>
            </dl>
          </div>
        )}
      </div>
    </>
  );
}
