/**
 * cli/utils/cliUtils.js coverage tests (Phase F7).
 *
 * Quick coverage push for utility helpers. Avoids cli/commands/* (those
 * are integration paths needing real Hedera).
 */

const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const {
  parseCommonFlags,
  ExitCodes,
  JsonOutput,
  getCommonFlagsHelp,
  getVersion,
  getPackageName,
} = require('../cli/utils/cliUtils');

describe('cli/utils/cliUtils (Phase F7)', function() {

  describe('parseCommonFlags', function() {
    it('returns defaults when no flags', function() {
      const flags = parseCommonFlags([]);
      expect(flags.verbose).to.be.false;
      expect(flags.quiet).to.be.false;
      expect(flags.json).to.be.false;
      expect(flags.trace).to.be.false;
      expect(flags.yes).to.be.false;
    });

    it('detects --verbose and -v', function() {
      expect(parseCommonFlags(['--verbose']).verbose).to.be.true;
      expect(parseCommonFlags(['-v']).verbose).to.be.true;
    });

    it('detects --json (long form only)', function() {
      expect(parseCommonFlags(['--json']).json).to.be.true;
    });

    it('detects --quiet and -q', function() {
      expect(parseCommonFlags(['--quiet']).quiet).to.be.true;
      expect(parseCommonFlags(['-q']).quiet).to.be.true;
    });

    it('detects --trace', function() {
      expect(parseCommonFlags(['--trace']).trace).to.be.true;
    });

    it('parses --log-file with following value', function() {
      const flags = parseCommonFlags(['--log-file', '/tmp/x.log']);
      expect(flags.logFile).to.equal('/tmp/x.log');
    });

    it('does not treat next arg as logFile if it starts with -', function() {
      const flags = parseCommonFlags(['--log-file', '--verbose']);
      expect(flags.logFile).to.be.null;
      expect(flags.verbose).to.be.true;
    });

    it('preserves remainingArgs for non-flag positional args', function() {
      const flags = parseCommonFlags(['--verbose', 'positional1', 'positional2']);
      expect(flags.verbose).to.be.true;
      expect(flags.remainingArgs).to.include('positional1');
      expect(flags.remainingArgs).to.include('positional2');
    });
  });

  describe('ExitCodes', function() {
    it('defines the expected codes', function() {
      expect(ExitCodes.SUCCESS).to.equal(0);
      expect(ExitCodes.VALIDATION_ERROR).to.be.a('number').and.greaterThan(0);
      expect(ExitCodes.NETWORK_ERROR).to.be.a('number').and.greaterThan(0);
      expect(ExitCodes.INTERNAL_ERROR).to.be.a('number').and.greaterThan(0);
      expect(ExitCodes.TIMEOUT).to.be.a('number').and.greaterThan(0);
    });
  });

  describe('JsonOutput', function() {
    it('disabled mode is a no-op', function() {
      const out = new JsonOutput(false);
      expect(out.enabled).to.be.false;
      // set() / addError() / addWarning() should not throw
      out.set('foo', 'bar').addError('boom').addWarning('careful');
      expect(out.data.foo).to.equal('bar');
    });

    it('set() is chainable', function() {
      const out = new JsonOutput(true);
      const ret = out.set('a', 1).set('b', 2);
      expect(ret).to.equal(out);
      expect(out.data).to.deep.include({ a: 1, b: 2 });
    });

    it('addError + addWarning track collections', function() {
      const out = new JsonOutput(true);
      out.addError('err-msg', 'ERR_CODE').addWarning('warn-msg');
      expect(out.errors).to.have.lengthOf(1);
      expect(out.errors[0].message).to.equal('err-msg');
      expect(out.errors[0].code).to.equal('ERR_CODE');
      expect(out.warnings).to.have.lengthOf(1);
    });

    it('print() emits JSON when enabled', function() {
      const out = new JsonOutput(true);
      out.set('result', 'ok');
      let captured = '';
      const origLog = console.log;
      // print() uses JSON.stringify(..., null, 2) which produces multi-line
      // output passed as a single console.log call.
      console.log = (msg) => { captured = String(msg); };
      try {
        out.print(true);
      } finally {
        console.log = origLog;
      }
      // build() wraps data; extract from whatever shape it produces
      const parsed = JSON.parse(captured);
      // The data is exposed somewhere in the parsed payload
      const payload = parsed.data || parsed;
      expect(payload.result || parsed.result).to.equal('ok');
    });

    it('print() suppressed when disabled', function() {
      const out = new JsonOutput(false);
      out.set('result', 'ok');
      let called = false;
      const origLog = console.log;
      console.log = () => { called = true; };
      try {
        out.print(true);
      } finally {
        console.log = origLog;
      }
      expect(called).to.be.false;
    });
  });

  describe('Version helpers', function() {
    it('getVersion returns package.json version', function() {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
      expect(getVersion()).to.equal(pkg.version);
    });

    it('getPackageName returns @lazysuperheroes/hedera-multisig', function() {
      expect(getPackageName()).to.equal('@lazysuperheroes/hedera-multisig');
    });
  });

  describe('getCommonFlagsHelp', function() {
    it('returns a non-empty help string mentioning common flags', function() {
      const help = getCommonFlagsHelp();
      expect(help).to.be.a('string').and.have.length.greaterThan(0);
      expect(help.toLowerCase()).to.match(/verbose|json|quiet/);
    });
  });
});
