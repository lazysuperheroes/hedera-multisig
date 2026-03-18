/**
 * Schedule Command
 *
 * CLI commands for Hedera scheduled transactions (ScheduleCreate/ScheduleSign).
 * Enables async multi-sig signing over hours/days instead of the 120-second window.
 *
 * Subcommands:
 *   - create: Create a scheduled transaction from frozen TX bytes
 *   - sign: Sign a scheduled transaction by schedule ID
 *   - status: Query schedule status (who has signed, executed, etc.)
 */

const path = require('path');
const fs = require('fs');

module.exports = function(program) {
  const schedule = program
    .command('schedule')
    .description('Scheduled transaction commands (async multi-sig)');

  // ============================================================================
  // schedule create
  // ============================================================================
  schedule
    .command('create')
    .description('Create a scheduled transaction from base64-encoded frozen transaction')
    .requiredOption('-b, --base64 <string>', 'Base64-encoded inner transaction')
    .option('--memo <text>', 'Schedule memo')
    .option('--payer <accountId>', 'Payer account for the scheduled transaction')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Creates a ScheduleCreateTransaction wrapping the inner transaction.
Signers can sign at their convenience using 'schedule sign'.

Examples:
  # Create schedule from frozen transfer
  $ hedera-multisig offline freeze -t transfer -f 0.0.1 -T 0.0.2 -a 10 --raw | \\
    hedera-multisig schedule create -b "$(cat)"

  # With memo
  $ hedera-multisig schedule create -b "CgQQ..." --memo "Q1 payroll"
    `)
    .action(async (options, command) => {
      const {
        Client, AccountId, PrivateKey, Transaction
      } = require('@hashgraph/sdk');
      const ScheduledWorkflow = require('../../workflows/ScheduledWorkflow');
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');

      const globalOpts = command.optsWithGlobals();
      const jsonOutput = new JsonOutput(options.json || globalOpts.json);

      try {
        require('dotenv').config();
        const operatorId = process.env.OPERATOR_ID;
        const operatorKey = process.env.OPERATOR_KEY;
        const network = process.env.HEDERA_NETWORK || 'testnet';

        if (!operatorId || !operatorKey) {
          throw new Error('Missing OPERATOR_ID or OPERATOR_KEY environment variables');
        }

        const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
        client.setOperator(AccountId.fromString(operatorId), PrivateKey.fromString(operatorKey));

        // Reconstruct inner transaction from base64
        const txBytes = Buffer.from(options.base64.trim(), 'base64');
        const innerTransaction = Transaction.fromBytes(txBytes);

        const workflow = new ScheduledWorkflow(client, {
          verbose: !jsonOutput.enabled,
          scheduleMemo: options.memo || '',
        });

        const result = await workflow.createSchedule(innerTransaction, {
          payerAccountId: options.payer ? AccountId.fromString(options.payer) : undefined,
        });

        if (jsonOutput.enabled) {
          Object.entries(result).forEach(([k, v]) => jsonOutput.set(k, v));
          jsonOutput.print(result.success);
        }

        if (!result.success) {
          process.exit(ExitCodes.INTERNAL_ERROR);
        }
      } catch (error) {
        if (jsonOutput.enabled) {
          jsonOutput.set('error', error.message);
          jsonOutput.print(false);
        } else {
          console.error(`\nError: ${error.message}\n`);
        }
        process.exit(ExitCodes.INTERNAL_ERROR);
      }
    });

  // ============================================================================
  // schedule sign
  // ============================================================================
  schedule
    .command('sign')
    .description('Sign a scheduled transaction')
    .requiredOption('--schedule-id <id>', 'Schedule ID to sign')
    .option('-f, --key-file <path>', 'Encrypted key file')
    .option('--passphrase <value>', 'Passphrase for key file')
    .option('-k, --key <hex>', 'Private key (DEPRECATED)')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Sign a scheduled transaction. Each signer runs this independently.
The network auto-executes when the threshold is met.

Examples:
  $ hedera-multisig schedule sign --schedule-id 0.0.12345 -f keys.enc --passphrase secret
    `)
    .action(async (options, command) => {
      const { Client, AccountId, PrivateKey } = require('@hashgraph/sdk');
      const ScheduledWorkflow = require('../../workflows/ScheduledWorkflow');
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');

      const globalOpts = command.optsWithGlobals();
      const jsonOutput = new JsonOutput(options.json || globalOpts.json);

      try {
        require('dotenv').config();
        const operatorId = process.env.OPERATOR_ID;
        const operatorKey = process.env.OPERATOR_KEY;
        const network = process.env.HEDERA_NETWORK || 'testnet';

        if (!operatorId || !operatorKey) {
          throw new Error('Missing OPERATOR_ID or OPERATOR_KEY environment variables');
        }

        const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
        client.setOperator(AccountId.fromString(operatorId), PrivateKey.fromString(operatorKey));

        // Load private key
        let privateKey;
        if (options.keyFile) {
          const EncryptedFileProvider = require('../../keyManagement/EncryptedFileProvider');
          const provider = new EncryptedFileProvider(options.keyFile);
          if (options.passphrase) provider._passphrase = options.passphrase;
          const keys = await provider.getKeys();
          privateKey = keys[0].privateKey || keys[0];
        } else if (options.key) {
          privateKey = PrivateKey.fromString(options.key);
        } else {
          throw new Error('Must provide --key-file or --key');
        }

        const workflow = new ScheduledWorkflow(client, {
          verbose: !jsonOutput.enabled,
        });

        const result = await workflow.signSchedule(options.scheduleId, privateKey);

        if (jsonOutput.enabled) {
          Object.entries(result).forEach(([k, v]) => jsonOutput.set(k, v));
          jsonOutput.print(result.success);
        }

        if (!result.success) {
          process.exit(ExitCodes.INTERNAL_ERROR);
        }
      } catch (error) {
        if (jsonOutput.enabled) {
          jsonOutput.set('error', error.message);
          jsonOutput.print(false);
        } else {
          console.error(`\nError: ${error.message}\n`);
        }
        process.exit(ExitCodes.INTERNAL_ERROR);
      }
    });

  // ============================================================================
  // schedule status
  // ============================================================================
  schedule
    .command('status')
    .description('Query the status of a scheduled transaction')
    .requiredOption('--schedule-id <id>', 'Schedule ID to query')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Query schedule status: who has signed, whether it's been executed, etc.

