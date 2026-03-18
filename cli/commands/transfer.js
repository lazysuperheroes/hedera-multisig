/**
 * Transfer Command
 *
 * CLI commands for creating frozen transfer transactions.
 * Convenience wrappers around TransferTransaction that freeze and output
 * base64-encoded bytes for offline signing workflows.
 *
 * Subcommands:
 *   - hbar:  Create a frozen HBAR transfer transaction
 *   - token: Create a frozen fungible token transfer transaction
 *   - nft:   Create a frozen NFT transfer transaction
 */

const crypto = require('crypto');

module.exports = function(program) {
  const transfer = program
    .command('transfer')
    .description('Create frozen transfer transactions for offline signing');

  // ============================================================================
  // transfer hbar
  // ============================================================================
  transfer
    .command('hbar')
    .description('Create a frozen HBAR transfer transaction')
    .requiredOption('-f, --from <accountId>', 'Source account ID')
    .requiredOption('-T, --to <accountId>', 'Destination account ID')
    .requiredOption('-a, --amount <hbar>', 'Amount in HBAR')
    .option('-o, --output <file>', 'Output to file instead of stdout')
    .option('--raw', 'Output raw base64 only (for scripting)')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Create a frozen HBAR transfer transaction and output base64 + checksum.
Uses TransactionId.generate() before freezeWith() for multi-sig hash stability.

Examples:
  # Transfer 10 HBAR
  $ hedera-multisig transfer hbar --from 0.0.1234 --to 0.0.5678 --amount 10

  # Transfer with JSON output
  $ hedera-multisig transfer hbar --from 0.0.1234 --to 0.0.5678 --amount 10 --json

  # Pipe into offline decode
  $ hedera-multisig transfer hbar --from 0.0.1234 --to 0.0.5678 --amount 10 --raw | \\
    hedera-multisig offline decode -b "$(cat)"

Environment Variables:
  OPERATOR_ID    - Hedera operator account ID
  OPERATOR_KEY   - Hedera operator private key
  HEDERA_NETWORK - Network (mainnet/testnet/previewnet)
    `)
    .action(async (options, command) => {
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');
      const {
        Client, AccountId, PrivateKey, TransferTransaction,
        TransactionId, Hbar
      } = require('@hashgraph/sdk');

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

        const amount = parseFloat(options.amount);
        if (isNaN(amount) || amount <= 0) {
          throw new Error('Amount must be a positive number');
        }

        const transaction = new TransferTransaction()
          .addHbarTransfer(AccountId.fromString(options.from), new Hbar(-amount))
          .addHbarTransfer(AccountId.fromString(options.to), new Hbar(amount));

        // Set transaction ID for multi-sig hash stability (required before freeze)
        transaction.setTransactionId(TransactionId.generate(AccountId.fromString(operatorId)));

        const frozenTx = await transaction.freezeWith(client);
        outputFrozenTransaction(frozenTx, 'hbar-transfer', options, jsonOutput, ExitCodes);

        client.close();
      } catch (error) {
        handleError(error, options, jsonOutput, ExitCodes);
      }
    });

  // ============================================================================
  // transfer token
  // ============================================================================
  transfer
    .command('token')
    .description('Create a frozen fungible token transfer transaction')
    .requiredOption('--token <tokenId>', 'Token ID')
    .requiredOption('-f, --from <accountId>', 'Source account ID')
    .requiredOption('-T, --to <accountId>', 'Destination account ID')
    .requiredOption('-a, --amount <n>', 'Token amount (smallest unit)')
    .option('-o, --output <file>', 'Output to file instead of stdout')
    .option('--raw', 'Output raw base64 only (for scripting)')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Create a frozen fungible token transfer transaction and output base64 + checksum.

Examples:
  # Transfer 1000 tokens
  $ hedera-multisig transfer token --token 0.0.999 --from 0.0.1234 --to 0.0.5678 --amount 1000

  # JSON output
  $ hedera-multisig transfer token --token 0.0.999 --from 0.0.1234 --to 0.0.5678 --amount 1000 --json

Environment Variables:
  OPERATOR_ID    - Hedera operator account ID
  OPERATOR_KEY   - Hedera operator private key
  HEDERA_NETWORK - Network (mainnet/testnet/previewnet)
    `)
    .action(async (options, command) => {
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');
      const {
        Client, AccountId, PrivateKey, TransferTransaction,
        TransactionId, TokenId
      } = require('@hashgraph/sdk');

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

        const amount = parseInt(options.amount);
        if (isNaN(amount) || amount <= 0) {
          throw new Error('Amount must be a positive integer');
        }

        const tokenId = TokenId.fromString(options.token);
        const transaction = new TransferTransaction()
          .addTokenTransfer(tokenId, AccountId.fromString(options.from), -amount)
          .addTokenTransfer(tokenId, AccountId.fromString(options.to), amount);

        // Set transaction ID for multi-sig hash stability (required before freeze)
        transaction.setTransactionId(TransactionId.generate(AccountId.fromString(operatorId)));

        const frozenTx = await transaction.freezeWith(client);
        outputFrozenTransaction(frozenTx, 'token-transfer', options, jsonOutput, ExitCodes);

        client.close();
      } catch (error) {
        handleError(error, options, jsonOutput, ExitCodes);
      }
    });

  // ============================================================================
  // transfer nft
  // ============================================================================
  transfer
    .command('nft')
    .description('Create a frozen NFT transfer transaction')
    .requiredOption('--token <tokenId>', 'NFT token ID')
    .requiredOption('--serial <n>', 'NFT serial number')
    .requiredOption('-f, --from <accountId>', 'Source account ID')
    .requiredOption('-T, --to <accountId>', 'Destination account ID')
    .option('-o, --output <file>', 'Output to file instead of stdout')
    .option('--raw', 'Output raw base64 only (for scripting)')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Create a frozen NFT transfer transaction and output base64 + checksum.

