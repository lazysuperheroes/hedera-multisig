'use client';

/**
 * SessionMonitor
 *
 * Live, read-only status panel for the coordinator. Subscribes to the WS
 * connection that the coordinator already has open from /create — no wallet,
 * no navigation, no second connection. Renders as participants join, become
 * ready, sign, and the network executes.
 *
 * Replaces the previous "Open Session Monitor" button that linked to
 * /session/[id], which is the participant-signing page and forces a wallet
 * connection the coordinator doesn't need.
 */

import { useEffect, useState } from 'react';
import { updateTxHistoryEntryStatus } from '../../hooks/useTxHistory';
import { useMirrorPoll } from '../../hooks/useMirrorPoll';
import type { ServerParticipant } from '../../hooks/useCoordinatorConnection';

interface SessionMonitorProps {
  /** State-tracked WebSocket so the subscription effect re-runs as soon
   * as the connection becomes live. Using a ref here was a long-running
   * footgun: useEffect doesn't re-fire on `.current` mutations, so when
   * the monitor mounted before the WS handshake completed the listener
   * silently never attached — masquerading as "no participants" /
   * "missing reset button". */
  ws: WebSocket | null;
  /** Imperative ref kept for code that needs to send + await a reply
   * inline (the reset button). Both target the same WebSocket; only the
   * subscription path uses `ws` so React tracks it. */
  wsRef?: React.MutableRefObject<WebSocket | null>;
  threshold: number;
  expectedParticipants: number;
  network: 'testnet' | 'mainnet';
  /** Called when the server confirms a TRANSACTION_RESET broadcast — the
   * page should clear local form state and route back to the build step. */
  onTransactionReset?: () => void;
  /** Server-reported session status at mount time. Lets the monitor reflect
   * an in-flight transaction the user reconnected to (rather than starting
   * from a stale 'waiting' default that would hide the reset button). */
  initialSessionStatus?: string;
  /** Participants already on the session at AUTH time. Lets the monitor
   * show alice + bob even if they connected before the coordinator opened
   * `/create`. Live broadcasts only carry future events. */
  initialParticipants?: ServerParticipant[];
  /** Lift the monitor's live state up to the page so siblings (notably
   * ShareStep) can switch their layout based on session phase. Fires
   * after every internal state update with a copy of the externally-
   * useful subset. */
  onStateChange?: (state: SessionLiveState) => void;
}

export type SessionLivePhase =
  | 'signing'   // injected, signatures coming in
  | 'completed' // executed + (optionally) mirror-confirmed
  | 'failed'    // execution-failed or expired
  | 'idle';     // pre-injection / between transactions

export interface SessionLiveSigner {
  participantId: string;
  label: string;
  status: 'connected' | 'ready' | 'signed' | 'rejected' | 'disconnected';
  isAgent: boolean;
}

export interface SessionLiveState {
  phase: SessionLivePhase;
  signers: SessionLiveSigner[];
  signaturesCollected: number;
  thresholdMet: boolean;
  transactionId: string | null;
  mirrorConfirmed: boolean;
  failureReason: string | null;
  freezeStrategy: string | null;
  freezeNodeCount: number | null;
  frozenTxBytes: number | null;
}

/** Map server-reported participant status to the monitor's pill vocabulary. */
function participantStatusToMonitor(
  status: string | undefined
): 'connected' | 'ready' | 'signed' | 'rejected' | 'disconnected' {
  switch (status) {
    case 'ready':
    case 'signing':
      return 'ready';
    case 'signed':
      return 'signed';
    case 'rejected':
      return 'rejected';
    case 'disconnected':
      return 'disconnected';
    case 'connected':
    default:
      return 'connected';
  }
}

type SessionState =
  | 'waiting'
  | 'received'
  | 'signing'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'expired';

interface MonitorParticipant {
  participantId: string;
  label: string;
  isAgent: boolean;
  status: 'connected' | 'ready' | 'signed' | 'rejected' | 'disconnected';
}

interface SignatureRejection {
  participantId: string;
  label: string;
  message: string;
  at: number;
}

