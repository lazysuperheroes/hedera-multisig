/**
 * Server Command
 *
 * Start a multi-signature session server.
 */

const { Client } = require('@hashgraph/sdk');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');

module.exports = function(program) {
  program
    .command('server')
    .description('Start a multi-sig session server')
    .requiredOption('-t, --threshold <n>', 'Number of signatures required', parseInt)
    .requiredOption('-k, --keys <keys>', 'Comma-separated eligible public keys')
    .option('-p, --participants <n>', 'Expected number of participants', parseInt)
    .option('--port <port>', 'Server port', parseInt, 3000)
    .option('--host <host>', 'Server host', 'localhost')
    .option('--timeout <minutes>', 'Session timeout in minutes', parseInt, 30)
    .option('--no-tunnel', 'Disable automatic tunnel (local-only)')
    .option('--pin <token>', 'Custom session token (auto-generated if not provided)')
    .option('-n, --network <network>', 'Hedera network (testnet|mainnet)', getDefaultNetwork())
    .option('--tls-cert <path>', 'Path to TLS certificate file (enables WSS)')
    .option('--tls-key <path>', 'Path to TLS private key file')
    .option('--tls-ca <path>', 'Path to CA certificate file')
    .option('--tls-passphrase <pass>', 'Passphrase for private key')
    .option('--redis', 'Enable Redis session persistence')
    .option('--redis-host <host>', 'Redis host', process.env.REDIS_HOST || 'localhost')
    .option('--redis-port <port>', 'Redis port', parseInt, parseInt(process.env.REDIS_PORT) || 6379)
    .option('--redis-password <pass>', 'Redis password')
    .addHelpText('after', `
Examples:
  $ hedera-multisig server -t 2 -k "key1,key2,key3"
  $ hedera-multisig server -t 2 -k "key1,key2" --port 8080 --no-tunnel
  $ hedera-multisig server -t 2 -k "key1,key2" --tls-cert ./cert.pem --tls-key ./key.pem
  $ hedera-multisig server -t 2 -k "key1,key2" --redis --redis-host redis.example.com
    `)
    .action(async (options, command) => {
      // Load dependencies
      require('dotenv').config();
      const { SigningSessionManager, WebSocketServer } = require('../../server');
      const { createSessionStore } = require('../../server/stores');
      const { generateConnectionString } = require('../../shared/connection-string');
      const { ExitCodes, JsonOutput, initializeLogging, exitWithError } = require('../utils/cliUtils');

      // Get global options from parent command
      const globalOpts = command.optsWithGlobals();

      // Initialize logging
      const log = initializeLogging(globalOpts, 'Server');
      const jsonOutput = new JsonOutput(globalOpts.json);

      // Session file for auto-discovery
      const SESSION_FILE = path.join(process.cwd(), '.multisig-session.json');

      // Parse keys
      const eligibleKeys = options.keys.split(',').map(k => {
        const key = k.trim();
        return key.startsWith('0x') ? key : `0x${key}`;
      });

      // Validate
      if (options.threshold > eligibleKeys.length) {
        exitWithError(
          `Threshold (${options.threshold}) cannot exceed number of keys (${eligibleKeys.length})`,
          ExitCodes.VALIDATION_ERROR,
          jsonOutput
        );
      }

      const participants = options.participants || eligibleKeys.length;
      const timeoutMs = options.timeout * 60000;

      try {
        console.log(chalk.bold.cyan('\n🚀 Starting Hedera MultiSig Server\n'));
        console.log(chalk.cyan('═'.repeat(60)));

        // Create Hedera client
        let client;
        switch (options.network) {
          case 'mainnet': client = Client.forMainnet(); break;
          case 'previewnet': client = Client.forPreviewnet(); break;
          case 'local': client = Client.forLocalNode(); break;
          default: client = Client.forTestnet();
        }

        console.log(chalk.white('Network: ') + chalk.yellow(options.network));
        console.log(chalk.white('Threshold: ') + chalk.yellow(`${options.threshold} of ${eligibleKeys.length}`));
        console.log(chalk.white('Expected Participants: ') + chalk.yellow(participants));
        console.log(chalk.white('Session Timeout: ') + chalk.yellow(`${options.timeout} minutes`));

        // Create session store
        const store = createSessionStore({
          type: options.redis ? 'redis' : 'memory',
          defaultTimeout: timeoutMs,
          redis: options.redis ? {
            host: options.redisHost,
            port: options.redisPort,
            password: options.redisPassword
          } : undefined
        });

        if (options.redis) {
          const connected = await store.connect();
          if (connected) {
            console.log(chalk.white('Session Store: ') + chalk.green('Redis') + chalk.gray(` (${options.redisHost}:${options.redisPort})`));
          } else {
            console.log(chalk.white('Session Store: ') + chalk.yellow('In-Memory (Redis unavailable)'));
          }
        } else {
          console.log(chalk.white('Session Store: ') + chalk.yellow('In-Memory'));
        }

        console.log(chalk.cyan('═'.repeat(60)) + '\n');

        // Create session manager
        const sessionManager = new SigningSessionManager(client, {
          defaultTimeout: timeoutMs,
          verbose: true,
          store: store
        });

        // Build TLS config
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
            provider: 'auto'
          } : null,
          tls: tlsConfig
        });

        // Start server
        const serverInfo = await wsServer.start();

        // Create session
        const session = await sessionManager.createSession(null, {
          threshold: options.threshold,
          eligiblePublicKeys: eligibleKeys,
          expectedParticipants: participants,
          timeout: timeoutMs,
          pin: options.pin,

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

        const sessionData = {
          sessionId: session.sessionId,
          pin: session.pin,
          serverUrl: shareUrl,
          localUrl: serverInfo.url,
          publicUrl: serverInfo.publicUrl || null,
          connectionString: connectionString,
          network: options.network,
          threshold: options.threshold,
          expectedParticipants: participants,
          expiresAt: session.expiresAt,
          createdAt: Date.now()
        };

        // JSON mode output
        if (globalOpts.json) {
          jsonOutput.set('session', sessionData);
          jsonOutput.set('status', 'running');
          jsonOutput.print(true);
        } else {
          // Interactive mode output
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
          console.log(chalk.bold.white('\n📱 SCAN QR CODE TO JOIN:\n'));
          qrcode.generate(connectionString, { small: true }, (qr) => {
            console.log(qr);
          });

          console.log(chalk.white('\nParticipants can also run:'));
          console.log(chalk.gray(`  hedera-multisig participant -u "${shareUrl}" -s "${session.sessionId}" -p "${session.pin}"\n`));
        }

        // Write session file
        try {
          fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2), 'utf8');
          if (!globalOpts.json) {
            console.log(chalk.cyan('═'.repeat(60)));
            console.log(chalk.green(`✅ Session file written: ${SESSION_FILE}`));
            console.log(chalk.gray('   Other scripts will auto-detect this session.\n'));
          }
        } catch (error) {
          console.log(chalk.yellow(`⚠️  Could not write session file: ${error.message}`));
        }

        if (!globalOpts.json) {
          console.log(chalk.cyan('═'.repeat(60)));
          console.log(chalk.bold.white('\n⏳ Waiting for participants to connect and become ready...\n'));
        }

        // Handle shutdown
        const cleanup = async () => {
          if (!globalOpts.json) {
            console.log(chalk.yellow('\n\n⚠️  Shutting down server...'));
          }
          try {
            if (fs.existsSync(SESSION_FILE)) {
              fs.unlinkSync(SESSION_FILE);
            }
          } catch (e) { /* ignore */ }
          await wsServer.stop();
          sessionManager.shutdown();
          process.exit(ExitCodes.SUCCESS);
        };

        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);

      } catch (error) {
        exitWithError(error.message, ExitCodes.SESSION_ERROR, jsonOutput);
      }
    });
};

function getDefaultNetwork() {
  const env = (process.env.ENVIRONMENT || 'TEST').toUpperCase();
  switch (env) {
    case 'MAIN': case 'MAINNET': return 'mainnet';
    case 'PREVIEW': case 'PREVIEWNET': return 'previewnet';
    case 'LOCAL': case 'LOCALHOST': return 'local';
    default: return 'testnet';
  }
}
