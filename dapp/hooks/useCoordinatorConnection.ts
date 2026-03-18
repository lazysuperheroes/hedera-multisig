import { useState, useCallback, useRef, useEffect } from 'react';

interface SessionCredentials {
  sessionId: string;
  pin: string;
  coordinatorToken: string;
  threshold: number;
  eligibleKeys: string[];
  status: string;
  expiresAt: string;
}

interface ConnectParams {
  serverUrl: string;
  sessionId: string;
  pin: string;
  coordinatorToken: string;
}

interface UseCoordinatorConnectionReturn {
  wsRef: React.MutableRefObject<WebSocket | null>;
  isConnecting: boolean;
  connectError: string | null;
  sessionCredentials: SessionCredentials | null;
  connect: (params: ConnectParams) => Promise<{ hasTransaction: boolean }>;
}

export function useCoordinatorConnection(): UseCoordinatorConnectionReturn {
  const wsRef = useRef<WebSocket | null>(null);
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
      const ws = new WebSocket(serverUrl);
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error('Connection timed out after 10 seconds.'));
        }, 10000);

        ws.onopen = () => {
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
              });

              hasTransaction =
                info?.status === 'transaction-received' ||
                info?.status === 'signing';

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

  return { wsRef, isConnecting, connectError, sessionCredentials, connect };
}
