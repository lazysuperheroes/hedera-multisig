#!/usr/bin/env node

/**
 * Create New Multi-Signature Account
 *
 * Creates a brand new Hedera account with multi-signature configuration.
 * The account is created with a KeyList from the start, not converted later.
 *
 * Usage:
 *   # Interactive mode
 *   node scripts/create-multisig-account.js
 *
 *   # With environment variables
 *   OPERATOR_ID=0.0.XXX OPERATOR_KEY=xxx node scripts/create-multisig-account.js
 *
 *   # With initial balance
 *   INITIAL_BALANCE=10 node scripts/create-multisig-account.js
 */

const {
  Client,
  AccountCreateTransaction,
  KeyList,
  PublicKey,
  PrivateKey,
  AccountId,
  AccountInfoQuery,
  TransactionId,
  Hbar
} = require('@hashgraph/sdk');

const readlineSync = require('readline-sync');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

async function createMultisigAccount() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║      CREATE NEW MULTI-SIGNATURE ACCOUNT               ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  try {
    // 1. Set up client
    const network = readlineSync.question(chalk.cyan('Network (testnet/mainnet) [testnet]: ')) || 'testnet';
    const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();

    // Set operator (pays for account creation)
    let operatorId, operatorKey;

    if (process.env.OPERATOR_ID && process.env.OPERATOR_KEY) {
      operatorId = AccountId.fromString(process.env.OPERATOR_ID);
      operatorKey = PrivateKey.fromString(process.env.OPERATOR_KEY);
      console.log(chalk.green('✅ Using operator from environment variables\n'));
    } else {
      console.log(chalk.yellow('Enter operator account (will pay for account creation):\n'));
      const operatorIdStr = readlineSync.question(chalk.cyan('Operator Account ID: '));
      const operatorKeyStr = readlineSync.question(chalk.cyan('Operator Private Key: '), {
        hideEchoBack: true
      });

      operatorId = AccountId.fromString(operatorIdStr);
      operatorKey = PrivateKey.fromString(operatorKeyStr);
      console.log('');
    }

    client.setOperator(operatorId, operatorKey);
    console.log(chalk.green(`✅ Connected to Hedera ${network}\n`));

    // 2. Get initial balance
    let initialBalance;

    if (process.env.INITIAL_BALANCE) {
      initialBalance = parseFloat(process.env.INITIAL_BALANCE);
      console.log(chalk.green(`✅ Using initial balance from environment: ${initialBalance} HBAR\n`));
    } else {
      const balanceStr = readlineSync.question(chalk.cyan('Initial balance in HBAR [10]: ')) || '10';
      initialBalance = parseFloat(balanceStr);
      console.log('');
    }

    if (initialBalance <= 0 || initialBalance > 10000) {
      console.log(chalk.red('\n❌ Invalid initial balance. Must be between 0 and 10000 HBAR\n'));
      process.exit(1);
    }

    // 3. Collect public keys for multi-sig
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('COLLECT PUBLIC KEYS FOR MULTI-SIG'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.yellow('Enter the public keys that will control this account.\n'));
    console.log(chalk.gray('You can:'));
    console.log(chalk.gray('  1. Enter keys manually (one per line)'));
    console.log(chalk.gray('  2. Load from a file (public-keys.txt)\n'));

    const loadMethod = readlineSync.question(chalk.cyan('Load method (manual/file) [manual]: ')) || 'manual';

    let publicKeys = [];

    if (loadMethod === 'file') {
      const filePath = readlineSync.question(chalk.cyan('File path [./public-keys.txt]: ')) || './public-keys.txt';

      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        publicKeys = fileContent
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#') && !line.startsWith('Public Keys:'));

        console.log(chalk.green(`\n✅ Loaded ${publicKeys.length} keys from file\n`));
      } else {
        console.log(chalk.red(`\n❌ File not found: ${filePath}\n`));
        process.exit(1);
      }
    } else {
      console.log(chalk.white('Enter public keys (one per line, empty line to finish):\n'));

      let index = 1;
      while (true) {
        const key = readlineSync.question(chalk.cyan(`Key ${index}: `));
        if (!key) break;

        publicKeys.push(key.trim());
        index++;
      }

      console.log('');
    }

    if (publicKeys.length === 0) {
      console.log(chalk.red('❌ No public keys provided. Exiting.\n'));
      process.exit(1);
    }

    console.log(chalk.green(`✅ Collected ${publicKeys.length} public keys\n`));

    // Display keys
    console.log(chalk.white('Public Keys:'));
    publicKeys.forEach((key, idx) => {
      console.log(chalk.gray(`  ${idx + 1}. ${key.substring(0, 20)}...`));
    });
    console.log('');

    // 4. Set threshold
    const defaultThreshold = Math.ceil(publicKeys.length / 2);
    const thresholdStr = readlineSync.question(
      chalk.cyan(`Signature threshold (1-${publicKeys.length}) [${defaultThreshold}]: `)
    );
    const threshold = thresholdStr ? parseInt(thresholdStr) : defaultThreshold;

    if (threshold < 1 || threshold > publicKeys.length) {
      console.log(chalk.red(`\n❌ Invalid threshold. Must be between 1 and ${publicKeys.length}\n`));
      process.exit(1);
    }

    console.log(chalk.green(`\n✅ Threshold set to ${threshold} of ${publicKeys.length}\n`));

    // 5. Create KeyList
    const keyList = new KeyList(
      publicKeys.map(key => PublicKey.fromString(key)),
      threshold
    );

    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('NEW ACCOUNT CONFIGURATION'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.white(`Network: ${network}`));
    console.log(chalk.white(`Initial Balance: ${initialBalance} HBAR`));
    console.log(chalk.white(`Keys: ${publicKeys.length}`));
    console.log(chalk.white(`Threshold: ${threshold} of ${publicKeys.length} signatures required`));
    console.log(chalk.cyan('═'.repeat(60)) + '\n');

    // 6. Confirm
    const confirm = readlineSync.keyInYN(chalk.yellow('Create this account? '));

    if (!confirm) {
      console.log(chalk.yellow('\n⚠️  Operation cancelled\n'));
      process.exit(0);
    }

    // 7. Create account
    console.log(chalk.yellow('\n⏳ Creating multi-sig account...\n'));

    // Generate transaction ID before freezing (stabilizes hash)
    const transaction = await new AccountCreateTransaction()
      .setInitialBalance(new Hbar(initialBalance))
      .setKey(keyList)
      .setTransactionId(TransactionId.generate(operatorId))
      .freezeWith(client);

    // Sign with operator key
    const signedTx = await transaction.sign(operatorKey);

    const txResponse = await signedTx.execute(client);
    const receipt = await txResponse.getReceipt(client);
    const newAccountId = receipt.accountId;

    console.log(chalk.green('✅ Account successfully created!\n'));
    console.log(chalk.white('Transaction Details:'));
    console.log(chalk.gray(`  Transaction ID: ${txResponse.transactionId.toString()}`));
    console.log(chalk.gray(`  Status: ${receipt.status.toString()}`));
    console.log(chalk.bold.yellow(`  New Account ID: ${newAccountId.toString()}\n`));

    // 8. Verify
    console.log(chalk.yellow('Verifying account....\n'));

    const accountInfo = await new AccountInfoQuery()
      .setAccountId(newAccountId)
      .execute(client);

    console.log(chalk.green('✅ Account verified:\n'));
    console.log(chalk.white('Account Information:'));
    console.log(chalk.gray(`  Account ID: ${newAccountId.toString()}`));
    console.log(chalk.gray(`  Balance: ${accountInfo.balance.toString()}`));
    console.log(chalk.gray(`  Key Type: KeyList (Multi-Sig)`));
    console.log(chalk.gray(`  Keys: ${publicKeys.length}`));
    console.log(chalk.gray(`  Threshold: ${threshold}`));
    console.log('');

    // 9. Save configuration
    const saveConfig = readlineSync.keyInYN(chalk.cyan('Save configuration to file? '));

    if (saveConfig) {
      const config = {
        accountId: newAccountId.toString(),
        network,
        initialBalance,
        threshold,
        publicKeys,
        createdAt: new Date().toISOString(),
        transactionId: txResponse.transactionId.toString(),
        operatorId: operatorId.toString()
      };

      const configPath = path.join(process.cwd(), `multisig-account-${newAccountId.toString().replace(/\./g, '-')}.json`);
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

      console.log(chalk.green(`\n✅ Configuration saved to: ${configPath}\n`));
    }

    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.green('✅ ACCOUNT CREATION COMPLETE!'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.yellow('\n⚠️  IMPORTANT:'));
    console.log(chalk.white(`  - Account ID: ${chalk.bold.yellow(newAccountId.toString())}`));
    console.log(chalk.white(`  - This account requires ${threshold} of ${publicKeys.length} signatures`));
    console.log(chalk.white(`  - Store the public keys and threshold configuration securely`));
    console.log(chalk.white(`  - Use the hedera-multisig library to sign transactions`));
    console.log(chalk.white(`  - View on HashScan: https://${network === 'mainnet' ? '' : 'hashscan.io/testnet/'}account/${newAccountId.toString()}\n`));

  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    console.error(chalk.gray(error.stack));
    process.exit(1);
  }
}

// Show help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node scripts/create-multisig-account.js [options]');
  console.log('');
  console.log('Environment Variables:');
  console.log('  OPERATOR_ID        Operator account ID (pays for creation)');
  console.log('  OPERATOR_KEY       Operator private key');
  console.log('  INITIAL_BALANCE    Initial balance in HBAR (default: 10)');
  console.log('');
  console.log('Options:');
  console.log('  --help, -h         Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/create-multisig-account.js');
  console.log('  OPERATOR_ID=0.0.123 OPERATOR_KEY=xxx node scripts/create-multisig-account.js');
  console.log('  INITIAL_BALANCE=50 node scripts/create-multisig-account.js');
  process.exit(0);
}

// Run
createMultisigAccount();
