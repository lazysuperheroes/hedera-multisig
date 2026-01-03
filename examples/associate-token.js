#!/usr/bin/env node

/**
 * Associate/Dissociate Tokens with Multi-Sig Support
 *
 * Modern script for token association/dissociation with:
 * - Mirror node pre-checks to avoid unnecessary operations
 * - Bulk token operations (comma-separated)
 * - Full multi-signature support
 * - Balance validation
 * - Interactive and command-line modes
 *
 * Configuration:
 *   Create a .env file in the project root with:
 *     OPERATOR_ID=0.0.XXX        # Required: Account that pays fees
 *     OPERATOR_KEY=xxx           # Optional: Only needed for single-sig or if operator != account
 *     ENVIRONMENT=TEST           # Optional: TEST or MAIN (default: TEST)
 *
 * Usage:
 *   # Interactive mode (uses .env file)
 *   node examples/associate-token.js
 *
 *   # Associate single token
 *   node examples/associate-token.js --account 0.0.123 --tokens 0.0.789 --action associate
 *
 *   # Associate multiple tokens
 *   node examples/associate-token.js --account 0.0.123 --tokens "0.0.789,0.0.790,0.0.791" --action associate
 *
 *   # With multi-sig (networked workflow)
 *   node examples/associate-token.js --tokens 0.0.789 --action associate --multisig --workflow networked \
 *     --server ws://localhost:3000 --session <id> --pin <pin>
 *
 *   # Dissociate with force (even if tokens owned)
 *   node examples/associate-token.js --account 0.0.123 --tokens 0.0.789 --action dissociate --force
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
  TokenId,
  TokenAssociateTransaction,
  TokenDissociateTransaction,
  AccountBalanceQuery,
  Hbar
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
    return null;
  }

  depth++;
  try {
    const res = await fetchWithTimeout(url);
    if (res.status !== 200) {
      await sleep(500 * depth);
      return await fetchJson(url, depth);
    }
    return res.json();
  } catch (err) {
    if (depth < MAX_RETRIES) {
      await sleep(500 * depth);
      return await fetchJson(url, depth);
    }
    return null;
  }
}

async function getTokenBalanceMap(tokenId, network) {
  const baseUrl = network === 'mainnet' ? MIRROR_NODE_MAINNET : MIRROR_NODE_TESTNET;
  let routeUrl = `/api/v1/tokens/${tokenId}/balances/`;
  const tokenBalMap = new Map();

  try {
    do {
      const json = await fetchJson(baseUrl + routeUrl);
      if (json == null) {
        return tokenBalMap;
      }

      for (const entry of json.balances) {
        tokenBalMap.set(entry.account, entry.balance);
      }

      routeUrl = json.links?.next;
    } while (routeUrl);

    return tokenBalMap;
  } catch (err) {
    console.log(chalk.yellow(`  ⚠️  Could not fetch balances from mirror node: ${err.message}`));
    return tokenBalMap;
  }
}

async function checkAccountBalance(accountId, tokenId, client, network) {
  try {
    // Check on-chain balance
    const balanceQuery = await new AccountBalanceQuery()
      .setAccountId(accountId)
      .execute(client);

    const tokenMap = balanceQuery.tokens._map;
    const onChainBalance = tokenMap.get(tokenId.toString());

    // Check mirror node balance
    const mirrorNodeBalMap = await getTokenBalanceMap(tokenId.toString(), network);
    const mirrorNodeBalance = mirrorNodeBalMap.get(accountId.toString());

    return {
      onChain: onChainBalance !== undefined ? onChainBalance : -1,
      mirrorNode: mirrorNodeBalance !== undefined ? mirrorNodeBalance : -1,
      isAssociated: onChainBalance !== undefined
    };
  } catch (error) {
    console.log(chalk.yellow(`  ⚠️  Could not check balance: ${error.message}`));
    return {
      onChain: -1,
      mirrorNode: -1,
      isAssociated: false
    };
  }
}

async function main() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║    ASSOCIATE/DISSOCIATE TOKENS (Multi-Sig Enabled)    ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  try {
    // Show help
    if (getArgFlag('help') || getArgFlag('h')) {
      console.log('Usage: node examples/associate-token.js [options]');
      console.log('');
      console.log('Options:');
      console.log('  --account <id>     Account to associate/dissociate tokens (default: operator)');
      console.log('  --tokens <ids>     Token IDs (comma-separated, e.g., "0.0.789,0.0.790")');
      console.log('  --action <type>    Action: associate or dissociate (required)');
      console.log('  --force            Force dissociate even if tokens owned');
      console.log('  --multisig         Enable multi-sig workflow');
      console.log('  --workflow <type>  Workflow: interactive, offline, networked');
      console.log('  --server <url>     WebSocket server URL for networked workflow');
      console.log('  --session <id>     Session ID for networked workflow');
      console.log('  --pin <pin>        PIN for networked workflow');
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
      console.log('  # Associate single token (uses .env file)');
      console.log('  node examples/associate-token.js --tokens 0.0.789 --action associate');
      console.log('');
      console.log('  # Associate multiple tokens');
      console.log('  node examples/associate-token.js --tokens "0.0.789,0.0.790,0.0.791" --action associate');
      console.log('');
      console.log('  # With multi-sig (networked workflow)');
      console.log('  node examples/associate-token.js --tokens 0.0.789 --action associate --multisig \\');
      console.log('    --workflow networked --server ws://localhost:3000 --session <id> --pin <pin>');
      console.log('');
      console.log('  # Force dissociate (even if balance > 0)');
      console.log('  node examples/associate-token.js --tokens 0.0.789 --action dissociate --force');
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

    // Get parameters
    let account, tokenIds, action, force, isMultisig, workflow;

    const accountArg = getArg('account');
    const tokensArg = getArg('tokens');
    const actionArg = getArg('action');

    force = getArgFlag('force');
    isMultisig = getArgFlag('multisig');
    workflow = getArg('workflow') || 'interactive';

    // Interactive or command-line mode
    if (!tokensArg || !actionArg) {
      console.log(chalk.yellow('📋 Interactive Mode\n'));

      // Account
      if (accountArg) {
        account = AccountId.fromString(accountArg);
      } else {
        const useDifferentAccount = readlineSync.keyInYN(
          chalk.cyan('Use different account than operator? ')
        );
        if (useDifferentAccount) {
          const accountStr = readlineSync.question(chalk.cyan('Account ID: '));
          account = AccountId.fromString(accountStr);
          isMultisig = true;
        } else {
          account = operatorId;
        }
      }

      // Tokens
      if (tokensArg) {
        tokenIds = tokensArg.split(',').map(t => TokenId.fromString(t.trim()));
      } else {
        const tokensStr = readlineSync.question(chalk.cyan('Token IDs (comma-separated): '));
        tokenIds = tokensStr.split(',').map(t => TokenId.fromString(t.trim()));
      }

      // Action
      if (actionArg) {
        action = actionArg.toLowerCase();
      } else {
        console.log(chalk.yellow('\nSelect action:'));
        console.log(chalk.gray('  1. Associate (add tokens to account)'));
        console.log(chalk.gray('  2. Dissociate (remove tokens from account)\n'));
        const actionChoice = readlineSync.question(chalk.cyan('Action (1 or 2): '));
        action = actionChoice === '1' ? 'associate' : 'dissociate';
      }

      // Force
      if (action === 'dissociate' && !force) {
        force = readlineSync.keyInYN(chalk.cyan('Force dissociate even if balance > 0? '));
      }

      // Multi-sig
      if (!isMultisig && account.toString() !== operatorId.toString()) {
        isMultisig = true;
        console.log(chalk.yellow('\n⚠️  Different account detected - multi-sig required\n'));
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
      account = accountArg ? AccountId.fromString(accountArg) : operatorId;
      tokenIds = tokensArg.split(',').map(t => TokenId.fromString(t.trim()));
      action = actionArg.toLowerCase();

      if (account.toString() !== operatorId.toString()) {
        isMultisig = true;
      }
    }

    if (!['associate', 'dissociate'].includes(action)) {
      console.log(chalk.red('❌ Action must be either "associate" or "dissociate"\n'));
      process.exit(1);
    }

    // Pre-check tokens
    console.log(chalk.yellow('\n⏳ Pre-checking tokens...\n'));

    const checkedTokens = [];

    for (const tokenId of tokenIds) {
      console.log(chalk.white(`Checking ${tokenId.toString()}...`));

      const balance = await checkAccountBalance(account, tokenId, client, network);

      if (action === 'associate') {
        if (balance.isAssociated) {
          console.log(chalk.yellow(`  ⚠️  Already associated - skipping\n`));
          continue;
        } else {
          console.log(chalk.green(`  ✅ Ready to associate\n`));
          checkedTokens.push(tokenId);
        }
      } else {
        // Dissociate
        if (!balance.isAssociated && balance.mirrorNode < 0) {
          console.log(chalk.yellow(`  ⚠️  Already dissociated - skipping\n`));
          continue;
        } else if (balance.onChain > 0 && !force) {
          console.log(chalk.yellow(`  ⚠️  Balance ${balance.onChain} > 0 - use --force to override\n`));
          continue;
        } else {
          console.log(chalk.green(`  ✅ Ready to dissociate\n`));
          checkedTokens.push(tokenId);
        }
      }
    }

    if (checkedTokens.length === 0) {
      console.log(chalk.yellow('⚠️  No tokens passed pre-check - nothing to do\n'));
      process.exit(0);
    }

    // Display summary
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold.white('OPERATION SUMMARY'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.white(`Account: ${account.toString()}`));
    console.log(chalk.white(`Action: ${action.toUpperCase()}`));
    console.log(chalk.white(`Tokens: ${checkedTokens.length}`));
    checkedTokens.forEach((token, idx) => {
      console.log(chalk.gray(`  ${idx + 1}. ${token.toString()}`));
    });
    if (force) console.log(chalk.white(`Force: YES`));
    console.log(chalk.white(`Multi-Sig: ${isMultisig ? 'YES' : 'NO'}`));
    if (isMultisig) console.log(chalk.white(`Workflow: ${workflow}`));
    console.log(chalk.cyan('═'.repeat(60)) + '\n');

    // Confirm
    const proceed = readlineSync.keyInYN(chalk.yellow(`Proceed with ${action}? `));
    if (!proceed) {
      console.log(chalk.yellow('\n⚠️  Operation cancelled\n'));
      process.exit(0);
    }

    // Create transaction
    console.log(chalk.yellow('\n⏳ Creating transaction...\n'));

    let transaction;
    if (action === 'associate') {
      transaction = new TokenAssociateTransaction()
        .setAccountId(account)
        .setTokenIds(checkedTokens)
        .setMaxTransactionFee(new Hbar(10));
    } else {
      transaction = new TokenDissociateTransaction()
        .setAccountId(account)
        .setTokenIds(checkedTokens)
        .setMaxTransactionFee(new Hbar(10));
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
          console.log(chalk.gray(`   node examples/associate-token.js --tokens ${checkedTokens.map(t => t.toString()).join(',')} \\`));
          console.log(chalk.gray('     --action ' + action + ' --multisig --workflow networked --server <url> --session <id> --pin <pin>\n'));

          // Export transaction for reference
          const frozenTx = transaction.freezeWith(client);
          const txBytes = frozenTx.toBytes();
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
                        type: action === 'associate' ? 'TokenAssociateTransaction' : 'TokenDissociateTransaction',
                        account: account.toString(),
                        tokens: checkedTokens.map(t => t.toString())
                      },
                      metadata: {
                        description: `${action === 'associate' ? 'Associate' : 'Dissociate'} ${checkedTokens.length} token(s)`,
                        type: `Token ${action === 'associate' ? 'Association' : 'Dissociation'}`,
                        account: account.toString(),
                        tokens: checkedTokens.map(t => t.toString())
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
        const frozenTx = transaction.freezeWith(client);
        const txBytes = frozenTx.toBytes();
        const txBase64 = Buffer.from(txBytes).toString('base64');

        const fs = require('fs');
        const exportData = {
          type: `TOKEN_${action.toUpperCase()}`,
          account: account.toString(),
          tokens: checkedTokens.map(t => t.toString()),
          action,
          network,
          transaction: txBase64,
          createdAt: new Date().toISOString()
        };

        const filename = `${action}-token-${Date.now()}.json`;
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
          console.log(chalk.green(`✅ TOKEN ${action.toUpperCase()} SUCCESSFUL!\n`));
          console.log(chalk.white('Transaction Details:'));
          console.log(chalk.gray(`  Transaction ID: ${txResponse.transactionId.toString()}`));
          console.log(chalk.gray(`  Status: ${receipt.status.toString()}`));
          console.log(chalk.gray(`  Account: ${account.toString()}`));
          console.log(chalk.gray(`  Tokens: ${checkedTokens.length} token(s)`));
          console.log('');
          console.log(chalk.white(`View on HashScan: https://hashscan.io/${network}/transaction/${txResponse.transactionId.toString()}\n`));

          // Verify
          console.log(chalk.yellow('⏳ Verifying...\n'));
          for (const tokenId of checkedTokens) {
            const newBalance = await checkAccountBalance(account, tokenId, client, network);
            if (action === 'associate') {
              if (newBalance.isAssociated) {
                console.log(chalk.green(`✅ ${tokenId.toString()} successfully associated`));
              } else {
                console.log(chalk.red(`❌ ${tokenId.toString()} association failed`));
              }
            } else {
              if (!newBalance.isAssociated) {
                console.log(chalk.green(`✅ ${tokenId.toString()} successfully dissociated`));
              } else {
                console.log(chalk.red(`❌ ${tokenId.toString()} dissociation failed`));
              }
            }
          }
          console.log('');
        } else {
          console.log(chalk.red(`❌ Operation failed: ${receipt.status.toString()}\n`));
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
        console.log(chalk.green(`✅ TOKEN ${action.toUpperCase()} SUCCESSFUL!\n`));
        console.log(chalk.white('Transaction Details:'));
        console.log(chalk.gray(`  Transaction ID: ${txResponse.transactionId.toString()}`));
        console.log(chalk.gray(`  Status: ${receipt.status.toString()}`));
        console.log(chalk.gray(`  Account: ${account.toString()}`));
        console.log(chalk.gray(`  Tokens: ${checkedTokens.length} token(s)`));
        console.log('');
        console.log(chalk.white(`View on HashScan: https://hashscan.io/${network}/transaction/${txResponse.transactionId.toString()}\n`));

        // Verify
        console.log(chalk.yellow('⏳ Verifying...\n'));
        for (const tokenId of checkedTokens) {
          const newBalance = await checkAccountBalance(account, tokenId, client, network);
          if (action === 'associate') {
            if (newBalance.isAssociated) {
              console.log(chalk.green(`✅ ${tokenId.toString()} successfully associated`));
            } else {
              console.log(chalk.red(`❌ ${tokenId.toString()} association failed`));
            }
          } else {
            if (!newBalance.isAssociated) {
              console.log(chalk.green(`✅ ${tokenId.toString()} successfully dissociated`));
            } else {
              console.log(chalk.red(`❌ ${tokenId.toString()} dissociation failed`));
            }
          }
        }
        console.log('');
      } else {
        console.log(chalk.red(`❌ Operation failed: ${receipt.status.toString()}\n`));
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
