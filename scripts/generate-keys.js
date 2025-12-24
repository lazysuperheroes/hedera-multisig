#!/usr/bin/env node

/**
 * Generate Hedera Key Pairs
 *
 * Generates new ED25519 key pairs with optional BIP39 mnemonic support.
 * Provides secure key generation with multiple output formats.
 *
 * Usage:
 *   # Interactive mode
 *   node scripts/generate-keys.js
 *
 *   # Generate with mnemonic
 *   node scripts/generate-keys.js --mnemonic
 *
 *   # Generate without mnemonic (direct ED25519)
 *   node scripts/generate-keys.js --no-mnemonic
 *
 *   # Generate multiple keys
 *   node scripts/generate-keys.js --count 3
 */

const {
  PrivateKey,
  Mnemonic
} = require('@hashgraph/sdk');

const readlineSync = require('readline-sync');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

function getArg(arg) {
  const index = process.argv.indexOf(`--${arg}`);
  if (index > -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
}

function getFlag(arg) {
  return process.argv.includes(`--${arg}`);
}

async function generateKeys() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║            HEDERA KEY PAIR GENERATOR                  ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  try {
    // Determine generation mode
    let useMnemonic = true;

    if (getFlag('no-mnemonic')) {
      useMnemonic = false;
    } else if (!getFlag('mnemonic')) {
      // Interactive choice
      console.log(chalk.white('Select key generation method:\n'));
      console.log(chalk.gray('  1. With mnemonic (BIP39 recovery phrase) - Recommended'));
      console.log(chalk.gray('  2. Direct ED25519 (no recovery phrase)\n'));

      const choice = readlineSync.question(chalk.cyan('Method (1 or 2) [1]: ')) || '1';
      useMnemonic = choice === '1';
    }

    // Determine how many keys to generate
    const countArg = getArg('count');
    const count = countArg ? parseInt(countArg) : 1;

    if (count < 1 || count > 10) {
      console.log(chalk.red('\n❌ Count must be between 1 and 10\n'));
      process.exit(1);
    }

    console.log(chalk.yellow(`\nGenerating ${count} key pair(s)...\n`));

    const keys = [];

    for (let i = 0; i < count; i++) {
      let privateKey, mnemonic = null;

      if (useMnemonic) {
        // Generate from mnemonic (24-word BIP39)
        mnemonic = await Mnemonic.generate24();
        privateKey = await mnemonic.toStandardEd25519PrivateKey();

        console.log(chalk.green(`✅ Key pair ${i + 1} generated from mnemonic`));
      } else {
        // Direct ED25519 generation
        privateKey = PrivateKey.generateED25519();

        console.log(chalk.green(`✅ Key pair ${i + 1} generated (ED25519)`));
      }

      keys.push({
        privateKey,
        publicKey: privateKey.publicKey,
        mnemonic
      });
    }

    console.log('');

    // Display keys
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('GENERATED KEY PAIRS'));
    console.log(chalk.cyan('═'.repeat(60)));

    keys.forEach((key, idx) => {
      console.log(chalk.yellow(`\n--- Key Pair ${idx + 1} ---`));

      if (key.mnemonic) {
        console.log(chalk.white('\nMnemonic (24 words):'));
        console.log(chalk.gray(key.mnemonic.toString()));
      }

      console.log(chalk.white('\nPrivate Key (DER):'));
      console.log(chalk.bold.yellow(key.privateKey.toString()));

      console.log(chalk.white('\nPublic Key (DER):'));
      console.log(chalk.gray(key.publicKey.toString()));
    });

    console.log(chalk.cyan('\n═'.repeat(60)));

    // Save to file
    console.log('');
    const save = readlineSync.keyInYNStrict(
      chalk.yellow('Do you want to save your keys to file?\n**HIGHLY RECOMMENDED as if lost the wallet could become inaccessible**')
    );

    if (save) {
      const startTime = new Date();
      const timestamp = startTime.toISOString().split('.')[0].replaceAll(':', '-');
      const filename = path.join(process.cwd(), `hedera-keys-${timestamp}.txt`);

      let fileContent = '';
      fileContent += '╔════════════════════════════════════════════════════════════════╗\n';
      fileContent += '║              HEDERA KEY PAIRS - KEEP SECURE                    ║\n';
      fileContent += '╚════════════════════════════════════════════════════════════════╝\n';
      fileContent += `\nGenerated: ${startTime.toISOString()}\n`;
      fileContent += `Key Count: ${keys.length}\n`;
      fileContent += `Method: ${useMnemonic ? 'Mnemonic (BIP39)' : 'Direct ED25519'}\n`;
      fileContent += '\n';
      fileContent += '⚠️  WARNING: Keep this file secure! Anyone with these keys\n';
      fileContent += '    can control accounts associated with them.\n';
      fileContent += '\n';
      fileContent += '════════════════════════════════════════════════════════════════\n';

      keys.forEach((key, idx) => {
        fileContent += `\n--- Key Pair ${idx + 1} ---\n`;

        if (key.mnemonic) {
          fileContent += '\nMnemonic (24 words):\n';
          fileContent += key.mnemonic.toString() + '\n';
        }

        fileContent += '\nPrivate Key (DER):\n';
        fileContent += key.privateKey.toString() + '\n';

        fileContent += '\nPublic Key (DER):\n';
        fileContent += key.publicKey.toString() + '\n';

        fileContent += '\n════════════════════════════════════════════════════════════════\n';
      });

      fs.writeFileSync(filename, fileContent, 'utf8');

      console.log(chalk.green(`\n✅ Keys saved to: ${filename}\n`));
      console.log(chalk.yellow('⚠️  SECURITY REMINDERS:\n'));
      console.log(chalk.white('  - Store this file in a secure location'));
      console.log(chalk.white('  - Consider encrypting the file'));
      console.log(chalk.white('  - Never share your private keys'));
      console.log(chalk.white('  - Back up the mnemonic in a separate location'));
      console.log(chalk.white('  - Delete this file after backing up securely\n'));

      // Also save public keys only
      const publicOnlyFile = path.join(process.cwd(), `public-keys-${timestamp}.txt`);
      let publicContent = 'Public Keys:\n';
      keys.forEach((key, idx) => {
        publicContent += `${idx + 1}. ${key.publicKey.toString()}\n`;
      });

      fs.writeFileSync(publicOnlyFile, publicContent, 'utf8');
      console.log(chalk.green(`✅ Public keys saved to: ${publicOnlyFile}\n`));

    } else {
      console.log(chalk.yellow('\n⚠️  Keys not saved to file.'));
      console.log(chalk.white('   Make sure to copy them somewhere secure!\n'));
    }

    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('NEXT STEPS'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.white('1. Save your private keys securely'));
    if (useMnemonic) {
      console.log(chalk.white('2. Back up your mnemonic phrase (recovery)'));
    }
    console.log(chalk.white('3. Share only public keys for multi-sig setup'));
    console.log(chalk.white('4. Use setup-multisig-account.js to configure account\n'));

  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    console.error(chalk.gray(error.stack));
    process.exit(1);
  }
}

// Show help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node scripts/generate-keys.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --mnemonic       Generate keys from BIP39 mnemonic (default)');
  console.log('  --no-mnemonic    Generate direct ED25519 keys without mnemonic');
  console.log('  --count N        Generate N key pairs (default: 1, max: 10)');
  console.log('  --help, -h       Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/generate-keys.js');
  console.log('  node scripts/generate-keys.js --count 3');
  console.log('  node scripts/generate-keys.js --no-mnemonic');
  process.exit(0);
}

// Run
generateKeys();
