/**
 * Example: Networked Multi-Signature (Participant Side)
 *
 * This example demonstrates how a participant connects to a networked
 * multi-signature session using the SigningClient.
 *
 * Workflow:
 * 1. Connect to session with URL, session ID, and PIN
 * 2. Load private key (NEVER transmitted over network)
 * 3. Mark as ready and wait for transaction
 * 4. Review and approve transaction when received
 * 5. Transaction automatically signed and submitted
 *
 * Usage:
 *   node examples/networked-participant.js
 *
 * Or use the CLI tool:
 *   node cli/participant.js --url <url> --session <id> --pin <pin>
 */

const { PrivateKey } = require('@hashgraph/sdk');
const { SigningClient } = require('../index');
const readlineSync = require('readline-sync');
const chalk = require('chalk');

async function participantExample() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║    NETWORKED MULTI-SIGNATURE - PARTICIPANT SIDE       ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  try {
    // 1. Get session details from user (or pass as command-line arguments)
    console.log(chalk.white('Enter session details (provided by coordinator):\n'));

    const serverUrl = readlineSync.question(chalk.cyan('Server URL: '));
    const sessionId = readlineSync.question(chalk.cyan('Session ID: '));
    const pin = readlineSync.question(chalk.cyan('PIN: '));

    console.log('');

    // 2. Create signing client
    const client = new SigningClient({
      verbose: true,
      label: 'Example Participant'
    });

    // 3. Connect to session
    console.log(chalk.yellow('Connecting to session...\n'));

    const connectionResult = await client.connect(serverUrl, sessionId, pin);

    console.log(chalk.green('✅ Connected successfully!\n'));
    console.log(chalk.white('Session Information:'));
    console.log(chalk.gray(`  Session ID: ${connectionResult.sessionInfo.sessionId}`));
    console.log(chalk.gray(`  Status: ${connectionResult.sessionInfo.status}`));
    console.log(chalk.gray(`  Threshold: ${connectionResult.sessionInfo.threshold} signatures required`));
    console.log(chalk.gray(`  Expires: ${new Date(connectionResult.sessionInfo.expiresAt).toLocaleString()}\n`));

    // 4. Load private key
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('LOAD PRIVATE KEY'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.yellow('⚠️  Your private key will be loaded into memory LOCALLY.'));
    console.log(chalk.yellow('⚠️  It will NEVER be transmitted over the network.'));
    console.log(chalk.yellow('⚠️  Only your signature will be sent to the coordinator.\n'));

    // For demonstration - in production, use secure key management
    const privateKeyHex = readlineSync.question(chalk.white('Enter your private key (hex): '), {
      hideEchoBack: true
    });

    console.log('');

    const privateKey = PrivateKey.fromString(privateKeyHex);
    client.loadKeys(privateKey);

    console.log(chalk.green(`✅ Private key loaded`));
    console.log(chalk.gray(`   Public Key: ${privateKey.publicKey.toString()}\n`));

    // 5. Mark as ready
    console.log(chalk.cyan('═'.repeat(60)));
    client.setReady();
    console.log(chalk.cyan('═'.repeat(60)));

    console.log(chalk.bold.green('\n✅ READY - Waiting for transaction injection...\n'));
    console.log(chalk.white('What happens next:'));
    console.log(chalk.gray('  1. Coordinator will inject a transaction for signing'));
    console.log(chalk.gray('  2. You will see the decoded transaction details'));
    console.log(chalk.gray('  3. Review VERIFIED information vs UNVERIFIED metadata'));
    console.log(chalk.gray('  4. Type "YES" (all caps) to approve, or anything else to reject'));
    console.log(chalk.gray('  5. Your signature will be submitted automatically\n'));

    console.log(chalk.yellow(`Session expires in: ${Math.floor((connectionResult.sessionInfo.expiresAt - Date.now()) / 60000)} minutes\n`));
    console.log(chalk.cyan('═'.repeat(60)) + '\n');

    // 6. Set up event handlers
    client.on('transactionExecuted', (data) => {
      console.log(chalk.bold.green('\n✅ TRANSACTION EXECUTED SUCCESSFULLY!'));
      console.log(chalk.white(`   Transaction ID: ${data.transactionId}`));
      console.log(chalk.white(`   Status: ${data.status}\n`));

      console.log(chalk.cyan('Disconnecting...'));
      client.disconnect();
      process.exit(0);
    });

    client.on('thresholdMet', () => {
      console.log(chalk.bold.green('\n🎉 Signature threshold met!'));
      console.log(chalk.white('   Transaction will be executed by coordinator...\n'));
    });

    client.on('participantReady', (data) => {
      if (data.allReady) {
        console.log(chalk.bold.green('🎉 All expected participants are ready!\n'));
      } else {
        console.log(chalk.white(`📊 Participants ready: ${data.stats?.participantsReady || '?'}/${data.stats?.participantsExpected || '?'}\n`));
      }
    });

    client.on('sessionExpired', () => {
      console.log(chalk.red('\n❌ Session expired\n'));
      process.exit(1);
    });

    client.on('error', (data) => {
      console.error(chalk.red(`\n❌ Error: ${data.message}\n`));
    });

    // 7. Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n\n⚠️  Disconnecting from session...\n'));
      client.disconnect();
      process.exit(0);
    });

    // Keep process alive - waiting for transaction
    console.log(chalk.gray('(Press Ctrl+C to disconnect)\n'));

  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    console.error(chalk.gray(error.stack));
    process.exit(1);
  }
}

// Run example
participantExample();
