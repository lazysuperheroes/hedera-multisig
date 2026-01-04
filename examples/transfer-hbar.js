#!/usr/bin/env node

/**
 * Transfer HBAR with Multi-Sig Support
 *
 * Modern script for transferring HBAR with full multi-signature workflow integration.
 * Supports interactive, offline, and networked multi-sig coordination.
 *
 * Configuration:
 *   Create a .env file in the project root with:
 *     OPERATOR_ID=0.0.XXX        # Required: Account that pays fees
 *     OPERATOR_KEY=xxx           # Optional: Only needed for single-sig or if operator != sender
 *     ENVIRONMENT=TEST           # Optional: TEST or MAIN (default: TEST)
 *
 * Usage:
 *   # Interactive mode (uses .env file)
 *   node examples/transfer-hbar.js
 *
 *   # Command-line mode
 *   node examples/transfer-hbar.js --sender 0.0.123 --receiver 0.0.456 --amount 50
 *
 *   # With multi-sig (networked workflow)
 *   node examples/transfer-hbar.js --receiver 0.0.456 --amount 50 --multisig --workflow networked \
 *     --server ws://localhost:3000 --session <id> --pin <pin>
 *
 *   # With approval (allowance)
 *   node examples/transfer-hbar.js --receiver 0.0.456 --amount 50 --approval 0.0.789
 */

// Load environment variables from .env file
require('dotenv').config();

const fs = require('fs');
const path = require('path');

// Session file path for auto-discovery
const SESSION_FILE = path.join(process.cwd(), '.multisig-session.json');

/**
 * Try to load session details from auto-generated session file
 */
