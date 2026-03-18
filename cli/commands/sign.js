/**
 * Sign Command
 *
 * Sign transactions offline for maximum security (air-gapped).
 */

module.exports = function(program) {
  program
    .command('sign')
    .description('Sign transactions offline (air-gapped)')
    .option('-b, --base64 <string>', 'Transaction bytes as base64 (non-interactive)')
    .option('-f, --key-file <path>', 'Encrypted key file (non-interactive)')
    .option('--passphrase <value>', 'Passphrase for encrypted key file')
    .option('-k, --key <hex>', 'Private key hex (DEPRECATED, use --key-file)')
    .option('--no-confirm', 'Skip confirmation prompt (for scripting)')
    .option('--quick', 'Skip detailed display')
    .option('-j, --json', 'Output as JSON')
    .addHelpText('after', `
This tool signs transactions offline for maximum security.

Examples:
  # Interactive mode (air-gapped)
  $ hedera-multisig sign

  # Non-interactive mode (for scripting/agents)
  $ hedera-multisig sign --base64 "CgQQBx..." --key-file keys.enc --passphrase secret --json

  # Pipe transaction from freeze command
  $ hedera-multisig offline freeze -t transfer -f 0.0.1 -T 0.0.2 -a 10 --raw | hedera-multisig sign --key-file keys.enc --passphrase secret --json
    `)
    .action(async (options, command) => {
      const { PrivateKey } = require('@hashgraph/sdk');
      const TransactionFreezer = require('../../core/TransactionFreezer');
      const SignatureVerifier = require('../../core/SignatureVerifier');
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');

      const globalOpts = command.optsWithGlobals();
      const isJson = options.json || globalOpts.json;
      const jsonOutput = new JsonOutput(isJson);
      const nonInteractive = options.base64 || !process.stdin.isTTY;

      if (!nonInteractive) {
        console.log('\n╔═══════════════════════════════════════════════════════╗');
        console.log('║       HEDERA MULTI-SIG TRANSACTION SIGNER            ║');
        console.log('╚═══════════════════════════════════════════════════════╝\n');
        console.log('🔒 This tool signs transactions offline for maximum security\n');
      }

      try {
        // Step 1: Get transaction bytes
        let txBytesBase64;

        if (options.base64) {
          txBytesBase64 = options.base64.trim();
        } else if (!process.stdin.isTTY) {
          // Read from stdin pipe
          const chunks = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk);
          }
          const input = Buffer.concat(chunks).toString('utf8').trim();
          // Extract base64 (handle formatted output)
          const lines = input.split('\n').filter(l => l && !l.startsWith('#') && !l.startsWith('BASE64:'));
          txBytesBase64 = lines.find(l => l.length > 50 && !l.includes(':'))?.trim() || input.trim();
        } else {
          // Interactive mode
          console.log('STEP 1: Paste Transaction Bytes\n');
          console.log('Paste the base64-encoded transaction bytes below:');
          const readlineSync = require('readline-sync');
          txBytesBase64 = readlineSync.question('Transaction bytes: ', { hideEchoBack: false });
        }

        if (!txBytesBase64 || txBytesBase64.trim().length === 0) {
          if (!isJson) console.error('\n❌ No transaction bytes provided. Exiting.\n');
          process.exit(ExitCodes.VALIDATION_ERROR);
        }

        // Step 2: Verify checksum (if provided)
        if (!nonInteractive) {
          console.log('\nTransaction bytes received.');
          console.log(`Length: ${txBytesBase64.length} characters\n`);
        }

        if (!nonInteractive) {
          const readlineSync = require('readline-sync');
          const wantChecksum = readlineSync.keyInYN('Do you have a checksum to verify? ');
          console.log('');

          if (wantChecksum) {
            const expectedChecksum = readlineSync.question('Expected checksum: ');

            const frozenTxTemp = TransactionFreezer.fromBase64(txBytesBase64, Date.now());
            const actualChecksum = SignatureVerifier.generateChecksum(frozenTxTemp);

            if (actualChecksum !== expectedChecksum) {
              console.error('❌ CHECKSUM MISMATCH!');
              console.error(`   Expected: ${expectedChecksum}`);
              console.error(`   Actual:   ${actualChecksum}`);
              console.error('   This may indicate transaction tampering. Aborting.\n');

              const proceed = readlineSync.keyInYN('Continue anyway? (NOT RECOMMENDED) ');
              if (!proceed) {
                console.log('\nAborted.\n');
                process.exit(ExitCodes.USER_CANCELLED);
              }
            } else {
              console.log('✅ Checksum verified!\n');
            }
          }
        }

        // Step 3: Reconstruct transaction
        if (!nonInteractive) console.log('STEP 2: Review Transaction Details\n');

        const frozenTx = TransactionFreezer.fromBase64(txBytesBase64, Date.now());

        console.log('Transaction Hash: ' + frozenTx.hash);
        console.log('Transaction Bytes (first 64 chars): ' + txBytesBase64.substring(0, 64) + '...\n');

        if (!options.quick) {
          console.log('⚠️  TRANSACTION DETAILS:');
          console.log('─────────────────────────────────────────────────────────');
          console.log('   Without the contract ABI, full transaction details cannot');
          console.log('   be decoded. Ensure you trust the transaction source!\n');
          console.log('   Transaction bytes hash: ' + frozenTx.hash);
          console.log('─────────────────────────────────────────────────────────\n');
        }

        // Step 4: Confirm signing
        if (!nonInteractive && options.confirm !== false) {
          const readlineSync = require('readline-sync');
          const confirmSign = readlineSync.keyInYN('Do you want to sign this transaction? ');
          console.log('');
          if (!confirmSign) {
            console.log('❌ Signing cancelled.\n');
            process.exit(ExitCodes.USER_CANCELLED);
          }
        }

        // Step 5: Get private key
        let privateKey;

        if (options.keyFile) {
          // Load from encrypted key file
          const EncryptedFileProvider = require('../../keyManagement/EncryptedFileProvider');
          const provider = new EncryptedFileProvider(options.keyFile);
          if (options.passphrase) {
            // Non-interactive: set passphrase directly
            provider._passphrase = options.passphrase;
          }
          const keys = await provider.getKeys();
          privateKey = keys[0].privateKey || keys[0];
          if (!nonInteractive) console.log('✅ Key loaded from encrypted file\n');
        } else if (options.key) {
          // Inline key (deprecated)
          if (!nonInteractive) {
            console.log('⚠️  DEPRECATED: --key flag exposes your private key. Use --key-file.\n');
          }
          privateKey = PrivateKey.fromString(options.key.trim());
        } else if (nonInteractive) {
          console.error('Non-interactive mode requires --key-file or --key');
          process.exit(ExitCodes.VALIDATION_ERROR);
        } else {
          // Interactive: prompt for key
          console.log('STEP 3: Enter Private Key\n');
          console.log('⚠️  Your private key will NOT be stored or logged');
          console.log('   It exists only in memory during this signing operation\n');
          const readlineSync = require('readline-sync');
          const privateKeyString = readlineSync.question('🔑 Private key: ', {
            hideEchoBack: true,
            mask: ''
          });
          console.log('');
          try {
            privateKey = PrivateKey.fromString(privateKeyString.trim());
          } catch (error) {
            console.error('❌ Invalid private key format!');
            console.error(`   Error: ${error.message}\n`);
            process.exit(ExitCodes.VALIDATION_ERROR);
          }
        }

        // Step 6: Sign transaction
        console.log('STEP 4: Generate Signature\n');
        console.log('🔐 Signing transaction...\n');

        const signatureBytes = privateKey.sign(frozenTx.bytes);
        const publicKey = privateKey.publicKey.toString();
        const signatureBase64 = Buffer.from(signatureBytes).toString('base64');

        // Verify the signature locally
        const isValid = privateKey.publicKey.verify(frozenTx.bytes, signatureBytes);
        const signatureTuple = `${publicKey}:${signatureBase64}`;

        // Output
        if (isJson) {
          jsonOutput.set('signatureTuple', signatureTuple);
          jsonOutput.set('publicKey', publicKey);
          jsonOutput.set('signature', signatureBase64);
          jsonOutput.set('verified', isValid);
          jsonOutput.set('transactionHash', frozenTx.hash);
          jsonOutput.print(isValid);
        } else {
          console.log('✅ Signature generated successfully!\n');
          console.log('╔═══════════════════════════════════════════════════════╗');
          console.log('║              SIGNATURE TUPLE OUTPUT                   ║');
          console.log('╚═══════════════════════════════════════════════════════╝\n');
          console.log('─────────────────────────────────────────────────────────');
          console.log(signatureTuple);
          console.log('─────────────────────────────────────────────────────────\n');
          console.log('BREAKDOWN (for verification):');
          console.log(`  Public Key: ${publicKey}`);
          console.log(`  Signature:  ${signatureBase64.substring(0, 32)}...`);
          console.log(`  Format:     publicKey:signature\n`);

          if (isValid) {
            console.log('✅ Signature is cryptographically valid\n');
          } else {
            console.error('❌ WARNING: Signature verification failed!\n');
          }

          console.log('NEXT STEPS:');
          console.log('  1. Copy the signature tuple above');
          console.log('  2. Send to transaction initiator via Signal/email');
          console.log('  3. Initiator will collect all signatures and execute\n');
        }

      } catch (error) {
        console.error('\n❌ Error: ' + error.message + '\n');
        process.exit(ExitCodes.INTERNAL_ERROR);
      }
    });
};
