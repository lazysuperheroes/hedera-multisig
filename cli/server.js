#!/usr/bin/env node

/**
 * CLI Server Tool
 *
 * Start a multi-signature session server from the command line.
 *
 * Configuration:
 *   Create a .env file in the project root with:
 *     ENVIRONMENT=TEST     # Network: TEST or MAIN
 *
 * Usage:
 *   node cli/server.js --threshold 2 --keys "key1,key2,key3" --participants 3
 *   npm run multisig-server -- --threshold 2 --keys "key1,key2,key3"
 */

// Load environment variables from .env file
require('dotenv').config();

const { Client } = require('@hashgraph/sdk');
const { SigningSessionManager, WebSocketServer } = require('../server');
const { generateConnectionString } = require('../shared/connection-string');
const {
  ExitCodes,
  JsonOutput,
  parseCommonFlags,
  printVersion,
  exitWithError,
  getCommonFlagsHelp,
  getVersion,
  initializeLogging
} = require('./utils/cliUtils');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');

/**
 * Display QR code in terminal
 */
function displayQRCode(connectionString) {
  console.log(chalk.bold.white('\n📱 SCAN QR CODE TO JOIN:\n'));
  qrcode.generate(connectionString, { small: true }, (qr) => {
    console.log(qr);
  });
}

// Session file for auto-discovery by other scripts
const SESSION_FILE = path.join(process.cwd(), '.multisig-session.json');

/**
 * Write session details to file for auto-discovery
 */
function writeSessionFile(sessionData) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.log(chalk.yellow(`⚠️  Could not write session file: ${error.message}`));
    return false;
  }
}

/**
 * Clean up session file on shutdown
 */
function cleanupSessionFile() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
    }
  } catch (error) {
    // Ignore cleanup errors
  }
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);

  // Parse common flags first
  const commonFlags = parseCommonFlags(args);

  // Handle version flag
  if (commonFlags.version) {
    printVersion(commonFlags.json);
    process.exit(ExitCodes.SUCCESS);
  }

  // Handle help flag
  if (commonFlags.help) {
    printHelp();
    process.exit(ExitCodes.SUCCESS);
  }

  const options = {
    // Common flags
    json: commonFlags.json,
    verbose: commonFlags.verbose,
    quiet: commonFlags.quiet,
    trace: commonFlags.trace,
    exportLogs: commonFlags.exportLogs,
    logFile: commonFlags.logFile,
    // Server-specific options
    threshold: null,
    eligibleKeys: [],
    participants: null,
    port: 3000,
    host: 'localhost',
    timeout: 1800000, // 30 minutes
    tunnel: true,
    pin: null,
    network: (() => {
      const env = (process.env.ENVIRONMENT || 'TEST').toUpperCase();
      switch (env) {
        case 'MAIN': case 'MAINNET': return 'mainnet';
        case 'PREVIEW': case 'PREVIEWNET': return 'previewnet';
        case 'LOCAL': case 'LOCALHOST': return 'local';
        default: return 'testnet';
      }
    })(),
    // TLS options
    tlsCert: null,
    tlsKey: null,
    tlsCa: null,
    tlsPassphrase: null
  };

  // Parse remaining args (after common flags are removed)
  const remainingArgs = commonFlags.remainingArgs;
  for (let i = 0; i < remainingArgs.length; i++) {
    switch (remainingArgs[i]) {
      case '--threshold':
      case '-t':
        options.threshold = parseInt(remainingArgs[++i]);
        break;

      case '--keys':
      case '-k':
        options.eligibleKeys = remainingArgs[++i].split(',').map(k => {
          const key = k.trim();
          // Normalize: ensure 0x prefix for consistency
          return key.startsWith('0x') ? key : `0x${key}`;
        });
        break;

      case '--participants':
      case '-p':
        options.participants = parseInt(remainingArgs[++i]);
        break;

      case '--port':
        options.port = parseInt(remainingArgs[++i]);
        break;

      case '--host':
        options.host = remainingArgs[++i];
        break;

      case '--timeout':
        options.timeout = parseInt(remainingArgs[++i]) * 60000; // Convert minutes to ms
        break;

      case '--no-tunnel':
        options.tunnel = false;
        break;

      case '--pin':
        options.pin = remainingArgs[++i];
        break;

      case '--network':
      case '-n':
        options.network = remainingArgs[++i];
        break;

      case '--tls-cert':
        options.tlsCert = remainingArgs[++i];
        break;

      case '--tls-key':
        options.tlsKey = remainingArgs[++i];
        break;

      case '--tls-ca':
        options.tlsCa = remainingArgs[++i];
        break;

      case '--tls-passphrase':
        options.tlsPassphrase = remainingArgs[++i];
        break;
    }
  }

  return options;
}

function printHelp() {
  console.log(chalk.bold('\n📋 Hedera MultiSig Server v' + getVersion() + '\n'));
  console.log('Usage: node cli/server.js [options]\n');
  console.log('Server Options:');
  console.log('  -t, --threshold <n>        Number of signatures required (required)');
  console.log('  -k, --keys <keys>          Comma-separated eligible public keys (required)');
  console.log('  -p, --participants <n>     Expected number of participants (defaults to key count)');
  console.log('  --port <port>              Server port (default: 3000)');
  console.log('  --host <host>              Server host (default: localhost)');
  console.log('  --timeout <minutes>        Session timeout in minutes (default: 30)');
  console.log('  --no-tunnel                Disable automatic tunnel (local-only)');
  console.log('  --pin <token>              Custom session token (auto-generated if not provided)');
  console.log('  -n, --network <network>    Hedera network (testnet|mainnet, default: testnet)');
  console.log('');
  console.log('TLS/Security Options:');
  console.log('  --tls-cert <path>          Path to TLS certificate file (enables WSS)');
  console.log('  --tls-key <path>           Path to TLS private key file');
  console.log('  --tls-ca <path>            Path to CA certificate file (optional)');
  console.log('  --tls-passphrase <pass>    Passphrase for private key (optional)');
  console.log(getCommonFlagsHelp());
  console.log('\nExamples:');
  console.log('  # Start server for 2-of-3 multisig');
  console.log('  node cli/server.js -t 2 -k "key1,key2,key3"\n');
  console.log('  # Start server with custom port and no tunnel');
  console.log('  node cli/server.js -t 2 -k "key1,key2,key3" --port 8080 --no-tunnel\n');
  console.log('  # Start server with TLS (secure WebSocket)');
  console.log('  node cli/server.js -t 2 -k "key1,key2" --tls-cert ./cert.pem --tls-key ./key.pem\n');
  console.log('  # Get session info as JSON (for scripting)');
  console.log('  node cli/server.js -t 2 -k "key1,key2" --json\n');
}

