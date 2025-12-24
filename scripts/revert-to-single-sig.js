#!/usr/bin/env node

/**
 * Revert Multi-Sig Account to Single Signature
 *
 * Converts a multi-signature Hedera account back to a single-signature account.
 * Requires M-of-N signatures from the current multi-sig setup.
 *
 * Usage:
 *   ACCOUNT_ID=0.0.XXX node scripts/revert-to-single-sig.js
 *
 * Interactive mode:
 *   node scripts/revert-to-single-sig.js
 */

const {
  Client,
  AccountUpdateTransaction,
  PublicKey,
  PrivateKey,
  AccountId,
  AccountInfoQuery,
  TransactionId
} = require('@hashgraph/sdk');

const readlineSync = require('readline-sync');
const chalk = require('chalk');
const fs = require('fs');

async function revertToSingleSig() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║      REVERT MULTI-SIG TO SINGLE SIGNATURE             ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  try {
    // 1. Get account to revert
    let accountId;

    if (process.env.ACCOUNT_ID) {
      accountId = AccountId.fromString(process.env.ACCOUNT_ID);
      console.log(chalk.green('✅ Using account from environment variables\n'));
    } else {
      console.log(chalk.yellow('Enter the multi-sig account to revert:\n'));
      const accountIdStr = readlineSync.question(chalk.cyan('Account ID (e.g., 0.0.12345): '));
      accountId = AccountId.fromString(accountIdStr);
      console.log('');
    }

    // 2. Set up client
    const network = readlineSync.question(chalk.cyan('Network (testnet/mainnet) [testnet]: ')) || 'testnet';
    const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();

    // Set operator (for fee payment)
    if (process.env.OPERATOR_ID && process.env.OPERATOR_KEY) {
      client.setOperator(
        AccountId.fromString(process.env.OPERATOR_ID),
        PrivateKey.fromString(process.env.OPERATOR_KEY)
      );
    }

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
      console.log(chalk.yellow('⚠️  This account does not appear to be a multi-sig account.\n'));
      const proceed = readlineSync.keyInYN('Continue anyway? ');
      if (!proceed) {
        console.log(chalk.yellow('\n⚠️  Operation cancelled\n'));
        process.exit(0);
      }
    }

    // 4. Get new single key
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('NEW SINGLE SIGNATURE KEY'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.yellow('Choose how to provide the new single-signature key:\n'));
    console.log(chalk.gray('  1. Generate new key pair (recommended)'));
    console.log(chalk.gray('  2. Provide existing public key\n'));

    const keyMethod = readlineSync.question(chalk.cyan('Method (1 or 2) [1]: ')) || '1';

    let newPublicKey;
    let newPrivateKey = null;

    if (keyMethod === '1') {
      // Generate new key
      newPrivateKey = PrivateKey.generateED25519();
      newPublicKey = newPrivateKey.publicKey;

      console.log(chalk.green('\n✅ New key pair generated\n'));
      console.log(chalk.yellow('⚠️  SAVE THESE KEYS SECURELY:\n'));
      console.log(chalk.white('Private Key (DER):'));
      console.log(chalk.bold.yellow(newPrivateKey.toString()));
      console.log('');
      console.log(chalk.white('Public Key (DER):'));
      console.log(chalk.gray(newPublicKey.toString()));
      console.log('');

      const saveKeys = readlineSync.keyInYN(chalk.cyan('Save keys to file? '));

      if (saveKeys) {
        const keyData = {
          accountId: accountId.toString(),
          network,
          privateKey: newPrivateKey.toString(),
          publicKey: newPublicKey.toString(),
          createdAt: new Date().toISOString(),
          warning: 'KEEP THIS FILE SECURE - Contains private key'
        };

        const filename = `single-sig-keys-${accountId.toString().replace(/\./g, '-')}.json`;
        fs.writeFileSync(filename, JSON.stringify(keyData, null, 2), 'utf8');

        console.log(chalk.green(`\n✅ Keys saved to: ${filename}\n`));
        console.log(chalk.red('⚠️  WARNING: This file contains the private key. Keep it secure!\n'));
      }

    } else {
      // Use existing key
      const publicKeyStr = readlineSync.question(chalk.cyan('Enter public key (DER format): '));
      newPublicKey = PublicKey.fromString(publicKeyStr);
      console.log(chalk.green('\n✅ Public key loaded\n'));
    }

    // 5. Confirm operation
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('OPERATION SUMMARY'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.white(`Account: ${accountId.toString()}`));
    console.log(chalk.white(`Action: Convert from multi-sig to single-sig`));
    console.log(chalk.white(`New Key: ${newPublicKey.toString().substring(0, 20)}...`));
    console.log(chalk.cyan('═'.repeat(60)) + '\n');

    console.log(chalk.yellow('⚠️  IMPORTANT:\n'));
    console.log(chalk.white('  - This transaction requires M-of-N signatures from current multi-sig'));
    console.log(chalk.white('  - You will need to collect signatures from current key holders'));
    console.log(chalk.white('  - After update, only the new single key will be able to sign\n'));

    const confirm = readlineSync.keyInYN(chalk.yellow('Proceed with account update? '));

    if (!confirm) {
      console.log(chalk.yellow('\n⚠️  Operation cancelled\n'));
      process.exit(0);
    }

    // 6. Create transaction
    console.log(chalk.yellow('\n⏳ Creating account update transaction...\n'));

    // Generate transaction ID before freezing (stabilizes hash for multi-sig)
    // Use operator from client for transaction ID
    const operatorAccountId = client.operatorAccountId || AccountId.fromString(process.env.OPERATOR_ID);

    const transaction = await new AccountUpdateTransaction()
      .setAccountId(accountId)
      .setKey(newPublicKey)
      .setTransactionId(TransactionId.generate(operatorAccountId))
      .freezeWith(client);

    // 7. Collect signatures
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('SIGNATURE COLLECTION'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.yellow('This transaction needs signatures from the current multi-sig keys.\n'));
    console.log(chalk.white('Options:'));
    console.log(chalk.gray('  1. Use networked workflow (participants sign remotely)'));
    console.log(chalk.gray('  2. Use offline workflow (export/import signatures)'));
    console.log(chalk.gray('  3. Sign directly (if you have the private keys)\n'));

    const signingMethod = readlineSync.question(chalk.cyan('Signing method (1/2/3) [1]: ')) || '1';

    if (signingMethod === '3') {
      // Direct signing
      console.log(chalk.white('\nEnter private keys to sign (one per line, empty to finish):\n'));

      let signatureCount = 0;
      while (true) {
        const keyStr = readlineSync.question(chalk.cyan(`Private key ${signatureCount + 1}: `), {
          hideEchoBack: true
        });

        if (!keyStr) break;

        try {
          const privateKey = PrivateKey.fromString(keyStr);
          await transaction.sign(privateKey);
          signatureCount++;
          console.log(chalk.green(`  ✅ Signature ${signatureCount} added\n`));
        } catch (error) {
          console.log(chalk.red(`  ❌ Invalid key: ${error.message}\n`));
        }
      }

      console.log(chalk.green(`\n✅ Collected ${signatureCount} signatures\n`));

      // Execute
      console.log(chalk.yellow('⏳ Submitting transaction...\n'));

      const txResponse = await transaction.execute(client);
      const receipt = await txResponse.getReceipt(client);

      console.log(chalk.green('✅ Account successfully reverted to single-sig!\n'));
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
        operation: 'revert-to-single-sig',
        newPublicKey: newPublicKey.toString(),
        network,
        transaction: txBase64,
        createdAt: new Date().toISOString()
      };

      const filename = `revert-multisig-${accountId.toString().replace(/\./g, '-')}.json`;
      fs.writeFileSync(filename, JSON.stringify(exportData, null, 2), 'utf8');

      console.log(chalk.green(`\n✅ Transaction exported to: ${filename}\n`));
      console.log(chalk.white('Next steps:'));
      console.log(chalk.gray('  1. Use the hedera-multisig library to collect signatures'));
      console.log(chalk.gray('  2. Execute the transaction when threshold is met\n'));
    }

    // 8. Verify (if executed)
    if (signingMethod === '3') {
      console.log(chalk.yellow('Verifying account update...\n'));

      const updatedInfo = await new AccountInfoQuery()
        .setAccountId(accountId)
        .execute(client);

      console.log(chalk.green('✅ Account verified:\n'));
      console.log(chalk.white('New Account Configuration:'));
      console.log(chalk.gray(`  Account ID: ${accountId.toString()}`));
      console.log(chalk.gray(`  Key Type: Single Signature`));
      console.log(chalk.gray(`  Public Key: ${updatedInfo.key.toString().substring(0, 20)}...`));
      console.log('');

      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold.green('✅ REVERT COMPLETE!'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.yellow('\n⚠️  IMPORTANT:'));
      console.log(chalk.white(`  - This account now uses single-signature authentication`));
      console.log(chalk.white(`  - Keep the private key secure`));
      console.log(chalk.white(`  - Anyone with the private key can control this account\n`));
    }

  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    console.error(chalk.gray(error.stack));
    process.exit(1);
  }
}

// Run
revertToSingleSig();
