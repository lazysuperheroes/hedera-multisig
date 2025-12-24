#!/usr/bin/env node

/**
 * Update Multi-Signature Account Keys
 *
 * Updates the keys on a multi-signature account (key rotation).
 * This is a multi-sig to multi-sig operation requiring signatures
 * from the CURRENT key holders.
 *
 * Usage:
 *   # Interactive mode
 *   node scripts/update-multisig-keys.js
 *
 *   # With environment variables
 *   ACCOUNT_ID=0.0.XXX OPERATOR_ID=0.0.YYY OPERATOR_KEY=xxx node scripts/update-multisig-keys.js
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

async function updateMultisigKeys() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║      UPDATE MULTI-SIG ACCOUNT KEYS (ROTATION)         ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  try {
    // 1. Get account to update
    let accountId;

    if (process.env.ACCOUNT_ID) {
      accountId = AccountId.fromString(process.env.ACCOUNT_ID);
      console.log(chalk.green('✅ Using account from environment variables\n'));
    } else {
      console.log(chalk.yellow('Enter the multi-sig account to update:\n'));
      const accountIdStr = readlineSync.question(chalk.cyan('Account ID (e.g., 0.0.12345): '));
      accountId = AccountId.fromString(accountIdStr);
      console.log('');
    }

    // 2. Set up client
    const network = readlineSync.question(chalk.cyan('Network (testnet/mainnet) [testnet]: ')) || 'testnet';
    const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();

    // Set operator (for fee payment - does NOT need to be a key holder)
    let operatorId, operatorKey;

    if (process.env.OPERATOR_ID && process.env.OPERATOR_KEY) {
      operatorId = AccountId.fromString(process.env.OPERATOR_ID);
      operatorKey = PrivateKey.fromString(process.env.OPERATOR_KEY);
      console.log(chalk.green('✅ Using operator from environment variables\n'));
    } else {
      console.log(chalk.yellow('Enter operator account (pays fees, does NOT need to be key holder):\n'));
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

    // 3. Get current account info
    console.log(chalk.yellow('Fetching current account information...\n'));

    const accountInfo = await new AccountInfoQuery()
      .setAccountId(accountId)
      .execute(client);

    console.log(chalk.white('Current Account Information:'));
    console.log(chalk.gray(`  Account ID: ${accountId.toString()}`));
    console.log(chalk.gray(`  Balance: ${accountInfo.balance.toString()}`));
    console.log(chalk.gray(`  Current Key Type: ${accountInfo.key.constructor.name}`));
    console.log('');

    // Check if it's actually a multi-sig
    if (accountInfo.key.constructor.name !== 'KeyList') {
      console.log(chalk.yellow('⚠️  This account is not currently a multi-sig account.'));
      console.log(chalk.yellow('    Use setup-multisig-account.js to convert from single-sig.\n'));
      const proceed = readlineSync.keyInYN('Continue anyway? ');
      if (!proceed) {
        console.log(chalk.yellow('\n⚠️  Operation cancelled\n'));
        process.exit(0);
      }
    } else {
      // Display current multi-sig config
      const currentKeyList = accountInfo.key;
      console.log(chalk.white('Current Multi-Sig Configuration:'));
      console.log(chalk.gray(`  Threshold: ${currentKeyList.threshold}`));
      console.log(chalk.gray(`  Keys: ${currentKeyList._keys.length}`));
      currentKeyList._keys.forEach((key, idx) => {
        console.log(chalk.gray(`    ${idx + 1}. ${key.toString().substring(0, 20)}...`));
      });
      console.log('');
    }

    // 4. Collect NEW public keys
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('NEW MULTI-SIG CONFIGURATION'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.yellow('Enter the NEW public keys for the updated multi-sig.\n'));
    console.log(chalk.gray('You can:'));
    console.log(chalk.gray('  1. Enter keys manually (one per line)'));
    console.log(chalk.gray('  2. Load from a file (public-keys.txt)\n'));

    const loadMethod = readlineSync.question(chalk.cyan('Load method (manual/file) [manual]: ')) || 'manual';

    let newPublicKeys = [];

    if (loadMethod === 'file') {
      const filePath = readlineSync.question(chalk.cyan('File path [./public-keys.txt]: ')) || './public-keys.txt';

      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        newPublicKeys = fileContent
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#') && !line.startsWith('Public Keys:'));

        console.log(chalk.green(`\n✅ Loaded ${newPublicKeys.length} keys from file\n`));
      } else {
        console.log(chalk.red(`\n❌ File not found: ${filePath}\n`));
        process.exit(1);
      }
    } else {
      console.log(chalk.white('Enter NEW public keys (one per line, empty line to finish):\n'));

      let index = 1;
      while (true) {
        const key = readlineSync.question(chalk.cyan(`Key ${index}: `));
        if (!key) break;

        newPublicKeys.push(key.trim());
        index++;
      }

      console.log('');
    }

    if (newPublicKeys.length === 0) {
      console.log(chalk.red('❌ No public keys provided. Exiting.\n'));
      process.exit(1);
    }

    console.log(chalk.green(`✅ Collected ${newPublicKeys.length} new public keys\n`));

    // Display keys
    console.log(chalk.white('New Public Keys:'));
    newPublicKeys.forEach((key, idx) => {
      console.log(chalk.gray(`  ${idx + 1}. ${key.substring(0, 20)}...`));
    });
    console.log('');

    // 5. Set NEW threshold
    const defaultThreshold = Math.ceil(newPublicKeys.length / 2);
    const thresholdStr = readlineSync.question(
      chalk.cyan(`New signature threshold (1-${newPublicKeys.length}) [${defaultThreshold}]: `)
    );
    const newThreshold = thresholdStr ? parseInt(thresholdStr) : defaultThreshold;

    if (newThreshold < 1 || newThreshold > newPublicKeys.length) {
      console.log(chalk.red(`\n❌ Invalid threshold. Must be between 1 and ${newPublicKeys.length}\n`));
      process.exit(1);
    }

    console.log(chalk.green(`\n✅ New threshold set to ${newThreshold} of ${newPublicKeys.length}\n`));

    // 6. Create NEW KeyList
    const newKeyList = new KeyList(
      newPublicKeys.map(key => PublicKey.fromString(key)),
      newThreshold
    );

    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('KEY ROTATION SUMMARY'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.white(`Account: ${accountId.toString()}`));
    console.log(chalk.white(`Action: Rotate multi-sig keys`));
    console.log(chalk.white(`New Keys: ${newPublicKeys.length}`));
    console.log(chalk.white(`New Threshold: ${newThreshold} of ${newPublicKeys.length} signatures required`));
    console.log(chalk.cyan('═'.repeat(60)) + '\n');

    // 7. Confirm operation
    console.log(chalk.yellow('⚠️  IMPORTANT:\n'));
    console.log(chalk.white('  - This transaction requires M-of-N signatures from CURRENT key holders'));
    console.log(chalk.white('  - You will need to collect signatures from current multi-sig participants'));
    console.log(chalk.white('  - After update, only the NEW keys will be able to sign\n'));

    const confirm = readlineSync.keyInYN(chalk.yellow('Proceed with key rotation? '));

    if (!confirm) {
      console.log(chalk.yellow('\n⚠️  Operation cancelled\n'));
      process.exit(0);
    }

    // 8. Create transaction
    console.log(chalk.yellow('\n⏳ Creating account update transaction...\n'));

    // Generate transaction ID before freezing (stabilizes hash for multi-sig)
    const transaction = await new AccountUpdateTransaction()
      .setAccountId(accountId)
      .setKey(newKeyList)
      .setTransactionId(TransactionId.generate(operatorId))
      .freezeWith(client);

    // 9. Collect signatures from CURRENT key holders
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('SIGNATURE COLLECTION FROM CURRENT KEY HOLDERS'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.yellow('This transaction needs signatures from the CURRENT multi-sig keys.\n'));
    console.log(chalk.white('Options:'));
    console.log(chalk.gray('  1. Use networked workflow (participants sign remotely)'));
    console.log(chalk.gray('  2. Use offline workflow (export/import signatures)'));
    console.log(chalk.gray('  3. Sign directly (if you have the current private keys)\\n'));

    const signingMethod = readlineSync.question(chalk.cyan('Signing method (1/2/3) [1]: ')) || '1';

    if (signingMethod === '3') {
      // Direct signing with CURRENT keys
      console.log(chalk.white('\\nEnter CURRENT private keys to sign (one per line, empty to finish):\\n'));

      let signatureCount = 0;
      while (true) {
        const keyStr = readlineSync.question(chalk.cyan(`Current private key ${signatureCount + 1}: `), {
          hideEchoBack: true
        });

        if (!keyStr) break;

        try {
          const privateKey = PrivateKey.fromString(keyStr);
          await transaction.sign(privateKey);
          signatureCount++;
          console.log(chalk.green(`  ✅ Signature ${signatureCount} added\\n`));
        } catch (error) {
          console.log(chalk.red(`  ❌ Invalid key: ${error.message}\\n`));
        }
      }

      console.log(chalk.green(`\\n✅ Collected ${signatureCount} signatures\\n`));

      // Execute
      console.log(chalk.yellow('⏳ Submitting transaction...\\n'));

      const txResponse = await transaction.execute(client);
      const receipt = await txResponse.getReceipt(client);

      console.log(chalk.green('✅ Account keys successfully rotated!\\n'));
      console.log(chalk.white('Transaction Details:'));
      console.log(chalk.gray(`  Transaction ID: ${txResponse.transactionId.toString()}`));
      console.log(chalk.gray(`  Status: ${receipt.status.toString()}`));
      console.log('');

    } else {
      // Export for signature collection
      const txBytes = transaction.toBytes();
      const txBase64 = Buffer.from(txBytes).toString('base64');

      const exportData = {
        accountId: accountId.toString(),
        operation: 'update-multisig-keys',
        newThreshold: newThreshold,
        newPublicKeys: newPublicKeys,
        network,
        transaction: txBase64,
        createdAt: new Date().toISOString()
      };

      const filename = `update-keys-${accountId.toString().replace(/\\./g, '-')}.json`;
      fs.writeFileSync(filename, JSON.stringify(exportData, null, 2), 'utf8');

      console.log(chalk.green(`\\n✅ Transaction exported to: ${filename}\\n`));
      console.log(chalk.white('Next steps:'));
      console.log(chalk.gray('  1. Use the hedera-multisig library to collect signatures'));
      console.log(chalk.gray('  2. Use sign-transaction.js for offline signing'));
      console.log(chalk.gray('  3. Execute the transaction when threshold is met\\n'));
    }

    // 10. Verify (if executed)
    if (signingMethod === '3') {
      console.log(chalk.yellow('Verifying account update...\\n'));

      const updatedInfo = await new AccountInfoQuery()
        .setAccountId(accountId)
        .execute(client);

      console.log(chalk.green('✅ Account verified:\\n'));
      console.log(chalk.white('Updated Account Configuration:'));
      console.log(chalk.gray(`  Account ID: ${accountId.toString()}`));
      console.log(chalk.gray(`  Key Type: KeyList (Multi-Sig)`));
      console.log(chalk.gray(`  Keys: ${newPublicKeys.length}`));
      console.log(chalk.gray(`  Threshold: ${newThreshold}`));
      console.log('');

      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold.green('✅ KEY ROTATION COMPLETE!'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.yellow('\\n⚠️  IMPORTANT:'));
      console.log(chalk.white(`  - This account now uses the NEW key configuration`));
      console.log(chalk.white(`  - OLD keys can no longer sign transactions`));
      console.log(chalk.white(`  - Store the NEW public keys and threshold securely`));
      console.log(chalk.white(`  - Requires ${newThreshold} of ${newPublicKeys.length} signatures going forward\\n`));

      // Save configuration
      const saveConfig = readlineSync.keyInYN(chalk.cyan('Save new configuration to file? '));

      if (saveConfig) {
        const config = {
          accountId: accountId.toString(),
          network,
          threshold: newThreshold,
          publicKeys: newPublicKeys,
          updatedAt: new Date().toISOString(),
          transactionId: txResponse.transactionId.toString()
        };

        const configPath = path.join(process.cwd(), `multisig-config-${accountId.toString().replace(/\\./g, '-')}.json`);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

        console.log(chalk.green(`\\n✅ Configuration saved to: ${configPath}\\n`));
      }
    }

  } catch (error) {
    console.error(chalk.red(`\\n❌ Error: ${error.message}\\n`));
    console.error(chalk.gray(error.stack));
    process.exit(1);
  }
}

// Run
updateMultisigKeys();
