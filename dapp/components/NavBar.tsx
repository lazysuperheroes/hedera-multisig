/**
 * NavBar — single shared shell, with an optional WalletPanel on routes that
 * need a wallet. The landing page (`/`) skips the wallet panel entirely so
 * the WalletConnect SDK chunk + polling intervals never load there
 * (Phase C8 perf win, preserved).
 *
 * Composition:
 *   NavBar
 *     └─ NavShell (logo · nav links · right-side: RegisterToggle + WalletPanel? + hamburger)
 *           └─ WalletPanel (only on non-landing routes)
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '../contexts/ThemeContext';
import { useWallet } from '../hooks/useWallet';
import { WalletSelectionDialog } from './WalletSelectionDialog';
import { RegisterToggle } from './RegisterToggle';
import { ThemeToggle } from './ThemeToggle';
import { LSHLogo } from './LSHLogo';
import { ConsoleBar } from './ConsoleBar';

/**
 * NavBar — register-aware shell.
 * - treasury register: standard NavShell (logo + nav links + wallet panel + toggles)
 * - console register:  ConsoleBar (top status bar with shell-prompt path)
 *
 * Both forms render their own theme + register toggles so the user can
 * switch back regardless of which register they're in.
 */
export function NavBar() {
  const pathname = usePathname();
  const { register } = useTheme();
  const isLanding = pathname === '/';
  if (register === 'console') {
    return <ConsoleBar showWalletPanel={!isLanding} />;
  }
  return <NavShell showWalletPanel={!isLanding} />;
}

// ---------------------------------------------------------------------------
// Shell — owns layout, logo, nav links, mobile menu, register toggle
// ---------------------------------------------------------------------------

