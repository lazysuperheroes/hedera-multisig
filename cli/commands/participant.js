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
    .option('-k, --key <key>', 'Private key hex string (DEPRECATED: visible in process list, use --keyfile)')
    .option('-l, --label <label>', 'Participant label')
    .option('-y, --yes', 'Non-interactive mode (skip prompts)')
    .addHelpText('after', `
Examples:
  # Join using connection string (recommended)
  $ hedera-multisig participant --connect hmsc:eyJz... -f keys.encrypted

  # Join using individual parameters
  $ hedera-multisig participant -u ws://localhost:3000 -s abc123 -p TOKEN123 -f keys.encrypted
    `)
    .action(async (options, command) => {
      const { PrivateKey } = require('@hashgraph/sdk');
      const { SigningClient } = require('../../client');
      const EncryptedFileProvider = require('../../keyManagement/EncryptedFileProvider');
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
          const provider = new EncryptedFileProvider(options.keyfile);
          const keys = await provider.getKeys();
          privateKey = keys[0].privateKey;
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
            privateKey = keys[0].privateKey;
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
        console.log(chalk.white('Session will remain open for:'));
        console.log(chalk.yellow(`  ${Math.floor((connectionResult.sessionInfo.expiresAt - Date.now()) / 60000)} minutes\n`));
        console.log(chalk.white('When the coordinator injects a transaction:'));
        console.log(chalk.white('  1. You will see the decoded transaction details'));
        console.log(chalk.white('  2. You can review VERIFIED vs UNVERIFIED information'));
        console.log(chalk.white('  3. You will be prompted to approve (type "YES") or reject\n'));
        console.log(chalk.cyan('═'.repeat(60)) + '\n');

        // Handle events
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
