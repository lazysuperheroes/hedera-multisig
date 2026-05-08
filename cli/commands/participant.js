/**
 * Participant Command
 *
 * Connect to a multi-signature session as a participant.
 */

const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

module.exports = function(program) {
  program
    .command('participant')
    .description('Join a session as a participant')
    .option('-c, --connect <connectionString>', 'Connection string (hmsc:...) — includes server URL, session ID, and PIN')
    .option('-u, --url <url>', 'WebSocket server URL (alternative to --connect)')
    .option('-s, --session <id>', 'Session ID (alternative to --connect)')
    .option('-p, --pin <pin>', 'Session token (alternative to --connect)')
    .option('-f, --keyfile <path>', 'Load encrypted key file (RECOMMENDED)')
    .option('--passphrase <value>', 'Passphrase for the encrypted key file (skips the interactive prompt; visible in process list — prefer interactive entry on production machines)')
    .option('-k, --key <key>', 'Private key hex string (DEPRECATED: visible in process list, use --keyfile)')
    .option('-l, --label <label>', 'Participant label')
    .option('-y, --yes', 'Non-interactive mode (skip prompts)')
    .addHelpText('after', `
Examples:
  # Join using connection string (recommended; will prompt for passphrase)
  $ hedera-multisig participant --connect hmsc:eyJz... -f keys.encrypted

  # Non-interactive (CI / scripted walkthroughs) — passphrase on the command line
  $ hedera-multisig participant --connect hmsc:eyJz... -f keys.encrypted --passphrase walkthrough-test

  # Join using individual parameters
  $ hedera-multisig participant -u ws://localhost:3000 -s abc123 -p TOKEN123 -f keys.encrypted
    `)
    .action(async (options, command) => {
      const { PrivateKey } = require('@hashgraph/sdk');
      const { SigningClient } = require('../../client');
      const EncryptedFileProvider = require('../../keyManagement/EncryptedFileProvider');
      const MirrorNodeClient = require('../../shared/mirror-node-client');
      const { ExitCodes, JsonOutput, initializeLogging, exitWithError } = require('../utils/cliUtils');
      const readlineSync = require('readline-sync');

      // Get global options
      const globalOpts = command.optsWithGlobals();

      // Initialize logging
      const log = initializeLogging(globalOpts, 'Participant');
      const jsonOutput = new JsonOutput(globalOpts.json);

      try {
        // Resolve connection parameters from --connect or --url/--session/--pin
        let serverUrl = options.url;
        let sessionId = options.session;
        let pin = options.pin;

        if (options.connect) {
          const { parseConnectionString } = require('../../shared/connection-string');
          const parsed = parseConnectionString(options.connect);
          if (!parsed) {
            exitWithError('Invalid connection string format. Expected hmsc:... format.', ExitCodes.INVALID_INPUT);
            return;
          }
          serverUrl = parsed.serverUrl;
          sessionId = parsed.sessionId;
          pin = parsed.pin;
        }

        if (!serverUrl || !sessionId || !pin) {
          exitWithError('Must provide either --connect <hmsc:...> or all of --url, --session, --pin', ExitCodes.INVALID_INPUT);
          return;
        }

        console.log(chalk.bold.cyan('\n👥 Hedera MultiSig Participant\n'));

        // Build identifier — proves which version of the participant code
        // is actually running. After every code change, the hash of the
        // critical files changes; if you don't see a fresh build hash
        // after restart, the process is stale.
        try {
          const crypto = require('crypto');
          const pkg = require('../../package.json');
          const sigClientPath = require.resolve('../../client/SigningClient.js');
          const participantPath = __filename;
          const sigClientHash = crypto
            .createHash('sha256')
            .update(require('fs').readFileSync(sigClientPath))
            .digest('hex')
            .slice(0, 8);
          const participantHash = crypto
            .createHash('sha256')
            .update(require('fs').readFileSync(participantPath))
            .digest('hex')
            .slice(0, 8);
          console.log(chalk.gray(
            `   v${pkg.version}  build SigningClient=${sigClientHash}  participant.js=${participantHash}\n`
          ));
        } catch {
          // non-fatal — banner is informational
        }

        console.log(chalk.cyan('═'.repeat(60)));

        // Create signing client
        const client = new SigningClient({
          verbose: true,
          label: options.label
        });

        // Connect to session
        console.log(chalk.white('Connecting to session...\n'));
        const connectionResult = await client.connect(
          serverUrl,
          sessionId,
          pin
        );

        // Load private key
        let privateKey;

        console.log(chalk.cyan('═'.repeat(60)));
        console.log(chalk.bold.white('LOAD PRIVATE KEY\n'));
        console.log(chalk.yellow('⚠️  Your private key will be loaded into memory locally.'));
        console.log(chalk.yellow('⚠️  It will NEVER be transmitted over the network.\n'));

        if (options.keyfile) {
          // Option 1: Load from encrypted file
          console.log(chalk.green(`✅ Loading from encrypted file: ${options.keyfile}\n`));

          // Production warning: --passphrase on mainnet leaks the secret into
          // shell history and process listings. Don't hard-block (some setups
          // have a sanitized env, e.g. systemd EnvironmentFile or an HSM-fronted
          // wrapper) — but make sure operators see the risk.
          if (options.passphrase) {
            const net = (process.env.HEDERA_NETWORK || process.env.ENVIRONMENT || 'testnet').toLowerCase();
            if (net.startsWith('main')) {
              console.log(chalk.bold.red('⚠️  WARNING: --passphrase on mainnet'));
              console.log(chalk.red('   The passphrase is now in your shell history and process listings.'));
              console.log(chalk.red('   For production multi-sig, prefer interactive entry (omit --passphrase),'));
              console.log(chalk.red('   stdin redirect, a secrets manager, or a hardware-backed key.\n'));
            }
          }

          const provider = new EncryptedFileProvider(options.keyfile, {
            passphrase: options.passphrase,
            promptIfMissing: !options.passphrase
          });
          const keys = await provider.getKeys();
          // EncryptedFileProvider returns an array of PrivateKey instances
          // (via KeyProvider.validateKeys → parsePrivateKey). The
          // `.privateKey` fallback covers older provider shapes that
          // returned `{ privateKey, publicKey }` plain objects.
          privateKey = keys[0].privateKey || keys[0];
          console.log(chalk.green('✅ Key loaded successfully from encrypted file\n'));

        } else if (options.key) {
          // Option 2: Inline key (DEPRECATED — visible in process lists and shell history)
          console.log(chalk.yellow('⚠️  DEPRECATED: --key flag exposes your private key in process lists and shell history.'));
          console.log(chalk.yellow('   Use --keyfile instead for production. --key will be removed in a future version.\n'));
          privateKey = options.key;

        } else if (options.yes || globalOpts.yes) {
          // Non-interactive mode requires key
          exitWithError(
            'Non-interactive mode (--yes) requires --keyfile or --key to be provided',
            ExitCodes.VALIDATION_ERROR,
            jsonOutput
          );

        } else {
          // Interactive prompt
          console.log(chalk.bold.white('🔐 How would you like to load your private key?\n'));
          console.log(chalk.green('  1. Load from encrypted file (RECOMMENDED - most secure)'));
          console.log(chalk.yellow('  2. Enter hex key and save as encrypted file (secure)'));
          console.log(chalk.gray('  3. Enter hex key for this session only (less secure)\n'));

          const choice = readlineSync.question('Select option (1/2/3): ');

          if (choice === '1') {
            const keyFilePath = readlineSync.question('\nEnter path to encrypted key file: ');

            if (!fs.existsSync(keyFilePath)) {
              console.error(chalk.red(`\n❌ File not found: ${keyFilePath}\n`));
              process.exit(ExitCodes.FILE_ERROR);
            }

            const provider = new EncryptedFileProvider(keyFilePath);
            const keys = await provider.getKeys();
            // See note above re: PrivateKey-instance vs plain-object shape.
            privateKey = keys[0].privateKey || keys[0];
            console.log(chalk.green('\n✅ Key loaded successfully from encrypted file\n'));

          } else if (choice === '2') {
            console.log(chalk.white('\nEnter your private key to encrypt and save:'));
            const hexKey = readlineSync.question('Private key (hex): ', {
              hideEchoBack: true
            });

            privateKey = hexKey;

            const saveFile = readlineSync.keyInYN('\nSave this key as an encrypted file for future use?');

            if (saveFile) {
              const keyFileName = readlineSync.question('Enter filename (e.g., my-key.encrypted): ', {
                defaultInput: 'participant-key.encrypted'
              });

              const passphrase = readlineSync.question('Enter passphrase to encrypt: ', {
                hideEchoBack: true
              });

              const confirmPassphrase = readlineSync.question('Confirm passphrase: ', {
                hideEchoBack: true
              });

              if (passphrase !== confirmPassphrase) {
                console.log(chalk.red('\n❌ Passphrases do not match. Key will not be saved.'));
                console.log(chalk.yellow('⚠️  Continuing with current session only.\n'));
              } else {
                try {
                  const keyFilePath = path.resolve(keyFileName);
                  await EncryptedFileProvider.createEncryptedFile(keyFilePath, [hexKey], passphrase);
                  console.log(chalk.green(`\n✅ Encrypted key saved to: ${keyFilePath}`));
                  console.log(chalk.white(`   Use this file in future with: --keyfile ${keyFileName}\n`));
                } catch (error) {
                  console.error(chalk.red(`\n❌ Failed to save encrypted file: ${error.message}`));
                  console.log(chalk.yellow('⚠️  Continuing with current session only.\n'));
                }
              }
            }

          } else if (choice === '3') {
            console.log(chalk.yellow('\n⚠️  Key will only be used for this session'));
            console.log(chalk.yellow('⚠️  Consider using option 2 to save securely for future use\n'));

            privateKey = readlineSync.question('Enter your private key (hex): ', {
              hideEchoBack: true
            });

          } else {
            console.error(chalk.red('\n❌ Invalid option selected'));
            process.exit(ExitCodes.VALIDATION_ERROR);
          }
        }

        console.log('');
        const keyResult = client.loadKeys(privateKey);
        console.log(chalk.green(`✅ Public Key: ${keyResult.publicKey}\n`));

        // Mark as ready
        console.log(chalk.cyan('═'.repeat(60)));
        client.setReady();

        console.log(chalk.cyan('═'.repeat(60)));
        console.log(chalk.bold.green('\n✅ Ready and waiting for transaction injection...\n'));
        const sessionMinutesLeft = Math.floor(
          (connectionResult.sessionInfo.expiresAt - Date.now()) / 60000
        );
        if (Number.isFinite(sessionMinutesLeft) && sessionMinutesLeft > 0) {
          console.log(chalk.white('Signing-ceremony session is open for:'));
          console.log(chalk.yellow(`  ${sessionMinutesLeft} more minutes`));
          console.log(chalk.gray(
            '  (this is the ceremony window — once a transaction is injected, ' +
            'you have a separate, much shorter ~120-second sign window)\n'
          ));
        }
        console.log(chalk.white('When the coordinator injects a transaction:'));
        console.log(chalk.white('  1. You will see the decoded transaction details'));
        console.log(chalk.white('  2. You can review VERIFIED vs UNVERIFIED information'));
        console.log(chalk.white('  3. You will be prompted to approve (type "YES") or reject'));
        console.log(chalk.gray('     (rejecting one transaction does NOT disconnect — you can still sign future ones)\n'));
        console.log(chalk.cyan('═'.repeat(60)) + '\n');

        // Mirror-node-backed lookup of a schedule's on-chain expiration.
        // Used for ScheduleSignTransaction display so the participant sees
        // the real "the schedule stays alive until X" deadline rather than
        // just a generic reassurance. Resilient to mirror-node lag /
        // failure: silently logs a softer line if anything goes wrong.
        const network = (process.env.HEDERA_NETWORK || process.env.ENVIRONMENT || 'testnet').toLowerCase();
        const normalizedNetwork =
          network.startsWith('main') ? 'mainnet' :
          network.startsWith('preview') ? 'previewnet' : 'testnet';
        let mirrorClient = null;
        const getMirrorClient = () => {
          if (!mirrorClient) mirrorClient = new MirrorNodeClient(normalizedNetwork);
          return mirrorClient;
        };

        const fetchAndPrintScheduleExpiration = async (scheduleId) => {
          try {
            const lookup = Promise.resolve(getMirrorClient().getScheduleInfo(scheduleId));
            const timeout = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('mirror-node lookup timed out')), 2000)
            );
            const info = await Promise.race([lookup, timeout]);
            if (info.executedTimestamp) {
              console.log(chalk.gray(
                `   Schedule already executed at ${info.executedTimestamp} — your signature isn't needed.`
              ));
              return;
            }
            if (info.deletedTimestamp) {
              console.log(chalk.gray(
                `   Schedule was deleted at ${info.deletedTimestamp} — signing is no longer possible.`
              ));
              return;
            }
            if (info.expirationTime) {
              const expiresAt = new Date(info.expirationTime);
              const ms = expiresAt.getTime() - Date.now();
              if (Number.isFinite(ms) && ms > 0) {
                const days = Math.floor(ms / 86400000);
                const hours = Math.floor((ms % 86400000) / 3600000);
                const human =
                  days > 0
                    ? `~${days} day${days === 1 ? '' : 's'}${hours > 0 ? ` ${hours}h` : ''}`
                    : `~${hours}h`;
                console.log(chalk.gray(
                  `   Schedule on-chain expires ${expiresAt.toISOString()} (${human} from now).`
                ));
              } else {
                console.log(chalk.gray(
                  `   Schedule on-chain expired at ${expiresAt.toISOString()} — coordinator must create a new schedule.`
                ));
              }
            }
          } catch {
            // Mirror-node may be slow or the schedule may not yet have
            // propagated. Silent fall-back keeps the prompt clean.
          }
        };

        // Helper: show how long is left to sign once a tx is on the table.
        // Two regimes:
        //   - Live ceremony txs (transfers, contract calls, etc.): the
        //     Hedera 120-second validity is the ENTIRE window. If you miss
        //     it the ceremony fails and the coordinator must re-inject.
        //   - Scheduled-tx flow (ScheduleCreate / ScheduleSign): each
        //     individual ScheduleSign tx still has 120s validity, but the
        //     UNDERLYING SCHEDULE on-chain lives much longer (up to ~62d
        //     per HIP-423). Missing one 120s window just means the
        //     coordinator re-issues — the schedule itself is intact.
        const showTransactionWindow = (txDetails) => {
          if (!txDetails || !txDetails.validStartTimestamp) return;
          const validDuration = txDetails.transactionValidDuration || 120;
          const expiresAtMs = (txDetails.validStartTimestamp + validDuration) * 1000;
          const secondsLeft = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));

          const txType = txDetails.type;
          if (txType === 'ScheduleCreateTransaction') {
            console.log(chalk.bold.yellow(
              `\n⏱️  ${secondsLeft}s to submit this ScheduleCreateTransaction (Hedera 120s validity).`
            ));
            if (txDetails.expirationTime) {
              const scheduleExpiresAt = new Date(txDetails.expirationTime * 1000);
              const days = Math.max(0, Math.round((scheduleExpiresAt.getTime() - Date.now()) / 86400000));
              console.log(chalk.gray(
                `   Once created, the schedule on-chain accepts signatures until ` +
                `${scheduleExpiresAt.toISOString()} (~${days} day${days === 1 ? '' : 's'} from now).`
              ));
            }
            if (txDetails.scheduledTransactionType) {
              console.log(chalk.gray(
                `   Inner transaction type: ${txDetails.scheduledTransactionType}.`
              ));
            }
          } else if (txType === 'ScheduleSignTransaction') {
            console.log(chalk.bold.yellow(
              `\n⏱️  ${secondsLeft}s to land this ScheduleSignTransaction (Hedera 120s validity).`
            ));
            if (txDetails.scheduleId) {
              console.log(chalk.gray(`   Signing schedule: ${txDetails.scheduleId}`));
              // Fire-and-forget mirror-node lookup for the schedule's actual
              // on-chain expiration. Result lands below; user usually has
              // 5-30s reading the review block before typing YES, so a
              // ~200-500ms mirror-node round-trip arrives in time. Capped at
              // 2s; fallback line is the "stays alive until its own
              // expiration" reassurance below.
              fetchAndPrintScheduleExpiration(txDetails.scheduleId);
            }
            console.log(chalk.gray(
              `   If you miss this 120s window, the coordinator can re-issue — ` +
              `the schedule on-chain stays alive until its own expiration.`
            ));
          } else {
            console.log(chalk.bold.yellow(
              `\n⏱️  ${secondsLeft}s remaining to sign this transaction (Hedera 120s validity).`
            ));
            console.log(chalk.gray(
              `   Live ceremony — if the threshold isn't met within this window, ` +
              `the transaction expires and the coordinator must inject a new one.`
            ));
          }
        };

        // Handle events
        client.on('transactionReceived', (data) => {
          showTransactionWindow(data?.txDetails);
        });

        // HIP-423 scheduled-tx flow. Distinct from realtime:
        //   - No frozen-tx body to sign. The coordinator already
        //     submitted a ScheduleCreateTransaction on-chain; we just
        //     add this participant's signature via ScheduleSignTransaction.
        //   - Submission goes to the Hedera network directly (NOT
        //     through the WS server), so we need OPERATOR_ID/KEY in
        //     env to act as fee payer + Hedera client operator.
        //   - No 120s ticker — the schedule lives on-chain until its
        //     own expiration (up to ~62d). Missing the prompt is fine;
        //     the user can re-run `hedera-multisig schedule sign` later.
        //
        // Used both for live SCHEDULE_CREATED broadcasts AND for
        // late-joiners whose AUTH_SUCCESS sessionInfo carries an
        // already-announced scheduleId — same review/sign flow.
        const handleScheduledTransaction = async (data) => {
          // Field names come from server/WebSocketServer.js
          // SCHEDULE_CREATED broadcast payload (search for `type:
          // 'SCHEDULE_CREATED'` to confirm shape). Late-joiner
          // sessionInfo uses `scheduleExpirationTime` instead, so
          // we accept both and normalize.
          const {
            scheduleId,
            expirationTime: livePayloadExpiry,
            scheduleExpirationTime,
            scheduleMemo,
            payerAccountId,
            innerTxDetails,
          } = data || {};
          const expirationTime = livePayloadExpiry ?? scheduleExpirationTime;

          if (!scheduleId) {
            console.log(chalk.red('\n⚠️  scheduleCreated event missing scheduleId — ignoring.'));
            return;
          }

          console.log('\n' + chalk.cyan('═'.repeat(60)));
          console.log(chalk.bold.yellow('📅 Scheduled transaction (HIP-423)'));
          console.log(chalk.cyan('═'.repeat(60)));
          console.log(chalk.white(
            'Async signing — no 120-second window. Once you sign, your signature\n' +
            'lands on-chain via ScheduleSignTransaction. Hedera executes the\n' +
            'inner transaction when threshold is met or when the schedule expires.\n'
          ));

          console.log(chalk.bold.white('Schedule:'));
          console.log(chalk.white(`  ID:      ${scheduleId}`));
          if (expirationTime) {
            const expiresAt = new Date(expirationTime * 1000);
            const ms = expiresAt.getTime() - Date.now();
            if (Number.isFinite(ms) && ms > 0) {
              const days = Math.floor(ms / 86400000);
              const hours = Math.floor((ms % 86400000) / 3600000);
              const human = days > 0
                ? `~${days}d${hours > 0 ? ` ${hours}h` : ''}`
                : `~${hours}h`;
              console.log(chalk.white(`  Expires: ${expiresAt.toISOString()} (${human} from now)`));
            } else {
              console.log(chalk.yellow(`  Expires: ${expiresAt.toISOString()} (already expired!)`));
            }
          }
          if (scheduleMemo) console.log(chalk.white(`  Memo:    ${scheduleMemo}`));
          if (payerAccountId) console.log(chalk.white(`  Payer:   ${payerAccountId}`));
          console.log('');

          if (innerTxDetails && Object.keys(innerTxDetails).length > 0) {
            console.log(chalk.bold.white('Inner transaction:'));
            const innerType = innerTxDetails.type || 'Transaction';
            console.log(chalk.white(`  Type: ${innerType}`));
            for (const [k, v] of Object.entries(innerTxDetails)) {
              if (k === 'type' || k === 'abiJson') continue;
              const display = typeof v === 'object'
                ? JSON.stringify(v)
                : String(v);
              console.log(chalk.white(`  ${k}: ${display}`));
            }
            console.log('');
          }

          console.log(chalk.gray(
            'Verify the schedule on-chain:\n' +
            `  https://hashscan.io/${normalizedNetwork}/schedule/${scheduleId}\n`
          ));
          console.log(chalk.cyan('═'.repeat(60)));

          // Pre-prompt env check. CLI participants don't have a
          // wallet adapter; they need OPERATOR_ID/OPERATOR_KEY in
          // env to pay the ~$0.00001 ScheduleSign fee. We check
          // BEFORE asking for YES so the user doesn't approve and
          // then hit a wall — they can either Ctrl+C out, set the
          // env, and re-launch, or run `schedule sign` manually
          // from a separately-configured shell.
          require('../utils/cliUtils').loadDotenvFromAncestors();
          const operatorId = process.env.OPERATOR_ID;
          const operatorKey = process.env.OPERATOR_KEY;
          const operatorReady = !!(operatorId && operatorKey);

          if (!operatorReady) {
            console.log(chalk.bold.red(
              '\n⚠️  This terminal cannot submit ScheduleSign — OPERATOR_ID / OPERATOR_KEY missing in env.'
            ));
            console.log(chalk.white(
              '   The signer key (loaded from your keyfile) signs the schedule, but a\n' +
              '   Hedera operator account is needed to pay the ScheduleSign network fee.\n'
            ));
            console.log(chalk.white('   Two ways to proceed:'));
            console.log(chalk.white(
              '     1. Ctrl+C, set OPERATOR_ID / OPERATOR_KEY in your .env, and re-join.\n' +
              `     2. Sign from a separately-configured shell:\n` +
              `          hedera-multisig schedule sign --schedule-id ${scheduleId} \\\n` +
              `            --keyfile <your-keyfile> --passphrase <your-passphrase>\n`
            ));
            console.log(chalk.gray(
              '   The session stays open either way. The schedule lives on-chain until expiry.\n'
            ));
            console.log(chalk.cyan('═'.repeat(60)) + '\n');
            return;
          }

          // Decide: auto-approve (--yes) or prompt
          let approve;
          if (options.yes) {
            approve = true;
            console.log(chalk.gray('\n--yes was set — auto-approving and submitting ScheduleSign.\n'));
          } else {
            const ans = readlineSync.question(
              chalk.bold.cyan('\nSign this schedule? Type YES to approve, anything else to skip: ')
            );
            approve = ans.trim() === 'YES';
          }

          if (!approve) {
            console.log(chalk.yellow(
              '\n⚠️  You declined to sign this schedule.\n' +
              '   The schedule remains on-chain and may still execute if other\n' +
              '   signers reach threshold. You can sign later with:\n' +
              `     hedera-multisig schedule sign --schedule-id ${scheduleId} --keyfile <path>\n` +
              '   The session stays open — the coordinator may issue more schedules.\n'
            ));
            return;
          }

          // Submit the ScheduleSignTransaction. The participant's
          // `privateKey` (loaded earlier) signs the schedule itself;
          // the operator account just pays the wrapper's fee.
          try {
            const { Client, AccountId, PrivateKey } = require('@hashgraph/sdk');
            const ScheduledWorkflow = require('../../workflows/ScheduledWorkflow');

            const hederaClient = normalizedNetwork === 'mainnet'
              ? Client.forMainnet()
              : Client.forTestnet();
            hederaClient.setOperator(
              AccountId.fromString(operatorId),
              PrivateKey.fromString(operatorKey)
            );

            const workflow = new ScheduledWorkflow(hederaClient, { verbose: true });
            const result = await workflow.signSchedule(scheduleId, privateKey);

            if (result.success) {
              console.log(chalk.cyan('═'.repeat(60)));
              if (result.alreadyExecuted) {
                // Someone else's signature reached threshold first;
                // ours was a no-op. Inner tx already on-chain.
                console.log(chalk.bold.yellow(
                  '\n📭 Schedule already executed by another signer'
                ));
                console.log(chalk.white(
                  '   Your signature wasn\'t needed — the threshold was already met.\n' +
                  '   The inner transaction is on-chain. No fee charged for the duplicate.\n'
                ));
              } else if (result.executed) {
                // Our signature met the threshold; receipt carried
                // the inner tx's transactionId.
                console.log(chalk.bold.green(
                  '\n✅ Schedule signature submitted — threshold met!'
                ));
                if (result.transactionId) {
                  console.log(chalk.white(`   Sign tx:  ${result.transactionId}`));
                }
                if (result.innerTxId) {
                  console.log(chalk.bold.green(
                    `   🎉 Inner tx executed: ${result.innerTxId}`
                  ));
                  console.log(chalk.gray(
                    `      https://hashscan.io/${normalizedNetwork}/transaction/${result.innerTxId}`
                  ));
                }
              } else {
                // Sig accepted, more sigs still needed.
                console.log(chalk.bold.green(
                  '\n✅ Schedule signature submitted on-chain'
                ));
                if (result.transactionId) {
                  console.log(chalk.white(`   Sign tx: ${result.transactionId}`));
                }
                console.log(chalk.gray(
                  '   Threshold not yet met — the schedule waits for additional signers.\n' +
                  `   Track progress: hedera-multisig schedule status --schedule-id ${scheduleId}`
                ));
              }
              console.log(chalk.gray(
                '\nThe session stays open. The coordinator may issue another schedule\n' +
                'or a realtime transaction. Press Ctrl+C to disconnect.\n'
              ));
              console.log(chalk.cyan('═'.repeat(60)) + '\n');
            } else {
              console.error(chalk.bold.red('\n❌ ScheduleSign failed:'));
              console.error(chalk.red(`   ${result.error || 'unknown error'}`));
            }

            hederaClient.close();
          } catch (err) {
            console.error(chalk.bold.red('\n❌ ScheduleSign threw:'), err.message);
          }
        };

        client.on('scheduleCreated', (data) => {
          handleScheduledTransaction(data).catch((err) => {
            console.error(chalk.red('\n❌ Scheduled-tx handler crashed:'), err.message);
          });
        });

        // Late-joiner: when this participant joined an already-
        // announced scheduled session, AUTH_SUCCESS sessionInfo
        // carries the scheduleId + context. Replay the same flow as
        // a live SCHEDULE_CREATED so they get the same prompt
        // without having to drop to a separate CLI command.
        const sInfo = connectionResult.sessionInfo || {};
        if (sInfo.mode === 'scheduled' && sInfo.scheduleId) {
          // Defer one tick so all banners above print first.
          setImmediate(() => {
            console.log(chalk.gray(
              '\n💡 You joined a session that already has a scheduled transaction. ' +
              'Reviewing it now…'
            ));
            handleScheduledTransaction({
              scheduleId: sInfo.scheduleId,
              scheduleExpirationTime: sInfo.scheduleExpirationTime,
              scheduleMemo: sInfo.scheduleMemo,
              payerAccountId: sInfo.schedulePayerAccountId,
              innerTxDetails: sInfo.innerTxDetails,
            }).catch((err) => {
              console.error(chalk.red('\n❌ Late-join scheduled-tx review crashed:'), err.message);
            });
          });
        }

        client.on('transactionExecuted', (data) => {
          console.log(chalk.bold.green('\n✅ Transaction executed successfully!'));
          console.log(chalk.white(`   Transaction ID: ${data.transactionId}`));
          console.log(chalk.white(`   Status: ${data.status}\n`));

          console.log(chalk.cyan('═'.repeat(60)));
          console.log(chalk.bold.green('\n✅ Ready for next transaction!'));
          console.log(chalk.white('Session remains open. The coordinator can inject additional transactions.'));
          console.log(chalk.gray('Press Ctrl+C to disconnect when done.\n'));
          console.log(chalk.cyan('═'.repeat(60)) + '\n');
        });

        client.on('thresholdMet', () => {
          console.log(chalk.bold.green('\n🎉 Signature threshold met! Transaction will be executed...\n'));
        });

        client.on('participantReady', (data) => {
          if (data.allReady) {
            console.log(chalk.bold.green('\n🎉 All expected participants are ready!\n'));
          }
        });

        // Self-rejection: user typed anything other than YES at the prompt.
        // The session is still alive; surface that explicitly so the
        // participant doesn't think the CLI hung or disconnected.
        client.on('rejected', (data) => {
          console.log(chalk.cyan('═'.repeat(60)));
          console.log(chalk.yellow(`⚠️  You rejected this transaction: ${data?.reason || 'no reason given'}`));
          console.log(chalk.white('\nThe session remains open — you have NOT been disconnected.'));
          console.log(chalk.white('If 2-of-3 signatures are still possible, the transaction may proceed without yours.'));
          console.log(chalk.white('Otherwise it will expire and the coordinator can inject a new one.'));
          console.log(chalk.gray('Press Ctrl+C to disconnect intentionally.\n'));
          console.log(chalk.cyan('═'.repeat(60)) + '\n');
        });

        // Cross-participant rejection: another signer declined this tx.
        // The transaction is NOT canceled by one rejection in an M-of-N
        // session — it just means that one signer won't contribute. The
        // threshold can still be reached if enough OTHER signers approve.
        client.on('transactionRejected', (data) => {
          if (!data || data.participantId === client.participantId) return;

          const stats = data.stats || {};
          const required = stats.signaturesRequired
            ?? connectionResult.sessionInfo?.threshold;
          const collected = stats.signaturesCollected ?? 0;
          const stillNeeded = (required && collected !== undefined)
            ? Math.max(0, required - collected)
            : null;

          console.log(chalk.yellow(
            `\n⚠️  Another participant (${data.participantId?.slice(0, 8) || 'unknown'}) rejected this transaction` +
            (data.reason ? `: ${data.reason}` : '.')
          ));
          if (stillNeeded !== null) {
            console.log(chalk.white(
              `   Threshold not yet at risk: ${collected} signature${collected === 1 ? '' : 's'} collected, ${stillNeeded} more needed.`
            ));
            console.log(chalk.gray(
              '   The transaction stays in flight unless enough signers reject to make the threshold unreachable, or the 120-second window expires.\n'
            ));
          } else {
            console.log(chalk.gray(
              '   The transaction stays in flight; see the coordinator UI for live progress.\n'
            ));
          }
        });

        // Transaction expired before threshold was met. Server auto-resets
        // back to 'waiting' so the coordinator can inject a new one.
        client.on('transactionExpired', () => {
          console.log(chalk.cyan('═'.repeat(60)));
          console.log(chalk.yellow('⏱️  Transaction expired before threshold was met.'));
          console.log(chalk.white('The session is still open and ready for a new injection.\n'));
          console.log(chalk.cyan('═'.repeat(60)) + '\n');
        });

        client.on('sessionExpired', () => {
          if (globalOpts.json) {
            jsonOutput.addError('Session expired', ExitCodes.TIMEOUT);
            jsonOutput.print(false);
          } else {
            console.log(chalk.red('\n❌ Session expired\n'));
          }
          process.exit(ExitCodes.TIMEOUT);
        });

        client.on('error', (data) => {
          if (!globalOpts.json) {
            console.error(chalk.red(`\n❌ Error: ${data.message}\n`));
          }
        });

        // Handle Ctrl+C
        process.on('SIGINT', () => {
          if (!globalOpts.json) {
            console.log(chalk.yellow('\n\n⚠️  Disconnecting...'));
          }
          client.disconnect();
          process.exit(ExitCodes.USER_CANCELLED);
        });

      } catch (error) {
        exitWithError(error.message, ExitCodes.SESSION_ERROR, jsonOutput);
      }
    });
};
