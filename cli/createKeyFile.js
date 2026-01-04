#!/usr/bin/env node

/**
 * Create Encrypted Key File CLI Tool
 *
 * Interactive tool to create AES-256-GCM encrypted key files.
 * Prompts for private keys and passphrase, creates secure encrypted file.
 *
 * Usage:
 *   node createKeyFile.js
 *   node createKeyFile.js --output path/to/output.encrypted
 */

const readlineSync = require('readline-sync');
const path = require('path');
const fs = require('fs');
const EncryptedFileProvider = require('../keyManagement/EncryptedFileProvider');
const KeyValidator = require('../keyManagement/KeyValidator');
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
  console.log('\nCreate Encrypted Key File v' + getVersion() + '\n');
  console.log('Usage: node cli/createKeyFile.js [options]\n');
  console.log('Options:');
  console.log('  --output <path>      Path to output file (default: multisig-keys.encrypted)');
  console.log('  -V, --version        Show version information');
  console.log('  -h, --help           Show this help message\n');
  console.log('This tool creates an AES-256-GCM encrypted file to securely');
  console.log('store multi-sig private keys with PBKDF2 key derivation.\n');
  process.exit(ExitCodes.SUCCESS);
}

console.log('\n╔═══════════════════════════════════════════════════════╗');
console.log('║        CREATE ENCRYPTED KEY FILE                      ║');
console.log('╚═══════════════════════════════════════════════════════╝\n');

console.log('This tool creates an encrypted file to securely store');
console.log('multi-sig private keys.\n');

console.log('🔐 Security: AES-256-GCM encryption with PBKDF2\n');

