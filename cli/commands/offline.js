/**
 * Offline Command
 *
 * CLI commands for offline/air-gapped multi-sig workflows.
 * Enables copy-paste friendly transaction freezing, decoding, and execution.
 *
 * Subcommands:
 *   - freeze: Freeze a transaction and output base64 + checksum
 *   - decode: Decode base64 transaction and display details
 *   - execute: Collect signatures and execute transaction
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

module.exports = function(program) {
  const offline = program
    .command('offline')
    .description('Offline/air-gapped multi-sig workflow commands');

  // ============================================================================
  // offline freeze
  // ============================================================================
  offline
    .command('freeze')
    .description('Freeze a transaction and output base64 for offline signing')
    .requiredOption('-t, --type <type>', 'Transaction type: transfer, token-transfer, nft-transfer, token-associate, token-dissociate, account-update, contract-execute, token-create, token-mint, token-burn')
    .option('-f, --from <accountId>', 'Source account ID')
    .option('-T, --to <accountId>', 'Destination account ID')
    .option('-a, --amount <value>', 'Amount (HBAR for transfer, token units for token ops)')
    .option('--token <tokenId>', 'Token ID (for token operations)')
    .option('--tokens <tokenIds>', 'Comma-separated token IDs (for associate/dissociate)')
    .option('--serial <number>', 'NFT serial number (for nft-transfer)')
    .option('--account <accountId>', 'Target account ID (for associate/dissociate/account-update)')
    .option('--new-key <publicKey>', 'New public key (for account-update)')
    .option('--name <name>', 'Token name (for token-create)')
    .option('--symbol <symbol>', 'Token symbol (for token-create)')
    .option('--decimals <n>', 'Token decimals (for token-create)', '0')
    .option('--initial-supply <n>', 'Initial supply (for token-create)', '0')
    .option('--treasury <accountId>', 'Treasury account (for token-create)')
    .option('-c, --contract <contractId>', 'Contract ID (for contract-execute)')
    .option('-g, --gas <amount>', 'Gas limit (for contract-execute)', '100000')
    .option('-d, --data <hex>', 'Function call data in hex (for contract-execute)')
    .option('--abi <file>', 'ABI JSON file for contract call encoding')
    .option('--function <name>', 'Function name (used with --abi)')
    .option('--args <values>', 'Comma-separated function arguments (used with --abi)')
    .option('-o, --output <file>', 'Output to file instead of stdout')
    .option('--raw', 'Output raw base64 only (for scripting)')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Freeze a transaction and output base64-encoded bytes for offline signing.
The checksum helps signers verify transaction integrity.

Examples:
  # HBAR transfer
  $ hedera-multisig offline freeze -t transfer -f 0.0.1234 -T 0.0.5678 -a 100

  # Token transfer
  $ hedera-multisig offline freeze -t token-transfer --token 0.0.999 -f 0.0.1234 -T 0.0.5678 -a 1000

  # NFT transfer
  $ hedera-multisig offline freeze -t nft-transfer --token 0.0.999 --serial 42 -f 0.0.1234 -T 0.0.5678

  # Token association
  $ hedera-multisig offline freeze -t token-associate --account 0.0.1234 --tokens 0.0.999,0.0.888

  # Smart contract call with ABI
  $ hedera-multisig offline freeze -t contract-execute -c 0.0.555 --abi ./token.json --function transfer --args "0.0.5678,1000"

  # Account key update
  $ hedera-multisig offline freeze -t account-update --account 0.0.1234 --new-key 302a300506...

Environment Variables:
  OPERATOR_ID    - Hedera operator account ID
  OPERATOR_KEY   - Hedera operator private key
  HEDERA_NETWORK - Network (mainnet/testnet/previewnet)
    `)
    .action(async (options, command) => {
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');
      const {
        Client,
        AccountId,
        PrivateKey,
        PublicKey,
        TransferTransaction,
        ContractExecuteTransaction,
        ContractId,
        TransactionId,
        TokenId,
        TokenAssociateTransaction,
        TokenDissociateTransaction,
        AccountUpdateTransaction,
        TokenCreateTransaction,
        TokenMintTransaction,
        TokenBurnTransaction,
        Hbar
      } = require('@hashgraph/sdk');

      const jsonOutput = new JsonOutput(options.json || command.parent?.parent?.opts().json);

      try {
        // Load environment
        require('dotenv').config();

        const operatorId = process.env.OPERATOR_ID;
        const operatorKey = process.env.OPERATOR_KEY;
        const network = process.env.HEDERA_NETWORK || 'testnet';

        if (!operatorId || !operatorKey) {
          throw new Error('Missing OPERATOR_ID or OPERATOR_KEY environment variables');
        }

        // Setup client
        const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
        client.setOperator(AccountId.fromString(operatorId), PrivateKey.fromString(operatorKey));

        // Build transaction based on type
        let transaction;

        switch (options.type) {
          case 'transfer': {
            if (!options.from || !options.to || !options.amount) {
              throw new Error('Transfer requires --from, --to, and --amount options');
            }
            transaction = new TransferTransaction()
              .addHbarTransfer(AccountId.fromString(options.from), new Hbar(-parseFloat(options.amount)))
              .addHbarTransfer(AccountId.fromString(options.to), new Hbar(parseFloat(options.amount)));
            break;
          }

          case 'token-transfer': {
            if (!options.token || !options.from || !options.to || !options.amount) {
              throw new Error('Token transfer requires --token, --from, --to, and --amount');
            }
            transaction = new TransferTransaction()
              .addTokenTransfer(TokenId.fromString(options.token), AccountId.fromString(options.from), -parseInt(options.amount))
              .addTokenTransfer(TokenId.fromString(options.token), AccountId.fromString(options.to), parseInt(options.amount));
            break;
          }

          case 'nft-transfer': {
            if (!options.token || !options.serial || !options.from || !options.to) {
              throw new Error('NFT transfer requires --token, --serial, --from, and --to');
            }
            transaction = new TransferTransaction()
              .addNftTransfer(TokenId.fromString(options.token), parseInt(options.serial), AccountId.fromString(options.from), AccountId.fromString(options.to));
            break;
          }

          case 'token-associate': {
            if (!options.account || !options.tokens) {
              throw new Error('Token associate requires --account and --tokens (comma-separated)');
            }
            const tokenIds = options.tokens.split(',').map(t => TokenId.fromString(t.trim()));
            transaction = new TokenAssociateTransaction()
              .setAccountId(AccountId.fromString(options.account))
              .setTokenIds(tokenIds);
            break;
          }

          case 'token-dissociate': {
            if (!options.account || !options.tokens) {
              throw new Error('Token dissociate requires --account and --tokens (comma-separated)');
            }
            const dissocTokenIds = options.tokens.split(',').map(t => TokenId.fromString(t.trim()));
            transaction = new TokenDissociateTransaction()
              .setAccountId(AccountId.fromString(options.account))
              .setTokenIds(dissocTokenIds);
            break;
          }

          case 'account-update': {
            if (!options.account) {
              throw new Error('Account update requires --account');
            }
            transaction = new AccountUpdateTransaction()
              .setAccountId(AccountId.fromString(options.account));
            if (options.newKey) {
              transaction.setKey(PublicKey.fromString(options.newKey));
            }
            break;
          }

          case 'token-create': {
            if (!options.name || !options.symbol) {
              throw new Error('Token create requires --name and --symbol');
            }
            transaction = new TokenCreateTransaction()
              .setTokenName(options.name)
              .setTokenSymbol(options.symbol)
              .setDecimals(parseInt(options.decimals))
              .setInitialSupply(parseInt(options.initialSupply));
            if (options.treasury) {
              transaction.setTreasuryAccountId(AccountId.fromString(options.treasury));
            }
            break;
          }

          case 'token-mint': {
            if (!options.token || !options.amount) {
              throw new Error('Token mint requires --token and --amount');
            }
            transaction = new TokenMintTransaction()
              .setTokenId(TokenId.fromString(options.token))
              .setAmount(parseInt(options.amount));
            break;
          }

          case 'token-burn': {
            if (!options.token || !options.amount) {
              throw new Error('Token burn requires --token and --amount');
            }
            transaction = new TokenBurnTransaction()
              .setTokenId(TokenId.fromString(options.token))
              .setAmount(parseInt(options.amount));
            break;
          }

          case 'contract-execute': {
            if (!options.contract) {
              throw new Error('Contract execute requires --contract option');
            }
            transaction = new ContractExecuteTransaction()
              .setContractId(ContractId.fromString(options.contract))
              .setGas(parseInt(options.gas));

            // ABI-based encoding (--abi --function --args)
            if (options.abi && options.function) {
              const { Interface } = require('ethers');
              const abiJson = JSON.parse(fs.readFileSync(path.resolve(options.abi), 'utf8'));
              const iface = new Interface(abiJson);
              const calldata = iface.encodeFunctionData(options.function, options.args ? options.args.split(',').map(a => a.trim()) : []);
              const dataBytes = Buffer.from(calldata.replace(/^0x/, ''), 'hex');
              transaction.setFunctionParameters(dataBytes);
            } else if (options.data) {
              const dataBytes = Buffer.from(options.data.replace(/^0x/, ''), 'hex');
              transaction.setFunctionParameters(dataBytes);
            }
            break;
          }

          default:
            throw new Error(`Unsupported transaction type: ${options.type}. Supported: transfer, token-transfer, nft-transfer, token-associate, token-dissociate, account-update, contract-execute, token-create, token-mint, token-burn`);
        }

        // Set transaction ID for multi-sig hash stability (required before freeze)
        transaction.setTransactionId(TransactionId.generate(AccountId.fromString(operatorId)));

        // Freeze the transaction
        const frozenTx = await transaction.freezeWith(client);
        const txBytes = frozenTx.toBytes();
        const base64 = Buffer.from(txBytes).toString('base64');

        // Generate checksum (first 16 chars of SHA-256)
        const checksum = crypto
          .createHash('sha256')
          .update(txBytes)
          .digest('hex')
          .substring(0, 16);

        // Generate transaction ID if available
        const txId = frozenTx.transactionId?.toString() || 'unknown';

        // Output handling
        if (options.raw) {
          // Raw mode - just base64
          console.log(base64);
          process.exit(ExitCodes.SUCCESS);
        }

        if (options.json || jsonOutput.enabled) {
          jsonOutput.set('transactionId', txId);
          jsonOutput.set('transactionType', options.type);
          jsonOutput.set('base64', base64);
          jsonOutput.set('checksum', checksum);
          jsonOutput.set('byteLength', txBytes.length);
          jsonOutput.print(true);
          process.exit(ExitCodes.SUCCESS);
        }

        // Output to file
        if (options.output) {
          const outputPath = path.resolve(options.output);
          const content = [
            `# Hedera Multi-Sig Transaction`,
            `# Type: ${options.type}`,
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
          console.log(`\n✅ Transaction frozen and saved to: ${outputPath}\n`);
          process.exit(ExitCodes.SUCCESS);
        }

        // Human-readable output
        console.log('\n╔═══════════════════════════════════════════════════════╗');
        console.log('║           FROZEN TRANSACTION FOR SIGNING              ║');
        console.log('╚═══════════════════════════════════════════════════════╝\n');

        console.log(`Transaction Type: ${options.type}`);
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

        client.close();
        process.exit(ExitCodes.SUCCESS);

      } catch (error) {
        if (options.json || jsonOutput.enabled) {
          jsonOutput.addError(error.message);
          jsonOutput.print(false);
        } else {
          console.error(`\n❌ Error: ${error.message}\n`);
        }
        process.exit(ExitCodes.VALIDATION_ERROR);
      }
    });

  // ============================================================================
  // offline decode
  // ============================================================================
  offline
    .command('decode')
    .description('Decode base64 transaction and display human-readable details')
    .option('-b, --base64 <string>', 'Base64-encoded transaction bytes')
    .option('-f, --file <path>', 'Read base64 from file')
    .option('-c, --checksum <string>', 'Expected checksum for verification')
    .option('--abi <file>', 'ABI JSON file for decoding smart contract function calls')
    .option('--verbose', 'Show raw bytes breakdown')
    .option('--raw', 'Output raw decoded JSON only')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Decode a base64-encoded frozen transaction and display human-readable details.
CRITICAL: Always decode and verify transaction details before signing!

Examples:
  # Decode from base64 string
  $ hedera-multisig offline decode -b "CgQQBxgLEg..."

  # Decode from file
  $ hedera-multisig offline decode -f transaction.txt

  # Decode with checksum verification
  $ hedera-multisig offline decode -b "CgQQBxgL..." -c "a7b3c9d4e5f6"

  # Output as JSON
  $ hedera-multisig offline decode -b "CgQQBxgL..." --json
    `)
    .action(async (options, command) => {
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');
      const TransactionFreezer = require('../../core/TransactionFreezer');
      const TransactionDecoder = require('../../core/TransactionDecoder');

      const jsonOutput = new JsonOutput(options.json || command.parent?.parent?.opts().json);

      try {
        let base64Input;

        // Get base64 input
        if (options.base64) {
          base64Input = options.base64.trim();
        } else if (options.file) {
          const filePath = path.resolve(options.file);
          if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
          }
          const content = fs.readFileSync(filePath, 'utf8');
          // Extract base64 from file (handles both raw and formatted output)
          const lines = content.split('\n').filter(l => l && !l.startsWith('#') && !l.startsWith('BASE64:') && !l.startsWith('CHECKSUM:'));
          base64Input = lines.find(l => l.length > 50 && !l.includes(':'))?.trim();
          if (!base64Input) {
            throw new Error('Could not find base64 transaction in file');
          }
        } else if (!process.stdin.isTTY) {
          // Piped input — read from stdin
          const chunks = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk);
          }
          const input = Buffer.concat(chunks).toString('utf8').trim();
          // Extract base64 (handle both raw and formatted input)
          const lines = input.split('\n').filter(l => l && !l.startsWith('#') && !l.startsWith('BASE64:') && !l.startsWith('CHECKSUM:'));
          base64Input = lines.find(l => l.length > 50 && !l.includes(':'))?.trim();
          if (!base64Input) {
            base64Input = input.trim(); // Fall back to raw input
          }
        } else {
          // Interactive mode - prompt for input
          const readlineSync = require('readline-sync');
          console.log('\nPaste the base64-encoded transaction bytes:');
          base64Input = readlineSync.question('> ');
        }

        if (!base64Input) {
          throw new Error('No base64 input provided. Use --base64 or --file option.');
        }

        // Decode base64 to bytes
        const txBytes = Buffer.from(base64Input, 'base64');

        // Calculate checksum
        const actualChecksum = crypto
          .createHash('sha256')
          .update(txBytes)
          .digest('hex')
          .substring(0, 16);

        // Verify checksum if provided
        let checksumValid = null;
        if (options.checksum) {
          checksumValid = actualChecksum === options.checksum.trim();
        }

        // Reconstruct the frozen transaction
        const frozenTx = TransactionFreezer.fromBase64(base64Input, Date.now());

        // Load ABI for smart contract decoding if provided
        let contractInterface = null;
        if (options.abi) {
          try {
            const { Interface } = require('ethers');
            const abiJson = JSON.parse(fs.readFileSync(path.resolve(options.abi), 'utf8'));
            contractInterface = new Interface(abiJson);
          } catch (e) {
            console.warn(`Warning: Could not load ABI from ${options.abi}: ${e.message}`);
          }
        }

        // Decode transaction details
        const txDetails = TransactionDecoder.decode(frozenTx.transaction, contractInterface);

        // Add additional metadata
        const result = {
          transactionType: txDetails.type,
          transactionId: frozenTx.transaction?.transactionId?.toString() || 'unknown',
          checksum: actualChecksum,
          checksumVerified: checksumValid,
          byteLength: txBytes.length,
          hash: frozenTx.hash,
          details: {
            function: txDetails.function,
            contract: txDetails.contract,
            parameters: txDetails.parameters,
            transfers: txDetails.transfers,
            gas: txDetails.gas
          }
        };

        // Output handling
        if (options.raw || options.json || jsonOutput.enabled) {
          if (options.json || jsonOutput.enabled) {
            Object.entries(result).forEach(([k, v]) => jsonOutput.set(k, v));
            jsonOutput.print(checksumValid !== false);
          } else {
            console.log(JSON.stringify(result, null, 2));
          }
          process.exit(checksumValid === false ? ExitCodes.VALIDATION_ERROR : ExitCodes.SUCCESS);
        }

        // Human-readable output
        console.log('\n╔═══════════════════════════════════════════════════════╗');
        console.log('║        DECODED TRANSACTION DETAILS                    ║');
        console.log('╚═══════════════════════════════════════════════════════╝\n');

        // Checksum verification status
        if (checksumValid === true) {
          console.log('✅ CHECKSUM VERIFIED\n');
        } else if (checksumValid === false) {
          console.log('❌ CHECKSUM MISMATCH - TRANSACTION MAY BE TAMPERED!');
          console.log(`   Expected: ${options.checksum}`);
          console.log(`   Actual:   ${actualChecksum}\n`);
        }

        console.log(`📄 Type: ${txDetails.type}`);
        console.log(`🆔 Transaction ID: ${result.transactionId}`);
        console.log(`🔢 Byte Length: ${txBytes.length}`);
        console.log(`#️⃣  Checksum: ${actualChecksum}`);
        console.log(`🔐 Hash: ${frozenTx.hash}\n`);

        if (txDetails.contract) {
          console.log(`📋 Contract: ${txDetails.contract}`);
        }

        if (txDetails.function) {
          console.log(`⚙️  Function: ${txDetails.function}`);
        }

        // Display parameters
        if (Object.keys(txDetails.parameters).length > 0) {
          console.log('\n📝 PARAMETERS:');
          for (const [key, value] of Object.entries(txDetails.parameters)) {
            console.log(`   ${key}: ${value}`);
          }
        }

        // Display transfers
        console.log('\n💰 TRANSFERS:');
        if (txDetails.transfers.hbar) {
          console.log(`   HBAR: ${txDetails.transfers.hbar}`);
        } else {
          console.log('   HBAR: None');
        }

        if (txDetails.transfers.tokens && txDetails.transfers.tokens.length > 0) {
          txDetails.transfers.tokens.forEach(t => {
            console.log(`   Token ${t.token}: ${t.amount} to ${t.recipient}`);
          });
        }

        // Display gas
        if (txDetails.gas && txDetails.gas.limit) {
          console.log('\n⛽ GAS:');
          console.log(`   Limit: ${txDetails.gas.limit.toLocaleString()}`);
          if (txDetails.gas.estimatedCost) {
            console.log(`   Estimated Cost: ${txDetails.gas.estimatedCost}`);
          }
        }

        // Verbose raw data
        if (options.verbose && txDetails.raw) {
          console.log('\n🔍 RAW DATA:');
          if (txDetails.raw.functionSelector) {
            console.log(`   Function Selector: ${txDetails.raw.functionSelector}`);
          }
          if (txDetails.raw.encodedParams) {
            const truncated = txDetails.raw.encodedParams.length > 66
              ? txDetails.raw.encodedParams.substring(0, 66) + '...'
              : txDetails.raw.encodedParams;
            console.log(`   Encoded Params: ${truncated}`);
          }
        }

        console.log('\n─────────────────────────────────────────────────────────');
        console.log('⚠️  VERIFY ALL DETAILS BEFORE SIGNING');
        console.log('─────────────────────────────────────────────────────────\n');

        console.log('NEXT STEPS:');
        console.log('  If details look correct, sign with: hedera-multisig sign');
        console.log('  Return signature tuple to coordinator for execution\n');

        process.exit(checksumValid === false ? ExitCodes.VALIDATION_ERROR : ExitCodes.SUCCESS);

      } catch (error) {
        if (options.json || jsonOutput.enabled) {
          jsonOutput.addError(error.message);
          jsonOutput.print(false);
        } else {
          console.error(`\n❌ Error: ${error.message}\n`);
        }
        process.exit(ExitCodes.INTERNAL_ERROR);
      }
    });

  // ============================================================================
  // offline execute
  // ============================================================================
  offline
    .command('execute')
    .description('Collect signature tuples and execute a frozen transaction')
    .option('-b, --base64 <string>', 'Base64-encoded frozen transaction')
    .option('-f, --file <path>', 'Read frozen transaction from file')
    .option('-s, --signatures <tuples...>', 'Signature tuples (publicKey:signature format)')
    .option('--sig-file <path>', 'Read signatures from file (one per line)')
    .option('-t, --threshold <number>', 'Required signature threshold', '1')
    .option('--dry-run', 'Validate signatures without executing')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
Collect signature tuples and execute a frozen transaction.
Signature tuples are in the format: publicKey:signatureBase64

Examples:
  # Execute with inline signatures
  $ hedera-multisig offline execute -b "CgQQ..." -s "302a...:Sg7m..." "302a...:Xk9n..."

  # Execute from files
  $ hedera-multisig offline execute -f transaction.txt --sig-file signatures.txt

  # Dry run (validate without executing)
  $ hedera-multisig offline execute -b "CgQQ..." -s "302a...:Sg7m..." --dry-run

Signature Tuple Format:
  <publicKey>:<signatureBase64>
  Example: 302a300506032b6570032100abc123...:Sg7m2xKl9pQr8sT0uV1wX2yZ3a4b5c6d7e8f...

Environment Variables:
  OPERATOR_ID    - Hedera operator account ID
  OPERATOR_KEY   - Hedera operator private key
  HEDERA_NETWORK - Network (mainnet/testnet/previewnet)
    `)
    .action(async (options, command) => {
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');
      const {
        Client,
        AccountId,
        PrivateKey,
        PublicKey
      } = require('@hashgraph/sdk');
      const TransactionFreezer = require('../../core/TransactionFreezer');
      const SignatureVerifier = require('../../core/SignatureVerifier');

      const jsonOutput = new JsonOutput(options.json || command.parent?.parent?.opts().json);

      try {
        // Load environment
        require('dotenv').config();

        const operatorId = process.env.OPERATOR_ID;
        const operatorKey = process.env.OPERATOR_KEY;
        const network = process.env.HEDERA_NETWORK || 'testnet';

        if (!operatorId || !operatorKey) {
          throw new Error('Missing OPERATOR_ID or OPERATOR_KEY environment variables');
        }

        // Get base64 transaction input
        let base64Input;
        if (options.base64) {
          base64Input = options.base64.trim();
        } else if (options.file) {
          const filePath = path.resolve(options.file);
          if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
          }
          const content = fs.readFileSync(filePath, 'utf8');
          const lines = content.split('\n').filter(l => l && !l.startsWith('#') && !l.startsWith('BASE64:') && !l.startsWith('CHECKSUM:'));
          base64Input = lines.find(l => l.length > 50 && !l.includes(' '))?.trim();
          if (!base64Input) {
            throw new Error('Could not find base64 transaction in file');
          }
        } else {
          throw new Error('Transaction required. Use --base64 or --file option.');
        }

        // Get signatures
        let signatureTuples = [];

        if (options.signatures && options.signatures.length > 0) {
          signatureTuples = options.signatures;
        }

        if (options.sigFile) {
          const sigFilePath = path.resolve(options.sigFile);
          if (!fs.existsSync(sigFilePath)) {
            throw new Error(`Signature file not found: ${sigFilePath}`);
          }
          const content = fs.readFileSync(sigFilePath, 'utf8');
          const fileSignatures = content.split('\n')
            .map(l => l.trim())
            .filter(l => l && l.includes(':') && !l.startsWith('#'));
          signatureTuples = signatureTuples.concat(fileSignatures);
        }

        if (signatureTuples.length === 0) {
          throw new Error('No signatures provided. Use --signatures or --sig-file option.');
        }

        const threshold = parseInt(options.threshold);
        if (signatureTuples.length < threshold) {
          throw new Error(`Insufficient signatures: ${signatureTuples.length} provided, ${threshold} required`);
        }

        // Reconstruct the frozen transaction
        const frozenTx = TransactionFreezer.fromBase64(base64Input, Date.now());
        const txBytes = frozenTx.bytes;

        // Parse and verify signatures
        const verifiedSignatures = [];
        const errors = [];

        if (!options.json && !jsonOutput.enabled) {
          console.log('\n╔═══════════════════════════════════════════════════════╗');
          console.log('║         VERIFYING SIGNATURES                          ║');
          console.log('╚═══════════════════════════════════════════════════════╝\n');
        }

        for (let i = 0; i < signatureTuples.length; i++) {
          const tuple = signatureTuples[i];
          const colonIndex = tuple.lastIndexOf(':');

          if (colonIndex === -1) {
            errors.push({ index: i, error: 'Invalid format (missing colon separator)' });
            continue;
          }

          const publicKeyStr = tuple.substring(0, colonIndex);
          const signatureBase64 = tuple.substring(colonIndex + 1);

          try {
            // Parse public key
            const publicKey = PublicKey.fromString(publicKeyStr);

            // Decode signature
            const signatureBytes = Buffer.from(signatureBase64, 'base64');

            // Verify signature
            const isValid = publicKey.verify(txBytes, signatureBytes);

            if (isValid) {
              verifiedSignatures.push({
                publicKey: publicKeyStr,
                publicKeyObj: publicKey,
                signature: signatureBytes,
                signatureBase64
              });
              if (!options.json && !jsonOutput.enabled) {
                const shortKey = publicKeyStr.substring(0, 12) + '...' + publicKeyStr.substring(publicKeyStr.length - 8);
                console.log(`  ✅ Signature ${i + 1}: Valid (${shortKey})`);
              }
            } else {
              errors.push({ index: i, publicKey: publicKeyStr, error: 'Signature verification failed' });
              if (!options.json && !jsonOutput.enabled) {
                console.log(`  ❌ Signature ${i + 1}: INVALID`);
              }
            }
          } catch (error) {
            errors.push({ index: i, error: error.message });
            if (!options.json && !jsonOutput.enabled) {
              console.log(`  ❌ Signature ${i + 1}: Error - ${error.message}`);
            }
          }
        }

        // Check threshold
        if (verifiedSignatures.length < threshold) {
          const errorMsg = `Threshold not met: ${verifiedSignatures.length} valid signatures, ${threshold} required`;
          if (options.json || jsonOutput.enabled) {
            jsonOutput.addError(errorMsg);
            jsonOutput.set('verified', verifiedSignatures.length);
            jsonOutput.set('required', threshold);
            jsonOutput.set('errors', errors);
            jsonOutput.print(false);
          } else {
            console.error(`\n❌ ${errorMsg}\n`);
          }
          process.exit(ExitCodes.THRESHOLD_NOT_MET);
        }

        if (!options.json && !jsonOutput.enabled) {
          console.log(`\n✅ ${verifiedSignatures.length}/${threshold} valid signatures - threshold met!\n`);
        }

        // Dry run - just validate
        if (options.dryRun) {
          const result = {
            dryRun: true,
            verifiedSignatures: verifiedSignatures.length,
            threshold,
            message: 'Signatures validated successfully (dry run - not executed)'
          };

          if (options.json || jsonOutput.enabled) {
            Object.entries(result).forEach(([k, v]) => jsonOutput.set(k, v));
            jsonOutput.print(true);
          } else {
            console.log('🔍 DRY RUN: Signatures validated successfully');
            console.log('   Transaction was NOT submitted to the network.\n');
          }
          process.exit(ExitCodes.SUCCESS);
        }

        // Execute the transaction
        if (!options.json && !jsonOutput.enabled) {
          console.log('═══════════════════════════════════════════════════════════');
          console.log('EXECUTING TRANSACTION...');
          console.log('═══════════════════════════════════════════════════════════\n');
        }

        // Setup client
        const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
        client.setOperator(AccountId.fromString(operatorId), PrivateKey.fromString(operatorKey));

        // Add signatures to transaction
        let signedTx = frozenTx.transaction;
        for (const sig of verifiedSignatures) {
          signedTx = await signedTx.addSignature(sig.publicKeyObj, sig.signature);
        }

        // Execute
        const txResponse = await signedTx.execute(client);
        const receipt = await txResponse.getReceipt(client);

        const result = {
          transactionId: txResponse.transactionId.toString(),
          status: receipt.status.toString(),
          signaturesUsed: verifiedSignatures.length
        };

        if (options.json || jsonOutput.enabled) {
          Object.entries(result).forEach(([k, v]) => jsonOutput.set(k, v));
          jsonOutput.print(true);
        } else {
          console.log('╔═══════════════════════════════════════════════════════╗');
          console.log('║         ✅ TRANSACTION EXECUTED SUCCESSFULLY          ║');
          console.log('╚═══════════════════════════════════════════════════════╝\n');

          console.log(`Transaction ID: ${result.transactionId}`);
          console.log(`Status:         ${result.status}`);
          console.log(`Signatures:     ${result.signaturesUsed}\n`);

          console.log('View on HashScan:');
          const explorerBase = network === 'mainnet' ? 'https://hashscan.io/mainnet' : 'https://hashscan.io/testnet';
          console.log(`  ${explorerBase}/transaction/${result.transactionId}\n`);
        }

        client.close();
        process.exit(ExitCodes.SUCCESS);

      } catch (error) {
        if (options.json || jsonOutput.enabled) {
          jsonOutput.addError(error.message);
          jsonOutput.print(false);
        } else {
          console.error(`\n❌ Error: ${error.message}\n`);
        }
        process.exit(ExitCodes.INTERNAL_ERROR);
      }
    });
};
