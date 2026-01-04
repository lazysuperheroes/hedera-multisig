#!/usr/bin/env node

/**
 * Hedera MultiSig CLI
 *
 * Unified command-line interface for multi-signature transaction management.
 *
 * Usage:
 *   hedera-multisig <command> [options]
 *   npx @lazysuperheroes/hedera-multisig <command> [options]
 *
 * Commands:
 *   server        Start a multi-sig session server
 *   participant   Join a session as a participant
 *   sign          Sign transactions offline (air-gapped)
 *   keys          Key management commands
 *   audit         Run security audit on codebase
 */

const { program } = require('commander');
const packageJson = require('../package.json');

// Configure main program
program
  .name('hedera-multisig')
  .description('Production-grade multi-signature transaction management for Hedera')
  .version(packageJson.version, '-V, --version', 'Show version number')
  .helpOption('-h, --help', 'Show help')
  .showHelpAfterError('(use --help for available commands)')
  .configureOutput({
    outputError: (str, write) => write(`\x1b[31m${str}\x1b[0m`)
  });

// Add global options that apply to all commands
program
  .option('-v, --verbose', 'Enable verbose output')
  .option('-q, --quiet', 'Suppress non-essential output')
  .option('-j, --json', 'Output as JSON (for scripting)')
  .option('--trace', 'Enable trace-level debug logging')
  .option('--log-file <path>', 'Write logs to file')
  .option('--export-logs [path]', 'Export logs on exit');

// Load command modules
require('./commands/server')(program);
require('./commands/participant')(program);
require('./commands/sign')(program);
require('./commands/keys')(program);
require('./commands/audit')(program);
require('./commands/completions')(program);

// Add init command (project setup wizard)
program
  .command('init')
  .description('Initialize a new multi-sig project')
  .action(() => {
    // Spawn the init wizard
    const { spawn } = require('child_process');
    const path = require('path');
    const initWizard = spawn('node', [path.join(__dirname, 'init.js')], {
      stdio: 'inherit'
    });
    initWizard.on('close', (code) => process.exit(code));
  });

// Add account command (links to account-manager)
program
  .command('account')
  .description('Account management (interactive menu)')
  .action(() => {
    // Spawn the account-manager script
    const { spawn } = require('child_process');
    const path = require('path');
    const accountManager = spawn('node', [path.join(__dirname, 'account-manager.js')], {
      stdio: 'inherit'
    });
    accountManager.on('close', (code) => process.exit(code));
  });

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
