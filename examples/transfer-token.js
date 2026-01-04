#!/usr/bin/env node

/**
 * Transfer Fungible Tokens with Multi-Sig Support
 *
 * Modern script for transferring fungible tokens with:
 * - Automatic decimal fetching from mirror nodes
 * - Full multi-signature workflow integration
 * - Token metadata validation
 * - Support for interactive, offline, and networked workflows
 *
 * Configuration:
 *   Create a .env file in the project root with:
 *     OPERATOR_ID=0.0.XXX        # Required: Account that pays fees
 *     OPERATOR_KEY=xxx           # Optional: Only needed for single-sig or if operator != sender
 *     ENVIRONMENT=TEST           # Optional: TEST or MAIN (default: TEST)
 *
 * Usage:
 *   # Interactive mode (uses .env file)
 *   node examples/transfer-token.js
 *
 *   # Command-line mode
 *   node examples/transfer-token.js --token 0.0.789 --sender 0.0.123 --receiver 0.0.456 --amount 100
 *
 *   # With multi-sig (networked workflow)
 *   node examples/transfer-token.js --token 0.0.789 --receiver 0.0.456 --amount 100 --multisig \
 *     --workflow networked --server ws://localhost:3000 --session <id> --pin <pin>
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
      if (data.expiresAt && data.expiresAt > Date.now()) {
        return data;
      }
    }
  } catch (error) {
    // Ignore errors
  }
  return null;
}

const {
  Client,
  AccountId,
  PrivateKey,
  TransferTransaction,
  TokenId,
  TransactionId
} = require('@hashgraph/sdk');

const chalk = require('chalk');
const readlineSync = require('readline-sync');
const WebSocket = require('ws');

// Mirror node configuration
const MIRROR_NODE_TESTNET = 'https://testnet.mirrornode.hedera.com';
const MIRROR_NODE_MAINNET = 'https://mainnet-public.mirrornode.hedera.com';
const MAX_RETRIES = 3;

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(resource, options = {}) {
  const { timeout = 30000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const fetch = (await import('node-fetch')).default;

  const response = await fetch(resource, {
    ...options,
    signal: controller.signal,
  });
  clearTimeout(id);
  return response;
}

async function fetchJson(url, depth = 0) {
  if (depth >= MAX_RETRIES) {
    throw new Error(`Failed to fetch after ${MAX_RETRIES} retries: ${url}`);
  }

  depth++;
  try {
    const res = await fetchWithTimeout(url);
    if (res.status !== 200) {
      await sleep(1000 * depth);
      return await fetchJson(url, depth);
    }
    return res.json();
  } catch (err) {
    if (depth < MAX_RETRIES) {
      await sleep(1000 * depth);
      return await fetchJson(url, depth);
    }
    throw err;
  }
}

async function getTokenMetadata(tokenId, network) {
  const baseUrl = network === 'mainnet' ? MIRROR_NODE_MAINNET : MIRROR_NODE_TESTNET;
  const url = `${baseUrl}/api/v1/tokens/${tokenId}`;

  console.log(chalk.gray(`  Fetching token metadata from mirror node...`));

  const tokenData = await fetchJson(url);

  return {
    tokenId: tokenData.token_id,
    name: tokenData.name,
    symbol: tokenData.symbol,
    decimals: tokenData.decimals,
    type: tokenData.type,
    totalSupply: tokenData.total_supply,
    treasuryAccount: tokenData.treasury_account_id
  };
}

async function main() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║     TRANSFER FUNGIBLE TOKEN (Multi-Sig Enabled)       ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  try {
    // Show help
    if (getArgFlag('help') || getArgFlag('h')) {
      console.log('Usage: node examples/transfer-token.js [options]');
      console.log('');
      console.log('Options:');
      console.log('  --token <id>       Token ID (required)');
      console.log('  --sender <id>      Sender account ID (default: operator)');
      console.log('  --receiver <id>    Receiver account ID (required)');
      console.log('  --amount <qty>     Amount in token units (will apply decimals)');
      console.log('  --memo <text>      Transaction memo');
      console.log('  --multisig         Enable multi-sig workflow');
      console.log('  --workflow <type>  Workflow: interactive, offline, networked');
      console.log('  --server <url>     WebSocket server URL for networked workflow');
      console.log('  --session <id>     Session ID for networked workflow');
      console.log('  --pin <pin>        PIN for networked workflow');
      console.log('  --approval <id>    Spend from account via allowance');
      console.log('  --network <net>    Network: testnet, mainnet, previewnet, local');
      console.log('  --help, -h         Show this help');
      console.log('');
      console.log('Environment Variables (can be set in .env file):');
      console.log('  OPERATOR_ID        Operator account ID (pays fees) - REQUIRED');
      console.log('  OPERATOR_KEY       Operator private key - OPTIONAL for multisig');
      console.log('  ENVIRONMENT        Network: TEST, MAIN, PREVIEW, LOCAL (default: TEST)');
      console.log('  SESSION_SERVER     Default WebSocket server URL');
      console.log('  SESSION_ID         Default session ID');
      console.log('  SESSION_PIN        Default PIN');
      console.log('');
      console.log('Examples:');
      console.log('  # Transfer 100 tokens (uses .env file)');
      console.log('  node examples/transfer-token.js --token 0.0.789 --receiver 0.0.456 --amount 100');
      console.log('');
      console.log('  # With multi-sig (networked workflow)');
      console.log('  node examples/transfer-token.js --token 0.0.789 --receiver 0.0.456 --amount 100 --multisig \\');
      console.log('    --workflow networked --server ws://localhost:3000 --session <id> --pin <pin>');
      console.log('');
      process.exit(0);
    }

    // Get operator credentials
    // OPERATOR_ID is required (sets who pays fees)
    // OPERATOR_KEY is optional - only needed if operator is different from multisig account
    const operatorId = process.env.OPERATOR_ID ? AccountId.fromString(process.env.OPERATOR_ID) : null;
    const operatorKey = process.env.OPERATOR_KEY ? PrivateKey.fromString(process.env.OPERATOR_KEY) : null;

    if (!operatorId) {
      console.log(chalk.red('❌ Missing OPERATOR_ID environment variable\n'));
      console.log(chalk.white('Set it in .env file or environment:'));
      console.log(chalk.gray('  OPERATOR_ID=0.0.XXX\n'));
      console.log(chalk.white('Note: OPERATOR_KEY is optional for multisig workflows.'));
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

    // Only set operator if we have the key
    if (operatorKey) {
      client.setOperator(operatorId, operatorKey);
    }

    console.log(chalk.green(`✅ Connected to Hedera ${network}`));
    console.log(chalk.gray(`   Operator: ${operatorId.toString()}`));
    console.log(chalk.gray(`   Operator Key: ${operatorKey ? 'Provided' : 'Not provided (multisig mode)'}\n`));

    // Get transaction parameters
    let tokenId, sender, receiver, amount, memo, isMultisig, workflow, approvalAccount;

    const tokenArg = getArg('token');
    const senderArg = getArg('sender');
    const receiverArg = getArg('receiver');
    const amountArg = getArg('amount');
    const memoArg = getArg('memo');
    const approvalArg = getArg('approval');

    isMultisig = getArgFlag('multisig');
    workflow = getArg('workflow') || 'interactive';

    // Get token ID (required)
    if (tokenArg) {
      tokenId = TokenId.fromString(tokenArg);
    } else {
      const tokenStr = readlineSync.question(chalk.cyan('Token ID: '));
      tokenId = TokenId.fromString(tokenStr);
    }

    // Fetch token metadata
    console.log(chalk.yellow('\n⏳ Fetching token metadata...\n'));
    const tokenMetadata = await getTokenMetadata(tokenId.toString(), network);

    // Validate it's a fungible token
    if (tokenMetadata.type === 'NON_FUNGIBLE_UNIQUE') {
      console.log(chalk.red('❌ This script is for fungible tokens only, not NFTs\n'));
      console.log(chalk.white('Token Type: NON_FUNGIBLE_UNIQUE'));
      console.log(chalk.white('Use a different script for NFT transfers\n'));
      process.exit(1);
    }

    console.log(chalk.green('✅ Token metadata retrieved:\n'));
    console.log(chalk.white('Token Information:'));
    console.log(chalk.gray(`  Name: ${tokenMetadata.name}`));
    console.log(chalk.gray(`  Symbol: ${tokenMetadata.symbol}`));
    console.log(chalk.gray(`  Token ID: ${tokenMetadata.tokenId}`));
    console.log(chalk.gray(`  Decimals: ${tokenMetadata.decimals}`));
    console.log(chalk.gray(`  Type: ${tokenMetadata.type}`));
    console.log(chalk.gray(`  Total Supply: ${Number(tokenMetadata.totalSupply) / (10 ** tokenMetadata.decimals)} ${tokenMetadata.symbol}\n`));

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
          isMultisig = true;
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
        amount = parseFloat(amountArg);
      } else {
        const amountStr = readlineSync.question(chalk.cyan(`Amount (in ${tokenMetadata.symbol}): `));
        amount = parseFloat(amountStr);
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
      sender = senderArg ? AccountId.fromString(senderArg) : operatorId;
      receiver = AccountId.fromString(receiverArg);
      amount = parseFloat(amountArg);
      memo = memoArg || null;
      approvalAccount = approvalArg ? AccountId.fromString(approvalArg) : null;

      if (sender.toString() !== operatorId.toString()) {
        isMultisig = true;
      }
    }

    // Calculate amount with decimals
    const amountWithDecimals = Math.floor(amount * (10 ** tokenMetadata.decimals));

    // Display transaction summary
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('TRANSACTION SUMMARY'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.white(`Token: ${tokenMetadata.name} (${tokenMetadata.symbol})`));
    console.log(chalk.white(`Token ID: ${tokenId.toString()}`));
    console.log(chalk.white(`Sender: ${sender.toString()}`));
    console.log(chalk.white(`Receiver: ${receiver.toString()}`));
    console.log(chalk.white(`Amount: ${amount} ${tokenMetadata.symbol} (${amountWithDecimals} smallest units)`));
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
      .addTokenTransfer(tokenId, receiver, amountWithDecimals)
      .setTransactionId(TransactionId.generate(operatorId));

    if (approvalAccount) {
      transaction.addApprovedTokenTransfer(tokenId, approvalAccount, -amountWithDecimals);
    } else {
      transaction.addTokenTransfer(tokenId, sender, -amountWithDecimals);
    }

    if (memo) {
      transaction.setTransactionMemo(memo);
    }

    // Execute with appropriate workflow
    if (isMultisig) {
      console.log(chalk.green('✅ Transaction created - using multi-sig workflow\n'));

      if (workflow === 'networked') {
        // Support CLI args, environment variables, and auto-detected session file
        const sessionFile = loadSessionFile();
        const serverUrl = getArg('server') || process.env.SESSION_SERVER || sessionFile?.serverUrl;
        const sessionId = getArg('session') || process.env.SESSION_ID || sessionFile?.sessionId;
        const pin = getArg('pin') || process.env.SESSION_PIN || sessionFile?.pin;

        if (sessionFile && !getArg('server') && !process.env.SESSION_SERVER) {
          console.log(chalk.green('✅ Auto-detected active session from .multisig-session.json\n'));
        }

        if (!serverUrl || !sessionId || !pin) {
          console.log(chalk.yellow('📡 Networked Workflow Instructions:\n'));
          console.log(chalk.white('1. Start coordinator session:'));
          console.log(chalk.gray('   npm run multisig-server -- -t <threshold> -k "key1,key2,key3"\n'));
          console.log(chalk.white('2. Participants connect via dApp or CLI\n'));
          console.log(chalk.white('3. Then re-run this command with session details:'));
          console.log(chalk.gray(`   node examples/transfer-token.js --token ${tokenId} --receiver ${receiver} --amount ${amount} \\`));
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
              ws.send(JSON.stringify({
                type: 'AUTH',
                payload: { sessionId, pin, role: 'coordinator' }
              }));
            });

            ws.on('message', async (data) => {
              const message = JSON.parse(data.toString());

              switch (message.type) {
                case 'AUTH_SUCCESS':
                  console.log(chalk.green('✅ Authenticated as coordinator'));
                  console.log(chalk.yellow('\n⏳ Injecting transaction...\n'));

                  const txBytes = frozenTx.toBytes();
                  ws.send(JSON.stringify({
                    type: 'TRANSACTION_INJECT',
                    payload: {
                      frozenTransaction: Buffer.from(txBytes).toString('base64'),
                      txDetails: {
                        type: 'TransferTransaction',
                        tokenId: tokenId.toString(),
                        tokenName: tokenMetadata.name,
                        tokenSymbol: tokenMetadata.symbol,
                        sender: sender.toString(),
                        receiver: receiver.toString(),
                        amount: `${amount} ${tokenMetadata.symbol}`,
                        memo: memo || null
                      },
                      metadata: {
                        description: `Transfer ${amount} ${tokenMetadata.symbol} to ${receiver}`,
                        type: 'Token Transfer',
                        token: { id: tokenId.toString(), name: tokenMetadata.name, symbol: tokenMetadata.symbol },
                        amount: { value: amount.toString(), unit: tokenMetadata.symbol },
                        recipient: { address: receiver.toString() }
                      }
                    }
                  }));

                  console.log(chalk.green('✅ Transaction injected!'));
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
        console.log(chalk.yellow('💾 Offline Workflow\n'));

        const frozenTx = transaction.freezeWith(client);
        const txBytes = frozenTx.toBytes();
        const txBase64 = Buffer.from(txBytes).toString('base64');

        const fs = require('fs');
        const exportData = {
          type: 'TOKEN_TRANSFER',
          tokenId: tokenId.toString(),
          tokenName: tokenMetadata.name,
          tokenSymbol: tokenMetadata.symbol,
          decimals: tokenMetadata.decimals,
          sender: sender.toString(),
          receiver: receiver.toString(),
          amount: amount,
          amountWithDecimals: amountWithDecimals,
          memo: memo,
          network,
          transaction: txBase64,
          createdAt: new Date().toISOString()
        };

        const filename = `transfer-token-${tokenMetadata.symbol}-${Date.now()}.json`;
        fs.writeFileSync(filename, JSON.stringify(exportData, null, 2), 'utf8');

        console.log(chalk.green(`✅ Transaction exported to: ${filename}\n`));
        console.log(chalk.white('Next: npm run sign-tx --file ' + filename + '\n'));

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
          console.log(chalk.green('✅ TOKEN TRANSFER SUCCESSFUL!\n'));
          console.log(chalk.white('Transaction Details:'));
          console.log(chalk.gray(`  Transaction ID: ${txResponse.transactionId.toString()}`));
          console.log(chalk.gray(`  Status: ${receipt.status.toString()}`));
          console.log(chalk.gray(`  Token: ${tokenMetadata.name} (${tokenMetadata.symbol})`));
          console.log(chalk.gray(`  Amount: ${amount} ${tokenMetadata.symbol}`));
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
        console.log(chalk.green('✅ TOKEN TRANSFER SUCCESSFUL!\n'));
        console.log(chalk.white('Transaction Details:'));
        console.log(chalk.gray(`  Transaction ID: ${txResponse.transactionId.toString()}`));
        console.log(chalk.gray(`  Status: ${receipt.status.toString()}`));
        console.log(chalk.gray(`  Token: ${tokenMetadata.name} (${tokenMetadata.symbol})`));
        console.log(chalk.gray(`  Amount: ${amount} ${tokenMetadata.symbol}`));
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
