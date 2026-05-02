'use client';

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/**
 * Register controls the entire aesthetic register, not just colors:
 *  - "treasury" — calm/precise/trustworthy. Heebo + Unbounded.
 *  - "console"  — sharp/technical/confident. Geist mono. Punk-terminal.
 *
 * Theme and register are INDEPENDENT axes. All 6 combinations are valid:
 *   treasury × {light, dark, auto}  +  console × {light, dark, auto}
 *
 * Console doesn't force dark — a console-light "paper terminal" palette is
 * defined in globals.css alongside console-dark.
 */
export type Register = 'treasury' | 'console';

export interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  register: Register;
  setRegister: (register: Register) => void;
}

const isValidTheme = (value: string | null): value is Theme =>
  value === 'light' || value === 'dark' || value === 'system';

const isValidRegister = (value: string | null): value is Register =>
  value === 'treasury' || value === 'console';

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');
  const [register, setRegisterState] = useState<Register>('treasury');
  const [mounted, setMounted] = useState(false);

  // Refs track the LATEST committed values so cross-axis setters don't
  // race against React's deferred ref-sync useEffects. Updated synchronously
  // inside applyAll() — never via a separate effect.
  const themeRef = useRef<Theme>(theme);
  const registerRef = useRef<Register>(register);

  const getSystemTheme = (): ResolvedTheme => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  const resolveTheme = (themeSetting: Theme): ResolvedTheme => {
    if (themeSetting === 'system') return getSystemTheme();
    return themeSetting;
  };

  /**
   * Atomically apply both axes. The previous bug: setRegister+setTheme called
   * back-to-back each ran their own applyState off stale refs, overwriting
   * each other. Now every axis change goes through applyAll which writes
   * BOTH attributes + classes + refs + storage in one synchronous block.
   */
  const applyAll = (nextTheme: Theme, nextRegister: Register) => {
    const resolved = resolveTheme(nextTheme);
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.setAttribute('data-register', nextRegister);

    // Update refs synchronously so the next call (if any) reads fresh values.
    themeRef.current = nextTheme;
    registerRef.current = nextRegister;

    setThemeState(nextTheme);
    setRegisterState(nextRegister);
    setResolvedTheme(resolved);

    try { localStorage.setItem('theme', nextTheme); } catch {}
    try { localStorage.setItem('register', nextRegister); } catch {}
  };

  const setTheme = (newTheme: Theme) => {
    applyAll(newTheme, registerRef.current);
  };

  const setRegister = (newRegister: Register) => {
    applyAll(themeRef.current, newRegister);
  };

  useEffect(() => {
    let storedTheme: string | null = null;
    let storedRegister: string | null = null;
    try {
      storedTheme = localStorage.getItem('theme');
      storedRegister = localStorage.getItem('register');
    } catch {}

    const initialTheme: Theme = isValidTheme(storedTheme) ? storedTheme : 'system';
    const initialRegister: Register = isValidRegister(storedRegister) ? storedRegister : 'treasury';

    applyAll(initialTheme, initialRegister);
    setMounted(true);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (themeRef.current === 'system') {
        const resolved = getSystemTheme();
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(resolved);
        setResolvedTheme(resolved);
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
    // applyAll is a stable closure over refs; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mounted) {
    return (
      <ThemeContext.Provider value={{
        theme: 'system', resolvedTheme: 'light', setTheme,
        register: 'treasury', setRegister,
      }}>
        {children}
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, register, setRegister }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