async function main() {
  try {
    // Step 1: Determine output path
    const defaultPath = path.join(process.cwd(), 'multisig-keys.encrypted');
    let outputPath = defaultPath;

    // Check for --output flag
    const outputFlagIndex = process.argv.indexOf('--output');
    if (outputFlagIndex !== -1 && process.argv[outputFlagIndex + 1]) {
      outputPath = path.resolve(process.argv[outputFlagIndex + 1]);
    } else {
      const customPath = readlineSync.question(
        `Output file path (default: ${defaultPath}): `,
        { defaultInput: defaultPath }
      );
      outputPath = path.resolve(customPath);
    }

    // Check if file already exists
    if (fs.existsSync(outputPath)) {
      console.log(`\n⚠️  File already exists: ${outputPath}`);
      const overwrite = readlineSync.keyInYN('Overwrite? ');
      if (!overwrite) {
        console.log('\nCancelled.\n');
        process.exit(0);
      }
    }

    console.log(`\nOutput: ${outputPath}\n`);

    // Step 2: Collect private keys
    console.log('STEP 1: Enter Private Keys\n');

    const keyCount = readlineSync.questionInt(
      'How many private keys to encrypt? (1-10): ',
      { limit: (input) => input >= 1 && input <= 10 }
    );

    console.log('');
    console.log(`You will enter ${keyCount} private key(s).`);
    console.log('Keys will NOT be displayed on screen.\n');

    const keys = [];
    const validationErrors = [];

    for (let i = 0; i < keyCount; i++) {
      const keyNum = keyCount > 1 ? ` #${i + 1}` : '';

      let keyString;
      let isValid = false;
      let attempts = 0;

      while (!isValid && attempts < 3) {
        keyString = readlineSync.question(`🔑 Private key${keyNum}: `, {
          hideEchoBack: true,
          mask: ''
        });

        // Validate key
        const validation = KeyValidator.validatePrivateKey(keyString);

        if (validation.valid) {
          keys.push(keyString);
          console.log(`   ✅ Valid (${validation.format} format)\n`);
          isValid = true;
        } else {
          attempts++;
          console.log(`   ❌ Invalid key: ${validation.errors[0]}`);

          if (attempts < 3) {
            console.log(`   Try again (${3 - attempts} attempts remaining)\n`);
          } else {
            console.log('   Too many failed attempts for this key.\n');
            validationErrors.push(`Key ${i + 1}: ${validation.errors[0]}`);
          }
        }
      }
    }

    if (keys.length === 0) {
      console.error('❌ No valid keys entered. Exiting.\n');
      process.exit(1);
    }

    if (keys.length < keyCount) {
      console.log(`⚠️  Only ${keys.length}/${keyCount} keys successfully entered.`);
      const proceed = readlineSync.keyInYN('Continue with these keys? ');
      if (!proceed) {
        console.log('\nCancelled.\n');
        process.exit(0);
      }
      console.log('');
    }

    // Step 3: Get passphrase
    console.log('STEP 2: Set Passphrase\n');

    console.log('⚠️  IMPORTANT: If you forget this passphrase, your keys');
    console.log('   will be UNRECOVERABLE. Store it in a password manager!\n');

    console.log('Passphrase requirements:');
    console.log('  - Minimum 12 characters');
    console.log('  - Mix of uppercase, lowercase, numbers, symbols recommended\n');

    // Offer to generate passphrase
    const generatePassphrase = readlineSync.keyInYN('Generate a random passphrase? ');
    console.log('');

    let passphrase;

    if (generatePassphrase) {
      passphrase = EncryptedFileProvider.generatePassphrase(20);
      console.log('╔═══════════════════════════════════════════════════════╗');
      console.log('║         GENERATED PASSPHRASE (SAVE THIS!)            ║');
      console.log('╚═══════════════════════════════════════════════════════╝\n');
      console.log(`   ${passphrase}\n`);
      console.log('⚠️  SAVE THIS PASSPHRASE NOW in your password manager!');
      console.log('   Press any key once you have saved it...');
      readlineSync.keyIn('', { hideEchoBack: true, mask: '' });
      console.log('\n');
    } else {
      let passphraseConfirmed = false;

      while (!passphraseConfirmed) {
        passphrase = readlineSync.question('Passphrase: ', {
          hideEchoBack: true,
          mask: ''
        });

        if (passphrase.length < 12) {
          console.log('❌ Passphrase too short (minimum 12 characters)\n');
          continue;
        }

        const passphraseConfirm = readlineSync.question('Confirm passphrase: ', {
          hideEchoBack: true,
          mask: ''
        });

        if (passphrase !== passphraseConfirm) {
          console.log('❌ Passphrases do not match. Try again.\n');
        } else {
          passphraseConfirmed = true;
          console.log('');
        }
      }
    }

    // Step 4: Optional description
    console.log('STEP 3: Metadata (Optional)\n');

    const description = readlineSync.question(
      'Description (e.g., "Production 3-of-5 multi-sig"): ',
      { defaultInput: 'Multi-sig keys' }
    );

    console.log('');

    // Step 5: Create encrypted file
    console.log('STEP 4: Create Encrypted File\n');

    console.log('Creating encrypted file...\n');

    const encryptedFile = EncryptedFileProvider.createEncryptedFile(
      keys,
      passphrase,
      outputPath,
      { description }
    );

    console.log('✅ Encrypted file created successfully!\n');

    // Step 6: Display summary
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║                  FILE SUMMARY                         ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    console.log(`File: ${outputPath}`);
    console.log(`Keys Encrypted: ${keys.length}`);
    console.log(`Description: ${description}`);
    console.log(`Algorithm: ${encryptedFile.algorithm.toUpperCase()}`);
    console.log(`KDF: ${encryptedFile.kdf.toUpperCase()} (${encryptedFile.kdfParams.iterations.toLocaleString()} iterations)`);
    console.log(`Created: ${encryptedFile.metadata.created}\n`);

    // File permissions info
    if (process.platform !== 'win32') {
      console.log('File permissions set to 600 (read/write owner only)\n');
    }

    console.log('NEXT STEPS:\n');
    console.log('  1. Test decryption with:');
    console.log(`     node lib/multiSig/cli/testKeyFile.js ${outputPath}\n`);
    console.log('  2. Backup this file securely');
    console.log('  3. Store passphrase in password manager');
    console.log('  4. Use with EncryptedFileProvider:\n');
    console.log('     const provider = new EncryptedFileProvider(');
    console.log(`       '${path.basename(outputPath)}'`);
    console.log('     );');
    console.log('     const keys = await provider.getKeys();\n');

    console.log('SECURITY REMINDERS:\n');
    console.log('  ⚠️  Backup the encrypted file (losing it = losing keys)');
    console.log('  ⚠️  Store passphrase safely (forgetting it = losing keys)');
    console.log('  ⚠️  Never commit encrypted file to version control');
    console.log('  ⚠️  File permissions: ensure only you can read it\n');

  } catch (error) {
    console.error('\n❌ Error: ' + error.message + '\n');
    process.exit(1);
  }
}

main();