interface MonitorState {
  participants: Record<string, MonitorParticipant>;
  signaturesCollected: number;
  thresholdMet: boolean;
  sessionState: SessionState;
  transactionId: string | null;
  mirrorConfirmed: boolean;
  failureReason: string | null;
  /** Most recent signature rejections (capped). Surfaces server-side
   * verification failures the participant CLI alone wouldn't visualize. */
  signatureRejections: SignatureRejection[];
  /** Captured from TRANSACTION_RECEIVED so the dApp can poll the mirror
   * node itself once threshold is met (independent of the server's own
   * post-execute broadcast). */
  pollingTxId: string | null;
  /** Multi-sig freeze metadata for the audit trail. Captured from the
   * server's TRANSACTION_RECEIVED broadcast — the dApp coordinator
   * forwards `nodeStrategy` + `nodeCount` in `metadata.customFields`,
   * the server stores them on the session, and any reconnecting
   * coordinator gets the same numbers. */
  freezeStrategy: string | null;
  freezeNodeCount: number | null;
  /** Actual size of the frozen tx (bytes), computed from the base64
   * payload. Lets the audit trail show "actual 2,418 B" alongside the
   * estimator's pre-injection prediction. */
  frozenTxBytes: number | null;
}

const initialState: MonitorState = {
  participants: {},
  signaturesCollected: 0,
  thresholdMet: false,
  sessionState: 'waiting',
  transactionId: null,
  mirrorConfirmed: false,
  failureReason: null,
  signatureRejections: [],
  pollingTxId: null,
  freezeStrategy: null,
  freezeNodeCount: null,
  frozenTxBytes: null,
};

/** Map server-reported status strings (`shared/protocol.js` SESSION_STATES)
 * to the monitor's narrower state vocabulary. */
function sessionStatusToMonitorState(status: string | undefined): SessionState {
  switch (status) {
    case 'transaction-received':
      return 'received';
    case 'signing':
      return 'signing';
    case 'executing':
      return 'executing';
    case 'completed':
      return 'completed';
    case 'execution-failed':
      return 'failed';
    case 'transaction-expired':
    case 'expired':
      return 'expired';
    default:
      return 'waiting';
  }
}

function hashscanTxUrl(txId: string, network: 'testnet' | 'mainnet'): string {
  // Hedera TX IDs come from the SDK as `0.0.X@T.N`; HashScan wants `0.0.X-T-N`.
  const formatted = txId.replace('@', '-').replace(/\.(?=\d+$)/, '-');
  return `https://hashscan.io/${network}/transactionsById/${formatted}`;
}

interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
}

