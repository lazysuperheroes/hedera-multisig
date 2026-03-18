/**
 * Token Command
 *
 * CLI commands for creating frozen token association/dissociation transactions.
 * Convenience wrappers that freeze and output base64-encoded bytes for
 * offline signing workflows.
 *
 * Subcommands:
 *   - associate:   Create a frozen TokenAssociateTransaction
 *   - dissociate:  Create a frozen TokenDissociateTransaction
 */

const crypto = require('crypto');

module.exports = function(program) {
  const token = program
    .command('token')
    .description('Create frozen token management transactions for offline signing');

  // ============================================================================
  // token associate
  // ============================================================================
  token
    .command('associate')
    .description('Create a frozen token association transaction')
    .requiredOption('--account <accountId>', 'Account ID to associate tokens with')
    .requiredOption('--tokens <tokenIds>', 'Comma-separated token IDs to associate')
    .option('-o, --output <file>', 'Output to file instead of stdout')
    .option('--raw', 'Output raw base64 only (for scripting)')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Create a frozen TokenAssociateTransaction and output base64 + checksum.
Associates one or more tokens with an account so it can hold token balances.

Examples:
  # Associate a single token
  $ hedera-multisig token associate --account 0.0.1234 --tokens 0.0.999

  # Associate multiple tokens
  $ hedera-multisig token associate --account 0.0.1234 --tokens 0.0.999,0.0.888,0.0.777

  # JSON output
  $ hedera-multisig token associate --account 0.0.1234 --tokens 0.0.999 --json

Environment Variables:
  OPERATOR_ID    - Hedera operator account ID
  OPERATOR_KEY   - Hedera operator private key
  HEDERA_NETWORK - Network (mainnet/testnet/previewnet)
    `)
    .action(async (options, command) => {
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');
      const {
        Client, AccountId, PrivateKey,
        TokenAssociateTransaction, TransactionId, TokenId
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

        const tokenIds = options.tokens.split(',').map(t => TokenId.fromString(t.trim()));
        if (tokenIds.length === 0) {
          throw new Error('At least one token ID is required');
        }

        const transaction = new TokenAssociateTransaction()
          .setAccountId(AccountId.fromString(options.account))
          .setTokenIds(tokenIds);

        // Set transaction ID for multi-sig hash stability (required before freeze)
        transaction.setTransactionId(TransactionId.generate(AccountId.fromString(operatorId)));

        const frozenTx = await transaction.freezeWith(client);
        outputFrozenTransaction(frozenTx, 'token-associate', options, jsonOutput, ExitCodes);

        client.close();
      } catch (error) {
        handleError(error, options, jsonOutput, ExitCodes);
      }
    });

  // ============================================================================
  // token dissociate
  // ============================================================================
  token
    .command('dissociate')
    .description('Create a frozen token dissociation transaction')
    .requiredOption('--account <accountId>', 'Account ID to dissociate tokens from')
    .requiredOption('--tokens <tokenIds>', 'Comma-separated token IDs to dissociate')
    .option('-o, --output <file>', 'Output to file instead of stdout')
    .option('--raw', 'Output raw base64 only (for scripting)')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Create a frozen TokenDissociateTransaction and output base64 + checksum.
Dissociates one or more tokens from an account. Token balances must be zero.

Examples:
  # Dissociate a single token
  $ hedera-multisig token dissociate --account 0.0.1234 --tokens 0.0.999

  # Dissociate multiple tokens
  $ hedera-multisig token dissociate --account 0.0.1234 --tokens 0.0.999,0.0.888

  # JSON output
  $ hedera-multisig token dissociate --account 0.0.1234 --tokens 0.0.999 --json

Environment Variables:
  OPERATOR_ID    - Hedera operator account ID
  OPERATOR_KEY   - Hedera operator private key
  HEDERA_NETWORK - Network (mainnet/testnet/previewnet)
    `)
    .action(async (options, command) => {
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');
      const {
        Client, AccountId, PrivateKey,
        TokenDissociateTransaction, TransactionId, TokenId
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

        const tokenIds = options.tokens.split(',').map(t => TokenId.fromString(t.trim()));
        if (tokenIds.length === 0) {
          throw new Error('At least one token ID is required');
        }

        const transaction = new TokenDissociateTransaction()
          .setAccountId(AccountId.fromString(options.account))
          .setTokenIds(tokenIds);

        // Set transaction ID for multi-sig hash stability (required before freeze)
        transaction.setTransactionId(TransactionId.generate(AccountId.fromString(operatorId)));

        const frozenTx = await transaction.freezeWith(client);
        outputFrozenTransaction(frozenTx, 'token-dissociate', options, jsonOutput, ExitCodes);

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
