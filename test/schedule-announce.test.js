/**
 * SCHEDULE_ANNOUNCE protocol roundtrip (Phase 0 of Task 1).
 *
 * The dApp coordinator builds a HIP-423 ScheduleCreateTransaction,
 * submits it directly to the network with their wallet, gets back a
 * scheduleId, then announces it to the WS session via SCHEDULE_ANNOUNCE
 * so participants know what to sign. This test exercises the
 * coordinator-side ingest + the participant-side broadcast in
 * isolation — no network calls, no schedule actually gets signed,
 * just "do the bytes flow through and end up in the right places?"
 *
 * What we verify:
 *   1. Coordinator role is required (a participant trying to announce
 *      gets ERROR / NOT_COORDINATOR — same affordance as TRANSACTION_INJECT).
 *   2. SCHEDULE_ANNOUNCE flips session.mode to 'scheduled' and stamps
 *      scheduleId + supporting fields onto the session.
 *   3. SCHEDULE_CREATED broadcast lands at every connected participant
 *      with the announced fields preserved.
 *   4. AUTH_SUCCESS for a late joiner carries the scheduled-mode
 *      context so they don't have to wait for a re-broadcast.
 */

const { expect } = require('chai');
const WebSocket = require('ws');

const SigningSessionManager = require('../server/SigningSessionManager');
const WebSocketServer = require('../server/WebSocketServer');

describe('SCHEDULE_ANNOUNCE protocol (Phase 0)', function() {
  this.timeout(15000);

  const PORT = 3098;
  let sessionManager;
  let wsServer;
  let session;
  let coordinatorToken;

  before(async function() {
    sessionManager = new SigningSessionManager(null, {
      defaultTimeout: 60000,
      verbose: false,
    });

    session = await sessionManager.createSession(null, {
      threshold: 2,
      eligiblePublicKeys: ['fakekey1', 'fakekey2', 'fakekey3'],
      expectedParticipants: 3,
      timeout: 60000,
      pin: 'TESTPIN1',
    });
    coordinatorToken = session.coordinatorToken;

    wsServer = new WebSocketServer(sessionManager, {
      port: PORT,
      host: 'localhost',
      verbose: false,
      tunnel: null,
      allowedOrigins: null,
    });

    await wsServer.start();
  });

  after(async function() {
    if (wsServer) await wsServer.stop();
    if (sessionManager) sessionManager.shutdown();
  });

  function connect(authPayload) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${PORT}`);
      const authHandler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'AUTH_SUCCESS') {
          ws.off('message', authHandler);
          resolve({ ws, sessionInfo: msg.payload.sessionInfo, participantId: msg.payload.participantId });
        } else if (msg.type === 'AUTH_FAILED') {
          ws.off('message', authHandler);
          ws.close();
          reject(new Error(`AUTH_FAILED: ${msg.payload?.message}`));
        }
      };
      ws.on('open', () => {
        ws.on('message', authHandler);
        ws.send(JSON.stringify({ type: 'AUTH', payload: authPayload }));
      });
      ws.on('error', reject);
    });
  }

  function sendAndAwait(ws, message, expectedTypes = null, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const handler = (data) => {
        if (resolved) return;
        const msg = JSON.parse(data.toString());
        if (expectedTypes && !expectedTypes.includes(msg.type)) return; // ignore irrelevant
        resolved = true;
        ws.off('message', handler);
        resolve(msg);
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

  function awaitMessage(ws, expectedType, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const handler = (data) => {
        if (resolved) return;
        const msg = JSON.parse(data.toString());
        if (msg.type !== expectedType) return;
        resolved = true;
        ws.off('message', handler);
        resolve(msg);
      };
      ws.on('message', handler);
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        ws.off('message', handler);
        reject(new Error(`Timeout waiting for ${expectedType}`));
      }, timeoutMs);
    });
  }

  it('rejects SCHEDULE_ANNOUNCE from a non-coordinator participant', async function() {
    const { ws } = await connect({
      sessionId: session.sessionId,
      pin: session.pin,
      role: 'participant',
      label: 'imposter',
    });
    const response = await sendAndAwait(ws, {
      type: 'SCHEDULE_ANNOUNCE',
      payload: { scheduleId: '0.0.99999' },
    }, ['ERROR']);
    expect(response.type).to.equal('ERROR');
    expect(response.payload.message).to.match(/coordinator/i);
    ws.close();
  });

  it('coordinator announce stamps session and broadcasts SCHEDULE_CREATED', async function() {
    // Connect a participant first so we can assert they receive the broadcast.
    const participant = await connect({
      sessionId: session.sessionId,
      pin: session.pin,
      role: 'participant',
      label: 'alice',
    });

    const coord = await connect({
      sessionId: session.sessionId,
      pin: session.pin,
      role: 'coordinator',
      coordinatorToken,
    });

    const announcePayload = {
      scheduleId: '0.0.123456',
      expirationTime: Math.floor(Date.now() / 1000) + 86400, // ~24h
      scheduleMemo: 'walkthrough-scheduled: 5 ℏ payroll',
      payerAccountId: '0.0.2',
      adminKey: null,
      innerTxDetails: { type: 'TransferTransaction', transfers: [] },
      innerTxBase64: 'CgQQAQ==', // dummy
    };

    // Listen on participant for the broadcast in parallel with sending
    // the announce on the coordinator socket.
    const broadcastP = awaitMessage(participant.ws, 'SCHEDULE_CREATED');
    coord.ws.send(JSON.stringify({ type: 'SCHEDULE_ANNOUNCE', payload: announcePayload }));

    const broadcast = await broadcastP;
    expect(broadcast.payload.scheduleId).to.equal('0.0.123456');
    expect(broadcast.payload.expirationTime).to.equal(announcePayload.expirationTime);
    expect(broadcast.payload.scheduleMemo).to.equal('walkthrough-scheduled: 5 ℏ payroll');
    expect(broadcast.payload.payerAccountId).to.equal('0.0.2');
    expect(broadcast.payload.innerTxDetails.type).to.equal('TransferTransaction');

    // Server-side state mutation
    const stored = await sessionManager.store.getSession(session.sessionId);
    expect(stored.mode).to.equal('scheduled');
    expect(stored.scheduleId).to.equal('0.0.123456');
    expect(stored.scheduleMemo).to.equal(announcePayload.scheduleMemo);

    coord.ws.close();
    participant.ws.close();
  });

  it('AUTH_SUCCESS for a late joiner carries scheduled-mode context', async function() {
    // The previous test left the session promoted to mode='scheduled'
    // with scheduleId 0.0.123456. A fresh participant joining now
    // should get that context inline rather than having to wait for a
    // re-broadcast (which never fires).
    const lateJoiner = await connect({
      sessionId: session.sessionId,
      pin: session.pin,
      role: 'participant',
      label: 'bob (late)',
    });
    expect(lateJoiner.sessionInfo.mode).to.equal('scheduled');
    expect(lateJoiner.sessionInfo.scheduleId).to.equal('0.0.123456');
    expect(lateJoiner.sessionInfo.scheduleMemo).to.equal('walkthrough-scheduled: 5 ℏ payroll');
    expect(lateJoiner.sessionInfo.scheduleExpirationTime).to.be.a('number');
    lateJoiner.ws.close();
  });
});
