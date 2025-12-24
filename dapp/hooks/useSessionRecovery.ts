/**
 * useSessionRecovery
 *
 * Hook for saving and recovering session state from localStorage.
 * Allows users to resume their signing session if they accidentally refresh the page.
 *
 * Saved state includes:
 * - Server URL
 * - Session ID
 * - PIN
 * - Participant ID (after successful AUTH)
 * - Account ID (from wallet)
 * - Public Key (from wallet)
 */

import { useEffect, useState, useCallback } from 'react';

export interface SessionState {
  serverUrl: string;
  sessionId: string;
  pin: string;
  participantId?: string;
  accountId?: string;
  publicKey?: string;
  timestamp: number;
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
        const session: SessionState = JSON.parse(saved);

        // Check if session is still valid (not expired)
        const age = Date.now() - session.timestamp;
        if (age < MAX_SESSION_AGE) {
          setSavedSession(session);
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
   */
  const saveSession = useCallback((session: Omit<SessionState, 'timestamp'>) => {
    try {
      const sessionWithTimestamp: SessionState = {
        ...session,
        timestamp: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionWithTimestamp));
      setSavedSession(sessionWithTimestamp);
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  }, []);

  /**
   * Update session (e.g., add participantId after AUTH)
   */
  const updateSession = useCallback((updates: Partial<Omit<SessionState, 'timestamp'>>) => {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) {
        const session: SessionState = JSON.parse(current);
        const updated: SessionState = {
          ...session,
          ...updates,
          timestamp: Date.now(),
        };
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
