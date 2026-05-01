'use client';

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/**
 * Register controls the entire aesthetic register, not just colors:
 *  - "treasury" — calm/precise/trustworthy. Heebo + Unbounded. Light-default.
 *  - "dev"      — sharp/technical/confident. Geist + acid-lime accent. Dark-only.
 *
 * The register switch is the differentiator — it swaps tokens, fonts,
 * and motion budget. Dev register forces dark resolved-theme regardless of
 * the user's light/dark setting.
 */
export type Register = 'treasury' | 'dev';

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
  value === 'treasury' || value === 'dev';

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');
  const [register, setRegisterState] = useState<Register>('treasury');
  const [mounted, setMounted] = useState(false);

  const themeRef = useRef<Theme>(theme);
  const registerRef = useRef<Register>(register);
  useEffect(() => { themeRef.current = theme; }, [theme]);
  useEffect(() => { registerRef.current = register; }, [register]);

  const getSystemTheme = (): ResolvedTheme => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  const resolveTheme = (themeSetting: Theme, reg: Register): ResolvedTheme => {
    // Dev register forces dark — terminal/punk has no light variant
    if (reg === 'dev') return 'dark';
    if (themeSetting === 'system') return getSystemTheme();
    return themeSetting;
  };

  const applyState = (resolved: ResolvedTheme, reg: Register) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.setAttribute('data-register', reg);
    setResolvedTheme(resolved);
  };

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    try { localStorage.setItem('theme', newTheme); } catch {}
    applyState(resolveTheme(newTheme, registerRef.current), registerRef.current);
  };

  const setRegister = (newRegister: Register) => {
    setRegisterState(newRegister);
    try { localStorage.setItem('register', newRegister); } catch {}
    applyState(resolveTheme(themeRef.current, newRegister), newRegister);
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

    // Hydration setState: this is the canonical "synchronize state with an
    // external system" pattern (localStorage + window.matchMedia, neither of
    // which exist on the server). Single render after mount, then steady-state.
    setThemeState(initialTheme);
    setRegisterState(initialRegister);
    themeRef.current = initialTheme;
    registerRef.current = initialRegister;
    applyState(resolveTheme(initialTheme, initialRegister), initialRegister);
    setMounted(true);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (themeRef.current === 'system' && registerRef.current === 'treasury') {
        applyState(getSystemTheme(), registerRef.current);
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
    // resolveTheme + applyState are stable closures over refs; safe to omit.
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
