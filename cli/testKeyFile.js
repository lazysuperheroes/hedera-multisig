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

console.log('\n╔═══════════════════════════════════════════════════════╗');
console.log('║          TEST ENCRYPTED KEY FILE                      ║');
console.log('╚═══════════════════════════════════════════════════════╝\n');

async function main() {
  try {
    // Get file path from command line
    const filePath = process.argv[2];

    if (!filePath) {
      console.error('Usage: node testKeyFile.js <path-to-encrypted-file>\n');
      console.error('Example: node testKeyFile.js multisig-keys.encrypted\n');
      process.exit(1);
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
      process.exit(1);
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
    } else {
      console.error(`❌ Error: ${error.message}\n`);
    }

    process.exit(1);
  }
}

main();
