/**
 * RegisterToggle — flips the aesthetic register between Treasury and Console.
 * Independent of light/dark/auto theme (which is owned by ThemeToggle).
 *
 * - Treasury (default): calm/precise/trustworthy. Heebo + Unbounded.
 * - Console: sharp/technical/confident. Geist mono. Punk-terminal.
 */

'use client';

import { useTheme } from '../contexts/ThemeContext';

export function RegisterToggle() {
  const { register, setRegister } = useTheme();

  const toggle = () => {
    setRegister(register === 'treasury' ? 'console' : 'treasury');
  };

  const meta = register === 'treasury'
    ? {
        label: 'Treasury',
        tooltip:
          'Register: Treasury — calm financial view. Two modes available; click to switch to Console (engineer/power-user view with mono type, denser layout, terminal grammar, and a streaming connection log).',
        icon: <SerifTIcon />,
      }
    : {
        label: 'Console',
        tooltip:
          'Register: Console — engineer/power-user view. Click to switch back to Treasury (the calm financial-app view).',
        icon: <TerminalIcon />,
      };

  return (
    <button
      onClick={toggle}
      className="
        inline-flex items-center gap-2 px-3 py-2 rounded-md
        text-foreground-muted hover:text-foreground hover:bg-surface-recessed
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
        transition-colors
      "
      title={meta.tooltip}
      aria-label={`Register: ${meta.label}. Click to switch.`}
      aria-pressed={register === 'console'}
    >
      <span key={register} className="inline-flex animate-register-flash" aria-hidden="true">
        {meta.icon}
      </span>
      <span className="text-xs font-medium hidden lg:inline">{meta.label}</span>
    </button>
  );
}

function SerifTIcon() {
  // Stylised "T" with serifs — the "treasury / traditional" mark.
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 5h14" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}