export function SessionMonitor({
  ws,
  wsRef,
  threshold,
  expectedParticipants,
  network,
  onTransactionReset,
  initialSessionStatus,
  initialParticipants,
  onStateChange,
}: SessionMonitorProps) {
  const [state, setState] = useState<MonitorState>(() => {
    const seeded: Record<string, MonitorParticipant> = {};
    if (initialParticipants && initialParticipants.length > 0) {
      for (const p of initialParticipants) {
        seeded[p.participantId] = {
          participantId: p.participantId,
          label: p.label || p.participantId.slice(0, 8),
          isAgent: !!p.isAgent,
          status: participantStatusToMonitor(p.status),
        };
      }
    }
    return {
      ...initialState,
      participants: seeded,
      sessionState: sessionStatusToMonitorState(initialSessionStatus),
    };
  });
  const [resetError, setResetError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  // Poll the mirror node ourselves between THRESHOLD_MET and
  // TRANSACTION_EXECUTED so the coordinator sees real-time progress
  // (submitting → polling N/M → confirmed) instead of a static
  // "Executing on Hedera" badge for ~25 seconds.
  // Stops as soon as either: (a) the mirror returns a result, OR
  // (b) the server's own TRANSACTION_EXECUTED broadcast lands first.
  const mirrorPoll = useMirrorPoll({
    txId: state.pollingTxId,
    network,
    enabled:
      !!state.pollingTxId &&
      (state.thresholdMet || state.sessionState === 'executing') &&
      !state.transactionId, // server's broadcast already arrived → stop polling
  });

  // Phase J: lift the live session state up to the page so siblings can
  // switch their layout based on phase. Maps the monitor's internal
  // SessionState vocabulary to a small externally-useful subset
  // (signing / completed / failed / idle).
  useEffect(() => {
    if (!onStateChange) return;
    const phase: SessionLivePhase =
      state.sessionState === 'completed'
        ? 'completed'
        : state.sessionState === 'failed' || state.sessionState === 'expired'
        ? 'failed'
        : state.sessionState === 'received' ||
          state.sessionState === 'signing' ||
          state.sessionState === 'executing'
        ? 'signing'
        : 'idle';
    onStateChange({
      phase,
      signers: Object.values(state.participants).map((p) => ({
        participantId: p.participantId,
        label: p.label,
        status: p.status,
        isAgent: p.isAgent,
      })),
      signaturesCollected: state.signaturesCollected,
      thresholdMet: state.thresholdMet,
      transactionId: state.transactionId,
      mirrorConfirmed: state.mirrorConfirmed,
      failureReason: state.failureReason,
      freezeStrategy: state.freezeStrategy,
      freezeNodeCount: state.freezeNodeCount,
      frozenTxBytes: state.frozenTxBytes,
    });
  }, [state, onStateChange]);

  useEffect(() => {
    if (!ws) return;

    const handler = (event: MessageEvent) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }
      const p = msg.payload || {};

      if (msg.type === 'TRANSACTION_RESET') {
        // Side-effect: notify the parent so the page can route back to the
        // build step. The reducer below also resets local monitor state.
        onTransactionReset?.();
      }

      setState((prev) => {
        const next = { ...prev, participants: { ...prev.participants } };

        switch (msg.type) {
          case 'PARTICIPANT_CONNECTED': {
            const id = (p.participantId as string) || 'unknown';
            next.participants[id] = {
              participantId: id,
              label: (p.label as string) || id.slice(0, 8),
              isAgent: !!p.isAgent,
              status: 'connected',
            };
            return next;
          }
          case 'PARTICIPANT_READY': {
            const id = (p.participantId as string) || 'unknown';
            const existing = next.participants[id];
            next.participants[id] = {
              ...(existing || {
                participantId: id,
                label: id.slice(0, 8),
                isAgent: false,
              }),
              status: existing?.status === 'signed' ? 'signed' : 'ready',
            };
            return next;
          }
          case 'PARTICIPANT_DISCONNECTED': {
            const id = (p.participantId as string) || 'unknown';
            const existing = next.participants[id];
            if (existing && existing.status !== 'signed') {
              next.participants[id] = { ...existing, status: 'disconnected' };
            }
            return next;
          }
          case 'TRANSACTION_RECEIVED': {
            next.sessionState = 'received';
            // Capture the txId now so the mirror-poll hook has it before
            // execution begins. Server-side `extractTransactionDetails`
            // populates `txDetails.transactionId` for both dApp- and
            // CLI-injected transactions.
            const td = p.txDetails as {
              transactionId?: string;
              nodeAccountIds?: string[];
            } | undefined;
            const incomingTxId = td?.transactionId;
            if (incomingTxId && typeof incomingTxId === 'string') {
              next.pollingTxId = incomingTxId;
            }
            // Audit-trail freeze metadata. The dApp coordinator
            // forwards strategy+count in metadata.customFields; the
            // server stores it. CLI-injected transactions don't carry
            // this metadata, so we fall back to nodeAccountIds.length
            // for the count and an inferred "n nodes" strategy label.
            const meta = p.metadata as
              | { customFields?: { nodeStrategy?: string; nodeCount?: number; nodeAccountIds?: string[] } }
              | null
              | undefined;
            const customFields = meta?.customFields;
            if (customFields?.nodeStrategy) {
              next.freezeStrategy = customFields.nodeStrategy;
            } else if (Array.isArray(td?.nodeAccountIds) && td.nodeAccountIds.length > 0) {
              next.freezeStrategy = td.nodeAccountIds.length === 1 ? 'single' : 'cli-injected';
            }
            if (typeof customFields?.nodeCount === 'number') {
              next.freezeNodeCount = customFields.nodeCount;
            } else if (Array.isArray(td?.nodeAccountIds)) {
              next.freezeNodeCount = td.nodeAccountIds.length;
            }
            // Frozen-tx size from the broadcast bytes. Server forwards
            // the normalized { base64 } shape.
            const ft = p.frozenTransaction as { base64?: string } | undefined;
            if (ft?.base64) {
              const padded = ft.base64.replace(/=+$/, '');
              next.frozenTxBytes = Math.floor((padded.length * 3) / 4);
            }
            return next;
          }
          case 'SIGNATURE_RECEIVED': {
            const id = (p.participantId as string) || 'unknown';
            const existing = next.participants[id];
            if (existing) {
              next.participants[id] = { ...existing, status: 'signed' };
            }
            const stats = (p.stats as Record<string, number>) || {};
            next.signaturesCollected =
              stats.signaturesCollected ?? prev.signaturesCollected + 1;
            next.thresholdMet = !!p.thresholdMet;
            next.sessionState = next.thresholdMet ? 'executing' : 'signing';
            return next;
          }
          case 'THRESHOLD_MET': {
            next.thresholdMet = true;
            next.sessionState = 'executing';
            const collected = p.signaturesCollected as number | undefined;
            if (typeof collected === 'number') next.signaturesCollected = collected;
            return next;
          }
          case 'TRANSACTION_EXECUTED': {
            next.sessionState = 'completed';
            const txId = p.transactionId as string | undefined;
            if (txId) {
              next.transactionId = txId;
              // Flip the PENDING history entry written at injection time.
              updateTxHistoryEntryStatus(txId, 'SUCCESS', {
                mirrorConfirmed: !!p.mirrorConfirmed,
                receiptStatus: (p.status as string) || null,
                executedAt: new Date().toISOString(),
              });
            }
            next.mirrorConfirmed = !!p.mirrorConfirmed;
            return next;
          }
          case 'SIGNATURE_REJECTED': {
            // Server-side cryptographic verification failed for a signature
            // submitted by `participantId`. Doesn't change session state —
            // the threshold can still be reached if other valid signatures
            // arrive in time. Surface as a non-blocking alert so the
            // coordinator sees who failed and why.
            const id = (p.participantId as string) || 'unknown';
            const existing = next.participants[id];
            const label = existing?.label || id.slice(0, 8);
            next.signatureRejections = [
              ...(prev.signatureRejections || []),
              {
                participantId: id,
                label,
                message: (p.message as string) || 'Verification failed.',
                at: Date.now(),
              },
            ].slice(-3); // cap at 3 most-recent
            return next;
          }
          case 'TRANSACTION_REJECTED': {
            // M-of-N semantics: one rejection doesn't cancel the tx — it
            // just means that signer won't contribute. The transaction
            // stays in flight unless enough rejections make the threshold
            // unreachable, or the 120-second window expires. Reflect the
            // signer's choice in their pill but DO NOT change the
            // session-level state.
            const id = (p.participantId as string) || 'unknown';
            const existing = next.participants[id];
            if (existing) {
              next.participants[id] = { ...existing, status: 'rejected' };
            }
            return next;
          }
          case 'EXECUTION_FAILED': {
            next.sessionState = 'failed';
            const reason =
              (p.message as string) || 'Execution failed for an unknown reason.';
            next.failureReason = reason;
            // The exec failure path doesn't always carry the txId, so fall
            // back to whatever we've already accumulated for this session.
            const txId = (p.transactionId as string | undefined) || prev.transactionId;
            if (txId) {
              updateTxHistoryEntryStatus(txId, 'FAILURE', {
                failureReason: reason,
                failedAt: new Date().toISOString(),
              });
            }
            return next;
          }
          case 'TRANSACTION_EXPIRED':
          case 'SESSION_EXPIRED': {
            next.sessionState = 'expired';
            const txId = (p.transactionId as string | undefined) || prev.transactionId;
            if (txId) {
              updateTxHistoryEntryStatus(txId, 'FAILURE', {
                failureReason:
                  msg.type === 'TRANSACTION_EXPIRED'
                    ? 'Transaction expired before threshold was met (Hedera 120-second window).'
                    : 'Session expired.',
                expiredAt: new Date().toISOString(),
              });
            }
            return next;
          }
          case 'TRANSACTION_RESET': {
            // Coordinator (this client or another tab) abandoned the in-flight
            // transaction. Clear monitor state; the page will route back to
            // the build step via onTransactionReset.
            return initialState;
          }
          default:
            return prev; // unrelated message, no state change
        }
      });
    };

    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [ws, onTransactionReset]);

  const participants = Object.values(state.participants);
  const sigPct =
    threshold > 0
      ? Math.min(100, Math.round((state.signaturesCollected / threshold) * 100))
      : 0;

  const stateBadge = (() => {
    switch (state.sessionState) {
      case 'waiting':
        return {
          label: 'Waiting for participants',
          className: 'bg-warning-soft text-warning-soft-fg',
        };
      case 'received':
        return {
          label: 'Transaction injected',
          className: 'bg-info-soft text-info-soft-fg',
        };
      case 'signing':
        return {
          label: 'Collecting signatures',
          className: 'bg-info-soft text-info-soft-fg',
        };
      case 'executing':
        return {
          label: 'Executing on Hedera',
          className: 'bg-info-soft text-info-soft-fg',
        };
      case 'completed':
        return {
          label: state.mirrorConfirmed ? 'Executed (mirror confirmed)' : 'Executed',
          className: 'bg-success-soft text-success-soft-fg',
        };
      case 'failed':
        return {
          label: 'Execution failed',
          className: 'bg-destructive-soft text-destructive-soft-fg',
        };
      case 'expired':
        return {
          label: 'Expired',
          className: 'bg-destructive-soft text-destructive-soft-fg',
        };
      default:
        return {
          label: state.sessionState,
          className: 'bg-surface-recessed text-foreground-muted',
        };
    }
  })();

  return (
    <section
      aria-label="Live session monitor"
      className="space-y-4"
    >
      {/* Header row: state badge + connected count */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span
          className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold ${stateBadge.className}`}
        >
          {stateBadge.label}
        </span>
        <span className="text-sm text-foreground-muted tabular-nums">
          {participants.filter((p) => p.status !== 'disconnected').length}/
          {expectedParticipants} participant
          {expectedParticipants === 1 ? '' : 's'} connected
        </span>
      </div>

      {/* Participant rows */}
      {participants.length === 0 ? (
        <p className="text-sm text-foreground-subtle italic">
          No participants connected yet. Share the connection string above
          (or run the <code className="font-mono">hedera-multisig participant</code> CLI in another terminal).
        </p>
      ) : (
        <ul className="divide-y divide-border border border-border rounded-md bg-surface">
          {participants.map((p) => (
            <li
              key={p.participantId}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2 truncate">
                <span className="font-medium text-foreground truncate">
                  {p.label}
                </span>
                {p.isAgent && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-recessed text-foreground-subtle">
                    agent
                  </span>
                )}
                <span className="font-mono text-xs text-foreground-subtle">
                  {p.participantId.slice(0, 8)}…
                </span>
              </span>
              <ParticipantStatusPill status={p.status} />
            </li>
          ))}
        </ul>
      )}

      {/* Signature progress bar (visible once a tx has landed) */}
      {state.sessionState !== 'waiting' && state.sessionState !== 'expired' && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-foreground-muted">Signatures</span>
            <span className="font-mono tabular-nums text-foreground">
              {state.signaturesCollected} / {threshold}
            </span>
          </div>
          <div
            className="h-2 rounded-full bg-surface-recessed overflow-hidden"
            role="progressbar"
            aria-valuenow={state.signaturesCollected}
            aria-valuemin={0}
            aria-valuemax={threshold}
          >
            <div
              className={`h-full transition-all ${
                state.thresholdMet ? 'bg-success' : 'bg-info'
              }`}
              style={{ width: `${sigPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Audit trail — multi-sig freeze metadata. Surfaces the strategy
          + node count + actual on-wire bytes so the coordinator (and
          any reviewer of the local tx-history) can prove "this 5-of-9
          ceremony was bound to a 6-node subset, total 2,418 B". For
          dApp-injected transactions this is set from
          `metadata.customFields`; for CLI-injected ones we infer from
          `txDetails.nodeAccountIds`. */}
      {(state.freezeStrategy || state.freezeNodeCount || state.frozenTxBytes) && (
        <div className="text-xs text-foreground-subtle border-l-2 border-info/40 pl-3 py-1">
          <span className="text-foreground-muted">Frozen against</span>{' '}
          {state.freezeNodeCount != null && (
            <span className="font-mono tabular-nums text-foreground">
              {state.freezeNodeCount} {state.freezeNodeCount === 1 ? 'node' : 'nodes'}
            </span>
          )}
          {state.freezeStrategy && (
            <>
              {' · '}
              <span className="text-foreground">{state.freezeStrategy}</span>
            </>
          )}
          {state.frozenTxBytes != null && (
            <>
              {' · '}
              <span className="font-mono tabular-nums">{state.frozenTxBytes.toLocaleString()} B</span>
              <span className="text-foreground-subtle"> / 6,144 B cap</span>
            </>
          )}
        </div>
      )}

      {/* Mirror-node poll progress — closes the visibility gap between
          THRESHOLD_MET and TRANSACTION_EXECUTED. The server takes ~5-25s
          to submit + receipt + poll mirror; without this block the UI
          would freeze on "Executing on Hedera" the whole time. */}
      {state.pollingTxId && !state.transactionId && (
        mirrorPoll.phase === 'submitting' ? (
          <div className="text-xs space-y-2 border-l-2 border-info bg-info-soft/50 pl-4 py-2 text-info-soft-fg">
            <p className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-r-transparent animate-spin" />
              Submitting to Hedera…
            </p>
            <p className="opacity-75">
              Awaiting network response (~3-5s) before checking the mirror node.
            </p>
          </div>
        ) : mirrorPoll.phase === 'polling' ? (
          <div className="text-xs space-y-2 border-l-2 border-info bg-info-soft/50 pl-4 py-2 text-info-soft-fg">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-r-transparent animate-spin" />
                Polling mirror node…
              </span>
              <span className="font-mono tabular-nums">
                attempt {mirrorPoll.attempt}/{mirrorPoll.maxAttempts}
                {' · '}
                {Math.floor(mirrorPoll.elapsedMs / 1000)}s
              </span>
            </div>
            <div className="h-1 rounded-full bg-info/20 overflow-hidden">
              <div
                className="h-full bg-info transition-all"
                style={{
                  width: `${Math.min(100, (mirrorPoll.attempt / mirrorPoll.maxAttempts) * 100)}%`,
                }}
              />
            </div>
            <p className="opacity-75">
              The mirror node lags consensus by ~3-5s. Hold tight — most
              transactions externalize on the second or third attempt.
            </p>
          </div>
        ) : mirrorPoll.phase === 'timed-out' ? (
          <div role="alert" className="text-xs space-y-1 border-l-2 border-warning bg-warning-soft pl-4 py-2 text-warning-soft-fg">
            <p>
              <strong>Mirror node didn&apos;t externalize the transaction
              within {Math.floor(mirrorPoll.maxAttempts * 3)}s.</strong>
            </p>
            <p>
              The transaction may still have executed — check HashScan
              directly with the txId once the server&apos;s
              <code className="font-mono px-1">TRANSACTION_EXECUTED</code>{' '}
              arrives, or refresh the History page.
            </p>
          </div>
        ) : mirrorPoll.phase === 'confirmed' && mirrorPoll.result?.found ? (
          <div className="text-xs space-y-1 border-l-2 border-success bg-success-soft/50 pl-4 py-2 text-success-soft-fg">
            <p>
              <strong>
                {mirrorPoll.result.result === 'SUCCESS' ? '✓ Mirror confirmed' : `✗ Network rejected (${mirrorPoll.result.result})`}
              </strong>
              {' · '}
              detected after {Math.floor(mirrorPoll.elapsedMs / 1000)}s
              {' · '}
              attempt {mirrorPoll.attempt}/{mirrorPoll.maxAttempts}
            </p>
            {mirrorPoll.result.consensusTimestamp && (
              <p className="opacity-75 font-mono">
                consensus: {mirrorPoll.result.consensusTimestamp}
              </p>
            )}
            {typeof mirrorPoll.result.chargedFee === 'number' && (
              <p className="opacity-75 font-mono">
                fee: {(mirrorPoll.result.chargedFee / 100000000).toFixed(8)} ℏ
              </p>
            )}
          </div>
        ) : null
      )}

      {/* Transaction ID + HashScan link (after execution).
          Render even from `pollingTxId` once mirror confirmed, so a
          delayed/missing server broadcast doesn't deny the user the
          HashScan link. */}
      {(state.transactionId || (state.pollingTxId && mirrorPoll.phase === 'confirmed')) && (
        <div className="text-sm space-y-1">
          <p className="text-foreground-muted">Transaction ID</p>
          <p className="font-mono text-xs break-all text-foreground">
            {state.transactionId || state.pollingTxId}
          </p>
          <a
            href={hashscanTxUrl(
              (state.transactionId || state.pollingTxId) as string,
              network
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline text-xs"
          >
            View on HashScan ↗
          </a>
        </div>
      )}

      {/* Signature rejections — server-side cryptographic verification
          failures. Non-terminal; the threshold can still be met. Shown
          as a stacked alert so the coordinator can see participant +
          reason without leaving the page. */}
      {state.signatureRejections.length > 0 && (
        <div className="space-y-1">
          {state.signatureRejections.map((r) => (
            <div
              key={`${r.participantId}-${r.at}`}
              role="alert"
              className="border-l-2 border-destructive bg-destructive-soft pl-4 py-2 text-xs text-destructive-soft-fg"
            >
              <p>
                <strong>Signature rejected</strong> from{' '}
                <span className="font-mono">{r.label}</span>: {r.message}
              </p>
              <p className="mt-0.5 opacity-80">
                Threshold can still be met if other signers submit valid
                signatures within the 120-second window.
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Failure reason */}
      {state.sessionState === 'failed' && state.failureReason && (
        <div
          role="alert"
          className="border-l-2 border-destructive bg-destructive-soft pl-4 py-3 text-sm text-destructive-soft-fg"
        >
          <p className="font-semibold">Execution failed</p>
          <p className="mt-1">{state.failureReason}</p>
        </div>
      )}

      {/* Quiet footer hint while still waiting */}
      {state.sessionState === 'waiting' && (
        <p className="text-xs text-foreground-subtle">
          Status updates here in real time as participants join and sign — no
          wallet required, no need to leave this page.
        </p>
      )}

      {/* Coordinator reset — visible whenever an in-flight or terminal tx
          is occupying the session and the operator wants to start fresh
          without restarting the CLI server. After 'completed' / 'failed'
          the server still has the old tx in memory; resetting clears it
          and returns the session to 'waiting'. */}
      {(state.sessionState === 'received' ||
        state.sessionState === 'signing' ||
        state.sessionState === 'expired') && (
        <div className="pt-3 border-t border-border space-y-2">
          <button
            type="button"
            onClick={async () => {
              setResetError(null);
              const live = ws ?? wsRef?.current ?? null;
              if (!live || live.readyState !== WebSocket.OPEN) {
                setResetError('Coordinator connection is closed.');
                return;
              }
              setIsResetting(true);
              try {
                live.send(
                  JSON.stringify({
                    type: 'RESET_TRANSACTION',
                    payload: {},
                  })
                );
                const errorListener = (event: MessageEvent) => {
                  try {
                    const m = JSON.parse(event.data as string);
                    if (m.type === 'ERROR') {
                      setResetError(
                        (m.payload?.message as string) || 'Reset failed.'
                      );
                      live.removeEventListener('message', errorListener);
                      setIsResetting(false);
                    } else if (m.type === 'TRANSACTION_RESET') {
                      live.removeEventListener('message', errorListener);
                      setIsResetting(false);
                    }
                  } catch {
                    /* not our message */
                  }
                };
                live.addEventListener('message', errorListener);
                setTimeout(() => {
                  live.removeEventListener('message', errorListener);
                  setIsResetting(false);
                }, 5000);
              } catch (err) {
                setResetError(
                  err instanceof Error ? err.message : 'Failed to send reset.'
                );
                setIsResetting(false);
              }
            }}
            disabled={isResetting}
            className="text-xs px-3 py-1.5 rounded-md text-foreground hover:bg-surface-recessed border border-border-strong transition-colors disabled:opacity-50"
          >
            {isResetting
              ? 'Resetting…'
              : state.sessionState === 'expired'
                ? 'Inject new transaction'
                : 'Abandon current transaction'}
          </button>
          {resetError && (
            <p role="alert" className="text-xs text-destructive">
              {resetError}
            </p>
          )}
          <p className="text-xs text-foreground-subtle">
            Clears the current transaction on the server and returns the
            session to <em>waiting</em>. Already-collected signatures (if any)
            are discarded. Use this if a participant&apos;s client crashed,
            you injected the wrong transaction, or you want to retry after a
            120-second expiry without restarting the CLI server.
          </p>
        </div>
      )}
    </section>
  );
}

function ParticipantStatusPill({
  status,
}: {
  status: MonitorParticipant['status'];
}) {
  const variants: Record<
    MonitorParticipant['status'],
    { label: string; className: string }
  > = {
    connected: {
      label: 'connected',
      className: 'bg-warning-soft text-warning-soft-fg',
    },
    ready: { label: 'ready', className: 'bg-info-soft text-info-soft-fg' },
    signed: {
      label: 'signed',
      className: 'bg-success-soft text-success-soft-fg',
    },
    rejected: {
      label: 'rejected',
      className: 'bg-destructive-soft text-destructive-soft-fg',
    },
    disconnected: {
      label: 'disconnected',
      className: 'bg-surface-recessed text-foreground-subtle',
    },
  };
  const v = variants[status];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${v.className}`}
    >
      {v.label}
    </span>
  );
}
