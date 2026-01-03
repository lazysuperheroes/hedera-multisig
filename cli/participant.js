#!/usr/bin/env node

/**
 * CLI Participant Tool
 *
 * Connect to a multi-signature session as a participant.
 *
 * Usage:
 *   node cli/participant.js --url ws://localhost:3000 --session <id> --pin <pin> --key <privateKey>
 *   npm run multisig-client -- --url ws://localhost:3000 --session <id> --pin <pin>
 */

const { PrivateKey } = require('@hashgraph/sdk');
const { SigningClient } = require('../client');
const EncryptedFileProvider = require('../keyManagement/EncryptedFileProvider');
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
const readlineSync = require('readline-sync');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

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
    yes: commonFlags.yes,
    // Participant-specific options
    url: null,
    sessionId: null,
    pin: null,
    privateKey: null,
    keyFile: null,
    label: null
  };

  const remainingArgs = commonFlags.remainingArgs;
  for (let i = 0; i < remainingArgs.length; i++) {
    switch (remainingArgs[i]) {
      case '--url':
      case '-u':
        options.url = remainingArgs[++i];
        break;

      case '--session':
      case '-s':
        options.sessionId = remainingArgs[++i];
        break;

      case '--pin':
      case '-p':
        options.pin = remainingArgs[++i];
        break;

      case '--key':
      case '-k':
        options.privateKey = remainingArgs[++i];
        break;

      case '--keyfile':
      case '-f':
        options.keyFile = remainingArgs[++i];
        break;

      case '--label':
      case '-l':
        options.label = remainingArgs[++i];
        break;
    }
  }

  return options;
}

function printHelp() {
  console.log(chalk.bold('\n👥 Hedera MultiSig Participant v' + getVersion() + '\n'));
  console.log('Usage: node cli/participant.js [options]\n');
  console.log('Connection Options:');
  console.log('  -u, --url <url>            WebSocket server URL (required)');
  console.log('  -s, --session <id>         Session ID (required)');
  console.log('  -p, --pin <pin>            Session token (required)');
  console.log('');
  console.log('Key Options:');
  console.log('  -f, --keyfile <path>       Load encrypted key file (RECOMMENDED - most secure)');
  console.log('  -k, --key <key>            Private key hex string (less secure, for testing)');
  console.log('  -l, --label <label>        Participant label (optional)');
  console.log(getCommonFlagsHelp());
  console.log('\nExamples:');
  console.log('  # Connect with encrypted key file (RECOMMENDED)');
  console.log('  node cli/participant.js -u ws://localhost:3000 -s abc123 -p TOKEN123 -f keys.encrypted\n');
  console.log('  # Connect and get prompted for key options');
  console.log('  node cli/participant.js -u ws://localhost:3000 -s abc123 -p TOKEN123\n');
  console.log('  # Connect with inline key (not recommended for production)');
  console.log('  node cli/participant.js -u ws://localhost:3000 -s abc123 -p TOKEN123 -k <privateKey>\n');
}

async function main() {
  const options = parseArgs();

  // Initialize logging based on CLI flags
  const log = initializeLogging(options, 'Participant');

  // Create JSON output handler
  const jsonOutput = new JsonOutput(options.json);

  // Validate required options
  if (!options.url) {
    exitWithError('--url is required', ExitCodes.VALIDATION_ERROR, jsonOutput);
  }

  if (!options.sessionId) {
    exitWithError('--session is required', ExitCodes.VALIDATION_ERROR, jsonOutput);
  }

  if (!options.pin) {
    exitWithError('--pin is required', ExitCodes.VALIDATION_ERROR, jsonOutput);
  }

  try {
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
      options.url,
      options.sessionId,
      options.pin
    );

    // Load private key with flexible options
    let privateKey;

    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('LOAD PRIVATE KEY\n'));
    console.log(chalk.yellow('⚠️  Your private key will be loaded into memory locally.'));
    console.log(chalk.yellow('⚠️  It will NEVER be transmitted over the network.\n'));

    if (options.keyFile) {
      // Option 1: Load from encrypted file (MOST SECURE)
      console.log(chalk.green(`✅ Loading from encrypted file: ${options.keyFile}\n`));
      const provider = new EncryptedFileProvider(options.keyFile);
      const keys = await provider.getKeys(); // Prompts for passphrase with hideEchoBack
      privateKey = keys[0].privateKey;
      console.log(chalk.green('✅ Key loaded successfully from encrypted file\n'));

    } else if (options.privateKey) {
      // Option 2: Inline hex key (LESS SECURE - for testing)
      console.log(chalk.yellow('⚠️  Using plaintext hex key (not recommended for production)\n'));
      privateKey = options.privateKey;

    } else {
      // Option 3: Interactive prompt with options
      console.log(chalk.bold.white('🔐 How would you like to load your private key?\n'));
      console.log(chalk.green('  1. Load from encrypted file (RECOMMENDED - most secure)'));
      console.log(chalk.yellow('  2. Enter hex key and save as encrypted file (secure)'));
      console.log(chalk.gray('  3. Enter hex key for this session only (less secure)\n'));

      const choice = readlineSync.question('Select option (1/2/3): ');

      if (choice === '1') {
        // Load from existing encrypted file
        const keyFilePath = readlineSync.question('\nEnter path to encrypted key file: ');

        if (!fs.existsSync(keyFilePath)) {
          console.error(chalk.red(`\n❌ File not found: ${keyFilePath}\n`));
          process.exit(1);
        }

        const provider = new EncryptedFileProvider(keyFilePath);
        const keys = await provider.getKeys(); // Prompts for passphrase
        privateKey = keys[0].privateKey;
        console.log(chalk.green('\n✅ Key loaded successfully from encrypted file\n'));

      } else if (choice === '2') {
        // Enter hex key and save as encrypted file
        console.log(chalk.white('\nEnter your private key to encrypt and save:'));
        const hexKey = readlineSync.question('Private key (hex): ', {
          hideEchoBack: true
        });

        privateKey = hexKey;

        // Offer to save as encrypted file
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
              // Use EncryptedFileProvider to save the key
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
        // Enter hex key for this session only
        console.log(chalk.yellow('\n⚠️  Key will only be used for this session'));
        console.log(chalk.yellow('⚠️  Consider using option 2 to save securely for future use\n'));

        privateKey = readlineSync.question('Enter your private key (hex): ', {
          hideEchoBack: true
        });

      } else {
        console.error(chalk.red('\n❌ Invalid option selected'));
        process.exit(1);
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

      // Session stays open for multiple transactions
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
      if (options.json) {
        jsonOutput.addError('Session expired', ExitCodes.TIMEOUT);
        jsonOutput.print(false);
      } else {
        console.log(chalk.red('\n❌ Session expired\n'));
      }
      process.exit(ExitCodes.TIMEOUT);
    });

    client.on('error', (data) => {
      if (!options.json) {
        console.error(chalk.red(`\n❌ Error: ${data.message}\n`));
      }
    });

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      if (!options.json) {
        console.log(chalk.yellow('\n\n⚠️  Disconnecting...'));
      }
      client.disconnect();
      process.exit(ExitCodes.USER_CANCELLED);
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
