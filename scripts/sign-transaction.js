#!/usr/bin/env node

/**
 * Sign Transaction Offline
 *
 * Signs a frozen transaction with one or more private keys.
 * Useful for air-gapped signing or batch signing workflows.
 *
 * Usage:
 *   # Interactive mode
 *   node scripts/sign-transaction.js
 *
 *   # From file with single key
 *   node scripts/sign-transaction.js --file transaction.json --key <private-key>
 *
 *   # From file with multiple keys
 *   node scripts/sign-transaction.js --file transaction.json --keys <key1,key2,key3>
 *
 *   # Export signed transaction
 *   node scripts/sign-transaction.js --file transaction.json --key <key> --output signed-tx.json
 */

const {
  Transaction,
  PrivateKey
} = require('@hashgraph/sdk');

const readlineSync = require('readline-sync');
const chalk = require('chalk');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

function getArg(arg) {
  const index = process.argv.indexOf(`--${arg}`);
  if (index > -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
}

function calculateChecksum(txBytes) {
  return crypto.createHash('sha256').update(txBytes).digest('hex');
}

function getSignatureCount(transaction) {
  try {
    const sigMap = transaction._signedTransactions?.list?.[0]?.sigMap;
    if (sigMap && sigMap.sigPair) {
      return sigMap.sigPair.length;
    }
  } catch (e) {
    // Ignore
  }
  return 0;
}

async function signTransaction() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║           SIGN TRANSACTION OFFLINE                    ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  try {
    let transactionBytes;
    let metadata = null;
    let inputFilePath = null;

    // Get transaction bytes
    const fileArg = getArg('file');

    if (fileArg) {
      if (!fs.existsSync(fileArg)) {
        console.log(chalk.red(`\n❌ File not found: ${fileArg}\n`));
        process.exit(1);
      }

      inputFilePath = fileArg;
      const fileContent = fs.readFileSync(fileArg, 'utf8');
      const data = JSON.parse(fileContent);

      if (data.transaction) {
        transactionBytes = data.transaction;
        metadata = data;
        console.log(chalk.green(`✅ Loaded transaction from file: ${fileArg}\n`));
      } else if (typeof data === 'string') {
        transactionBytes = data;
        console.log(chalk.green(`✅ Loaded transaction from file: ${fileArg}\n`));
      } else {
        console.log(chalk.red('\n❌ Invalid file format. Expected JSON with "transaction" field or plain base64 string\n'));
        process.exit(1);
      }

    } else {
      // Interactive mode
      console.log(chalk.yellow('How do you want to provide the transaction?\n'));
      console.log(chalk.gray('  1. Paste base64-encoded transaction bytes'));
      console.log(chalk.gray('  2. Load from file\n'));

      const method = readlineSync.question(chalk.cyan('Method (1 or 2) [1]: ')) || '1';

      if (method === '2') {
        const filePath = readlineSync.question(chalk.cyan('File path: '));

        if (!fs.existsSync(filePath)) {
          console.log(chalk.red(`\n❌ File not found: ${filePath}\n`));
          process.exit(1);
        }

        inputFilePath = filePath;
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(fileContent);

        if (data.transaction) {
          transactionBytes = data.transaction;
          metadata = data;
        } else if (typeof data === 'string') {
          transactionBytes = data;
        } else {
          console.log(chalk.red('\n❌ Invalid file format\n'));
          process.exit(1);
        }

      } else {
        transactionBytes = readlineSync.question(chalk.cyan('\nPaste transaction bytes (base64): '));
      }

      console.log('');
    }

    // Decode transaction
    console.log(chalk.yellow('⏳ Loading transaction...\n'));

    const txBytes = Buffer.from(transactionBytes, 'base64');
    const checksumBefore = calculateChecksum(txBytes);
    let transaction = Transaction.fromBytes(txBytes);

    const signaturesBefore = getSignatureCount(transaction);

    console.log(chalk.white('Transaction Information:'));
    console.log(chalk.gray(`  Type: ${transaction.constructor.name}`));
    console.log(chalk.gray(`  Transaction ID: ${transaction.transactionId?.toString() || 'Not set'}`));
    console.log(chalk.gray(`  Existing Signatures: ${signaturesBefore}`));
    console.log(chalk.gray(`  Checksum (before): ${checksumBefore}\n`));

    // Get private keys
    const keyArg = getArg('key');
    const keysArg = getArg('keys');
    let privateKeys = [];

    if (keyArg) {
      privateKeys = [keyArg];
      console.log(chalk.green('✅ Using key from command line\n'));

    } else if (keysArg) {
      privateKeys = keysArg.split(',').map(k => k.trim());
      console.log(chalk.green(`✅ Using ${privateKeys.length} keys from command line\n`));

    } else {
      // Interactive key collection
      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold.white('PRIVATE KEY COLLECTION'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.yellow('Enter private keys to sign (one per line, empty to finish):\n'));

      let index = 1;
      while (true) {
        const key = readlineSync.question(chalk.cyan(`Private key ${index}: `), {
          hideEchoBack: true
        });

        if (!key) break;

        privateKeys.push(key.trim());
        index++;
      }

      console.log('');
    }

    if (privateKeys.length === 0) {
      console.log(chalk.red('❌ No private keys provided. Exiting.\n'));
      process.exit(1);
    }

    console.log(chalk.green(`✅ Collected ${privateKeys.length} private key(s)\n`));

    // Sign with each key
    console.log(chalk.yellow('⏳ Signing transaction...\n'));

    let signatureCount = 0;

    for (let i = 0; i < privateKeys.length; i++) {
      try {
        const privateKey = PrivateKey.fromString(privateKeys[i]);
        const publicKey = privateKey.publicKey;

        await transaction.sign(privateKey);
        signatureCount++;

        console.log(chalk.green(`  ✅ Signature ${signatureCount} added`));
        console.log(chalk.gray(`     Public key: ${publicKey.toString().substring(0, 20)}...\n`));

      } catch (error) {
        console.log(chalk.red(`  ❌ Failed to sign with key ${i + 1}: ${error.message}\n`));
      }
    }

    if (signatureCount === 0) {
      console.log(chalk.red('\n❌ No signatures added. Exiting.\n'));
      process.exit(1);
    }

    // Get final state
    const signedTxBytes = transaction.toBytes();
    const signedTxBase64 = Buffer.from(signedTxBytes).toString('base64');
    const checksumAfter = calculateChecksum(signedTxBytes);
    const signaturesAfter = getSignatureCount(transaction);

    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.green('✅ SIGNING COMPLETE'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.white('Signing Summary:'));
    console.log(chalk.gray(`  Keys Used: ${signatureCount}`));
    console.log(chalk.gray(`  Signatures Before: ${signaturesBefore}`));
    console.log(chalk.gray(`  Signatures After: ${signaturesAfter}`));
    console.log(chalk.gray(`  New Signatures: ${signaturesAfter - signaturesBefore}`));
    console.log(chalk.gray(`  Checksum (after): ${checksumAfter}\n`));

    // Export signed transaction
    const outputArg = getArg('output');
    let outputPath;

    if (outputArg) {
      outputPath = outputArg;
    } else {
      const saveFile = readlineSync.keyInYN(chalk.cyan('Save signed transaction to file? '));

      if (!saveFile) {
        console.log(chalk.yellow('\n⚠️  Transaction not saved. Here are the signed bytes:\n'));
        console.log(chalk.gray(signedTxBase64));
        console.log('');
        process.exit(0);
      }

      // Auto-generate filename
      if (inputFilePath) {
        const parsedPath = path.parse(inputFilePath);
        outputPath = path.join(parsedPath.dir, `${parsedPath.name}-signed${parsedPath.ext}`);
      } else {
        const timestamp = new Date().toISOString().split('.')[0].replaceAll(':', '-');
        outputPath = `signed-transaction-${timestamp}.json`;
      }
    }

    // Create output data
    const outputData = {
      transaction: signedTxBase64,
      signatures: signaturesAfter,
      checksum: checksumAfter,
      signedAt: new Date().toISOString(),
      transactionType: transaction.constructor.name,
      transactionId: transaction.transactionId?.toString() || 'Not set'
    };

    // Preserve metadata from input file
    if (metadata) {
      outputData.operation = metadata.operation;
      outputData.accountId = metadata.accountId;
      outputData.network = metadata.network;
      outputData.createdAt = metadata.createdAt;
    }

    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');

    console.log(chalk.green(`✅ Signed transaction saved to: ${outputPath}\n`));
    console.log(chalk.yellow('⚠️  NEXT STEPS:'));
    console.log(chalk.white('  - Share this file with other signers (if more signatures needed)'));
    console.log(chalk.white('  - Execute the transaction when threshold is met'));
    console.log(chalk.white('  - Use query-transaction.js to inspect the signed transaction\n'));

  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    console.error(chalk.gray(error.stack));
    process.exit(1);
  }
}

// Show help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node scripts/sign-transaction.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --file <path>      Load transaction from JSON file');
  console.log('  --key <key>        Private key to sign with');
  console.log('  --keys <k1,k2>     Multiple private keys (comma-separated)');
  console.log('  --output <path>    Output file path for signed transaction');
  console.log('  --help, -h         Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/sign-transaction.js');
  console.log('  node scripts/sign-transaction.js --file tx.json --key <private-key>');
  console.log('  node scripts/sign-transaction.js --file tx.json --keys <key1,key2,key3>');
  console.log('  node scripts/sign-transaction.js --file tx.json --key <key> --output signed.json');
  process.exit(0);
}

// Run
signTransaction();
