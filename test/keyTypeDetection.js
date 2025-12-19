/**
 * Test key type detection with Hedera SDK
 */

const { PrivateKey } = require('@hashgraph/sdk');

console.log('\nTesting Hedera Key Type Support:\n');

// Generate Ed25519 key (default)
const ed25519Key = PrivateKey.generate();
console.log('Ed25519 Key:');
console.log('  Type:', ed25519Key.constructor.name);
console.log('  String:', ed25519Key.toString().substring(0, 20) + '...');
console.log('  Public Key:', ed25519Key.publicKey.toString().substring(0, 20) + '...');

// Generate ECDSA key
const ecdsaKey = PrivateKey.generateECDSA();
console.log('\nECDSA Key:');
console.log('  Type:', ecdsaKey.constructor.name);
console.log('  String:', ecdsaKey.toString().substring(0, 20) + '...');
console.log('  Public Key:', ecdsaKey.publicKey.toString().substring(0, 20) + '...');

// Check if we can distinguish them
console.log('\nDetection Methods:');
console.log('  Ed25519 isED25519():', typeof ed25519Key.isED25519 === 'function' ? ed25519Key.isED25519() : 'method not available');
console.log('  Ed25519 isECDSA():', typeof ed25519Key.isECDSA === 'function' ? ed25519Key.isECDSA() : 'method not available');
console.log('  ECDSA isED25519():', typeof ecdsaKey.isED25519 === 'function' ? ecdsaKey.isED25519() : 'method not available');
console.log('  ECDSA isECDSA():', typeof ecdsaKey.isECDSA === 'function' ? ecdsaKey.isECDSA() : 'method not available');

// Try parsing both types
console.log('\nParsing Tests:');

try {
  const parsedEd = PrivateKey.fromString(ed25519Key.toString());
  console.log('  ✅ Can parse Ed25519 from string');
  console.log('     Type check:', typeof parsedEd.isED25519 === 'function' ? parsedEd.isED25519() : 'N/A');
} catch (error) {
  console.log('  ❌ Failed to parse Ed25519:', error.message);
}

try {
  const parsedEc = PrivateKey.fromString(ecdsaKey.toString());
  console.log('  ✅ Can parse ECDSA from string');
  console.log('     Type check:', typeof parsedEc.isECDSA === 'function' ? parsedEc.isECDSA() : 'N/A');
} catch (error) {
  console.log('  ❌ Failed to parse ECDSA:', error.message);
}

// Check signature differences
console.log('\nSignature Tests:');
const testData = Buffer.from('test message');

const ed25519Sig = ed25519Key.sign(testData);
const ecdsaSig = ecdsaKey.sign(testData);

console.log('  Ed25519 signature length:', ed25519Sig.length, 'bytes');
console.log('  ECDSA signature length:', ecdsaSig.length, 'bytes');

console.log('\n');
