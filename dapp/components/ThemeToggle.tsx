/**
 * ThemeToggle — light / dark / auto cycle. Independent of register.
 *
 * Shows the current state's icon. Click cycles:
 *   Light  →  Dark  →  Auto (system)  →  Light
 */

'use client';

import { useTheme } from '../contexts/ThemeContext';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const cycle = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };

  const meta = (() => {
    switch (theme) {
      case 'light':
        return { label: 'Light', tooltip: 'Theme: Light. Click for Dark.', icon: <SunIcon /> };
      case 'dark':
        return { label: 'Dark', tooltip: 'Theme: Dark. Click for Auto.', icon: <MoonIcon /> };
      case 'system':
        return { label: 'Auto', tooltip: 'Theme: Auto (follows OS). Click for Light.', icon: <AutoIcon /> };
    }
  })();

  return (
    <button
      onClick={cycle}
      className="
        inline-flex items-center gap-2 px-3 py-2 rounded-md
        text-foreground-muted hover:text-foreground hover:bg-surface-recessed
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
        transition-colors
      "
      title={meta.tooltip}
      aria-label={`Theme: ${meta.label}. Click to switch.`}
    >
      <span key={theme} className="inline-flex animate-register-flash" aria-hidden="true">
        {meta.icon}
      </span>
      <span className="text-xs font-medium hidden lg:inline">{meta.label}</span>
    </button>
  );
}

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

function AutoIcon() {
  // "Half-and-half" sun/moon — the standard "system theme" mark
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}
