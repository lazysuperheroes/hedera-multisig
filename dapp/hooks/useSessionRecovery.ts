/**
 * useSessionRecovery
 *
 * Hook for saving and recovering session state from localStorage.
 * Allows users to resume their signing session if they accidentally refresh the page.
 *
 * Saved state includes:
 * - Server URL
 * - Session ID
 * - Reconnection token (NOT the PIN - issued by server after successful AUTH)
 * - Participant ID (after successful AUTH)
 * - Account ID (from wallet)
 * - Public Key (from wallet)
 *
 * Security: The PIN is never stored in localStorage. After initial authentication,
 * the server issues a reconnection token that is scoped to the participant's session.
 */

import { useEffect, useState, useCallback } from 'react';

export interface SessionState {
  serverUrl: string;
  sessionId: string;
  reconnectionToken?: string;
  participantId?: string;
  accountId?: string;
  publicKey?: string;
  timestamp: number;
  /** @deprecated PIN is no longer stored. Use reconnectionToken instead. */
  pin?: never;
}

const STORAGE_KEY = 'hedera_multisig_active_session';
const MAX_SESSION_AGE = 30 * 60 * 1000; // 30 minutes

/**
 * Read the saved-session out of localStorage on first render.
 *
 * Originally this hook used a `useEffect` to read localStorage and a
 * `hasCheckedStorage` boolean to gate the page until the read landed —
 * which guaranteed at least one render with an empty/loading state
 * before the saved session could surface. Lazy `useState` initializers
 * run on the first render synchronously, so the page can show the
 * right thing on its very first paint instead of flickering through a
 * skeleton. SSR-safe via `typeof window` guard (this whole hook is
 * 'use client' but Next.js still bundles its initializer for the
 * server build).
 */
function readSavedSessionFromStorage(): SessionState | null {
  if (typeof window === 'undefined') return null;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const session = JSON.parse(saved);

    // Migrate legacy sessions that stored PIN: remove PIN, invalidate.
    if (session.pin && !session.reconnectionToken) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    // Check if session is still valid (not expired) and has the
    // reconnectionToken that's now mandatory for restore.
    const age = Date.now() - session.timestamp;
    if (age < MAX_SESSION_AGE && session.reconnectionToken) {
      const { pin, ...cleanSession } = session;
      void pin; // legacy field; explicitly discarded
      return cleanSession as SessionState;
    }

    // Session expired, clear it.
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  } catch (error) {
    console.error('Failed to load saved session:', error);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return null;
  }
}

export function useSessionRecovery() {
  // Synchronous read on first render — no useEffect, no skeleton flash.
  // hasCheckedStorage starts true because the read is already done.
  const [savedSession, setSavedSession] = useState<SessionState | null>(
    readSavedSessionFromStorage,
  );
  const [hasCheckedStorage] = useState(true);

  /**
   * Save current session to localStorage
   * Note: PIN should never be passed here. Use reconnectionToken from AUTH_SUCCESS.
   */
  const saveSession = useCallback((session: Omit<SessionState, 'timestamp'>) => {
    try {
      // Ensure PIN is never stored — strip any legacy field
      const safeSession: Record<string, unknown> = { ...(session as Record<string, unknown>) };
      delete safeSession.pin;

      const sessionWithTimestamp: SessionState = {
        ...(safeSession as Omit<SessionState, 'timestamp'>),
        timestamp: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionWithTimestamp));
      setSavedSession(sessionWithTimestamp);
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  }, []);

  /**
   * Update session (e.g., add participantId and reconnectionToken after AUTH)
   */
  const updateSession = useCallback((updates: Partial<Omit<SessionState, 'timestamp'>>) => {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) {
        const session = JSON.parse(current) as Record<string, unknown>;
        // Strip PIN from updates too
        const safeUpdates: Record<string, unknown> = { ...(updates as Record<string, unknown>) };
        delete safeUpdates.pin;

        const updated: SessionState = {
          ...(session as unknown as SessionState),
          ...(safeUpdates as Partial<SessionState>),
          timestamp: Date.now(),
        };
        // Remove any legacy PIN that might exist
        delete (updated as unknown as Record<string, unknown>).pin;

        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        setSavedSession(updated);
      }
    } catch (error) {
      console.error('Failed to update session:', error);
    }
  }, []);

  /**
   * Clear saved session
   */
  const clearSession = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setSavedSession(null);
    } catch (error) {
      console.error('Failed to clear session:', error);
    }
  }, []);

  /**
   * Check if session is still fresh (for auto-resume prompt)
   */
  const isSessionFresh = useCallback((): boolean => {
    if (!savedSession) return false;

    const age = Date.now() - savedSession.timestamp;
    return age < MAX_SESSION_AGE;
  }, [savedSession]);

  return {
    savedSession,
    hasCheckedStorage,
    saveSession,
    updateSession,
    clearSession,
    isSessionFresh,
  };
}
