'use client';

/**
 * StepProgress — compact horizontal breadcrumb. Replaces the previous
 * blocky big-circle-and-rail wizard chrome with a single thin row:
 *
 *   01 Connect ✓ · 02 Build · 03 Share        (treasury)
 *   01 connect ✓ → 02 build → 03 share        (console — terminal cadence)
 *
 * Mono-prefix numbers, sentence-case labels, semantic colors per state
 * (active = accent, done = success + check icon, pending = subtle).
 * The treasury middle-dot and console arrow swap via treasury-label /
 * console-label so each register has its own idiom for "next step."
 */

import { Icon } from './Icon';

interface Step {
  key: string;
  label: string;
}

interface StepProgressProps {
  steps: Step[];
  currentIndex: number;
}

export function StepProgress({ steps, currentIndex }: StepProgressProps) {
  return (
    <nav aria-label="Progress" className="step-progress">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {steps.map((s, i) => {
          const isActive = i === currentIndex;
          const isDone = i < currentIndex;
          const isLast = i === steps.length - 1;

          return (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className={`font-mono text-xs tabular-nums ${
                  isActive
                    ? 'text-accent'
                    : isDone
                    ? 'text-success'
                    : 'text-foreground-subtle'
                }`}
                aria-hidden="true"
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <span
                className={
                  isActive
                    ? 'text-foreground font-medium'
                    : isDone
                    ? 'text-foreground-muted'
                    : 'text-foreground-subtle'
                }
                aria-current={isActive ? 'step' : undefined}
              >
                {s.label}
              </span>
              {isDone && (
                <Icon name="check" size={14} className="text-success" />
              )}
              {!isLast && (
                <span className="text-foreground-subtle mx-1" aria-hidden="true">
                  <span className="treasury-label">·</span>
                  <span className="console-label">→</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