function loadSessionFile() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      // Check if session hasn't expired
      if (data.expiresAt && data.expiresAt > Date.now()) {
        return data;
      }
    }
  } catch (error) {
    // Ignore errors reading session file
  }
  return null;
}

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
const WebSocket = require('ws');
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
      console.log('  --server <url>     WebSocket server URL for networked workflow');
      console.log('  --session <id>     Session ID for networked workflow');
      console.log('  --pin <pin>        PIN for networked workflow');
      console.log('  --approval <id>    Spend from account via allowance');
      console.log('  --network <net>    Network: testnet, mainnet, previewnet, local (default: testnet)');
      console.log('  --help, -h         Show this help');
      console.log('');
      console.log('Environment Variables (can be set in .env file):');
      console.log('  OPERATOR_ID        Operator account ID (pays fees) - REQUIRED');
      console.log('  OPERATOR_KEY       Operator private key - OPTIONAL for multisig');
      console.log('                     (Only needed if operator differs from multisig account)');
      console.log('  ENVIRONMENT        Network: TEST, MAIN, PREVIEW, LOCAL (default: TEST)');
      console.log('  SESSION_SERVER     Default WebSocket server URL for networked workflow');
      console.log('  SESSION_ID         Default session ID for networked workflow');
      console.log('  SESSION_PIN        Default PIN for networked workflow');
      console.log('');
      console.log('Examples:');
      console.log('  # Interactive mode (uses .env file)');
      console.log('  node examples/transfer-hbar.js');
      console.log('');
      console.log('  # Command-line mode');
      console.log('  node examples/transfer-hbar.js --sender 0.0.123 --receiver 0.0.456 --amount 50');
      console.log('');
      console.log('  # With multi-sig (networked workflow - inject into existing session)');
      console.log('  node examples/transfer-hbar.js --receiver 0.0.456 --amount 1 --multisig --workflow networked \\');
      console.log('    --server ws://localhost:3000 --session <session-id> --pin <pin>');
      console.log('');
      process.exit(0);
    }

    // Get operator credentials
    // OPERATOR_ID is required (sets who pays fees / transaction ID)
    // OPERATOR_KEY is optional - only needed if operator is different from multisig account
    const operatorId = process.env.OPERATOR_ID ? AccountId.fromString(process.env.OPERATOR_ID) : null;
    const operatorKey = process.env.OPERATOR_KEY ? PrivateKey.fromString(process.env.OPERATOR_KEY) : null;

    if (!operatorId) {
      console.log(chalk.red('❌ Missing OPERATOR_ID environment variable\n'));
      console.log(chalk.white('Set it with:'));
      console.log(chalk.gray('  export OPERATOR_ID=0.0.XXX\n'));
      console.log(chalk.white('Note: OPERATOR_KEY is optional for multisig workflows.'));
      console.log(chalk.gray('      If the multisig account is the operator, signatures are'));
      console.log(chalk.gray('      collected via the signing session, not from OPERATOR_KEY.\n'));
      process.exit(1);
    }

    // Determine network (supports testnet, mainnet, previewnet, local)
    let network = getArg('network');
    if (!network) {
      const envNetwork = (process.env.ENVIRONMENT || 'TEST').toUpperCase();
      switch (envNetwork) {
        case 'MAIN': case 'MAINNET': network = 'mainnet'; break;
        case 'PREVIEW': case 'PREVIEWNET': network = 'previewnet'; break;
        case 'LOCAL': case 'LOCALHOST': network = 'local'; break;
        default: network = 'testnet';
      }
    }

    let client;
    switch (network) {
      case 'mainnet': client = Client.forMainnet(); break;
      case 'previewnet': client = Client.forPreviewnet(); break;
      case 'local': client = Client.forLocalNode(); break;
      default: client = Client.forTestnet();
    }

    // Only set operator if we have the key (for non-multisig or when operator != sender)
    if (operatorKey) {
      client.setOperator(operatorId, operatorKey);
    }

    console.log(chalk.green(`✅ Connected to Hedera ${network}\n`));
    console.log(chalk.white('Operator Configuration:'));
    console.log(chalk.gray(`  Operator ID: ${operatorId.toString()}`));
    console.log(chalk.gray(`  Operator Key: ${operatorKey ? 'Provided' : 'Not provided (multisig mode)'}`));
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
        // Support CLI args, environment variables, and auto-detected session file
        const sessionFile = loadSessionFile();
        const serverUrl = getArg('server') || process.env.SESSION_SERVER || sessionFile?.serverUrl;
        const sessionId = getArg('session') || process.env.SESSION_ID || sessionFile?.sessionId;
        const pin = getArg('pin') || process.env.SESSION_PIN || sessionFile?.pin;

        // Show if using auto-detected session
        if (sessionFile && !getArg('server') && !process.env.SESSION_SERVER) {
          console.log(chalk.green('✅ Auto-detected active session from .multisig-session.json\n'));
        }

        if (!serverUrl || !sessionId || !pin) {
          console.log(chalk.yellow('📡 Networked Workflow Instructions:\n'));
          console.log(chalk.white('1. Start coordinator session:'));
          console.log(chalk.gray('   npm run multisig-server -- -t <threshold> -k "key1,key2,key3"\n'));
          console.log(chalk.white('2. Participants connect via dApp or CLI\n'));
          console.log(chalk.white('3. Then re-run this command with session details:'));
          console.log(chalk.gray(`   node examples/transfer-hbar.js --receiver ${receiver} --amount ${amount} \\`));
          console.log(chalk.gray('     --multisig --workflow networked --server <url> --session <id> --pin <pin>\n'));

          // Export transaction for reference
          const txBytes = transaction.freezeWith(client).toBytes();
          const txBase64 = Buffer.from(txBytes).toString('base64');
          console.log(chalk.green('Transaction bytes (for reference):'));
          console.log(chalk.gray(txBase64.substring(0, 80) + '...\n'));
        } else {
          // Connect to existing session and inject transaction
          console.log(chalk.yellow('📡 Connecting to session...\n'));

          const frozenTx = transaction.freezeWith(client);

          await new Promise((resolve, reject) => {
            const ws = new WebSocket(serverUrl);

            ws.on('open', () => {
              console.log(chalk.green('✅ Connected to server'));
              // Authenticate as coordinator
              ws.send(JSON.stringify({
                type: 'AUTH',
                payload: {
                  sessionId,
                  pin,
                  role: 'coordinator'
                }
              }));
            });

            ws.on('message', async (data) => {
              const message = JSON.parse(data.toString());

              switch (message.type) {
                case 'AUTH_SUCCESS':
                  console.log(chalk.green('✅ Authenticated as coordinator'));
                  console.log(chalk.yellow('\n⏳ Injecting transaction...\n'));

                  // Extract expiration info from transaction
                  const txIdStr = frozenTx.transactionId?.toString() || '';
                  const txIdMatch = txIdStr.match(/@(\d+)\./);
                  const validStartTimestamp = txIdMatch ? parseInt(txIdMatch[1], 10) : Math.floor(Date.now() / 1000);
                  const validDuration = frozenTx.transactionValidDuration?.seconds || 120;
                  const expiresAt = validStartTimestamp + validDuration;

                  // Inject transaction
                  const txBytes = frozenTx.toBytes();
                  ws.send(JSON.stringify({
                    type: 'TRANSACTION_INJECT',
                    payload: {
                      frozenTransaction: Buffer.from(txBytes).toString('base64'),
                      txDetails: {
                        type: 'TransferTransaction',
                        sender: sender.toString(),
                        receiver: receiver.toString(),
                        amount: amount.toString(),
                        memo: memo || null,
                        validStartTimestamp,
                        transactionValidDuration: validDuration,
                        expiresAt
                      },
                      metadata: {
                        description: `Transfer ${amount} to ${receiver}`,
                        type: 'HBAR Transfer',
                        amount: { value: amount.toString(), unit: 'HBAR' },
                        recipient: { address: receiver.toString() }
                      }
                    }
                  }));

                  console.log(chalk.green('✅ Transaction injected!'));
                  console.log(chalk.yellow(`⏱️  Transaction expires in ${validDuration}s (at ${new Date(expiresAt * 1000).toLocaleTimeString()})`));
                  console.log(chalk.white('\nWaiting for signatures from participants...'));
                  console.log(chalk.gray('(Press Ctrl+C to exit - transaction will remain in session)\n'));
                  break;

                case 'AUTH_FAILED':
                  console.log(chalk.red(`❌ Authentication failed: ${message.payload.message}`));
                  ws.close();
                  reject(new Error(message.payload.message));
                  break;

                case 'SIGNATURE_RECEIVED':
                  console.log(chalk.green(`✅ Signature received (${message.payload.stats.signaturesCollected}/${message.payload.stats.signaturesRequired})`));
                  break;

                case 'THRESHOLD_MET':
                  console.log(chalk.bold.green('\n🎉 Threshold met! Ready to execute.\n'));
                  const shouldExecute = readlineSync.keyInYN(chalk.yellow('Execute transaction now? '));
                  if (shouldExecute) {
                    ws.send(JSON.stringify({
                      type: 'EXECUTE_TRANSACTION',
                      payload: { sessionId }
                    }));
                  }
                  break;

                case 'TRANSACTION_EXECUTED':
                  console.log(chalk.bold.green('\n✅ TRANSACTION EXECUTED SUCCESSFULLY!\n'));
                  console.log(chalk.white('Transaction ID: ') + chalk.yellow(message.payload.transactionId));
                  console.log(chalk.white('Status: ') + chalk.green(message.payload.status));
                  console.log(chalk.white(`\nView on HashScan: https://hashscan.io/${network}/transaction/${message.payload.transactionId}\n`));
                  ws.close();
                  resolve();
                  break;

                case 'EXECUTION_FAILED':
                  console.log(chalk.red(`\n❌ Execution failed: ${message.payload.message}\n`));
                  ws.close();
                  reject(new Error(message.payload.message));
                  break;

                case 'TRANSACTION_REJECTED':
                  console.log(chalk.red(`\n❌ Transaction rejected by participant ${message.payload.participantId}`));
                  console.log(chalk.yellow(`   Reason: ${message.payload.reason}\n`));
                  ws.close();
                  reject(new Error(`Transaction rejected: ${message.payload.reason}`));
                  break;

                case 'TRANSACTION_EXPIRED':
                  console.log(chalk.red(`\n⏱️  Transaction expired!`));
                  console.log(chalk.yellow(`   The transaction has timed out and can no longer be signed.\n`));
                  ws.close();
                  reject(new Error('Transaction expired'));
                  break;

                case 'ERROR':
                  console.log(chalk.red(`❌ Error: ${message.payload.message}`));
                  break;
              }
            });

            ws.on('error', (error) => {
              console.log(chalk.red(`❌ WebSocket error: ${error.message}`));
              reject(error);
            });

            ws.on('close', () => {
              console.log(chalk.gray('Disconnected from server'));
            });
          });
        }

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
      if (!operatorKey) {
        console.log(chalk.red('❌ OPERATOR_KEY required for single-signature transactions\n'));
        console.log(chalk.gray('For multisig transactions, use --multisig flag\n'));
        process.exit(1);
      }

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
    // User-facing errors (rejections, auth failures) - don't show stack trace
    if (error.message.includes('rejected') || error.message.includes('Authentication failed')) {
      console.error(chalk.red(`\n❌ ${error.message}\n`));
    } else {
      // Unexpected errors - show full details for debugging
      console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
      if (error.stack && process.env.DEBUG) {
        console.error(chalk.gray(error.stack));
      }
    }
    process.exit(1);
  }
}

main();
