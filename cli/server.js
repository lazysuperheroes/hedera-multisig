#!/usr/bin/env node

/**
 * CLI Server Tool
 *
 * Start a multi-signature session server from the command line.
 *
 * Usage:
 *   node cli/server.js --threshold 2 --keys "key1,key2,key3" --participants 3
 *   npm run multisig-server -- --threshold 2 --keys "key1,key2,key3"
 */

const { Client } = require('@hashgraph/sdk');
const { SigningSessionManager, WebSocketServer } = require('../server');
const chalk = require('chalk');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    threshold: null,
    eligibleKeys: [],
    participants: null,
    port: 3000,
    host: 'localhost',
    timeout: 1800000, // 30 minutes
    tunnel: true,
    pin: null,
    network: 'testnet'
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--threshold':
      case '-t':
        options.threshold = parseInt(args[++i]);
        break;

      case '--keys':
      case '-k':
        options.eligibleKeys = args[++i].split(',').map(k => k.trim());
        break;

      case '--participants':
      case '-p':
        options.participants = parseInt(args[++i]);
        break;

      case '--port':
        options.port = parseInt(args[++i]);
        break;

      case '--host':
        options.host = args[++i];
        break;

      case '--timeout':
        options.timeout = parseInt(args[++i]) * 60000; // Convert minutes to ms
        break;

      case '--no-tunnel':
        options.tunnel = false;
        break;

      case '--pin':
        options.pin = args[++i];
        break;

      case '--network':
      case '-n':
        options.network = args[++i];
        break;

      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

function printHelp() {
  console.log(chalk.bold('\n📋 Hedera MultiSig Server\n'));
  console.log('Usage: node cli/server.js [options]\n');
  console.log('Options:');
  console.log('  -t, --threshold <n>        Number of signatures required (required)');
  console.log('  -k, --keys <keys>          Comma-separated eligible public keys (required)');
  console.log('  -p, --participants <n>     Expected number of participants (defaults to key count)');
  console.log('  --port <port>              Server port (default: 3000)');
  console.log('  --host <host>              Server host (default: localhost)');
  console.log('  --timeout <minutes>        Session timeout in minutes (default: 30)');
  console.log('  --no-tunnel                Disable automatic tunnel (local-only)');
  console.log('  --pin <pin>                Custom 6-digit PIN (auto-generated if not provided)');
  console.log('  -n, --network <network>    Hedera network (testnet|mainnet, default: testnet)');
  console.log('  -h, --help                 Show this help message\n');
  console.log('Examples:');
  console.log('  # Start server for 2-of-3 multisig');
  console.log('  node cli/server.js -t 2 -k "key1,key2,key3"\n');
  console.log('  # Start server with custom port and no tunnel');
  console.log('  node cli/server.js -t 2 -k "key1,key2,key3" --port 8080 --no-tunnel\n');
}

