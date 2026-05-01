/**
 * RegisterToggle — three-state cycle that swaps the entire aesthetic register.
 *
 *   Treasury Light  →  Treasury Dark  →  Dev (dark, terminal/punk)  →  Treasury Light
 *
 * The treasury states share a register (same fonts, same accent, same
 * density) and just toggle light/dark. The dev state is its own register
 * with different fonts, accent (acid lime), and density.
 *
 * This is the differentiator the brief calls for — see .impeccable.md
 * "Two registers, one product." The transition is one of the most
 * polished moments of the app: a brief register-flash animation + token
 * cross-fade.
 */

'use client';

import { useTheme, type Theme, type Register } from '../contexts/ThemeContext';

type RegisterState = 'treasury-light' | 'treasury-dark' | 'dev';

function deriveState(theme: Theme, resolvedTheme: 'light' | 'dark', register: Register): RegisterState {
  if (register === 'dev') return 'dev';
  // Treasury — use resolvedTheme so 'system' shows the actual rendered state
  return resolvedTheme === 'dark' ? 'treasury-dark' : 'treasury-light';
}

export function RegisterToggle() {
  const { theme, resolvedTheme, setTheme, register, setRegister } = useTheme();
  const state = deriveState(theme, resolvedTheme, register);

  const cycle = () => {
    if (state === 'treasury-light') {
      // → Treasury Dark
      setRegister('treasury');
      setTheme('dark');
    } else if (state === 'treasury-dark') {
      // → Dev (dark forced)
      setRegister('dev');
      setTheme('dark');
    } else {
      // dev → Treasury Light
      setRegister('treasury');
      setTheme('light');
    }
  };

  const meta = (() => {
    switch (state) {
      case 'treasury-light':
        return {
          label: 'Treasury · Light',
          short: 'Light',
          tooltip: 'Treasury · Light. Click for Treasury Dark.',
          icon: <SunIcon />,
        };
      case 'treasury-dark':
        return {
          label: 'Treasury · Dark',
          short: 'Dark',
          tooltip: 'Treasury · Dark. Click for Developer mode.',
          icon: <MoonIcon />,
        };
      case 'dev':
        return {
          label: 'Developer',
          short: 'Dev',
          tooltip: 'Developer mode (terminal). Click for Treasury Light.',
          icon: <TerminalIcon />,
        };
    }
  })();

  return (
    <button
      onClick={cycle}
      className="
        group inline-flex items-center gap-2 px-3 py-2 rounded-md
        text-foreground-muted hover:text-foreground
        hover:bg-surface-recessed
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
        transition-colors
      "
      title={meta.tooltip}
      aria-label={`Current mode: ${meta.label}. Click to switch.`}
    >
      <span
        key={state}
        className="inline-flex animate-register-flash"
        aria-hidden="true"
      >
        {meta.icon}
      </span>
      <span className="text-xs font-medium hidden md:inline">
        {meta.short}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Icons — kept inline + minimal so the toggle never blocks on icon-font load
// ---------------------------------------------------------------------------

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function TerminalIcon() {
  // Punk-terminal moment: a literal `>_` mark
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}
