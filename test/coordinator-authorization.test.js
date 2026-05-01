/**
 * Coordinator Authorization Tests (Phase A1, CRITICAL #1)
 *
 * Verifies that post-AUTH role enforcement rejects TRANSACTION_INJECT and
 * EXECUTE_TRANSACTION from non-coordinator clients. Pre-fix, any authenticated
 * participant could inject arbitrary transactions or trigger early execution.
 */

const { expect } = require('chai');
const WebSocket = require('ws');

const SigningSessionManager = require('../server/SigningSessionManager');
const WebSocketServer = require('../server/WebSocketServer');

describe('Coordinator Authorization (Phase A1)', function() {
  this.timeout(15000);

  const PORT = 3099;
  let sessionManager;
  let wsServer;
  let session;

  before(async function() {
    sessionManager = new SigningSessionManager(null, {
      defaultTimeout: 60000,
      verbose: false
    });

    session = await sessionManager.createSession(null, {
      threshold: 2,
      eligiblePublicKeys: ['fakekey1', 'fakekey2', 'fakekey3'],
      expectedParticipants: 3,
      timeout: 60000,
      pin: 'TESTPIN1'
    });

    wsServer = new WebSocketServer(sessionManager, {
      port: PORT,
      host: 'localhost',
      verbose: false,
      tunnel: null,
      allowedOrigins: null
    });

    await wsServer.start();
  });

  after(async function() {
    if (wsServer) await wsServer.stop();
    if (sessionManager) sessionManager.shutdown();
  });

  function authAndConnect(authPayload) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}`);
      const authHandler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'AUTH_SUCCESS') {
          ws.off('message', authHandler);
          resolve(ws);
        } else if (msg.type === 'AUTH_FAILED') {
          ws.off('message', authHandler);
          ws.close();
          reject(new Error(`AUTH_FAILED: ${msg.payload?.message} (code: ${msg.payload?.code})`));
        }
      };
      ws.on('open', () => {
        ws.on('message', authHandler);
        ws.send(JSON.stringify({ type: 'AUTH', payload: authPayload }));
      });
      ws.on('error', reject);
    });
  }

  function sendAndAwait(ws, message, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const handler = (data) => {
        if (resolved) return;
        resolved = true;
        ws.off('message', handler);
        resolve(JSON.parse(data.toString()));
      };
      ws.on('message', handler);
      ws.send(JSON.stringify(message));
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        ws.off('message', handler);
        reject(new Error('Timeout waiting for response'));
      }, timeoutMs);
    });
  }

  describe('Non-coordinator cannot inject or execute', function() {
    let participantWs;

    before(async function() {
      participantWs = await authAndConnect({
        sessionId: session.sessionId,
        pin: 'TESTPIN1',
        role: 'participant',
        label: 'test-participant'
      });
    });

    after(function() {
      if (participantWs && participantWs.readyState === WebSocket.OPEN) {
        participantWs.close();
      }
    });

    it('rejects TRANSACTION_INJECT from a participant with NOT_COORDINATOR error', async function() {
      const response = await sendAndAwait(participantWs, {
        type: 'TRANSACTION_INJECT',
        payload: { frozenTransaction: { base64: 'AAAA' } }
      });
      expect(response.type).to.equal('ERROR');
      expect(response.payload.code).to.equal('NOT_COORDINATOR');
      expect(response.payload.message).to.match(/coordinator/i);
    });

    it('rejects EXECUTE_TRANSACTION from a participant with NOT_COORDINATOR error', async function() {
      const response = await sendAndAwait(participantWs, {
        type: 'EXECUTE_TRANSACTION',
        payload: {}
      });
      expect(response.type).to.equal('ERROR');
      expect(response.payload.code).to.equal('NOT_COORDINATOR');
      expect(response.payload.message).to.match(/coordinator/i);
    });
  });

  describe('Coordinator is permitted to inject and execute', function() {
    let coordinatorWs;

    before(async function() {
      coordinatorWs = await authAndConnect({
        sessionId: session.sessionId,
        pin: 'TESTPIN1',
        role: 'coordinator',
        coordinatorToken: session.coordinatorToken,
        label: 'test-coordinator'
      });
    });

    after(function() {
      if (coordinatorWs && coordinatorWs.readyState === WebSocket.OPEN) {
        coordinatorWs.close();
      }
    });

    it('does NOT reject TRANSACTION_INJECT from coordinator with NOT_COORDINATOR', async function() {
      // The injection itself may fail (we send invalid bytes), but the role check
      // must pass — the failure code, if any, must be something other than NOT_COORDINATOR.
      const response = await sendAndAwait(coordinatorWs, {
        type: 'TRANSACTION_INJECT',
        payload: { frozenTransaction: { base64: 'AAAA' } }
      });
      if (response.type === 'ERROR' || response.type === 'INJECTION_FAILED') {
        expect(response.payload.code).to.not.equal('NOT_COORDINATOR');
      }
    });
  });
});
