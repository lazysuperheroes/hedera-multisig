#!/usr/bin/env node
/**
 * Bootstrap a reproducible end-to-end test environment.
 *
 * Creates N independent Hedera testnet accounts (default 3, max 5), each
 * with its own ED25519 keypair, funded from your operator account. Writes
 * the result to `.testenv.json` at the repo root so subsequent test runs
 * can pick up the same accounts.
 *
 * These accounts are independent of any walkthrough's threshold-signing
 * keys (each walkthrough now owns its own `walkthrough-keys.json` under
 * `examples/walkthrough-*/`). Use these accounts when you need extra
 * signers with their own fee budgets —
 * scheduled-transaction signing, agent-signing tests, multi-recipient
 * transfers, EOA→multisig migration drills.
 *
 * Idempotent:
 *   - If `.testenv.json` exists and accounts are valid on-chain, prints
 *     a summary and exits 0.
 *   - With `--top-up`, transfers HBAR back into existing accounts to bring
 *     each up to `--balance`.
 *   - With `--force`, deletes `.testenv.json` and recreates from scratch
 *     (the old accounts are abandoned on-chain — testnet only).
 *
 * Usage:
 *   node scripts/setup-test-env.js
 *   node scripts/setup-test-env.js --accounts 5 --balance 10
 *   node scripts/setup-test-env.js --top-up
 *   node scripts/setup-test-env.js --force
 *
 * Required env (from .env at repo root):
 *   OPERATOR_ID    e.g. 0.0.4515913
 *   OPERATOR_KEY   DER-encoded private key
 *   HEDERA_NETWORK testnet|previewnet  (mainnet rejected unless --yes-mainnet)
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const {
  Client, AccountId, PrivateKey,
  AccountCreateTransaction, AccountBalanceQuery,
  TransferTransaction, Hbar,
} = require('@hashgraph/sdk');
const chalk = require('chalk');

const STATE_FILE = path.resolve(__dirname, '..', '.testenv.json');
const DEFAULT_NAMES = ['alice', 'bob', 'carol', 'dave', 'eve'];
const DEFAULT_ACCOUNTS = 3;
const DEFAULT_BALANCE_HBAR = 5;
const MIN_ACCOUNTS = 3;
const MAX_ACCOUNTS = 5;
const OPERATOR_BUFFER_HBAR = 2;

function parseArgs() {
  const argv = process.argv.slice(2);
  const args = {
    accounts: DEFAULT_ACCOUNTS,
    balance: DEFAULT_BALANCE_HBAR,
    topUp: false,
    force: false,
    yesMainnet: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--accounts') args.accounts = parseInt(argv[++i], 10);
    else if (a === '--balance') args.balance = parseFloat(argv[++i]);
    else if (a === '--top-up') args.topUp = true;
    else if (a === '--force') args.force = true;
    else if (a === '--yes-mainnet') args.yesMainnet = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function showHelp() {
  console.log(`
Usage: node scripts/setup-test-env.js [options]

Creates N independent Hedera test accounts and writes .testenv.json.

Options:
  --accounts N       How many accounts to create (${MIN_ACCOUNTS}–${MAX_ACCOUNTS}, default ${DEFAULT_ACCOUNTS})
  --balance H        Initial balance per account in HBAR (default ${DEFAULT_BALANCE_HBAR})
  --top-up           Refund existing accounts to --balance instead of recreating
  --force            Delete .testenv.json and recreate (testnet only)
  --yes-mainnet      Required acknowledgement to run on mainnet
  --help, -h         Show this help

Required env (from .env at repo root):
  OPERATOR_ID, OPERATOR_KEY, HEDERA_NETWORK (testnet|previewnet)

Examples:
  node scripts/setup-test-env.js
  node scripts/setup-test-env.js --accounts 5 --balance 10
  node scripts/setup-test-env.js --top-up
