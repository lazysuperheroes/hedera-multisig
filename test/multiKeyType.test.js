/**
 * Test Both Ed25519 and ECDSA Key Support
 *
 * Validates that the multi-sig library properly handles both key types
 */

const { expect } = require('chai');
const { PrivateKey } = require('@hashgraph/sdk');
const KeyValidator = require('../keyManagement/KeyValidator');
const TransactionFreezer = require('../core/TransactionFreezer');
const SignatureCollector = require('../core/SignatureCollector');
const SignatureVerifier = require('../core/SignatureVerifier');

describe('Multi-Key Type Support (Ed25519 & ECDSA)', function() {
  this.timeout(30000);

  // Generate test keys once for all tests
  let ed25519Key1, ed25519Key2, ecdsaKey1, ecdsaKey2;

  before(function() {
    ed25519Key1 = PrivateKey.generate();
    ed25519Key2 = PrivateKey.generate();
    ecdsaKey1 = PrivateKey.generateECDSA();
    ecdsaKey2 = PrivateKey.generateECDSA();
  });

  // ============================================================================
  // Key Type Detection Tests
  // ============================================================================

  describe('Key Type Detection', function() {

    it('validates Ed25519 private key', function() {
      const validation = KeyValidator.validatePrivateKey(ed25519Key1.toString());
      expect(validation.valid).to.equal(true);
      expect(validation.type).to.equal('ED25519');
      expect(validation.format).to.equal('DER');
    });

    it('validates ECDSA private key', function() {
      const validation = KeyValidator.validatePrivateKey(ecdsaKey1.toString());
      expect(validation.valid).to.equal(true);
      expect(validation.type).to.equal('ECDSA_SECP256K1');
      expect(validation.format).to.equal('DER');
    });

    it('validates Ed25519 public key', function() {
      const validation = KeyValidator.validatePublicKey(ed25519Key1.publicKey.toString());
      expect(validation.valid).to.equal(true);
      expect(validation.type).to.equal('ED25519');
    });

    it('validates ECDSA public key', function() {
      const validation = KeyValidator.validatePublicKey(ecdsaKey1.publicKey.toString());
      expect(validation.valid).to.equal(true);
      expect(validation.type).to.equal('ECDSA_SECP256K1');
    });
  });

  // ============================================================================
  // Mixed Key Batch Validation
  // ============================================================================

  describe('Mixed Key Type Batch Validation', function() {

    it('validates a batch with mixed key types', function() {
      const mixedKeys = [
        ed25519Key1.toString(),
        ecdsaKey1.toString(),
        ed25519Key2.toString(),
        ecdsaKey2.toString()
      ];

      const batchValidation = KeyValidator.validatePrivateKeys(mixedKeys);
      expect(batchValidation.allValid).to.equal(true);
      expect(batchValidation.validCount).to.equal(4);
    });

    it('correctly identifies key types in batch', function() {
      const mixedKeys = [
        ed25519Key1.toString(),
        ecdsaKey1.toString(),
        ed25519Key2.toString(),
        ecdsaKey2.toString()
      ];

      const batchValidation = KeyValidator.validatePrivateKeys(mixedKeys);
      expect(batchValidation.results[0].type).to.equal('ED25519');
      expect(batchValidation.results[1].type).to.equal('ECDSA_SECP256K1');
      expect(batchValidation.results[2].type).to.equal('ED25519');
      expect(batchValidation.results[3].type).to.equal('ECDSA_SECP256K1');
    });
  });

  // ============================================================================
  // Signature Generation and Verification (Mixed Types)
  // ============================================================================

  describe('Signature Tests with Mixed Key Types', function() {

    let testData, mockFrozenTx;

    before(function() {
      testData = Buffer.from('Multi-sig test transaction');
      mockFrozenTx = {
        bytes: testData,
        base64: testData.toString('base64'),
        hash: 'mock-hash',
        frozenAt: new Date(),
        expiresAt: new Date(Date.now() + 110000)
      };
    });

    it('produces 64-byte signatures for Ed25519', function() {
      const sig = ed25519Key1.sign(testData);
      expect(sig.length).to.equal(64);
    });

    it('produces 64-byte signatures for ECDSA', function() {
      const sig = ecdsaKey1.sign(testData);
      expect(sig.length).to.equal(64);
    });

    it('validates Ed25519 signature tuple', function() {
      const sig = ed25519Key1.sign(testData);
      const tuple = `${ed25519Key1.publicKey.toString()}:${Buffer.from(sig).toString('base64')}`;
      const validation = KeyValidator.validateSignatureTuple(tuple);
      expect(validation.valid).to.equal(true);
    });

    it('validates ECDSA signature tuple', function() {
      const sig = ecdsaKey1.sign(testData);
      const tuple = `${ecdsaKey1.publicKey.toString()}:${Buffer.from(sig).toString('base64')}`;
      const validation = KeyValidator.validateSignatureTuple(tuple);
      expect(validation.valid).to.equal(true);
    });

    it('generates signatures for all keys using SignatureCollector', function() {
      const allKeys = [ed25519Key1, ecdsaKey1, ed25519Key2];
      const generatedSignatures = SignatureCollector.generateSignatures(mockFrozenTx, allKeys);

      expect(generatedSignatures).to.have.length(3);
      expect(generatedSignatures[0].publicKey).to.equal(ed25519Key1.publicKey.toString());
      expect(generatedSignatures[1].publicKey).to.equal(ecdsaKey1.publicKey.toString());
      expect(generatedSignatures[2].publicKey).to.equal(ed25519Key2.publicKey.toString());
    });
  });

  // ============================================================================
  // Signature Verification (Mixed Types)
  // ============================================================================

  describe('Signature Verification with Mixed Types', function() {

    let testData, mockFrozenTx, generatedSignatures;

    before(function() {
      testData = Buffer.from('Multi-sig test transaction');
      mockFrozenTx = {
        bytes: testData,
        base64: testData.toString('base64'),
        hash: 'mock-hash',
        frozenAt: new Date(),
        expiresAt: new Date(Date.now() + 110000)
      };

      const allKeys = [ed25519Key1, ecdsaKey1, ed25519Key2];
      generatedSignatures = SignatureCollector.generateSignatures(mockFrozenTx, allKeys);
    });

    it('verifies all signatures (mixed types)', async function() {
      const verification = await SignatureVerifier.verify(mockFrozenTx, generatedSignatures, {
        threshold: 3
      });

      expect(verification.valid).to.equal(true);
      expect(verification.validCount).to.equal(3);
    });

    it('verifies individual signature types correctly', async function() {
      const verification = await SignatureVerifier.verify(mockFrozenTx, generatedSignatures, {
        threshold: 3
      });

      expect(verification.details[0].valid).to.equal(true); // Ed25519 #1
      expect(verification.details[1].valid).to.equal(true); // ECDSA
      expect(verification.details[2].valid).to.equal(true); // Ed25519 #2
    });

    it('supports 2-of-3 multi-sig with mixed key types', async function() {
      const partialSignatures = generatedSignatures.slice(0, 2);
      const verification = await SignatureVerifier.verify(mockFrozenTx, partialSignatures, {
        threshold: 2
      });

      expect(verification.valid).to.equal(true);
      expect(verification.validCount).to.equal(2);
    });
  });

  // ============================================================================
  // DER Prefix Detection
  // ============================================================================

  describe('DER Prefix Detection', function() {

    it('Ed25519 private key DER starts with 302e', function() {
      expect(ed25519Key1.toString().startsWith('302e')).to.equal(true);
    });

    it('ECDSA private key DER starts with 3030', function() {
      expect(ecdsaKey1.toString().startsWith('3030')).to.equal(true);
    });

    it('Ed25519 public key DER starts with 302a', function() {
      expect(ed25519Key1.publicKey.toString().startsWith('302a')).to.equal(true);
    });

    it('ECDSA public key DER starts with 302d', function() {
      expect(ecdsaKey1.publicKey.toString().startsWith('302d')).to.equal(true);
    });
  });
});
