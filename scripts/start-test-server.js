#!/usr/bin/env node

/**
 * Test Server for WalletConnect dApp Integration Testing
 *
 * This script starts a test WebSocket server with pre-configured test keys.
 * Use this to test the WalletConnect dApp in a local environment.
 *
 * Usage:
 *   node scripts/start-test-server.js
 *
 * Environment Variables Required:
 *   OPERATOR_ID - Hedera operator account ID (e.g., 0.0.1234)
 *   OPERATOR_KEY - Hedera operator private key
 *
 * Optional:
 *   TEST_THRESHOLD - Signature threshold (default: 2)
 *   TEST_PARTICIPANTS - Expected participants (default: 3)
 *   TEST_PIN - Session PIN (default: auto-generated)
 *   TEST_PORT - Server port (default: 3001)
 *   NO_TUNNEL - Set to disable tunnel (local-only testing)
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

const readline = require('readline');
const chalk = require('chalk');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function startTestServer() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║     WALLETCONNECT DAPP - TEST SERVER                  ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  try {
    // 1. Validate environment
    if (!process.env.OPERATOR_ID || !process.env.OPERATOR_KEY) {
      console.log(chalk.red('❌ Error: Missing environment variables\n'));
      console.log(chalk.yellow('Please set the following environment variables:'));
      console.log(chalk.yellow('  OPERATOR_ID - Your Hedera account ID (e.g., 0.0.1234)'));
      console.log(chalk.yellow('  OPERATOR_KEY - Your Hedera private key'));
      console.log(chalk.yellow('\nExample:'));
      console.log(chalk.gray('  set OPERATOR_ID=0.0.1234'));
      console.log(chalk.gray('  set OPERATOR_KEY=302e020100300506032b657004220420...'));
      console.log(chalk.gray('  node scripts/start-test-server.js\n'));
      process.exit(1);
    }

    // 2. Set up Hedera client
    const client = Client.forTestnet();
    client.setOperator(
      AccountId.fromString(process.env.OPERATOR_ID),
      PrivateKey.fromString(process.env.OPERATOR_KEY)
    );

    console.log(chalk.green('✅ Hedera client configured'));
    console.log(chalk.gray(`   Network: Testnet`));
    console.log(chalk.gray(`   Operator: ${process.env.OPERATOR_ID}\n`));

    // 3. Get test configuration
    const threshold = parseInt(process.env.TEST_THRESHOLD || '2');
    const expectedParticipants = parseInt(process.env.TEST_PARTICIPANTS || '3');
    const port = parseInt(process.env.TEST_PORT || '3001');
    const useTunnel = !process.env.NO_TUNNEL;
    const customPin = process.env.TEST_PIN || null;

    console.log(chalk.cyan('📋 Test Configuration:'));
    console.log(chalk.gray(`   Threshold: ${threshold} signatures required`));
    console.log(chalk.gray(`   Expected Participants: ${expectedParticipants}`));
    console.log(chalk.gray(`   Port: ${port}`));
    console.log(chalk.gray(`   Tunnel: ${useTunnel ? 'Enabled' : 'Disabled'}`));
    console.log('');

    // 4. Get eligible keys from user
    console.log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.yellow('IMPORTANT: Eligible Public Keys Setup\n'));
    console.log(chalk.white('For WalletConnect testing, you need to provide the public keys'));
    console.log(chalk.white('of the wallets that will participate in signing.\n'));
    console.log(chalk.white('Options:'));
    console.log(chalk.gray('  1. Use your WalletConnect wallet public key (from HashPack/Blade)'));
    console.log(chalk.gray('  2. Use CLI participant keys from test files'));
    console.log(chalk.gray('  3. Mix both (recommended for mixed session testing)\n'));
    console.log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    console.log(chalk.cyan(`Enter ${expectedParticipants} eligible public keys (one per line):`));
    console.log(chalk.gray('Example format: 302a300506032b6570032100abcdef1234567890...\n'));

    const eligiblePublicKeys = [];
    for (let i = 0; i < expectedParticipants; i++) {
      const key = await question(chalk.cyan(`Public Key ${i + 1}: `));
      if (key.trim()) {
        eligiblePublicKeys.push(key.trim());
      } else {
        console.log(chalk.red('❌ Key cannot be empty. Please try again.'));
        i--; // Retry this iteration
      }
    }

    console.log('');
    console.log(chalk.green('✅ Keys configured:'));
    eligiblePublicKeys.forEach((key, idx) => {
      console.log(chalk.gray(`   ${idx + 1}. ${key.substring(0, 40)}...${key.substring(key.length - 10)}`));
    });
    console.log('');

    // 5. Initialize signing session manager
    const sessionManager = new SigningSessionManager(client, {
      defaultTimeout: 1800000, // 30 minutes
      verbose: true
    });

    // 6. Create PRE-SESSION (no transaction yet)
    console.log(chalk.yellow('Creating pre-session (no transaction)...\n'));

    const session = await sessionManager.createSession(null, {
      threshold,
      eligiblePublicKeys,
      expectedParticipants,
      timeout: 1800000, // 30 minutes
      pin: customPin
    });

    console.log(chalk.green('✅ Session created'));
    console.log(chalk.gray(`   Session ID: ${session.sessionId}`));
    console.log(chalk.gray(`   PIN: ${session.pin}\n`));

    // 7. Start WebSocket server
    console.log(chalk.yellow('Starting WebSocket server...\n'));

    const wsServer = new WebSocketServer(sessionManager, {
      port,
      verbose: true,
      tunnel: useTunnel
    });

    const serverInfo = await wsServer.start();

    console.log(chalk.green('\n✅ Server started successfully!\n'));
    console.log(chalk.bold.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.bold.cyan('   SESSION INFORMATION (Share with participants)'));
    console.log(chalk.bold.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
    console.log(chalk.bold.white(`   Session ID: ${chalk.yellow(session.sessionId)}`));
    console.log(chalk.bold.white(`   PIN:        ${chalk.yellow(session.pin)}\n`));

    if (serverInfo.tunnel) {
      console.log(chalk.bold.white(`   Server URL: ${chalk.green(serverInfo.tunnel.url)}`));
      console.log(chalk.gray(`   Local URL:  ws://localhost:${port}\n`));
    } else {
      console.log(chalk.bold.white(`   Server URL: ${chalk.yellow(`ws://localhost:${port}`)}`));
      console.log(chalk.gray('   (Local-only mode - no tunnel)\n'));
    }

    console.log(chalk.bold.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    // 8. Wait for participants to connect
    console.log(chalk.yellow('⏳ Waiting for participants to connect...\n'));
    console.log(chalk.gray('Instructions:'));
    console.log(chalk.gray('  1. Open the dApp in your browser (http://localhost:3000)'));
    console.log(chalk.gray('  2. Click "Join Signing Session"'));
    console.log(chalk.gray('  3. Enter the Session ID and PIN above'));
    console.log(chalk.gray('  4. Connect your WalletConnect wallet (HashPack/Blade)'));
    console.log(chalk.gray('  5. Once all participants are ready, press ENTER here to inject a test transaction\n'));

    // Wait for user to signal readiness
    await question(chalk.cyan('Press ENTER when all participants are connected and ready: '));

    // 9. Inject a test transaction
    console.log(chalk.yellow('\nCreating test transaction...\n'));

    const transaction = new TransferTransaction()
      .addHbarTransfer(process.env.OPERATOR_ID, new Hbar(-1))
      .addHbarTransfer('0.0.3', new Hbar(1)) // Send to Hedera fee account as test
      .setTransactionMemo('WalletConnect dApp Test Transaction')
      .freezeWith(client);

    console.log(chalk.cyan('Test Transaction Details:'));
    console.log(chalk.gray(`  Type: HBAR Transfer`));
    console.log(chalk.gray(`  From: ${process.env.OPERATOR_ID} (-1 HBAR)`));
    console.log(chalk.gray(`  To: 0.0.3 (+1 HBAR)`));
    console.log(chalk.gray(`  Memo: "WalletConnect dApp Test Transaction"\n`));

    console.log(chalk.yellow('Injecting transaction into session...\n'));

    await sessionManager.injectTransaction(session.sessionId, transaction, {
      title: 'Test HBAR Transfer',
      description: 'WalletConnect dApp integration test - 1 HBAR transfer',
      urgency: 'normal'
    });

    console.log(chalk.green('✅ Transaction injected!\n'));
    console.log(chalk.yellow('⏳ Waiting for signatures...\n'));
    console.log(chalk.gray('Participants should now see the transaction in their dApp/CLI.'));
    console.log(chalk.gray('They can review and sign the transaction.\n'));

    // 10. Wait for completion
    console.log(chalk.cyan('Server is now running. Press Ctrl+C to stop.\n'));

    // Keep process alive
    await new Promise(() => {});

  } catch (error) {
    console.error(chalk.red('\n❌ Error:'), error.message);
    console.error(chalk.gray(error.stack));
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n⏸️  Shutting down server...\n'));
  process.exit(0);
});

// Run the test server
startTestServer().catch((error) => {
  console.error(chalk.red('\n❌ Fatal error:'), error);
  process.exit(1);
});
