/**
 * Integration Tests: Networked Multi-Signature Workflow
 *
 * Tests the complete pre-session workflow with simulated participants.
 */

const { expect } = require('chai');
const {
  Client,
  TransferTransaction,
  Hbar,
  PrivateKey,
  AccountId
} = require('@hashgraph/sdk');

const {
  SigningSessionManager,
  WebSocketServer,
  SigningClient,
  WorkflowOrchestrator
} = require('../index');

describe('Networked Multi-Signature Workflow', function() {
  this.timeout(60000); // 60 seconds for network operations

  let client;
  let sessionManager;
  let wsServer;
  let serverInfo;
  let session;

  // Generate test keys
  const participant1Key = PrivateKey.generateED25519();
  const participant2Key = PrivateKey.generateED25519();
  const participant3Key = PrivateKey.generateED25519();

  const eligiblePublicKeys = [
    participant1Key.publicKey.toString(),
    participant2Key.publicKey.toString(),
    participant3Key.publicKey.toString()
  ];

  before(async function() {
    // Set up Hedera client
    if (!process.env.OPERATOR_ID || !process.env.OPERATOR_KEY) {
      this.skip(); // Skip if credentials not available
    }

    client = Client.forTestnet();
    client.setOperator(
      AccountId.fromString(process.env.OPERATOR_ID),
      PrivateKey.fromString(process.env.OPERATOR_KEY)
    );
  });

  after(async function() {
    if (wsServer) {
      await wsServer.stop();
    }
    if (sessionManager) {
      sessionManager.shutdown();
    }
  });

  describe('Pre-Session Creation', function() {
    it('should create a pre-session without transaction', async function() {
      sessionManager = new SigningSessionManager(client, {
        defaultTimeout: 300000, // 5 minutes for testing
        verbose: false
      });

      session = await sessionManager.createSession(null, {
        threshold: 2,
        eligiblePublicKeys,
        expectedParticipants: 3,
        timeout: 300000,
        pin: '123456'
      });

      expect(session).to.have.property('sessionId');
      expect(session).to.have.property('pin', '123456');
      expect(session).to.have.property('threshold', 2);
      expect(session).to.have.property('status', 'waiting');
      expect(session.eligiblePublicKeys).to.have.lengthOf(3);
    });

    it('should start WebSocket server', async function() {
      wsServer = new WebSocketServer(sessionManager, {
        port: 3001, // Use different port to avoid conflicts
        host: 'localhost',
        verbose: false,
        tunnel: null // Disable tunnel for testing
      });

      serverInfo = await wsServer.start();

      expect(serverInfo).to.have.property('url');
      expect(serverInfo.url).to.include('ws://localhost:3001');
    });
  });

  describe('Participant Connection', function() {
    let client1, client2, client3;

    it('should connect participant 1', async function() {
      client1 = new SigningClient({ verbose: false });

      const result = await client1.connect(
        serverInfo.url,
        session.sessionId,
        session.pin
      );

      expect(result.success).to.be.true;
      expect(result.sessionInfo.status).to.equal('waiting');
    });

    it('should load keys for participant 1', function() {
      const keyResult = client1.loadKeys(participant1Key);
      expect(keyResult.success).to.be.true;
      expect(keyResult.publicKey).to.equal(participant1Key.publicKey.toString());
    });

    it('should mark participant 1 as ready', function() {
      const result = client1.setReady();
      expect(result.success).to.be.true;
    });

    it('should connect and prepare participant 2', async function() {
      client2 = new SigningClient({ verbose: false });
      await client2.connect(serverInfo.url, session.sessionId, session.pin);
      client2.loadKeys(participant2Key);
      client2.setReady();
    });

    it('should connect and prepare participant 3', async function() {
      client3 = new SigningClient({ verbose: false });
      await client3.connect(serverInfo.url, session.sessionId, session.pin);
      client3.loadKeys(participant3Key);
      client3.setReady();
    });

    it('should have all participants ready', function(done) {
      // Check session state
      const sessionInfo = sessionManager.getSessionInfo(session.sessionId);
      expect(sessionInfo.stats.participantsReady).to.equal(3);
      done();
    });
  });

  describe('Transaction Injection', function() {
    let transaction;

    it('should create and freeze transaction', async function() {
      transaction = new TransferTransaction()
        .addHbarTransfer(process.env.OPERATOR_ID, Hbar.fromTinybars(-1000))
        .addHbarTransfer('0.0.456', Hbar.fromTinybars(1000))
        .setTransactionMemo('Test networked multisig')
        .freezeWith(client);

      expect(transaction._isFrozen).to.be.true;
    });

    it('should inject transaction into session', async function() {
      const result = await sessionManager.injectTransaction(
        session.sessionId,
        transaction,
        {
          metadata: {
            description: 'Test transfer of 1000 tinybars',
            amount: { value: 1000, unit: 'tinybars' },
            recipient: { address: '0.0.456' }
          }
        }
      );

      expect(result.status).to.equal('transaction-received');
      expect(result.txDetails).to.have.property('type');
    });

    it('should reject transaction injection into non-waiting session', async function() {
      try {
        await sessionManager.injectTransaction(session.sessionId, transaction);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Cannot inject transaction');
      }
    });
  });

  describe('WorkflowOrchestrator Integration', function() {
    let orchestrator;
    let orchestratorSession;

    it('should create networked session via orchestrator', async function() {
      orchestrator = new WorkflowOrchestrator(client, {
        verbose: false
      });

      const result = await orchestrator.createNetworkedSession({
        threshold: 2,
        eligiblePublicKeys: eligiblePublicKeys,
        expectedParticipants: 3,
        port: 3002, // Different port
        tunnel: false
      });

      expect(result.success).to.be.true;
      expect(result.session).to.have.property('sessionId');
      orchestratorSession = result.session;
    });

    it('should detect active session', function() {
      const sessionId = orchestrator.detectActiveSession();
      expect(sessionId).to.equal(orchestratorSession.sessionId);
    });

    it('should execute transaction with session', async function() {
      const tx = new TransferTransaction()
        .addHbarTransfer(process.env.OPERATOR_ID, Hbar.fromTinybars(-500))
        .addHbarTransfer('0.0.789', Hbar.fromTinybars(500))
        .freezeWith(client);

      const result = await orchestrator.executeWithSession(tx);

      expect(result.success).to.be.true;
      expect(result.status).to.equal('transaction-received');
    });

    it('should cleanup orchestrator', function() {
      orchestrator.cleanup();
    });
  });
});

