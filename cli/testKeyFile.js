#!/usr/bin/env node

/**
 * Test Encrypted Key File CLI Tool
 *
 * Verifies that an encrypted key file can be decrypted successfully.
 * Does NOT display the keys, only confirms they can be loaded.
 *
 * Usage:
 *   node testKeyFile.js path/to/keys.encrypted
 */

const EncryptedFileProvider = require('../keyManagement/EncryptedFileProvider');
const path = require('path');
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
  console.log('\nTest Encrypted Key File v' + getVersion() + '\n');
  console.log('Usage: node cli/testKeyFile.js <path-to-encrypted-file>\n');
  console.log('Options:');
  console.log('  -V, --version        Show version information');
  console.log('  -h, --help           Show this help message\n');
  console.log('Example: node cli/testKeyFile.js multisig-keys.encrypted\n');
  console.log('This tool verifies that an encrypted key file can be decrypted.');
  console.log('It does NOT display the keys, only confirms they can be loaded.\n');
  process.exit(ExitCodes.SUCCESS);
}

console.log('\n╔═══════════════════════════════════════════════════════╗');
console.log('║          TEST ENCRYPTED KEY FILE                      ║');
console.log('╚═══════════════════════════════════════════════════════╝\n');

async function main() {
  try {
    // Get file path from command line (use remaining args after common flags)
    const filePath = commonFlags.remainingArgs[0];

    if (!filePath) {
      console.error('Usage: node testKeyFile.js <path-to-encrypted-file>\n');
      console.error('Example: node testKeyFile.js multisig-keys.encrypted\n');
      process.exit(ExitCodes.VALIDATION_ERROR);
    }

    const resolvedPath = path.resolve(filePath);

    console.log(`Testing file: ${resolvedPath}\n`);

    // Display metadata without decrypting
    console.log('FILE METADATA:\n');
    try {
      const metadata = EncryptedFileProvider.getFileMetadata(resolvedPath);

      console.log(`  Version: ${metadata.version}`);
      console.log(`  Algorithm: ${metadata.algorithm}`);
      console.log(`  KDF: ${metadata.kdf} (${metadata.iterations?.toLocaleString()} iterations)`);
      console.log(`  Key Count: ${metadata.keyCount}`);
      console.log(`  Created: ${metadata.created}`);
      console.log(`  Description: ${metadata.description}\n`);
    } catch (error) {
      console.error(`❌ Failed to read file metadata: ${error.message}\n`);
      process.exit(ExitCodes.FILE_ERROR);
    }

    // Try to decrypt
    console.log('DECRYPTION TEST:\n');
    console.log('Attempting to load keys (you will be prompted for passphrase)...\n');

    const provider = new EncryptedFileProvider(resolvedPath);
    const keys = await provider.getKeys();

    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║                  ✅ SUCCESS!                          ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');

    console.log(`Successfully decrypted and loaded ${keys.length} key(s)\n`);

    console.log('KEY VERIFICATION:\n');
    keys.forEach((key, index) => {
      const publicKey = key.publicKey.toString();
      const sanitized = publicKey.substring(0, 6) + '...' + publicKey.substring(publicKey.length - 4);
      console.log(`  Key ${index + 1}: ${sanitized} ✅`);
    });

    console.log('\nThe encrypted file is working correctly!\n');

  } catch (error) {
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

main();