`);
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

function loadOperator() {
  const missing = ['OPERATOR_ID', 'OPERATOR_KEY'].filter((k) => !process.env[k]);
  if (missing.length) {
    fail(
      `Missing env vars: ${missing.join(', ')}\n` +
      `   Edit .env at the repo root (copy from .env.example).\n` +
      `   Get a testnet account at https://portal.hedera.com/`
    );
  }
  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  return {
    operatorId: AccountId.fromString(process.env.OPERATOR_ID),
    operatorKey: PrivateKey.fromString(process.env.OPERATOR_KEY),
    network,
  };
}

function buildClient(network) {
  if (network === 'mainnet') return Client.forMainnet();
  if (network === 'previewnet') return Client.forPreviewnet();
  return Client.forTestnet();
}

async function getBalanceHbar(client, accountId) {
  const balance = await new AccountBalanceQuery().setAccountId(accountId).execute(client);
  return balance.hbars.toBigNumber().toNumber();
}

async function createFundedAccount(client, name, balanceHbar) {
  const priv = PrivateKey.generateED25519();
  const tx = new AccountCreateTransaction()
    .setKey(priv.publicKey)
    .setInitialBalance(new Hbar(balanceHbar))
    .setAccountMemo(`hedera-multisig test-env (${name})`);
  const submit = await tx.execute(client);
  const receipt = await submit.getReceipt(client);
  return {
    name,
    accountId: receipt.accountId.toString(),
    privateKey: priv.toString(),
    publicKey: priv.publicKey.toString(),
    transactionId: submit.transactionId.toString(),
  };
}

async function topUp(client, accountId, currentHbar, targetHbar) {
  const deficit = targetHbar - currentHbar;
  if (deficit <= 0.0001) return 0;
  const tx = new TransferTransaction()
    .addHbarTransfer(client.operatorAccountId, new Hbar(-deficit))
    .addHbarTransfer(accountId, new Hbar(deficit))
    .setTransactionMemo('hedera-multisig test-env top-up');
  const submit = await tx.execute(client);
  await submit.getReceipt(client);
  return deficit;
}

function printSummary(state, network) {
  console.log(chalk.bold.cyan('\n━━━ Test environment ready ━━━\n'));
  console.log(chalk.gray(`Network: ${network}`));
  console.log(chalk.gray(`Operator: ${state.operatorId}`));
  console.log(chalk.gray(`Accounts: ${state.accounts.length}\n`));

  for (const acct of state.accounts) {
    console.log(chalk.bold.white(`  ${acct.name.padEnd(8)}`) + chalk.yellow(acct.accountId));
    console.log(chalk.gray(`    pubKey  ${acct.publicKey.slice(0, 32)}…`));
    console.log(chalk.gray(`    https://hashscan.io/${network}/account/${acct.accountId}`));
  }

  console.log(chalk.bold.cyan('\nCopy-pasteable env overlay (optional — for tests that read these vars):\n'));
  state.accounts.forEach((acct, i) => {
    const upper = acct.name.toUpperCase();
    console.log(chalk.gray(`  TEST_${upper}_ID=${acct.accountId}`));
    console.log(chalk.gray(`  TEST_${upper}_KEY=${acct.privateKey}`));
  });

  console.log(chalk.bold.green('\n✅ State written to: ') + chalk.gray(STATE_FILE));
  console.log(chalk.gray('   (.testenv.json is gitignored — never commit it)\n'));
}

