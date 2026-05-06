#!/usr/bin/env node

/**
 * Standalone Multi-Sig Signer CLI Tool
 *
 * Use this tool to sign transactions on offline/air-gapped machines.
 * Ideal for maximum security - signing keys never touch internet-connected computers.
 *
 * Usage:
 *   node sign.js
 *   node sign.js --quick  (skip detailed display)
 */

// DEPRECATED: Use `hedera-multisig sign` (Commander.js CLI) instead of this standalone script.
console.warn('\x1b[33m⚠️  Deprecation: Use `npx hedera-multisig sign` instead of `node cli/sign.js`\x1b[0m\n');

const readlineSync = require('readline-sync');
const { PrivateKey } = require('@hashgraph/sdk');
const TransactionFreezer = require('../core/TransactionFreezer');
const SignatureVerifier = require('../core/SignatureVerifier');
const { extractAllBodyBytes } = require('../shared/transaction-decoder');
const {
  ExitCodes,
  parseCommonFlags,
  printVersion,
  getVersion
} = require('./utils/cliUtils');

// Parse common flags
const commonFlags = parseCommonFlags(process.argv.slice(2));

// Handle version flag
if (commonFlags.version) {
  printVersion();
  process.exit(ExitCodes.SUCCESS);
}

// Handle help flag
if (commonFlags.help) {
  console.log('\nHedera Multi-Sig Transaction Signer v' + getVersion() + '\n');
  console.log('Usage: node cli/sign.js [options]\n');
  console.log('Options:');
  console.log('  --quick              Skip detailed display');
  console.log('  -V, --version        Show version information');
  console.log('  -h, --help           Show this help message\n');
  console.log('This tool signs transactions offline for maximum security.');
  console.log('Use on air-gapped machines for best security practices.\n');
  process.exit(ExitCodes.SUCCESS);
}

// Check for quick mode
const quickMode = commonFlags.remainingArgs.includes('--quick');

console.log('\n╔═══════════════════════════════════════════════════════╗');
console.log('║       HEDERA MULTI-SIG TRANSACTION SIGNER            ║');
console.log('╚═══════════════════════════════════════════════════════╝\n');

console.log('🔒 This tool signs transactions offline for maximum security\n');

async function main() {
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

      // Reconstruct frozen tx to verify checksum
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

    // Try to decode transaction (won't have full details without contract interface)
    console.log('Transaction Hash: ' + frozenTx.hash);
    console.log('Transaction Bytes (first 64 chars): ' + txBytesBase64.substring(0, 64) + '...\n');

    if (!quickMode) {
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

    // Multi-node freeze: one signature per SignedTransaction body
    // (each carries a distinct nodeAccountID). Output format:
    //   publicKey:sigB64_0,sigB64_1,...,sigB64_N
    const bodies = extractAllBodyBytes(frozenTx.bytes);
    const publicKey = privateKey.publicKey.toString();
    const signaturesB64 = bodies.map((body) =>
      Buffer.from(privateKey.sign(body)).toString('base64')
    );

    // Step 7: Display signature tuple
    console.log('✅ Signature generated successfully!\n');
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║              SIGNATURE TUPLE OUTPUT                   ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    console.log('Copy the following signature tuple and send it back to');
    console.log('the transaction initiator via secure channel:\n');

    console.log('─────────────────────────────────────────────────────────');
    const signatureTuple = `${publicKey}:${signaturesB64.join(',')}`;
    console.log(signatureTuple);
    console.log('─────────────────────────────────────────────────────────\n');

    // Display breakdown for verification
    console.log('BREAKDOWN (for verification):');
    console.log(`  Public Key:    ${publicKey}`);
    console.log(`  Body count:    ${bodies.length} (multi-node freeze)`);
    console.log(`  Signatures:    ${signaturesB64.length} (one per body)`);
    console.log(`  First sig:     ${signaturesB64[0].substring(0, 32)}...`);
    console.log(`  Format:        publicKey:sig0,sig1,...,sigN\n`);

    // Local sanity-verify — each sig against its corresponding body.
    console.log('🔍 Verifying signatures...');
    let allValid = true;
    for (let i = 0; i < bodies.length; i++) {
      const sigBytes = Buffer.from(signaturesB64[i], 'base64');
      if (!privateKey.publicKey.verify(bodies[i], sigBytes)) {
        allValid = false;
        break;
      }
    }

    if (allValid) {
      console.log('✅ All signatures cryptographically valid\n');
    } else {
      console.error('❌ WARNING: At least one signature failed verification!\n');
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
}

main();
