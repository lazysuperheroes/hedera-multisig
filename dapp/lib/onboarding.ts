/**
 * Onboarding state — tracks visit count, dismissed prompts, and whether
 * the user has tried Console mode at least once. Stored in localStorage
 * under `lsh.onboarding` as a single JSON blob.
 *
 * Used to:
 *  - Show the "How this works" intro callout once, then hide after dismiss.
 *  - Surface a "Try Console mode" banner on the 3rd+ visit if the user
 *    hasn't tried it yet — gentle invitation, never auto-suggested.
 *  - Emit a welcome ConsoleLog entry the first time register=console.
 *
 * SSR-safe — every reader uses defaults when window is undefined.
 */

const STORAGE_KEY = 'lsh.onboarding';

export interface OnboardingState {
  visits: number;
  firstVisitAt: number;
  triedConsole: boolean;
  dismissed: string[];
}

const DEFAULTS: OnboardingState = {
  visits: 0,
  firstVisitAt: 0,
  triedConsole: false,
  dismissed: [],
};

const SUBSCRIBE_EVENT = 'lsh-onboarding-changed';

export function loadOnboarding(): OnboardingState {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<OnboardingState>;
    return {
      visits: typeof parsed.visits === 'number' ? parsed.visits : 0,
      firstVisitAt: typeof parsed.firstVisitAt === 'number' ? parsed.firstVisitAt : 0,
      triedConsole: parsed.triedConsole === true,
      dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed : [],
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveOnboarding(state: OnboardingState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(SUBSCRIBE_EVENT, { detail: state }));
  } catch {}
}

/** Increment visit counter. Called once per landing-page mount. */
export function bumpVisit(): OnboardingState {
  const s = loadOnboarding();
  s.visits += 1;
  if (!s.firstVisitAt) s.firstVisitAt = Date.now();
  saveOnboarding(s);
  return s;
}

/** Mark Console as tried. Idempotent. */
export function markTriedConsole(): OnboardingState {
  const s = loadOnboarding();
  if (s.triedConsole) return s;
  s.triedConsole = true;
  saveOnboarding(s);
  return s;
}

/** Add a prompt ID to the dismissed list. Idempotent. */
export function dismissPrompt(id: string): OnboardingState {
  const s = loadOnboarding();
  if (s.dismissed.includes(id)) return s;
  s.dismissed = [...s.dismissed, id];
  saveOnboarding(s);
  return s;
}

export function isDismissed(state: OnboardingState, id: string): boolean {
  return state.dismissed.includes(id);
}

/** Subscribe to changes. Returns unsubscribe fn. */
export function subscribeOnboarding(handler: (state: OnboardingState) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const wrapper = (e: Event) => {
    const ce = e as CustomEvent<OnboardingState>;
    handler(ce.detail);
  };
  window.addEventListener(SUBSCRIBE_EVENT, wrapper);
  return () => window.removeEventListener(SUBSCRIBE_EVENT, wrapper);
}
