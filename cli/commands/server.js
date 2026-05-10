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
    .option('--port <port>', 'Server port', (v) => parseInt(v, 10), 3000)
    .option('--host <host>', 'Server host', 'localhost')
    .option('--timeout <minutes>', 'Session timeout in minutes (default: 30 for realtime sessions). Pass 0 for an unbounded session that lives until the server is stopped — recommended when human coordination across signers may take hours.', (v) => parseInt(v, 10), 30)
    .option('--session-timeout <input>', 'Ceremony-session timeout for scheduled-mode sessions. ISO-8601 ("2026-06-30T12:00:00Z") or duration ("30d", "2h"). Default 24h. Match this to your --expiration-time on `schedule create` so the dApp coordinator session doesn\'t expire mid-window. Max ~62 days (HIP-423).')
    .option('--no-tunnel', 'Disable automatic tunnel (local-only)')
    .option('--tunnel-provider <name>', 'Tunnel provider when --no-tunnel is NOT set: "auto" (default; tries ngrok first if NGROK_AUTH_TOKEN is set, falls back to localtunnel), "ngrok" (force ngrok; requires NGROK_AUTH_TOKEN), or "localtunnel" (force localtunnel).', 'auto')
    .option('--tunnel-url <wss-url>', 'Use an existing externally-managed tunnel instead of starting one. Skips the embedded ngrok/localtunnel wrappers entirely — you run `ngrok http 3001` (or whatever) yourself, then pass the printed wss:// URL here. Useful when the embedded wrapper hits "invalid tunnel configuration" or you want a stable subdomain.')
    .option('--pin <token>', 'Custom session token (auto-generated if not provided)')
    .option('-n, --network <network>', 'Hedera network (testnet|mainnet)', getDefaultNetwork())
    .option('--tls-cert <path>', 'Path to TLS certificate file (enables WSS)')
    .option('--tls-key <path>', 'Path to TLS private key file')
    .option('--tls-ca <path>', 'Path to CA certificate file')
    .option('--tls-passphrase <pass>', 'Passphrase for private key')
    .option('--redis', 'Enable Redis session persistence')
    .option('--redis-host <host>', 'Redis host', process.env.REDIS_HOST || 'localhost')
    .option('--redis-port <port>', 'Redis port', (v) => parseInt(v, 10), parseInt(process.env.REDIS_PORT, 10) || 6379)
    .option('--redis-password <pass>', 'Redis password')
    .option('--allowed-origins <origins>', 'Comma-separated allow-list of WebSocket browser origins. Must match the browser\'s Origin header verbatim — no trailing slash, include the port if non-default (e.g. "http://localhost:3000" for Next.js dev, "https://multisig.example.com" for prod)')
    .option('--unsafe-any-origin', 'Allow any browser origin (development only — required if you skip --allowed-origins for tunnel mode)')
    .option('--quiet-secrets', 'Do not print PIN, coordinator token, or agent API key to stdout. Write them to .multisig-session.json only — useful when stdout is captured by a log aggregator.')
    .addHelpText('after', `
Examples:
  $ hedera-multisig server -t 2 -k "key1,key2,key3"
  $ hedera-multisig server -t 2 -k "key1,key2" --port 8080 --no-tunnel
  $ hedera-multisig server -t 2 -k "key1,key2" --tls-cert ./cert.pem --tls-key ./key.pem
  $ hedera-multisig server -t 2 -k "key1,key2" --redis --redis-host redis.example.com
    `)
    .action(async (options, command) => {
      // Load dependencies. `loadDotenvFromAncestors` walks up from cwd
      // looking for a `.env`, so running this CLI from a walkthrough
      // subdirectory (e.g. examples/walkthrough-dapp/) finds the
      // repo-root `.env` instead of falling through with operator
      // creds + NGROK_AUTH_TOKEN unset. Returns the path it loaded
      // (or null) — useful for verbose-mode diagnostics.
      const { ExitCodes, JsonOutput, initializeLogging, exitWithError, loadDotenvFromAncestors } = require('../utils/cliUtils');
      const dotenvPath = loadDotenvFromAncestors();
      const { SigningSessionManager, WebSocketServer } = require('../../server');
      const { createSessionStore } = require('../../server/stores');
      const { generateConnectionString } = require('../../shared/connection-string');

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
      // `--timeout 0` is the documented opt-in for an unbounded session.
      // We pass `null` to the store/manager as the sentinel — the cleanup
      // loop and `getSession` both skip null-expiry sessions, and the
      // banner below renders an honest "no automatic expiry" line.
      const timeoutMs = options.timeout === 0 ? null : options.timeout * 60000;
      const isUnbounded = timeoutMs === null;

      // Validate --tunnel-provider up front so a typo fails before we
      // bind ports + register signers, not after.
      const validProviders = ['auto', 'ngrok', 'localtunnel'];
      if (options.tunnel && !validProviders.includes(options.tunnelProvider)) {
        console.error(
          `\n❌ Invalid --tunnel-provider "${options.tunnelProvider}". ` +
          `Valid values: ${validProviders.join(', ')}.\n`
        );
        process.exit(1);
      }

      try {
        console.log(chalk.bold.cyan('\n🚀 Starting Hedera MultiSig Server\n'));
        console.log(chalk.cyan('═'.repeat(60)));

        // Show which .env was loaded so a misconfigured cwd doesn't
        // become a 5-minute mystery the next time NGROK_AUTH_TOKEN is
        // missing-but-set.
        if (dotenvPath) {
          console.log(chalk.gray(`Loaded .env: ${dotenvPath}`));
        } else {
          console.log(chalk.yellow(
            '⚠  No .env file found by walking up from cwd. ' +
            'Set OPERATOR_ID / OPERATOR_KEY / NGROK_AUTH_TOKEN in your shell ' +
            'or create a .env in this directory or any parent.'
          ));
        }

        // Create Hedera client
        let client;
        switch (options.network) {
          case 'mainnet': client = Client.forMainnet(); break;
          case 'previewnet': client = Client.forPreviewnet(); break;
          case 'local': client = Client.forLocalNode(); break;
          default: client = Client.forTestnet();
        }

        console.log(chalk.white('Network: ') + chalk.yellow(options.network));
        // Phase F2: parse the optional --session-timeout for scheduled-mode
        // ceremonies (uses the same parser as `schedule create --expiration-time`).
        let scheduledDefaultTimeoutMs;
        if (options.sessionTimeout) {
          const { parseExpirationTime } = require('../utils/timeParser');
          const parsedDate = parseExpirationTime(options.sessionTimeout);
          if (parsedDate) {
            scheduledDefaultTimeoutMs = parsedDate.getTime() - Date.now();
          }
        }

        console.log(chalk.white('Threshold: ') + chalk.yellow(`${options.threshold} of ${eligibleKeys.length}`));
        console.log(chalk.white('Expected Participants: ') + chalk.yellow(participants));
        // Honest banner: the timeout is a soft cap, not a hard kill.
        // After expiry the server refuses new auth/inject/sign requests
        // and disconnects participants with SESSION_EXPIRED — but TCP
        // sockets that are mid-flight aren't cut. `--timeout 0` opts
        // out entirely (recommended when signer coordination may take
        // hours).
        if (isUnbounded) {
          console.log(chalk.white('Session Timeout: ') + chalk.yellow('none (--timeout 0; lives until you stop the server)'));
        } else {
          console.log(chalk.white('Session Timeout: ') + chalk.yellow(`${options.timeout} minutes`));
          console.log(chalk.gray('   After expiry the server refuses new auth/sign requests and'));
          console.log(chalk.gray('   sends SESSION_EXPIRED to connected participants. Use'));
          console.log(chalk.gray('   --timeout 0 if signers may take hours to coordinate.'));
        }
        if (scheduledDefaultTimeoutMs) {
          const days = (scheduledDefaultTimeoutMs / 86400000).toFixed(1);
          console.log(chalk.white('Scheduled Session Timeout: ') + chalk.yellow(`${days} days (overrides 24h default)`));
        }

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
          scheduledDefaultTimeout: scheduledDefaultTimeoutMs, // F2: undefined = 24h fallback inside manager
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

        // Origin policy (Phase B3 hardening)
        const allowedOrigins = options.allowedOrigins
          ? options.allowedOrigins.split(',').map((o) => o.trim()).filter(Boolean)
          : null;

        // External tunnel mode: when the user has provided a public
        // URL via --tunnel-url, skip the embedded ngrok/localtunnel
        // wrappers entirely. The URL is treated as the public WSS URL
        // for the connection-string and HMSC. Useful when the
        // embedded ngrok wrapper hits "invalid tunnel configuration"
        // (binary version mismatch, conflicting ~/.ngrok2/ngrok.yml,
        // etc.) — the user can just run `ngrok http 3001` themselves
        // in another terminal and pass the printed URL here.
        const externalTunnelUrl = options.tunnelUrl ? String(options.tunnelUrl).trim() : null;
        if (externalTunnelUrl && !/^wss?:\/\//i.test(externalTunnelUrl)) {
          console.error(
            `\n❌ --tunnel-url must start with ws:// or wss:// — got "${externalTunnelUrl}".\n` +
            `   ngrok prints an https://… URL; replace the scheme: https → wss.\n`
          );
          process.exit(1);
        }

        // Create WebSocket server
        const wsServer = new WebSocketServer(sessionManager, {
          port: options.port,
          host: options.host,
          verbose: true,
          // Disable the embedded tunnel start when the user supplied
          // their own — the WSS server still binds to localhost; only
          // the share-URL changes.
          tunnel: options.tunnel && !externalTunnelUrl ? {
            enabled: true,
            provider: options.tunnelProvider || 'auto',
          } : null,
          tls: tlsConfig,
          allowedOrigins,
          unsafeAnyOrigin: options.unsafeAnyOrigin === true
        });

        // Start server
        const serverInfo = await wsServer.start();
        // Splice the externally-managed tunnel URL onto serverInfo so
        // the rest of the flow (connection-string, banner, HMSC)
        // treats it as the public URL.
        if (externalTunnelUrl) {
          serverInfo.publicUrl = externalTunnelUrl;
          if (true) {
            console.log(chalk.bold.green('✅ Using external tunnel'));
            console.log(chalk.cyan('─'.repeat(50)));
            console.log(chalk.white('Public URL: ') + chalk.yellow(externalTunnelUrl));
            console.log(chalk.gray('Skipped embedded ngrok/localtunnel wrappers (--tunnel-url).'));
            console.log(chalk.cyan('─'.repeat(50)) + '\n');
          }
        }

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
          coordinatorToken: session.coordinatorToken,
          agentApiKey: session.agentApiKey,
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
          if (options.quietSecrets) {
            // Phase C19: stdout may be captured by Vector/Datadog/etc. Don't
            // ship secrets through it. Operator reads them from the session
            // file or QR code instead.
            console.log(chalk.gray('PIN: ') + chalk.dim('(hidden — set without --quiet-secrets, or read .multisig-session.json)'));
            console.log(chalk.gray('Coordinator Token: ') + chalk.dim('(hidden)'));
            console.log(chalk.gray('Agent API Key: ') + chalk.dim('(hidden)'));
          } else {
            console.log(chalk.white('PIN: ') + chalk.bold.yellow(session.pin));
            console.log(chalk.white('Coordinator Token: ') + chalk.bold.red(session.coordinatorToken));
            console.log(chalk.gray('  (Keep this secret — required to authenticate as coordinator)'));
            console.log(chalk.white('Agent API Key: ') + chalk.bold.red(session.agentApiKey));
            console.log(chalk.gray('  (Share with agents — alternative to PIN for programmatic access)'));
          }

          if (serverInfo.publicUrl) {
            console.log(chalk.white('Public URL: ') + chalk.yellow(serverInfo.publicUrl));
            console.log(chalk.white('Local URL: ') + chalk.gray(serverInfo.url));
          } else {
            console.log(chalk.white('Local URL: ') + chalk.yellow(serverInfo.url));
          }

          console.log(chalk.white('Expires: ') + chalk.yellow(new Date(session.expiresAt).toLocaleString()));
          console.log(chalk.cyan('═'.repeat(60)));

          if (!options.quietSecrets) {
            console.log(chalk.bold.white('\n📋 SHARE WITH PARTICIPANTS:\n'));
            console.log(chalk.yellow(`Server URL: ${shareUrl}`));
            console.log(chalk.yellow(`Session ID: ${session.sessionId}`));
            console.log(chalk.yellow(`PIN: ${session.pin}\n`));

            console.log(chalk.bold.white('🔗 CONNECTION STRING (paste in dApp):'));
            console.log(chalk.cyan(`  ${connectionString}\n`));
          } else {
            console.log(chalk.bold.white('\n📋 SHARE WITH PARTICIPANTS:'));
            console.log(chalk.gray('  PIN, connection string, and QR code suppressed (--quiet-secrets).'));
            console.log(chalk.gray('  Read .multisig-session.json or distribute via your secrets manager.\n'));
          }

          // Display QR code
          if (!options.quietSecrets) {
            console.log(chalk.bold.white('\n📱 SCAN QR CODE TO JOIN:\n'));
            qrcode.generate(connectionString, { small: true }, (qr) => {
              console.log(qr);
            });

            console.log(chalk.white('\nParticipants can also run:'));
            console.log(chalk.gray(`  hedera-multisig participant -u "${shareUrl}" -s "${session.sessionId}" -p "${session.pin}"\n`));
          }
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