Examples:
  # Transfer NFT serial #42
  $ hedera-multisig transfer nft --token 0.0.999 --serial 42 --from 0.0.1234 --to 0.0.5678

  # JSON output
  $ hedera-multisig transfer nft --token 0.0.999 --serial 42 --from 0.0.1234 --to 0.0.5678 --json

Environment Variables:
  OPERATOR_ID    - Hedera operator account ID
  OPERATOR_KEY   - Hedera operator private key
  HEDERA_NETWORK - Network (mainnet/testnet/previewnet)
    `)
    .action(async (options, command) => {
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');
      const {
        Client, AccountId, PrivateKey, TransferTransaction,
        TransactionId, TokenId
      } = require('@hashgraph/sdk');

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

        const serial = parseInt(options.serial);
        if (isNaN(serial) || serial <= 0) {
          throw new Error('Serial number must be a positive integer');
        }

        const tokenId = TokenId.fromString(options.token);
        const transaction = new TransferTransaction()
          .addNftTransfer(tokenId, serial, AccountId.fromString(options.from), AccountId.fromString(options.to));

        // Set transaction ID for multi-sig hash stability (required before freeze)
        transaction.setTransactionId(TransactionId.generate(AccountId.fromString(operatorId)));

        const frozenTx = await transaction.freezeWith(client);
        outputFrozenTransaction(frozenTx, 'nft-transfer', options, jsonOutput, ExitCodes);

        client.close();
      } catch (error) {
        handleError(error, options, jsonOutput, ExitCodes);
      }
    });
};

// ============================================================================
// Shared helpers
// ============================================================================

/**
 * Output a frozen transaction in the requested format (human-readable, JSON, raw, or file).
 * Matches the output format of `offline freeze`.
 *
 * @param {Object} frozenTx - Frozen Hedera SDK transaction
 * @param {string} txType - Transaction type label
 * @param {Object} options - CLI options (json, raw, output)
 * @param {JsonOutput} jsonOutput - JsonOutput instance
 * @param {Object} ExitCodes - Exit code constants
 */
function outputFrozenTransaction(frozenTx, txType, options, jsonOutput, ExitCodes) {
  const fs = require('fs');
  const path = require('path');

  const txBytes = frozenTx.toBytes();
  const base64 = Buffer.from(txBytes).toString('base64');

  // Generate checksum (first 16 chars of SHA-256)
  const checksum = crypto
    .createHash('sha256')
    .update(txBytes)
    .digest('hex')
    .substring(0, 16);

  const txId = frozenTx.transactionId?.toString() || 'unknown';

  // Raw mode - just base64
  if (options.raw) {
    console.log(base64);
    process.exit(ExitCodes.SUCCESS);
  }

  // JSON mode
  if (options.json || jsonOutput.enabled) {
    jsonOutput.set('transactionId', txId);
    jsonOutput.set('transactionType', txType);
    jsonOutput.set('base64', base64);
    jsonOutput.set('checksum', checksum);
    jsonOutput.set('byteLength', txBytes.length);
    jsonOutput.print(true);
    process.exit(ExitCodes.SUCCESS);
  }

  // File output
  if (options.output) {
    const outputPath = path.resolve(options.output);
    const content = [
      `# Hedera Multi-Sig Transaction`,
      `# Type: ${txType}`,
      `# Transaction ID: ${txId}`,
      `# Checksum: ${checksum}`,
      `# Generated: ${new Date().toISOString()}`,
      ``,
      `BASE64:`,
      base64,
      ``,
      `CHECKSUM:`,
      checksum
    ].join('\n');

    fs.writeFileSync(outputPath, content);
    console.log(`\nTransaction frozen and saved to: ${outputPath}\n`);
    process.exit(ExitCodes.SUCCESS);
  }

  // Human-readable output
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║           FROZEN TRANSACTION FOR SIGNING              ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  console.log(`Transaction Type: ${txType}`);
  console.log(`Transaction ID:   ${txId}`);
  console.log(`Byte Length:      ${txBytes.length} bytes\n`);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('BASE64 TRANSACTION (copy this to signer):');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(base64);
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('CHECKSUM (share separately for verification):');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(checksum);
  console.log('\n═══════════════════════════════════════════════════════════\n');

  console.log('NEXT STEPS:');
  console.log('  1. Copy the base64 transaction above');
  console.log('  2. Share with signers via secure channel (Signal, encrypted email)');
  console.log('  3. Share checksum separately for tamper verification');
  console.log('  4. Signers use: hedera-multisig sign (or offline decode first)\n');

  process.exit(ExitCodes.SUCCESS);
}

/**
 * Handle error output in the appropriate format.
 *
 * @param {Error} error - The error that occurred
 * @param {Object} options - CLI options
 * @param {JsonOutput} jsonOutput - JsonOutput instance
 * @param {Object} ExitCodes - Exit code constants
 */
function handleError(error, options, jsonOutput, ExitCodes) {
  if (options.json || jsonOutput.enabled) {
    jsonOutput.addError(error.message);
    jsonOutput.print(false);
  } else {
    console.error(`\nError: ${error.message}\n`);
  }
  process.exit(ExitCodes.VALIDATION_ERROR);
}
