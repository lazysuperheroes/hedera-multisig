/**
 * Keys Command
 *
 * Key management commands (create, test encrypted key files).
 */

const path = require('path');
const fs = require('fs');

module.exports = function(program) {
  const keys = program
    .command('keys')
    .description('Key management commands');

  // Create encrypted key file
  keys
    .command('create')
    .description('Create an encrypted key file')
    .option('-o, --output <path>', 'Output file path', 'multisig-keys.encrypted')
    .option('-k, --key <hex>', 'Private key in hex (repeatable or comma-separated)', (val, prev) => {
      const keys = val.includes(',') ? val.split(',').map(k => k.trim()) : [val.trim()];
      return prev ? prev.concat(keys) : keys;
    })
    .option('-p, --passphrase <value>', 'Passphrase for encryption (non-interactive mode)')
    .option('--json', 'Output results as JSON')
    .addHelpText('after', `
This tool creates an AES-256-GCM encrypted file to securely
store multi-sig private keys with PBKDF2 key derivation.

Examples:
  $ hedera-multisig keys create
  $ hedera-multisig keys create --output my-keys.encrypted

Non-interactive mode (all three flags required):
  $ hedera-multisig keys create --key <hex1> --key <hex2> --passphrase "my secret" --output keys.encrypted
  $ hedera-multisig keys create --key <hex1>,<hex2> --passphrase "my secret" -o keys.encrypted --json
    `)
    .action(async (options) => {
      const EncryptedFileProvider = require('../../keyManagement/EncryptedFileProvider');
      const KeyValidator = require('../../keyManagement/KeyValidator');
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');

      const jsonOutput = new JsonOutput(!!options.json);

      // Determine if non-interactive mode
      const hasKey = options.key && options.key.length > 0;
      const hasPassphrase = !!options.passphrase;
      const nonInteractive = hasKey || hasPassphrase;

      if (nonInteractive) {
        // Non-interactive mode: all three flags required
        if (!hasKey || !hasPassphrase) {
          const missing = [];
          if (!hasKey) missing.push('--key');
          if (!hasPassphrase) missing.push('--passphrase');
          const errorMsg = `Non-interactive mode requires --key, --passphrase, and --output. Missing: ${missing.join(', ')}`;
          if (jsonOutput.enabled) {
            jsonOutput.exitWithError(errorMsg, ExitCodes.VALIDATION_ERROR);
          } else {
            console.error(`\n❌ Error: ${errorMsg}\n`);
            process.exit(ExitCodes.VALIDATION_ERROR);
          }
          return;
        }

        try {
          const outputPath = path.resolve(options.output);
          const keys = options.key;

          // Validate passphrase length
          if (options.passphrase.length < 12) {
            const errorMsg = 'Passphrase must be at least 12 characters';
            if (jsonOutput.enabled) {
              jsonOutput.exitWithError(errorMsg, ExitCodes.VALIDATION_ERROR);
            } else {
              console.error(`\n❌ Error: ${errorMsg}\n`);
              process.exit(ExitCodes.VALIDATION_ERROR);
            }
            return;
          }

          // Validate all keys
          const invalidKeys = [];
          keys.forEach((k, i) => {
            const validation = KeyValidator.validatePrivateKey(k);
            if (!validation.valid) {
              invalidKeys.push({ index: i + 1, error: validation.errors[0] });
            }
          });

          if (invalidKeys.length > 0) {
            const details = invalidKeys.map(ik => `Key #${ik.index}: ${ik.error}`).join('; ');
            const errorMsg = `Invalid key(s): ${details}`;
            if (jsonOutput.enabled) {
              jsonOutput.exitWithError(errorMsg, ExitCodes.VALIDATION_ERROR);
            } else {
              console.error(`\n❌ Error: ${errorMsg}\n`);
              process.exit(ExitCodes.VALIDATION_ERROR);
            }
            return;
          }

          // Create encrypted file
          const encryptedFile = EncryptedFileProvider.createEncryptedFile(
            keys,
            options.passphrase,
            outputPath,
            { description: 'Multi-sig keys' }
          );

          if (jsonOutput.enabled) {
            jsonOutput.set('file', outputPath);
            jsonOutput.set('keysEncrypted', keys.length);
            jsonOutput.set('algorithm', encryptedFile.algorithm);
            jsonOutput.set('kdf', encryptedFile.kdf);
            jsonOutput.set('kdfIterations', encryptedFile.kdfParams.iterations);
            jsonOutput.set('created', encryptedFile.metadata.created);
            jsonOutput.print(true);
          } else {
            console.log(`\n✅ Encrypted file created: ${outputPath}`);
            console.log(`   Keys encrypted: ${keys.length}`);
            console.log(`   Algorithm: ${encryptedFile.algorithm.toUpperCase()}`);
            console.log(`   KDF: ${encryptedFile.kdf.toUpperCase()} (${encryptedFile.kdfParams.iterations.toLocaleString()} iterations)\n`);
          }

        } catch (error) {
          if (jsonOutput.enabled) {
            jsonOutput.exitWithError(error.message, ExitCodes.INTERNAL_ERROR);
          } else {
            console.error('\n❌ Error: ' + error.message + '\n');
            process.exit(ExitCodes.INTERNAL_ERROR);
          }
        }

        return;
      }

      // Interactive mode (original behavior)
      const readlineSync = require('readline-sync');

      console.log('\n╔═══════════════════════════════════════════════════════╗');
      console.log('║        CREATE ENCRYPTED KEY FILE                      ║');
      console.log('╚═══════════════════════════════════════════════════════╝\n');

      console.log('This tool creates an encrypted file to securely store');
      console.log('multi-sig private keys.\n');
      console.log('🔐 Security: AES-256-GCM encryption with PBKDF2\n');

      try {
        // Determine output path
        let outputPath = path.resolve(options.output);

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

        // Collect private keys
        console.log('STEP 1: Enter Private Keys\n');

        const keyCount = readlineSync.questionInt(
          'How many private keys to encrypt? (1-10): ',
          { limit: (input) => input >= 1 && input <= 10 }
        );

        console.log('');
        console.log(`You will enter ${keyCount} private key(s).`);
        console.log('Keys will NOT be displayed on screen.\n');

        const keys = [];

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
              }
            }
          }
        }

        if (keys.length === 0) {
          console.error('❌ No valid keys entered. Exiting.\n');
          process.exit(ExitCodes.VALIDATION_ERROR);
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

        // Get passphrase
        console.log('STEP 2: Set Passphrase\n');

        console.log('⚠️  IMPORTANT: If you forget this passphrase, your keys');
        console.log('   will be UNRECOVERABLE. Store it in a password manager!\n');

        console.log('Passphrase requirements:');
        console.log('  - Minimum 12 characters');
        console.log('  - Mix of uppercase, lowercase, numbers, symbols recommended\n');

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

        // Optional description
        console.log('STEP 3: Metadata (Optional)\n');

        const description = readlineSync.question(
          'Description (e.g., "Production 3-of-5 multi-sig"): ',
          { defaultInput: 'Multi-sig keys' }
        );

        console.log('');

        // Create encrypted file
        console.log('STEP 4: Create Encrypted File\n');
        console.log('Creating encrypted file...\n');

        const encryptedFile = EncryptedFileProvider.createEncryptedFile(
          keys,
          passphrase,
          outputPath,
          { description }
        );

        console.log('✅ Encrypted file created successfully!\n');

        // Display summary
        console.log('╔═══════════════════════════════════════════════════════╗');
        console.log('║                  FILE SUMMARY                         ║');
        console.log('╚═══════════════════════════════════════════════════════╝\n');

        console.log(`File: ${outputPath}`);
        console.log(`Keys Encrypted: ${keys.length}`);
        console.log(`Description: ${description}`);
        console.log(`Algorithm: ${encryptedFile.algorithm.toUpperCase()}`);
        console.log(`KDF: ${encryptedFile.kdf.toUpperCase()} (${encryptedFile.kdfParams.iterations.toLocaleString()} iterations)`);
        console.log(`Created: ${encryptedFile.metadata.created}\n`);

        if (process.platform !== 'win32') {
          console.log('File permissions set to 600 (read/write owner only)\n');
        }

        console.log('NEXT STEPS:\n');
        console.log('  1. Test decryption with:');
        console.log(`     hedera-multisig keys test ${outputPath}\n`);
        console.log('  2. Backup this file securely');
        console.log('  3. Store passphrase in password manager');
        console.log('  4. Use with participant command:');
        console.log(`     hedera-multisig participant -f ${path.basename(outputPath)} ...\n`);

        console.log('SECURITY REMINDERS:\n');
        console.log('  ⚠️  Backup the encrypted file (losing it = losing keys)');
        console.log('  ⚠️  Store passphrase safely (forgetting it = losing keys)');
        console.log('  ⚠️  Never commit encrypted file to version control');
        console.log('  ⚠️  File permissions: ensure only you can read it\n');

      } catch (error) {
        console.error('\n❌ Error: ' + error.message + '\n');
        process.exit(ExitCodes.INTERNAL_ERROR);
      }
    });

  // Test encrypted key file
  keys
    .command('test <file>')
    .description('Test decryption of an encrypted key file')
    .option('--json', 'Output results as JSON')
    .addHelpText('after', `
This tool verifies that an encrypted key file can be decrypted.
It does NOT display the keys, only confirms they can be loaded.

Examples:
  $ hedera-multisig keys test multisig-keys.encrypted
  $ hedera-multisig keys test multisig-keys.encrypted --json
    `)
    .action(async (file, options) => {
      const EncryptedFileProvider = require('../../keyManagement/EncryptedFileProvider');
      const { ExitCodes, JsonOutput } = require('../utils/cliUtils');

      const jsonOutput = new JsonOutput(!!options.json);

      if (!jsonOutput.enabled) {
        console.log('\n╔═══════════════════════════════════════════════════════╗');
        console.log('║          TEST ENCRYPTED KEY FILE                      ║');
        console.log('╚═══════════════════════════════════════════════════════╝\n');
      }

      try {
        const resolvedPath = path.resolve(file);

        if (!jsonOutput.enabled) {
          console.log(`Testing file: ${resolvedPath}\n`);
        }

        jsonOutput.set('file', resolvedPath);

        // Display metadata without decrypting
        let metadata;
        try {
          metadata = EncryptedFileProvider.getFileMetadata(resolvedPath);

          if (jsonOutput.enabled) {
            jsonOutput.set('metadata', {
              version: metadata.version,
              algorithm: metadata.algorithm,
              kdf: metadata.kdf,
              iterations: metadata.iterations,
              keyCount: metadata.keyCount,
              created: metadata.created,
              description: metadata.description
            });
          } else {
            console.log('FILE METADATA:\n');
            console.log(`  Version: ${metadata.version}`);
            console.log(`  Algorithm: ${metadata.algorithm}`);
            console.log(`  KDF: ${metadata.kdf} (${metadata.iterations?.toLocaleString()} iterations)`);
            console.log(`  Key Count: ${metadata.keyCount}`);
            console.log(`  Created: ${metadata.created}`);
            console.log(`  Description: ${metadata.description}\n`);
          }
        } catch (error) {
          if (jsonOutput.enabled) {
            jsonOutput.exitWithError(`Failed to read file metadata: ${error.message}`, ExitCodes.FILE_ERROR);
          } else {
            console.error(`❌ Failed to read file metadata: ${error.message}\n`);
            process.exit(ExitCodes.FILE_ERROR);
          }
          return;
        }

        // Try to decrypt
        if (!jsonOutput.enabled) {
          console.log('DECRYPTION TEST:\n');
          console.log('Attempting to load keys (you will be prompted for passphrase)...\n');
        }

        const provider = new EncryptedFileProvider(resolvedPath);
        const keys = await provider.getKeys();

        const keyVerifications = keys.map((key, index) => {
          const publicKey = key.publicKey.toString();
          const sanitized = publicKey.substring(0, 6) + '...' + publicKey.substring(publicKey.length - 4);
          return { index: index + 1, publicKeyPreview: sanitized };
        });

        if (jsonOutput.enabled) {
          jsonOutput.set('decryption', 'success');
          jsonOutput.set('keysLoaded', keys.length);
          jsonOutput.set('keys', keyVerifications);
          jsonOutput.print(true);
        } else {
          console.log('╔═══════════════════════════════════════════════════════╗');
          console.log('║                  ✅ SUCCESS!                          ║');
          console.log('╚═══════════════════════════════════════════════════════╝\n');

          console.log(`Successfully decrypted and loaded ${keys.length} key(s)\n`);

          console.log('KEY VERIFICATION:\n');
          keyVerifications.forEach(kv => {
            console.log(`  Key ${kv.index}: ${kv.publicKeyPreview} ✅`);
          });

          console.log('\nThe encrypted file is working correctly!\n');
        }

      } catch (error) {
        if (jsonOutput.enabled) {
          if (error.message.includes('Incorrect passphrase')) {
            jsonOutput.exitWithError('Incorrect passphrase or corrupted file', ExitCodes.AUTH_ERROR);
          } else {
            jsonOutput.exitWithError(error.message, ExitCodes.INTERNAL_ERROR);
          }
        } else {
          console.error('\n╔═══════════════════════════════════════════════════════╗');
          console.error('║                  ❌ FAILED                            ║');
          console.error('╚═══════════════════════════════════════════════════════╝\n');

          if (error.message.includes('Incorrect passphrase')) {
            console.error('❌ Incorrect passphrase or corrupted file\n');
            console.error('Possible causes:');
            console.error('  - Wrong passphrase entered');
            console.error('  - File has been corrupted');
            console.error('  - File has been tampered with\n');
            process.exit(ExitCodes.AUTH_ERROR);
          } else {
            console.error(`❌ Error: ${error.message}\n`);
            process.exit(ExitCodes.INTERNAL_ERROR);
          }
        }
      }
    });
};
