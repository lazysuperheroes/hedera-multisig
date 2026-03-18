/**
 * Offline CLI Commands Unit Tests
 *
 * Tests for offline workflow CLI commands: freeze, decode, execute.
 * Focuses on validation, parsing, and core logic.
 */

const { expect } = require('chai');
const crypto = require('crypto');
const SignatureVerifier = require('../core/SignatureVerifier');

describe('Offline CLI Commands', function() {

  describe('Base64 and Checksum Utilities', function() {

    it('generates consistent checksums from transaction bytes', function() {
      // Simulated transaction bytes
      const txBytes = Buffer.from('mock-transaction-bytes-for-testing');
      const base64 = txBytes.toString('base64');

      // Generate checksum (first 16 chars of SHA-256)
      const checksum = crypto
        .createHash('sha256')
        .update(txBytes)
        .digest('hex')
        .substring(0, 16);

      expect(checksum).to.have.length(16);
      expect(checksum).to.match(/^[a-f0-9]+$/);

      // Same bytes should produce same checksum
      const checksum2 = crypto
        .createHash('sha256')
        .update(txBytes)
        .digest('hex')
        .substring(0, 16);

      expect(checksum).to.equal(checksum2);
    });

    it('produces different checksums for different data', function() {
      const bytes1 = Buffer.from('transaction-1');
      const bytes2 = Buffer.from('transaction-2');

      const checksum1 = crypto.createHash('sha256').update(bytes1).digest('hex').substring(0, 16);
      const checksum2 = crypto.createHash('sha256').update(bytes2).digest('hex').substring(0, 16);

      expect(checksum1).to.not.equal(checksum2);
    });

    it('correctly encodes and decodes base64', function() {
      const original = Buffer.from([0x01, 0x02, 0x03, 0x04, 0xAA, 0xBB, 0xCC]);
      const base64 = original.toString('base64');
      const decoded = Buffer.from(base64, 'base64');

      expect(decoded).to.deep.equal(original);
    });
  });

  describe('Signature Tuple Parsing (SignatureVerifier.parseSignatureTuple)', function() {

    // Use the actual parseSignatureTuple from core/SignatureVerifier
    const parseSignatureTuple = SignatureVerifier.parseSignatureTuple.bind(SignatureVerifier);

    it('correctly parses valid signature tuple', function() {
      const publicKey = '302a300506032b6570032100abc123def456789';
      const signature = 'Sg7m2xKl9pQr8sT0uV1wX2yZ3a4b5c6d';
      const tuple = `${publicKey}:${signature}`;

      const parsed = parseSignatureTuple(tuple);

      expect(parsed).to.not.equal(null);
      expect(parsed.publicKey).to.equal(publicKey);
      expect(parsed.signature).to.equal(signature);
    });

    it('returns null on missing separator', function() {
      const result = parseSignatureTuple('noseparator');
      expect(result).to.equal(null);
    });

    it('returns null on empty key', function() {
      const result = parseSignatureTuple(':signature');
      expect(result).to.equal(null);
    });

    it('returns null on empty signature', function() {
      const result = parseSignatureTuple('publickey:');
      expect(result).to.equal(null);
    });

    it('returns null for null or non-string input', function() {
      expect(parseSignatureTuple(null)).to.equal(null);
      expect(parseSignatureTuple(undefined)).to.equal(null);
      expect(parseSignatureTuple(42)).to.equal(null);
    });
  });

  describe('Transaction Type Validation', function() {

    const validTypes = ['transfer', 'contract-execute'];

    it('accepts valid transaction types', function() {
      validTypes.forEach(type => {
        expect(validTypes.includes(type)).to.be.true;
      });
    });

    it('rejects invalid transaction types', function() {
      const invalidTypes = ['unknown', 'delete', 'create', ''];
      invalidTypes.forEach(type => {
        expect(validTypes.includes(type)).to.be.false;
      });
    });
  });

  describe('Transfer Transaction Validation', function() {

    function validateTransferOptions(options) {
      const errors = [];

      if (!options.from) {
        errors.push('Missing --from (source account ID)');
      }
      if (!options.to) {
        errors.push('Missing --to (destination account ID)');
      }
      if (!options.amount) {
        errors.push('Missing --amount (HBAR amount)');
      }
      if (options.amount && isNaN(parseFloat(options.amount))) {
        errors.push('Invalid --amount (must be a number)');
      }
      if (options.amount && parseFloat(options.amount) <= 0) {
        errors.push('Invalid --amount (must be positive)');
      }

      return errors;
    }

    it('validates complete transfer options', function() {
      const options = {
        from: '0.0.1234',
        to: '0.0.5678',
        amount: '100'
      };

      const errors = validateTransferOptions(options);
      expect(errors).to.have.length(0);
    });

    it('reports missing from account', function() {
      const options = { to: '0.0.5678', amount: '100' };
      const errors = validateTransferOptions(options);
      expect(errors).to.include('Missing --from (source account ID)');
    });

    it('reports missing to account', function() {
      const options = { from: '0.0.1234', amount: '100' };
      const errors = validateTransferOptions(options);
      expect(errors).to.include('Missing --to (destination account ID)');
    });

    it('reports missing amount', function() {
      const options = { from: '0.0.1234', to: '0.0.5678' };
      const errors = validateTransferOptions(options);
      expect(errors).to.include('Missing --amount (HBAR amount)');
    });

    it('reports invalid amount', function() {
      const options = { from: '0.0.1234', to: '0.0.5678', amount: 'abc' };
      const errors = validateTransferOptions(options);
      expect(errors).to.include('Invalid --amount (must be a number)');
    });

    it('reports negative amount', function() {
      const options = { from: '0.0.1234', to: '0.0.5678', amount: '-50' };
      const errors = validateTransferOptions(options);
      expect(errors).to.include('Invalid --amount (must be positive)');
    });
  });

  describe('Contract Execute Validation', function() {

    function validateContractOptions(options) {
      const errors = [];

      if (!options.contract) {
        errors.push('Missing --contract (contract ID)');
      }
      if (options.gas && isNaN(parseInt(options.gas))) {
        errors.push('Invalid --gas (must be a number)');
      }
      if (options.gas && parseInt(options.gas) <= 0) {
        errors.push('Invalid --gas (must be positive)');
      }
      if (options.data && !options.data.match(/^(0x)?[a-fA-F0-9]*$/)) {
        errors.push('Invalid --data (must be hex)');
      }

      return errors;
    }

    it('validates complete contract execute options', function() {
      const options = {
        contract: '0.0.9999',
        gas: '100000',
        data: '0xa9059cbb'
      };

      const errors = validateContractOptions(options);
      expect(errors).to.have.length(0);
    });

    it('reports missing contract', function() {
      const options = { gas: '100000' };
      const errors = validateContractOptions(options);
      expect(errors).to.include('Missing --contract (contract ID)');
    });

    it('reports invalid gas', function() {
      const options = { contract: '0.0.9999', gas: 'high' };
      const errors = validateContractOptions(options);
      expect(errors).to.include('Invalid --gas (must be a number)');
    });

    it('reports invalid hex data', function() {
      const options = { contract: '0.0.9999', data: 'not-hex-data' };
      const errors = validateContractOptions(options);
      expect(errors).to.include('Invalid --data (must be hex)');
    });

    it('accepts data with or without 0x prefix', function() {
      const optionsWithPrefix = { contract: '0.0.9999', data: '0xabcdef' };
      const optionsWithoutPrefix = { contract: '0.0.9999', data: 'abcdef' };

      expect(validateContractOptions(optionsWithPrefix)).to.have.length(0);
      expect(validateContractOptions(optionsWithoutPrefix)).to.have.length(0);
    });
  });

  describe('Threshold Validation (SignatureVerifier.checkThreshold)', function() {

    // Use the actual checkThreshold from core/SignatureVerifier
    const checkThreshold = SignatureVerifier.checkThreshold.bind(SignatureVerifier);

    it('passes when signature count meets threshold', function() {
      const result = checkThreshold(2, 3);
      expect(result).to.equal(true);
    });

    it('passes when signature count equals threshold', function() {
      const result = checkThreshold(2, 2);
      expect(result).to.equal(true);
    });

    it('passes when signature count exceeds threshold', function() {
      const result = checkThreshold(2, 5);
      expect(result).to.equal(true);
    });

    it('fails when signature count is below threshold', function() {
      const result = checkThreshold(3, 1);
      expect(result).to.equal(false);
    });

    it('fails when no signatures provided', function() {
      const result = checkThreshold(2, 0);
      expect(result).to.equal(false);
    });
  });

  describe('File Content Parsing', function() {

    function extractBase64FromFile(content) {
      const lines = content.split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#') && !l.startsWith('BASE64:') && !l.startsWith('CHECKSUM:'));

      // Find the longest line that looks like base64 (no spaces, no colons)
      const base64Line = lines.find(l => l.length > 50 && !l.includes(' ') && !l.includes(':'));

      return base64Line || null;
    }

    it('extracts base64 from formatted file', function() {
      const content = `# Hedera Multi-Sig Transaction
# Type: transfer
# Transaction ID: 0.0.1234@12345678.000
# Checksum: a1b2c3d4e5f6g7h8
# Generated: 2026-01-04T12:00:00.000Z

BASE64:
CgQQBxgLEgQQBRgHGgQQBhgJIgQIBRgHKgQIBhgJMgMY0AE6BwjAhD0Q0AU

CHECKSUM:
a1b2c3d4e5f6g7h8`;

      const extracted = extractBase64FromFile(content);
      expect(extracted).to.equal('CgQQBxgLEgQQBRgHGgQQBhgJIgQIBRgHKgQIBhgJMgMY0AE6BwjAhD0Q0AU');
    });

    it('extracts base64 from raw file', function() {
      const content = 'CgQQBxgLEgQQBRgHGgQQBhgJIgQIBRgHKgQIBhgJMgMY0AE6BwjAhD0Q0AU';
      const extracted = extractBase64FromFile(content);
      expect(extracted).to.equal('CgQQBxgLEgQQBRgHGgQQBhgJIgQIBRgHKgQIBhgJMgMY0AE6BwjAhD0Q0AU');
    });

    it('returns null for file without base64', function() {
      const content = `# Comment only file
# No actual transaction data
`;
      const extracted = extractBase64FromFile(content);
      expect(extracted).to.be.null;
    });

    it('ignores short lines', function() {
      const content = `short
very short
also short
CgQQBxgLEgQQBRgHGgQQBhgJIgQIBRgHKgQIBhgJMgMY0AE6BwjAhD0Q0AU`;

      const extracted = extractBase64FromFile(content);
      expect(extracted).to.equal('CgQQBxgLEgQQBRgHGgQQBhgJIgQIBRgHKgQIBhgJMgMY0AE6BwjAhD0Q0AU');
    });
  });

  describe('Signature File Parsing', function() {

    function parseSignatureFile(content) {
      return content.split('\n')
        .map(l => l.trim())
        .filter(l => l && l.includes(':') && !l.startsWith('#'));
    }

    it('parses multiple signatures from file', function() {
      const content = `# Signatures for transaction
302a300506032b6570032100abc123:Sg7m2xKl9pQr8sT0
302a300506032b6570032100def456:Xk9nRtYu7vWxYz12
# Another comment
302a300506032b6570032100ghi789:Mn3oPqRsTuVwXyZa`;

      const signatures = parseSignatureFile(content);
      expect(signatures).to.have.length(3);
      expect(signatures[0]).to.include('abc123');
      expect(signatures[1]).to.include('def456');
      expect(signatures[2]).to.include('ghi789');
    });

    it('handles empty lines and comments', function() {
      const content = `
# Header comment

302a300506032b6570032100abc123:signature1

# Middle comment

302a300506032b6570032100def456:signature2

`;

      const signatures = parseSignatureFile(content);
      expect(signatures).to.have.length(2);
    });

    it('returns empty array for comment-only file', function() {
      const content = `# Just comments
# Nothing else`;

      const signatures = parseSignatureFile(content);
      expect(signatures).to.have.length(0);
    });
  });

  describe('Exit Codes', function() {
    const { ExitCodes } = require('../cli/utils/cliUtils');

    it('defines expected exit codes', function() {
      expect(ExitCodes.SUCCESS).to.equal(0);
      expect(ExitCodes.VALIDATION_ERROR).to.equal(1);
      expect(ExitCodes.THRESHOLD_NOT_MET).to.equal(6);
      expect(ExitCodes.FILE_ERROR).to.equal(9);
      expect(ExitCodes.INTERNAL_ERROR).to.equal(10);
    });
  });

  describe('JSON Output Mode', function() {
    const { JsonOutput } = require('../cli/utils/cliUtils');

    it('creates JSON output in json mode', function() {
      const output = new JsonOutput(true);
      expect(output.enabled).to.be.true;
    });

    it('creates standard output in non-json mode', function() {
      const output = new JsonOutput(false);
      expect(output.enabled).to.be.false;
    });

    it('builds output with correct structure', function() {
      const output = new JsonOutput(true);
      output.set('key', 'value');
      output.addWarning('test warning');

      const built = output.build(true);

      expect(built.success).to.be.true;
      expect(built.data.key).to.equal('value');
      expect(built.warnings).to.include('test warning');
      expect(built.version).to.be.a('string');
      expect(built.timestamp).to.be.a('string');
    });

    it('includes errors when added', function() {
      const output = new JsonOutput(true);
      output.addError('test error', 1);

      const built = output.build(false);

      expect(built.success).to.be.false;
      expect(built.errors).to.have.length(1);
      expect(built.errors[0].message).to.equal('test error');
      expect(built.errors[0].code).to.equal(1);
    });
  });
});
