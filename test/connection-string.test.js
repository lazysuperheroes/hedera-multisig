/**
 * Connection String Tests
 *
 * Tests for shared/connection-string.js utility module.
 * Validates generation, parsing, validation, and edge cases.
 */

const { expect } = require('chai');
const { generateConnectionString, parseConnectionString, isValidConnectionString } = require('../shared/connection-string');

describe('Connection String', function() {

  describe('generateConnectionString', function() {

    it('produces hmsc: prefix', function() {
      const connStr = generateConnectionString('ws://localhost:3001', 'session123', 'ABCD1234');
      expect(connStr).to.match(/^hmsc:/);
    });

    it('produces a base64-encoded payload after the prefix', function() {
      const connStr = generateConnectionString('ws://localhost:3001', 'session123', 'ABCD1234');
      const base64Part = connStr.slice(5);
      // Should be valid base64 (does not throw when decoded)
      const decoded = Buffer.from(base64Part, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      expect(parsed).to.have.property('s');
      expect(parsed).to.have.property('i');
      expect(parsed).to.have.property('p');
    });
  });

  describe('parseConnectionString', function() {

    it('round-trips correctly (generate then parse yields same values)', function() {
      const serverUrl = 'ws://localhost:3001';
      const sessionId = 'abc123def456';
      const pin = 'XYZPIN99';

      const connStr = generateConnectionString(serverUrl, sessionId, pin);
      const parsed = parseConnectionString(connStr);

      expect(parsed).to.not.be.null;
      expect(parsed.serverUrl).to.equal(serverUrl);
      expect(parsed.sessionId).to.equal(sessionId);
      expect(parsed.pin).to.equal(pin);
    });

    it('returns null for invalid strings', function() {
      expect(parseConnectionString('invalid-string')).to.be.null;
      expect(parseConnectionString('nothmsc:abc')).to.be.null;
      expect(parseConnectionString('http://example.com')).to.be.null;
    });

    it('returns null for empty string', function() {
      expect(parseConnectionString('')).to.be.null;
    });

    it('returns null for null input', function() {
      expect(parseConnectionString(null)).to.be.null;
    });

    it('returns null for undefined input', function() {
      expect(parseConnectionString(undefined)).to.be.null;
    });

    it('returns null for hmsc: prefix with corrupted base64', function() {
      expect(parseConnectionString('hmsc:!!!not-valid-base64!!!')).to.be.null;
    });

    it('returns null for hmsc: prefix with valid base64 but missing required fields', function() {
      // Encode JSON missing the 's' (serverUrl) field
      const data = { i: 'session123', p: 'PIN' };
      const base64 = Buffer.from(JSON.stringify(data)).toString('base64');
      expect(parseConnectionString('hmsc:' + base64)).to.be.null;

      // Encode JSON missing the 'i' (sessionId) field
      const data2 = { s: 'ws://localhost', p: 'PIN' };
      const base642 = Buffer.from(JSON.stringify(data2)).toString('base64');
      // This should succeed since 's' and 'i' are present... wait, data2 has 's' and no 'i'
      // Actually data2 does have no 'i', let me fix:
      const data3 = { s: 'ws://localhost' };
      const base643 = Buffer.from(JSON.stringify(data3)).toString('base64');
      expect(parseConnectionString('hmsc:' + base643)).to.be.null;
    });
  });

  describe('isValidConnectionString', function() {

    it('returns true for valid connection strings', function() {
      const connStr = generateConnectionString('ws://localhost:3001', 'session123', 'PIN12345');
      expect(isValidConnectionString(connStr)).to.be.true;
    });

    it('returns false for invalid connection strings', function() {
      expect(isValidConnectionString('invalid')).to.be.false;
      expect(isValidConnectionString('')).to.be.false;
      expect(isValidConnectionString(null)).to.be.false;
      expect(isValidConnectionString(undefined)).to.be.false;
    });

    it('returns false for strings with hmsc: prefix but invalid payload', function() {
      expect(isValidConnectionString('hmsc:garbled-data')).to.be.false;
    });
  });

  describe('Connection string contents', function() {

    it('contains server URL, session ID, and PIN', function() {
      const serverUrl = 'wss://multisig.example.com:8443';
      const sessionId = 'a1b2c3d4e5f6';
      const pin = 'SECURE99';

      const connStr = generateConnectionString(serverUrl, sessionId, pin);
      const parsed = parseConnectionString(connStr);

      expect(parsed.serverUrl).to.equal(serverUrl);
      expect(parsed.sessionId).to.equal(sessionId);
      expect(parsed.pin).to.equal(pin);
    });

    it('handles special characters in PIN', function() {
      const serverUrl = 'ws://localhost:3001';
      const sessionId = 'session-abc';
      const pin = 'P!N@W#TH$SP%C^AL&CH*RS';

      const connStr = generateConnectionString(serverUrl, sessionId, pin);
      const parsed = parseConnectionString(connStr);

      expect(parsed).to.not.be.null;
      expect(parsed.pin).to.equal(pin);
    });

    it('handles URLs with ws:// protocol', function() {
      const connStr = generateConnectionString('ws://localhost:3001', 'session1', 'PIN1');
      const parsed = parseConnectionString(connStr);

      expect(parsed.serverUrl).to.equal('ws://localhost:3001');
    });

    it('handles URLs with wss:// protocol', function() {
      const connStr = generateConnectionString('wss://secure.example.com:443', 'session2', 'PIN2');
      const parsed = parseConnectionString(connStr);

      expect(parsed.serverUrl).to.equal('wss://secure.example.com:443');
    });

    it('handles URLs with paths', function() {
      const connStr = generateConnectionString('wss://example.com/multisig/ws', 'session3', 'PIN3');
      const parsed = parseConnectionString(connStr);

      expect(parsed.serverUrl).to.equal('wss://example.com/multisig/ws');
    });

    it('handles long session IDs (32-char hex)', function() {
      const sessionId = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
      const connStr = generateConnectionString('ws://localhost:3001', sessionId, 'PIN12345');
      const parsed = parseConnectionString(connStr);

      expect(parsed.sessionId).to.equal(sessionId);
    });

    it('PIN is optional in parsed output (undefined when not provided)', function() {
      // Manually craft a connection string without a PIN
      const data = { s: 'ws://localhost:3001', i: 'session-no-pin' };
      const base64 = Buffer.from(JSON.stringify(data)).toString('base64');
      const connStr = 'hmsc:' + base64;

      const parsed = parseConnectionString(connStr);
      expect(parsed).to.not.be.null;
      expect(parsed.serverUrl).to.equal('ws://localhost:3001');
      expect(parsed.sessionId).to.equal('session-no-pin');
      expect(parsed.pin).to.be.undefined;
    });
  });
});

console.log('\n' + '='.repeat(59));
console.log('           CONNECTION STRING TESTS');
console.log('='.repeat(59));
console.log();
