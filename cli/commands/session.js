/**
 * Session Command
 *
 * CLI commands for inspecting and managing multi-sig signing sessions.
 * Uses the SigningClient to connect to a running server and retrieve
 * session information without participating in signing.
 *
 * Subcommands:
 *   - status: Connect to a session and display its current state
 *   - list:   Connect to a server and list active sessions
 */

const chalk = require('chalk');

module.exports = function(program) {
  const session = program
    .command('session')
    .description('Inspect and manage multi-sig signing sessions');

  // ============================================================================
  // session status
  // ============================================================================
  session
    .command('status')
    .description('Connect to a session and display its current status')
    .requiredOption('-c, --connect <connectionString>', 'Connection string (hmsc:...)')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Connect to a multi-sig session server, authenticate, retrieve session info,
display it, and disconnect. Does not join as a participant.

Examples:
  # Get session status
  $ hedera-multisig session status --connect hmsc:eyJz...

  # JSON output for scripting
  $ hedera-multisig session status --connect hmsc:eyJz... --json

Connection String Format:
  hmsc:base64(JSON) where JSON = {s: serverUrl, i: sessionId, p: pin}
    `)
    .action(async (options, command) => {
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');
      const { parseConnectionString } = require('../../shared/connection-string');
      const WebSocket = require('ws');

      const globalOpts = command.optsWithGlobals();
      const jsonOutput = new JsonOutput(options.json || globalOpts.json);

      try {
        const parsed = parseConnectionString(options.connect);
        if (!parsed) {
          throw new Error('Invalid connection string format. Expected hmsc:... format.');
        }

        const { serverUrl, sessionId, pin } = parsed;

        if (!jsonOutput.enabled) {
          console.log(chalk.bold.cyan('\nSession Status Query\n'));
          console.log(chalk.white(`Server:     ${serverUrl}`));
          console.log(chalk.white(`Session ID: ${sessionId}`));
          console.log(chalk.white('Connecting...\n'));
        }

        const sessionInfo = await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            ws.close();
            reject(new Error('Connection timed out after 15 seconds'));
          }, 15000);

          const ws = new WebSocket(serverUrl);

          ws.on('open', () => {
            ws.send(JSON.stringify({
              type: 'AUTH',
              payload: {
                sessionId,
                pin,
                role: 'participant',
                label: '__session_status_probe__'
              }
            }));
          });

          ws.on('message', (data) => {
            try {
              const message = JSON.parse(data.toString());

              if (message.type === 'AUTH_SUCCESS') {
                clearTimeout(timeoutId);
                const info = message.payload.sessionInfo;
                info.participantId = message.payload.participantId;
                ws.close();
                resolve(info);
              } else if (message.type === 'AUTH_FAILED') {
                clearTimeout(timeoutId);
                ws.close();
                reject(new Error(`Authentication failed: ${message.payload.message}`));
              }
            } catch (parseError) {
              clearTimeout(timeoutId);
              ws.close();
              reject(new Error(`Failed to parse server response: ${parseError.message}`));
            }
          });

          ws.on('error', (error) => {
            clearTimeout(timeoutId);
            reject(new Error(`WebSocket error: ${error.message}`));
          });
        });

        // Output session info
        if (jsonOutput.enabled) {
          jsonOutput.set('sessionId', sessionInfo.sessionId);
          jsonOutput.set('status', sessionInfo.status);
          jsonOutput.set('threshold', sessionInfo.threshold);
          jsonOutput.set('participants', sessionInfo.participants || []);
          jsonOutput.set('participantCount', sessionInfo.participantCount || 0);
          jsonOutput.set('eligibleKeys', sessionInfo.eligibleKeys || []);
          jsonOutput.set('expiresAt', sessionInfo.expiresAt);
          if (sessionInfo.createdAt) {
            jsonOutput.set('createdAt', sessionInfo.createdAt);
          }
          jsonOutput.print(true);
        } else {
          console.log(chalk.cyan('═'.repeat(60)));
          console.log(chalk.bold.white('  SESSION STATUS\n'));

          console.log(`  Session ID:       ${sessionInfo.sessionId}`);
          console.log(`  Status:           ${formatStatus(sessionInfo.status)}`);
          console.log(`  Threshold:        ${sessionInfo.threshold} signatures required`);

          if (sessionInfo.participantCount !== undefined) {
            console.log(`  Participants:     ${sessionInfo.participantCount} connected`);
          }

          if (sessionInfo.participants && sessionInfo.participants.length > 0) {
            console.log('\n  Connected Participants:');
            for (const p of sessionInfo.participants) {
              const label = typeof p === 'string' ? p : (p.label || p.participantId || p.id || 'unknown');
              const status = typeof p === 'object' && p.status ? ` (${p.status})` : '';
              console.log(`    - ${label}${status}`);
            }
          }

          if (sessionInfo.eligibleKeys && sessionInfo.eligibleKeys.length > 0) {
            console.log(`\n  Eligible Keys:    ${sessionInfo.eligibleKeys.length}`);
            for (const key of sessionInfo.eligibleKeys) {
              const short = key.length > 24 ? key.substring(0, 12) + '...' + key.substring(key.length - 8) : key;
              console.log(`    - ${short}`);
            }
          }

          if (sessionInfo.expiresAt) {
            const remaining = Math.max(0, Math.floor((sessionInfo.expiresAt - Date.now()) / 60000));
            console.log(`\n  Expires In:       ${remaining} minutes`);
          }

          console.log('\n' + chalk.cyan('═'.repeat(60)) + '\n');
        }

        process.exit(ExitCodes.SUCCESS);

      } catch (error) {
        if (jsonOutput.enabled) {
          jsonOutput.addError(error.message);
          jsonOutput.print(false);
        } else {
          console.error(`\nError: ${error.message}\n`);
        }
        process.exit(ExitCodes.SESSION_ERROR);
      }
    });

  // ============================================================================
  // session list
  // ============================================================================
  session
    .command('list')
    .description('Connect to a server and list active sessions (requires coordinator auth)')
    .requiredOption('-u, --url <url>', 'WebSocket server URL')
    .option('-p, --pin <pin>', 'Coordinator PIN/token for authentication')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Connect to a multi-sig server and request a list of active sessions.
Requires coordinator-level authentication.

Examples:
  # List sessions on local server
  $ hedera-multisig session list --url ws://localhost:3000

  # List sessions with auth
  $ hedera-multisig session list --url ws://localhost:3000 --pin COORD_TOKEN

  # JSON output
  $ hedera-multisig session list --url ws://localhost:3000 --json
    `)
    .action(async (options, command) => {
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');
      const WebSocket = require('ws');

      const globalOpts = command.optsWithGlobals();
      const jsonOutput = new JsonOutput(options.json || globalOpts.json);

      try {
        if (!jsonOutput.enabled) {
          console.log(chalk.bold.cyan('\nSession List Query\n'));
          console.log(chalk.white(`Server: ${options.url}`));
          console.log(chalk.white('Connecting...\n'));
        }

        const sessions = await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            ws.close();
            reject(new Error('Connection timed out after 15 seconds'));
          }, 15000);

          const ws = new WebSocket(options.url);

          ws.on('open', () => {
            const payload = {
              role: 'coordinator'
            };
            if (options.pin) {
              payload.pin = options.pin;
            }
            ws.send(JSON.stringify({
              type: 'LIST_SESSIONS',
              payload
            }));
          });

          ws.on('message', (data) => {
            try {
              const message = JSON.parse(data.toString());

              if (message.type === 'SESSION_LIST') {
                clearTimeout(timeoutId);
                ws.close();
                resolve(message.payload.sessions || []);
              } else if (message.type === 'AUTH_FAILED' || message.type === 'ERROR') {
                clearTimeout(timeoutId);
                ws.close();
                const errorMsg = message.payload?.message || message.payload?.error || 'Server rejected request';
                reject(new Error(errorMsg));
              }
            } catch (parseError) {
              clearTimeout(timeoutId);
              ws.close();
              reject(new Error(`Failed to parse server response: ${parseError.message}`));
            }
          });

          ws.on('error', (error) => {
            clearTimeout(timeoutId);
            reject(new Error(`WebSocket error: ${error.message}`));
          });
        });

        // Output session list
        if (jsonOutput.enabled) {
          jsonOutput.set('sessions', sessions);
          jsonOutput.set('count', sessions.length);
          jsonOutput.print(true);
        } else {
          if (sessions.length === 0) {
            console.log(chalk.yellow('No active sessions found.\n'));
          } else {
            console.log(chalk.cyan('═'.repeat(60)));
            console.log(chalk.bold.white(`  ACTIVE SESSIONS (${sessions.length})\n`));

            for (const s of sessions) {
              const id = s.sessionId || s.id || 'unknown';
              const status = s.status || 'unknown';
              const threshold = s.threshold || '?';
              const participants = s.participantCount || (s.participants ? s.participants.length : 0);

              console.log(`  ${chalk.bold(id)}`);
              console.log(`    Status:       ${formatStatus(status)}`);
              console.log(`    Threshold:    ${threshold}`);
              console.log(`    Participants: ${participants}`);

              if (s.expiresAt) {
                const remaining = Math.max(0, Math.floor((s.expiresAt - Date.now()) / 60000));
                console.log(`    Expires In:   ${remaining} minutes`);
              }
              console.log('');
            }

            console.log(chalk.cyan('═'.repeat(60)) + '\n');
          }
        }

        process.exit(ExitCodes.SUCCESS);

      } catch (error) {
        if (jsonOutput.enabled) {
          jsonOutput.addError(error.message);
          jsonOutput.print(false);
        } else {
          console.error(`\nError: ${error.message}\n`);
        }
        process.exit(ExitCodes.SESSION_ERROR);
      }
    });
};

// ============================================================================
// Shared helpers
// ============================================================================

/**
 * Format a session status string with color.
 *
 * @param {string} status - Session status string
 * @returns {string} Chalk-formatted status string
 */
function formatStatus(status) {
  switch (status) {
    case 'waiting':
    case 'waiting-for-participants':
      return chalk.yellow(status);
    case 'ready':
    case 'all-ready':
      return chalk.green(status);
    case 'transaction-received':
    case 'signing':
      return chalk.blue(status);
    case 'executed':
    case 'completed':
      return chalk.green(status);
    case 'expired':
    case 'failed':
      return chalk.red(status);
    default:
      return status;
  }
}
