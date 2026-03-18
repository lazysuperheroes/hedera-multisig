/**
 * Integration Tests for Key Providers
 *
 * Tests for EnvKeyProvider, EncryptedFileProvider, and KeyValidator
 */

const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const { PrivateKey } = require('@hashgraph/sdk');

const KeyValidator = require('../keyManagement/KeyValidator');
const EnvKeyProvider = require('../keyManagement/EnvKeyProvider');
const EncryptedFileProvider = require('../keyManagement/EncryptedFileProvider');

describe('Key Provider Integration Tests', function() {
  this.timeout(30000);

  // Generate test keys once for all tests
  let testKey1, testKey2, testKey3;
  let testKey1String, testKey2String, testKey3String;

  before(function() {
    testKey1 = PrivateKey.generate();
    testKey2 = PrivateKey.generate();
    testKey3 = PrivateKey.generate();
    testKey1String = testKey1.toString();
    testKey2String = testKey2.toString();
    testKey3String = testKey3.toString();
  });

  // ============================================================================
  // KeyValidator Tests
  // ============================================================================

  describe('KeyValidator', function() {

    it('validates a valid private key', function() {
      const validation = KeyValidator.validatePrivateKey(testKey1String);
      expect(validation.valid).to.equal(true);
      expect(validation.format).to.equal('DER');
      expect(validation.type).to.equal('ED25519');
    });

    it('rejects an invalid private key', function() {
      const validation = KeyValidator.validatePrivateKey('invalid-key');
      expect(validation.valid).to.equal(false);
      expect(validation.errors).to.have.length.greaterThan(0);
    });

    it('rejects an empty string', function() {
      const validation = KeyValidator.validatePrivateKey('');
      expect(validation.valid).to.equal(false);
    });

    it('validates a valid signature tuple', function() {
      const signatureBytes = testKey1.sign(Buffer.from('test'));
      const signatureTuple = `${testKey1.publicKey.toString()}:${Buffer.from(signatureBytes).toString('base64')}`;
      const validation = KeyValidator.validateSignatureTuple(signatureTuple);
      expect(validation.valid).to.equal(true);
    });

    it('validates a valid threshold config (2-of-3)', function() {
      const validation = KeyValidator.validateThresholdConfig(3, 2);
      expect(validation.valid).to.equal(true);
    });

    it('rejects an invalid threshold config (2-of-1)', function() {
      const validation = KeyValidator.validateThresholdConfig(1, 2);
      expect(validation.valid).to.equal(false);
    });
  });

  // ============================================================================
  // EncryptedFileProvider Tests
  // ============================================================================

  describe('EncryptedFileProvider', function() {
    const testFilePath = path.join(__dirname, 'test-encrypted-keys.json');
    const testPassphrase = 'test-passphrase-123456';

    afterEach(function() {
      // Clean up test file after each test in this block
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    });

    it('creates an encrypted file', function() {
      EncryptedFileProvider.createEncryptedFile(
        [testKey1String, testKey2String, testKey3String],
        testPassphrase,
        testFilePath,
        { description: 'Test multi-sig keys' }
      );

      expect(fs.existsSync(testFilePath)).to.equal(true);

      const fileContent = JSON.parse(fs.readFileSync(testFilePath, 'utf8'));
      expect(fileContent.algorithm).to.equal('aes-256-gcm');
      expect(fileContent.kdf).to.equal('pbkdf2');
      expect(fileContent.metadata.keyCount).to.equal(3);
    });

    it('reads file metadata without decryption', function() {
      EncryptedFileProvider.createEncryptedFile(
        [testKey1String, testKey2String, testKey3String],
        testPassphrase,
        testFilePath,
        { description: 'Test multi-sig keys' }
      );

      const metadata = EncryptedFileProvider.getFileMetadata(testFilePath);
      expect(metadata.keyCount).to.equal(3);
      expect(metadata.algorithm).to.equal('aes-256-gcm');
    });

    it('verifies a correct passphrase', function() {
      EncryptedFileProvider.createEncryptedFile(
        [testKey1String, testKey2String, testKey3String],
        testPassphrase,
        testFilePath,
        { description: 'Test multi-sig keys' }
      );

      const passphraseValid = EncryptedFileProvider.verifyPassphrase(testFilePath, testPassphrase);
      expect(passphraseValid).to.equal(true);
    });

    it('rejects an incorrect passphrase', function() {
      EncryptedFileProvider.createEncryptedFile(
        [testKey1String, testKey2String, testKey3String],
        testPassphrase,
        testFilePath,
        { description: 'Test multi-sig keys' }
      );

      const passphraseInvalid = EncryptedFileProvider.verifyPassphrase(testFilePath, 'wrong-passphrase');
      expect(passphraseInvalid).to.equal(false);
    });

    it('creates an EncryptedFileProvider instance', function() {
      EncryptedFileProvider.createEncryptedFile(
        [testKey1String, testKey2String, testKey3String],
        testPassphrase,
        testFilePath,
        { description: 'Test multi-sig keys' }
      );

      const provider = new EncryptedFileProvider(testFilePath, { passphrase: testPassphrase });

      expect(provider).to.not.equal(null);
      expect(provider.getName()).to.include('test-encrypted-keys.json');
      expect(provider.getSecurityLevel()).to.equal('high');
    });

    it('generates a random passphrase of correct length', function() {
      const randomPassphrase = EncryptedFileProvider.generatePassphrase(20);
      expect(randomPassphrase).to.have.length(20);
      expect(randomPassphrase).to.match(/[A-Za-z0-9!@#$%^&*]/);
    });
  });

  // ============================================================================
  // EnvKeyProvider Tests
  // ============================================================================

  describe('EnvKeyProvider', function() {

    it('creates an EnvKeyProvider instance', function() {
      const provider = new EnvKeyProvider({ prefix: 'TEST_KEY' });
      expect(provider).to.not.equal(null);
      expect(provider.getName()).to.equal('Environment Variables (.env)');
      expect(provider.getSecurityLevel()).to.equal('medium');
    });

    it('checks .env file existence', function() {
      const envExists = EnvKeyProvider.envFileExists('.env');
      expect(envExists).to.be.a('boolean');
    });

    it('validates .env file security', function() {
      const securityCheck = EnvKeyProvider.validateEnvFileSecurity('.env');
      expect(securityCheck).to.not.equal(null);
      expect(securityCheck.secure).to.be.a('boolean');
    });
  });
});