async function main() {
  const args = parseArgs();
  if (args.help) { showHelp(); return; }

  if (!Number.isInteger(args.accounts) || args.accounts < MIN_ACCOUNTS || args.accounts > MAX_ACCOUNTS) {
    fail(`--accounts must be an integer between ${MIN_ACCOUNTS} and ${MAX_ACCOUNTS}`);
  }
  if (!(args.balance > 0) || args.balance > 10000) {
    fail('--balance must be > 0 and ≤ 10000');
  }

  const { operatorId, operatorKey, network } = loadOperator();

  if (network === 'mainnet' && !args.yesMainnet) {
    fail(
      'Refusing to run on mainnet without --yes-mainnet.\n' +
      '   Account creation here will spend real HBAR. Switch to testnet for tests:\n' +
      '   set HEDERA_NETWORK=testnet in .env, then re-run.'
    );
  }

  console.log(chalk.bold.cyan('\n━━━ hedera-multisig test-env bootstrap ━━━\n'));
  console.log(chalk.gray(`Network: ${network}`));
  console.log(chalk.gray(`Operator: ${operatorId.toString()}`));

  const client = buildClient(network);
  client.setOperator(operatorId, operatorKey);

  // Existing state path (idempotent + top-up)
  if (fs.existsSync(STATE_FILE) && !args.force) {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    console.log(chalk.green('✓'), `Found existing .testenv.json with ${state.accounts.length} accounts`);

    if (state.network !== network) {
      fail(
        `.testenv.json is for network=${state.network}, but HEDERA_NETWORK=${network}.\n` +
        `   Either change HEDERA_NETWORK back, or run with --force to recreate.`
      );
    }

    let topUpTotal = 0;
    for (const acct of state.accounts) {
      let bal;
      try {
        bal = await getBalanceHbar(client, acct.accountId);
      } catch (err) {
        fail(`Account ${acct.accountId} not reachable: ${err.message}\n   Run with --force to recreate.`);
      }
      console.log(chalk.gray(`  ${acct.name.padEnd(8)} ${acct.accountId.padEnd(14)} ${bal.toFixed(2)} ℏ`));
      if (args.topUp && bal < args.balance) {
        const sent = await topUp(client, acct.accountId, bal, args.balance);
        topUpTotal += sent;
        console.log(chalk.green(`    → topped up +${sent.toFixed(2)} ℏ`));
      }
    }

    if (args.topUp) {
      console.log(chalk.bold.green(`\n✅ Top-up complete (+${topUpTotal.toFixed(2)} ℏ from operator)\n`));
    } else {
      console.log(chalk.gray('\n   (use --top-up to refill existing accounts; --force to recreate)\n'));
    }
    printSummary(state, network);
    client.close();
    return;
  }

  // Fresh creation path
  const operatorBalance = await getBalanceHbar(client, operatorId);
  const required = args.accounts * args.balance + OPERATOR_BUFFER_HBAR;
  console.log(chalk.gray(`Operator balance: ${operatorBalance.toFixed(2)} ℏ`));
  console.log(chalk.gray(`Required: ${args.accounts} × ${args.balance} ℏ + ${OPERATOR_BUFFER_HBAR} ℏ buffer = ${required.toFixed(2)} ℏ`));

  if (operatorBalance < required) {
    fail(
      `Operator balance ${operatorBalance.toFixed(2)} ℏ < ${required.toFixed(2)} ℏ required.\n` +
      `   Refill at https://portal.hedera.com/ or lower --balance / --accounts.`
    );
  }

  if (args.force && fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
    console.log(chalk.yellow('⚠'), 'Removed existing .testenv.json (old accounts abandoned on-chain)');
  }

  console.log('');
  const accounts = [];
  const names = DEFAULT_NAMES.slice(0, args.accounts);
  for (const name of names) {
    process.stdout.write(chalk.gray(`  Creating ${name.padEnd(8)} `));
    try {
      const acct = await createFundedAccount(client, name, args.balance);
      accounts.push(acct);
      console.log(chalk.green('✓'), chalk.yellow(acct.accountId), chalk.gray(`(${args.balance} ℏ)`));
    } catch (err) {
      fail(`Failed to create ${name}: ${err.message}`);
    }
  }

  const state = {
    note: 'TEST ENVIRONMENT — generated by scripts/setup-test-env.js. Do not commit. Do not reuse on mainnet.',
    network,
    operatorId: operatorId.toString(),
    balanceHbar: args.balance,
    createdAt: new Date().toISOString(),
    accounts,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

  printSummary(state, network);

  console.log(chalk.bold.cyan('Next steps:\n'));
  console.log(chalk.gray('  1. Run the precheck:        ') + chalk.white('npm run precheck'));
  console.log(chalk.gray('  2. Run the HBAR walkthrough: ') + chalk.white('see TESTING.md → Phase 1'));
  console.log('');

  client.close();
}

main().catch((err) => fail(err.stack || err.message));
