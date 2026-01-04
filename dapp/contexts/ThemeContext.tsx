'use client';

import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';

// Exported types for external use
export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

// Type guard for localStorage validation
const isValidTheme = (value: string | null): value is Theme =>
  value === 'light' || value === 'dark' || value === 'system';

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');
  const [mounted, setMounted] = useState(false);

  // Track theme with ref for event listener (avoids stale closure)
  const themeRef = useRef<Theme>(theme);
  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  // Get system preference
  const getSystemTheme = (): ResolvedTheme => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  // Resolve theme based on setting
  const resolveTheme = (themeSetting: Theme): ResolvedTheme => {
    if (themeSetting === 'system') {
      return getSystemTheme();
    }
    return themeSetting;
  };

  // Apply theme to document
  const applyTheme = (resolved: ResolvedTheme) => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    setResolvedTheme(resolved);
  };

  // Set theme and persist
  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
    applyTheme(resolveTheme(newTheme));
  };

  // Initialize on mount
  useEffect(() => {
    const stored = localStorage.getItem('theme');
    const initialTheme: Theme = isValidTheme(stored) ? stored : 'system';
    setThemeState(initialTheme);
    themeRef.current = initialTheme;
    applyTheme(resolveTheme(initialTheme));
    setMounted(true);

    // Listen for system preference changes (uses ref to avoid stale closure)
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (themeRef.current === 'system') {
        applyTheme(getSystemTheme());
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <ThemeContext.Provider value={{ theme: 'system', resolvedTheme: 'light', setTheme }}>
        {children}
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
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