async function main() {
  const options = parseArgs();

  // Validate required options
  if (!options.threshold) {
    console.error(chalk.red('❌ Error: --threshold is required'));
    printHelp();
    process.exit(1);
  }

  if (options.eligibleKeys.length === 0) {
    console.error(chalk.red('❌ Error: --keys is required'));
    printHelp();
    process.exit(1);
  }

  if (options.threshold > options.eligibleKeys.length) {
    console.error(chalk.red(`❌ Error: Threshold (${options.threshold}) cannot exceed number of keys (${options.eligibleKeys.length})`));
    process.exit(1);
  }

  // Set expected participants
  if (!options.participants) {
    options.participants = options.eligibleKeys.length;
  }

  try {
    console.log(chalk.bold.cyan('\n🚀 Starting Hedera MultiSig Server\n'));
    console.log(chalk.cyan('═'.repeat(60)));

    // Create Hedera client
    const client = options.network === 'mainnet'
      ? Client.forMainnet()
      : Client.forTestnet();

    console.log(chalk.white('Network: ') + chalk.yellow(options.network));
    console.log(chalk.white('Threshold: ') + chalk.yellow(`${options.threshold} of ${options.eligibleKeys.length}`));
    console.log(chalk.white('Expected Participants: ') + chalk.yellow(options.participants));
    console.log(chalk.white('Session Timeout: ') + chalk.yellow(`${options.timeout / 60000} minutes`));
    console.log(chalk.cyan('═'.repeat(60)) + '\n');

    // Create session manager
    const sessionManager = new SigningSessionManager(client, {
      defaultTimeout: options.timeout,
      verbose: true
    });

    // Create WebSocket server
    const wsServer = new WebSocketServer(sessionManager, {
      port: options.port,
      host: options.host,
      verbose: true,
      tunnel: options.tunnel ? {
        enabled: true,
        provider: 'auto' // ngrok → localtunnel fallback
      } : null
    });

    // Start server
    const serverInfo = await wsServer.start();

    // Create pre-session (no transaction yet)
    const session = await sessionManager.createSession(null, {
      threshold: options.threshold,
      eligiblePublicKeys: options.eligibleKeys,
      expectedParticipants: options.participants,
      timeout: options.timeout,
      pin: options.pin,

      // Event handlers
      onParticipantConnected: (event) => {
        console.log(chalk.green(`\n✅ Participant connected: ${event.participantId}`));
        console.log(chalk.white(`   Total connected: ${event.stats.participantsConnected}/${event.stats.participantsExpected}\n`));
      },

      onParticipantReady: (event) => {
        console.log(chalk.green(`\n✅ Participant ready: ${event.participantId}`));
        console.log(chalk.white(`   Total ready: ${event.stats.participantsReady}/${event.stats.participantsExpected}`));

        if (event.allReady) {
          console.log(chalk.bold.green('\n🎉 All participants are ready! You can now inject a transaction.\n'));
        }
        console.log('');
      },

      onSignatureReceived: (event) => {
        console.log(chalk.green(`\n✅ Signature received from ${event.participantId}`));
        console.log(chalk.white(`   Signatures: ${event.stats.signaturesCollected}/${event.stats.signaturesRequired}\n`));
      },

      onThresholdMet: (event) => {
        console.log(chalk.bold.green('\n🎉 Signature threshold met!'));
        console.log(chalk.white(`   Ready to execute transaction\n`));
      }
    });

    // Display session info
    console.log(chalk.bold.green('✅ Pre-Session Created Successfully!\n'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('SESSION INFORMATION'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.white('Session ID: ') + chalk.yellow(session.sessionId));
    console.log(chalk.white('PIN: ') + chalk.bold.yellow(session.pin));

    if (serverInfo.publicUrl) {
      console.log(chalk.white('Public URL: ') + chalk.yellow(serverInfo.publicUrl));
      console.log(chalk.white('Local URL: ') + chalk.gray(serverInfo.url));
    } else {
      console.log(chalk.white('Local URL: ') + chalk.yellow(serverInfo.url));
    }

    console.log(chalk.white('Expires: ') + chalk.yellow(new Date(session.expiresAt).toLocaleString()));
    console.log(chalk.cyan('═'.repeat(60)));

    console.log(chalk.bold.white('\n📋 SHARE WITH PARTICIPANTS:\n'));
    const shareUrl = serverInfo.publicUrl || serverInfo.url;
    console.log(chalk.yellow(`Server URL: ${shareUrl}`));
    console.log(chalk.yellow(`Session ID: ${session.sessionId}`));
    console.log(chalk.yellow(`PIN: ${session.pin}\n`));

    console.log(chalk.white('Participants should run:'));
    console.log(chalk.cyan(`  node cli/participant.js --url "${shareUrl}" --session "${session.sessionId}" --pin "${session.pin}"\n`));

    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('\n⏳ Waiting for participants to connect and become ready...\n'));

    // Keep server running
    process.on('SIGINT', async () => {
      console.log(chalk.yellow('\n\n⚠️  Shutting down server...'));
      await wsServer.stop();
      sessionManager.shutdown();
      process.exit(0);
    });

  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error(chalk.red(`\n❌ Fatal error: ${error.message}\n`));
  process.exit(1);
});
