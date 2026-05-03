/**
 * useOnboarding — React hook over lib/onboarding.ts.
 *
 * Exposes current state + actions. Auto-syncs across components via the
 * 'lsh-onboarding-changed' event so toggling on one component (dismiss
 * a prompt, increment visits) updates anywhere else reading the state.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  loadOnboarding,
  subscribeOnboarding,
  bumpVisit as bump,
  markTriedConsole as mark,
  dismissPrompt as dismiss,
  isDismissed,
  type OnboardingState,
} from '../lib/onboarding';

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>(() => loadOnboarding());

  useEffect(() => {
    // Re-load on mount in case the SSR render gave defaults — same
    // hydration setState pattern as ThemeContext (localStorage isn't
    // available on the server, so we sync after mount).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(loadOnboarding());
    return subscribeOnboarding(setState);
  }, []);

  const bumpVisitOnce = useCallback(() => {
    setState(bump());
  }, []);

  const markTriedConsole = useCallback(() => {
    setState(mark());
  }, []);

  const dismissPrompt = useCallback((id: string) => {
    setState(dismiss(id));
  }, []);

  return {
    state,
    bumpVisit: bumpVisitOnce,
    markTriedConsole,
    dismissPrompt,
    isDismissed: (id: string) => isDismissed(state, id),
  };
}
