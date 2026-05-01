#!/usr/bin/env node
/**
 * Walkthrough step 0: prerequisite check.
 *
 * Verifies that .env is wired up, the operator account is reachable on the
 * configured network, and the operator has enough HBAR to run the rest of
 * the walkthrough.
 *
 * No on-chain side effects — read-only.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const { Client, AccountId, PrivateKey, AccountBalanceQuery, Hbar } = require('@hashgraph/sdk');
const chalk = require('chalk');

const REQUIRED_ENV = ['OPERATOR_ID', 'OPERATOR_KEY'];
const MIN_BALANCE_HBAR = 2; // need this much to fund the threshold account + cover fees

async function main() {
  console.log(chalk.bold.cyan('\n━━━ Walkthrough precheck (HBAR) ━━━\n'));

  // 1. Required env
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    fail(`Missing env vars: ${missing.join(', ')}\n` +
         `   Edit your repo-root .env file (copy from .env.example) and set OPERATOR_ID + OPERATOR_KEY.\n` +
         `   Get a testnet account at https://portal.hedera.com/`);
  }

  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  if (network !== 'testnet' && network !== 'previewnet') {
    console.log(chalk.yellow(
      `⚠  HEDERA_NETWORK=${network}. The walkthrough is designed for testnet — running it on mainnet will spend real HBAR.`
    ));
  }
  console.log(chalk.green('✓'), `Env loaded — network: ${network}`);

  // 2. Operator account reachable
  let client;
  try {
    client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
    client.setOperator(
      AccountId.fromString(process.env.OPERATOR_ID),
      PrivateKey.fromString(process.env.OPERATOR_KEY)
    );
  } catch (err) {
    fail(`Could not initialize Hedera client: ${err.message}\n` +
         `   Check that OPERATOR_ID is in 0.0.X form and OPERATOR_KEY is a DER-encoded private key.`);
  }
  console.log(chalk.green('✓'), `Operator: ${process.env.OPERATOR_ID}`);

  // 3. Balance
  let balance;
  try {
    balance = await new AccountBalanceQuery()
      .setAccountId(process.env.OPERATOR_ID)
      .execute(client);
  } catch (err) {
    fail(`Could not query operator balance: ${err.message}`);
  }
  const hbarBalance = balance.hbars.toBigNumber().toNumber();
  console.log(chalk.green('✓'), `Balance: ${hbarBalance.toFixed(2)} ℏ`);

  if (hbarBalance < MIN_BALANCE_HBAR) {
    fail(`Operator balance is ${hbarBalance.toFixed(2)} ℏ but the walkthrough needs at least ${MIN_BALANCE_HBAR} ℏ.\n` +
         `   Visit https://portal.hedera.com/, select your testnet account, and click "Refill Account."`);
  }

  console.log(chalk.bold.green('\n✅ All checks passed. Proceed with: node 01-generate-keys.js\n'));
  client.close();
}

function fail(msg) {
  console.error(chalk.red('\n❌ ') + msg + '\n');
  process.exit(1);
}

main().catch((err) => {
  fail(err.stack || err.message);
});
