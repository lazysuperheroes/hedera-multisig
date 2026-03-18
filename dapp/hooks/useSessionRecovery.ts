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

export function useSessionRecovery() {
  const [savedSession, setSavedSession] = useState<SessionState | null>(null);
  const [hasCheckedStorage, setHasCheckedStorage] = useState(false);

  /**
   * Load saved session from localStorage
   */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const session = JSON.parse(saved);

        // Migrate legacy sessions that stored PIN: remove PIN, invalidate
        if (session.pin && !session.reconnectionToken) {
          localStorage.removeItem(STORAGE_KEY);
          setHasCheckedStorage(true);
          return;
        }

        // Check if session is still valid (not expired)
        const age = Date.now() - session.timestamp;
        if (age < MAX_SESSION_AGE && session.reconnectionToken) {
          // Strip any accidentally stored PIN from legacy data
          const { pin, ...cleanSession } = session;
          setSavedSession(cleanSession as SessionState);
        } else {
          // Session expired, clear it
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch (error) {
      console.error('Failed to load saved session:', error);
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setHasCheckedStorage(true);
    }
  }, []);

  /**
   * Save current session to localStorage
   * Note: PIN should never be passed here. Use reconnectionToken from AUTH_SUCCESS.
   */
  const saveSession = useCallback((session: Omit<SessionState, 'timestamp'>) => {
    try {
      // Ensure PIN is never stored
      const { pin, ...safeSession } = session as any;

      const sessionWithTimestamp: SessionState = {
        ...safeSession,
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
        const session = JSON.parse(current);
        // Strip PIN from updates too
        const { pin, ...safeUpdates } = updates as any;

        const updated: SessionState = {
          ...session,
          ...safeUpdates,
          timestamp: Date.now(),
        };
        // Remove any legacy PIN that might exist
        delete (updated as any).pin;

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
