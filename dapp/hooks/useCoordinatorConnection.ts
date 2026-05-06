import { useState, useCallback, useRef, useEffect } from 'react';
import { emitConsoleLog } from '../lib/console-log';

/** Server-side participant entry from `_formatParticipants` in
 * `server/SigningSessionManager.js`. Lets the coordinator UI seed its
 * monitor from the AUTH_SUCCESS snapshot for participants who connected
 * before the coordinator opened /create. */
export interface ServerParticipant {
  participantId: string;
  status: 'connected' | 'ready' | 'signed' | 'rejected' | 'disconnected' | string;
  publicKey?: string;
  label?: string;
  connectedAt?: number;
  isAgent?: boolean;
}

interface SessionCredentials {
  sessionId: string;
  pin: string;
  coordinatorToken: string;
  threshold: number;
  eligibleKeys: string[];
  status: string;
  expiresAt: string;
  /** Participants already on the session at AUTH time. Empty unless the
   * coordinator reconnects to (or arrives at) a session with prior joins. */
  participants: ServerParticipant[];
}

interface ConnectParams {
  serverUrl: string;
  sessionId: string;
  pin: string;
  coordinatorToken: string;
}

interface UseCoordinatorConnectionReturn {
  wsRef: React.MutableRefObject<WebSocket | null>;
  /** State-tracked WebSocket. Use this in `useEffect` deps when you want
   * the effect to re-run as soon as the connection becomes live. The
   * `wsRef` form is kept for code that only needs imperative access
   * (e.g. message-send-then-await-reply patterns). */
  ws: WebSocket | null;
  isConnecting: boolean;
  connectError: string | null;
  sessionCredentials: SessionCredentials | null;
  connect: (params: ConnectParams) => Promise<{ hasTransaction: boolean }>;
}

export function useCoordinatorConnection(): UseCoordinatorConnectionReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [sessionCredentials, setSessionCredentials] = useState<SessionCredentials | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, []);

  const connect = useCallback(async (params: ConnectParams) => {
    const { serverUrl, sessionId, pin, coordinatorToken } = params;

    if (!serverUrl || !sessionId || !pin || !coordinatorToken) {
      setConnectError('All fields are required.');
      return { hasTransaction: false };
    }

    setIsConnecting(true);
    setConnectError(null);

    let hasTransaction = false;

    try {
      emitConsoleLog({ level: 'info', source: 'ws', message: `connecting to ${serverUrl}` });
      const ws = new WebSocket(serverUrl);
      wsRef.current = ws;
      // Mirror to state so consumers using ws as a useEffect dep
      // (e.g. SessionMonitor) re-subscribe when the socket comes alive.
      setWs(ws);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          emitConsoleLog({ level: 'error', source: 'ws', message: 'connection timed out (10s)' });
          reject(new Error('Connection timed out after 10 seconds.'));
        }, 10000);

        ws.onopen = () => {
          emitConsoleLog({
            level: 'success',
            source: 'ws',
            message: 'open — sending AUTH',
            data: { role: 'coordinator', sessionId },
          });
          ws.send(
            JSON.stringify({
              type: 'AUTH',
              payload: {
                sessionId,
                pin,
                role: 'coordinator',
                coordinatorToken,
              },
            })
          );
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string);
            emitConsoleLog({
              level: msg.type === 'ERROR' ? 'error' : 'debug',
              source: 'ws',
              message: `← ${msg.type}`,
            });

            if (msg.type === 'AUTH_SUCCESS') {
              clearTimeout(timeout);
              const info = msg.payload?.sessionInfo;
              setSessionCredentials({
                sessionId: info?.sessionId || sessionId,
                pin,
                coordinatorToken,
                threshold: info?.threshold ?? 0,
                eligibleKeys: info?.eligiblePublicKeys ?? [],
                status: info?.status ?? 'unknown',
                expiresAt: info?.expiresAt
                  ? new Date(info.expiresAt).toLocaleString()
                  : '',
                participants: Array.isArray(info?.participants)
                  ? (info.participants as ServerParticipant[])
                  : [],
              });

              hasTransaction =
                info?.status === 'transaction-received' ||
                info?.status === 'signing';

              emitConsoleLog({
                level: 'success',
                source: 'session',
                message: `authenticated as coordinator`,
                data: {
                  threshold: info?.threshold,
                  eligible_keys: info?.eligiblePublicKeys?.length ?? 0,
                  status: info?.status,
                },
              });
              resolve();
            } else if (msg.type === 'AUTH_FAILED') {
              clearTimeout(timeout);
              reject(new Error(msg.payload?.message || 'Authentication failed.'));
            } else if (msg.type === 'ERROR') {
              clearTimeout(timeout);
              reject(new Error(msg.payload?.message || 'Server error.'));
            }
          } catch {
            // ignore parse errors from non-JSON frames
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          emitConsoleLog({ level: 'error', source: 'ws', message: 'socket error' });
          reject(new Error('WebSocket connection failed. Is the server running?'));
        };

        ws.onclose = (event) => {
          if (!event.wasClean) {
            clearTimeout(timeout);
            reject(new Error('Connection closed unexpectedly.'));
          }
        };
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error.';
      setConnectError(message);
      throw err; // Re-throw so caller can handle toast
    } finally {
      setIsConnecting(false);
    }

    return { hasTransaction };
  }, []);

  return { wsRef, ws, isConnecting, connectError, sessionCredentials, connect };
}
