/**
 * Example: Networked Multi-Signature (Coordinator/Server Side)
 *
 * This example demonstrates the PRE-SESSION workflow pattern:
 * 1. Create a pre-session (without transaction)
 * 2. Start WebSocket server with tunnel support
 * 3. Participants connect and load keys (can take 30+ minutes)
 * 4. Inject transaction into session (must complete in <120 seconds)
 * 5. Participants review, approve, and sign
 * 6. Execute transaction when threshold is met
 *
 * Usage:
 *   OPERATOR_ID=0.0.XXX OPERATOR_KEY=xxx node examples/networked-multisig-coordinator.js
 */

const {
  Client,
  TransferTransaction,
  Hbar,
  PrivateKey,
  AccountId
} = require('@hashgraph/sdk');

const {
  SigningSessionManager,
  WebSocketServer
} = require('../index');

const readlineSync = require('readline-sync');
const chalk = require('chalk');

async function coordinatorExample() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║  NETWORKED MULTI-SIGNATURE - PRE-SESSION WORKFLOW     ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  try {
    // 1. Set up Hedera client
    const client = Client.forTestnet();

    if (!process.env.OPERATOR_ID || !process.env.OPERATOR_KEY) {
      throw new Error('Please set OPERATOR_ID and OPERATOR_KEY environment variables');
    }

    client.setOperator(
      AccountId.fromString(process.env.OPERATOR_ID),
      PrivateKey.fromString(process.env.OPERATOR_KEY)
    );

    console.log(chalk.green('✅ Hedera client configured\n'));

    // 2. Define eligible public keys (replace with actual keys)
    const eligiblePublicKeys = [
      // Example keys - replace with actual participant public keys
      '302a300506032b65700321001234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      '302a300506032b65700321009876543210fedcba9876543210fedcba9876543210fedcba9876543210fedcba',
      '302a300506032b6570032100abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
    ];

    console.log(chalk.cyan('Eligible Public Keys:'));
    eligiblePublicKeys.forEach((key, idx) => {
      console.log(chalk.gray(`  ${idx + 1}. ${key.substring(0, 20)}...`));
    });
    console.log('');

    // 3. Initialize signing session manager
    const sessionManager = new SigningSessionManager(client, {
      defaultTimeout: 1800000, // 30 minutes
      verbose: true
    });

    // 4. Create PRE-SESSION (no transaction yet!)
    console.log(chalk.yellow('Creating pre-session (no transaction)...\n'));

    const session = await sessionManager.createSession(null, {
      threshold: 2, // Require 2 out of 3 signatures
      eligiblePublicKeys,
      expectedParticipants: 3,
      timeout: 1800000, // 30 minutes for participants to connect
      pin: '123456', // Or omit to auto-generate

      // Event handlers
      onParticipantConnected: (event) => {
        console.log(chalk.green(`\n📱 Participant connected!`));
        console.log(chalk.white(`   Total: ${event.stats.participantsConnected}/${event.stats.participantsExpected}\n`));
      },

      onParticipantReady: (event) => {
        console.log(chalk.green(`\n✅ Participant READY: ${event.participantId}`));
        console.log(chalk.white(`   Ready: ${event.stats.participantsReady}/${event.stats.participantsExpected}`));

        if (event.allReady) {
          console.log(chalk.bold.green('\n🎉 ALL PARTICIPANTS READY!'));
          console.log(chalk.yellow('   You can now inject a transaction for signing.\n'));
        }
      },

      onSignatureReceived: (event) => {
        console.log(chalk.green(`\n✅ Signature received from ${event.publicKey.slice(-8)}`));
        console.log(chalk.white(`   Progress: ${event.stats.signaturesCollected}/${event.stats.signaturesRequired}\n`));
      },

      onThresholdMet: async (event) => {
        console.log(chalk.bold.green('\n🎉 THRESHOLD MET!'));
        console.log(chalk.white(`   ${event.stats.signaturesCollected} signatures collected.\n`));

        // Prompt for execution
        const shouldExecute = readlineSync.keyInYN('Execute transaction now? ');

        if (shouldExecute) {
          try {
            const result = await sessionManager.executeTransaction(session.sessionId);
            console.log(chalk.green(`\n✅ Transaction executed successfully!`));
            console.log(chalk.white(`   Transaction ID: ${result.transactionId}`));
            console.log(chalk.white(`   Status: ${result.status}\n`));

            // Shutdown
            await wsServer.stop();
            sessionManager.shutdown();
            process.exit(0);
          } catch (error) {
            console.error(chalk.red(`\n❌ Execution failed: ${error.message}\n`));
          }
        }
      },

      onError: (event) => {
        console.error(chalk.red(`\n❌ Error: ${event.error}\n`));
      }
    });

    // 5. Start WebSocket server with tunnel support
    const wsServer = new WebSocketServer(sessionManager, {
      port: 3000,
      host: 'localhost',
      verbose: true,
      tunnel: {
        enabled: true,
        provider: 'auto' // Try ngrok first, fallback to localtunnel
      }
    });

    const serverInfo = await wsServer.start();

    // 6. Display session information
    console.log(chalk.cyan('\n═'.repeat(60)));
    console.log(chalk.bold.white('PRE-SESSION CREATED - SHARE WITH PARTICIPANTS'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.white('Session ID: ') + chalk.yellow(session.sessionId));
    console.log(chalk.white('PIN Code:   ') + chalk.bold.yellow(session.pin));

    if (serverInfo.publicUrl) {
      console.log(chalk.white('Public URL: ') + chalk.yellow(serverInfo.publicUrl));
      console.log(chalk.white('Local URL:  ') + chalk.gray(serverInfo.url));
    } else {
      console.log(chalk.white('Server URL: ') + chalk.yellow(serverInfo.url));
    }

    console.log(chalk.white('Threshold:  ') + chalk.yellow(`${session.threshold} of ${eligiblePublicKeys.length} signatures`));
    console.log(chalk.white('Expires:    ') + chalk.yellow(new Date(session.expiresAt).toLocaleString()));
    console.log(chalk.cyan('═'.repeat(60)));

    console.log(chalk.bold.white('\n📋 PARTICIPANTS SHOULD RUN:\n'));
    const shareUrl = serverInfo.publicUrl || serverInfo.url;
    console.log(chalk.cyan(`  node cli/participant.js --url "${shareUrl}" --session "${session.sessionId}" --pin "${session.pin}"\n`));

    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.yellow('\n⏳ PHASE 1: Waiting for participants to connect and load keys...'));
    console.log(chalk.gray('   (This can take 30+ minutes - participants will mark themselves READY)\n'));

    // 7. Wait for user to inject transaction (when ready)
    // This is a simulation - in a real scenario, you'd inject when all participants are ready
    console.log(chalk.white('When participants are ready, press ENTER to inject a transaction...'));
    readlineSync.question('');

    // 8. Create and inject transaction
    console.log(chalk.yellow('\n⏰ PHASE 2: Creating transaction (must complete in <120 seconds)...\n'));

    const transaction = new TransferTransaction()
      .addHbarTransfer(process.env.OPERATOR_ID, Hbar.fromTinybars(-1000))
      .addHbarTransfer('0.0.456', Hbar.fromTinybars(1000))
      .setTransactionMemo('Networked multisig transfer')
      .freezeWith(client);

    console.log(chalk.green('✅ Transaction created and frozen\n'));

    // Inject transaction into session
    await sessionManager.injectTransaction(session.sessionId, transaction, {
      metadata: {
        description: 'Transfer 1000 tinybars to account 0.0.456',
        amount: { value: 1000, unit: 'tinybars' },
        recipient: { address: '0.0.456' }
      }
    });

    console.log(chalk.green('✅ Transaction injected into session!'));
    console.log(chalk.yellow('   Participants will now review and sign...\n'));
    console.log(chalk.white('Waiting for signatures...\n'));

    // Keep process alive
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n\n⚠️  Shutting down server...\n'));
      await wsServer.stop();
      sessionManager.shutdown();
      process.exit(0);
    });

  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    console.error(chalk.gray(error.stack));
    process.exit(1);
  }
}

// Run example
coordinatorExample();
