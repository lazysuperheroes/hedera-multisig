/**
 * WebSocket Server and Client Unit Tests
 *
 * Tests for WebSocket message handling, validation, and timer management.
 */

const { expect } = require('chai');

describe('WebSocket Components', function() {

  describe('TimerController', function() {
    const { TimerController } = require('../shared/TimerController');
    let controller;

    beforeEach(function() {
      controller = new TimerController();
    });

    afterEach(function() {
      controller.clearAll();
    });

    it('creates setTimeout with tracking', function(done) {
      let called = false;
      const id = controller.setTimeout(() => {
        called = true;
      }, 10, 'test-timeout');

      expect(id).to.be.a('number');
      expect(controller.getStats().timeouts).to.equal(1);

      setTimeout(() => {
        expect(called).to.be.true;
        expect(controller.getStats().timeouts).to.equal(0);
        done();
      }, 50);
    });

    it('creates setInterval with tracking', function(done) {
      let count = 0;
      const id = controller.setInterval(() => {
        count++;
      }, 10, 'test-interval');

      expect(id).to.be.a('number');
      expect(controller.getStats().intervals).to.equal(1);

      setTimeout(() => {
        expect(count).to.be.at.least(2);
        controller.clear(id);
        expect(controller.getStats().intervals).to.equal(0);
        done();
      }, 50);
    });

    it('clears specific timer', function() {
      const id = controller.setTimeout(() => {}, 1000, 'test');

      expect(controller.getStats().total).to.equal(1);
      expect(controller.clear(id)).to.be.true;
      expect(controller.getStats().total).to.equal(0);
    });

    it('clears timers by prefix', function() {
      controller.setTimeout(() => {}, 1000, 'session-123-timeout');
      controller.setTimeout(() => {}, 1000, 'session-123-ping');
      controller.setTimeout(() => {}, 1000, 'other-timer');

      expect(controller.getStats().total).to.equal(3);
      const cleared = controller.clearByPrefix('session-123');
      expect(cleared).to.equal(2);
      expect(controller.getStats().total).to.equal(1);
    });

    it('clears all timers', function() {
      controller.setTimeout(() => {}, 1000);
      controller.setTimeout(() => {}, 1000);
      controller.setInterval(() => {}, 1000);

      expect(controller.getStats().total).to.equal(3);
      const cleared = controller.clearAll();
      expect(cleared).to.equal(3);
      expect(controller.getStats().total).to.equal(0);
    });

    it('returns active timer info', function() {
      controller.setTimeout(() => {}, 1000, 'my-timeout');
      controller.setInterval(() => {}, 1000, 'my-interval');

      const timers = controller.getActiveTimers();
      expect(timers).to.have.length(2);

      const names = timers.map(t => t.name);
      expect(names).to.include('my-timeout');
      expect(names).to.include('my-interval');
    });

    it('prevents new timers after shutdown', function() {
      controller.clearAll(); // Sets isShuttingDown = true

      const id = controller.setTimeout(() => {}, 1000);
      expect(id).to.be.null;
    });

    it('resets controller state', function() {
      controller.setTimeout(() => {}, 1000);
      controller.clearAll();

      controller.reset();

      const id = controller.setTimeout(() => {}, 1000);
      expect(id).to.not.be.null;
      expect(controller.getStats().total).to.equal(1);
    });
  });

  describe('Message Validation Logic', function() {
    // Test the validation logic that would be in WebSocketServer

    function validateMessage(data) {
      const MAX_SIZE = 5 * 1024 * 1024;
      const size = Buffer.byteLength(data);

      if (size > MAX_SIZE) {
        return `Message too large: ${size} bytes`;
      }

      if (size === 0) {
        return 'Empty message received';
      }

      const str = data.toString().substring(0, 100).trim();

      if (!str.startsWith('{')) {
        return 'Invalid message format: expected JSON object';
      }

      if (!str.includes('"type"')) {
        return 'Invalid message format: missing "type" field';
      }

      return null;
    }

    it('rejects empty messages', function() {
      const result = validateMessage(Buffer.from(''));
      expect(result).to.equal('Empty message received');
    });

    it('rejects non-JSON messages', function() {
      const result = validateMessage(Buffer.from('hello world'));
      expect(result).to.equal('Invalid message format: expected JSON object');
    });

    it('rejects messages without type field', function() {
      const result = validateMessage(Buffer.from('{"data": "test"}'));
      expect(result).to.equal('Invalid message format: missing "type" field');
    });

    it('accepts valid JSON messages', function() {
      const result = validateMessage(Buffer.from('{"type": "PING"}'));
      expect(result).to.be.null;
    });

    it('accepts complex valid messages', function() {
      const msg = JSON.stringify({
        type: 'AUTH',
        payload: {
          sessionId: 'abc123',
          pin: '12345678'
        }
      });
      const result = validateMessage(Buffer.from(msg));
      expect(result).to.be.null;
    });

    it('rejects oversized messages', function() {
      const hugeData = Buffer.alloc(6 * 1024 * 1024, 'x');
      const result = validateMessage(hugeData);
      expect(result).to.include('too large');
    });
  });

  describe('Transaction Normalization Logic', function() {
    // Test the normalization logic

    function normalizeFrozenTransaction(frozenTransaction) {
      if (!frozenTransaction) {
        return null;
      }

      let bytes;
      let base64;

      if (typeof frozenTransaction === 'string') {
        base64 = frozenTransaction;
        bytes = Buffer.from(base64, 'base64');
      } else if (frozenTransaction.base64) {
        base64 = frozenTransaction.base64;
        bytes = frozenTransaction.bytes
          ? Buffer.from(frozenTransaction.bytes)
          : Buffer.from(base64, 'base64');
      } else if (frozenTransaction.bytes) {
        bytes = Buffer.from(frozenTransaction.bytes);
        base64 = bytes.toString('base64');
      } else {
        return null;
      }

      return { bytes, base64 };
    }

    it('normalizes plain base64 string', function() {
      const testData = 'dGVzdCBkYXRh'; // "test data"
      const result = normalizeFrozenTransaction(testData);

      expect(result).to.not.be.null;
      expect(result.base64).to.equal(testData);
      expect(result.bytes.toString()).to.equal('test data');
    });

    it('normalizes object with base64 property', function() {
      const input = { base64: 'dGVzdA==' };
      const result = normalizeFrozenTransaction(input);

      expect(result).to.not.be.null;
      expect(result.base64).to.equal('dGVzdA==');
      expect(result.bytes.toString()).to.equal('test');
    });

    it('normalizes object with bytes property', function() {
      const input = { bytes: Buffer.from('hello') };
      const result = normalizeFrozenTransaction(input);

      expect(result).to.not.be.null;
      expect(result.bytes.toString()).to.equal('hello');
      expect(result.base64).to.equal(Buffer.from('hello').toString('base64'));
    });

    it('handles null input', function() {
      const result = normalizeFrozenTransaction(null);
      expect(result).to.be.null;
    });

    it('handles undefined input', function() {
      const result = normalizeFrozenTransaction(undefined);
      expect(result).to.be.null;
    });

    it('handles invalid object format', function() {
      const result = normalizeFrozenTransaction({ foo: 'bar' });
      expect(result).to.be.null;
    });
  });

  describe('SigningClient Logic', function() {
    const SigningClient = require('../client/SigningClient');

    it('creates client with default options', function() {
      const client = new SigningClient();

      expect(client.options.verbose).to.be.true;
      expect(client.options.autoReview).to.be.true;
      expect(client.status).to.equal('disconnected');
    });

    it('creates client with custom options', function() {
      const client = new SigningClient({
        verbose: false,
        label: 'Test Signer'
      });

      expect(client.options.verbose).to.be.false;
      expect(client.options.label).to.equal('Test Signer');
    });

    it('supports event registration', function() {
      const client = new SigningClient();
      let eventFired = false;

      client.on('connected', () => {
        eventFired = true;
      });

      expect(client.eventHandlers.connected).to.be.a('function');
    });

    it('clears private key on disconnect', function() {
      const client = new SigningClient({ verbose: false });

      // Simulate loaded key
      client.privateKey = { fake: 'key' };

      client.disconnect();

      expect(client.privateKey).to.be.null;
      expect(client.status).to.equal('disconnected');
    });
  });
});

console.log('\n╔═══════════════════════════════════════════════════════════╗');
console.log('║           WEBSOCKET COMPONENTS UNIT TESTS                 ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');