async function main() {
  const options = parseArgs();

  // Initialize logging based on CLI flags
  const log = initializeLogging(options, 'Server');

  // Create JSON output handler
  const jsonOutput = new JsonOutput(options.json);

  // Validate required options
  if (!options.threshold) {
    exitWithError('--threshold is required', ExitCodes.VALIDATION_ERROR, jsonOutput);
  }

  if (options.eligibleKeys.length === 0) {
    exitWithError('--keys is required', ExitCodes.VALIDATION_ERROR, jsonOutput);
  }

  if (options.threshold > options.eligibleKeys.length) {
    exitWithError(
      `Threshold (${options.threshold}) cannot exceed number of keys (${options.eligibleKeys.length})`,
      ExitCodes.VALIDATION_ERROR,
      jsonOutput
    );
  }

  // Set expected participants
  if (!options.participants) {
    options.participants = options.eligibleKeys.length;
  }

  try {
    console.log(chalk.bold.cyan('\n🚀 Starting Hedera MultiSig Server\n'));
    console.log(chalk.cyan('═'.repeat(60)));

    // Create Hedera client (supports testnet, mainnet, previewnet, local)
    let client;
    switch (options.network) {
      case 'mainnet': client = Client.forMainnet(); break;
      case 'previewnet': client = Client.forPreviewnet(); break;
      case 'local': client = Client.forLocalNode(); break;
      default: client = Client.forTestnet();
    }

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

    // Build TLS configuration if certificates provided
    const tlsConfig = options.tlsCert && options.tlsKey ? {
      enabled: true,
      cert: options.tlsCert,
      key: options.tlsKey,
      ca: options.tlsCa || undefined,
      passphrase: options.tlsPassphrase || undefined
    } : null;

    // Create WebSocket server
    const wsServer = new WebSocketServer(sessionManager, {
      port: options.port,
      host: options.host,
      verbose: true,
      tunnel: options.tunnel ? {
        enabled: true,
        provider: 'auto' // ngrok → localtunnel fallback
      } : null,
      tls: tlsConfig
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

    // Build session data
    const shareUrl = serverInfo.publicUrl || serverInfo.url;
    const connectionString = generateConnectionString(shareUrl, session.sessionId, session.pin);

    const sessionFileData = {
      sessionId: session.sessionId,
      pin: session.pin,
      serverUrl: shareUrl,
      localUrl: serverInfo.url,
      publicUrl: serverInfo.publicUrl || null,
      connectionString: connectionString,
      network: options.network,
      threshold: options.threshold,
      expectedParticipants: options.participants,
      expiresAt: session.expiresAt,
      createdAt: Date.now()
    };

    // JSON mode: output structured data and continue running
    if (options.json) {
      jsonOutput.set('session', sessionFileData);
      jsonOutput.set('status', 'running');
      jsonOutput.print(true);
      // Continue running server but no more console output
    } else {
      // Display session info (interactive mode)
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
      console.log(chalk.yellow(`Server URL: ${shareUrl}`));
      console.log(chalk.yellow(`Session ID: ${session.sessionId}`));
      console.log(chalk.yellow(`PIN: ${session.pin}\n`));

      console.log(chalk.bold.white('🔗 CONNECTION STRING (paste in dApp):'));
      console.log(chalk.cyan(`  ${connectionString}\n`));

      // Display QR code
      displayQRCode(connectionString);

      console.log(chalk.white('\nParticipants can also run:'));
      console.log(chalk.gray(`  node cli/participant.js --url "${shareUrl}" --session "${session.sessionId}" --pin "${session.pin}"\n`));
    }

    // Write session file for auto-discovery
    if (writeSessionFile(sessionFileData) && !options.json) {
      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.green(`✅ Session file written: ${SESSION_FILE}`));
      console.log(chalk.gray('   Other scripts will auto-detect this session.\n'));
    }

    if (!options.json) {
      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold.white('\n⏳ Waiting for participants to connect and become ready...\n'));
    }

    // Keep server running
    process.on('SIGINT', async () => {
      if (!options.json) {
        console.log(chalk.yellow('\n\n⚠️  Shutting down server...'));
      }
      cleanupSessionFile();
      await wsServer.stop();
      sessionManager.shutdown();
      process.exit(ExitCodes.SUCCESS);
    });

    // Also cleanup on other exit signals
    process.on('SIGTERM', () => {
      cleanupSessionFile();
    });

  } catch (error) {
    exitWithError(error.message, ExitCodes.SESSION_ERROR, jsonOutput);
  }
}

// Run
main().catch((error) => {
  // Fallback error handling (jsonOutput not available here)
  console.error(chalk.red(`\n❌ Fatal error: ${error.message}\n`));
  process.exit(ExitCodes.INTERNAL_ERROR);
});