describe('Networked Workflow Error Handling', function() {
  this.timeout(30000);

  let client;

  before(function() {
    if (!process.env.OPERATOR_ID || !process.env.OPERATOR_KEY) {
      this.skip();
    }

    client = Client.forTestnet();
    client.setOperator(
      AccountId.fromString(process.env.OPERATOR_ID),
      PrivateKey.fromString(process.env.OPERATOR_KEY)
    );
  });

  it('should fail to create session without threshold', async function() {
    const orchestrator = new WorkflowOrchestrator(client);

    const result = await orchestrator.createNetworkedSession({
      eligiblePublicKeys: ['key1', 'key2'],
      port: 3003
    });

    expect(result.success).to.be.false;
    expect(result.error).to.include('threshold');
  });

  it('should fail to create session without eligible keys', async function() {
    const orchestrator = new WorkflowOrchestrator(client);

    const result = await orchestrator.createNetworkedSession({
      threshold: 2,
      port: 3004
    });

    expect(result.success).to.be.false;
    expect(result.error).to.include('eligiblePublicKeys');
  });

  it('should fail participant connection with wrong PIN', async function() {
    const sessionManager = new SigningSessionManager(client, { verbose: false });
    const session = await sessionManager.createSession(null, {
      threshold: 2,
      eligiblePublicKeys: ['key1', 'key2'],
      pin: '123456'
    });

    const wsServer = new WebSocketServer(sessionManager, {
      port: 3005,
      verbose: false,
      tunnel: null
    });

    const serverInfo = await wsServer.start();

    const participantClient = new SigningClient({ verbose: false });

    try {
      await participantClient.connect(
        serverInfo.url,
        session.sessionId,
        'wrong-pin'
      );
      expect.fail('Should have failed authentication');
    } catch (error) {
      expect(error.message).to.include('Authentication failed');
    }

    await wsServer.stop();
    sessionManager.shutdown();
  });

  it('should fail to set ready without keys loaded', async function() {
    const participantClient = new SigningClient({ verbose: false });

    try {
      participantClient.setReady();
      expect.fail('Should have thrown error');
    } catch (error) {
      expect(error.message).to.include('no private key loaded');
    }
  });
});
