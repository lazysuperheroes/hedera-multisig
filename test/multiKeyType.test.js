/**
 * Test Both Ed25519 and ECDSA Key Support
 *
 * Validates that the multi-sig library properly handles both key types
 */

const { PrivateKey } = require('@hashgraph/sdk');
const KeyValidator = require('../keyManagement/KeyValidator');
const TransactionFreezer = require('../core/TransactionFreezer');
const SignatureCollector = require('../core/SignatureCollector');
const SignatureVerifier = require('../core/SignatureVerifier');

async function runTests() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('║     MULTI-KEY TYPE SUPPORT TEST (Ed25519 & ECDSA)    ║');
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

// Generate test keys of both types
const ed25519Key1 = PrivateKey.generate();
const ed25519Key2 = PrivateKey.generate();
const ecdsaKey1 = PrivateKey.generateECDSA();
const ecdsaKey2 = PrivateKey.generateECDSA();

console.log('Test Setup:');
console.log(`  Generated 2 Ed25519 keys`);
console.log(`  Generated 2 ECDSA keys\n`);

// ============================================================================
// Key Type Detection Tests
// ============================================================================

console.log('Key Type Detection Tests:\n');

// Test Ed25519 private key
const ed25519PrivValidation = KeyValidator.validatePrivateKey(ed25519Key1.toString());
assert(ed25519PrivValidation.valid === true, 'Validates Ed25519 private key');
assert(ed25519PrivValidation.type === 'ED25519', 'Detects Ed25519 private key type');
assert(ed25519PrivValidation.format === 'DER', 'Detects DER format for Ed25519 private');

// Test ECDSA private key
const ecdsaPrivValidation = KeyValidator.validatePrivateKey(ecdsaKey1.toString());
assert(ecdsaPrivValidation.valid === true, 'Validates ECDSA private key');
assert(ecdsaPrivValidation.type === 'ECDSA_SECP256K1', 'Detects ECDSA private key type');
assert(ecdsaPrivValidation.format === 'DER', 'Detects DER format for ECDSA private');

// Test Ed25519 public key
const ed25519PubValidation = KeyValidator.validatePublicKey(ed25519Key1.publicKey.toString());
assert(ed25519PubValidation.valid === true, 'Validates Ed25519 public key');
assert(ed25519PubValidation.type === 'ED25519', 'Detects Ed25519 public key type');

// Test ECDSA public key
const ecdsaPubValidation = KeyValidator.validatePublicKey(ecdsaKey1.publicKey.toString());
assert(ecdsaPubValidation.valid === true, 'Validates ECDSA public key');
assert(ecdsaPubValidation.type === 'ECDSA_SECP256K1', 'Detects ECDSA public key type');

console.log('');

// ============================================================================
// Mixed Key Batch Validation
// ============================================================================

console.log('Mixed Key Type Batch Validation:\n');

const mixedKeys = [
  ed25519Key1.toString(),
  ecdsaKey1.toString(),
  ed25519Key2.toString(),
  ecdsaKey2.toString()
];

const batchValidation = KeyValidator.validatePrivateKeys(mixedKeys);
assert(batchValidation.allValid === true, 'Validates batch with mixed key types');
assert(batchValidation.validCount === 4, 'All 4 keys in mixed batch are valid');
assert(batchValidation.results[0].type === 'ED25519', 'Batch correctly identifies Ed25519 #1');
assert(batchValidation.results[1].type === 'ECDSA_SECP256K1', 'Batch correctly identifies ECDSA #1');
assert(batchValidation.results[2].type === 'ED25519', 'Batch correctly identifies Ed25519 #2');
assert(batchValidation.results[3].type === 'ECDSA_SECP256K1', 'Batch correctly identifies ECDSA #2');

console.log('');

// ============================================================================
// Signature Generation and Verification (Mixed Types)
// ============================================================================

console.log('Signature Tests with Mixed Key Types:\n');

const testData = Buffer.from('Multi-sig test transaction');

// Create mock frozen transaction
const mockFrozenTx = {
  bytes: testData,
  base64: testData.toString('base64'),
  hash: 'mock-hash',
  frozenAt: new Date(),
  expiresAt: new Date(Date.now() + 110000)
};

// Generate signatures with both key types
const ed25519Sig1 = ed25519Key1.sign(testData);
const ed25519Sig2 = ed25519Key2.sign(testData);
const ecdsaSig1 = ecdsaKey1.sign(testData);
const ecdsaSig2 = ecdsaKey2.sign(testData);

