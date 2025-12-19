/**
 * Integration Tests for Key Providers
 *
 * Tests for EnvKeyProvider, EncryptedFileProvider, and KeyValidator
 */

const fs = require('fs');
const path = require('path');
const { PrivateKey } = require('@hashgraph/sdk');

const KeyValidator = require('../keyManagement/KeyValidator');
const EnvKeyProvider = require('../keyManagement/EnvKeyProvider');
const EncryptedFileProvider = require('../keyManagement/EncryptedFileProvider');

// Test key generation
console.log('\n╔═══════════════════════════════════════════════════════╗');
console.log('║        KEY PROVIDER INTEGRATION TESTS                 ║');
console.log('╚═══════════════════════════════════════════════════════╝\n');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`✅ ${testName}`);
    testsPassed++;
  } else {
    console.error(`❌ ${testName}`);
    testsFailed++;
  }
}

// Generate test keys
const testKey1 = PrivateKey.generate();
const testKey2 = PrivateKey.generate();
const testKey3 = PrivateKey.generate();

const testKey1String = testKey1.toString();
const testKey2String = testKey2.toString();
const testKey3String = testKey3.toString();

console.log('Test Setup:');
console.log(`  Generated 3 test private keys\n`);

// ============================================================================
// KeyValidator Tests
// ============================================================================

console.log('KeyValidator Tests:\n');

// Test 1: Validate valid private key
const validation1 = KeyValidator.validatePrivateKey(testKey1String);
assert(validation1.valid === true, 'Validates valid private key');
assert(validation1.format === 'DER', 'Detects DER format');
assert(validation1.type === 'ED25519', 'Detects ED25519 type');

// Test 2: Validate invalid private key
const validation2 = KeyValidator.validatePrivateKey('invalid-key');
assert(validation2.valid === false, 'Rejects invalid private key');
assert(validation2.errors.length > 0, 'Provides error messages');

// Test 3: Validate empty string
const validation3 = KeyValidator.validatePrivateKey('');
assert(validation3.valid === false, 'Rejects empty string');

// Test 4: Validate signature tuple
const signatureBytes = testKey1.sign(Buffer.from('test'));
const signatureTuple = `${testKey1.publicKey.toString()}:${Buffer.from(signatureBytes).toString('base64')}`;
const validation4 = KeyValidator.validateSignatureTuple(signatureTuple);
assert(validation4.valid === true, 'Validates valid signature tuple');

// Test 5: Validate threshold configuration
const validation5 = KeyValidator.validateThresholdConfig(3, 2);
assert(validation5.valid === true, 'Validates valid threshold config (2-of-3)');

const validation6 = KeyValidator.validateThresholdConfig(1, 2);
assert(validation6.valid === false, 'Rejects invalid threshold config (2-of-1)');

console.log('');

// ============================================================================
// EncryptedFileProvider Tests
// ============================================================================

console.log('EncryptedFileProvider Tests:\n');

const testFilePath = path.join(__dirname, 'test-encrypted-keys.json');
const testPassphrase = 'test-passphrase-123456';

// Test 7: Create encrypted file
try {
  EncryptedFileProvider.createEncryptedFile(
    [testKey1String, testKey2String, testKey3String],
    testPassphrase,
    testFilePath,
    { description: 'Test multi-sig keys' }
  );

  assert(fs.existsSync(testFilePath), 'Creates encrypted file');

  const fileContent = JSON.parse(fs.readFileSync(testFilePath, 'utf8'));
  assert(fileContent.algorithm === 'aes-256-gcm', 'Uses AES-256-GCM encryption');
  assert(fileContent.kdf === 'pbkdf2', 'Uses PBKDF2 key derivation');
  assert(fileContent.metadata.keyCount === 3, 'Stores correct key count');
} catch (error) {
  assert(false, `Create encrypted file: ${error.message}`);
}

// Test 8: Get file metadata without decrypting
try {
  const metadata = EncryptedFileProvider.getFileMetadata(testFilePath);
  assert(metadata.keyCount === 3, 'Reads metadata without decryption');
  assert(metadata.algorithm === 'aes-256-gcm', 'Metadata contains algorithm');
} catch (error) {
  assert(false, `Get file metadata: ${error.message}`);
}

// Test 9: Verify passphrase
const passphraseValid = EncryptedFileProvider.verifyPassphrase(testFilePath, testPassphrase);
assert(passphraseValid === true, 'Verifies correct passphrase');

const passphraseInvalid = EncryptedFileProvider.verifyPassphrase(testFilePath, 'wrong-passphrase');
assert(passphraseInvalid === false, 'Rejects incorrect passphrase');

// Test 10: Decrypt and load keys
try {
  const provider = new EncryptedFileProvider(testFilePath, { passphrase: testPassphrase });

  // Note: We can't actually call getKeys() in this test without user interaction
  // but we can verify the provider was created successfully
  assert(provider !== null, 'Creates EncryptedFileProvider instance');
  assert(provider.getName().includes('test-encrypted-keys.json'), 'Provider has correct name');
  assert(provider.getSecurityLevel() === 'high', 'Provider reports high security level');
} catch (error) {
  assert(false, `Create EncryptedFileProvider: ${error.message}`);
}

// Test 11: Generate random passphrase
const randomPassphrase = EncryptedFileProvider.generatePassphrase(20);
assert(randomPassphrase.length === 20, 'Generates passphrase of correct length');
assert(/[A-Za-z0-9!@#$%^&*]/.test(randomPassphrase), 'Passphrase contains valid characters');

console.log('');

// ============================================================================
// EnvKeyProvider Tests
// ============================================================================

console.log('EnvKeyProvider Tests:\n');

// Test 12: Create EnvKeyProvider
try {
  const provider = new EnvKeyProvider({ prefix: 'TEST_KEY' });
  assert(provider !== null, 'Creates EnvKeyProvider instance');
  assert(provider.getName() === 'Environment Variables (.env)', 'Provider has correct name');
  assert(provider.getSecurityLevel() === 'medium', 'Provider reports medium security level');
} catch (error) {
  assert(false, `Create EnvKeyProvider: ${error.message}`);
}

// Test 13: Check .env file existence
const envExists = EnvKeyProvider.envFileExists('.env');
assert(typeof envExists === 'boolean', 'Checks .env file existence');

// Test 14: Validate .env file security
const securityCheck = EnvKeyProvider.validateEnvFileSecurity('.env');
assert(securityCheck !== null, 'Validates .env file security');
assert(typeof securityCheck.secure === 'boolean', 'Security check has result');

console.log('');

// ============================================================================
// Cleanup
// ============================================================================

// Remove test encrypted file
if (fs.existsSync(testFilePath)) {
  fs.unlinkSync(testFilePath);
  console.log('Cleanup: Removed test encrypted file\n');
}

// ============================================================================
// Summary
// ============================================================================

console.log('═══════════════════════════════════════════════════════\n');
console.log('TEST SUMMARY:\n');
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log(`  Total: ${testsPassed + testsFailed}\n`);

if (testsFailed === 0) {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║              ✅ ALL TESTS PASSED!                     ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');
  process.exit(0);
} else {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║              ❌ SOME TESTS FAILED                     ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');
  process.exit(1);
}
