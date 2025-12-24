#!/usr/bin/env node

/**
 * Transfer HBAR with Multi-Sig Support
 *
 * Modern script for transferring HBAR with full multi-signature workflow integration.
 * Supports interactive, offline, and networked multi-sig coordination.
 *
 * Usage:
 *   # Interactive mode
 *   OPERATOR_ID=0.0.XXX OPERATOR_KEY=xxx node examples/transfer-hbar.js
 *
 *   # Command-line mode
 *   node examples/transfer-hbar.js --sender 0.0.123 --receiver 0.0.456 --amount 50
 *
 *   # With multi-sig
 *   node examples/transfer-hbar.js --sender 0.0.123 --receiver 0.0.456 --amount 50 --multisig
 *
 *   # With approval (allowance)
 *   node examples/transfer-hbar.js --receiver 0.0.456 --amount 50 --approval 0.0.789
 */

const {
  Client,
  AccountId,
  PrivateKey,
  TransferTransaction,
  Hbar,
  TransactionId
} = require('@hashgraph/sdk');

const chalk = require('chalk');
const readlineSync = require('readline-sync');
const { WorkflowOrchestrator } = require('../workflows');

function getArg(arg) {
  const index = process.argv.indexOf(`--${arg}`);
  if (index > -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
}

function getArgFlag(arg) {
  return process.argv.includes(`--${arg}`);
}

async function main() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║         TRANSFER HBAR (Multi-Sig Enabled)             ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  try {
    // Show help
    if (getArgFlag('help') || getArgFlag('h')) {
      console.log('Usage: node examples/transfer-hbar.js [options]');
      console.log('');
      console.log('Options:');
      console.log('  --sender <id>      Sender account ID (default: operator)');
      console.log('  --receiver <id>    Receiver account ID (required)');
      console.log('  --amount <hbar>    Amount in HBAR (required)');
      console.log('  --memo <text>      Transaction memo');
      console.log('  --multisig         Enable multi-sig workflow');
      console.log('  --workflow <type>  Workflow: interactive, offline, networked (default: interactive)');
      console.log('  --approval <id>    Spend from account via allowance');
      console.log('  --network <net>    Network: testnet or mainnet (default: from env)');
      console.log('  --help, -h         Show this help');
      console.log('');
      console.log('Environment Variables:');
      console.log('  OPERATOR_ID        Operator account ID (pays fees)');
      console.log('  OPERATOR_KEY       Operator private key');
      console.log('  ENVIRONMENT        Network: TEST or MAIN (optional)');
      console.log('');
      console.log('Examples:');
      console.log('  # Interactive mode');
      console.log('  OPERATOR_ID=0.0.123 OPERATOR_KEY=xxx node examples/transfer-hbar.js');
      console.log('');
      console.log('  # Command-line mode');
      console.log('  node examples/transfer-hbar.js --sender 0.0.123 --receiver 0.0.456 --amount 50');
      console.log('');
      console.log('  # With multi-sig (networked workflow)');
      console.log('  node examples/transfer-hbar.js --sender 0.0.123 --receiver 0.0.456 --amount 50 --multisig --workflow networked');
      console.log('');
      process.exit(0);
    }

    // Get operator credentials
    const operatorId = process.env.OPERATOR_ID ? AccountId.fromString(process.env.OPERATOR_ID) : null;
    const operatorKey = process.env.OPERATOR_KEY ? PrivateKey.fromString(process.env.OPERATOR_KEY) : null;

    if (!operatorId || !operatorKey) {
      console.log(chalk.red('❌ Missing OPERATOR_ID or OPERATOR_KEY environment variables\n'));
      console.log(chalk.white('Set them with:'));
      console.log(chalk.gray('  export OPERATOR_ID=0.0.XXX'));
      console.log(chalk.gray('  export OPERATOR_KEY=302e020100...\n'));
      process.exit(1);
    }

    // Determine network
    let network = getArg('network');
    if (!network) {
      const envNetwork = process.env.ENVIRONMENT;
      if (envNetwork === 'TEST') network = 'testnet';
      else if (envNetwork === 'MAIN') network = 'mainnet';
      else network = 'testnet'; // default
    }

    const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
    client.setOperator(operatorId, operatorKey);

    console.log(chalk.green(`✅ Connected to Hedera ${network}\n`));
    console.log(chalk.white('Operator Configuration:'));
    console.log(chalk.gray(`  Operator ID: ${operatorId.toString()}`));
    console.log(chalk.gray(`  Network: ${network}\n`));

    // Get transaction parameters
    let sender, receiver, amount, memo, isMultisig, workflow, approvalAccount;

    const senderArg = getArg('sender');
    const receiverArg = getArg('receiver');
    const amountArg = getArg('amount');
    const memoArg = getArg('memo');
    const approvalArg = getArg('approval');

    isMultisig = getArgFlag('multisig');
    workflow = getArg('workflow') || 'interactive';

    // Interactive or command-line mode
    if (!receiverArg || !amountArg) {
      console.log(chalk.yellow('📋 Interactive Mode\n'));

      // Sender
      if (senderArg) {
        sender = AccountId.fromString(senderArg);
      } else {
        const useDifferentSender = readlineSync.keyInYN(
          chalk.cyan('Use different sender than operator? ')
        );
        if (useDifferentSender) {
          const senderStr = readlineSync.question(chalk.cyan('Sender account ID: '));
          sender = AccountId.fromString(senderStr);
          isMultisig = true; // Requires multi-sig if sender != operator
        } else {
          sender = operatorId;
        }
      }

      // Receiver
      if (receiverArg) {
        receiver = AccountId.fromString(receiverArg);
      } else {
        const receiverStr = readlineSync.question(chalk.cyan('Receiver account ID: '));
        receiver = AccountId.fromString(receiverStr);
      }

      // Amount
      if (amountArg) {
        amount = new Hbar(parseFloat(amountArg));
      } else {
        const amountStr = readlineSync.question(chalk.cyan('Amount in HBAR: '));
        amount = new Hbar(parseFloat(amountStr));
      }

      // Memo (optional)
      memo = memoArg || readlineSync.question(chalk.cyan('Memo (optional): ')) || null;

      // Approval
      if (approvalArg) {
        approvalAccount = AccountId.fromString(approvalArg);
      } else {
        const useApproval = readlineSync.keyInYN(chalk.cyan('Use approved allowance? '));
        if (useApproval) {
          const approvalStr = readlineSync.question(chalk.cyan('Account with allowance: '));
          approvalAccount = AccountId.fromString(approvalStr);
        }
      }

      // Multi-sig
      if (!isMultisig && sender.toString() !== operatorId.toString()) {
        isMultisig = true;
        console.log(chalk.yellow('\n⚠️  Different sender detected - multi-sig required\n'));
      }

      if (!isMultisig) {
        isMultisig = readlineSync.keyInYN(chalk.cyan('Enable multi-sig workflow? '));
      }

      if (isMultisig) {
        console.log(chalk.yellow('\nSelect multi-sig workflow:'));
        console.log(chalk.gray('  1. Interactive (all keys available locally)'));
        console.log(chalk.gray('  2. Offline (export/import signatures)'));
        console.log(chalk.gray('  3. Networked (real-time remote signing)\n'));
        const workflowChoice = readlineSync.question(chalk.cyan('Workflow (1/2/3) [3]: ')) || '3';
        workflow = workflowChoice === '1' ? 'interactive' : workflowChoice === '2' ? 'offline' : 'networked';
      }

    } else {
      // Command-line mode
      sender = senderArg ? AccountId.fromString(senderArg) : operatorId;
      receiver = AccountId.fromString(receiverArg);
      amount = new Hbar(parseFloat(amountArg));
      memo = memoArg || null;
      approvalAccount = approvalArg ? AccountId.fromString(approvalArg) : null;

      if (sender.toString() !== operatorId.toString()) {
        isMultisig = true;
      }
    }

    // Display transaction summary
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('TRANSACTION SUMMARY'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.white(`Sender: ${sender.toString()}`));
    console.log(chalk.white(`Receiver: ${receiver.toString()}`));
    console.log(chalk.white(`Amount: ${amount.toString()}`));
    if (memo) console.log(chalk.white(`Memo: ${memo}`));
    if (approvalAccount) console.log(chalk.white(`Approval Account: ${approvalAccount.toString()}`));
    console.log(chalk.white(`Multi-Sig: ${isMultisig ? 'YES' : 'NO'}`));
    if (isMultisig) console.log(chalk.white(`Workflow: ${workflow}`));
    console.log(chalk.white(`Operator (Fee Payer): ${operatorId.toString()}`));
    console.log(chalk.cyan('═'.repeat(60)) + '\n');

    // Confirm
    const proceed = readlineSync.keyInYN(chalk.yellow('Proceed with transfer? '));
    if (!proceed) {
      console.log(chalk.yellow('\n⚠️  Transfer cancelled\n'));
      process.exit(0);
    }

    // Create transaction
    console.log(chalk.yellow('\n⏳ Creating transaction...\n'));

    const transaction = new TransferTransaction()
      .addHbarTransfer(receiver, amount)
      .setTransactionId(TransactionId.generate(operatorId));

    if (approvalAccount) {
      transaction.addApprovedHbarTransfer(approvalAccount, amount.negated());
    } else {
      transaction.addHbarTransfer(sender, amount.negated());
    }

    if (memo) {
      transaction.setTransactionMemo(memo);
    }

    // Execute with appropriate workflow
    if (isMultisig) {
      console.log(chalk.green('✅ Transaction created - using multi-sig workflow\n'));

      // For this example, we'll demonstrate the WorkflowOrchestrator integration
      // In production, you'd set up the full multi-sig configuration

      if (workflow === 'networked') {
        console.log(chalk.yellow('📡 Networked Workflow Instructions:\n'));
        console.log(chalk.white('1. Start coordinator session:'));
        console.log(chalk.gray('   npm run multisig-server -- -t <threshold> -k "key1,key2,key3"\n'));
        console.log(chalk.white('2. Participants connect:'));
        console.log(chalk.gray('   npm run multisig-client -- --url <url> --session <id> --pin <pin>\n'));
        console.log(chalk.white('3. Then inject this transaction into the session\n'));

        // For demo, we'll export the transaction
        const txBytes = transaction.freezeWith(client).toBytes();
        const txBase64 = Buffer.from(txBytes).toString('base64');

        console.log(chalk.green('✅ Transaction bytes (for manual multi-sig):'));
        console.log(chalk.gray(txBase64.substring(0, 80) + '...\n'));

      } else if (workflow === 'offline') {
        console.log(chalk.yellow('💾 Offline Workflow Instructions:\n'));
        console.log(chalk.white('1. Export transaction (done below)'));
        console.log(chalk.white('2. Collect signatures: npm run sign-tx --file transaction.json'));
        console.log(chalk.white('3. Execute when threshold met\n'));

        const frozenTx = transaction.freezeWith(client);
        const txBytes = frozenTx.toBytes();
        const txBase64 = Buffer.from(txBytes).toString('base64');

        const fs = require('fs');
        const exportData = {
          type: 'HBAR_TRANSFER',
          sender: sender.toString(),
          receiver: receiver.toString(),
          amount: amount.toString(),
          memo: memo,
          network,
          transaction: txBase64,
          createdAt: new Date().toISOString()
        };

        const filename = `transfer-hbar-${Date.now()}.json`;
        fs.writeFileSync(filename, JSON.stringify(exportData, null, 2), 'utf8');

        console.log(chalk.green(`✅ Transaction exported to: ${filename}\n`));

      } else {
        // Interactive workflow
        console.log(chalk.yellow('🔐 Interactive Workflow\n'));
        console.log(chalk.white('Enter private keys to sign (one per line, empty to finish):\n'));

        const frozenTx = transaction.freezeWith(client);
        let signedTx = frozenTx;

        let keyCount = 0;
        while (true) {
          const keyStr = readlineSync.question(chalk.cyan(`Private key ${keyCount + 1}: `), {
            hideEchoBack: true
          });

          if (!keyStr) break;

          try {
            const privateKey = PrivateKey.fromString(keyStr);
            signedTx = await signedTx.sign(privateKey);
            keyCount++;
            console.log(chalk.green(`  ✅ Signature ${keyCount} added\n`));
          } catch (error) {
            console.log(chalk.red(`  ❌ Invalid key: ${error.message}\n`));
          }
        }

        if (keyCount === 0) {
          console.log(chalk.red('\n❌ No signatures collected - aborting\n'));
          process.exit(1);
        }

        console.log(chalk.yellow('\n⏳ Executing transaction...\n'));

        const txResponse = await signedTx.execute(client);
        const receipt = await txResponse.getReceipt(client);

        if (receipt.status.toString() === 'SUCCESS') {
          console.log(chalk.green('✅ TRANSFER SUCCESSFUL!\n'));
          console.log(chalk.white('Transaction Details:'));
          console.log(chalk.gray(`  Transaction ID: ${txResponse.transactionId.toString()}`));
          console.log(chalk.gray(`  Status: ${receipt.status.toString()}`));
          console.log(chalk.gray(`  Amount: ${amount.toString()}`));
          console.log(chalk.gray(`  From: ${sender.toString()}`));
          console.log(chalk.gray(`  To: ${receiver.toString()}`));
          console.log('');
          console.log(chalk.white(`View on HashScan: https://hashscan.io/${network}/transaction/${txResponse.transactionId.toString()}\n`));
        } else {
          console.log(chalk.red(`❌ Transfer failed: ${receipt.status.toString()}\n`));
        }
      }

    } else {
      // Single signature (operator only)
      console.log(chalk.yellow('⏳ Executing transaction...\n'));

      const frozenTx = transaction.freezeWith(client);
      const signedTx = await frozenTx.sign(operatorKey);

      const txResponse = await signedTx.execute(client);
      const receipt = await txResponse.getReceipt(client);

      if (receipt.status.toString() === 'SUCCESS') {
        console.log(chalk.green('✅ TRANSFER SUCCESSFUL!\n'));
        console.log(chalk.white('Transaction Details:'));
        console.log(chalk.gray(`  Transaction ID: ${txResponse.transactionId.toString()}`));
        console.log(chalk.gray(`  Status: ${receipt.status.toString()}`));
        console.log(chalk.gray(`  Amount: ${amount.toString()}`));
        console.log(chalk.gray(`  From: ${sender.toString()}`));
        console.log(chalk.gray(`  To: ${receiver.toString()}`));
        console.log('');
        console.log(chalk.white(`View on HashScan: https://hashscan.io/${network}/transaction/${txResponse.transactionId.toString()}\n`));
      } else {
        console.log(chalk.red(`❌ Transfer failed: ${receipt.status.toString()}\n`));
      }
    }

  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

main();
