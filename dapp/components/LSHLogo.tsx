/**
 * LSHLogo — the Lazy Superheroes wordmark.
 *
 * Two contexts:
 *   <LSHLogo variant="lockup" />   — full lock-up for NavBar (wordmark + "MultiSig")
 *   <LSHLogo variant="attribution" /> — small "by Lazy Superheroes" footer mark in LAZY Gold
 *
 * Theme handling: the canonical LSH wordmark has a dark variant (logo.svg)
 * and a light variant (logo-light.svg) on docs.lazysuperheroes.com. We pick
 * based on the current resolved theme. Next/Image is intentionally skipped
 * — these are external SVGs and we want zero layout shift.
 */

'use client';

import { useTheme } from '../contexts/ThemeContext';

const LOGO_DARK = 'https://docs.lazysuperheroes.com/logo.svg';
const LOGO_LIGHT = 'https://docs.lazysuperheroes.com/logo-light.svg';

interface LSHLogoProps {
  variant: 'lockup' | 'attribution';
  className?: string;
}

export function LSHLogo({ variant, className = '' }: LSHLogoProps) {
  const { resolvedTheme, register } = useTheme();
  // Logo file: dark variant goes on light backgrounds, light variant on dark
  const src = resolvedTheme === 'dark' ? LOGO_LIGHT : LOGO_DARK;

  if (variant === 'lockup') {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Lazy Superheroes"
          width={28}
          height={28}
          className="h-7 w-auto"
        />
        <div className="flex items-baseline gap-2 leading-none">
          <span className="font-heading text-base font-bold tracking-tight text-foreground">
            MultiSig
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-foreground-subtle treasury:hidden">
            {register === 'dev' ? 'dev' : ''}
          </span>
        </div>
      </div>
    );
  }

  // attribution
  return (
    <a
      href="https://lazysuperheroes.com"
      target="_blank"
      rel="noopener noreferrer"
      className={`group inline-flex items-center gap-2 text-foreground-subtle hover:text-foreground transition-colors ${className}`}
      aria-label="Made by Lazy Superheroes"
    >
      <span className="text-xs">
        {register === 'dev' ? 'made by' : 'Made by'}
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={16}
        height={16}
        className="h-4 w-auto opacity-80 group-hover:opacity-100 transition-opacity"
        aria-hidden="true"
      />
      <span
        className="text-xs font-semibold tracking-tight"
        style={{ color: 'var(--lsh-gold)' }}
      >
        {register === 'dev' ? 'lazy superheroes' : 'Lazy Superheroes'}
      </span>
      {/* Q2: terminal cursor blink in dev mode — turns the attribution
          into a tiny shell prompt, earns brand-family nod with character */}
      {register === 'dev' && (
        <span
          className="inline-block w-[7px] h-[14px] bg-current animate-cursor-blink"
          style={{ color: 'var(--lsh-gold)' }}
          aria-hidden="true"
        />
      )}
    </a>
  );
}
