/**
 * useFocusTrap — keyboard focus management for modal dialogs.
 *
 * When `active` is true:
 *  - Stores `document.activeElement` so focus can be restored on close.
 *  - Moves focus into the container (first focusable child, or the
 *    container itself if none).
 *  - Wraps Tab / Shift-Tab so focus cycles within the container —
 *    the user cannot Tab out of an open modal into background page
 *    content (WCAG 2.4.3 Focus Order).
 *  - On unmount / deactivation, restores focus to the previously
 *    focused element.
 *
 * Pure React; no dependencies.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useFocusTrap(ref, isOpen);
 *   return <div ref={ref} role="dialog" aria-modal="true">...</div>;
 */

'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean
): void {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    // Stash the previously focused element so we can restore it.
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    // Move focus into the container.
    const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const first = focusables[0] || container;
    // Use rAF so the container is fully painted before we focus
    requestAnimationFrame(() => {
      first.focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const items = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }

      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        // Shift-Tab on first → wrap to last
        if (activeEl === firstItem || !container.contains(activeEl)) {
          e.preventDefault();
          lastItem.focus();
        }
      } else {
        // Tab on last → wrap to first
        if (activeEl === lastItem) {
          e.preventDefault();
          firstItem.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      // Restore focus
      const previous = previouslyFocusedRef.current;
      if (previous && typeof previous.focus === 'function') {
        previous.focus();
      }
    };
  }, [active, ref]);
}