assert(ed25519Sig1.length === 64, 'Ed25519 signature is 64 bytes');
assert(ecdsaSig1.length === 64, 'ECDSA signature is 64 bytes');

// Create signature tuples
const signatures = [
  {
    publicKey: ed25519Key1.publicKey.toString(),
    signature: Buffer.from(ed25519Sig1).toString('base64')
  },
  {
    publicKey: ecdsaKey1.publicKey.toString(),
    signature: Buffer.from(ecdsaSig1).toString('base64')
  }
];

// Validate signature tuples
const sig1Validation = KeyValidator.validateSignatureTuple(
  `${signatures[0].publicKey}:${signatures[0].signature}`
);
assert(sig1Validation.valid === true, 'Ed25519 signature tuple validates');

const sig2Validation = KeyValidator.validateSignatureTuple(
  `${signatures[1].publicKey}:${signatures[1].signature}`
);
assert(sig2Validation.valid === true, 'ECDSA signature tuple validates');

console.log('');

// ============================================================================
// Mixed Key Type Multi-Sig Workflow
// ============================================================================

console.log('Mixed Key Type Multi-Sig Workflow:\n');

// Generate signatures using SignatureCollector (simulated)
const allKeys = [ed25519Key1, ecdsaKey1, ed25519Key2];
const generatedSignatures = SignatureCollector.generateSignatures(mockFrozenTx, allKeys);

assert(generatedSignatures.length === 3, 'Generates signatures for all 3 keys');
assert(generatedSignatures[0].publicKey === ed25519Key1.publicKey.toString(), 'First signature is Ed25519');
assert(generatedSignatures[1].publicKey === ecdsaKey1.publicKey.toString(), 'Second signature is ECDSA');
assert(generatedSignatures[2].publicKey === ed25519Key2.publicKey.toString(), 'Third signature is Ed25519');

console.log('');

// ============================================================================
// Signature Verification (Mixed Types)
// ============================================================================

console.log('Signature Verification with Mixed Types:\n');

// Verify all signatures
const verification = await SignatureVerifier.verify(mockFrozenTx, generatedSignatures, {
  threshold: 3
});

assert(verification.valid === true, 'Verifies all signatures (mixed types)');
assert(verification.validCount === 3, 'All 3 signatures are cryptographically valid');
assert(verification.details[0].valid === true, 'Ed25519 signature #1 verifies correctly');
assert(verification.details[1].valid === true, 'ECDSA signature verifies correctly');
assert(verification.details[2].valid === true, 'Ed25519 signature #2 verifies correctly');

// Test threshold with mixed types (2-of-3)
const partialSignatures = generatedSignatures.slice(0, 2);
const verification2 = await SignatureVerifier.verify(mockFrozenTx, partialSignatures, {
  threshold: 2
});

assert(verification2.valid === true, '2-of-3 multi-sig works with mixed key types');
assert(verification2.validCount === 2, '2 signatures verified (1 Ed25519 + 1 ECDSA)');

console.log('');

// ============================================================================
// DER Prefix Detection
// ============================================================================

console.log('DER Prefix Detection:\n');

const ed25519Der = ed25519Key1.toString();
const ecdsaDer = ecdsaKey1.toString();

assert(ed25519Der.startsWith('302e'), 'Ed25519 DER starts with 302e');
assert(ecdsaDer.startsWith('3030'), 'ECDSA DER starts with 3030');

const ed25519PubDer = ed25519Key1.publicKey.toString();
const ecdsaPubDer = ecdsaKey1.publicKey.toString();

assert(ed25519PubDer.startsWith('302a'), 'Ed25519 public key DER starts with 302a');
assert(ecdsaPubDer.startsWith('302d'), 'ECDSA public key DER starts with 302d');

console.log('');

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
    console.log('║   ✅ FULL Ed25519 & ECDSA SUPPORT CONFIRMED!         ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');
    console.log('The multi-sig library fully supports both key types:\n');
    console.log('  ✅ Ed25519 (Hedera native)');
    console.log('  ✅ ECDSA secp256k1 (Ethereum compatible)\n');
    console.log('All signatures verify correctly regardless of key type.\n');
    process.exit(0);
  } else {
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║              ❌ SOME TESTS FAILED                     ║');
    console.log('╚═══════════════════════════════════════════════════════╝\n');
    process.exit(1);
  }
}

// Run the tests
runTests().catch((error) => {
  console.error('\n❌ Test execution failed:', error.message);
  console.error(error.stack);
  process.exit(1);
});