function NavShell({ showWalletPanel }: { showWalletPanel: boolean }) {
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const pathname = usePathname();
  const network = process.env.NEXT_PUBLIC_DEFAULT_NETWORK || 'testnet';

  // Active-page indicator. Match exact route for top-level links;
  // for /session/* there's no nav link, so nothing is active there.
  const isActive = (href: string) =>
    pathname === href || pathname?.startsWith(href + '/');

  const navLinkClass = (href: string) =>
    isActive(href)
      ? 'px-3 py-2 text-sm font-medium text-foreground bg-surface-recessed rounded-md'
      : 'px-3 py-2 text-sm font-medium text-foreground-muted hover:text-foreground hover:bg-surface-recessed rounded-md transition-colors';

  return (
    <nav className="sticky top-0 left-0 z-40 bg-background border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16 sm:h-[68px] gap-4">
          {/* Brand lock-up */}
          <Link
            href="/"
            className="flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
            onClick={() => setShowMobileMenu(false)}
            aria-label="Hedera MultiSig — by Lazy Superheroes"
          >
            <LSHLogo variant="lockup" />
            <NetworkBadge network={network} />
          </Link>

          {/* Desktop nav */}
          <div className="hidden sm:flex items-center gap-1">
            <Link href="/join" className={navLinkClass('/join')} aria-current={isActive('/join') ? 'page' : undefined}>Join</Link>
            <Link href="/create" className={navLinkClass('/create')} aria-current={isActive('/create') ? 'page' : undefined}>Create</Link>
            <Link href="/history" className={navLinkClass('/history')} aria-current={isActive('/history') ? 'page' : undefined}>History</Link>
            <Link href="/learn" className={navLinkClass('/learn')} aria-current={isActive('/learn') ? 'page' : undefined}>Learn</Link>
          </div>

          {/* Right: theme + register toggles, wallet panel (when applicable), mobile menu.
              Two independent buttons — light/dark/auto on one, treasury/dev on the other.
              Each cycles independently; all 6 combinations valid. */}
          <div className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <RegisterToggle />
            {showWalletPanel && <WalletPanel />}
            {!showWalletPanel && (
              <Link
                href="/join"
                className="
                  hidden sm:inline-flex items-center px-4 py-2 rounded-md text-sm font-semibold
                  bg-accent text-accent-fg hover:bg-accent-hover transition-colors
                "
              >
                Join Session
              </Link>
            )}
            <button
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className="sm:hidden p-2 rounded-md text-foreground-muted hover:bg-surface-recessed transition-colors"
              aria-label={showMobileMenu ? 'Close menu' : 'Open menu'}
              aria-expanded={showMobileMenu}
            >
              {showMobileMenu ? <CloseIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {showMobileMenu && (
        <div className="sm:hidden border-t border-border bg-background animate-slide-down">
          <div className="px-4 py-3 space-y-1">
            <MobileLink href="/join" onClick={() => setShowMobileMenu(false)}>Join Session</MobileLink>
            <MobileLink href="/create" onClick={() => setShowMobileMenu(false)}>Create Session</MobileLink>
            <MobileLink href="/history" onClick={() => setShowMobileMenu(false)}>History</MobileLink>
            <MobileLink href="/learn" onClick={() => setShowMobileMenu(false)}>Learn</MobileLink>
          </div>
          {showWalletPanel && (
            <div className="px-4 py-3 border-t border-border">
              <WalletButton mobile />
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

function MobileLink({ href, onClick, children }: { href: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="block px-3 py-2.5 text-base font-medium text-foreground-muted hover:bg-surface-recessed rounded-md transition-colors"
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Network badge — neither network pulses (calmer; previous testnet-only
// pulse implied alarm). Network state is communicated by colour token.
// ---------------------------------------------------------------------------

function NetworkBadge({ network }: { network: string }) {
  const isMainnet = network === 'mainnet';
  return (
    <span
      className={`
        hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px]
        font-semibold uppercase tracking-wider
        ${isMainnet
          ? 'bg-success-soft text-success-soft-fg'
          : 'bg-warning-soft text-warning-soft-fg'}
      `}
    >
      {/* Presence dot — 6px filled circle. Drops the previous 1px hairline
          (which was effectively invisible) and the /40 border. Color carries
          the network semantic; soft bg + dot is enough definition without a
          colored border. */}
      <span
        className={`w-1.5 h-1.5 rounded-full ${isMainnet ? 'bg-success' : 'bg-warning'}`}
        aria-hidden="true"
      />
      {network}
    </span>
  );
}

// ---------------------------------------------------------------------------
// WalletPanel — renders the wallet hook (which mounts WalletConnect chunk
// + polling intervals). Only included on routes that actually need it.
// ---------------------------------------------------------------------------

function WalletPanel() {
  const wallet = useWallet();
  const [showWalletDialog, setShowWalletDialog] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleConnectClick = async () => {
    if (wallet.isConnected) {
      await wallet.disconnect();
    } else {
      setShowWalletDialog(true);
    }
  };

  const handleCopyPublicKey = async () => {
    if (wallet.publicKey) {
      await navigator.clipboard.writeText(wallet.publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!wallet.isConnected) {
    return (
      <>
        <button
          onClick={handleConnectClick}
          disabled={wallet.isConnecting}
          className="
            hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold
            bg-accent text-accent-fg hover:bg-accent-hover
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors
          "
        >
          {wallet.isConnecting && <Spinner />}
          {wallet.isConnecting ? 'Connecting…' : 'Connect Wallet'}
        </button>
        <WalletSelectionDialog open={showWalletDialog} onClose={() => setShowWalletDialog(false)} />
      </>
    );
  }

  return (
    <>
      <div className="hidden sm:flex items-center gap-2 relative">
        {/* Compact pill: account ID + balance. Click to expand the
            details panel where Disconnect now lives. Demoting the
            always-visible Disconnect button reduces nav real-estate
            and turns disconnection into a deliberate two-step action
            (open panel → confirm) rather than a one-click footgun. */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          aria-expanded={showDetails}
          aria-label="Toggle wallet details"
          className="
            flex items-center gap-2 px-3 py-1.5 rounded-md
            bg-surface-recessed border border-border
            hover:border-border-strong transition-colors
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
          "
        >
          <span className="w-2 h-2 rounded-full bg-success flex-shrink-0" aria-hidden="true" />
          <span className="text-xs font-mono font-semibold text-foreground tabular-nums">
            {wallet.accountId}
          </span>
          {wallet.balance && (
            <>
              <span
                className="text-foreground-subtle leading-none -mx-0.5 select-none"
                aria-hidden="true"
                style={{ transform: 'translateY(-1px)' }}
              >·</span>
              <span className="text-xs text-success-soft-fg font-semibold tabular-nums">
                {wallet.balance}
              </span>
            </>
          )}
          <Caret open={showDetails} />
        </button>

        {/* Expandable details panel */}
        {showDetails && (
          <div
            role="dialog"
            aria-label="Wallet details"
            className="
              absolute right-0 top-full mt-2 w-80 z-50
              bg-surface border border-border rounded-md shadow-lg
              p-4 animate-slide-down
            "
          >
            <dl className="space-y-3 text-xs">
              <div>
                <dt className="text-foreground-subtle uppercase tracking-wider mb-1">Account</dt>
                <dd className="font-mono text-foreground tabular-nums">{wallet.accountId}</dd>
              </div>
              {wallet.publicKeyType && (
                <div>
                  <dt className="text-foreground-subtle uppercase tracking-wider mb-1">Key type</dt>
                  <dd className="font-mono text-accent-soft-fg">{wallet.publicKeyType}</dd>
                </div>
              )}
              {wallet.publicKey && (
                <div>
                  <dt className="text-foreground-subtle uppercase tracking-wider mb-1">Public key</dt>
                  <dd className="font-mono text-foreground break-all">
                    {wallet.publicKey.substring(0, 24)}…{wallet.publicKey.substring(wallet.publicKey.length - 12)}
                  </dd>
                  <button
                    onClick={handleCopyPublicKey}
                    className="mt-1 text-xs text-accent hover:underline"
                  >
                    {copied ? 'Copied!' : 'Copy full key'}
                  </button>
                </div>
              )}
              {wallet.evmAddress && (
                <div>
                  <dt className="text-foreground-subtle uppercase tracking-wider mb-1">EVM address</dt>
                  <dd className="font-mono text-foreground break-all">
                    {wallet.evmAddress.substring(0, 14)}…{wallet.evmAddress.substring(wallet.evmAddress.length - 8)}
                  </dd>
                </div>
              )}
            </dl>
            <button
              onClick={handleConnectClick}
              className="
                mt-4 w-full px-3 py-2 rounded-md text-xs font-medium
                text-destructive border border-destructive/30
                hover:bg-destructive-soft transition-colors
              "
            >
              Disconnect wallet
            </button>
          </div>
        )}
      </div>

      <WalletSelectionDialog open={showWalletDialog} onClose={() => setShowWalletDialog(false)} />
    </>
  );
}

function WalletButton({ mobile }: { mobile?: boolean }) {
  const wallet = useWallet();
  const [showWalletDialog, setShowWalletDialog] = useState(false);

  const handleClick = async () => {
    if (wallet.isConnected) await wallet.disconnect();
    else setShowWalletDialog(true);
  };

  return (
    <>
      <button
        onClick={handleClick}
        disabled={wallet.isConnecting}
        className={`
          ${mobile ? 'w-full px-4 py-3' : 'px-4 py-2'}
          inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors
          ${wallet.isConnected
            ? 'bg-destructive-soft text-destructive-soft-fg hover:bg-destructive hover:text-accent-fg'
            : 'bg-accent text-accent-fg hover:bg-accent-hover'}
          disabled:opacity-50 disabled:cursor-not-allowed
        `}
      >
        {wallet.isConnecting && <Spinner />}
        {wallet.isConnecting ? 'Connecting…' : wallet.isConnected ? 'Disconnect' : 'Connect Wallet'}
      </button>
      <WalletSelectionDialog open={showWalletDialog} onClose={() => setShowWalletDialog(false)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Inline icons — kept tight + stroke-based; consistent with RegisterToggle.
// ---------------------------------------------------------------------------

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

function Spinner() {
  return (
    <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden="true" />
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-foreground-subtle transition-transform ${open ? 'rotate-180' : ''}`}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
