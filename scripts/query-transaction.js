#!/usr/bin/env node

/**
 * Query and Decode Transaction
 *
 * Decodes frozen transaction bytes and displays detailed information
 * without requiring any private keys. Useful for inspecting transactions
 * before signing or verifying transaction contents.
 *
 * Usage:
 *   # From base64 string
 *   node scripts/query-transaction.js --tx <base64-encoded-bytes>
 *
 *   # From file
 *   node scripts/query-transaction.js --file transaction.json
 *
 *   # Interactive mode
 *   node scripts/query-transaction.js
 */

const {
  Transaction,
  TransferTransaction,
  AccountCreateTransaction,
  AccountUpdateTransaction,
  ContractCreateTransaction,
  ContractExecuteTransaction,
  ContractCallQuery
} = require('@hashgraph/sdk');

const readlineSync = require('readline-sync');
const chalk = require('chalk');
const fs = require('fs');
const crypto = require('crypto');

function getArg(arg) {
  const index = process.argv.indexOf(`--${arg}`);
  if (index > -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
}

function calculateChecksum(txBytes) {
  return crypto.createHash('sha256').update(txBytes).digest('hex');
}

function formatHbar(tinybar) {
  if (!tinybar) return '0 ℏ';
  const hbar = Number(tinybar) / 100000000;
  return `${hbar.toFixed(8)} ℏ (${tinybar} tinybars)`;
}

function decodeTransactionDetails(transaction) {
  const details = {
    type: transaction.constructor.name,
    transactionId: transaction.transactionId ? transaction.transactionId.toString() : 'Not set',
    nodeAccountIds: transaction.nodeAccountIds ? transaction.nodeAccountIds.map(id => id.toString()) : [],
    transactionFee: transaction.maxTransactionFee ? formatHbar(transaction.maxTransactionFee.toTinybars()) : 'Not set',
    transactionValidDuration: transaction.transactionValidDuration ? `${transaction.transactionValidDuration}s` : 'Not set',
    memo: transaction.transactionMemo || '(none)',
    signatures: {}
  };

  // Extract type-specific details
  if (transaction instanceof TransferTransaction) {
    details.typeSpecific = {
      transfers: {}
    };

    // Get hbar transfers
    const hbarTransfers = transaction._hbarTransfers || new Map();
    hbarTransfers.forEach((amount, accountId) => {
      const accountIdStr = accountId.toString();
      details.typeSpecific.transfers[accountIdStr] = formatHbar(amount.toTinybars());
    });

    // Get token transfers if any
    if (transaction._tokenTransfers && transaction._tokenTransfers.size > 0) {
      details.typeSpecific.tokenTransfers = {};
      transaction._tokenTransfers.forEach((transfers, tokenId) => {
        const tokenIdStr = tokenId.toString();
        details.typeSpecific.tokenTransfers[tokenIdStr] = {};

        transfers.forEach((amount, accountId) => {
          details.typeSpecific.tokenTransfers[tokenIdStr][accountId.toString()] = amount.toString();
        });
      });
    }

  } else if (transaction instanceof AccountCreateTransaction) {
    details.typeSpecific = {
      initialBalance: transaction.initialBalance ? formatHbar(transaction.initialBalance.toTinybars()) : 'Not set',
      key: transaction.key ? transaction.key.toString().substring(0, 40) + '...' : 'Not set',
      receiverSignatureRequired: transaction.receiverSignatureRequired,
      maxAutomaticTokenAssociations: transaction.maxAutomaticTokenAssociations
    };

  } else if (transaction instanceof AccountUpdateTransaction) {
    details.typeSpecific = {
      accountId: transaction.accountId ? transaction.accountId.toString() : 'Not set',
      key: transaction.key ? transaction.key.toString().substring(0, 40) + '...' : 'Not changed',
      expirationTime: transaction.expirationTime ? transaction.expirationTime.toString() : 'Not changed',
      receiverSignatureRequired: transaction.receiverSignatureRequired,
      maxAutomaticTokenAssociations: transaction.maxAutomaticTokenAssociations
    };

  } else if (transaction instanceof ContractCreateTransaction) {
    details.typeSpecific = {
      bytecodeFileId: transaction.bytecodeFileId ? transaction.bytecodeFileId.toString() : 'Not set',
      adminKey: transaction.adminKey ? transaction.adminKey.toString().substring(0, 40) + '...' : 'Not set',
      gas: transaction.gas ? transaction.gas.toString() : 'Not set',
      initialBalance: transaction.initialBalance ? formatHbar(transaction.initialBalance.toTinybars()) : '0',
      constructorParameters: transaction.constructorParameters ? transaction.constructorParameters.toString('hex').substring(0, 40) + '...' : 'None'
    };

  } else if (transaction instanceof ContractExecuteTransaction) {
    details.typeSpecific = {
      contractId: transaction.contractId ? transaction.contractId.toString() : 'Not set',
      gas: transaction.gas ? transaction.gas.toString() : 'Not set',
      amount: transaction.payableAmount ? formatHbar(transaction.payableAmount.toTinybars()) : '0',
      functionParameters: transaction.functionParameters ? transaction.functionParameters.toString('hex').substring(0, 40) + '...' : 'None'
    };
  }

  // Check for signatures
  try {
    const sigMap = transaction._signedTransactions?.list?.[0]?.sigMap;
    if (sigMap && sigMap.sigPair) {
      details.signatures = {
        count: sigMap.sigPair.length,
        publicKeys: sigMap.sigPair.map(pair => {
          const pubKeyHex = Buffer.from(pair.pubKeyPrefix || []).toString('hex');
          return pubKeyHex ? pubKeyHex.substring(0, 20) + '...' : 'Unknown';
        })
      };
    } else {
      details.signatures = { count: 0, status: 'No signatures yet' };
    }
  } catch (e) {
    details.signatures = { count: 0, status: 'Unable to extract signatures' };
  }

  return details;
}

function displayTransactionDetails(details, checksum) {
  console.log(chalk.cyan('\n═'.repeat(60)));
  console.log(chalk.bold.white('TRANSACTION DETAILS'));
  console.log(chalk.cyan('═'.repeat(60)));

  console.log(chalk.yellow('\n📋 Basic Information:'));
  console.log(chalk.white(`  Type: ${chalk.bold(details.type)}`));
  console.log(chalk.white(`  Transaction ID: ${details.transactionId}`));
  console.log(chalk.white(`  Memo: ${details.memo}`));
  console.log(chalk.white(`  Max Fee: ${details.transactionFee}`));
  console.log(chalk.white(`  Valid Duration: ${details.transactionValidDuration}`));

  if (details.nodeAccountIds.length > 0) {
    console.log(chalk.white(`  Node Account IDs: ${details.nodeAccountIds.join(', ')}`));
  }

  console.log(chalk.yellow('\n🔐 Signatures:'));
  if (details.signatures.count > 0) {
    console.log(chalk.green(`  ✅ ${details.signatures.count} signature(s) collected`));
    details.signatures.publicKeys.forEach((key, idx) => {
      console.log(chalk.gray(`     ${idx + 1}. ${key}`));
    });
  } else {
    console.log(chalk.gray(`  ${details.signatures.status}`));
  }

  console.log(chalk.yellow('\n🔍 Transaction Checksum:'));
  console.log(chalk.gray(`  SHA-256: ${checksum}`));

  if (details.typeSpecific) {
    console.log(chalk.yellow('\n📝 Type-Specific Details:'));

    if (details.type === 'TransferTransaction') {
      console.log(chalk.white('  HBAR Transfers:'));
      Object.entries(details.typeSpecific.transfers).forEach(([account, amount]) => {
        const sign = amount.startsWith('-') ? chalk.red('→') : chalk.green('←');
        console.log(chalk.gray(`    ${sign} ${account}: ${amount}`));
      });

      if (details.typeSpecific.tokenTransfers) {
        console.log(chalk.white('\n  Token Transfers:'));
        Object.entries(details.typeSpecific.tokenTransfers).forEach(([tokenId, transfers]) => {
          console.log(chalk.gray(`    Token ${tokenId}:`));
          Object.entries(transfers).forEach(([account, amount]) => {
            console.log(chalk.gray(`      ${account}: ${amount}`));
          });
        });
      }

    } else if (details.type === 'AccountCreateTransaction') {
      console.log(chalk.white(`  Initial Balance: ${details.typeSpecific.initialBalance}`));
      console.log(chalk.white(`  Key: ${details.typeSpecific.key}`));
      console.log(chalk.white(`  Receiver Signature Required: ${details.typeSpecific.receiverSignatureRequired}`));
      console.log(chalk.white(`  Max Auto Token Associations: ${details.typeSpecific.maxAutomaticTokenAssociations}`));

    } else if (details.type === 'AccountUpdateTransaction') {
      console.log(chalk.white(`  Account ID: ${details.typeSpecific.accountId}`));
      console.log(chalk.white(`  New Key: ${details.typeSpecific.key}`));
      if (details.typeSpecific.expirationTime !== 'Not changed') {
        console.log(chalk.white(`  Expiration: ${details.typeSpecific.expirationTime}`));
      }

    } else if (details.type === 'ContractCreateTransaction') {
      console.log(chalk.white(`  Bytecode File ID: ${details.typeSpecific.bytecodeFileId}`));
      console.log(chalk.white(`  Admin Key: ${details.typeSpecific.adminKey}`));
      console.log(chalk.white(`  Gas: ${details.typeSpecific.gas}`));
      console.log(chalk.white(`  Initial Balance: ${details.typeSpecific.initialBalance}`));
      console.log(chalk.white(`  Constructor Params: ${details.typeSpecific.constructorParameters}`));

    } else if (details.type === 'ContractExecuteTransaction') {
      console.log(chalk.white(`  Contract ID: ${details.typeSpecific.contractId}`));
      console.log(chalk.white(`  Gas: ${details.typeSpecific.gas}`));
      console.log(chalk.white(`  Amount: ${details.typeSpecific.amount}`));
      console.log(chalk.white(`  Function Params: ${details.typeSpecific.functionParameters}`));
    }
  }

  console.log(chalk.cyan('\n═'.repeat(60)));
}

async function queryTransaction() {
  console.log(chalk.bold.cyan('\n╔═══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('║         QUERY & DECODE TRANSACTION                    ║'));
  console.log(chalk.bold.cyan('╚═══════════════════════════════════════════════════════╝\n'));

  try {
    let transactionBytes;
    let metadata = null;

    // Get transaction bytes
    const txArg = getArg('tx');
    const fileArg = getArg('file');

    if (txArg) {
      transactionBytes = txArg;
      console.log(chalk.green('✅ Using transaction from command line\n'));

    } else if (fileArg) {
      if (!fs.existsSync(fileArg)) {
        console.log(chalk.red(`\n❌ File not found: ${fileArg}\n`));
        process.exit(1);
      }

      const fileContent = fs.readFileSync(fileArg, 'utf8');
      const data = JSON.parse(fileContent);

      if (data.transaction) {
        transactionBytes = data.transaction;
        metadata = data;
        console.log(chalk.green(`✅ Loaded transaction from file: ${fileArg}\n`));
      } else if (typeof data === 'string') {
        transactionBytes = data;
        console.log(chalk.green(`✅ Loaded transaction from file: ${fileArg}\n`));
      } else {
        console.log(chalk.red('\n❌ Invalid file format. Expected JSON with "transaction" field or plain base64 string\n'));
        process.exit(1);
      }

    } else {
      // Interactive mode
      console.log(chalk.yellow('How do you want to provide the transaction?\n'));
      console.log(chalk.gray('  1. Paste base64-encoded transaction bytes'));
      console.log(chalk.gray('  2. Load from file\n'));

      const method = readlineSync.question(chalk.cyan('Method (1 or 2) [1]: ')) || '1';

      if (method === '2') {
        const filePath = readlineSync.question(chalk.cyan('File path: '));

        if (!fs.existsSync(filePath)) {
          console.log(chalk.red(`\n❌ File not found: ${filePath}\n`));
          process.exit(1);
        }

        const fileContent = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(fileContent);

        if (data.transaction) {
          transactionBytes = data.transaction;
          metadata = data;
        } else if (typeof data === 'string') {
          transactionBytes = data;
        } else {
          console.log(chalk.red('\n❌ Invalid file format\n'));
          process.exit(1);
        }

      } else {
        transactionBytes = readlineSync.question(chalk.cyan('\nPaste transaction bytes (base64): '));
      }

      console.log('');
    }

    // Decode transaction
    console.log(chalk.yellow('⏳ Decoding transaction...\n'));

    const txBytes = Buffer.from(transactionBytes, 'base64');
    const checksum = calculateChecksum(txBytes);
    const transaction = Transaction.fromBytes(txBytes);

    const details = decodeTransactionDetails(transaction);
    displayTransactionDetails(details, checksum);

    // Display metadata if present
    if (metadata) {
      console.log(chalk.yellow('\n📦 Additional Metadata (from file):'));

      if (metadata.operation) {
        console.log(chalk.white(`  Operation: ${metadata.operation}`));
      }
      if (metadata.accountId) {
        console.log(chalk.white(`  Account ID: ${metadata.accountId}`));
      }
      if (metadata.network) {
        console.log(chalk.white(`  Network: ${metadata.network}`));
      }
      if (metadata.createdAt) {
        console.log(chalk.white(`  Created: ${metadata.createdAt}`));
      }

      console.log('');
    }

    console.log(chalk.green('✅ Transaction decoded successfully!\n'));
    console.log(chalk.yellow('⚠️  NOTE: This is a read-only inspection. No signatures were added.\n'));

  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));
    console.error(chalk.gray(error.stack));
    process.exit(1);
  }
}

// Show help
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node scripts/query-transaction.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --tx <base64>      Transaction bytes in base64 format');
  console.log('  --file <path>      Load transaction from JSON file');
  console.log('  --help, -h         Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/query-transaction.js');
  console.log('  node scripts/query-transaction.js --tx <base64-string>');
  console.log('  node scripts/query-transaction.js --file transaction.json');
  process.exit(0);
}

// Run
queryTransaction();
