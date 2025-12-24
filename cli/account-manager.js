#!/usr/bin/env node

/**
 * Hedera Multi-Sig Account Manager CLI
 *
 * Unified CLI interface for all Hedera account management operations.
 * Provides menu-driven access to key generation, account setup, and
 * transaction management tools.
 *
 * Usage:
 *   # Interactive menu
 *   node cli/account-manager.js
 *
 *   # Direct operation
 *   node cli/account-manager.js --operation <name>
 *
 * Operations:
 *   generate-keys          Generate new key pairs
 *   create-account         Create new multi-sig account
 *   setup-multisig         Convert single-sig to multi-sig
 *   update-keys            Rotate multi-sig keys
 *   revert-multisig        Convert multi-sig to single-sig
 *   query-tx               Inspect transaction bytes
 *   sign-tx                Sign transaction offline
 *   collect-keys           Collect team keys
 */

const { spawn } = require('child_process');
const readlineSync = require('readline-sync');
const chalk = require('chalk');
const path = require('path');

function getArg(arg) {
  const index = process.argv.indexOf(`--${arg}`);
  if (index > -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
}

function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const scriptProcess = spawn('node', [scriptPath, ...args], {
      stdio: 'inherit',
      cwd: process.cwd()
    });

    scriptProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script exited with code ${code}`));
      }
    });

    scriptProcess.on('error', (err) => {
      reject(err);
    });
  });
}

const operations = {
  '1': {
    name: 'generate-keys',
    title: 'Generate Key Pairs',
    description: 'Generate new ED25519 key pairs with optional BIP39 mnemonic',
    script: 'scripts/generate-keys.js'
  },
  '2': {
    name: 'create-account',
    title: 'Create New Multi-Sig Account',
    description: 'Create a brand new Hedera account with multi-sig configuration',
    script: 'scripts/create-multisig-account.js'
  },
  '3': {
    name: 'setup-multisig',
    title: 'Convert to Multi-Sig',
    description: 'Convert an existing single-sig account to multi-sig',
    script: 'scripts/setup-multisig-account.js'
  },
  '4': {
    name: 'update-keys',
    title: 'Rotate Multi-Sig Keys',
    description: 'Update keys on an existing multi-sig account',
    script: 'scripts/update-multisig-keys.js'
  },
  '5': {
    name: 'revert-multisig',
    title: 'Revert to Single-Sig',
    description: 'Convert a multi-sig account back to single-sig',
    script: 'scripts/revert-to-single-sig.js'
  },
  '6': {
    name: 'query-tx',
    title: 'Inspect Transaction',
    description: 'Decode and display transaction bytes without signing',
    script: 'scripts/query-transaction.js'
  },
  '7': {
    name: 'sign-tx',
    title: 'Sign Transaction',
    description: 'Sign a frozen transaction with private keys (offline)',
    script: 'scripts/sign-transaction.js'
  },
  '8': {
    name: 'collect-keys',
    title: 'Collect Team Keys',
    description: 'Collect public keys from team members',
    script: 'scripts/collect-team-keys.js'
  }
};

function displayMenu() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║      HEDERA MULTI-SIG ACCOUNT MANAGER                     ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════════╝\n'));

  console.log(chalk.yellow('Select an operation:\n'));

  console.log(chalk.bold.white('📋 Key Management:'));
  console.log(chalk.gray(`  1. ${operations['1'].title}`));
  console.log(chalk.gray(`     ${operations['1'].description}\n`));

  console.log(chalk.bold.white('🏦 Account Setup:'));
  console.log(chalk.gray(`  2. ${operations['2'].title}`));
  console.log(chalk.gray(`     ${operations['2'].description}`));
  console.log(chalk.gray(`  3. ${operations['3'].title}`));
  console.log(chalk.gray(`     ${operations['3'].description}\n`));

  console.log(chalk.bold.white('🔄 Account Management:'));
  console.log(chalk.gray(`  4. ${operations['4'].title}`));
  console.log(chalk.gray(`     ${operations['4'].description}`));
  console.log(chalk.gray(`  5. ${operations['5'].title}`));
  console.log(chalk.gray(`     ${operations['5'].description}\n`));

  console.log(chalk.bold.white('📝 Transaction Tools:'));
  console.log(chalk.gray(`  6. ${operations['6'].title}`));
  console.log(chalk.gray(`     ${operations['6'].description}`));
  console.log(chalk.gray(`  7. ${operations['7'].title}`));
  console.log(chalk.gray(`     ${operations['7'].description}\n`));

  console.log(chalk.bold.white('👥 Team Coordination:'));
  console.log(chalk.gray(`  8. ${operations['8'].title}`));
  console.log(chalk.gray(`     ${operations['8'].description}\n`));

  console.log(chalk.gray('  0. Exit\n'));
}

async function runOperation(operationKey) {
  const operation = operations[operationKey];

  if (!operation) {
    console.log(chalk.red('\n❌ Invalid operation\n'));
    return false;
  }

  console.log(chalk.cyan(`\n${'═'.repeat(60)}`));
  console.log(chalk.bold.white(`Running: ${operation.title}`));
  console.log(chalk.cyan(`${'═'.repeat(60)}\n`));

  try {
    const scriptPath = path.join(__dirname, '..', operation.script);
    await runScript(scriptPath);
    return true;
  } catch (error) {
    console.error(chalk.red(`\n❌ Operation failed: ${error.message}\n`));
    return false;
  }
}

async function main() {
  // Check for direct operation mode
  const operationArg = getArg('operation');

  if (operationArg) {
    // Find operation by name
    const operationKey = Object.keys(operations).find(
      key => operations[key].name === operationArg
    );

    if (operationKey) {
      await runOperation(operationKey);
      process.exit(0);
    } else {
      console.log(chalk.red(`\n❌ Unknown operation: ${operationArg}\n`));
      console.log(chalk.white('Available operations:'));
      Object.values(operations).forEach(op => {
        console.log(chalk.gray(`  - ${op.name}`));
      });
      console.log('');
      process.exit(1);
    }
  }

  // Interactive menu mode
  while (true) {
    displayMenu();

    const choice = readlineSync.question(chalk.cyan('Enter your choice (0-8): '));

    if (choice === '0') {
      console.log(chalk.green('\n👋 Goodbye!\n'));
      process.exit(0);
    }

    const success = await runOperation(choice);

    if (success) {
      console.log(chalk.green('\n✅ Operation completed successfully!\n'));
    }

    // Ask if user wants to continue
    const continueChoice = readlineSync.keyInYN(chalk.cyan('\nPerform another operation? '));

    if (!continueChoice) {
      console.log(chalk.green('\n👋 Goodbye!\n'));
      process.exit(0);
    }
  }
}

// Show help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Hedera Multi-Sig Account Manager');
  console.log('');
  console.log('Usage:');
  console.log('  node cli/account-manager.js                    # Interactive menu');
  console.log('  node cli/account-manager.js --operation <name> # Direct operation');
  console.log('');
  console.log('Available Operations:');
  Object.values(operations).forEach(op => {
    console.log(`  ${op.name.padEnd(20)} ${op.description}`);
  });
  console.log('');
  console.log('Examples:');
  console.log('  node cli/account-manager.js');
  console.log('  node cli/account-manager.js --operation generate-keys');
  console.log('  node cli/account-manager.js --operation setup-multisig');
  console.log('');
  process.exit(0);
}

// Run
main().catch(error => {
  console.error(chalk.red(`\n❌ Fatal error: ${error.message}\n`));
  process.exit(1);
});
