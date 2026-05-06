/**
 * Coordinator-side mirror-node polling.
 *
 * The CLI server's executeTransaction() runs three sequential phases inside
 * a single ~25s window — submit, await receipt, poll mirror — and only
 * broadcasts a single TRANSACTION_EXECUTED at the end. From the dApp's
 * perspective the state badge is stuck on "Executing on Hedera" the whole
 * time with no progress signal.
 *
 * This hook closes that gap. Once the threshold is met (and we have a
 * transactionId from the injection), it:
 *   1. Waits ~3s for the server to submit (gives the network a chance to
 *      see the transaction before we start polling — avoids hammering
 *      the mirror with 404s while the tx is still in-flight to a node).
 *   2. Polls `fetchTransactionStatus(txId, network)` every 3s for up to
 *      ~30s.
 *   3. Stops as soon as the mirror returns a result (success OR failure
 *      code from Hedera), or signals a timeout if nothing landed in the
 *      polling window.
 *
 * Independent of the server's TRANSACTION_EXECUTED broadcast: even if the
 * server crashes mid-execute, the dApp can still report what the network
 * actually did.
 */

import { useEffect, useState, useRef } from 'react';
import { fetchTransactionStatus, type TransactionStatus } from '../lib/mirror-node';

export type MirrorPollPhase =
  | 'idle'
  | 'submitting'
  | 'polling'
  | 'confirmed'
  | 'timed-out';

export interface MirrorPollState {
  phase: MirrorPollPhase;
  attempt: number;
  maxAttempts: number;
  elapsedMs: number;
  result: TransactionStatus | null;
}

const POLL_INTERVAL_MS = 3000;
// 10 attempts × 3s = ~30s polling window after a 3s pre-delay = ~33s total.
// Comfortably longer than the server's own poll budget (~24s) so the dApp
// can report network state even if the server's poll already gave up.
const MAX_ATTEMPTS = 10;
const PRE_POLL_DELAY_MS = 3000;
const ELAPSED_TICK_MS = 500;

export function useMirrorPoll({
  txId,
  network,
  enabled,
}: {
  txId: string | null;
  network: 'testnet' | 'mainnet';
  enabled: boolean;
}): MirrorPollState {
  const [state, setState] = useState<MirrorPollState>({
    phase: 'idle',
    attempt: 0,
    maxAttempts: MAX_ATTEMPTS,
    elapsedMs: 0,
    result: null,
  });

  const startedAtRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cancel guard: if `txId` changes (re-injection / reset), abandon
  // in-flight async work that belongs to the prior tx.
  const reqIdRef = useRef(0);

  useEffect(() => {
    const cleanup = () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current);
        elapsedIntervalRef.current = null;
      }
      if (initialDelayRef.current) {
        clearTimeout(initialDelayRef.current);
        initialDelayRef.current = null;
      }
    };

    if (!enabled || !txId || txId === 'unknown') {
      cleanup();
      // Reset to idle when the hook becomes disabled (txId changed, or
      // gating dep flipped). This is the canonical React pattern for
      // syncing state from prop changes — the lint rule's blanket warning
      // doesn't apply to deliberate resets like this.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({
        phase: 'idle',
        attempt: 0,
        maxAttempts: MAX_ATTEMPTS,
        elapsedMs: 0,
        result: null,
      });
      return cleanup;
    }

    const myReqId = ++reqIdRef.current;
    startedAtRef.current = Date.now();
    setState({
      phase: 'submitting',
      attempt: 0,
      maxAttempts: MAX_ATTEMPTS,
      elapsedMs: 0,
      result: null,
    });

    elapsedIntervalRef.current = setInterval(() => {
      if (myReqId !== reqIdRef.current) return;
      if (startedAtRef.current) {
        setState((prev) => ({
          ...prev,
          elapsedMs: Date.now() - startedAtRef.current!,
        }));
      }
    }, ELAPSED_TICK_MS);

    let attemptCount = 0;
    const poll = async () => {
      if (myReqId !== reqIdRef.current) return;
      attemptCount += 1;
      setState((prev) => ({ ...prev, phase: 'polling', attempt: attemptCount }));

      try {
        const status = await fetchTransactionStatus(txId, network);
        if (myReqId !== reqIdRef.current) return;

        if (status.found) {
          setState((prev) => ({
            ...prev,
            phase: 'confirmed',
            result: status,
          }));
          cleanup();
          return;
        }
        if (attemptCount >= MAX_ATTEMPTS) {
          setState((prev) => ({ ...prev, phase: 'timed-out' }));
          cleanup();
        }
      } catch {
        // Transient mirror errors — keep polling.
        if (attemptCount >= MAX_ATTEMPTS) {
          if (myReqId !== reqIdRef.current) return;
          setState((prev) => ({ ...prev, phase: 'timed-out' }));
          cleanup();
        }
      }
    };

    initialDelayRef.current = setTimeout(() => {
      if (myReqId !== reqIdRef.current) return;
      poll();
      pollIntervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    }, PRE_POLL_DELAY_MS);

    return cleanup;
  }, [enabled, txId, network]);

  return state;
}
