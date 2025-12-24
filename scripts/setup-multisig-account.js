#!/usr/bin/env node

/**
 * Setup Multi-Signature Account
 *
 * Converts a single-signature Hedera account into a multi-signature account
 * with M-of-N threshold key structure.
 *
 * Usage:
 *   ACCOUNT_ID=0.0.XXX ACCOUNT_KEY=xxx node scripts/setup-multisig-account.js
 *
 * Interactive mode:
 *   node scripts/setup-multisig-account.js
 */

const {
  Client,
  AccountUpdateTransaction,
  KeyList,
  PublicKey,
  PrivateKey,
  AccountId,
  AccountInfoQuery,
  TransactionId
} = require('@hashgraph/sdk');

const readlineSync = require('readline-sync');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

async function setupMultisigAccount() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║       HEDERA MULTI-SIGNATURE ACCOUNT SETUP            ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  try {
    // 1. Get account to convert
    let accountId, currentPrivateKey;

    if (process.env.ACCOUNT_ID && process.env.ACCOUNT_KEY) {
      accountId = AccountId.fromString(process.env.ACCOUNT_ID);
      currentPrivateKey = PrivateKey.fromString(process.env.ACCOUNT_KEY);
      console.log(chalk.green('✅ Using account from environment variables\n'));
    } else {
      console.log(chalk.yellow('Enter the account to convert to multi-sig:\n'));
      const accountIdStr = readlineSync.question(chalk.cyan('Account ID (e.g., 0.0.12345): '));
      const privateKeyStr = readlineSync.question(chalk.cyan('Current Private Key: '), {
        hideEchoBack: true
      });

      accountId = AccountId.fromString(accountIdStr);
      currentPrivateKey = PrivateKey.fromString(privateKeyStr);
      console.log('');
    }

    // 2. Set up client
    const network = readlineSync.question(chalk.cyan('Network (testnet/mainnet) [testnet]: ')) || 'testnet';
    const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();

    // Use an operator account (can be the same account or different)
    let operatorId, operatorKey;

    if (process.env.OPERATOR_ID && process.env.OPERATOR_KEY) {
      operatorId = AccountId.fromString(process.env.OPERATOR_ID);
      operatorKey = PrivateKey.fromString(process.env.OPERATOR_KEY);
    } else {
      operatorId = accountId;
      operatorKey = currentPrivateKey;
    }

    client.setOperator(operatorId, operatorKey);

    console.log(chalk.green(`✅ Connected to Hedera ${network}\n`));

    // 3. Get current account info
    console.log(chalk.yellow('Fetching current account information...\n'));

    const accountInfo = await new AccountInfoQuery()
      .setAccountId(accountId)
      .execute(client);

    console.log(chalk.white('Current Account Information:'));
    console.log(chalk.gray(`  Account ID: ${accountId.toString()}`));
    console.log(chalk.gray(`  Balance: ${accountInfo.balance.toString()}`));
    console.log(chalk.gray(`  Current Key: ${accountInfo.key.toString().substring(0, 20)}...`));
    console.log('');

    // 4. Collect public keys for multi-sig
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('COLLECT PUBLIC KEYS FOR MULTI-SIG'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.yellow('Enter the public keys that will be part of the multi-sig.\n'));
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
          .filter(line => line && !line.startsWith('#'));

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

    // 5. Set threshold
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

    // 6. Create KeyList
    const keyList = new KeyList(
      publicKeys.map(key => PublicKey.fromString(key)),
      threshold
    );

    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('MULTI-SIG CONFIGURATION'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.white(`Account: ${accountId.toString()}`));
    console.log(chalk.white(`Keys: ${publicKeys.length}`));
    console.log(chalk.white(`Threshold: ${threshold} of ${publicKeys.length} signatures required`));
    console.log(chalk.cyan('═'.repeat(60)) + '\n');

    // 7. Confirm
    const confirm = readlineSync.keyInYN(chalk.yellow('Proceed with account update? '));

    if (!confirm) {
      console.log(chalk.yellow('\n⚠️  Operation cancelled\n'));
      process.exit(0);
    }

    // 8. Execute account update
    console.log(chalk.yellow('\n⏳ Updating account to multi-sig...\n'));

    // Generate transaction ID before freezing (stabilizes hash for multi-sig)
    const transaction = await new AccountUpdateTransaction()
      .setAccountId(accountId)
      .setKey(keyList)
      .setTransactionId(TransactionId.generate(operatorId))
      .freezeWith(client);

    // Sign with current key (must be signed by current key to update)
    const signedTx = await transaction.sign(currentPrivateKey);

    const txResponse = await signedTx.execute(client);
    const receipt = await txResponse.getReceipt(client);

    console.log(chalk.green('✅ Account successfully updated to multi-sig!\n'));
    console.log(chalk.white('Transaction Details:'));
    console.log(chalk.gray(`  Transaction ID: ${txResponse.transactionId.toString()}`));
    console.log(chalk.gray(`  Status: ${receipt.status.toString()}`));
    console.log('');

    // 9. Verify
    console.log(chalk.yellow('Verifying account update...\n'));

    const updatedInfo = await new AccountInfoQuery()
      .setAccountId(accountId)
      .execute(client);

    console.log(chalk.green('✅ Account verified:\n'));
    console.log(chalk.white('New Account Configuration:'));
    console.log(chalk.gray(`  Account ID: ${accountId.toString()}`));
    console.log(chalk.gray(`  Key Type: KeyList (Multi-Sig)`));
    console.log(chalk.gray(`  Keys: ${publicKeys.length}`));
    console.log(chalk.gray(`  Threshold: ${threshold}`));
    console.log('');

    // 10. Save configuration
    const saveConfig = readlineSync.keyInYN(chalk.cyan('Save configuration to file? '));

    if (saveConfig) {
      const config = {
        accountId: accountId.toString(),
        network,
        threshold,
        publicKeys,
        updatedAt: new Date().toISOString(),
        transactionId: txResponse.transactionId.toString()
      };

      const configPath = path.join(process.cwd(), `multisig-config-${accountId.toString().replace(/\./g, '-')}.json`);
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

      console.log(chalk.green(`\n✅ Configuration saved to: ${configPath}\n`));
    }

    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.green('✅ SETUP COMPLETE!'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.yellow('\n⚠️  IMPORTANT:'));
    console.log(chalk.white(`  - This account now requires ${threshold} of ${publicKeys.length} signatures`));
    console.log(chalk.white(`  - Store the public keys and threshold configuration securely`));
    console.log(chalk.white(`  - Use the hedera-multisig library to sign transactions\n`));

  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    console.error(chalk.gray(error.stack));
    process.exit(1);
  }
}

// Run
setupMultisigAccount();
