/**
 * Sign Command
 *
 * Sign transactions offline for maximum security (air-gapped).
 */

module.exports = function(program) {
  program
    .command('sign')
    .description('Sign transactions offline (air-gapped)')
    .option('--quick', 'Skip detailed display')
    .addHelpText('after', `
This tool signs transactions offline for maximum security.
Use on air-gapped machines for best security practices.

Examples:
  $ hedera-multisig sign
  $ hedera-multisig sign --quick
    `)
    .action(async (options, command) => {
      const readlineSync = require('readline-sync');
      const { PrivateKey } = require('@hashgraph/sdk');
      const TransactionFreezer = require('../../core/TransactionFreezer');
      const SignatureVerifier = require('../../core/SignatureVerifier');
      const { ExitCodes } = require('../utils/cliUtils');

      console.log('\n╔═══════════════════════════════════════════════════════╗');
      console.log('║       HEDERA MULTI-SIG TRANSACTION SIGNER            ║');
      console.log('╚═══════════════════════════════════════════════════════╝\n');

      console.log('🔒 This tool signs transactions offline for maximum security\n');

      try {
        // Step 1: Get transaction bytes
        console.log('STEP 1: Paste Transaction Bytes\n');
        console.log('Paste the base64-encoded transaction bytes below:');

        const txBytesBase64 = readlineSync.question('Transaction bytes: ', {
          hideEchoBack: false
        });

        if (!txBytesBase64 || txBytesBase64.trim().length === 0) {
          console.error('\n❌ No transaction bytes provided. Exiting.\n');
          process.exit(ExitCodes.VALIDATION_ERROR);
        }

        // Step 2: Verify checksum (if provided)
        console.log('\nTransaction bytes received.');
        console.log(`Length: ${txBytesBase64.length} characters\n`);

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

        // Step 3: Reconstruct transaction
        console.log('STEP 2: Review Transaction Details\n');

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
        const confirmSign = readlineSync.keyInYN('Do you want to sign this transaction? ');
        console.log('');

        if (!confirmSign) {
          console.log('❌ Signing cancelled.\n');
          process.exit(ExitCodes.USER_CANCELLED);
        }

        // Step 5: Get private key
        console.log('STEP 3: Enter Private Key\n');
        console.log('⚠️  Your private key will NOT be stored or logged');
        console.log('   It exists only in memory during this signing operation\n');

        const privateKeyString = readlineSync.question('🔑 Private key: ', {
          hideEchoBack: true,
          mask: ''
        });

        console.log('');

        // Validate private key
        let privateKey;
        try {
          privateKey = PrivateKey.fromString(privateKeyString.trim());
        } catch (error) {
          console.error('❌ Invalid private key format!');
          console.error(`   Error: ${error.message}\n`);
          process.exit(ExitCodes.VALIDATION_ERROR);
        }

        // Step 6: Sign transaction
        console.log('STEP 4: Generate Signature\n');
        console.log('🔐 Signing transaction...\n');

        const signatureBytes = privateKey.sign(frozenTx.bytes);
        const publicKey = privateKey.publicKey.toString();
        const signatureBase64 = Buffer.from(signatureBytes).toString('base64');

        // Step 7: Display signature tuple
        console.log('✅ Signature generated successfully!\n');
        console.log('╔═══════════════════════════════════════════════════════╗');
        console.log('║              SIGNATURE TUPLE OUTPUT                   ║');
        console.log('╚═══════════════════════════════════════════════════════╝\n');

        console.log('Copy the following signature tuple and send it back to');
        console.log('the transaction initiator via secure channel:\n');

        console.log('─────────────────────────────────────────────────────────');
        const signatureTuple = `${publicKey}:${signatureBase64}`;
        console.log(signatureTuple);
        console.log('─────────────────────────────────────────────────────────\n');

        // Display breakdown for verification
        console.log('BREAKDOWN (for verification):');
        console.log(`  Public Key: ${publicKey}`);
        console.log(`  Signature:  ${signatureBase64.substring(0, 32)}...`);
        console.log(`  Format:     publicKey:signature\n`);

        // Verify the signature locally
        console.log('🔍 Verifying signature...');
        const isValid = privateKey.publicKey.verify(frozenTx.bytes, signatureBytes);

        if (isValid) {
          console.log('✅ Signature is cryptographically valid\n');
        } else {
          console.error('❌ WARNING: Signature verification failed!\n');
        }

        console.log('NEXT STEPS:');
        console.log('  1. Copy the signature tuple above');
        console.log('  2. Send to transaction initiator via Signal/email');
        console.log('  3. Initiator will collect all signatures and execute\n');

        console.log('🔒 Security Notes:');
        console.log('  - Your private key was never stored');
        console.log('  - Close this terminal to clear memory');
        console.log('  - Never share your private key with anyone\n');

      } catch (error) {
        console.error('\n❌ Error: ' + error.message + '\n');
        process.exit(ExitCodes.INTERNAL_ERROR);
      }
    });
};
