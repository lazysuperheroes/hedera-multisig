/**
 * Icon — Material Symbols Outlined wrapper.
 *
 * LSH umbrella standard. Use this instead of inline SVG for any
 * functional icon (paste, copy, scan, check, close, terminal, info,
 * warning). Decorative-only marks (corner brackets, branded shapes)
 * may stay as inline SVG.
 *
 * Reference: https://fonts.google.com/icons
 *
 * Usage:
 *   <Icon name="check" />
 *   <Icon name="warning" size={24} weight={500} grade={0} fill={0} />
 *
 * The Material Symbols variable font is loaded from layout.tsx via a
 * stylesheet link. The font supports four axes:
 *   - size  (20..48)  — visually balanced at the chosen px size
 *   - weight (100..700) — stroke weight; 400 default
 *   - grade (-50..200) — emphasis adjustment for dark backgrounds
 *   - fill  (0 or 1)  — outline (0) vs filled (1)
 */

import type { CSSProperties } from 'react';

interface IconProps {
  name: string;
  size?: number;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700;
  fill?: 0 | 1;
  grade?: -25 | 0 | 200;
  className?: string;
  style?: CSSProperties;
  ariaHidden?: boolean;
  ariaLabel?: string;
}

export function Icon({
  name,
  size = 20,
  weight = 400,
  fill = 0,
  grade = 0,
  className = '',
  style,
  ariaHidden = true,
  ariaLabel,
}: IconProps) {
  return (
    <span
      className={`material-symbols-outlined inline-flex items-center justify-center select-none leading-none ${className}`}
      style={{
        fontSize: `${size}px`,
        width: `${size}px`,
        height: `${size}px`,
        fontVariationSettings: `'FILL' ${fill}, 'wght' ${weight}, 'GRAD' ${grade}, 'opsz' ${Math.max(20, Math.min(48, size))}`,
        ...style,
      }}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
    >
      {name}
    </span>
  );
}