Examples:
  $ hedera-multisig schedule status --schedule-id 0.0.12345
  $ hedera-multisig schedule status --schedule-id 0.0.12345 --json
    `)
    .action(async (options, command) => {
      const { Client, AccountId, PrivateKey } = require('@hashgraph/sdk');
      const ScheduledWorkflow = require('../../workflows/ScheduledWorkflow');
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');
      const chalk = require('chalk');

      const globalOpts = command.optsWithGlobals();
      const jsonOutput = new JsonOutput(options.json || globalOpts.json);

      try {
        require('dotenv').config();
        const operatorId = process.env.OPERATOR_ID;
        const operatorKey = process.env.OPERATOR_KEY;
        const network = process.env.HEDERA_NETWORK || 'testnet';

        if (!operatorId || !operatorKey) {
          throw new Error('Missing OPERATOR_ID or OPERATOR_KEY environment variables');
        }

        const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
        client.setOperator(AccountId.fromString(operatorId), PrivateKey.fromString(operatorKey));

        const workflow = new ScheduledWorkflow(client, { verbose: false });
        const info = await workflow.getScheduleInfo(options.scheduleId);

        if (jsonOutput.enabled) {
          Object.entries(info).forEach(([k, v]) => jsonOutput.set(k, v));
          jsonOutput.print(info.success);
        } else if (info.success) {
          console.log(chalk.bold.cyan(`\n━━━ Schedule ${info.scheduleId} ━━━\n`));
          console.log(`  Status: ${info.executed ? chalk.green('EXECUTED') : info.deleted ? chalk.red('DELETED') : chalk.yellow('PENDING')}`);
          console.log(`  Memo: ${info.memo || '(none)'}`);
          console.log(`  Creator: ${info.creatorAccountId}`);
          console.log(`  Payer: ${info.payerAccountId}`);
          console.log(`  Expiration: ${info.expirationTime || 'N/A'}`);
          if (info.executedAt) {
            console.log(`  Executed At: ${info.executedAt}`);
          }
          console.log(`\n  Signatories (${info.signatories.length}):`);
          for (const sig of info.signatories) {
            console.log(`    - ${sig}`);
          }
          console.log('');
        } else {
          console.error(`\nError: ${info.error}\n`);
          process.exit(ExitCodes.INTERNAL_ERROR);
        }
      } catch (error) {
        if (jsonOutput.enabled) {
          jsonOutput.set('error', error.message);
          jsonOutput.print(false);
        } else {
          console.error(`\nError: ${error.message}\n`);
        }
        process.exit(ExitCodes.INTERNAL_ERROR);
      }
    });
};
